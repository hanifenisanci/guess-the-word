const express = require('express');
const app = express();
const port = 3001;

app.use(express.json());

const users = {}; // In-memory user store

// Register user (HTTP endpoint)
app.post('/users', (req, res) => {
  const username = req.body.username || req.body.name;
  if (!username) return res.status(400).send({ error: 'username is required' });

  const id = Date.now().toString();
  users[id] = { id, username };
  res.status(201).send(users[id]);
});

// Get user by ID
app.get('/users/:id', (req, res) => {
  const user = users[req.params.id];
  if (!user) return res.status(404).send({ error: 'User not found' });

  res.send(user);
});

app.listen(port, () => {
  console.log(`User Service running on http://localhost:${port}`);
});

// Health check
app.get('/health', (_req, res) => {
  res.send({ status: 'ok' });
});
