const inquirer = require('inquirer');
const axios = require('axios');
const chalk = require('chalk');

let userId = null;
let roomId = null;
let gameId = null;

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
    const res = await axios.post('http://localhost:3001/users', { username: name });
    userId = res.data.id;
    console.log(chalk.green(`Registered as ${name} (ID: ${userId})`));
  } catch (err) {
    console.log(chalk.red('❌ Failed to register user.'));
  }
}

async function createRoom() {
  try {
    const res = await axios.post('http://localhost:3002/rooms');
    roomId = res.data.id;
    console.log(chalk.blue(`Room created (ID: ${roomId})`));
  } catch (err) {
    console.log(chalk.red('❌ Failed to create room. Is room-service running?'));
  }
}

async function joinRoom() {
  if (!userId || !roomId) {
    console.log(chalk.red('⚠️ You must register and create a room first.'));
    return;
  }

  try {
    await axios.put(`http://localhost:3002/rooms/${roomId}/join`, { userId });
    console.log(chalk.green(`Joined room ${roomId}`));
  } catch (err) {
    console.log(chalk.red('❌ Failed to join room. Is room-service running?'));
  }
}

async function startGame() {
  if (!roomId) {
    console.log(chalk.red('⚠️ You must create and join a room first.'));
    return;
  }
  try {
    const res = await axios.post(`http://localhost:3002/rooms/${roomId}/start`);
    gameId = res.data.gameId;
    console.log(chalk.yellow(`🎮 Game started (Room: ${roomId}, Game: ${gameId})`));
    console.log(chalk.yellow(`Current turn: ${res.data.currentTurn}`));
    await playGameLoop();
  } catch (err) {
    console.log(chalk.red('❌ Failed to start game. Is room-service and games-rules-service running?'));
  }
}

async function playGameLoop() {
  let status = 'playing';

  while (status === 'playing') {
    const { letter } = await inquirer.prompt([
      { type: 'input', name: 'letter', message: 'Guess a letter:' }
    ]);

    try {
      const res = await axios.post(`http://localhost:3002/rooms/${roomId}/guess`, { userId, letter });
      status = res.data.status;

      console.log(chalk.cyan(`Revealed: ${res.data.revealed}`));
      console.log(chalk.cyan(`Remaining Attempts: ${res.data.remainingAttempts}`));
      console.log(chalk.cyan(`Status: ${status}`));
      console.log(chalk.cyan(`Next Turn: ${res.data.currentTurn}`));
    } catch (err) {
      const msg = err?.response?.data?.error || 'Error making guess.';
      console.log(chalk.red(`❌ ${msg} Is room-service running?`));
    }
  }

  if (status === 'won') {
    console.log(chalk.green('🎉 You won!'));
  } else if (status === 'lost') {
    console.log(chalk.red('💀 You lost. Better luck next time!'));
  }
}

mainMenu();