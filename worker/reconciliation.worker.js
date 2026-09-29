const { stripe, configured } = require('../src/config/stripe');
const reconciliationRepository = require('../src/repositories/reconciliation.repository');
const { withRetry } = require('./retry');

function toDate(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000);
}

function getBillingPeriod(subscription) {
  const firstItem = subscription.items?.data?.[0];
  const start = subscription.current_period_start
    ?? firstItem?.current_period_start
    ?? subscription.start_date;
  const end = subscription.current_period_end
    ?? firstItem?.current_period_end
    ?? subscription.billing_cycle_anchor;

  if (start === undefined || end === undefined) {
    throw new Error(`Stripe subscription ${subscription.id} has no billing period`);
  }

  return {
    start: toDate(start),
    end: toDate(end)
  };
}

function getPlanCode(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id || subscription.plan?.id;
  if (!priceId) {
    throw new Error(`Stripe subscription ${subscription.id} has no price`);
  }

  if (priceId === process.env.STRIPE_PRO_PRICE_ID) {
    return 'pro';
  }

  return 'free';
}

function isDifferent(databaseSubscription, stripeSubscription, planCode, period) {
  return databaseSubscription.plan_code !== planCode
    || databaseSubscription.status !== stripeSubscription.status
    || databaseSubscription.provider_customer_id !== stripeSubscription.customer
    || databaseSubscription.current_period_start.getTime() !== period.start.getTime()
    || databaseSubscription.current_period_end.getTime() !== period.end.getTime();
}

async function reconcileSubscription(databaseSubscription) {
  const stripeSubscription = await stripe.subscriptions.retrieve(
    databaseSubscription.provider_subscription_id
  );
  const planCode = getPlanCode(stripeSubscription);
  const period = getBillingPeriod(stripeSubscription);

  if (!isDifferent(databaseSubscription, stripeSubscription, planCode, period)) {
    return false;
  }

  const planId = await reconciliationRepository.findPlanId(planCode);
  if (!planId) {
    throw new Error(`Plan ${planCode} is missing from the database`);
  }

  await reconciliationRepository.updateSubscriptionFromStripe({
    tenantId: databaseSubscription.tenant_id,
    planId,
    providerCustomerId: stripeSubscription.customer,
    providerSubscriptionId: stripeSubscription.id,
    status: stripeSubscription.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end
  });

  console.log(JSON.stringify({
    event: 'subscription_reconciled',
    tenantId: databaseSubscription.tenant_id,
    stripeSubscriptionId: stripeSubscription.id,
    planCode,
    status: stripeSubscription.status
  }));
  return true;
}

async function runReconciliation() {
  if (!configured || !process.env.STRIPE_PRO_PRICE_ID) {
    throw new Error('Stripe reconciliation requires Stripe credentials and STRIPE_PRO_PRICE_ID');
  }

  const runId = await reconciliationRepository.createRun();
  const subscriptions = await reconciliationRepository.listStripeSubscriptions();
  let tenantsReconciled = 0;
  let failures = 0;
  const failureMessages = [];

  for (const subscription of subscriptions) {
    try {
      const reconciled = await withRetry(
        () => reconcileSubscription(subscription),
        {
          maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS || 3),
          baseDelayMilliseconds: Number(process.env.WORKER_RETRY_BASE_DELAY_MS || 1000),
          onRetry: ({ attempt, waitMilliseconds, error }) => {
            console.error(JSON.stringify({
              event: 'reconciliation_retry',
              tenantId: subscription.tenant_id,
              attempt,
              waitMilliseconds,
              message: error.message
            }));
          }
        }
      );

      if (reconciled) {
        tenantsReconciled += 1;
      }
    } catch (error) {
      failures += 1;
      const message = `tenant=${subscription.tenant_id} subscription=${subscription.provider_subscription_id} attempts=${process.env.WORKER_MAX_ATTEMPTS || 3} reason=${error.message}`;
      failureMessages.push(message);
      console.error(JSON.stringify({
        event: 'reconciliation_failed',
        tenantId: subscription.tenant_id,
        stripeSubscriptionId: subscription.provider_subscription_id,
        message: error.message
      }));
    }
  }

  const status = failures > 0 ? 'completed_with_failures' : 'completed';
  await reconciliationRepository.completeRun({
    runId,
    status,
    tenantsChecked: subscriptions.length,
    tenantsReconciled,
    failures,
    errorMessage: failureMessages.join('; ') || null
  });

  const result = {
    runId,
    status,
    tenantsChecked: subscriptions.length,
    tenantsReconciled,
    failures
  };
  console.log(JSON.stringify({ event: 'reconciliation_completed', ...result }));
  return result;
}

module.exports = { runReconciliation };
