const express = require('express');
const Stripe = require('stripe');
const { query } = require('../db');
const { STRIPE_SECRET_KEY, CLIENT_URL, READER_PAYOUT_PERCENT } = require('../config');
const { authMiddleware } = require('./auth');
const stripe = new Stripe(STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

const stripeRouter = express.Router();

stripeRouter.post('/topup', authMiddleware, async (req, res) => {
  const { amount_cents } = req.body;
  if (!amount_cents || amount_cents < 100) return res.status(400).json({ error: 'invalid_amount' });
  const userRes = await query('select id, stripe_customer_id, email, name, role from users where clerk_user_id=$1', [req.clerkUserId]);
  const user = userRes.rows[0];
  if (user.role !== 'client') return res.status(403).json({ error: 'not_client' });
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: user.name });
    customerId = customer.id;
    await query('update users set stripe_customer_id=$1 where id=$2', [customerId, user.id]);
  }
  const pi = await stripe.paymentIntents.create({
    amount: amount_cents,
    currency: 'usd',
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    description: 'SoulSeer wallet top-up'
  });
  res.json({ client_secret: pi.client_secret });
});

stripeRouter.post('/connect/create', authMiddleware, async (req, res) => {
  const userRes = await query('select id, role, stripe_account_id, email from users where clerk_user_id=$1', [req.clerkUserId]);
  const user = userRes.rows[0];
  if (user.role !== 'reader') return res.status(403).json({ error: 'not_reader' });
  let acctId = user.stripe_account_id;
  if (!acctId) {
    const account = await stripe.accounts.create({ type: 'express', email: user.email });
    acctId = account.id;
    await query('update users set stripe_account_id=$1 where id=$2', [acctId, user.id]);
  }
  const link = await stripe.accountLinks.create({
    account: acctId,
    refresh_url: CLIENT_URL + '/reader/onboarding',
    return_url: CLIENT_URL + '/reader/dashboard',
    type: 'account_onboarding'
  });
  res.json({ url: link.url });
});

async function creditWallet(userId, amount) {
  await query('update wallets set balance_cents = balance_cents + $1, updated_at=now() where user_id=$2', [amount, userId]);
  await query('insert into wallet_ledger(user_id,type,amount_cents,source) values ($1,$2,$3,$4)', [userId, 'credit', amount, 'topup']);
}

async function debitWallet(userId, amount) {
  const res = await query('select balance_cents from wallets where user_id=$1', [userId]);
  const bal = res.rows[0]?.balance_cents || 0;
  if (bal < amount) return false;
  await query('update wallets set balance_cents = balance_cents - $1, updated_at=now() where user_id=$2', [amount, userId]);
  await query('insert into wallet_ledger(user_id,type,amount_cents,source) values ($1,$2,$3,$4)', [userId, 'debit', amount, 'session']);
  return true;
}

async function transferToReader(readerStripeAccountId, amountCents) {
  if (!readerStripeAccountId || !amountCents || amountCents <= 0) return;
  await stripe.transfers.create({ amount: amountCents, currency: 'usd', destination: readerStripeAccountId, description: 'SoulSeer session payout' });
}

async function settleSessionPayout(sessionId) {
  const sRes = await query('select s.amount_charged_cents, u.stripe_account_id from sessions s join users u on u.id=s.reader_id where s.id=$1', [sessionId]);
  if (!sRes.rows.length) return;
  const { amount_charged_cents, stripe_account_id } = sRes.rows[0];
  const readerAmount = Math.floor(amount_charged_cents * READER_PAYOUT_PERCENT);
  await transferToReader(stripe_account_id, readerAmount);
}

const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const customerId = pi.customer;
      const uRes = await query('select id from users where stripe_customer_id=$1', [customerId]);
      if (uRes.rows.length) await creditWallet(uRes.rows[0].id, pi.amount);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};

module.exports = { stripeRouter, stripeWebhookHandler, creditWallet, debitWallet, settleSessionPayout };
