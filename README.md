# Guess the Word 🎯

A modern, multiplayer word-guessing game with microservice architecture, real-time WebSocket communication, and cross-platform support.

## 🌟 Features
- **Microservice Architecture**: Unified backend with modular services
- **Real-Time Gameplay**: WebSocket-based live updates
- **Multi-Platform Support**: 
  - 💻 CLI Client (Windows/Mac/Linux)
  - 🌐 Web Client (responsive, modern UI with Tailwind CSS)
  - 📱 Mobile PWA (installable on iOS/Android)
- **Turn-Based Multiplayer**: Two players alternate guessing letters
- **Beautiful UI**: Clean, responsive design with dark mode support

## 🚀 Quick Start

### Using PowerShell Scripts (Recommended)
```powershell
# Start the server
powershell.exe -File scripts\start_app.ps1

# Run CLI client
powershell.exe -File scripts\run_cli.ps1

# Or run demo with multiple clients
powershell.exe -File scripts\demo.ps1
```

### Manual Setup
```powershell
# 1. Start the unified server
cd app-server
npm install
node index.js
# Server runs on http://localhost:3000

# 2. Run CLI client
cd cli-client
npm install
node index.js

# 3. Run web client (in separate terminal)
cd web-client
npm install -g http-server
http-server -p 8081 -c-1
# Open http://localhost:8081
```

## 🎮 How to Play

### CLI Client
1. **Register**: Enter your username
2. **Create Room**: Creates a numbered room (you auto-join)
3. **Join Room**: Enter room ID to join
4. **Start Game**: Begins when 2 players are present
5. **Guess Letters**: Take turns guessing one letter at a time
6. **Win**: Reveal the word before attempts run out!

### Web/Mobile Client
1. **Register**: Enter username and click "Register"
2. **Create Room**: Click "Create Room" (auto-joins you)
3. **Join Room**: Enter room ID and click "Join Room"
4. **Start Game**: Click "Start Game" when ready
5. **Play**: Enter letters and click "Guess" or press Enter

### PWA Installation (Mobile)
- **Android**: Chrome → Menu (⋮) → "Add to Home Screen"
- **iOS**: Safari → Share → "Add to Home Screen"
- **Desktop**: Chrome/Edge → Install icon in address bar

## 🏗️ Architecture

### Backend Services (`app-server`)
- **User Management**: Register and retrieve users
- **Room Management**: Create, join, and list game rooms
- **Game Logic**: Word selection, turn management, guess validation
- **WebSocket Hub**: Real-time event broadcasting

### HTTP API Endpoints
```
POST   /users                    - Register user
GET    /users/:id                - Get user info
POST   /rooms                    - Create room (auto-join creator)
GET    /rooms                    - List all rooms
PUT    /rooms/:id/join           - Join room
GET    /rooms/:id                - Get room state
POST   /rooms/:id/start          - Start game (needs 2 players)
POST   /rooms/:id/guess          - Make a guess
GET    /games/:id                - Get game state
GET    /health                   - Health check
```

### WebSocket Events (topic: `room:<roomId>`)
```javascript
// Room events
room.created    { roomId, number, players, status }
room.joined     { roomId, user, players, status }
room.started    { roomId, gameId, currentTurn, status }

// Game events
guess.accepted  { roomId, gameId, userId, letter, revealed, correct, remainingAttempts }
guess.rejected  { roomId, gameId, userId, letter, reason }
turn.changed    { roomId, gameId, currentTurn }
game.won        { roomId, gameId, winner, revealed }
game.lost       { roomId, gameId, word, revealed }
```
- `game.won` `{ roomId, gameId, winner, revealed, remainingAttempts }`
- `game.lost` `{ roomId, gameId, revealed, remainingAttempts }`
- `room.finished` `{ roomId, reason }`

Subscribe example (client → server):
```json
{ "action": "subscribe", "topics": ["room:r123"] }
```

## 📁 Project Structure
```
guess-the-word/
├── app-server/          # Unified backend server (port 3000)
│   ├── index.js         # Main server with all services
│   └── package.json
├── cli-client/          # Command-line interface
│   ├── index.js         # Interactive menu & gameplay
│   └── package.json
├── web-client/          # Web & PWA client
│   ├── index.html       # Modern UI with Tailwind CSS
│   ├── app.js           # Client logic
│   ├── manifest.json    # PWA configuration
│   ├── service-worker.js # Offline support
│   └── icon-*.png       # App icons
├── scripts/             # PowerShell automation scripts
│   ├── start_app.ps1    # Start server
│   ├── run_cli.ps1      # Launch CLI client
│   └── demo.ps1         # Multi-client demo
├── words.txt            # Game dictionary
└── README.md
```

## 🛠️ Technologies
- **Backend**: Node.js, Express, WebSocket (`ws`)
- **CLI**: Inquirer, Axios, Chalk
- **Web**: Vanilla JS, Tailwind CSS, Material Icons, Fredoka Font
- **PWA**: Service Workers, Web Manifest
- **Storage**: In-memory (suitable for demo/testing)

## 📝 Game Rules
- **Players**: 2 (turn-based)
- **Objective**: Guess the hidden word by suggesting letters
- **Attempts**: 6 incorrect guesses allowed
- **Dictionary**: 4+ letter words from `words.txt`
- **Win Condition**: Reveal all letters before attempts run out
- **Turn System**: Players alternate after each guess

## 🔧 Development Notes
- In-memory storage (data clears on restart)
- CORS enabled for local network testing
- Auto-join on room creation
- Idempotent room join
- Auto-start game when 2nd player joins (if start was requested)
- WebSocket heartbeat (30s ping/pong)
