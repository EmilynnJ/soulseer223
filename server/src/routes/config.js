const express = require('express');
const { STRIPE_PUBLISHABLE_KEY, BILLING_INTERVAL_SECONDS, TURN_URL, TURN_USERNAME, TURN_PASSWORD } = require('../config');

const configRouter = express.Router();

configRouter.get('/', (req, res) => {
  res.json({
    stripe_publishable_key: STRIPE_PUBLISHABLE_KEY,
    billing_interval_seconds: BILLING_INTERVAL_SECONDS,
    turn: { url: TURN_URL, username: TURN_USERNAME, password: TURN_PASSWORD }
  });
});

module.exports = { configRouter };
