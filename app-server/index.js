const express = require('express');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;
app.use(express.json());

// In-memory stores
const users = {}; // id -> { id, username }
const rooms = {}; // id -> { id, number, players: [user], status, currentTurn?, gameId? }
let nextRoomNumber = 1;
const games = {}; // id -> { id, word, guessedLetters: [], remainingAttempts, status }

// Dictionary
const dictPath = path.resolve(__dirname, '..', 'words.txt');
const words = fs.readFileSync(dictPath, 'utf-8')
  .split('\n')
  .map(w => w.trim())
  .filter(w => w.length >= 4);

// --- WS hub ---
const topicSubs = new Map(); // topic -> Set<ws>
function broadcast(topic, type, data) {
  const subs = topicSubs.get(topic);
  if (!subs) return;
  const payload = { type, topic, ts: new Date().toISOString(), data };
  for (const ws of subs) {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  }
}

// HTTP endpoints
app.get('/health', (_req, res) => res.send({ status: 'ok' }));

// Users
app.post('/users', (req, res) => {
  const username = req.body.username || req.body.name;
  if (!username) return res.status(400).send({ error: 'username is required' });
  const id = Date.now().toString();
  users[id] = { id, username };
  res.status(201).send(users[id]);
});

app.get('/users/:id', (req, res) => {
  const u = users[req.params.id];
  if (!u) return res.status(404).send({ error: 'User not found' });
  res.send(u);
});

// Rooms
app.post('/rooms', (_req, res) => {
  const id = Date.now().toString();
  const number = nextRoomNumber++;
  rooms[id] = { id, number, players: [], status: 'waiting' };
  broadcast(`room:${id}`, 'room.created', { roomId: id, number, players: [], status: 'waiting' });
  res.status(201).send(rooms[id]);
});

// List all rooms for lobby selection
app.get('/rooms', (_req, res) => {
  const list = Object.values(rooms).map(r => ({ id: r.id, number: r.number, players: r.players.map(p => p.id), status: r.status }));
  list.sort((a, b) => (a.number || 0) - (b.number || 0));
  res.send({ rooms: list });
});

app.put('/rooms/:id/join', (req, res) => {
  const { userId } = req.body || {};
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });
  const u = users[userId];
  if (!u) return res.status(400).send({ error: 'Invalid user ID' });
  if (room.players.find(p => p.id === userId)) {
    return res.status(409).send({ error: 'Already joined' });
  }
  if (room.players.length >= 2) return res.status(400).send({ error: 'Room is full' });
  room.players.push(u);
  room.status = room.players.length === 2 ? 'ready' : 'waiting';
  broadcast(`room:${room.id}`, 'room.joined', { roomId: room.id, number: room.number, user: u, players: room.players, status: room.status });
  if (room.players.length === 2 && room.startRequested && room.status !== 'active' && !room.gameId) {
    const gameId = Date.now().toString();
    const word = words[Math.floor(Math.random() * words.length)];
    games[gameId] = { id: gameId, word, guessedLetters: [], remainingAttempts: 6, status: 'playing' };
    const starter = Math.random() < 0.5 ? room.players[0] : room.players[1];
    room.gameId = gameId;
    room.currentTurn = starter.id;
    room.status = 'active';
    broadcast(`room:${room.id}`, 'room.started', { roomId: room.id, gameId, currentTurn: room.currentTurn, status: room.status });
  }
  res.send(room);
});

app.get('/rooms/:id', (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });
  res.send(room);
});

app.post('/rooms/:id/start', (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });
  if (room.players.length < 2) {
    room.startRequested = true;
    room.status = 'waiting-start';
    broadcast(`room:${room.id}`, 'room.waiting', { roomId: room.id, status: room.status });
    return res.send({ roomId: room.id, status: 'waiting-for-opponent' });
  }
  if (room.status === 'active') {
    // If game already active, return current game info so clients can proceed
    return res.send({ roomId: room.id, gameId: room.gameId, currentTurn: room.currentTurn, status: room.status });
  }
  const gameId = Date.now().toString();
  const word = words[Math.floor(Math.random() * words.length)];
  games[gameId] = { id: gameId, word, guessedLetters: [], remainingAttempts: 6, status: 'playing' };
  const starter = Math.random() < 0.5 ? room.players[0] : room.players[1];
  room.gameId = gameId;
  room.currentTurn = starter.id;
  room.status = 'active';
  broadcast(`room:${room.id}`, 'room.started', { roomId: room.id, gameId, currentTurn: room.currentTurn, status: room.status });
  res.send({ roomId: room.id, gameId, currentTurn: room.currentTurn, status: room.status });
});

