const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { JWT_SECRET } = require('../config');
const { verifyClerkToken, createClerkUser } = require('../clerk');

const authRouter = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

async function createTables() {
  await query(`
    create extension if not exists pgcrypto;
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      name text not null,
      role text not null check (role in ('client','reader','admin')),
      password_hash text not null,
      clerk_user_id text unique,
      stripe_customer_id text,
      stripe_account_id text,
      reader_rate_cents integer default 200,
      created_at timestamptz default now()
    );
    create table if not exists wallets (
      user_id uuid primary key references users(id) on delete cascade,
      balance_cents integer not null default 0,
      updated_at timestamptz default now()
    );
    create table if not exists sessions (
      id uuid primary key default gen_random_uuid(),
      room_id text,
      client_id uuid references users(id),
      reader_id uuid references users(id),
      status text not null,
      start_time timestamptz,
      end_time timestamptz,
      total_seconds integer default 0,
      amount_charged_cents integer default 0,
      created_at timestamptz default now()
    );
    create table if not exists session_minutes (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references sessions(id) on delete cascade,
      minute_index integer not null,
      charged_cents integer not null,
      timestamp timestamptz default now()
    );
  `);
}

// Clerk-authenticated request middleware
async function clerkAuthMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    let token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      const cookies = req.headers.cookie || '';
      const m = cookies.match(/(?:^|;\s*)__session=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const decoded = await verifyClerkToken(token);
    req.clerkUserId = decoded.sub;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

authRouter.get('/me', clerkAuthMiddleware, async (req, res) => {
  await createTables();
  const u = await query('select id, email, name, role, reader_rate_cents from users where clerk_user_id=$1', [req.clerkUserId]);
  if (!u.rows.length) {
    // Auto-provision as client only
    const inserted = await query('insert into users(email,name,role,clerk_user_id,password_hash) values ($1,$2,$3,$4,$5) returning id, email, name, role, reader_rate_cents', ['client@unknown', 'Client', 'client', req.clerkUserId, '']);
    const user = inserted.rows[0];
    await query('insert into wallets(user_id, balance_cents) values ($1, $2)', [user.id, 0]);
    return res.json({ user });
  }
  return res.json({ user: u.rows[0] });
});

authRouter.get('/wallet', clerkAuthMiddleware, async (req, res) => {
  const u = await query('select id from users where clerk_user_id=$1', [req.clerkUserId]);
  const w = await query('select balance_cents from wallets where user_id=$1', [u.rows[0].id]);
  res.json({ balance_cents: w.rows[0]?.balance_cents ?? 0 });
});

authRouter.get('/readers', clerkAuthMiddleware, async (req, res) => {
  const result = await query('select id, name, reader_rate_cents from users where role=$1 order by name', ['reader']);
  res.json({ readers: result.rows });
});

authRouter.post('/admin/create-reader', clerkAuthMiddleware, async (req, res) => {
  const adminRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  const role = adminRes.rows[0]?.role;
  if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const { email, name, rate_cents } = req.body;
  if (!email || !name || !rate_cents) return res.status(400).json({ error: 'missing_fields' });
  const clerkUser = await createClerkUser({ email, name });
  const clerkId = clerkUser.id;
  const existing = await query('select id from users where clerk_user_id=$1', [clerkId]);
  if (existing.rows.length) return res.status(409).json({ error: 'reader_exists' });
  const inserted = await query('insert into users(email,name,role,clerk_user_id,reader_rate_cents,password_hash) values ($1,$2,$3,$4,$5,$6) returning id, email, name, role, reader_rate_cents', [email, name, 'reader', clerkId, rate_cents, '']);
  await query('insert into wallets(user_id, balance_cents) values ($1, $2)', [inserted.rows[0].id, 0]);
  res.json({ reader: inserted.rows[0] });
});

module.exports = { authRouter, authMiddleware: clerkAuthMiddleware };
