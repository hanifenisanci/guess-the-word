const express = require('express');
const axios = require('axios');
const { WebSocketServer } = require('ws');
const app = express();
const port = 3002;

app.use(express.json());

const rooms = {}; // In-memory room store

// --- Minimal WS hub (subscribe/unsubscribe/ping) ---
const topicSubs = new Map(); // topic => Set<WebSocket>

function subscribe(ws, topic) {
  if (!topicSubs.has(topic)) topicSubs.set(topic, new Set());
  topicSubs.get(topic).add(ws);
}

function unsubscribe(ws, topic) {
  if (!topicSubs.has(topic)) return;
  topicSubs.get(topic).delete(ws);
  if (topicSubs.get(topic).size === 0) topicSubs.delete(topic);
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
  rooms[roomId] = { id: roomId, players: [] };
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
    const { action, topics = [], nonce } = msg || {};
    if (action === 'subscribe') {
      topics.forEach(t => subscribe(ws, t));
      wsSend(ws, { type: 'subscribed', topics, ts: new Date().toISOString() });
    } else if (action === 'unsubscribe') {
      topics.forEach(t => unsubscribe(ws, t));
      wsSend(ws, { type: 'unsubscribed', topics, ts: new Date().toISOString() });
    } else if (action === 'ping') {
      wsSend(ws, { type: 'pong', nonce, ts: new Date().toISOString() });
    }
  });

  ws.on('close', () => {
    // Clean up subscriptions for this socket
    for (const [topic, set] of topicSubs.entries()) {
      if (set.has(ws)) {
        set.delete(ws);
        if (set.size === 0) topicSubs.delete(topic);
      }
    }
  });
});