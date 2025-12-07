const inquirer = require('inquirer');
const axios = require('axios');
const chalk = require('chalk');
const WebSocket = require('ws');

let userId = null;
let roomId = null;
let gameId = null;
let ws = null;
let wsHeartbeat = null;
let players = {}; // id -> username
let currentTurn = null;
let lastWord = null;
let inGame = false;
let gameLoopResolver = null; // Resolver for game loop promise

async function run() {
  await mainMenu();
}

async function registerUser() {
  try {
    const { name } = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Enter your name:' }]);
    const res = await axios.post('http://localhost:3000/users', { username: name });
    userId = res.data.id;
    console.log(chalk.green(`Registered as ${name} (ID: ${userId})`));
  } catch {
    console.log(chalk.red('❌ Failed to register user.'));
  }
}

async function listRooms() {
  try {
    const res = await axios.get('http://localhost:3000/rooms');
    const rooms = res.data.rooms || [];
    if (rooms.length === 0) {
      console.log(chalk.yellow('No rooms available.'));
      return;
    }
    console.log(chalk.blue('Available rooms:'));
    rooms.forEach(r => {
      console.log(`- Room ${r.number} (ID: ${r.id}) - players: ${r.players.length}, status: ${r.status}`);
    });
  } catch (e) {
    const msg = e?.response?.data?.error || 'Failed to fetch rooms.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

async function createRoom() {
  try {
    await ensureUser();
    ensureWs();
    const res = await axios.post('http://localhost:3000/rooms', { userId });
    roomId = res.data.id;
    const number = res.data.number;
    subscribeToRoom(roomId);
    console.log(chalk.blue(`Room ${number} created and joined (ID: ${roomId})`));
  } catch (err) {
    const msg = err?.response?.data?.error || 'Failed to create room.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

async function joinRoom() {
  // Always fetch lobby list and prompt
  try {
    const res = await axios.get('http://localhost:3000/rooms');
    const rooms = res.data.rooms || [];
    if (rooms.length === 0) {
      console.log(chalk.yellow('No rooms available. Create one first.'));
      return;
    }
    const { choice } = await inquirer.prompt([{ type: 'list', name: 'choice', message: 'Choose a room to join:', choices: rooms.map(r => ({ name: `Room ${r.number} (ID: ${r.id}) - players: ${r.players.length}, status: ${r.status}`, value: r.id })) }]);
    roomId = choice;
  } catch (e) {
    const msg = e?.response?.data?.error || 'Failed to fetch rooms.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
    return;
  }

  try {
    await ensureUser();
    ensureWs();
    subscribeToRoom(roomId);
    
    const jr = await axios.put(`http://localhost:3000/rooms/${roomId}/join`, { userId });
    const joinedId = jr?.data?.id || roomId;
    const room = jr?.data;
    console.log(chalk.green(`Joined room ${joinedId}`));
    
    // If game is already active, auto-enter game loop
    if (room?.status === 'active' && room?.gameId) {
      gameId = room.gameId;
      currentTurn = room.currentTurn;
      inGame = true;
      console.log(chalk.yellow(`🎮 Game already in progress! Entering game...`));
      const turnMsg = currentTurn === userId ? 'It is your turn.' : 'Wait for your turn.';
      console.log(chalk.yellow(`Current turn: ${currentTurn}. ${turnMsg}`));
      await playGameLoop();
      inGame = false;
    } else if (room?.status === 'waiting-start' || room?.startRequested) {
      // Game start was requested, wait for room.started event then start game loop
      console.log(chalk.yellow('⏳ Waiting for game to start...'));
      await new Promise((resolve) => {
        gameLoopResolver = resolve;
      });
      await playGameLoop();
      inGame = false;
    }
  } catch (err) {
    const msg = err?.response?.data?.error || 'Failed to join room.';
    console.log(chalk.red(`❌ ${msg} Check that app-server is running on :3000.`));
  }
}

async function playGameLoop() {
  let status = 'playing';

  while (status === 'playing') {
    // Wait for our turn
    if (currentTurn !== userId) {
      console.log(chalk.yellow('Waiting for your turn...'));
      await waitForYourTurn();
    }
    
    // Check if game ended while waiting
    if (status !== 'playing') break;
    
    // Prompt for guess
    const { letter } = await inquirer.prompt([{ type: 'input', name: 'letter', message: 'Guess a letter:' }]);

    try {
      const res = await axios.post(`http://localhost:3000/rooms/${roomId}/guess`, { userId, letter });
      status = res.data.status;
      if (res.data.word) lastWord = res.data.word;

      console.log(chalk.cyan(`Revealed: ${res.data.revealed}`));
      console.log(chalk.cyan(`Remaining Attempts: ${res.data.remainingAttempts}`));
      console.log(chalk.cyan(`Status: ${status}`));
      console.log(chalk.cyan(`Next Turn: ${res.data.currentTurn}`));
      
      // Don't update currentTurn here - let the WebSocket event do it
      // This prevents race conditions
    } catch (err) {
      if (err?.response?.status === 409) {
        // Not our turn according to server
        console.log(chalk.yellow('Not your turn, waiting...'));
      } else {
        const msg = err?.response?.data?.error || 'Error making guess.';
        console.log(chalk.red(`❌ ${msg}`));
      }
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



async function mainMenu() {
  while (true) {
    // Don't show menu while in an active game
    if (inGame) {
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    
    const { action } = await inquirer.prompt([{
      type: 'list', name: 'action', message: 'Choose an action:',
      choices: [
        '1. Register User',
        '2. Create Room',
        '3. Join Room',
        '4. List Rooms',
        '5. Start Game',
        '6. Exit'
      ]
    }]);

    const choice = action[0];
    if (choice === '1') { await registerUser(); }
    else if (choice === '2') { await createRoom(); }
    else if (choice === '3') { await joinRoom(); }
    else if (choice === '4') { await listRooms(); }
    else if (choice === '5') { await startGame(); }
    else if (choice === '6') { console.log(chalk.green('Goodbye!')); break; }
  }
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket('ws://localhost:3000/ws');
  ws.on('open', () => {
    console.log(chalk.gray('[ws] connected'));
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
        
        // Signal game loop to start if we're waiting for it
        if (gameLoopResolver && roomId === data?.roomId) {
          inGame = true;
          gameLoopResolver();
          gameLoopResolver = null;
        }
      } else if (type === 'guess.accepted') {
        const actor = data?.userId === userId ? 'You' : (players[data?.userId] || `Player ${data?.userId}`);
        const verdict = data?.correct ? chalk.green('✓ Correct!') : chalk.red('✗ Not in the word');
        const revealed = data?.revealed || '';
        console.log(chalk.cyan(`${actor} guessed '${data?.letter}'. ${verdict}`));
        console.log(chalk.yellow(`Word: ${revealed} | Attempts left: ${data?.remainingAttempts || '?'}`));
      } else if (type === 'guess.rejected') {
        const actor = data?.userId === userId ? 'You' : (players[data?.userId] || `Player ${data?.userId}`);
        let reason = 'Guess rejected.';
        if (data?.reason === 'not-your-turn') reason = "It's not your turn.";
        else if (data?.reason === 'already-guessed') reason = 'Letter already guessed.';
        console.log(chalk.red(`${actor}: ${reason}`));
      } else if (type === 'turn.changed') {
        const turnId = data?.currentTurn;
        // Update currentTurn from WebSocket event
        currentTurn = turnId;
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
    const handler = () => {
      ws.off('open', handler);
      subscribeToRoom(id);
    };
    ws.on('open', handler);
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
        if (msg?.type === 'turn.changed' && msg?.data?.currentTurn === userId) {
          ws.off('message', handler);
          resolve();
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });
}

async function ensureUser() {
  if (userId) return;
  let name = 'Player';
  if (!inGame) {
    const ans = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Enter your name (to register):', default: 'Player' }
    ]);
    name = ans.name;
  }
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

async function startGame() {
  if (!roomId) {
    console.log(chalk.red('⚠️ You must create and join a room first.'));
    return;
  }
  try {
    await ensureUser();
    ensureWs();
    subscribeToRoom(roomId);
    const res = await axios.post(`http://localhost:3000/rooms/${roomId}/start`);
    const status = res.data.status;
    inGame = true;
    if (status === 'waiting-for-opponent') {
      console.log(chalk.yellow('⏳ Waiting for other player to join...'));
      // Wait for room.started WebSocket event
      await new Promise((resolve) => {
        gameLoopResolver = resolve;
      });
      await playGameLoop();
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
  } finally {
    inGame = false;
  }
}

// Cleanup on exit
process.on('SIGINT', () => {
  console.log(chalk.yellow('\nShutting down...'));
  if (ws) ws.close();
  if (wsHeartbeat) clearInterval(wsHeartbeat);
  process.exit(0);
});

// Prevent unexpected process exits due to unhandled errors
process.on('uncaughtException', (e) => {
  console.log(chalk.red(`Unhandled error: ${e?.message || e}`));
});
process.on('unhandledRejection', (e) => {
  console.log(chalk.red(`Unhandled rejection: ${e?.message || e}`));
});

// Kick off persistent menu loop
run();