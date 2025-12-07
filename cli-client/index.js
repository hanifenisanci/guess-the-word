const inquirer = require('inquirer');
const axios = require('axios');
const chalk = require('chalk');
const WebSocket = require('ws');

let userId = null;
let roomId = null;
let gameId = null;
let ws = null;
let wsHeartbeat = null;
let players = {}; // id -> username (learned from events)
let currentTurn = null;
let lastWord = null;

async function mainMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        '1. Register User',
        '2. Create Room',
        '3. Join Room',
        '4. Start Game',
        '5. Exit'
      ]
    }
  ]);

  switch (action[0]) {
    case '1': await registerUser(); break;
    case '2': await createRoom(); break;
    case '3': await joinRoom(); break;
    case '4': await startGame(); break;
    case '5': console.log(chalk.green('Goodbye!')); return;
  }

  mainMenu();
}

async function registerUser() {
  try {
    const { name } = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Enter your name:' }
    ]);
    const res = await axios.post('http://localhost:3000/users', { username: name });
    userId = res.data.id;
    console.log(chalk.green(`Registered as ${name} (ID: ${userId})`));
  } catch (err) {
    console.log(chalk.red('❌ Failed to register user.'));
  }
}

async function createRoom() {
  try {
    await ensureUser();
    const res = await axios.post('http://localhost:3000/rooms');
    roomId = res.data.id;
    const number = res.data.number;
    console.log(chalk.blue(`Room ${number} created (ID: ${roomId})`));
  } catch (err) {
    const msg = err?.response?.data?.error || 'Failed to create room.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

async function joinRoom() {
  // Always fetch lobby list and prompt, regardless of existing roomId
  try {
    const res = await axios.get('http://localhost:3000/rooms');
    const rooms = res.data.rooms || [];
    if (rooms.length === 0) {
      console.log(chalk.yellow('No rooms available. Create one first.'));
      return;
    }
    const { choice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: 'Choose a room to join:',
        choices: rooms.map(r => ({ name: `Room ${r.number} (ID: ${r.id}) - players: ${r.players.length}, status: ${r.status}` , value: r.id }))
      }
    ]);
    roomId = choice;
  } catch (e) {
    const msg = e?.response?.data?.error || 'Failed to fetch rooms.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
    return;
  }

  try {
    await ensureUser();
    await axios.put(`http://localhost:3000/rooms/${roomId}/join`, { userId });
    console.log(chalk.green(`Joined room ${roomId}`));
    // Subscribe to room events upon joining
    ensureWs();
    subscribeToRoom(roomId);
  } catch (err) {
    const msg = err?.response?.data?.error || 'Failed to join room.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

async function startGame() {
  if (!roomId) {
    console.log(chalk.red('⚠️ You must create and join a room first.'));
    return;
  }
  try {
    await ensureUser();
    const res = await axios.post(`http://localhost:3000/rooms/${roomId}/start`);
    ensureWs();
    subscribeToRoom(roomId);
    const status = res.data.status;
    if (status === 'waiting-for-opponent') {
      console.log(chalk.yellow('⏳ Waiting for other player to join...'));
      await waitForRoomStarted();
    } else {
      gameId = res.data.gameId;
      currentTurn = res.data.currentTurn;
      const turnMsg = currentTurn === userId ? 'It is your turn.' : 'Wait for your turn.';
      console.log(chalk.yellow(`🎮 Game started (Room: ${roomId}, Game: ${gameId})`));
      console.log(chalk.yellow(`Current turn: ${res.data.currentTurn}. ${turnMsg}`));
      await playGameLoop();
    }
  } catch (err) {
    const msg = err?.response?.data?.error || 'Failed to start game.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

function waitForRoomStarted() {
  return new Promise((resolve) => {
    const handler = (m) => {
      try {
        const msg = JSON.parse(m.toString());
        if (msg?.type === 'room.started' && msg?.data?.roomId === roomId) {
          gameId = msg.data.gameId;
          currentTurn = msg.data.currentTurn;
          const turnMsg = currentTurn === userId ? 'It is your turn.' : 'Wait for your turn.';
          console.log(chalk.yellow(`🎮 Game started (Room: ${roomId}, Game: ${gameId})`));
          console.log(chalk.yellow(`Current turn: ${msg.data.currentTurn}. ${turnMsg}`));
          ws.off('message', handler);
          resolve();
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });
}

async function playGameLoop() {
  let status = 'playing';

  while (status === 'playing') {
    // Wait until it's our turn before prompting for a guess
    if (currentTurn !== userId) {
      console.log(chalk.yellow('Waiting for your turn...'));
      await waitForYourTurn();
    }
    const { letter } = await inquirer.prompt([
      { type: 'input', name: 'letter', message: 'Guess a letter:' }
    ]);

    try {
      const res = await axios.post(`http://localhost:3000/rooms/${roomId}/guess`, { userId, letter });
      status = res.data.status;
      currentTurn = res.data.currentTurn || currentTurn;
      if (res.data.word) lastWord = res.data.word;

      console.log(chalk.cyan(`Revealed: ${res.data.revealed}`));
      console.log(chalk.cyan(`Remaining Attempts: ${res.data.remainingAttempts}`));
      console.log(chalk.cyan(`Status: ${status}`));
      console.log(chalk.cyan(`Next Turn: ${res.data.currentTurn}`));
    } catch (err) {
      const msg = err?.response?.data?.error || 'Error making guess.';
      console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
    }
  }

  if (status === 'won') {
    console.log(chalk.green('🎉 You won!'));
  } else if (status === 'lost') {
    if (!lastWord && gameId) {
      try {
        const r = await axios.get(`http://localhost:3000/games/${gameId}`);
        lastWord = r.data.word || lastWord;
      } catch (_) {}
    }
    const wordMsg = lastWord ? ` The word was: ${lastWord}` : '';
    console.log(chalk.red(`💀 You lost.${wordMsg}`));
  }
}

mainMenu();

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:3000/ws');
  ws.on('open', () => {
    console.log(chalk.gray('[ws] connected'));
    // Identify this socket with the current user (if available)
    if (userId) {
      ws.send(JSON.stringify({ action: 'identify', userId }));
    }
  });
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m.toString());
      const { type, data } = msg;
      if (type === 'room.joined') {
        if (data?.user?.id && data?.user?.username) {
          players[data.user.id] = data.user.username;
        }
        const name = data?.user?.username || 'A player';
        console.log(chalk.green(`${name} joined the room.`));
      } else if (type === 'room.started') {
        const turnId = data?.currentTurn;
        const name = turnId === userId ? 'You' : (players[turnId] || `Player ${turnId}`);
        gameId = data?.gameId || gameId;
        currentTurn = turnId || currentTurn;
        console.log(chalk.yellow(`Game started. ${name} go first.`));
      } else if (type === 'guess.accepted') {
        const actor = data?.userId === userId ? 'You' : (players[data?.userId] || `Player ${data?.userId}`);
        const verdict = data?.correct ? 'Correct!' : 'Not in the word.';
        const revealed = data?.revealed || '';
        console.log(chalk.cyan(`${actor} guessed '${data?.letter}'. ${verdict} Word: ${revealed}`));
      } else if (type === 'guess.rejected') {
        const actor = data?.userId === userId ? 'You' : (players[data?.userId] || `Player ${data?.userId}`);
        let reason = 'Guess rejected.';
        if (data?.reason === 'not-your-turn') reason = "It's not your turn.";
        else if (data?.reason === 'already-guessed') reason = 'Letter already guessed.';
        console.log(chalk.red(`${actor}: ${reason}`));
      } else if (type === 'turn.changed') {
        const turnId = data?.currentTurn;
        currentTurn = turnId || currentTurn;
        const namePossessive = turnId === userId ? 'your' : ((players[turnId] || `Player ${turnId}`) + "'s");
        if (turnId === userId) console.log(chalk.yellow('It is your turn.'));
        else console.log(chalk.yellow(`It is ${namePossessive} turn.`));
      } else if (type === 'game.won') {
        const winnerId = data?.winner;
        const name = winnerId === userId ? 'You' : (players[winnerId] || `Player ${winnerId}`);
        console.log(chalk.green(`${name} won the game!`));
      } else if (type === 'game.lost') {
        if (data?.word) lastWord = data.word;
        const wordMsg = lastWord ? ` The word was: ${lastWord}` : '';
        console.log(chalk.red(`Game over. No attempts left.${wordMsg}`));
      }
    } catch (_) {}
  });
  ws.on('close', () => console.log(chalk.gray('[ws] disconnected')));

  // Heartbeat every 30s
  ws.on('open', () => {
    clearInterval(wsHeartbeat);
    wsHeartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'ping', nonce: Date.now().toString() }));
      }
    }, 30000);
  });
  ws.on('close', () => {
    clearInterval(wsHeartbeat);
    wsHeartbeat = null;
  });
}

function subscribeToRoom(id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    ws.on('open', () => subscribeToRoom(id));
    return;
  }
  ws.send(JSON.stringify({ action: 'subscribe', topics: [`room:${id}`] }));
}

function waitForYourTurn() {
  return new Promise((resolve) => {
    if (currentTurn === userId) return resolve();
    const handler = (m) => {
      try {
        const msg = JSON.parse(m.toString());
        if (msg?.type === 'turn.changed') {
          currentTurn = msg?.data?.currentTurn || currentTurn;
          if (currentTurn === userId) {
            ws.off('message', handler);
            resolve();
          }
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });
}

async function ensureUser() {
  if (userId) return;
  const { name } = await inquirer.prompt([
    { type: 'input', name: 'name', message: 'Enter your name (to register):', default: 'Player' }
  ]);
  try {
    const res = await axios.post('http://localhost:3000/users', { username: name });
    userId = res.data.id;
    console.log(chalk.green(`Registered as ${name} (ID: ${userId})`));
  } catch (err) {
    const msg = err?.response?.data?.error || 'Auto-registration failed.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
    throw err;
  }
}