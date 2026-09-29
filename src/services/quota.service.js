const { lockTenantAndGetQuota } = require('../repositories/quota.repository');

function createQuotaError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function checkAndLock({ client, tenantId, usageType, requestedQuantity }) {
  const quota = await lockTenantAndGetQuota(client, tenantId);

  if (!quota) {
    throw createQuotaError('An active subscription is required', 402);
  }

  if (!['active', 'trialing'].includes(quota.status)) {
    throw createQuotaError('An active subscription is required', 402);
  }

  const currentUsage = usageType === 'api_call'
    ? quota.apiCallsUsed
    : quota.aiTokensUsed;
  const limit = usageType === 'api_call'
    ? quota.apiCallLimit
    : quota.aiTokenLimit;
  const projectedUsage = currentUsage + requestedQuantity;

  if (projectedUsage > limit) {
    const label = usageType === 'api_call' ? 'API call' : 'AI token';
    throw createQuotaError(
      `${label} quota exceeded: ${currentUsage}/${limit} used, requested ${requestedQuantity}`,
      429
    );
  }

  return {
    billingPeriodStart: quota.billingPeriodStart,
    billingPeriodEnd: quota.billingPeriodEnd
  };
}

module.exports = { checkAndLock };
