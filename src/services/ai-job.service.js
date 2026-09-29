const { pool } = require('../config/database');
const quotaService = require('./quota.service');
const aiJobRepository = require('../repositories/ai-job.repository');

function createJobError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function estimateInputTokens(prompt) {
  return Math.max(1, Math.ceil(prompt.length / 4));
}

function summarizeJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    output: job.output,
    usage: job.status === 'completed' ? {
      inputTokens: Number(job.input_tokens),
      cachedInputTokens: Number(job.cached_input_tokens),
      outputTokens: Number(job.output_tokens),
      reasoningTokens: Number(job.reasoning_tokens)
    } : undefined,
    costMicrocents: job.status === 'completed'
      ? Number(job.cost_microunits)
      : undefined,
    error: job.status === 'failed' ? job.error_message : undefined
  };
}

async function createJob({ tenantId, idempotencyKey, prompt, maxOutputTokens }) {
  const reservedTokens = estimateInputTokens(prompt) + maxOutputTokens;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await aiJobRepository.findByIdempotencyKey(
      client,
      tenantId,
      idempotencyKey
    );
    if (existing) {
      await client.query('COMMIT');
      return summarizeJob(existing);
    }

    const billingPeriod = await quotaService.reserveAiTokens({
      client,
      tenantId,
      requestedTokens: reservedTokens
    });
    const job = await aiJobRepository.createJob(client, {
      tenantId,
      idempotencyKey,
      prompt,
      maxOutputTokens,
      reservedTokens,
      billingPeriodStart: billingPeriod.billingPeriodStart,
      billingPeriodEnd: billingPeriod.billingPeriodEnd
    });

    await client.query('COMMIT');
    return summarizeJob(job);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getJob({ tenantId, jobId }) {
  const job = await aiJobRepository.getJobForTenant(tenantId, jobId);
  if (!job) {
    throw createJobError('AI job not found', 404);
  }

  return summarizeJob(job);
}

module.exports = {
  createJob,
  getJob,
  estimateInputTokens
};
