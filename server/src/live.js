const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');
const { debitWallet, settleSessionPayout } = require('./routes/stripe');

function attachLive(io) {
  const ns = io.of('/live');
  const streams = new Map(); // streamId -> { readerId, title, viewers:Set }

  ns.on('connection', (socket) => {
    socket.on('live:start', async ({ readerId, title }) => {
      const streamId = uuidv4();
      streams.set(streamId, { readerId, title, viewers: new Set() });
      socket.join(streamId);
      socket.emit('live:started', { streamId });
    });
    socket.on('live:join', ({ streamId, clientId }) => {
      socket.join(streamId);
      const s = streams.get(streamId); if (s) s.viewers.add(clientId);
      ns.to(streamId).emit('live:viewer_count', { count: streams.get(streamId)?.viewers.size || 0 });
    });
    socket.on('live:chat', ({ streamId, sender, message }) => {
      ns.to(streamId).emit('live:chat', { sender, message, at: Date.now() });
    });
    socket.on('live:gift', async ({ streamId, clientId, amount_cents }) => {
      const s = streams.get(streamId); if (!s) return;
      const ok = await debitWallet(clientId, amount_cents);
      if (!ok) return socket.emit('live:error', { error: 'insufficient_balance' });
      await query('insert into sessions(reader_id, client_id, status, room_id, amount_charged_cents, total_seconds) values ($1,$2,$3,$4,$5,$6)', [s.readerId, clientId, 'gift', streamId, amount_cents, 0]);
      ns.to(streamId).emit('live:gift', { amount_cents });
    });
    socket.on('live:end', ({ streamId }) => {
      ns.to(streamId).emit('live:end');
      streams.delete(streamId);
    });
  });
}

module.exports = { attachLive };
