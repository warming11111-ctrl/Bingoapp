const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let drawnBalls = [];
let gameInterval = null;
let gameActive = false;
let connectedPlayers = new Map();

function startBallCaller() {
  if (gameActive) return;
  gameActive = true;
  drawnBalls = [];
  
  // Call a new random ball every 3 seconds
  gameInterval = setInterval(() => {
    if (drawnBalls.length >= 75) {
      clearInterval(gameInterval);
      return;
    }
    
    let newBall;
    do {
      newBall = Math.floor(Math.random() * 75) + 1;
    } while (drawnBalls.includes(newBall));

    drawnBalls.push(newBall);
    io.emit('ballDrawn', { number: newBall, history: drawnBalls });
  }, 3000);
}

io.on('connection', (socket) => {
  connectedPlayers.set(socket.id, { id: socket.id, ready: false });
  io.emit('playerCountUpdate', { count: connectedPlayers.size });

  socket.on('joinRoom', () => {
    // Send current game status to reconnecting players
    if (drawnBalls.length > 0) {
      socket.emit('gameSync', { history: drawnBalls, current: drawnBalls[drawnBalls.length - 1] });
    }
  });

  socket.on('selectBoard', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      player.ready = true;
      player.matrix = data.matrix;
      player.boardId = data.boardId;
    }

    // Auto-start game loop when players are ready
    if (!gameActive) {
      startBallCaller();
    }
  });

  socket.on('verifyBingo', (data, callback) => {
    const { markedIndices, matrix } = data;
    
    // Valid 5x5 Bingo Lines (0-indexed)
    const winningLines = [
      // Rows
      [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
      // Columns
      [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
      // Diagonals
      [0,6,12,18,24], [4,8,12,16,20]
    ];

    let isRealBingo = false;

    for (let line of winningLines) {
      const lineComplete = line.every(idx => {
        if (idx === 12) return true; // FREE space
        const val = matrix[idx];
        return markedIndices.includes(idx) && drawnBalls.includes(val);
      });

      if (lineComplete) {
        isRealBingo = true;
        break;
      }
    }

    if (isRealBingo) {
      clearInterval(gameInterval);
      gameActive = false;
      io.emit('gameOver', { winnerId: socket.id, winnerBoard: data.boardId });
      callback({ success: true });
    } else {
      callback({ success: false, reason: "FALSE_BINGO" });
    }
  });

  socket.on('disconnect', () => {
    connectedPlayers.delete(socket.id);
    io.emit('playerCountUpdate', { count: connectedPlayers.size });
    if (connectedPlayers.size === 0) {
      clearInterval(gameInterval);
      gameActive = false;
      drawnBalls = [];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
