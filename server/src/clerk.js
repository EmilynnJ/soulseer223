const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { CLERK_JWKS_URL, CLERK_SECRET_KEY, CLERK_BACKEND_API_URL, CLERK_JWKS_PUBLIC_KEY, CLERK_FRONTEND_API_URL } = require('./config');

const client = CLERK_JWKS_URL ? jwksClient({ jwksUri: CLERK_JWKS_URL }) : null;

function getKey(header, callback) {
  if (CLERK_JWKS_PUBLIC_KEY) return callback(null, CLERK_JWKS_PUBLIC_KEY);
  if (!client) return callback(new Error('jwks_missing'));
  client.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

async function verifyClerkToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ['RS256'], issuer: CLERK_FRONTEND_API_URL || undefined }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

async function createClerkUser({ email, name }) {
  const res = await fetch(`${CLERK_BACKEND_API_URL}/v1/users`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_address: [email], first_name: name })
  });
  if (!res.ok) throw new Error('clerk_create_error');
  return await res.json();
}

module.exports = { verifyClerkToken, createClerkUser };
