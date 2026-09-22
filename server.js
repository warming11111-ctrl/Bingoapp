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

// Store room states
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: {},       // socket.id -> { name, board }
      calledNumbers: [],
      availableNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      timer: null,
      gameActive: false,
      winner: null
    };
  }
  return rooms[roomId];
}

function startRoomGame(roomId) {
  const room = rooms[roomId];
  if (room.timer) clearInterval(room.timer);

  room.calledNumbers = [];
  room.availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
  room.gameActive = true;
  room.winner = null;

  io.to(roomId).emit('gameReset');

  // Draw a new ball every 4 seconds
  room.timer = setInterval(() => {
    if (!room.gameActive || room.availableNumbers.length === 0) {
      clearInterval(room.timer);
      room.timer = null;
      return;
    }

    const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
    const drawnNumber = room.availableNumbers.splice(randomIndex, 1)[0];
    room.calledNumbers.push(drawnNumber);

    io.to(roomId).emit('ballDrawn', {
      number: drawnNumber,
      history: room.calledNumbers
    });
  }, 4000);
}

// Server-side win validation
function validateBingo(board, calledNumbers) {
  if (!board || board.length !== 25) return false;

  const calledSet = new Set(calledNumbers);
  
  // Cell 12 is FREE space
  const isMarked = (idx) => idx === 12 || calledSet.has(board[idx]);

  const winningLines = [
    // Rows
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    // Columns
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    // Diagonals
    [0,6,12,18,24], [4,8,12,16,20]
  ];

  return winningLines.some(line => line.every(idx => isMarked(idx)));
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('joinRoom', ({ roomId, playerName, board }) => {
    const cleanRoomId = (roomId || 'global').toLowerCase();

    if (currentRoomId) {
      socket.leave(currentRoomId);
    }

    currentRoomId = cleanRoomId;
    socket.join(currentRoomId);

    const room = getOrCreateRoom(currentRoomId);
    room.players[socket.id] = { name: playerName, board };

    const playerCount = Object.keys(room.players).length;

    // Send current room status
    socket.emit('gameState', {
      roomId: currentRoomId,
      currentNumber: room.calledNumbers[room.calledNumbers.length - 1] || null,
      calledNumbers: room.calledNumbers,
      playersCount: playerCount,
      winner: room.winner
    });

    io.to(currentRoomId).emit('playerCountUpdate', playerCount);

    // Auto-start game if not already running
    if (!room.gameActive && !room.timer) {
      startRoomGame(currentRoomId);
    }
  });

  socket.on('registerBoard', ({ board }) => {
    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].players[socket.id]) {
      rooms[currentRoomId].players[socket.id].board = board;
    }
  });

  socket.on('claimBingo', ({ playerName }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;

    const room = rooms[currentRoomId];
    if (!room.gameActive) return;

    const player = room.players[socket.id];
    const playerBoard = player ? player.board : null;

    // Validate if claim is real
    const isValidWin = validateBingo(playerBoard, room.calledNumbers);

    if (isValidWin) {
      room.gameActive = false;
      room.winner = playerName;

      if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
      }

      // Notify all players in room of official winner
      io.to(currentRoomId).emit('gameWinner', { name: playerName, valid: true });

      // Restart game after 10 seconds
      setTimeout(() => {
        if (rooms[currentRoomId]) {
          startRoomGame(currentRoomId);
        }
      }, 10000);
    } else {
      // Reject fake BINGO claim
      socket.emit('bingoRejected', { reason: "Invalid BINGO! You don't have a completed winning line from called numbers." });
    }
  });

  socket.on('sendChat', ({ text, sender }) => {
    if (currentRoomId) {
      io.to(currentRoomId).emit('chatMessage', { text, sender });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoomId && rooms[currentRoomId]) {
      delete rooms[currentRoomId].players[socket.id];
      const count = Object.keys(rooms[currentRoomId].players).length;
      io.to(currentRoomId).emit('playerCountUpdate', count);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo Server running on port ${PORT}`);
});
