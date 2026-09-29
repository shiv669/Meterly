const { pool } = require('../config/database');

async function findByIdempotencyKey(client, tenantId, idempotencyKey) {
  const result = await client.query(`
    SELECT id, status, output, input_tokens, cached_input_tokens, output_tokens,
           reasoning_tokens, cost_microunits, error_message
    FROM ai_jobs
    WHERE tenant_id = $1 AND idempotency_key = $2
  `, [tenantId, idempotencyKey]);

  return result.rows[0] || null;
}

async function createJob(client, {
  tenantId,
  idempotencyKey,
  prompt,
  maxOutputTokens,
  reservedTokens,
  billingPeriodStart,
  billingPeriodEnd
}) {
  const result = await client.query(`
    INSERT INTO ai_jobs (
      tenant_id,
      idempotency_key,
      status,
      prompt,
      max_output_tokens,
      reserved_tokens,
      billing_period_start,
      billing_period_end,
      provider
    )
    VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, 'openai')
    RETURNING id, status
  `, [
    tenantId,
    idempotencyKey,
    prompt,
    maxOutputTokens,
    reservedTokens,
    billingPeriodStart,
    billingPeriodEnd
  ]);

  return result.rows[0];
}

async function getJobForTenant(tenantId, jobId) {
  const result = await pool.query(`
    SELECT id, status, output, input_tokens, cached_input_tokens, output_tokens,
           reasoning_tokens, cost_microunits, error_message, attempts, created_at,
           started_at, completed_at
    FROM ai_jobs
    WHERE tenant_id = $1 AND id = $2
  `, [tenantId, jobId]);

  return result.rows[0] || null;
}

async function claimNextJob() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE ai_jobs
      SET status = 'queued', started_at = NULL, updated_at = NOW()
      WHERE status = 'processing'
        AND started_at < NOW() - INTERVAL '5 minutes'
    `);

    const selected = await client.query(`
      SELECT id, tenant_id, prompt, max_output_tokens, reserved_tokens,
             billing_period_start, billing_period_end, attempts
      FROM ai_jobs
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (selected.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const job = selected.rows[0];
    const claimed = await client.query(`
      UPDATE ai_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          started_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, tenant_id, prompt, max_output_tokens, billing_period_start,
                billing_period_end, attempts
    `, [job.id]);

    await client.query('COMMIT');
    return claimed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markJobForRetry(jobId, errorMessage) {
  await pool.query(`
    UPDATE ai_jobs
    SET status = 'queued',
        error_message = $2,
        updated_at = NOW()
    WHERE id = $1 AND status = 'processing'
  `, [jobId, errorMessage]);
}

async function markJobFailed(jobId, errorMessage) {
  await pool.query(`
    UPDATE ai_jobs
    SET status = 'failed',
        error_message = $2,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = $1 AND status = 'processing'
  `, [jobId, errorMessage]);
}

module.exports = {
  findByIdempotencyKey,
  createJob,
  getJobForTenant,
  claimNextJob,
  markJobForRetry,
  markJobFailed
};
