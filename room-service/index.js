const express = require('express');
const axios = require('axios');
const { WebSocketServer } = require('ws');
const app = express();
const port = 3002;

app.use(express.json());

const rooms = {}; // In-memory room store

// --- Minimal WS hub (subscribe/unsubscribe/ping) ---
const topicSubs = new Map(); // topic => Set<WebSocket>
const wsMeta = new WeakMap(); // ws => { userId?: string, topics: Set<string> }

function subscribe(ws, topic) {
  if (!topicSubs.has(topic)) topicSubs.set(topic, new Set());
  topicSubs.get(topic).add(ws);
  const meta = wsMeta.get(ws) || { topics: new Set() };
  meta.topics.add(topic);
  wsMeta.set(ws, meta);
}

function unsubscribe(ws, topic) {
  if (!topicSubs.has(topic)) return;
  topicSubs.get(topic).delete(ws);
  if (topicSubs.get(topic).size === 0) topicSubs.delete(topic);
  const meta = wsMeta.get(ws);
  if (meta) {
    meta.topics.delete(topic);
    wsMeta.set(ws, meta);
  }
}

function wsSend(ws, msg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch (_) {}
}

function broadcast(topic, type, data) {
  const payload = { type, topic, ts: new Date().toISOString(), data };
  const subs = topicSubs.get(topic);
  if (!subs) return;
  for (const ws of subs) {
    if (ws.readyState === 1) wsSend(ws, payload);
  }
}

// Create a new room
app.post('/rooms', (req, res) => {
  const roomId = Date.now().toString();
  rooms[roomId] = { id: roomId, players: [], status: 'waiting' };
  // Emit room.created on room topic so clients can subscribe early
  broadcast(`room:${roomId}`, 'room.created', { roomId, players: [] , status: 'waiting' });
  res.status(201).send(rooms[roomId]);
});

// Join a room
app.put('/rooms/:id/join', async (req, res) => {
  const { userId } = req.body;
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });

  if (room.players.length >= 2) {
    return res.status(400).send({ error: 'Room is full' });
  }

  try {
    const userRes = await axios.get(`http://localhost:3001/users/${userId}`);
    room.players.push(userRes.data);
    const status = room.players.length === 2 ? 'ready' : 'waiting';
    room.status = status;
    // Emit room.joined so subscribers see player list updates
    broadcast(`room:${room.id}`, 'room.joined', { roomId: room.id, user: userRes.data, players: room.players, status });
    res.send(room);
  } catch (err) {
    res.status(400).send({ error: 'Invalid user ID' });
  }
});

// Get room info
app.get('/rooms/:id', (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });

  res.send(room);
});

// Start a game in a room
app.post('/rooms/:id/start', async (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });

  if (room.players.length < 2) {
    return res.status(400).send({ error: 'Need 2 players to start' });
  }
  if (room.status === 'active') {
    return res.status(409).send({ error: 'Game already started' });
  }

  try {
    const createRes = await axios.post('http://localhost:3003/games', { roomId: room.id });
    const gameId = createRes.data.gameId;
    const starter = Math.random() < 0.5 ? room.players[0] : room.players[1];
    room.gameId = gameId;
    room.currentTurn = starter.id;
    room.status = 'active';

    broadcast(`room:${room.id}`, 'room.started', { roomId: room.id, gameId, currentTurn: room.currentTurn, status: room.status });

    res.send({ roomId: room.id, gameId, currentTurn: room.currentTurn, status: room.status });
  } catch (err) {
    res.status(500).send({ error: 'Failed to create game' });
  }
});

