const api = {
  users: 'http://localhost:3001',
  rooms: 'http://localhost:3002',
};

const el = (id) => document.getElementById(id);
let user = null;
let roomId = null;
let gameId = null;
let ws;

function logEvent(obj) {
  const pre = el('events');
  const line = typeof obj === 'string' ? obj : JSON.stringify(obj);
  pre.textContent += `\n${line}`;
  pre.scrollTop = pre.scrollHeight;
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function put(url, body) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function setState(s) {
  el('state').textContent = s;
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:3002/ws');
  ws.addEventListener('open', () => logEvent('[ws] connected'));
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      logEvent(msg);
      const { type, data } = msg;
      if (type === 'room.started') {
        gameId = data.gameId;
        setState(`Room ${data.roomId} started. Turn: ${data.currentTurn}`);
      } else if (type === 'guess.accepted') {
        setState(`Revealed: ${data.revealed} | Attempts: ${data.remainingAttempts} | Status: ${data.status}`);
      } else if (type === 'turn.changed') {
        setState(`Turn: ${data.currentTurn}`);
      } else if (type === 'game.won') {
        setState(`Winner: ${data.winner}`);
      } else if (type === 'game.lost') {
        setState(`Game lost.`);
      }
    } catch (e) {
      logEvent('[ws] message parse error');
    }
  });
  ws.addEventListener('close', () => logEvent('[ws] disconnected'));
}

function subscribeToRoom(id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    ws.addEventListener('open', () => subscribeToRoom(id), { once: true });
    return;
  }
  ws.send(JSON.stringify({ action: 'subscribe', topics: [`room:${id}`] }));
  logEvent({ type: 'subscribed', topic: `room:${id}` });
}

// Wire UI
el('registerBtn').addEventListener('click', async () => {
  const username = el('username').value.trim() || 'Alice';
  try {
    user = await post(`${api.users}/users`, { username });
    logEvent({ type: 'user.registered', user });
  } catch (e) {
    logEvent({ error: 'register failed', message: String(e) });
  }
});

el('createRoomBtn').addEventListener('click', async () => {
  try {
    const room = await post(`${api.rooms}/rooms`);
    roomId = room.id;
    el('roomIdInput').value = roomId;
    ensureWs();
    subscribeToRoom(roomId);
    logEvent({ type: 'room.created', room });
  } catch (e) { logEvent({ error: 'create room failed', message: String(e) }); }
});

el('joinRoomBtn').addEventListener('click', async () => {
  try {
    const id = el('roomIdInput').value.trim();
    if (!id) throw new Error('room id required');
    roomId = id;
    await put(`${api.rooms}/rooms/${roomId}/join`, { userId: user?.id });
    ensureWs();
    subscribeToRoom(roomId);
    logEvent({ type: 'room.join', roomId, user });
  } catch (e) { logEvent({ error: 'join failed', message: String(e) }); }
});

el('startBtn').addEventListener('click', async () => {
  try {
    const res = await post(`${api.rooms}/rooms/${roomId}/start`);
    gameId = res.gameId;
    setState(`Room ${roomId} started. Turn: ${res.currentTurn}`);
    logEvent({ type: 'room.started', res });
  } catch (e) { logEvent({ error: 'start failed', message: String(e) }); }
});

el('guessBtn').addEventListener('click', async () => {
  try {
    const letter = el('letterInput').value.trim().toLowerCase();
    if (!letter) return;
    const res = await post(`${api.rooms}/rooms/${roomId}/guess`, { userId: user?.id, letter });
    setState(`Revealed: ${res.revealed} | Attempts: ${res.remainingAttempts} | Status: ${res.status}`);
    logEvent({ type: 'guess', res });
    el('letterInput').value = '';
  } catch (e) { logEvent({ error: 'guess failed', message: String(e) }); }
});
