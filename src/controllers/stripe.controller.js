const { stripe, configured } = require('../config/stripe');
const subscriptionService = require('../services/subscription.service');
const { withDeduplicatedEvent } = require('../repositories/webhook.repository');

async function createCheckout(request, response, next) {
  try {
    const result = await subscriptionService.createCheckoutSession({
      tenantId: request.tenantId
    });

    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function receiveStripeWebhook(request, response, next) {
  const signature = request.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature) {
    return response.status(400).json({
      status: 'error',
      message: 'Stripe signature is required'
    });
  }

  if (!configured || !secret) {
    return response.status(503).json({
      status: 'error',
      message: 'Stripe webhook verification is not configured'
    });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(request.body, signature, secret);
  } catch (_error) {
    return response.status(400).json({
      status: 'error',
      message: 'Invalid Stripe webhook signature'
    });
  }

  try {
    const result = await withDeduplicatedEvent({
      provider: 'stripe',
      event,
      handler: subscriptionService.processWebhookEvent
    });

    return response.status(200).json({
      received: true,
      duplicate: result.duplicate
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCheckout,
  receiveStripeWebhook
};
