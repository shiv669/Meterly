const { stripe } = require('../config/stripe');
const subscriptionRepository = require('../repositories/subscription.repository');

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireStripeConfiguration() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw createServiceError('Stripe is not configured', 503);
  }
}

function toStripeDate(unixSeconds) {
  if (unixSeconds === undefined || unixSeconds === null) {
    return null;
  }

  return new Date(Number(unixSeconds) * 1000);
}

function getBillingPeriod(subscription) {
  const firstItem = subscription.items?.data?.[0];
  return {
    start: toStripeDate(
      subscription.current_period_start
      ?? firstItem?.current_period_start
      ?? subscription.start_date
    ),
    end: toStripeDate(
      subscription.current_period_end
      ?? firstItem?.current_period_end
      ?? subscription.billing_cycle_anchor
    )
  };
}

function getTenantId(object) {
  return object.metadata?.tenantId || object.client_reference_id || null;
}

async function createCheckoutSession({ tenantId }) {
  requireStripeConfiguration();

  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) {
    throw createServiceError('Stripe Pro price is not configured', 503);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: tenantId,
    metadata: { tenantId },
    subscription_data: { metadata: { tenantId } },
    success_url: process.env.STRIPE_SUCCESS_URL || 'http://localhost:8080/billing/success',
    cancel_url: process.env.STRIPE_CANCEL_URL || 'http://localhost:8080/billing/cancel'
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id
  };
}

async function processCheckoutCompleted(client, session) {
  const tenantId = getTenantId(session);
  if (!tenantId || !session.subscription) {
    throw createServiceError('Checkout session is missing tenant or subscription metadata');
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const proPlan = await subscriptionRepository.findPlanByCode(client, 'pro');
  const billingPeriod = getBillingPeriod(subscription);

  if (!proPlan) {
    throw new Error('Pro plan is missing from the database');
  }

  return subscriptionRepository.upsertSubscription(client, {
    tenantId,
    planId: proPlan.id,
    providerCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    providerSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodStart: billingPeriod.start,
    currentPeriodEnd: billingPeriod.end
  });
}

async function processSubscriptionUpdated(client, subscription) {
  const tenantId = getTenantId(subscription)
    || await subscriptionRepository.findTenantByProviderSubscription(client, subscription.id);

  if (!tenantId) {
    throw createServiceError('Subscription event is not linked to a tenant');
  }

  const proPlan = await subscriptionRepository.findPlanByCode(client, 'pro');
  const billingPeriod = getBillingPeriod(subscription);
  if (!proPlan) {
    throw new Error('Pro plan is missing from the database');
  }

  return subscriptionRepository.upsertSubscription(client, {
    tenantId,
    planId: proPlan.id,
    providerCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id,
    providerSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodStart: billingPeriod.start,
    currentPeriodEnd: billingPeriod.end
  });
}

async function processSubscriptionDeleted(client, subscription) {
  const tenantId = getTenantId(subscription)
    || await subscriptionRepository.findTenantByProviderSubscription(client, subscription.id);

  if (!tenantId) {
    throw createServiceError('Deleted subscription event is not linked to a tenant');
  }

  const billingPeriod = getBillingPeriod(subscription);

  return subscriptionRepository.updateSubscriptionStatus(client, {
    tenantId,
    providerCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id,
    providerSubscriptionId: subscription.id,
    status: 'canceled',
    currentPeriodStart: billingPeriod.start,
    currentPeriodEnd: billingPeriod.end
  });
}

async function processWebhookEvent(client, event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return processCheckoutCompleted(client, event.data.object);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return processSubscriptionUpdated(client, event.data.object);
    case 'customer.subscription.deleted':
      return processSubscriptionDeleted(client, event.data.object);
    default:
      return null;
  }
}

module.exports = {
  createCheckoutSession,
  processWebhookEvent
};
