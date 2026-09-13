// ==================== NEXUS - Chat & Video + Group Calls ====================

class NexusApp {
  constructor() {
    this.socket = null;
    this.myId = null;
    this.username = '';
    this.currentRoom = 'general';
    this.users = [];
    this.selectedUserId = null;
    this.soundEnabled = localStorage.getItem('nexus-sound') !== 'off';

    // Chat state
    this.chatMode = 'room'; // 'room' | 'private'
    this.roomMessages = {}; // roomName -> [messages]
    this.privateMessages = {}; // peerId -> [messages]
    this.privateUser = null; // { id, username } when in private chat
    this.unreadPrivate = {}; // peerId -> count

    // 1:1 WebRTC
    this.localStream = null;
    this.pc = null;           // single peer for 1:1
    this.pendingOffer = null;
    this.callingTo = null;
    this.isMuted = false;
    this.isCamOff = false;
    this.isScreenSharing = false;
    this.typingTimeout = null;

    // Group call (mesh)
    this.inGroupCall = false;
    this.groupPeers = new Map(); // peerId -> { pc, username, videoEl }

    this.colors = [
      '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
      '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
    ];

    this.initElements();
    this.bindEvents();
    this.loadTheme();
    this.prefillUsername();
  }

  initElements() {
    this.loginScreen = document.getElementById('login-screen');
    this.appScreen = document.getElementById('app');
    this.usernameInput = document.getElementById('username-input');
    this.joinBtn = document.getElementById('join-btn');
    this.usernameDisplay = document.getElementById('username-display');
    this.myAvatar = document.getElementById('my-avatar');
    this.roomBadge = document.getElementById('room-badge');
    this.connectionStatus = document.getElementById('connection-status');
    this.themeToggle = document.getElementById('theme-toggle');
    this.soundToggle = document.getElementById('sound-toggle');
    this.menuToggle = document.getElementById('menu-toggle');
    this.sidebar = document.getElementById('sidebar');
    this.sidebarOverlay = document.getElementById('sidebar-overlay');
    this.usersList = document.getElementById('users-list');
    this.usersCount = document.getElementById('users-count');
    this.noUsers = document.getElementById('no-users');
    this.roomNameInput = document.getElementById('room-name-input');
    this.joinRoomBtn = document.getElementById('join-room-btn');
    this.roomsList = document.getElementById('rooms-list');
    this.chatTitle = document.getElementById('chat-title');
    this.messagesEl = document.getElementById('messages');
    this.messageInput = document.getElementById('message-input');
    this.sendBtn = document.getElementById('send-btn');
    this.emojiBtn = document.getElementById('emoji-btn');
    this.emojiPicker = document.getElementById('emoji-picker');
    this.typingIndicator = document.getElementById('typing-indicator');
    this.startCallBtn = document.getElementById('start-call-btn');
    this.groupCallBtn = document.getElementById('group-call-btn');
    this.videoArea = document.getElementById('video-area');
    this.videosGrid = document.getElementById('videos-grid');
    this.localVideo = document.getElementById('local-video');
    this.toggleMicBtn = document.getElementById('toggle-mic');
    this.toggleCamBtn = document.getElementById('toggle-cam');
    this.toggleScreenBtn = document.getElementById('toggle-screen');
    this.endCallBtn = document.getElementById('end-call');
    this.callStatus = document.getElementById('call-status');
    this.incomingCallModal = document.getElementById('incoming-call');
    this.callerName = document.getElementById('caller-name');
    this.acceptCallBtn = document.getElementById('accept-call');
    this.rejectCallBtn = document.getElementById('reject-call');
  }

