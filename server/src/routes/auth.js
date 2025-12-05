const express = require('express');
const fs = require('fs');
const path = require('path');
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
      avatar_url text,
      bio text,
      specialties text,
      created_at timestamptz default now()
    );
    create table if not exists wallets (
      user_id uuid primary key references users(id) on delete cascade,
      balance_cents integer not null default 0,
      updated_at timestamptz default now()
    );
    create table if not exists wallet_ledger (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references users(id) on delete cascade,
      type text not null check (type in ('credit','debit','refund')),
      amount_cents integer not null,
      source text,
      meta jsonb,
      created_at timestamptz default now()
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
    create table if not exists session_messages (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references sessions(id) on delete cascade,
      sender text not null,
      message text not null,
      created_at timestamptz default now()
    );
    create table if not exists ratings (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references sessions(id) on delete cascade,
      client_id uuid references users(id),
      reader_id uuid references users(id),
      rating integer not null check (rating between 1 and 5),
      comment text,
      created_at timestamptz default now()
    );
    create table if not exists disputes (
      id uuid primary key default gen_random_uuid(),
      session_id uuid references sessions(id) on delete cascade,
      user_id uuid references users(id),
      reason text not null,
      status text not null default 'open',
      created_at timestamptz default now()
    );
    create table if not exists reader_applications (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      name text not null,
      bio text,
      experience_years integer,
      specialties text,
      rate_cents integer default 200,
      timezone text,
      availability text,
      status text not null default 'submitted',
      reader_user_id uuid,
      created_at timestamptz default now()
    );
    create table if not exists support_tickets (
      id uuid primary key default gen_random_uuid(),
      user_id uuid references users(id) on delete cascade,
      subject text not null,
      message text not null,
      status text not null default 'open',
      created_at timestamptz default now()
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

authRouter.get('/readers', async (req, res) => {
  const result = await query(`
    select u.id, u.name, u.reader_rate_cents,
           coalesce(round(avg(r.rating)::numeric,2), 0) as avg_rating,
           count(r.id) as ratings_count
    from users u
    left join ratings r on r.reader_id = u.id
    where u.role = 'reader'
    group by u.id
    order by u.name
  `);
  res.json({ readers: result.rows });
});

// Submit rating (clients only) after session ended
authRouter.post('/ratings', clerkAuthMiddleware, async (req, res) => {
  const uRes = await query('select id, role from users where clerk_user_id=$1', [req.clerkUserId]);
  const me = uRes.rows[0];
  if (!me || me.role !== 'client') return res.status(403).json({ error: 'forbidden' });
  const { session_id, rating, comment } = req.body;
  if (!session_id || !rating) return res.status(400).json({ error: 'missing_fields' });
  const sRes = await query('select id, client_id, reader_id, status from sessions where id=$1', [session_id]);
  const s = sRes.rows[0];
  if (!s || s.client_id !== me.id) return res.status(404).json({ error: 'session_not_found' });
  if (s.status !== 'ended') return res.status(400).json({ error: 'session_not_ended' });
  const ins = await query('insert into ratings(session_id, client_id, reader_id, rating, comment) values ($1,$2,$3,$4,$5) returning id, rating, comment, created_at', [session_id, me.id, s.reader_id, rating, comment || '']);
  res.json({ rating: ins.rows[0] });
});

// Transcript fetch (client, reader, or admin)
authRouter.get('/sessions/:id/transcript', clerkAuthMiddleware, async (req, res) => {
  const uRes = await query('select id, role from users where clerk_user_id=$1', [req.clerkUserId]);
  const me = uRes.rows[0];
  const sessionId = req.params.id;
  const sRes = await query('select id, client_id, reader_id from sessions where id=$1', [sessionId]);
  const s = sRes.rows[0];
  if (!s) return res.status(404).json({ error: 'session_not_found' });
  const allowed = me && (me.role === 'admin' || me.id === s.client_id || me.id === s.reader_id);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  const msgs = await query('select sender, message, created_at from session_messages where session_id=$1 order by created_at', [sessionId]);
  res.json({ messages: msgs.rows });
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
authRouter.post('/apply-reader', async (req, res) => {
  const { email, name, bio, experience_years, specialties, rate_cents, timezone, availability } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'missing_fields' });
  const existing = await query('select id from reader_applications where email=$1 and status <> $2', [email, 'rejected']);
  if (existing.rows.length) return res.status(409).json({ error: 'already_applied' });
  const ins = await query('insert into reader_applications(email,name,bio,experience_years,specialties,rate_cents,timezone,availability) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, status', [email, name, bio || '', experience_years || 0, specialties || '', rate_cents || 200, timezone || '', availability || '']);
  res.json({ application: ins.rows[0] });
});

authRouter.get('/admin/reader-applications', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const rows = await query('select * from reader_applications order by created_at desc');
  res.json({ applications: rows.rows });
});

authRouter.post('/admin/reader-applications/:id/approve', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  const appRes = await query('select * from reader_applications where id=$1', [id]);
  const app = appRes.rows[0];
  if (!app) return res.status(404).json({ error: 'not_found' });
  const clerkUser = await createClerkUser({ email: app.email, name: app.name });
  const clerkId = clerkUser.id;
  const exists = await query('select id from users where clerk_user_id=$1', [clerkId]);
  if (exists.rows.length) return res.status(409).json({ error: 'reader_exists' });
  const rate = app.rate_cents || 200;
  const inserted = await query('insert into users(email,name,role,clerk_user_id,reader_rate_cents,password_hash) values ($1,$2,$3,$4,$5,$6) returning id, email, name, role, reader_rate_cents', [app.email, app.name, 'reader', clerkId, rate, '']);
  await query('insert into wallets(user_id, balance_cents) values ($1, $2)', [inserted.rows[0].id, 0]);
  await query('update reader_applications set status=$1, reader_user_id=$2 where id=$3', ['approved', inserted.rows[0].id, id]);
  res.json({ application: { id, status: 'approved' }, reader: inserted.rows[0] });
});
authRouter.get('/admin/users', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const rows = await query('select id, email, name, role, reader_rate_cents, avatar_url from users order by created_at desc');
  res.json({ users: rows.rows });
});

