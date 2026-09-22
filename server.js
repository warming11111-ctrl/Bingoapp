const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const TOTAL_PRIZE_POOL = 1000;
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: {}, // socket.id -> { name, board, boardSelected: bool, strikes: number }
      calledNumbers: [],
      availableNumbers: Array.from({ length: 75 }, (_, i) => i + 1),
      timer: null,
      gameActive: false,
      claimWindowTimer: null,
      claims: [],
      lastDrawnNumber: null
    };
  }
  return rooms[roomId];
}

function validateBingo(board, calledNumbers) {
  if (!board || board.length !== 25) return false;
  const calledSet = new Set(calledNumbers);
  const isMarked = (idx) => idx === 12 || calledSet.has(board[idx]);

  const winningLines = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20]
  ];

  return winningLines.some(line => line.every(idx => isMarked(idx)));
}

function startRoomGame(roomId) {
  const room = rooms[roomId];
  if (room.timer) clearInterval(room.timer);

  room.calledNumbers = [];
  room.availableNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
  room.gameActive = true;
  room.claims = [];
  room.claimWindowTimer = null;

  // Reset strikes for all active players when starting a new game
  Object.keys(room.players).forEach(sId => {
    room.players[sId].strikes = 0;
  });

  io.to(roomId).emit('gameReset');

  room.timer = setInterval(() => {
    if (!room.gameActive || room.availableNumbers.length === 0) {
      clearInterval(room.timer);
      room.timer = null;
      return;
    }

    const randomIndex = Math.floor(Math.random() * room.availableNumbers.length);
    const drawnNumber = room.availableNumbers.splice(randomIndex, 1)[0];
    room.calledNumbers.push(drawnNumber);
    room.lastDrawnNumber = drawnNumber;

    io.to(roomId).emit('ballDrawn', {
      number: drawnNumber,
      history: room.calledNumbers
    });
  }, 4000);
}

function processRoomWinners(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.gameActive = false;
  if (room.timer) { clearInterval(room.timer); room.timer = null; }

  Object.keys(room.players).forEach(sId => {
    const p = room.players[sId];
    const alreadyClaimed = room.claims.some(c => c.socketId === sId);
    if (!alreadyClaimed && validateBingo(p.board, room.calledNumbers)) {
      room.claims.push({
        socketId: sId,
        name: p.name,
        timestamp: Date.now(),
        manualPress: false
      });
    }
  });

  if (room.claims.length === 0) return;

  let payouts = [];
  if (room.claims.length === 1) {
    payouts.push({
      name: room.claims[0].name,
      amount: TOTAL_PRIZE_POOL,
      type: "First Winner (100%)",
      manualPress: room.claims[0].manualPress
    });
  } else {
    const firstWinner = room.claims[0];
    payouts.push({
      name: firstWinner.name,
      amount: Math.round(TOTAL_PRIZE_POOL * 0.6),
      type: "First Claim (60%)",
      manualPress: firstWinner.manualPress
    });

    const otherWinners = room.claims.slice(1);
    const remainingAmount = TOTAL_PRIZE_POOL * 0.4;
    const splitShare = Math.round(remainingAmount / otherWinners.length);

    otherWinners.forEach(w => {
      payouts.push({
        name: w.name,
        amount: splitShare,
        type: w.manualPress ? "Secondary Claim (Split Share)" : "Valid Winning Card (Split Share)",
        manualPress: w.manualPress
      });
    });
  }

  io.to(roomId).emit('gameFinishedWithWinners', { payouts, totalPool: TOTAL_PRIZE_POOL });

  setTimeout(() => {
    if (rooms[roomId]) startRoomGame(roomId);
  }, 12000);
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const cleanRoomId = (roomId || 'global').toLowerCase();
    if (currentRoomId) socket.leave(currentRoomId);

    currentRoomId = cleanRoomId;
    socket.join(currentRoomId);

    const room = getOrCreateRoom(currentRoomId);
    room.players[socket.id] = { name: playerName, board: null, boardSelected: false, strikes: 0 };

    const playerCount = Object.keys(room.players).length;

    socket.emit('gameState', {
      roomId: currentRoomId,
      currentNumber: room.calledNumbers[room.calledNumbers.length - 1] || null,
      calledNumbers: room.calledNumbers,
      playersCount: playerCount
    });

    io.to(currentRoomId).emit('playerCountUpdate', playerCount);
  });

  socket.on('selectBoard', ({ board }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.players[socket.id]) {
      room.players[socket.id].board = board;
      room.players[socket.id].boardSelected = true;
    }

    if (!room.gameActive && !room.timer) {
      startRoomGame(currentRoomId);
    }
  });

  socket.on('claimBingo', ({ playerName }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (!room.gameActive) return;

    const player = room.players[socket.id];
    if (!player || !player.board) return;

    const isValid = validateBingo(player.board, room.calledNumbers);

    if (isValid) {
      const alreadyIn = room.claims.some(c => c.socketId === socket.id);
      if (!alreadyIn) {
        room.claims.push({
          socketId: socket.id,
          name: playerName,
          timestamp: Date.now(),
          manualPress: true
        });
      }

      if (!room.claimWindowTimer) {
        io.to(currentRoomId).emit('bingoClaimedFirst', { winnerName: playerName });
        room.claimWindowTimer = setTimeout(() => {
          processRoomWinners(currentRoomId);
        }, 5000);
      } else {
        socket.emit('claimAccepted', { position: room.claims.length });
      }
    } else {
      // Increment penalty strike count
      player.strikes = (player.strikes || 0) + 1;

      if (player.strikes >= 2) {
        // 2nd strike: Remove/kick player from the current match
        delete room.players[socket.id];
        socket.leave(currentRoomId);

        const count = Object.keys(room.players).length;
        io.to(currentRoomId).emit('playerCountUpdate', count);

        socket.emit('playerKicked', {
          reason: "You were removed from the game for making two false BINGO claims."
        });
      } else {
        // 1st strike: Apply 3-second penalty lock
        socket.emit('falseBingoPenalty', {
          strikes: player.strikes,
          penaltyDuration: 3,
          reason: "False BINGO claim! You are penalized for 3 seconds. Doing this again will kick you from the game."
        });
      }
    }
  });

  socket.on('sendChat', ({ text, sender }) => {
    if (currentRoomId) io.to(currentRoomId).emit('chatMessage', { text, sender });
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
