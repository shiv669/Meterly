const { pool } = require('../config/database');

async function createRun() {
  const result = await pool.query(`
    INSERT INTO reconciliation_runs (status)
    VALUES ('running')
    RETURNING id
  `);

  return result.rows[0].id;
}

async function listStripeSubscriptions() {
  const result = await pool.query(`
    SELECT
      s.tenant_id,
      s.provider_subscription_id,
      s.provider_customer_id,
      s.status,
      s.current_period_start,
      s.current_period_end,
      p.code AS plan_code
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.provider = 'stripe'
      AND s.provider_subscription_id IS NOT NULL
    ORDER BY s.tenant_id
  `);

  return result.rows;
}

async function findPlanId(planCode) {
  const result = await pool.query(
    'SELECT id FROM plans WHERE code = $1',
    [planCode]
  );

  return result.rows[0]?.id || null;
}

async function updateSubscriptionFromStripe({
  tenantId,
  planId,
  providerCustomerId,
  providerSubscriptionId,
  status,
  currentPeriodStart,
  currentPeriodEnd
}) {
  const result = await pool.query(`
    UPDATE subscriptions
    SET plan_id = $2,
        provider_customer_id = $3,
        provider_subscription_id = $4,
        status = $5,
        current_period_start = $6,
        current_period_end = $7,
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING tenant_id
  `, [
    tenantId,
    planId,
    providerCustomerId,
    providerSubscriptionId,
    status,
    currentPeriodStart,
    currentPeriodEnd
  ]);

  if (result.rows.length === 0) {
    throw new Error(`Subscription disappeared for tenant ${tenantId}`);
  }
}

async function completeRun({
  runId,
  status,
  tenantsChecked,
  tenantsReconciled,
  failures,
  errorMessage
}) {
  await pool.query(`
    UPDATE reconciliation_runs
    SET completed_at = NOW(),
        status = $2,
        tenants_checked = $3,
        tenants_reconciled = $4,
        failures = $5,
        error_message = $6
    WHERE id = $1
  `, [
    runId,
    status,
    tenantsChecked,
    tenantsReconciled,
    failures,
    errorMessage || null
  ]);
}

module.exports = {
  createRun,
  listStripeSubscriptions,
  findPlanId,
  updateSubscriptionFromStripe,
  completeRun
};