// Make a guess via room (turn validation + proxy to games service)
app.post('/rooms/:id/guess', async (req, res) => {
  const room = rooms[req.params.id];
  const { userId, letter } = req.body || {};
  if (!room) return res.status(404).send({ error: 'Room not found' });
  if (room.status !== 'active' || !room.gameId) return res.status(400).send({ error: 'Game not active' });
  if (!userId || typeof letter !== 'string' || letter.length !== 1 || !/^[a-z]$/i.test(letter)) {
    return res.status(400).send({ error: 'Invalid guess payload' });
  }
  if (room.currentTurn !== userId) {
    // Emit rejection for subscribers
    broadcast(`room:${room.id}`, 'guess.rejected', { roomId: room.id, gameId: room.gameId, userId, letter, reason: 'not-your-turn' });
    return res.status(409).send({ error: 'Not your turn' });
  }

  try {
    const guessRes = await axios.post(`http://localhost:3003/games/${room.gameId}/guess`, { letter: letter.toLowerCase() });
    const result = guessRes.data;

    // Broadcast guess result
    broadcast(`room:${room.id}`, 'guess.accepted', { roomId: room.id, gameId: room.gameId, userId, letter: result.guess, revealed: result.revealed, correct: result.correct, remainingAttempts: result.remainingAttempts, status: result.status });

    if (result.status === 'playing') {
      // Switch turn to the other player
      const other = room.players.find(p => p.id !== userId);
      room.currentTurn = other?.id || room.currentTurn;
      broadcast(`room:${room.id}`, 'turn.changed', { roomId: room.id, gameId: room.gameId, currentTurn: room.currentTurn });
    } else if (result.status === 'won') {
      broadcast(`room:${room.id}`, 'game.won', { roomId: room.id, gameId: room.gameId, winner: userId, revealed: result.revealed, remainingAttempts: result.remainingAttempts });
      room.status = 'finished';
      broadcast(`room:${room.id}`, 'room.finished', { roomId: room.id, reason: 'game-finished' });
    } else if (result.status === 'lost') {
      broadcast(`room:${room.id}`, 'game.lost', { roomId: room.id, gameId: room.gameId, revealed: result.revealed, remainingAttempts: result.remainingAttempts });
      room.status = 'finished';
      broadcast(`room:${room.id}`, 'room.finished', { roomId: room.id, reason: 'game-finished' });
    }

    res.send({ roomId: room.id, gameId: room.gameId, ...result, currentTurn: room.currentTurn, status: room.status === 'finished' ? result.status : 'playing' });
  } catch (err) {
    const msg = err?.response?.data || { error: 'Guess failed' };
    // If letter already guessed or other validation, emit rejection
    broadcast(`room:${room.id}`, 'guess.rejected', { roomId: room.id, gameId: room.gameId, userId, letter, reason: msg.error || 'invalid' });
    res.status(err?.response?.status || 400).send(msg);
  }
});

const server = app.listen(port, () => {
  console.log(`Room Service running on http://localhost:${port}`);
});

// Attach WS server on same HTTP server and gate to /ws path
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.send({ status: 'ok' });
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    const { action, topics = [], nonce, userId } = msg || {};
    if (action === 'subscribe') {
      topics.forEach(t => subscribe(ws, t));
      wsSend(ws, { type: 'subscribed', topics, ts: new Date().toISOString() });
    } else if (action === 'unsubscribe') {
      topics.forEach(t => unsubscribe(ws, t));
      wsSend(ws, { type: 'unsubscribed', topics, ts: new Date().toISOString() });
    } else if (action === 'ping') {
      wsSend(ws, { type: 'pong', nonce, ts: new Date().toISOString() });
    } else if (action === 'identify') {
      const meta = wsMeta.get(ws) || { topics: new Set() };
      meta.userId = userId;
      wsMeta.set(ws, meta);
      wsSend(ws, { type: 'identified', userId, ts: new Date().toISOString() });
    }
  });

  ws.on('close', () => {
    // Clean up subscriptions for this socket
    const meta = wsMeta.get(ws);
    for (const [topic, set] of topicSubs.entries()) {
      if (set.has(ws)) {
        set.delete(ws);
        if (set.size === 0) topicSubs.delete(topic);
      }
    }
    // Emit player.disconnected for room topics if identified
    if (meta && meta.userId) {
      for (const t of meta.topics || []) {
        if (t.startsWith('room:')) {
          const roomId = t.split(':')[1];
          const room = rooms[roomId];
          if (room && room.players.find(p => p.id === meta.userId)) {
            broadcast(`room:${roomId}`, 'player.disconnected', { roomId, userId: meta.userId });
          }
        }
      }
    }
    wsMeta.delete(ws);
  });
});