  bindEvents() {
    this.joinBtn.addEventListener('click', () => this.join());
    this.usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') this.join(); });

    this.themeToggle.addEventListener('click', () => this.toggleTheme());
    this.soundToggle.addEventListener('click', () => this.toggleSound());
    if (this.roomBadge) {
      this.roomBadge.style.cursor = 'pointer';
      this.roomBadge.title = 'Volver al chat de la sala';
      this.roomBadge.addEventListener('click', () => this.openRoomChat());
    }

    if (this.menuToggle) {
      this.menuToggle.addEventListener('click', () => this.toggleSidebar());
      this.sidebarOverlay.addEventListener('click', () => this.closeSidebar());
    }

    this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
    this.roomNameInput.addEventListener('keypress', e => { if (e.key === 'Enter') this.joinRoom(); });

    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') this.sendMessage(); });
    this.messageInput.addEventListener('input', () => this.handleTyping());

    this.emojiBtn.addEventListener('click', () => {
      this.emojiPicker.style.display = this.emojiPicker.style.display === 'none' ? 'grid' : 'none';
    });
    this.emojiPicker.querySelectorAll('span').forEach(span => {
      span.addEventListener('click', () => {
        this.messageInput.value += span.textContent;
        this.messageInput.focus();
        this.emojiPicker.style.display = 'none';
      });
    });

    this.startCallBtn.addEventListener('click', () => this.startCall());
    this.groupCallBtn.addEventListener('click', () => this.toggleGroupCall());
    this.toggleMicBtn.addEventListener('click', () => this.toggleMic());
    this.toggleCamBtn.addEventListener('click', () => this.toggleCam());
    this.toggleScreenBtn.addEventListener('click', () => this.toggleScreen());
    this.endCallBtn.addEventListener('click', () => this.endAllCalls());
    this.acceptCallBtn.addEventListener('click', () => this.acceptCall());
    this.rejectCallBtn.addEventListener('click', () => this.rejectCall());

    document.addEventListener('click', e => {
      if (!this.emojiBtn.contains(e.target) && !this.emojiPicker.contains(e.target)) {
        this.emojiPicker.style.display = 'none';
      }
    });
  }

  prefillUsername() {
    const saved = localStorage.getItem('nexus-username');
    if (saved) this.usernameInput.value = saved;
  }