authRouter.post('/admin/readers/:id/update', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  const { name, rate_cents, avatar_url, bio, specialties } = req.body;
  const uRes = await query('update users set name=coalesce($1,name), reader_rate_cents=coalesce($2,reader_rate_cents), avatar_url=coalesce($3,avatar_url), bio=coalesce($4,bio), specialties=coalesce($5,specialties) where id=$6 and role=$7 returning id, email, name, role, reader_rate_cents, avatar_url, bio, specialties', [name, rate_cents, avatar_url, bio, specialties, id, 'reader']);
  if (!uRes.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ reader: uRes.rows[0] });
});
authRouter.post('/admin/readers/:id/avatar', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  const { data_url } = req.body || {};
  if (!data_url || typeof data_url !== 'string') return res.status(400).json({ error: 'missing_data' });
  if (!data_url.startsWith('data:image/')) return res.status(400).json({ error: 'invalid_type' });
  try {
    const m = data_url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid_data' });
    const mime = m[1];
    const b64 = m[2];
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'file_too_large' });
    const ext = mime.includes('png') ? '.png' : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : mime.includes('webp') ? '.webp' : '';
    if (!ext) return res.status(400).json({ error: 'unsupported_format' });
    const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${id}-${Date.now()}${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buf);
    const publicUrl = `/uploads/avatars/${filename}`;
    const uRes = await query('update users set avatar_url=$1 where id=$2 and role=$3 returning id, email, name, role, reader_rate_cents, avatar_url, bio, specialties', [publicUrl, id, 'reader']);
    if (!uRes.rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ reader: uRes.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'upload_failed' });
  }
});

authRouter.post('/support/tickets', clerkAuthMiddleware, async (req, res) => {
  const uRes = await query('select id from users where clerk_user_id=$1', [req.clerkUserId]);
  const me = uRes.rows[0];
  const { subject, message } = req.body || {};
  if (!me || !subject || !message) return res.status(400).json({ error: 'missing_fields' });
  const ins = await query('insert into support_tickets(user_id, subject, message) values ($1,$2,$3) returning id, subject, message, status, created_at', [me.id, subject, message]);
  res.json({ ticket: ins.rows[0] });
});

authRouter.get('/admin/support/tickets', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const rows = await query('select st.id, st.subject, st.message, st.status, st.created_at, st.user_id, u.email, u.name from support_tickets st join users u on u.id=st.user_id order by st.created_at desc');
  res.json({ tickets: rows.rows });
});

authRouter.post('/admin/support/tickets/:id/status', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'missing_fields' });
  const u = await query('update support_tickets set status=$1 where id=$2 returning id, subject, message, status, created_at', [status, id]);
  if (!u.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ticket: u.rows[0] });
});

authRouter.get('/admin/ledger', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const rows = await query('select wl.id, wl.user_id, u.email, u.name, wl.type, wl.amount_cents, wl.source, wl.created_at from wallet_ledger wl join users u on u.id=wl.user_id order by wl.created_at desc limit 500');
  res.json({ ledger: rows.rows });
});

authRouter.post('/admin/refund', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const { user_id, amount_cents, reason } = req.body;
  if (!user_id || !amount_cents) return res.status(400).json({ error: 'missing_fields' });
  await query('update wallets set balance_cents = balance_cents + $1, updated_at=now() where user_id=$2', [amount_cents, user_id]);
  await query('insert into wallet_ledger(user_id,type,amount_cents,source,meta) values ($1,$2,$3,$4,$5)', [user_id, 'refund', amount_cents, 'admin_refund', JSON.stringify({ reason })]);
  res.json({ ok: true });
});

authRouter.get('/admin/disputes', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const rows = await query('select * from disputes order by created_at desc');
  res.json({ disputes: rows.rows });
});

authRouter.post('/admin/disputes/:id/status', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  const { status } = req.body;
  const dRes = await query('update disputes set status=$1 where id=$2 returning id, status', [status, id]);
  if (!dRes.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ dispute: dRes.rows[0] });
});

authRouter.get('/admin/metrics', clerkAuthMiddleware, async (req, res) => {
  const roleRes = await query('select role from users where clerk_user_id=$1', [req.clerkUserId]);
  if (roleRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const usersCount = await query("select count(*) from users");
  const readersCount = await query("select count(*) from users where role='reader'");
  const sessionsCount = await query("select count(*) from sessions");
  const revenue = await query("select coalesce(sum(case when type='debit' then amount_cents end),0) as total from wallet_ledger");
  const refunds = await query("select coalesce(sum(case when type='refund' then amount_cents end),0) as total from wallet_ledger");
  res.json({ users: Number(usersCount.rows[0].count), readers: Number(readersCount.rows[0].count), sessions: Number(sessionsCount.rows[0].count), revenue_cents: Number(revenue.rows[0].total), refunds_cents: Number(refunds.rows[0].total) });
});
