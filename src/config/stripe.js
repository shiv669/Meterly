const Stripe = require('stripe');
require('dotenv').config();

const configured = Boolean(process.env.STRIPE_SECRET_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

module.exports = { stripe, configured };
