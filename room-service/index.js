const express = require('express');
const axios = require('axios');
const app = express();
const port = 3002;

app.use(express.json());

const rooms = {}; // In-memory room store

// Create a new room
app.post('/rooms', (req, res) => {
  const roomId = Date.now().toString();
  rooms[roomId] = { id: roomId, players: [] };
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

app.listen(port, () => {
  console.log(`Room Service running on http://localhost:${port}`);
});