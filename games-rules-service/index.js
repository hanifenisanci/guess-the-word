const express = require('express');
const fs = require('fs');
const app = express();
const port = 3003;

app.use(express.json());

const words = fs.readFileSync('words.txt', 'utf-8')
  .split('\n')
  .map(w => w.trim())
  .filter(w => w.length >= 4); // Optional: filter short words

const games = {};

// Start a new game
app.post('/games', (req, res) => {
  const gameId = Date.now().toString();
  const word = words[Math.floor(Math.random() * words.length)];
  games[gameId] = {
    id: gameId,
    word,
    guessedLetters: [],
    remainingAttempts: 6,
    status: "playing"
  };
  res.status(201).send({ gameId });
});

// Make a guess
app.post('/games/:id/guess', (req, res) => {
  const { letter } = req.body;
  const game = games[req.params.id];
  if (!game || game.status !== "playing") return res.status(400).send({ error: "Invalid game" });

  if (game.guessedLetters.includes(letter)) {
    return res.status(400).send({ error: "Letter already guessed" });
  }

  game.guessedLetters.push(letter);

  if (!game.word.includes(letter)) {
    game.remainingAttempts -= 1;
  }

  const revealed = game.word.split('').map(l => game.guessedLetters.includes(l) ? l : "_").join('');

  if (revealed === game.word) {
    game.status = "won";
  } else if (game.remainingAttempts <= 0) {
    game.status = "lost";
  }

  res.send({
    revealed,
    remainingAttempts: game.remainingAttempts,
    status: game.status
  });
});

// Get game status
app.get('/games/:id', (req, res) => {
  const game = games[req.params.id];
  if (!game) return res.status(404).send({ error: "Game not found" });

  const revealed = game.word.split('').map(l => game.guessedLetters.includes(l) ? l : "_").join('');
  res.send({
    revealed,
    remainingAttempts: game.remainingAttempts,
    status: game.status
  });
});

app.listen(port, () => {
  console.log(`Game Rules Service running on http://localhost:${port}`);
});
