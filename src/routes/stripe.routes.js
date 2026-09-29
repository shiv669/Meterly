const express = require('express');
const { authenticateDevelopment } = require('../middleware/auth.middleware');
const {
  createCheckout,
  receiveStripeWebhook
} = require('../controllers/stripe.controller');

const router = express.Router();

router.post('/api/billing/checkout', authenticateDevelopment, createCheckout);
router.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  receiveStripeWebhook
);

module.exports = router;
