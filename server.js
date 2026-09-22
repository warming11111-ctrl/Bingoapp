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

const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    calledNumbers: [],
    currentNumber: null,
    players: {},
    isPlaying: false,
    timer: null
  };
}

function startRoomCaller(roomId) {
  const room = rooms[roomId];
  if (!room || room.isPlaying) return;
  
  room.isPlaying = true;
  room.calledNumbers = [];

  room.timer = setInterval(() => {
    if (!rooms[roomId] || room.calledNumbers.length >= 75) {
      clearInterval(room.timer);
      if (rooms[roomId]) room.isPlaying = false;
      return;
    }

    let num;
    do {
      num = Math.floor(Math.random() * 75) + 1;
    } while (room.calledNumbers.includes(num));

    room.calledNumbers.push(num);
    room.currentNumber = num;

    io.to(roomId).emit('ballDrawn', {
      number: num,
      history: room.calledNumbers
    });
  }, 4000);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const roomKey = roomId || 'global';
    
    if (!rooms[roomKey]) {
      rooms[roomKey] = createRoom(roomKey);
    }

    currentRoom = roomKey;
    socket.join(roomKey);

    const room = rooms[roomKey];
    room.players[socket.id] = { name: playerName, id: socket.id };

    socket.emit('gameState', {
      roomId: roomKey,
      currentNumber: room.currentNumber,
      calledNumbers: room.calledNumbers,
      playersCount: Object.keys(room.players).length
    });

    io.to(roomKey).emit('playerCountUpdate', Object.keys(room.players).length);

    if (!room.isPlaying) {
      startRoomCaller(roomKey);
    }
  });

  socket.on('sendChat', ({ text, sender }) => {
    if (currentRoom) {
      io.to(currentRoom).emit('chatMessage', { text, sender });
    }
  });

  socket.on('claimBingo', ({ playerName }) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    
    const room = rooms[currentRoom];
    io.to(currentRoom).emit('gameWinner', { name: playerName });
    clearInterval(room.timer);
    room.isPlaying = false;
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      delete room.players[socket.id];
      
      const remaining = Object.keys(room.players).length;
      io.to(currentRoom).emit('playerCountUpdate', remaining);

      if (remaining === 0 && currentRoom !== 'global') {
        clearInterval(room.timer);
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo Ultimate server running on port ${PORT}`);
});
