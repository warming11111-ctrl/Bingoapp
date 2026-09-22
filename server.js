const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Multiplayer Game Room State
const gameState = {
  calledNumbers: [],
  currentNumber: null,
  players: {},
  isPlaying: false,
  timer: null
};

function startBallCaller() {
  if (gameState.isPlaying) return;
  gameState.isPlaying = true;
  gameState.calledNumbers = [];

  gameState.timer = setInterval(() => {
    if (gameState.calledNumbers.length >= 75) {
      clearInterval(gameState.timer);
      gameState.isPlaying = false;
      return;
    }

    let num;
    do {
      num = Math.floor(Math.random() * 75) + 1;
    } while (gameState.calledNumbers.includes(num));

    gameState.calledNumbers.push(num);
    gameState.currentNumber = num;

    io.emit('ballDrawn', {
      number: num,
      history: gameState.calledNumbers
    });
  }, 4000); // Draws a new ball every 4 seconds
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send current state to newly joined player
  socket.emit('gameState', {
    currentNumber: gameState.currentNumber,
    calledNumbers: gameState.calledNumbers,
    playersCount: Object.keys(gameState.players).length + 1
  });

  socket.on('joinGame', (playerData) => {
    gameState.players[socket.id] = playerData;
    io.emit('playerCountUpdate', Object.keys(gameState.players).length);

    // Auto-start caller if players are connected
    if (!gameState.isPlaying) {
      startBallCaller();
    }
  });

  socket.on('claimBingo', (playerData) => {
    io.emit('gameWinner', playerData);
    clearInterval(gameState.timer);
    gameState.isPlaying = false;
  });

  socket.on('disconnect', () => {
    delete gameState.players[socket.id];
    io.emit('playerCountUpdate', Object.keys(gameState.players).length);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo multiplayer server active on port ${PORT}`);
});
