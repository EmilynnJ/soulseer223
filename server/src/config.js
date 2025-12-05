module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  DATABASE_URL: process.env.DATABASE_URL || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  READER_PAYOUT_PERCENT: Number(process.env.READER_PAYOUT_PERCENT || 0.85),
  BILLING_INTERVAL_SECONDS: Number(process.env.BILLING_INTERVAL_SECONDS || 60),
  TURN_URL: process.env.TURN_URL || '',
  TURN_USERNAME: process.env.TURN_USERNAME || '',
  TURN_PASSWORD: process.env.TURN_PASSWORD || ''
};
