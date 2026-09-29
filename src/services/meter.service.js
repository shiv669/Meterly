const { insertUsageEvent } = require('../repositories/usage.repository');

function getCurrentBillingPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

async function record({ tenantId, idempotencyKey, usage }) {
  const billingPeriod = getCurrentBillingPeriod();
  const inputTokens = usage.inputTokens || 0;
  const cachedInputTokens = usage.cachedInputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const reasoningTokens = usage.reasoningTokens || 0;
  const quantity = usage.usageType === 'api_call'
    ? usage.quantity
    : inputTokens + outputTokens + reasoningTokens;

  const event = await insertUsageEvent({
    tenantId,
    idempotencyKey,
    usageType: usage.usageType,
    quantity,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    billingPeriodStart: billingPeriod.start,
    billingPeriodEnd: billingPeriod.end
  });

  return {
    usageEventId: event.id,
    usageType: event.usage_type,
    quantity: Number(event.quantity)
  };
}

module.exports = { record };
