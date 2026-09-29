const subscriptionRepository = require('../repositories/subscription.repository');
const usageRepository = require('../repositories/usage.repository');
const costService = require('./cost.service');

function createUsageError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getUsage({ tenantId }) {
  const subscription = await subscriptionRepository.getSubscriptionForTenant(tenantId);

  if (!subscription) {
    throw createUsageError('An active subscription is required', 402);
  }

  const activeStatuses = ['active', 'trialing'];
  if (!activeStatuses.includes(subscription.status)) {
    throw createUsageError('An active subscription is required', 402);
  }

  const usage = await usageRepository.aggregateUsage({
    tenantId,
    periodStart: subscription.current_period_start,
    periodEnd: subscription.current_period_end
  });
  const cost = costService.calculate(usage);
  const apiCallLimit = Number(subscription.api_call_limit);
  const aiTokenLimit = Number(subscription.ai_token_limit);

  return {
    plan: {
      name: subscription.plan_name,
      apiCallLimit,
      aiTokenLimit
    },
    period: {
      start: subscription.current_period_start,
      end: subscription.current_period_end
    },
    usage: {
      apiCalls: usage.apiCalls,
      aiTokens: usage.aiTokens,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens
    },
    remaining: {
      apiCalls: Math.max(apiCallLimit - usage.apiCalls, 0),
      aiTokens: Math.max(aiTokenLimit - usage.aiTokens, 0)
    },
    cost
  };
}

module.exports = { getUsage };
