const api = {
  base: 'http://localhost:3000'
};

const el = (id) => document.getElementById(id);
let user = null;
let roomId = null;
let gameId = null;
let ws;
let heartbeat;

function logEvent(obj) {
  const pre = el('events');
  let line;
  
  if (typeof obj === 'string') {
    line = obj;
  } else if (obj.type) {
    // Format WebSocket events nicely
    const eventType = obj.type.replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    line = `✓ ${eventType}`;
    if (obj.data) {
      if (obj.data.user) line += ` - ${obj.data.user.username || obj.data.user.id}`;
      if (obj.data.roomId) line += ` (Room ${obj.data.roomId})`;
      if (obj.data.gameId) line += ` (Game ${obj.data.gameId})`;
    }
  } else if (obj.error) {
    line = `✗ ${obj.error}: ${obj.message || ''}`;
  } else {
    line = JSON.stringify(obj, null, 2);
  }
  
  const current = pre.textContent;
  if (current === 'Waiting for events...') {
    pre.textContent = line;
  } else {
    pre.textContent += `\n${line}`;
  }
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
  el('state').innerHTML = s;
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:3000/ws');
  ws.addEventListener('open', () => {
    logEvent('[ws] connected');
  });
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      logEvent(msg);
      const { type, data } = msg;
      if (type === 'room.waiting') {
        setState('Waiting for other player to join...');
      } else if (type === 'room.started') {
        gameId = data.gameId;
        const turnText = data.currentTurn === user?.id ? 'It is your turn.' : 'Wait for your turn.';
        setState(`Room ${data.roomId} started. Turn: ${data.currentTurn}. ${turnText}`);
      } else if (type === 'guess.accepted') {
        setState(`Revealed: ${data.revealed} | Attempts: ${data.remainingAttempts} | Status: ${data.status}`);
      } else if (type === 'turn.changed') {
        const turnText = data.currentTurn === user?.id ? 'It is your turn.' : 'Wait for your turn.';
        setState(`Turn: ${data.currentTurn}. ${turnText}`);
      } else if (type === 'game.won') {
        const winnerText = data.winner === user?.id ? 'You won!' : 'Opponent won.';
        setState(`Winner: ${data.winner}. ${winnerText}`);
      } else if (type === 'game.lost') {
        const word = data.word ? ` The word was: ${data.word}` : '';
        setState(`Game lost.${word}`);
      }
    } catch (e) {
      logEvent('[ws] message parse error');
    }
  });
  ws.addEventListener('close', () => logEvent('[ws] disconnected'));

  // Heartbeat every 30s
  ws.addEventListener('open', () => {
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'ping', nonce: Date.now().toString() }));
      }
    }, 30000);
  });
  ws.addEventListener('close', () => {
    clearInterval(heartbeat);
    heartbeat = null;
  });
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
    user = await post(`${api.base}/users`, { username });
    logEvent(`✓ User Registered - ${user.username} (ID: ${user.id})`);
  } catch (e) {
    logEvent({ error: 'Register Failed', message: String(e) });
  }
});

el('createRoomBtn').addEventListener('click', async () => {
  try {
    const room = await post(`${api.base}/rooms`, { userId: user?.id });
    roomId = room.id;
    el('roomIdInput').value = roomId;
    ensureWs();
    subscribeToRoom(roomId);
    logEvent(`✓ Room Created - Room ${room.number || room.id}`);
  } catch (e) { logEvent({ error: 'Create Room Failed', message: String(e) }); }
});

el('joinRoomBtn').addEventListener('click', async () => {
  try {
    const id = el('roomIdInput').value.trim();
    if (!id) throw new Error('room id required');
    roomId = id;
    await put(`${api.base}/rooms/${roomId}/join`, { userId: user?.id });
    ensureWs();
    subscribeToRoom(roomId);
    logEvent(`✓ Joined Room - ${roomId}`);
  } catch (e) { logEvent({ error: 'Join Room Failed', message: String(e) }); }
});

el('startBtn').addEventListener('click', async () => {
  try {
    const res = await post(`${api.base}/rooms/${roomId}/start`);
    if (res.status === 'waiting-for-opponent') {
      setState('Waiting for other player to join...');
      logEvent('⏳ Waiting For Opponent');
    } else {
      gameId = res.gameId;
      const turnText = res.currentTurn === user?.id ? 'It is your turn.' : 'Wait for your turn.';
      setState(`Room ${roomId} started. Turn: ${res.currentTurn}. ${turnText}`);
      logEvent('✓ Game Started');
    }
  } catch (e) { logEvent({ error: 'Start Game Failed', message: String(e) }); }
});

el('guessBtn').addEventListener('click', async () => {
  try {
    const letter = el('letterInput').value.trim().toLowerCase();
    if (!letter) return;
    const res = await post(`${api.base}/rooms/${roomId}/guess`, { userId: user?.id, letter });
    setState(`Revealed: ${res.revealed} | Attempts: ${res.remainingAttempts} | Status: ${res.status}`);
    logEvent(`✓ Guessed Letter: ${letter.toUpperCase()} - ${res.correct ? 'Correct!' : 'Not in word'}`);
    el('letterInput').value = '';
  } catch (e) { logEvent({ error: 'Guess Failed', message: String(e) }); }
});
