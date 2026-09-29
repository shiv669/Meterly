async function lockTenantAndGetQuota(client, tenantId) {
  const subscriptionResult = await client.query(`
    SELECT
      s.status,
      s.current_period_start,
      s.current_period_end,
      p.api_call_limit,
      p.ai_token_limit
    FROM tenants t
    JOIN subscriptions s ON s.tenant_id = t.id
    JOIN plans p ON p.id = s.plan_id
    WHERE t.id = $1
    FOR UPDATE OF t
  `, [tenantId]);

  if (subscriptionResult.rows.length === 0) {
    return null;
  }

  const subscription = subscriptionResult.rows[0];
  const usageResult = await client.query(`
    SELECT
      COALESCE(SUM(quantity) FILTER (WHERE usage_type = 'api_call'), 0) AS api_calls_used,
      COALESCE(SUM(quantity) FILTER (WHERE usage_type = 'ai_tokens'), 0) AS ai_tokens_used
    FROM usage_events
    WHERE tenant_id = $1
      AND billing_period_start >= $2::date
      AND billing_period_end <= $3::date
  `, [
    tenantId,
    subscription.current_period_start,
    subscription.current_period_end
  ]);

  return {
    status: subscription.status,
    billingPeriodStart: subscription.current_period_start,
    billingPeriodEnd: subscription.current_period_end,
    apiCallLimit: Number(subscription.api_call_limit),
    aiTokenLimit: Number(subscription.ai_token_limit),
    apiCallsUsed: Number(usageResult.rows[0].api_calls_used),
    aiTokensUsed: Number(usageResult.rows[0].ai_tokens_used)
  };
}

module.exports = { lockTenantAndGetQuota };
