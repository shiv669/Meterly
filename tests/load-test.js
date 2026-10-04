const { Client } = require('pg');
require('dotenv').config();

const baseUrl = process.env.LOAD_TEST_BASE_URL || 'http://localhost:8080';
const requests = Number(process.env.LOAD_TEST_REQUESTS || 200);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 25);
const mode = process.env.LOAD_TEST_MODE || 'health';

function percentile(values, percentage) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentage / 100) * sorted.length) - 1
  );
  return sorted[index];
}

function summarize(samples, startedAt, maxInFlight) {
  const latencies = samples.map((sample) => sample.latencyMs);
  const successful = samples.filter((sample) => sample.ok).length;
  const byStatus = samples.reduce((result, sample) => {
    const key = String(sample.status || 'network_error');
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  return {
    requests: samples.length,
    successful,
    failed: samples.length - successful,
    errorRatePercent: Number((((samples.length - successful) / samples.length) * 100).toFixed(3)),
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    throughputRequestsPerSecond: Number((samples.length / elapsedSeconds).toFixed(3)),
    concurrency: maxInFlight,
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(3)),
      avg: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3)),
      p50: Number(percentile(latencies, 50).toFixed(3)),
      p90: Number(percentile(latencies, 90).toFixed(3)),
      p95: Number(percentile(latencies, 95).toFixed(3)),
      p99: Number(percentile(latencies, 99).toFixed(3)),
      max: Number(Math.max(...latencies).toFixed(3))
    },
    statusCounts: byStatus
  };
}

async function requestHealth() {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}/health`);
    return {
      ok: response.status === 200,
      status: response.status,
      latencyMs: performance.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: 'network_error',
      latencyMs: performance.now() - startedAt,
      error: error.message
    };
  }
}

async function runHealthLoad() {
  const samples = [];
  let nextRequest = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const requestNumber = nextRequest;
      nextRequest += 1;
      if (requestNumber >= requests) {
        return;
      }

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      samples.push(await requestHealth());
      inFlight -= 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  return summarize(samples, startedAt, maxInFlight);
}

async function getDatabaseClient() {
  const connectionString = process.env.DATABASE_URL || [
    `postgresql://${encodeURIComponent(process.env.DB_USER || 'meterly')}`,
    `:${encodeURIComponent(process.env.DB_PASSWORD || 'meterly_dev_password')}`,
    `@${process.env.DB_HOST || '127.0.0.1'}`,
    `:${process.env.DB_PORT || '15432'}`,
    `/${process.env.DB_NAME || 'meterly'}`
  ].join('');
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function runIdempotencyLoad() {
  const client = await getDatabaseClient();
  const tenantId = process.env.DEV_TENANT_ID || '00000000-0000-4000-8000-000000000001';
  const key = `load-test-${Date.now()}`;
  const samples = [];
  let nextRequest = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const startedAt = performance.now();

  async function sendRequest() {
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/usage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DEV_AUTH_TOKEN || 'demo-token'}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key
        },
        body: JSON.stringify({ usageType: 'api_call', quantity: 1 })
      });
      return {
        ok: response.status === 201,
        status: response.status,
        latencyMs: performance.now() - requestStartedAt,
        body: await response.json()
      };
    } catch (error) {
      return {
        ok: false,
        status: 'network_error',
        latencyMs: performance.now() - requestStartedAt,
        error: error.message
      };
    }
  }

  async function worker() {
    while (true) {
      const requestNumber = nextRequest;
      nextRequest += 1;
      if (requestNumber >= requests) {
        return;
      }

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      samples.push(await sendRequest());
      inFlight -= 1;
    }
  }

  try {
    const before = await client.query(`
      SELECT COUNT(*)::integer AS count
      FROM usage_events
      WHERE tenant_id = $1 AND idempotency_key = $2
    `, [tenantId, key]);

    await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));

    const after = await client.query(`
      SELECT COUNT(*)::integer AS count, MIN(id::text) AS usage_event_id
      FROM usage_events
      WHERE tenant_id = $1 AND idempotency_key = $2
    `, [tenantId, key]);
    const bodies = samples
      .filter((sample) => sample.body)
      .map((sample) => `${sample.body.usageEventId || ''}:${sample.body.quantity || ''}`);
    const uniqueResponses = new Set(bodies);
    const summary = summarize(samples, startedAt, maxInFlight);

    return {
      ...summary,
      idempotencyKey: key,
      rowsBefore: before.rows[0].count,
      rowsAfter: after.rows[0].count,
      doubleConsumption: after.rows[0].count !== 1,
      uniqueLogicalResponses: uniqueResponses.size,
      usageEventId: after.rows[0].usage_event_id
    };
  } finally {
    await client.end();
  }
}

(async () => {
  const result = mode === 'idempotency'
    ? await runIdempotencyLoad()
    : await runHealthLoad();
  console.log(JSON.stringify({
    benchmark: mode,
    baseUrl,
    configuration: { requests, concurrency },
    result
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
