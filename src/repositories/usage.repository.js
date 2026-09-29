const { pool } = require('../config/database');

async function findUsageEventByIdempotencyKey(client, tenantId, idempotencyKey) {
  const result = await client.query(`
    SELECT id, usage_type, quantity,
           input_tokens, cached_input_tokens, output_tokens, reasoning_tokens
    FROM usage_events
    WHERE tenant_id = $1 AND idempotency_key = $2
  `, [tenantId, idempotencyKey]);

  return result.rows[0] || null;
}

async function insertUsageEvent({
  client,
  tenantId,
  idempotencyKey,
  usageType,
  quantity,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningTokens,
  costMicrounits = 0,
  billingPeriodStart,
  billingPeriodEnd
}) {
  const values = [
    tenantId,
    idempotencyKey,
    usageType,
    quantity,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    billingPeriodStart,
    billingPeriodEnd
  ];

  const inserted = await client.query(`
    INSERT INTO usage_events (
      tenant_id,
      idempotency_key,
      usage_type,
      quantity,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      cost_microunits,
      billing_period_start,
      billing_period_end
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id, usage_type, quantity
  `, [
    ...values.slice(0, 8),
    costMicrounits,
    ...values.slice(8)
  ]);

  if (inserted.rows.length > 0) {
    return inserted.rows[0];
  }

  const existing = await findUsageEventByIdempotencyKey(client, tenantId, idempotencyKey);

  if (!existing) {
    throw new Error('Usage event was not inserted or found');
  }

  return existing;
}

async function aggregateUsage({ tenantId, periodStart, periodEnd }) {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(quantity) FILTER (WHERE usage_type = 'api_call'), 0) AS api_calls,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens,
      COALESCE(SUM(quantity) FILTER (WHERE usage_type = 'ai_tokens'), 0) AS ai_tokens
    FROM usage_events
    WHERE tenant_id = $1
      AND billing_period_start >= $2::date
      AND billing_period_end <= $3::date
  `, [tenantId, periodStart, periodEnd]);

  const row = result.rows[0];
  return {
    apiCalls: Number(row.api_calls),
    aiTokens: Number(row.ai_tokens),
    inputTokens: Number(row.input_tokens),
    cachedInputTokens: Number(row.cached_input_tokens),
    outputTokens: Number(row.output_tokens),
    reasoningTokens: Number(row.reasoning_tokens)
  };
}

module.exports = {
  findUsageEventByIdempotencyKey,
  insertUsageEvent,
  aggregateUsage
};
