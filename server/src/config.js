module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'change-me',
  DATABASE_URL: process.env.DATABASE_URL || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  READER_PAYOUT_PERCENT: Number(process.env.READER_PAYOUT_PERCENT || 0.85)
};
