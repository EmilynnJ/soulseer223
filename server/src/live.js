const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');
const { debitWallet } = require('./routes/stripe');

function attachLive(io) {
  const ns = io.of('/live');
  // streamId -> { readerId, title, viewers:Set<clientId>, broadcasterSocket: string }
  const streams = new Map();
  // socket.id -> { streamId?, role: 'broadcaster'|'viewer', clientId? }
  const sockets = new Map();

  ns.on('connection', (socket) => {
    socket.on('live:start', async ({ readerId, title }) => {
      const streamId = uuidv4();
      streams.set(streamId, { readerId, title: title || 'Live', viewers: new Set(), broadcasterSocket: socket.id });
      sockets.set(socket.id, { streamId, role: 'broadcaster' });
      socket.join(streamId);
      socket.emit('live:started', { streamId });
      ns.emit('live:streams', listStreams());
    });

    socket.on('live:list', () => {
      socket.emit('live:streams', listStreams());
    });

    socket.on('live:join', ({ streamId, clientId }) => {
      const s = streams.get(streamId);
      if (!s) return socket.emit('live:error', { error: 'not_found' });
      sockets.set(socket.id, { streamId, role: 'viewer', clientId });
      socket.join(streamId);
      s.viewers.add(clientId || socket.id);
      ns.to(streamId).emit('live:viewer_count', { count: s.viewers.size });
      const bSocket = ns.sockets.get(s.broadcasterSocket);
      if (bSocket) bSocket.emit('live:viewer_joined', { streamId, viewerSocketId: socket.id, clientId });
    });

    socket.on('live:leave', () => {
      const info = sockets.get(socket.id);
      if (!info) return;
      const s = streams.get(info.streamId);
      if (s) {
        s.viewers.delete(info.clientId || socket.id);
        ns.to(info.streamId).emit('live:viewer_count', { count: s.viewers.size });
      }
      socket.leave(info.streamId);
      sockets.delete(socket.id);
    });

    // Chat overlay
    socket.on('live:chat', ({ streamId, sender, message }) => {
      ns.to(streamId).emit('live:chat', { sender, message, at: Date.now() });
    });

    // Gifts (wallet debit)
    socket.on('live:gift', async ({ streamId, clientId, amount_cents }) => {
      const s = streams.get(streamId); if (!s) return;
      const ok = await debitWallet(clientId, amount_cents);
      if (!ok) return socket.emit('live:error', { error: 'insufficient_balance' });
      await query('insert into sessions(reader_id, client_id, status, room_id, amount_charged_cents, total_seconds) values ($1,$2,$3,$4,$5,$6)', [s.readerId, clientId, 'gift', streamId, amount_cents, 0]);
      ns.to(streamId).emit('live:gift', { amount_cents });
    });

    // WebRTC signaling for live streaming (mesh)
    // Viewer sends offer to broadcaster
    socket.on('live:offer', ({ streamId, sdp }) => {
      const s = streams.get(streamId); if (!s) return;
      const to = s.broadcasterSocket;
      ns.to(to).emit('live:offer', { streamId, sdp, viewerSocketId: socket.id });
    });
    // Broadcaster answers back to specific viewer
    socket.on('live:answer', ({ streamId, sdp, to }) => {
      if (!to) return;
      ns.to(to).emit('live:answer', { streamId, sdp });
    });
    // ICE candidates relay
    socket.on('live:ice', ({ streamId, candidate, to }) => {
      if (to) ns.to(to).emit('live:ice', { streamId, candidate });
      else {
        const s = streams.get(streamId); if (!s) return;
        // from viewer to broadcaster
        ns.to(s.broadcasterSocket).emit('live:ice', { streamId, candidate, viewerSocketId: socket.id });
      }
    });

    socket.on('live:end', ({ streamId }) => {
      const s = streams.get(streamId);
      if (s && s.broadcasterSocket === socket.id) {
        ns.to(streamId).emit('live:end');
        streams.delete(streamId);
        ns.emit('live:streams', listStreams());
      }
    });

    socket.on('disconnect', () => {
      const info = sockets.get(socket.id);
      if (!info) return;
      if (info.role === 'broadcaster') {
        const s = streams.get(info.streamId);
        if (s) {
          ns.to(info.streamId).emit('live:end');
          streams.delete(info.streamId);
          ns.emit('live:streams', listStreams());
        }
      } else if (info.role === 'viewer') {
        const s = streams.get(info.streamId);
        if (s) {
          s.viewers.delete(info.clientId || socket.id);
          ns.to(info.streamId).emit('live:viewer_count', { count: s.viewers.size });
        }
      }
      sockets.delete(socket.id);
    });
  });

  function listStreams() {
    const arr = [];
    for (const [id, s] of streams.entries()) {
      arr.push({ streamId: id, readerId: s.readerId, title: s.title, viewers: s.viewers.size });
    }
    return arr;
  }
}

module.exports = { attachLive };
