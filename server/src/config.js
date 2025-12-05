function normalizeDatabaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.NEON_DATABASE_CONNECTION_STRING || '';
  if (!raw) return '';
  // Allow formats like: psql 'postgresql://user:pass@host/db?sslmode=require'
  const m = raw.match(/postgresql:\/\/[^']+/);
  return m ? m[0] : raw;
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  DATABASE_URL: normalizeDatabaseUrl(),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLIC_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SIGNING_SECRET || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  READER_PAYOUT_PERCENT: Number(process.env.READER_PAYOUT_PERCENT || 0.85),
  BILLING_INTERVAL_SECONDS: Number(process.env.BILLING_INTERVAL_SECONDS || 60),
  DISCONNECT_GRACE_SECONDS: Number(process.env.DISCONNECT_GRACE_SECONDS || 60),
  TURN_URL: process.env.TURN_URL || '',
  TURN_USERNAME: process.env.TURN_USERNAME || '',
  TURN_PASSWORD: process.env.TURN_PASSWORD || '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || '',
  CLERK_FRONTEND_API_URL: process.env.CLERK_FRONTEND_API_URL || '',
  CLERK_BACKEND_API_URL: process.env.CLERK_BACKEND_API_URL || '',
  CLERK_JWKS_URL: process.env.CLERK_JWKS_URL || '',
  CLERK_JWKS_PUBLIC_KEY: process.env.CLERK_JWKS_PUBLIC_KEY || ''
};
