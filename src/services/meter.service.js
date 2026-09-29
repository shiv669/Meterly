const { pool } = require('../config/database');
const quotaService = require('./quota.service');
const costService = require('./cost.service');
const {
  findUsageEventByIdempotencyKey,
  insertUsageEvent
} = require('../repositories/usage.repository');

async function record({ tenantId, idempotencyKey, usage }) {
  const inputTokens = usage.inputTokens || 0;
  const cachedInputTokens = usage.cachedInputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const reasoningTokens = usage.reasoningTokens || 0;
  const quantity = usage.usageType === 'api_call'
    ? usage.quantity
    : inputTokens + cachedInputTokens + outputTokens + reasoningTokens;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await findUsageEventByIdempotencyKey(
      client,
      tenantId,
      idempotencyKey
    );

    if (existing) {
      await client.query('COMMIT');
      const existingCost = costService.calculate({
        apiCalls: existing.usage_type === 'api_call' ? Number(existing.quantity) : 0,
        inputTokens: Number(existing.input_tokens || 0),
        cachedInputTokens: Number(existing.cached_input_tokens || 0),
        outputTokens: Number(existing.output_tokens || 0),
        reasoningTokens: Number(existing.reasoning_tokens || 0)
      });
      return {
        idempotent: true,
        usageEventId: existing.id,
        usageType: existing.usage_type,
        quantity: Number(existing.quantity),
        cost: existingCost
      };
    }

    const billingPeriod = await quotaService.checkAndLock({
      client,
      tenantId,
      usageType: usage.usageType,
      requestedQuantity: quantity
    });

    const event = await insertUsageEvent({
      client,
      tenantId,
      idempotencyKey,
      usageType: usage.usageType,
      quantity,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      billingPeriodStart: billingPeriod.billingPeriodStart,
      billingPeriodEnd: billingPeriod.billingPeriodEnd
    });

    await client.query('COMMIT');

    const newCost = costService.calculate({
      apiCalls: usage.usageType === 'api_call' ? quantity : 0,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens
    });

    return {
      idempotent: false,
      usageEventId: event.id,
      usageType: event.usage_type,
      quantity: Number(event.quantity),
      cost: newCost
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { record };
