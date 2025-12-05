const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');
const { debitWallet, settleSessionPayout } = require('./routes/stripe');
const { BILLING_INTERVAL_SECONDS, DISCONNECT_GRACE_SECONDS } = require('./config');

function attachRTC(io) {
  const users = new Map(); // userId -> { socketId, role }
  const sockets = new Map(); // socketId -> userId
  const sessions = new Map(); // sessionId -> state

  io.on('connection', (socket) => {
    socket.on('user:register', ({ userId, role }) => {
      users.set(userId, { socketId: socket.id, role });
      sockets.set(socket.id, userId);
      socket.emit('user:registered');
    });

    socket.on('session:request', async ({ readerId }) => {
      const clientId = sockets.get(socket.id);
      if (!clientId) return;
      const rRes = await query('select id, reader_rate_cents from users where id=$1 and role=$2', [readerId, 'reader']);
      if (!rRes.rows.length) return socket.emit('session:error', { error: 'reader_not_found' });
      const rate = rRes.rows[0].reader_rate_cents;
      const sRes = await query('insert into sessions(client_id, reader_id, status) values ($1,$2,$3) returning id', [clientId, readerId, 'requested']);
      const sessionId = sRes.rows[0].id;
      const reader = users.get(readerId);
      if (reader) io.to(reader.socketId).emit('session:new', { sessionId, clientId });
      socket.emit('session:requested', { sessionId, rate_cents: rate });
    });

    socket.on('session:accept', async ({ sessionId }) => {
      const readerId = sockets.get(socket.id);
      const sRes = await query('select * from sessions where id=$1', [sessionId]);
      const s = sRes.rows[0];
      if (!s || s.reader_id !== readerId) return;
      const roomId = uuidv4();
      await query('update sessions set status=$1, room_id=$2, start_time=now() where id=$3', ['accepted', roomId, sessionId]);
      const state = {
        sessionId,
        roomId,
        clientId: s.client_id,
        readerId,
        rate_cents: (await query('select reader_rate_cents from users where id=$1', [readerId])).rows[0].reader_rate_cents,
        connected: { client: false, reader: false },
        billingTimer: null,
        totalSeconds: 0,
        amountCharged: 0,
        active: true,
        disconnectAt: null
      };
      sessions.set(sessionId, state);
      const client = users.get(s.client_id);
      if (client) {
        io.sockets.sockets.get(client.socketId)?.join(roomId);
        io.to(client.socketId).emit('session:accepted', { sessionId, roomId });
      }
      io.sockets.sockets.get(socket.id)?.join(roomId);
    });

    socket.on('rtc:offer', ({ sessionId, sdp }) => {
      const st = sessions.get(sessionId); if (!st) return;
      socket.to(st.roomId).emit('rtc:offer', { sdp });
    });
    socket.on('rtc:answer', ({ sessionId, sdp }) => {
      const st = sessions.get(sessionId); if (!st) return;
      socket.to(st.roomId).emit('rtc:answer', { sdp });
    });
    socket.on('rtc:ice', ({ sessionId, candidate }) => {
      const st = sessions.get(sessionId); if (!st) return;
      socket.to(st.roomId).emit('rtc:ice', { candidate });
    });

    socket.on('rtc:state', ({ sessionId, role, connected }) => {
      const st = sessions.get(sessionId); if (!st) return;
      st.connected[role] = connected;
      const isConnected = st.connected.client && st.connected.reader;
      if (!isConnected && !st.disconnectAt) {
        st.disconnectAt = Date.now() + DISCONNECT_GRACE_SECONDS * 1000;
        setTimeout(async () => {
          const cur = sessions.get(sessionId);
          if (!cur || !cur.active) return;
          const bothConnected = cur.connected.client && cur.connected.reader;
          if (!bothConnected && cur.disconnectAt && Date.now() >= cur.disconnectAt) {
            io.to(cur.roomId).emit('session:end', { reason: 'disconnected_timeout' });
            if (cur.billingTimer) clearInterval(cur.billingTimer);
            cur.active = false;
            await finalizeSession(cur.sessionId);
          }
        }, DISCONNECT_GRACE_SECONDS * 1000 + 100);
      }
      if (isConnected) {
        st.disconnectAt = null;
      }
      if (isConnected && !st.billingTimer) {
        st.billingTimer = setInterval(async () => {
          if (!st.active) return;
          const bothConnected = st.connected.client && st.connected.reader;
          if (!bothConnected) return;
          st.totalSeconds += BILLING_INTERVAL_SECONDS;
          const ok = await debitWallet(st.clientId, st.rate_cents);
          if (!ok) {
            io.to(st.roomId).emit('session:end', { reason: 'insufficient_balance' });
            clearInterval(st.billingTimer);
            st.active = false;
            await finalizeSession(st.sessionId);
            return;
          }
          st.amountCharged += st.rate_cents;
          const minuteIndex = Math.ceil(st.totalSeconds / BILLING_INTERVAL_SECONDS);
          await query('insert into session_minutes(session_id, minute_index, charged_cents) values ($1,$2,$3)', [st.sessionId, minuteIndex, st.rate_cents]);
          io.to(st.roomId).emit('billing:tick', { minuteIndex, charged_cents: st.rate_cents, total_charged_cents: st.amountCharged });
        }, BILLING_INTERVAL_SECONDS * 1000);
      }
    });

    socket.on('chat:send', async ({ sessionId, message, sender }) => {
      const st = sessions.get(sessionId); if (!st) return;
      try { await query('insert into session_messages(session_id, sender, message) values ($1,$2,$3)', [sessionId, sender, message]); } catch {}
      io.to(st.roomId).emit('chat:message', { message, sender, at: Date.now() });
    });

    socket.on('session:end', async ({ sessionId }) => {
      const st = sessions.get(sessionId); if (!st) return;
      st.active = false;
      if (st.billingTimer) clearInterval(st.billingTimer);
      await finalizeSession(sessionId);
      io.to(st.roomId).emit('session:end', { reason: 'ended_by_user' });
    });

    socket.on('disconnect', async () => {
      const userId = sockets.get(socket.id);
      sockets.delete(socket.id);
      // leave sessions intact to allow reconnection
    });
  });

  async function finalizeSession(sessionId) {
    const st = sessions.get(sessionId);
    if (!st) return;
    await query('update sessions set status=$1, end_time=now(), total_seconds=$2, amount_charged_cents=$3 where id=$4', ['ended', st.totalSeconds, st.amountCharged, sessionId]);
    await settleSessionPayout(sessionId);
    sessions.delete(sessionId);
  }
}

module.exports = { attachRTC };
