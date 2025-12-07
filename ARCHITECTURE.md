# Architecture Overview

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐     │
│   │   CLI Client     │   │   Web Client     │   │  Mobile PWA      │     │
│   │  (Terminal UI)   │   │  (Browser UI)    │   │  (Phone App)     │     │
│   │                  │   │                  │   │                  │     │
│   │  • Inquirer.js   │   │  • Vanilla JS    │   │  • Same as Web   │     │
│   │  • Chalk         │   │  • Tailwind CSS  │   │  • Service       │     │
│   │  • Axios         │   │  • Material      │   │    Worker        │     │
│   │  • WebSocket     │   │    Icons         │   │  • Web Manifest  │     │
│   └────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘     │
│            │                      │                       │               │
│            │ HTTP REST + WS       │ HTTP REST + WS        │ HTTP REST +   │
│            │                      │                       │ WS            │
└────────────┼──────────────────────┼───────────────────────┼───────────────┘
             │                      │                       │
             └──────────────────────┼───────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        UNIFIED BACKEND SERVER                               │
│                         (app-server/index.js)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────┐        │
│   │                    Express HTTP Server                        │        │
│   │                    (Port 3000, 0.0.0.0)                      │        │
│   │                                                               │        │
│   │  • CORS Middleware (Cross-Origin Support)                    │        │
│   │  • JSON Body Parser                                          │        │
│   │  • REST API Endpoints                                        │        │
│   └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────┐        │
│   │                 WebSocket Server (ws)                         │        │
│   │                                                               │        │
│   │  • Topic-based Pub/Sub Pattern                               │        │
│   │  • Real-time Event Broadcasting                              │        │
│   │  • Per-connection Subscription Management                    │        │
│   └──────────────────────────────────────────────────────────────┘        │
│                                                                             │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐        │
│   │  User Service   │   │  Room Service   │   │  Game Service   │        │
│   ├─────────────────┤   ├─────────────────┤   ├─────────────────┤        │
│   │                 │   │                 │   │                 │        │
│   │ • POST /users   │   │ • POST /rooms   │   │ • POST /guess   │        │
│   │ • GET /users/:id│   │ • POST /rooms/  │   │ • Game Logic    │        │
│   │ • In-memory     │   │   :id/join      │   │ • Turn Mgmt     │        │
│   │   storage       │   │ • POST /rooms/  │   │ • Win/Loss      │        │
│   │                 │   │   :id/start     │   │   Detection     │        │
│   │                 │   │ • GET /rooms    │   │ • Word Reveal   │        │
│   │                 │   │ • In-memory     │   │ • Broadcast     │        │
│   │                 │   │   storage       │   │   Events        │        │
│   │                 │   │                 │   │ • In-memory     │        │
│   │                 │   │                 │   │   storage       │        │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘        │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────┐        │
│   │              Shared Data Store (In-Memory)                    │        │
│   │                                                               │        │
│   │  • users = {}      (Map: userId → user object)               │        │
│   │  • rooms = {}      (Map: roomId → room object)               │        │
│   │  • games = {}      (Map: roomId → game state)                │        │
│   │  • words = []      (Array: loaded from words.txt)            │        │
│   └──────────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Communication Flows

### 1. User Registration Flow
```
Client                    App Server (User Service)
  │                              │
  │──── POST /users ────────────▶│
  │     { username }             │
  │                              │ Store in users{}
  │◀─── 200 OK ─────────────────│
       { userId, username }      │
```

### 2. Room Creation & Join Flow
```
Client                    App Server (Room Service)
  │                              │
  │──── POST /rooms ────────────▶│
  │     { userId }               │
  │                              │ Create room in rooms{}
  │◀─── 200 OK ─────────────────│
       { roomId, ... }           │
  │                              │
  │──── POST /rooms/:id/join ───▶│
  │     { userId }               │
  │                              │ Add user to room
  │◀─── 200 OK ─────────────────│
       { room }                  │
  │                              │
  │                              │ Broadcast via WebSocket
  │◀═══ room.joined ════════════│
       { roomId, username }      │
```

### 3. Game Start Flow
```
Client                    App Server (Room Service + Game Service)
  │                              │
  │──── POST /rooms/:id/start ──▶│
  │     { userId }               │
  │                              │ Validate room (2 users)
  │                              │ Initialize game in games{}
  │                              │ Select random word
  │◀─── 200 OK ─────────────────│
       { message }               │
  │                              │
  │                              │ Broadcast to all in room
  │◀═══ room.started ═══════════│
       { roomId, currentTurn }   │
```