  // ==================== JOIN ====================
  join() {
    const name = this.usernameInput.value.trim();
    if (!name) {
      this.toast('Escribe un nombre de usuario', 'error');
      return;
    }
    this.username = name;
    localStorage.setItem('nexus-username', name);
    this.usernameDisplay.textContent = name;
    this.setAvatar(this.myAvatar, name);

    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      this.myId = this.socket.id;
      this.setConnectionStatus(true);
      this.socket.emit('join', { username: this.username });
    });

    this.socket.on('disconnect', () => {
      this.setConnectionStatus(false);
      this.toast('Desconectado del servidor', 'error');
    });

    this.socket.on('reconnect', () => {
      this.setConnectionStatus(true);
      this.toast('Reconectado', 'success');
      this.socket.emit('join', { username: this.username });
    });

    this.socket.on('joined', (data) => {
      this.loginScreen.classList.remove('active');
      this.appScreen.classList.add('active');
      this.toast(`¡Bienvenido, ${data.username}!`, 'success');
      this.addSystemMessage(`Te has unido a #${data.room}`);
      this.playSound('join');
    });

    this.socket.on('users-list', (list) => this.renderUsers(list));
    this.socket.on('rooms-list', (list) => this.renderRooms(list));

    this.socket.on('chat-message', (msg) => {
      const room = msg.room || this.currentRoom;
      if (!this.roomMessages[room]) this.roomMessages[room] = [];
      this.roomMessages[room].push(msg);
      if (this.chatMode === 'room' && this.currentRoom === room) {
        this.renderMessages();
      }
      if (msg.from !== this.myId) this.playSound('message');
    });

    this.socket.on('private-message', (msg) => {
      const peerId = msg.from === this.myId ? msg.to : msg.from;
      if (!this.privateMessages[peerId]) this.privateMessages[peerId] = [];
      this.privateMessages[peerId].push(msg);

      const viewingThis = this.chatMode === 'private' && this.privateUser && this.privateUser.id === peerId;
      if (viewingThis) {
        this.renderMessages();
      } else if (msg.from !== this.myId) {
        this.unreadPrivate[peerId] = (this.unreadPrivate[peerId] || 0) + 1;
        this.renderUsers(this.users);
        this.toast(`Mensaje privado de ${msg.username}`, 'info');
      }
      if (msg.from !== this.myId) this.playSound('message');
    });

    this.socket.on('typing', (data) => {
      if (data.id === this.myId) return;
      // Only show if relevant to current view
      if (data.private) {
        if (this.chatMode !== 'private' || !this.privateUser || this.privateUser.id !== data.id) return;
      } else {
        if (this.chatMode !== 'room') return;
      }
      this.typingIndicator.style.display = 'flex';
      this.typingIndicator.querySelector('.typing-name').textContent = data.username;
      clearTimeout(this.typingTimeout);
      this.typingTimeout = setTimeout(() => {
        this.typingIndicator.style.display = 'none';
      }, 2000);
    });

    this.socket.on('user-joined', (data) => {
      this.addSystemMessage(`${data.username} se unió`);
      this.playSound('join');
    });

    this.socket.on('user-left', (data) => {
      this.addSystemMessage(`${data.username} se fue`);
    });

    this.socket.on('room-joined', (data) => {
      this.currentRoom = data.room;
      this.roomBadge.textContent = `#${data.room}`;
      this.openRoomChat();
      this.addSystemMessage(`Te uniste a #${data.room}`);
      this.toast(`Sala: #${data.room}`, 'info');
      this.closeSidebar();
      if (this.inGroupCall) this.leaveGroupCall();
    });

    // ===== 1:1 signaling =====
    this.socket.on('incoming-call', async (data) => {
      this.pendingOffer = data;
      this.callerName.textContent = data.fromUsername || 'Alguien';
      this.incomingCallModal.classList.remove('hidden');
      this.playSound('call');
    });

    this.socket.on('call-answered', async (data) => {
      if (this.pc) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        this.callStatus.textContent = 'En llamada 1:1';
      }
    });

    this.socket.on('ice-candidate', async (data) => {
      if (this.pc && data.candidate) {
        try { await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
      }
    });

    this.socket.on('call-ended', () => {
      this.endOneToOne(false);
      this.toast('La otra persona colgó', 'info');
    });

    this.socket.on('call-rejected', () => {
      this.endOneToOne(false);
      this.toast('Llamada rechazada', 'error');
    });

    // ===== GROUP CALL signaling =====
    this.socket.on('group-call-peers', async ({ peers }) => {
      // We just joined; create offers to existing peers
      for (const peer of peers) {
        await this.createGroupPeer(peer.id, peer.username, true);
      }
    });

    this.socket.on('group-peer-joined', async (data) => {
      if (!this.inGroupCall) return;
      // Someone new joined the group call → they will send us an offer
      // (or we can wait). We prepare a slot.
      this.toast(`${data.username} se unió a la llamada grupal`, 'info');
    });

    this.socket.on('group-offer', async (data) => {
      if (!this.inGroupCall) {
        // Auto-join if we receive an offer while not in call? Better require explicit join.
        return;
      }
      await this.handleGroupOffer(data.from, data.fromUsername, data.offer);
    });

    this.socket.on('group-answer', async (data) => {
      const peer = this.groupPeers.get(data.from);
      if (peer && peer.pc) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    this.socket.on('group-ice', async (data) => {
      const peer = this.groupPeers.get(data.from);
      if (peer && peer.pc && data.candidate) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
      }
    });

    this.socket.on('group-peer-left', (data) => {
      this.removeGroupPeer(data.id);
      if (data.username) {
        this.toast(`${data.username} salió de la llamada`, 'info');
      }
    });
  }

  // ==================== AVATARS ====================
  getColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return this.colors[Math.abs(hash) % this.colors.length];
  }

  getInitials(name) {
    return (name || '?').substring(0, 2).toUpperCase();
  }

  setAvatar(el, name) {
    if (!el) return;
    el.textContent = this.getInitials(name);
    el.style.background = this.getColor(name);
  }

  // ==================== USERS & ROOMS ====================
  renderUsers(list) {
    this.users = list;
    const others = list.filter(u => u.id !== this.myId);
    this.usersCount.textContent = others.length;
    this.usersList.innerHTML = '';

    this.noUsers.style.display = others.length === 0 ? 'block' : 'none';

    others.forEach(user => {
      const li = document.createElement('li');
      li.dataset.userId = user.id;
      if (this.selectedUserId === user.id) li.classList.add('active');

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      this.setAvatar(avatar, user.username);
      li.appendChild(avatar);

      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `
        <div class="name">${this.escapeHtml(user.username)}</div>
        <div class="meta">#${this.escapeHtml(user.room)}</div>
      `;
      li.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'contact-actions';
      actions.innerHTML = `<button class="icon-btn call-contact" title="Llamar 1:1"><i class="fas fa-video"></i></button>`;
      li.appendChild(actions);

      // Unread badge
      const unread = this.unreadPrivate[user.id] || 0;
      if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'unread-badge';
        badge.textContent = unread > 9 ? '9+' : unread;
        li.appendChild(badge);
      }

      li.addEventListener('click', (e) => {
        if (e.target.closest('.call-contact')) {
          this.selectedUserId = user.id;
          this.startCallBtn.disabled = false;
          this.startCall();
          return;
        }
        // Open private chat
        this.selectedUserId = user.id;
        this.startCallBtn.disabled = false;
        this.startCallBtn.title = `Llamar a ${user.username}`;
        this.openPrivateChat(user.id, user.username);
        this.renderUsers(this.users);
      });

      this.usersList.appendChild(li);
    });
  }

  renderRooms(list) {
    this.roomsList.innerHTML = '';
    list.forEach(room => {
      const li = document.createElement('li');
      if (room.name === this.currentRoom) li.classList.add('active');
      li.innerHTML = `
        <div class="info">
          <div class="name"><i class="fas fa-hashtag"></i> ${this.escapeHtml(room.name)}</div>
          <div class="meta">${room.count} online</div>
        </div>
      `;
      li.addEventListener('click', () => {
        this.roomNameInput.value = room.name;
        this.joinRoom();
      });
      this.roomsList.appendChild(li);
    });
  }

  joinRoom() {
    const name = this.roomNameInput.value.trim();
    if (!name) return;
    this.socket.emit('join-room', name);
    this.roomNameInput.value = '';
  }

  // ==================== CHAT ====================
  openRoomChat() {
    this.chatMode = 'room';
    this.privateUser = null;
    this.chatTitle.innerHTML = `<i class="fas fa-hashtag"></i> <span>${this.escapeHtml(this.currentRoom)}</span>`;
    this.messageInput.placeholder = `Mensaje en #${this.currentRoom}...`;
    this.renderMessages();
  }

  openPrivateChat(userId, username) {
    this.chatMode = 'private';
    this.privateUser = { id: userId, username };
    this.unreadPrivate[userId] = 0;
    this.chatTitle.innerHTML = `
      <button class="icon-btn back-room" title="Volver a la sala" id="back-to-room">
        <i class="fas fa-arrow-left"></i>
      </button>
      <i class="fas fa-user"></i>
      <span>${this.escapeHtml(username)}</span>
      <span class="dm-badge">privado</span>`;
    this.messageInput.placeholder = `Mensaje privado a ${username}...`;
    // Bind back button
    setTimeout(() => {
      const btn = document.getElementById('back-to-room');
      if (btn) btn.onclick = () => this.openRoomChat();
    }, 0);
    this.renderMessages();
    this.closeSidebar();
  }

  getCurrentMessages() {
    if (this.chatMode === 'private' && this.privateUser) {
      return this.privateMessages[this.privateUser.id] || [];
    }
    return this.roomMessages[this.currentRoom] || [];
  }

  sendMessage() {
    const text = this.messageInput.value.trim();
    if (!text || !this.socket) return;

    if (this.chatMode === 'private' && this.privateUser) {
      this.socket.emit('private-message', { to: this.privateUser.id, text });
    } else {
      this.socket.emit('chat-message', { text });
    }
    this.messageInput.value = '';
  }

  handleTyping() {
    if (!this.socket) return;
    if (this.chatMode === 'private' && this.privateUser) {
      this.socket.emit('typing', { to: this.privateUser.id });
    } else {
      this.socket.emit('typing', {});
    }
  }

  renderMessages() {
    this.messagesEl.innerHTML = '';
    const msgs = this.getCurrentMessages();
    if (msgs.length === 0) {
      const hint = this.chatMode === 'private'
        ? `Chat privado con ${this.privateUser ? this.privateUser.username : ''}`
        : `Escribe un mensaje en #${this.currentRoom}`;
      this.messagesEl.innerHTML = `
        <div class="empty-chat">
          <i class="fas fa-${this.chatMode === 'private' ? 'user' : 'comments'}"></i>
          <p>${this.escapeHtml(hint)}</p>
        </div>`;
      return;
    }
    msgs.forEach(msg => {
      const div = document.createElement('div');
      const isOwn = msg.from === this.myId;
      div.className = `message ${isOwn ? 'own' : 'other'}`;
      const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = `
        ${!isOwn ? `<div class="sender">${this.escapeHtml(msg.username)}</div>` : ''}
        <div class="text">${this.escapeHtml(msg.text)}</div>
        <div class="time">${time}</div>
      `;
      this.messagesEl.appendChild(div);
    });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  addSystemMessage(text) {
    // System messages only for room chat
    if (this.chatMode !== 'room') return;
    if (!this.roomMessages[this.currentRoom]) this.roomMessages[this.currentRoom] = [];
    // Don't store system in history array, just display
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = text;
    const empty = this.messagesEl.querySelector('.empty-chat');
    if (empty) empty.remove();
    this.messagesEl.appendChild(div);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  // ==================== 1:1 WEBRTC ====================
  async createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    return pc;
  }

  async startCall() {
    if (!this.selectedUserId) {
      this.toast('Selecciona un usuario primero', 'error');
      return;
    }
    if (this.inGroupCall) {
      this.toast('Sal de la llamada grupal primero', 'error');
      return;
    }
    try {
      await this.ensureLocalStream();
      this.pc = await this.createPeerConnection();
      this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

      this.pc.onicecandidate = (e) => {
        if (e.candidate && this.callingTo) {
          this.socket.emit('ice-candidate', { to: this.callingTo, candidate: e.candidate });
        }
      };
      this.pc.ontrack = (e) => {
        this.addRemoteVideo('1to1', 'Remoto', e.streams[0]);
      };
      this.pc.onconnectionstatechange = () => {
        if (this.pc && (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed')) {
          this.endOneToOne(false);
        }
      };

      this.callingTo = this.selectedUserId;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.socket.emit('call-user', {
        to: this.selectedUserId,
        offer: this.pc.localDescription,
        fromUsername: this.username
      });

      this.showVideoArea(false);
      this.callStatus.textContent = 'Llamando...';
      const target = this.users.find(u => u.id === this.selectedUserId);
      this.callStatus.textContent = target ? `Llamando a ${target.username}...` : 'Llamando...';
    } catch (err) {
      console.error(err);
      this.toast('No se pudo acceder a cámara/micrófono', 'error');
    }
  }

  async acceptCall() {
    this.incomingCallModal.classList.add('hidden');
    if (!this.pendingOffer) return;
    if (this.inGroupCall) this.leaveGroupCall();

    try {
      await this.ensureLocalStream();
      this.pc = await this.createPeerConnection();
      this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

      this.pc.onicecandidate = (e) => {
        if (e.candidate && this.callingTo) {
          this.socket.emit('ice-candidate', { to: this.callingTo, candidate: e.candidate });
        }
      };
      this.pc.ontrack = (e) => {
        this.addRemoteVideo('1to1', this.pendingOffer.fromUsername || 'Remoto', e.streams[0]);
      };

      this.callingTo = this.pendingOffer.from;
      await this.pc.setRemoteDescription(new RTCSessionDescription(this.pendingOffer.offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.socket.emit('answer-call', {
        to: this.pendingOffer.from,
        answer: this.pc.localDescription
      });

      this.showVideoArea(false);
      this.callStatus.textContent = 'En llamada 1:1';
      this.pendingOffer = null;
    } catch (err) {
      console.error(err);
      this.toast('Error al aceptar la llamada', 'error');
    }
  }

  rejectCall() {
    if (this.pendingOffer) {
      this.socket.emit('reject-call', { to: this.pendingOffer.from });
      this.pendingOffer = null;
    }
    this.incomingCallModal.classList.add('hidden');
  }

  endOneToOne(notify = true) {
    if (notify && this.callingTo) {
      this.socket.emit('end-call', { to: this.callingTo });
    }
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.callingTo = null;
    this.removeRemoteVideo('1to1');
    if (!this.inGroupCall) {
      this.hideVideoArea();
      this.stopLocalStream();
    }
  }

  // ==================== GROUP CALL (MESH) ====================
  async toggleGroupCall() {
    if (this.inGroupCall) {
      this.leaveGroupCall();
    } else {
      await this.joinGroupCall();
    }
  }

  async joinGroupCall() {
    if (this.pc) this.endOneToOne(true); // leave 1:1 first

    try {
      await this.ensureLocalStream();
      this.inGroupCall = true;
      this.groupCallBtn.classList.add('active');
      this.groupCallBtn.innerHTML = '<i class="fas fa-phone-slash"></i> <span class="btn-text">Salir</span>';
      this.showVideoArea(true);
      this.callStatus.textContent = 'Llamada grupal';
      this.socket.emit('group-call-join');
      this.toast('Te uniste a la llamada grupal', 'success');
      this.playSound('join');
    } catch (err) {
      console.error(err);
      this.toast('No se pudo acceder a cámara/micrófono', 'error');
      this.inGroupCall = false;
    }
  }

  leaveGroupCall() {
    this.socket.emit('group-call-leave');
    this.groupPeers.forEach((peer, id) => {
      if (peer.pc) peer.pc.close();
      this.removeRemoteVideo(id);
    });
    this.groupPeers.clear();
    this.inGroupCall = false;
    this.groupCallBtn.classList.remove('active');
    this.groupCallBtn.innerHTML = '<i class="fas fa-users"></i> <span class="btn-text">Grupal</span>';
    this.hideVideoArea();
    this.stopLocalStream();
    this.toast('Saliste de la llamada grupal', 'info');
  }

  async createGroupPeer(peerId, username, isInitiator) {
    if (this.groupPeers.has(peerId) || peerId === this.myId) return;

    const pc = await this.createPeerConnection();
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('group-ice', { to: peerId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      this.addRemoteVideo(peerId, username, e.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removeGroupPeer(peerId);
      }
    };

    this.groupPeers.set(peerId, { pc, username });

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('group-offer', {
        to: peerId,
        offer: pc.localDescription,
        fromUsername: this.username
      });
    }
  }

  async handleGroupOffer(fromId, fromUsername, offer) {
    await this.createGroupPeer(fromId, fromUsername, false);
    const peer = this.groupPeers.get(fromId);
    if (!peer) return;

    await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.socket.emit('group-answer', { to: fromId, answer: peer.pc.localDescription });
  }

  removeGroupPeer(peerId) {
    const peer = this.groupPeers.get(peerId);
    if (peer) {
      if (peer.pc) peer.pc.close();
      this.groupPeers.delete(peerId);
    }
    this.removeRemoteVideo(peerId);
    this.updateGridClass();
  }

  // ==================== VIDEO UI HELPERS ====================
  async ensureLocalStream() {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localVideo.srcObject = this.localStream;
    }
  }

  stopLocalStream() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    this.localVideo.srcObject = null;
    this.isMuted = false;
    this.isCamOff = false;
    this.isScreenSharing = false;
    this.toggleMicBtn.classList.add('active');
    this.toggleMicBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    this.toggleCamBtn.classList.add('active');
    this.toggleCamBtn.innerHTML = '<i class="fas fa-video"></i>';
    this.toggleScreenBtn.classList.remove('active');
  }

  showVideoArea(isGroup) {
    this.videoArea.classList.remove('hidden');
    if (isGroup) this.videoArea.classList.add('group-mode');
    else this.videoArea.classList.remove('group-mode');
    this.updateGridClass();
  }

  hideVideoArea() {
    // Only hide if no active calls
    if (!this.pc && !this.inGroupCall) {
      this.videoArea.classList.add('hidden');
      this.videoArea.classList.remove('group-mode');
      // Clean remote videos except local
      const remotes = this.videosGrid.querySelectorAll('.video-wrapper.remote');
      remotes.forEach(el => el.remove());
    }
  }

  addRemoteVideo(id, label, stream) {
    let wrapper = document.getElementById(`remote-${id}`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'video-wrapper remote';
      wrapper.id = `remote-${id}`;
      wrapper.innerHTML = `
        <video autoplay playsinline></video>
        <span class="video-label">${this.escapeHtml(label)}</span>
      `;
      this.videosGrid.appendChild(wrapper);
    }
    const video = wrapper.querySelector('video');
    video.srcObject = stream;
    this.updateGridClass();
  }

  removeRemoteVideo(id) {
    const el = document.getElementById(`remote-${id}`);
    if (el) el.remove();
    this.updateGridClass();
  }

  updateGridClass() {
    const count = this.videosGrid.querySelectorAll('.video-wrapper').length;
    this.videosGrid.className = 'videos-grid';
    if (count >= 2) this.videosGrid.classList.add(`count-${Math.min(count, 6)}`);
  }

  endAllCalls() {
    if (this.inGroupCall) this.leaveGroupCall();
    else this.endOneToOne(true);
  }

  // ==================== MEDIA CONTROLS ====================
  toggleMic() {
    if (!this.localStream) return;
    const track = this.localStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      this.isMuted = !track.enabled;
      this.toggleMicBtn.classList.toggle('active', !this.isMuted);
      this.toggleMicBtn.innerHTML = this.isMuted
        ? '<i class="fas fa-microphone-slash"></i>'
        : '<i class="fas fa-microphone"></i>';
    }
  }

  toggleCam() {
    if (!this.localStream) return;
    const track = this.localStream.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      this.isCamOff = !track.enabled;
      this.toggleCamBtn.classList.toggle('active', !this.isCamOff);
      this.toggleCamBtn.innerHTML = this.isCamOff
        ? '<i class="fas fa-video-slash"></i>'
        : '<i class="fas fa-video"></i>';
    }
  }

  async toggleScreen() {
    const activePc = this.pc || (this.groupPeers.size > 0 ? [...this.groupPeers.values()][0].pc : null);
    if (!activePc && !this.inGroupCall) return;

    try {
      if (!this.isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        // Replace video track in all connections
        const replace = (pc) => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        };
        if (this.pc) replace(this.pc);
        this.groupPeers.forEach(p => replace(p.pc));

        this.localVideo.srcObject = screenStream;
        this.isScreenSharing = true;
        this.toggleScreenBtn.classList.add('active');
        screenTrack.onended = () => this.stopScreenShare();
      } else {
        this.stopScreenShare();
      }
    } catch (err) {
      this.toast('No se pudo compartir pantalla', 'error');
    }
  }

  async stopScreenShare() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    const replace = (pc) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) sender.replaceTrack(videoTrack);
    };
    if (this.pc) replace(this.pc);
    this.groupPeers.forEach(p => replace(p.pc));
    this.localVideo.srcObject = this.localStream;
    this.isScreenSharing = false;
    this.toggleScreenBtn.classList.remove('active');
  }

  // ==================== UTILS ====================
  setConnectionStatus(online) {
    if (!this.connectionStatus) return;
    this.connectionStatus.className = `conn-status ${online ? 'online' : 'offline'}`;
    this.connectionStatus.title = online ? 'Conectado' : 'Desconectado';
  }

  toggleSidebar() {
    this.sidebar.classList.toggle('open');
    this.sidebarOverlay.classList.toggle('active');
  }

  closeSidebar() {
    this.sidebar.classList.remove('open');
    this.sidebarOverlay.classList.remove('active');
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem('nexus-sound', this.soundEnabled ? 'on' : 'off');
    this.soundToggle.innerHTML = this.soundEnabled
      ? '<i class="fas fa-volume-up"></i>'
      : '<i class="fas fa-volume-mute"></i>';
    this.toast(this.soundEnabled ? 'Sonido activado' : 'Sonido desactivado', 'info');
  }

  playSound(type) {
    if (!this.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'message') {
        osc.frequency.value = 800; gain.gain.value = 0.08;
        osc.start(); osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'call') {
        osc.frequency.value = 600; gain.gain.value = 0.12;
        osc.start(); setTimeout(() => { osc.frequency.value = 900; }, 150);
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === 'join') {
        osc.frequency.value = 500; gain.gain.value = 0.06;
        osc.start(); osc.stop(ctx.currentTime + 0.08);
      }
    } catch (e) {}
  }

  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    if (next === 'light') html.setAttribute('data-theme', 'light');
    else html.removeAttribute('data-theme');
    localStorage.setItem('nexus-theme', next);
    this.themeToggle.innerHTML = next === 'light' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  }

  loadTheme() {
    const saved = localStorage.getItem('nexus-theme') || 'dark';
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      this.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }
    this.soundToggle.innerHTML = this.soundEnabled
      ? '<i class="fas fa-volume-up"></i>'
      : '<i class="fas fa-volume-mute"></i>';
  }

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.nexus = new NexusApp();
});
