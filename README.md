# Guess the Word

Microservice-based, two-player, turn-based word guessing game. Services communicate over HTTP; clients receive live updates via WebSocket (room hub). In-memory storage for simplicity.

## Services
- `user-service` (3001): register/fetch users.
- `room-service` (3002): rooms, joins, start, turn/guess validation, WS hub `ws://localhost:3002/ws`.
- `games-rules-service` (3003): game creation, guess resolution, dictionary from `words.txt`.

## Quick Start
```powershell
# Start services in separate terminals
cd C:\Users\nisan\Desktop\guess-the-word\user-service; npm install; node index.js
cd C:\Users\nisan\Desktop\guess-the-word\room-service; npm install; node index.js
cd C:\Users\nisan\Desktop\guess-the-word\games-rules-service; npm install; node index.js

# Run CLI
cd C:\Users\nisan\Desktop\guess-the-word\cli-client; npm install; node index.js

# Run Web Client (simple static server)
npm install -g http-server
cd C:\Users\nisan\Desktop\guess-the-word\web-client; http-server -p 8080
# open http://localhost:8080
```

## HTTP APIs (minimal)
- User Service
  - `POST /users` → `{ id, username }`
  - `GET /users/:id` → `{ id, username }`
  - `GET /health` → `{ status: 'ok' }`
- Room Service
  - `POST /rooms` → `{ id, players: [], status: 'waiting' }`
  - `PUT /rooms/:id/join` `{ userId }` → `{ id, players, status }`
  - `POST /rooms/:id/start` → `{ roomId, gameId, currentTurn, status: 'active' }`
  - `POST /rooms/:id/guess` `{ userId, letter }` → `{ revealed, remainingAttempts, status, correct, guess, currentTurn }`
  - `GET /rooms/:id` → room state
  - `GET /health` → `{ status: 'ok' }`
- Game Rules Service
  - `POST /games` → `{ gameId }`
  - `POST /games/:id/guess` `{ letter }` → `{ revealed, remainingAttempts, status, correct, guess }`
  - `GET /games/:id` → `{ revealed, remainingAttempts, status, guessedLetters }`
  - `GET /health` → `{ status: 'ok' }`

## WebSocket Events (topic `room:<roomId>`)
- `room.created` `{ roomId, players, status }`
- `room.joined` `{ roomId, user, players, status }`
- `room.started` `{ roomId, gameId, currentTurn, status }`
- `guess.accepted` `{ roomId, gameId, userId, letter, revealed, correct, remainingAttempts, status }`
- `guess.rejected` `{ roomId, gameId, userId, letter, reason }`
- `turn.changed` `{ roomId, gameId, currentTurn }`
- `game.won` `{ roomId, gameId, winner, revealed, remainingAttempts }`
- `game.lost` `{ roomId, gameId, revealed, remainingAttempts }`
- `room.finished` `{ roomId, reason }`

Subscribe example (client → server):
```json
{ "action": "subscribe", "topics": ["room:r123"] }
```

## Development Notes
- All data is in-memory; restarting services clears state.
- IDs use timestamps; OK for demos, not for production.
- Error responses use `{ error: 'message' }` with HTTP 4xx/5xx.
- Next improvements: auth tokens, disconnect handling, tests.
