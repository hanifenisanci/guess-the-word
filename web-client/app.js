const api = {
  base: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : 'http://192.168.1.143:3000'
};

const el = (id) => document.getElementById(id);
let user = null;
let roomId = null;
let gameId = null;
let ws;
let heartbeat;
let guessedLetters = [];

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
  const wsUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'ws://localhost:3000/ws'
    : 'ws://192.168.1.143:3000/ws';
  ws = new WebSocket(wsUrl);
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
        guessedLetters = [];
        el('lettersList').textContent = 'None yet';
        const turnText = data.currentTurn === user?.id ? '🎯 It is your turn!' : '⏳ Wait for your turn';
        const wordPattern = data.revealed || '____';
        el('wordDisplay').textContent = wordPattern.split('').join(' ');
        setState(turnText);
      } else if (type === 'guess.accepted') {
        // Track guessed letter
        if (data.letter && !guessedLetters.includes(data.letter.toLowerCase())) {
          guessedLetters.push(data.letter.toLowerCase());
          el('lettersList').textContent = guessedLetters.map(l => l.toUpperCase()).join(', ');
        }
        
        // Update word display
        if (data.revealed) {
          el('wordDisplay').textContent = data.revealed.split('').join(' ');
        }
        
        if (data.status === 'won') {
          const winnerText = data.userId === user?.id ? '🎉 You won!' : '😔 Opponent won';
          setState(winnerText);
        } else if (data.status === 'lost') {
          setState(`💀 Game Over`);
        } else {
          const turnText = data.status === 'playing' ? (data.currentTurn === user?.id ? '🎯 Your turn' : '⏳ Waiting') : '';
          setState(`${turnText} | Attempts: ${data.remainingAttempts}`);
        }
      } else if (type === 'turn.changed') {
        const turnText = data.currentTurn === user?.id ? '🎯 It is your turn!' : '⏳ Wait for your turn';
        setState(turnText);
      } else if (type === 'game.won') {
        const winnerText = data.winner === user?.id ? '🎉 You won!' : '😔 Opponent won';
        if (data.revealed) el('wordDisplay').textContent = data.revealed.split('').join(' ');
        setState(winnerText);
      } else if (type === 'game.lost') {
        const word = data.word || data.revealed || '???';
        el('wordDisplay').textContent = word.split('').join(' ');
        setState(`💀 Game Over`);
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
  logEvent(`✓ Subscribed To Room - ${id}`);
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
    if (!user?.id) {
      logEvent({ error: 'Register First', message: 'Please register before creating a room' });
      return;
    }
    const room = await post(`${api.base}/rooms`, { userId: user?.id });
    roomId = room.id;
    el('roomIdInput').value = roomId;
    ensureWs();
    subscribeToRoom(roomId);
    logEvent(`✓ Room Created - Room ${room.number || room.id} - You are joined`);
  } catch (e) { logEvent({ error: 'Create Room Failed', message: String(e) }); }
});

el('joinRoomBtn').addEventListener('click', async () => {
  try {
    if (!user?.id) {
      logEvent({ error: 'Register First', message: 'Please register before joining a room' });
      return;
    }
    const id = el('roomIdInput').value.trim();
    if (!id) throw new Error('room id required');
    roomId = id;
    const room = await put(`${api.base}/rooms/${roomId}/join`, { userId: user?.id });
    ensureWs();
    subscribeToRoom(roomId);
    logEvent(`✓ Joined Room - ${roomId} - ${room.players?.length || 0} players`);
  } catch (e) { logEvent({ error: 'Join Room Failed', message: String(e) }); }
});

el('startBtn').addEventListener('click', async () => {
  try {
    if (!roomId) {
      logEvent({ error: 'No Room', message: 'Please create or join a room first' });
      return;
    }
    const res = await post(`${api.base}/rooms/${roomId}/start`);
    if (res.status === 'waiting-for-opponent') {
      setState('⏳ Waiting for other player to join...');
      logEvent('⏳ Waiting For Opponent - Need 2 players to start');
    } else {
      gameId = res.gameId;
      guessedLetters = [];
      el('lettersList').textContent = 'None yet';
      const turnText = res.currentTurn === user?.id ? '🎯 It is your turn!' : '⏳ Wait for your turn';
      const wordLength = res.revealed ? res.revealed.length : 4;
      el('wordDisplay').textContent = '_'.repeat(wordLength).split('').join(' ');
      setState(turnText);
      logEvent('✓ Game Started - Both players ready!');
    }
  } catch (e) { logEvent({ error: 'Start Game Failed', message: String(e) }); }
});

async function makeGuess() {
  try {
    const letter = el('letterInput').value.trim().toLowerCase();
    if (!letter) {
      logEvent({ error: 'Empty Input', message: 'Please enter a letter' });
      return;
    }
    if (!/^[a-z]$/i.test(letter)) {
      logEvent({ error: 'Invalid Input', message: 'Please enter a single letter (a-z)' });
      return;
    }
    if (!gameId || !roomId) {
      logEvent({ error: 'No Active Game', message: 'Please start a game first' });
      return;
    }
    const res = await post(`${api.base}/rooms/${roomId}/guess`, { userId: user?.id, letter });
    
    // Track guessed letter locally (will also be updated via WebSocket)
    if (!guessedLetters.includes(letter)) {
      guessedLetters.push(letter);
      el('lettersList').textContent = guessedLetters.map(l => l.toUpperCase()).join(', ');
    }
    
    // Update word display
    if (res.revealed) {
      el('wordDisplay').textContent = res.revealed.split('').join(' ');
    }
    
    // Check game end states from response
    if (res.status === 'won') {
      setState(`🎉 You won!`);
      logEvent(`✓ Guessed Letter: ${letter.toUpperCase()} - Game Won! 🎉`);
    } else if (res.status === 'lost') {
      const word = res.word || res.revealed;
      if (word) el('wordDisplay').textContent = word.split('').join(' ');
      setState(`💀 Game Over`);
      logEvent(`✓ Guessed Letter: ${letter.toUpperCase()} - Game Lost 💀`);
    } else {
      const turnText = res.status === 'playing' ? (res.currentTurn === user?.id ? '🎯 Your turn' : '⏳ Waiting') : '';
      setState(`${turnText} | Attempts: ${res.remainingAttempts}`);
      logEvent(`✓ Guessed Letter: ${letter.toUpperCase()} - ${res.correct ? 'Correct! ✅' : 'Not in word ❌'}`);
    }
    
    el('letterInput').value = '';
  } catch (e) { 
    logEvent({ error: 'Guess Failed', message: String(e) });
  }
}

el('guessBtn').addEventListener('click', makeGuess);
el('letterInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') makeGuess();
});
