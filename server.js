const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Enable CORS for frontend connection
app.use(cors());

// Serve static frontend files (index.html, CSS, JS) from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('A player connected:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);
    console.log(`${playerName} joined room: ${roomId}`);
  });

  socket.on('selectBoard', (data) => {
    console.log('Board selected by player:', socket.id);
  });

  socket.on('claimBingo', (data) => {
    console.log('Bingo claimed by:', data.playerName);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