app.post('/rooms/:id/guess', (req, res) => {
  const { userId, letter } = req.body || {};
  const room = rooms[req.params.id];
  if (!room) return res.status(404).send({ error: 'Room not found' });
  if (room.status !== 'active' || !room.gameId) return res.status(400).send({ error: 'Game not active' });
  if (!userId || typeof letter !== 'string' || letter.length !== 1 || !/^[a-z]$/i.test(letter)) {
    return res.status(400).send({ error: 'Invalid guess payload' });
  }
  if (room.currentTurn !== userId) {
    broadcast(`room:${room.id}`, 'guess.rejected', { roomId: room.id, gameId: room.gameId, userId, letter, reason: 'not-your-turn' });
    return res.status(409).send({ error: 'Not your turn' });
  }
  const game = games[room.gameId];
  if (!game || game.status !== 'playing') return res.status(400).send({ error: 'Invalid game' });
  const ltr = letter.toLowerCase();
  if (game.guessedLetters.includes(ltr)) {
    broadcast(`room:${room.id}`, 'guess.rejected', { roomId: room.id, gameId: room.gameId, userId, letter, reason: 'already-guessed' });
    return res.status(400).send({ error: 'Letter already guessed' });
  }
  game.guessedLetters.push(ltr);
  const correct = game.word.includes(ltr);
  if (!correct) game.remainingAttempts -= 1;
  const revealed = game.word.split('').map(c => game.guessedLetters.includes(c) ? c : '_').join('');
  if (revealed === game.word) game.status = 'won';
  else if (game.remainingAttempts <= 0) game.status = 'lost';

  broadcast(`room:${room.id}`, 'guess.accepted', { roomId: room.id, gameId: room.gameId, userId, letter: ltr, revealed, correct, remainingAttempts: game.remainingAttempts, status: game.status });

  if (game.status === 'playing') {
    const other = room.players.find(p => p.id !== userId);
    room.currentTurn = other ? other.id : room.currentTurn;
    broadcast(`room:${room.id}`, 'turn.changed', { roomId: room.id, gameId: room.gameId, currentTurn: room.currentTurn });
  } else if (game.status === 'won') {
    broadcast(`room:${room.id}`, 'game.won', { roomId: room.id, gameId: room.gameId, winner: userId, revealed, remainingAttempts: game.remainingAttempts });
    room.status = 'finished';
    broadcast(`room:${room.id}`, 'room.finished', { roomId: room.id, reason: 'game-finished' });
  } else if (game.status === 'lost') {
    broadcast(`room:${room.id}`, 'game.lost', { roomId: room.id, gameId: room.gameId, revealed, remainingAttempts: game.remainingAttempts, word: game.word });
    room.status = 'finished';
    broadcast(`room:${room.id}`, 'room.finished', { roomId: room.id, reason: 'game-finished' });
  }

  const response = { revealed, remainingAttempts: game.remainingAttempts, status: game.status, correct, guess: ltr, currentTurn: room.currentTurn };
  if (game.status === 'lost') response.word = game.word;
  res.send(response);
});

// Games
app.get('/games/:id', (req, res) => {
  const game = games[req.params.id];
  if (!game) return res.status(404).send({ error: 'Game not found' });
  const revealed = game.word.split('').map(c => game.guessedLetters.includes(c) ? c : '_').join('');
  const body = { revealed, remainingAttempts: game.remainingAttempts, status: game.status, guessedLetters: game.guessedLetters };
  if (game.status === 'lost') body.word = game.word;
  res.send(body);
});

// Start HTTP server and attach WS at /ws
const server = app.listen(port, () => {
  console.log(`App Server running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { action, topics = [], nonce } = msg || {};
    if (action === 'subscribe') {
      topics.forEach(t => {
        if (!topicSubs.has(t)) topicSubs.set(t, new Set());
        topicSubs.get(t).add(ws);
      });
      ws.send(JSON.stringify({ type: 'subscribed', topics, ts: new Date().toISOString() }));
    } else if (action === 'unsubscribe') {
      topics.forEach(t => {
        const set = topicSubs.get(t);
        if (set) { set.delete(ws); if (set.size === 0) topicSubs.delete(t); }
      });
      ws.send(JSON.stringify({ type: 'unsubscribed', topics, ts: new Date().toISOString() }));
    } else if (action === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', nonce, ts: new Date().toISOString() }));
    }
  });
  ws.on('close', () => {
    for (const [t, set] of topicSubs.entries()) {
      if (set.has(ws)) { set.delete(ws); if (set.size === 0) topicSubs.delete(t); }
    }
  });
});
