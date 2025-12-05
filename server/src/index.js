const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
dotenv.config();

const { authRouter, authMiddleware } = require('./routes/auth');
const { stripeRouter, stripeWebhookHandler } = require('./routes/stripe');
const { configRouter } = require('./routes/config');
const { attachRTC } = require('./rtc');
const { attachLive } = require('./live');

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/config', configRouter);
app.post('/api/stripe/webhook', stripeWebhookHandler);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] }
});

attachRTC(io);
attachLive(io);

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
