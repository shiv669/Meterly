const { PRICING } = require('../config/pricing');

function calculate({
  apiCalls = 0,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0
}) {
  const apiCallCost = apiCalls * PRICING.apiCallMicrounits;
  const freshInputCost = inputTokens * PRICING.freshInputTokenMicrounits;
  const cachedInputCost = cachedInputTokens * PRICING.cachedInputTokenMicrounits;
  const outputCost = (outputTokens + reasoningTokens) * PRICING.outputTokenMicrounits;

  return {
    apiCalls: apiCallCost,
    aiTokens: freshInputCost + cachedInputCost + outputCost,
    total: apiCallCost + freshInputCost + cachedInputCost + outputCost,
    currency: PRICING.currency,
    moneyUnit: PRICING.moneyUnit
  };
}

module.exports = { calculate };
