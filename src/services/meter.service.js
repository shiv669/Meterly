const { pool } = require('../config/database');
const quotaService = require('./quota.service');
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
      return {
        usageEventId: existing.id,
        usageType: existing.usage_type,
        quantity: Number(existing.quantity)
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

    return {
      usageEventId: event.id,
      usageType: event.usage_type,
      quantity: Number(event.quantity)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { record };
