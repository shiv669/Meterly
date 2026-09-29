const { pool } = require('../config/database');

async function findSubscriptionByTenant(client, tenantId) {
  const result = await client.query(`
    SELECT id, tenant_id, plan_id, provider_customer_id, provider_subscription_id,
           status, current_period_start, current_period_end
    FROM subscriptions
    WHERE tenant_id = $1
  `, [tenantId]);

  return result.rows[0] || null;
}

async function getSubscriptionForTenant(tenantId) {
  const result = await pool.query(`
    SELECT
      s.status,
      s.current_period_start,
      s.current_period_end,
      p.name AS plan_name,
      p.api_call_limit,
      p.ai_token_limit
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.tenant_id = $1
  `, [tenantId]);

  return result.rows[0] || null;
}

async function findPlanByCode(client, code) {
  const result = await client.query(
    'SELECT id, code FROM plans WHERE code = $1',
    [code]
  );

  return result.rows[0] || null;
}

async function findTenantByProviderSubscription(client, providerSubscriptionId) {
  const result = await client.query(
    'SELECT tenant_id FROM subscriptions WHERE provider_subscription_id = $1',
    [providerSubscriptionId]
  );

  return result.rows[0]?.tenant_id || null;
}

async function upsertSubscription(client, {
  tenantId,
  planId,
  providerCustomerId,
  providerSubscriptionId,
  status,
  currentPeriodStart,
  currentPeriodEnd
}) {
  const result = await client.query(`
    INSERT INTO subscriptions (
      tenant_id,
      plan_id,
      provider,
      provider_customer_id,
      provider_subscription_id,
      status,
      current_period_start,
      current_period_end
    )
    VALUES ($1, $2, 'stripe', $3, $4, $5, $6, $7)
    ON CONFLICT (tenant_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      provider = EXCLUDED.provider,
      provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, subscriptions.provider_customer_id),
      provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, subscriptions.provider_subscription_id),
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()
    RETURNING id, tenant_id, plan_id, provider_customer_id, provider_subscription_id,
              status, current_period_start, current_period_end
  `, [
    tenantId,
    planId,
    providerCustomerId,
    providerSubscriptionId,
    status,
    currentPeriodStart,
    currentPeriodEnd
  ]);

  return result.rows[0];
}

async function updateSubscriptionStatus(client, {
  tenantId,
  providerCustomerId,
  providerSubscriptionId,
  status,
  currentPeriodStart,
  currentPeriodEnd
}) {
  const result = await client.query(`
    UPDATE subscriptions
    SET provider_customer_id = COALESCE($2, provider_customer_id),
        provider_subscription_id = COALESCE($3, provider_subscription_id),
        status = $4,
        current_period_start = COALESCE($5, current_period_start),
        current_period_end = COALESCE($6, current_period_end),
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING id, tenant_id, plan_id, provider_customer_id, provider_subscription_id,
              status, current_period_start, current_period_end
  `, [
    tenantId,
    providerCustomerId,
    providerSubscriptionId,
    status,
    currentPeriodStart,
    currentPeriodEnd
  ]);

  return result.rows[0] || null;
}

module.exports = {
  findSubscriptionByTenant,
  getSubscriptionForTenant,
  findPlanByCode,
  findTenantByProviderSubscription,
  upsertSubscription,
  updateSubscriptionStatus
};
