const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== STATE ====================
const users = new Map(); // socketId -> { id, username, room }
const rooms = new Map(); // roomName -> Set of socketIds

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log(`Usuario conectado: ${socket.id}`);

  socket.on('join', ({ username }) => {
    if (!username || username.trim().length === 0) return;

    const user = {
      id: socket.id,
      username: username.trim().substring(0, 20),
      room: 'general'
    };

    users.set(socket.id, user);
    socket.join('general');

    if (!rooms.has('general')) {
      rooms.set('general', new Set());
    }
    rooms.get('general').add(socket.id);

    io.emit('users-list', getUsersList());
    socket.to('general').emit('user-joined', {
      username: user.username,
      id: socket.id
    });

    socket.emit('joined', {
      id: socket.id,
      username: user.username,
      room: 'general'
    });

    console.log(`${user.username} se unió`);
  });

  // Room chat
  socket.on('chat-message', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      username: user.username,
      text: (data.text || '').substring(0, 1000),
      time: new Date().toISOString(),
      from: socket.id,
      room: user.room,
      type: 'room'
    };

    io.to(user.room).emit('chat-message', message);
  });

  // Private chat (DM)
  socket.on('private-message', (data) => {
    const user = users.get(socket.id);
    if (!user || !data.to) return;

    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      username: user.username,
      text: (data.text || '').substring(0, 1000),
      time: new Date().toISOString(),
      from: socket.id,
      to: data.to,
      type: 'private'
    };

    // Send to recipient and back to sender
    io.to(data.to).emit('private-message', message);
    socket.emit('private-message', message);
  });

  socket.on('typing', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (data && data.to) {
      // Private typing
      io.to(data.to).emit('typing', {
        username: user.username,
        id: socket.id,
        private: true
      });
    } else {
      // Room typing
      socket.to(user.room).emit('typing', {
        username: user.username,
        id: socket.id,
        private: false
      });
    }
  });

  socket.on('join-room', (roomName) => {
    const user = users.get(socket.id);
    if (!user || !roomName) return;

    roomName = roomName.trim().toLowerCase().substring(0, 30);
    if (!roomName) return;

    if (user.room) {
      socket.leave(user.room);
      const prevRoom = rooms.get(user.room);
      if (prevRoom) {
        prevRoom.delete(socket.id);
        if (prevRoom.size === 0 && user.room !== 'general') {
          rooms.delete(user.room);
        }
      }
      socket.to(user.room).emit('user-left-room', {
        username: user.username,
        id: socket.id
      });
      // Notify room that user left any active group call
      socket.to(user.room).emit('group-peer-left', {
        id: socket.id,
        username: user.username
      });
    }

    user.room = roomName;
    socket.join(roomName);

    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Set());
    }
    rooms.get(roomName).add(socket.id);

    socket.emit('room-joined', { room: roomName });
    socket.to(roomName).emit('user-joined-room', {
      username: user.username,
      id: socket.id
    });

    io.emit('rooms-list', getRoomsList());
    io.emit('users-list', getUsersList());
  });

  // ========== 1:1 WEBRTC SIGNALING ==========
  socket.on('call-user', ({ to, offer, fromUsername }) => {
    io.to(to).emit('incoming-call', {
      from: socket.id,
      offer,
      fromUsername
    });
  });

  socket.on('answer-call', ({ to, answer }) => {
    io.to(to).emit('call-answered', {
      from: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  socket.on('end-call', ({ to }) => {
    io.to(to).emit('call-ended', { from: socket.id });
  });

  socket.on('reject-call', ({ to }) => {
    io.to(to).emit('call-rejected', { from: socket.id });
  });

  // ========== GROUP CALL SIGNALING (mesh) ==========
  // User starts or joins a group call in their current room
  socket.on('group-call-join', () => {
    const user = users.get(socket.id);
    if (!user) return;

    // Tell everyone else in the room that this user joined the group call
    socket.to(user.room).emit('group-peer-joined', {
      id: socket.id,
      username: user.username
    });

    // Also tell the joiner who is already in the room (so they can create offers)
    const roomMembers = rooms.get(user.room);
    if (roomMembers) {
      const peers = [];
      roomMembers.forEach(id => {
        if (id !== socket.id) {
          const u = users.get(id);
          if (u) peers.push({ id, username: u.username });
        }
      });
      socket.emit('group-call-peers', { peers });
    }
  });

  socket.on('group-offer', ({ to, offer, fromUsername }) => {
    io.to(to).emit('group-offer', {
      from: socket.id,
      offer,
      fromUsername
    });
  });

  socket.on('group-answer', ({ to, answer }) => {
    io.to(to).emit('group-answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('group-ice', ({ to, candidate }) => {
    io.to(to).emit('group-ice', {
      from: socket.id,
      candidate
    });
  });

  socket.on('group-call-leave', () => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('group-peer-left', {
      id: socket.id,
      username: user.username
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const roomSet = rooms.get(user.room);
      if (roomSet) {
        roomSet.delete(socket.id);
        if (roomSet.size === 0 && user.room !== 'general') {
          rooms.delete(user.room);
        }
      }

      // Notify group call peers
      socket.to(user.room).emit('group-peer-left', {
        id: socket.id,
        username: user.username
      });

      users.delete(socket.id);

      io.emit('users-list', getUsersList());
      io.emit('rooms-list', getRoomsList());
      socket.to(user.room).emit('user-left', {
        username: user.username,
        id: socket.id
      });

      console.log(`${user.username} se desconectó`);
    }
  });
});

function getUsersList() {
  return Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    room: u.room
  }));
}

function getRoomsList() {
  const list = [];
  rooms.forEach((members, name) => {
    list.push({
      name,
      count: members.size
    });
  });
  return list;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Nexus corriendo en el puerto ${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Red:     http://IP-DE-LA-RASPBERRY:${PORT}`);
  console.log(`   (usa hostname -I para ver tu IP)\n`);
});