### 4. Gameplay Flow (Turn-based)
```
Player 1          App Server (Game Service)          Player 2
  │                      │                              │
  │─ POST /guess ───────▶│                              │
  │  { userId, letter }  │                              │
  │                      │ Validate turn                │
  │                      │ Check letter                 │
  │                      │ Update game state            │
  │◀─ 200 OK ───────────│                              │
  │   { correct, ... }   │                              │
  │                      │ Broadcast to both            │
  │◀═══ guess.accepted ═│═════════════════════════════▶│
       { letter, correct, revealedWord, attempts }     │
  │                      │                              │
  │                      │ Switch turn                  │
  │◀═══ turn.switched ══│═════════════════════════════▶│
       { currentTurn }   │                              │
```

### 5. Game End Flow
```
Player            App Server (Game Service)          Opponent
  │                      │                              │
  │─ POST /guess ───────▶│                              │
  │                      │ Letter reveals word OR       │
  │                      │ Max attempts reached         │
  │◀─ 200 OK ───────────│                              │
  │   { gameOver, ... }  │                              │
  │                      │ Broadcast game.over          │
  │◀═══ game.over ══════│═════════════════════════════▶│
       { winner, reason, word }                         │
```

## Component Relationships

### Service Dependencies
```
┌─────────────────────┐
│   User Service      │──┐
│   (Standalone)      │  │
└─────────────────────┘  │
                         │
┌─────────────────────┐  │  Both depend on
│   Room Service      │──┼──▶ User Service
│   (User validation) │  │     for user lookup
└─────────────────────┘  │
         │               │
         ▼               │
┌─────────────────────┐  │
│   Game Service      │──┘
│   (Room & User      │
│    validation)      │
└─────────────────────┘
```

### Client-Server Protocol Stack
```
┌───────────────────────────────────┐
│     Application Layer             │
│  • Game Logic (Turn Management)   │
│  • User Registration              │
│  • Room Management                │
└───────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│     Communication Layer           │
│  • REST API (HTTP POST/GET)       │
│  • WebSocket (Topic-based)        │
└───────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────┐
│     Network Layer                 │
│  • TCP/IP                         │
│  • Port 3000 (HTTP + WS)          │
│  • CORS (Cross-Origin)            │
└───────────────────────────────────┘
```

## WebSocket Event Bus

The WebSocket hub acts as a centralized event bus for real-time synchronization:

```
┌─────────────────────────────────────────────────────────┐
│            WebSocket Event Bus (Topic-based)            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Topics:                                                │
│                                                         │
│  • room.joined          ──▶  Notify room members       │
│  • room.started         ──▶  Begin game session        │
│  • guess.accepted       ──▶  Sync letter reveal        │
│  • turn.switched        ──▶  Update active player      │
│  • game.over            ──▶  Announce winner           │
│                                                         │
│  Subscriptions per connection:                          │
│  • Client subscribes to topics                          │
│  • Server broadcasts to topic subscribers               │
│  • Automatic cleanup on disconnect                      │
└─────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. **Unified Backend vs Separate Microservices**
- **Choice**: Single Node.js server with modular service logic
- **Rationale**: 
  - Simpler deployment for prototype/demo
  - Reduced network latency (no inter-service calls)
  - Easier state management with shared memory
  - Services are logically separated in code for clarity

### 2. **Hybrid Communication Pattern**
- **REST APIs**: User actions (register, create room, guess)
- **WebSocket**: Real-time notifications (turn changes, game events)
- **Rationale**: 
  - REST for request-response (client needs confirmation)
  - WebSocket for push notifications (opponent actions)
  - Leverages strengths of both protocols

### 3. **In-Memory Storage**
- **Choice**: JavaScript objects instead of database
- **Rationale**: 
  - Fast prototyping and development
  - Zero external dependencies
  - Sufficient for demo/learning purposes
  - Easy to migrate to Redis/MongoDB later

### 4. **Topic-based WebSocket Pattern**
- **Choice**: Custom pub/sub over raw WebSocket messages
- **Rationale**: 
  - Clean separation of event types
  - Flexible subscription management
  - Easy to add new events
  - Similar to Socket.io rooms but lightweight

### 5. **Three Client Implementations**
- **CLI**: Developer/testing tool with rich terminal UI
- **Web**: Desktop browser experience with modern design
- **PWA**: Mobile-first installable app
- **Rationale**: 
  - Demonstrates protocol-agnostic API design
  - Different UX paradigms for different contexts
  - PWA showcases modern web capabilities

## Scalability Considerations

### Current Limitations
- Single server instance (no load balancing)
- In-memory state (lost on restart)
- No persistent storage
- No authentication/authorization
- No rate limiting

### Future Improvements
```
┌─────────────────────────────────────────────────────────┐
│              Production Architecture                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Load Balancer (nginx)                                  │
│         │                                               │
│         ├──▶ App Server 1 ──┐                          │
│         ├──▶ App Server 2 ──┼──▶ Redis (Session/State) │
│         └──▶ App Server 3 ──┘                          │
│                                                         │
│  MongoDB (Persistent Storage)                           │
│  • User profiles                                        │
│  • Game history                                         │
│  • Leaderboards                                         │
└─────────────────────────────────────────────────────────┘
```
