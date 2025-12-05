const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { JWT_SECRET } = require('../config');

const authRouter = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

async function createTables() {
  await query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      name text not null,
      role text not null check (role in ('client','reader','admin')),
      password_hash text not null,
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

authRouter.post('/register', async (req, res) => {
  try {
    await createTables();
    const { email, name, password, role } = req.body;
    if (!email || !name || !password || !role) return res.status(400).json({ error: 'missing_fields' });
    if (!['client','reader','admin'].includes(role)) return res.status(400).json({ error: 'invalid_role' });
    const existing = await query('select id from users where email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'email_taken' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'insert into users(email,name,role,password_hash) values ($1,$2,$3,$4) returning id, email, name, role',
      [email, name, role, hash]
    );
    const user = result.rows[0];
    await query('insert into wallets(user_id, balance_cents) values ($1, $2)', [user.id, 0]);
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await query('select * from users where email=$1', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'invalid_credentials' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, reader_rate_cents: user.reader_rate_cents } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

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

authRouter.get('/me', authMiddleware, async (req, res) => {
  const result = await query('select id, email, name, role, reader_rate_cents from users where id=$1', [req.user.id]);
  res.json({ user: result.rows[0] });
});

authRouter.get('/readers', authMiddleware, async (req, res) => {
  const result = await query('select id, name, reader_rate_cents from users where role=$1 order by name', ['reader']);
  res.json({ readers: result.rows });
});

module.exports = { authRouter, authMiddleware };
