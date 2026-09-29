const { pool } = require('../src/config/database');
const { generate } = require('../src/providers/openai.provider');
const { calculate } = require('../src/services/cost.service');
const aiJobRepository = require('../src/repositories/ai-job.repository');
const { insertUsageEvent } = require('../src/repositories/usage.repository');

const runOnce = process.argv.includes('--once');
const maxAttempts = Number(process.env.AI_WORKER_MAX_ATTEMPTS || 3);
const pollIntervalMilliseconds = Number(process.env.AI_WORKER_POLL_INTERVAL_MS || 1000);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function completeJob(job, providerResult) {
  const cost = calculate({
    inputTokens: providerResult.inputTokens,
    cachedInputTokens: providerResult.cachedInputTokens,
    outputTokens: providerResult.outputTokens,
    reasoningTokens: providerResult.reasoningTokens
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await insertUsageEvent({
      client,
      tenantId: job.tenant_id,
      idempotencyKey: `ai-job:${job.id}`,
      usageType: 'ai_tokens',
      quantity: providerResult.inputTokens
        + providerResult.cachedInputTokens
        + providerResult.outputTokens
        + providerResult.reasoningTokens,
      inputTokens: providerResult.inputTokens,
      cachedInputTokens: providerResult.cachedInputTokens,
      outputTokens: providerResult.outputTokens,
      reasoningTokens: providerResult.reasoningTokens,
      costMicrounits: cost.aiTokens,
      billingPeriodStart: job.billing_period_start,
      billingPeriodEnd: job.billing_period_end
    });

    await client.query(`
      UPDATE ai_jobs
      SET status = 'completed',
          output = $2,
          provider_request_id = $3,
          input_tokens = $4,
          cached_input_tokens = $5,
          output_tokens = $6,
          reasoning_tokens = $7,
          cost_microunits = $8,
          completed_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1 AND status = 'processing'
    `, [
      job.id,
      providerResult.output,
      providerResult.providerRequestId,
      providerResult.inputTokens,
      providerResult.cachedInputTokens,
      providerResult.outputTokens,
      providerResult.reasoningTokens,
      cost.aiTokens
    ]);

    await client.query('COMMIT');
    console.log(JSON.stringify({
      event: 'ai_job_completed',
      jobId: job.id,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
      costMicrocents: cost.aiTokens
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processJob(job) {
  try {
    const providerResult = await generate({
      prompt: job.prompt,
      maxOutputTokens: job.max_output_tokens
    });
    await completeJob(job, providerResult);
  } catch (error) {
    if (job.attempts >= maxAttempts) {
      await aiJobRepository.markJobFailed(job.id, error.message);
      console.error(JSON.stringify({
        event: 'ai_job_failed',
        jobId: job.id,
        attempts: job.attempts,
        message: error.message
      }));
      return;
    }

    await aiJobRepository.markJobForRetry(job.id, error.message);
    console.error(JSON.stringify({
      event: 'ai_job_retry',
      jobId: job.id,
      attempt: job.attempts,
      message: error.message
    }));
  }
}

async function runAiWorker() {
  while (true) {
    const job = await aiJobRepository.claimNextJob();
    if (!job) {
      if (runOnce) {
        return;
      }
      await delay(pollIntervalMilliseconds);
      continue;
    }

    await processJob(job);
  }
}

runAiWorker().catch((error) => {
  console.error(JSON.stringify({
    event: 'ai_worker_failed',
    message: error.message
  }));
  process.exitCode = 1;
});

module.exports = { completeJob, processJob, runAiWorker };
