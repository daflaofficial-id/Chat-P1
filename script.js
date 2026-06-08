(function() {
  // ==================== STATE & STORAGE ====================
  const PREFIX = 'anonmesh_';
  let currentUser = null;
  let allChats = {};
  let friendsList = [];
  let blockedUsers = [];
  let starredMessages = [];
  let settings = {
    privacy: { allowAddViaID: true, allowAddViaQR: true, showMyQR: true, acceptVoice: true },
    theme: 'dark'
  };
  let permissions = { bluetooth: false, mic: false, camera: false };
  let currentPartnerId = null;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let html5QrScanner = null;
  let recStart = 0;
  let connectedDevices = {};
  const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
  const CHAR_UUID = 'abcd1234-1234-1234-1234-123456789abc';

  // ==================== STORAGE HELPERS ====================
  function save() {
    localStorage.setItem(PREFIX + 'data', JSON.stringify({
      currentUser, allChats, friendsList, blockedUsers, starredMessages, settings, permissions
    }));
  }

  function load() {
    const raw = localStorage.getItem(PREFIX + 'data');
    if (raw) {
      try {
        const d = JSON.parse(raw);
        currentUser = d.currentUser || null;
        allChats = d.allChats || {};
        friendsList = d.friendsList || [];
        blockedUsers = d.blockedUsers || [];
        starredMessages = d.starredMessages || [];
        settings = d.settings || {
          privacy: { allowAddViaID: true, allowAddViaQR: true, showMyQR: true, acceptVoice: true },
          theme: 'dark'
        };
        permissions = d.permissions || { bluetooth: false, mic: false, camera: false };
      } catch (e) {
        resetData();
      }
    } else {
      resetData();
    }
  }

  function resetData() {
    currentUser = null;
    allChats = {};
    friendsList = [];
    blockedUsers = [];
    starredMessages = [];
    settings = {
      privacy: { allowAddViaID: true, allowAddViaQR: true, showMyQR: true, acceptVoice: true },
      theme: 'dark'
    };
    permissions = { bluetooth: false, mic: false, camera: false };
  }

  const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?/';

  function genId() {
    let id = '';
    for (let i = 0; i < 23; i++) id += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    return id;
  }

  const formatTime = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `Hari ini ${h}:${m}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Kemarin ${h}:${m}`;
    return `${d.getDate()}/${d.getMonth() + 1} ${h}:${m}`;
  };

  const formatDur = (s) => {
    const sec = Math.floor(s);
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  };

  const toast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.display = 'block';
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = 'bounceIn 0.4s';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.display = 'none'; }, 2000);
  };

  const showModal = (html) => {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  };

  const hideModal = () => {
    document.getElementById('modal-overlay').classList.add('hidden');
  };

  const applyTheme = () => {
    const t = settings.theme;
    document.body.classList.toggle('light-mode', t === 'light' || (t === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches));
    const lbl = document.getElementById('theme-label');
    if (lbl) lbl.textContent = t === 'dark' ? 'Dark' : t === 'light' ? 'Light' : 'System';
  };

  // ==================== BLUETOOTH ====================
  async function checkBluetooth() {
    if (!navigator.bluetooth) {
      permissions.bluetooth = false;
      return false;
    }
    try {
      const available = await navigator.bluetooth.getAvailability();
      permissions.bluetooth = available;
      return available;
    } catch {
      permissions.bluetooth = false;
      return false;
    }
  }

  function updateBluetoothIndicator() {
    const el = document.getElementById('bluetooth-indicator');
    if (el) {
      el.textContent = permissions.bluetooth ? '📶 BT Aktif' : '📶 BT Mati';
      el.className = 'bluetooth-status' + (permissions.bluetooth ? '' : ' off');
    }
  }

  async function connectToDevice(deviceName) {
    if (!permissions.bluetooth) {
      toast('Bluetooth tidak aktif!');
      return null;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: deviceName }],
        optionalServices: [SERVICE_UUID]
      });
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHAR_UUID);
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = new TextDecoder().decode(event.target.value);
        try {
          const payload = JSON.parse(value);
          handleIncomingMessage(payload);
        } catch (e) {}
      });
      connectedDevices[device.id] = { device, characteristic };
      return { id: device.id, name: device.name };
    } catch (e) {
      toast('Gagal menghubungkan ke perangkat');
      return null;
    }
  }

  async function scanForDevices() {
    if (!permissions.bluetooth) {
      const ok = await checkBluetooth();
      if (!ok) {
        toast('Bluetooth tidak tersedia. Aktifkan Bluetooth terlebih dahulu.');
        updateBluetoothIndicator();
        return;
      }
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID]
      });
      const name = device.name || 'Perangkat Tanpa Nama';
      addRadarDevice(name, device.id);
      const connected = await connectToDevice(name);
      if (connected) {
        toast('Terhubung ke ' + name);
      }
    } catch (e) {
      toast('Pemindaian dibatalkan');
    }
  }

  function addRadarDevice(name, id) {
    const container = document.getElementById('radar-container');
    if (!container) return;
    if (document.querySelector(`.radar-item[data-id="${id}"]`)) return;
    const div = document.createElement('div');
    div.className = 'radar-item';
    div.dataset.id = id;
    div.innerHTML = `<div class="avatar">${name.charAt(0).toUpperCase()}</div><div><strong>${name}</strong><br><small>${id}</small></div>`;
    div.addEventListener('click', () => {
      if (!friendsList.find(f => f.chatId === id)) {
        friendsList.push({ name, chatId: id });
        allChats[id] = { partnerName: name, messages: [], pinned: [], online: true };
        save();
      }
      openChat(id);
      switchTab('chat');
    });
    container.appendChild(div);
  }

  async function sendViaBluetooth(partnerId, payload) {
    const deviceEntry = Object.values(connectedDevices).find(d => d.device.id === partnerId);
    if (!deviceEntry) return false;
    try {
      const encoder = new TextEncoder();
      await deviceEntry.characteristic.writeValue(encoder.encode(JSON.stringify(payload)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function handleIncomingMessage(payload) {
    const { sender, content, timestamp } = payload;
    if (!sender || blockedUsers.some(b => b.chatId === sender)) return;
    if (!allChats[sender]) {
      const friend = friendsList.find(f => f.chatId === sender);
      if (!friend) return;
      allChats[sender] = { partnerName: friend.name, messages: [], pinned: [], online: true };
    }
    allChats[sender].messages.push({ type: 'text', content, sender: 'partner', timestamp });
    allChats[sender].online = true;
    save();
    if (currentPartnerId === sender) renderMessages();
    renderChatList();
    if (permissions.notif && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('AnonMesh', { body: `${allChats[sender].partnerName}: ${content}` });
    }
  }

  // ==================== RENDER FUNCTIONS ====================
  function renderChatList(filter = '') {
    const container = document.getElementById('chat-list-container');
    if (!container) return;
    const chats = Object.values(allChats);
    const f = filter.toLowerCase().trim();
    const filtered = f ? chats.filter(c => c.partnerName.toLowerCase().includes(f)) : chats;
    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><div style="font-size:48px;">💬</div><p>${f ? 'Tidak ditemukan' : 'Belum ada chat'}</p></div>`;
      return;
    }
    container.innerHTML = filtered.map(c => {
      const last = c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
      const preview = last ? (last.type === 'voice' ? '🎤 Voice Note' : last.content.substring(0, 35)) : 'Belum ada pesan';
      const time = last ? formatTime(last.timestamp) : '';
      const online = c.online !== false;
      return `
        <div class="chat-list-item" data-id="${c.partnerId}">
          <div class="avatar">${c.partnerName.charAt(0).toUpperCase()}<span class="online-dot ${online ? '' : 'offline-dot'}"></span></div>
          <div class="chat-info">
            <div class="chat-name">${c.partnerName}</div>
            <div class="chat-preview">${preview}</div>
          </div>
          <div class="chat-time">${time}</div>
        </div>`;
    }).join('');
    document.querySelectorAll('.chat-list-item').forEach(el => {
      el.addEventListener('click', () => openChat(el.dataset.id));
    });
  }

  function renderFriendsList() {
    const container = document.getElementById('friends-list-container');
    if (!container) return;
    if (friendsList.length === 0) {
      container.innerHTML = `<div class="empty-state"><div style="font-size:48px;">🤝</div><p>Belum ada teman</p></div>`;
      return;
    }
    container.innerHTML = friendsList.map(f => {
      const isBlocked = blockedUsers.some(b => b.chatId === f.chatId);
      const online = allChats[f.chatId]?.online !== false;
      return `
        <div class="chat-list-item">
          <div class="avatar" style="width:40px;height:40px;font-size:16px;">
            ${f.name.charAt(0).toUpperCase()}
            <span class="online-dot ${online ? '' : 'offline-dot'}" style="width:10px;height:10px;"></span>
          </div>
          <div class="chat-info">
            <div class="chat-name">${f.name} ${isBlocked ? '🚫' : ''}</div>
            <div style="font-size:10px;font-family:monospace;">${f.chatId}</div>
          </div>
          <button class="btn btn-sm btn-outline chat-btn" data-id="${f.chatId}">💬</button>
          <button class="btn btn-sm ${isBlocked ? 'btn-success' : 'btn-danger'} block-btn" data-id="${f.chatId}">${isBlocked ? 'Buka' : 'Blokir'}</button>
          <button class="btn btn-sm btn-danger delete-friend-btn" data-id="${f.chatId}" style="margin-left:4px;">🗑</button>
        </div>`;
    }).join('');
    document.querySelectorAll('.chat-btn').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); openChat(b.dataset.id); });
    });
    document.querySelectorAll('.block-btn').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); toggleBlock(b.dataset.id); });
    });
    document.querySelectorAll('.delete-friend-btn').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); deleteFriend(b.dataset.id); });
    });
  }

  function renderMessages() {
    const container = document.getElementById('messages-container');
    const pinnedDiv = document.getElementById('pinned-container');
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const chat = allChats[currentPartnerId];
    if (pinnedDiv) {
      pinnedDiv.innerHTML = (chat.pinned || []).map(p => `
        <div class="pinned-banner">
          📌 ${p.content.substring(0, 40)}
          <button class="btn btn-sm btn-ghost" style="margin-left:auto;" data-unpin="${p.index}">Lepas</button>
        </div>`).join('');
      pinnedDiv.querySelectorAll('[data-unpin]').forEach(b => {
        b.addEventListener('click', () => unpinMessage(parseInt(b.dataset.unpin)));
      });
    }
    if (chat.messages.length === 0) {
      container.innerHTML = `<div class="empty-state"><div style="font-size:48px;">💬</div><p>Mulai percakapan</p></div>`;
      return;
    }
    container.innerHTML = chat.messages.map((msg, i) => {
      const isMe = msg.sender === 'me';
      const star = starredMessages.some(s => s.chatId === currentPartnerId && s.index === i);
      return `
        <div class="message-bubble ${isMe ? 'message-sent' : 'message-received'}" data-index="${i}">
          ${star ? '<span style="position:absolute;top:-6px;right:8px;">⭐</span>' : ''}
          ${msg.type === 'voice' ? `
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="voice-play" data-index="${i}">▶</button>
              <span>🎤 Voice Note</span>
              <span style="font-size:10px;">${formatDur(msg.duration || 0)}</span>
            </div>` : msg.content}
          <div class="message-time">${formatTime(msg.timestamp)}</div>
          ${isMe ? '<div class="message-status">✓✓ Diterima</div>' : ''}
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
    container.querySelectorAll('.message-bubble').forEach(b => {
      let timer;
      b.addEventListener('pointerdown', () => {
        timer = setTimeout(() => {
          const idx = parseInt(b.dataset.index);
          showMessageMenu(idx);
        }, 600);
      });
      b.addEventListener('pointerup', () => clearTimeout(timer));
      b.addEventListener('pointerleave', () => clearTimeout(timer));
    });
    container.querySelectorAll('.voice-play').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); playVoice(parseInt(b.dataset.index)); });
    });
  }

  function updateChatDetailHeader() {
    const nameEl = document.getElementById('chat-partner-name');
    const statusEl = document.getElementById('chat-partner-status');
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const chat = allChats[currentPartnerId];
    if (nameEl) nameEl.textContent = chat.partnerName;
    if (statusEl) {
      const online = chat.online !== false;
      statusEl.textContent = online ? 'online' : 'offline';
      statusEl.className = 'header-status ' + (online ? '' : 'offline');
    }
  }

  function openChat(partnerId) {
    if (blockedUsers.some(b => b.chatId === partnerId)) return toast('🚫 Pengguna diblokir');
    if (!allChats[partnerId]) {
      const friend = friendsList.find(f => f.chatId === partnerId);
      if (!friend) return toast('Teman tidak ditemukan');
      allChats[partnerId] = { partnerName: friend.name, messages: [], pinned: [], online: false };
    }
    currentPartnerId = partnerId;
    document.getElementById('chat-detail-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');
    updateChatDetailHeader();
    renderMessages();
  }

  function goBackToMain() {
    currentPartnerId = null;
    document.getElementById('chat-detail-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    switchTab('chat');
    renderChatList();
  }

  // ==================== MESSAGING ACTIONS ====================
  function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentPartnerId || !allChats[currentPartnerId]) return;
    const payload = {
      type: 'text',
      content: text,
      sender: currentUser.chatId,
      timestamp: new Date().toISOString()
    };
    sendViaBluetooth(currentPartnerId, payload).then(success => {
      if (!success) toast('Gagal mengirim via Bluetooth');
    });
    allChats[currentPartnerId].messages.push({
      type: 'text',
      content: text,
      sender: 'me',
      timestamp: payload.timestamp
    });
    input.value = '';
    save();
    renderMessages();
    renderChatList();
  }

  function deleteMessage(index) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const chat = allChats[currentPartnerId];
    chat.messages.splice(index, 1);
    chat.pinned = (chat.pinned || []).filter(p => p.index !== index).map(p => ({
      ...p,
      index: p.index > index ? p.index - 1 : p.index
    }));
    starredMessages = starredMessages.filter(s => !(s.chatId === currentPartnerId && s.index === index));
    save();
    renderMessages();
    renderChatList();
    hideModal();
    toast('Pesan dihapus (lokal)');
  }

  function starMessage(index) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const existing = starredMessages.findIndex(s => s.chatId === currentPartnerId && s.index === index);
    if (existing >= 0) {
      starredMessages.splice(existing, 1);
      toast('Dihapus dari bintang');
    } else {
      const msg = allChats[currentPartnerId].messages[index];
      starredMessages.push({
        chatId: currentPartnerId,
        index,
        content: msg.content || '(Voice Note)',
        partnerName: allChats[currentPartnerId].partnerName
      });
      toast('⭐ Ditambahkan ke bintang');
    }
    save();
    renderMessages();
    hideModal();
  }

  function pinMessage(index) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const chat = allChats[currentPartnerId];
    if (!chat.pinned) chat.pinned = [];
    const existing = chat.pinned.findIndex(p => p.index === index);
    if (existing >= 0) {
      chat.pinned.splice(existing, 1);
      toast('Sematan dilepas');
    } else {
      if (chat.pinned.length >= 3) {
        toast('Maksimal 3 sematan');
        hideModal();
        return;
      }
      chat.pinned.push({ index, content: chat.messages[index].content || '(Voice Note)' });
      toast('📌 Disematkan');
    }
    save();
    renderMessages();
    hideModal();
  }

  function unpinMessage(index) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const chat = allChats[currentPartnerId];
    if (chat.pinned) chat.pinned = chat.pinned.filter(p => p.index !== index);
    save();
    renderMessages();
  }

  function toggleBlock(chatId) {
    const friend = friendsList.find(f => f.chatId === chatId);
    if (!friend) return;
    const idx = blockedUsers.findIndex(b => b.chatId === chatId);
    if (idx >= 0) {
      blockedUsers.splice(idx, 1);
      toast('✅ Dibuka blokir');
    } else {
      blockedUsers.push({ name: friend.name, chatId });
      toast('🚫 Diblokir');
    }
    save();
    renderFriendsList();
    renderChatList();
  }

  function deleteFriend(chatId) {
    if (!confirm('Hapus kontak ini? Chat juga akan dihapus.')) return;
    friendsList = friendsList.filter(f => f.chatId !== chatId);
    if (allChats[chatId]) delete allChats[chatId];
    blockedUsers = blockedUsers.filter(b => b.chatId !== chatId);
    starredMessages = starredMessages.filter(s => s.chatId !== chatId);
    save();
    renderFriendsList();
    renderChatList();
    toast('Kontak dihapus');
  }

  function deleteAllMessages() {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    allChats[currentPartnerId].messages = [];
    allChats[currentPartnerId].pinned = [];
    starredMessages = starredMessages.filter(s => s.chatId !== currentPartnerId);
    save();
    renderMessages();
    renderChatList();
    hideModal();
    toast('Semua pesan dihapus');
  }

  function addFriend(method, value) {
    if (method === 'id') {
      const id = value.trim();
      if (id.length !== 23 || !/^[A-Za-z0-9!@#$%^&*()\-_=+[\]{}|;:,.<>?/]+$/.test(id)) return toast('ID tidak valid (23 karakter)');
      if (friendsList.some(f => f.chatId === id)) return toast('Sudah teman');
      if (id === currentUser.chatId) return toast('Tidak bisa menambah sendiri');
      const name = 'User-' + id.substring(0, 6);
      friendsList.push({ name, chatId: id });
      if (!allChats[id]) allChats[id] = { partnerName: name, messages: [], pinned: [], online: false };
    }
    save();
    renderFriendsList();
    renderChatList();
    hideModal();
    toast('✅ Teman ditambahkan');
  }

  // ==================== VOICE NOTE ====================
  async function startRecording() {
    if (!permissions.mic) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        permissions.mic = true;
        save();
      } catch {
        toast('Izin mikrofon diperlukan');
        return;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioChunks.length > 0) {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const duration = (Date.now() - recStart) / 1000;
          sendVoiceNote(blob, duration);
        }
        mediaRecorder = null;
        audioChunks = [];
      };
      mediaRecorder.start();
      recStart = Date.now();
      isRecording = true;
      document.getElementById('btn-voice').classList.add('recording');
      toast('🎤 Merekam...');
    } catch (e) {
      toast('Gagal merekam');
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      document.getElementById('btn-voice').classList.remove('recording');
    }
  }

  function sendVoiceNote(blob, duration) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const reader = new FileReader();
    reader.onload = function () {
      const base64data = reader.result.split(',')[1];
      const payload = {
        type: 'voice',
        content: base64data,
        duration: duration,
        timestamp: new Date().toISOString()
      };
      sendViaBluetooth(currentPartnerId, payload);
      allChats[currentPartnerId].messages.push({
        type: 'voice',
        content: 'Voice Note',
        audioBlob: blob,
        duration: duration,
        sender: 'me',
        timestamp: payload.timestamp
      });
      save();
      renderMessages();
      renderChatList();
    };
    reader.readAsDataURL(blob);
  }

  function playVoice(index) {
    if (!currentPartnerId || !allChats[currentPartnerId]) return;
    const msg = allChats[currentPartnerId].messages[index];
    if (msg?.audioBlob) {
      const a = new Audio(URL.createObjectURL(msg.audioBlob));
      a.play();
    } else toast('Audio tidak tersedia');
  }

  function showMessageMenu(index) {
    const chat = allChats[currentPartnerId];
    if (!chat) return;
    const isStar = starredMessages.some(s => s.chatId === currentPartnerId && s.index === index);
    const isPinned = (chat.pinned || []).some(p => p.index === index);
    showModal(`
      <h3>Opsi Pesan</h3>
      <div class="modal-option" onclick="window._deleteMsg(${index})">🗑 Hapus (lokal)</div>
      <div class="modal-option" onclick="window._starMsg(${index})">${isStar ? '🌟 Hapus Bintang' : '⭐ Bintang'}</div>
      <div class="modal-option" onclick="window._pinMsg(${index})">${isPinned ? '📌 Lepas Sematan' : '📌 Sematkan'}</div>
      <div class="modal-option" onclick="hideModal()">Batal</div>
    `);
  }

  // Expose for onclick in modal
  window._deleteMsg = deleteMessage;
  window._starMsg = starMessage;
  window._pinMsg = pinMessage;
  window.hideModal = hideModal;

  // ==================== QR SCANNER ====================
  function startQRScanner() {
    const readerEl = document.getElementById('qr-reader');
    if (!readerEl) return;
    if (html5QrScanner) {
      html5QrScanner.stop().then(() => { html5QrScanner = null; startQRScanner(); });
      return;
    }
    if (!permissions.camera) {
      navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
        stream.getTracks().forEach(t => t.stop());
        permissions.camera = true;
        save();
        updatePermUI();
        startQRScanner();
      }).catch(() => {
        toast('Izin kamera diperlukan');
      });
      return;
    }
    document.getElementById('btn-start-scan').style.display = 'none';
    document.getElementById('btn-stop-scan').style.display = 'inline-flex';
    document.getElementById('scan-status').textContent = 'Memindai...';
    html5QrScanner = new Html5Qrcode("qr-reader");
    html5QrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, (decodedText) => {
      let id = decodedText.trim();
      if (id.includes(':')) id = id.split(':')[1] || id;
      if (id.length === 23 && /^[A-Za-z0-9!@#$%^&*()\-_=+[\]{}|;:,.<>?/]+$/.test(id)) {
        toast('✅ Terdeteksi: ' + id);
        addFriendByQR(id);
        stopQRScanner();
      } else toast('QR tidak valid');
    }, (errorMessage) => {}).catch(err => {
      toast('Gagal kamera: ' + err);
      stopQRScanner();
    });
  }

  function stopQRScanner() {
    if (html5QrScanner) {
      html5QrScanner.stop().then(() => { html5QrScanner = null; });
    }
    document.getElementById('btn-start-scan').style.display = 'inline-flex';
    document.getElementById('btn-stop-scan').style.display = 'none';
    document.getElementById('scan-status').textContent = 'Tekan tombol untuk mulai';
  }

  function addFriendByQR(chatId) {
    if (friendsList.some(f => f.chatId === chatId)) return toast('Sudah teman');
    if (chatId === currentUser?.chatId) return toast('Tidak bisa menambah sendiri');
    const name = 'QR-User-' + chatId.substring(0, 4);
    friendsList.push({ name, chatId });
    if (!allChats[chatId]) allChats[chatId] = { partnerName: name, messages: [], pinned: [], online: false };
    save();
    renderFriendsList();
    renderChatList();
    toast('✅ Teman ditambahkan!');
    switchTab('friends');
  }

  // ==================== NAVIGATION ====================
  function switchScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    if (screen === 'login') document.getElementById('login-screen').classList.add('active');
    else if (screen === 'permission') document.getElementById('permission-screen').classList.add('active');
    else if (screen === 'main') document.getElementById('main-screen').classList.add('active');
    else if (screen === 'chat') document.getElementById('chat-detail-screen').classList.add('active');
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const tabEl = document.getElementById('tab-' + tab);
    if (tabEl) tabEl.style.display = 'flex';
    const nav = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (nav) nav.classList.add('active');
    if (tab === 'scan') {
      if (document.getElementById('tab-scan').style.display !== 'flex') stopQRScanner();
    } else {
      stopQRScanner();
    }
    if (tab === 'profile') updateProfileTab();
    if (tab === 'chat') renderChatList();
    if (tab === 'friends') renderFriendsList();
    if (tab === 'settings') applyTheme();
  }

  function updateProfileTab() {
    if (!currentUser) return;
    document.getElementById('profile-name').textContent = currentUser.username;
    document.getElementById('profile-id').textContent = currentUser.chatId;
    document.getElementById('profile-avatar').textContent = currentUser.username.charAt(0).toUpperCase();
    const canvas = document.getElementById('profile-qr');
    if (canvas && settings.privacy.showMyQR) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let i = 0; i < currentUser.chatId.length * 2; i++) {
        ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 4, 4);
      }
    }
  }

  function editProfile() {
    showModal(`
      <h3>Edit Profil</h3>
      <div class="input-group"><input type="text" id="edit-username" value="${currentUser.username}" maxlength="25"></div>
      <button class="btn btn-primary" id="save-profile">Simpan</button>
      <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="hideModal()">Batal</button>
    `);
    setTimeout(() => {
      document.getElementById('save-profile').addEventListener('click', () => {
        const newName = document.getElementById('edit-username').value.trim();
        if (!newName) return toast('Nama tidak boleh kosong');
        currentUser.username = newName;
        save();
        updateProfileTab();
        hideModal();
        toast('Profil diperbarui');
      });
    }, 100);
  }

  function updatePermUI() {
    document.getElementById('dot-bluetooth').className = 'status-dot ' + (permissions.bluetooth ? 'dot-ok' : 'dot-no');
    document.getElementById('status-bluetooth').textContent = permissions.bluetooth ? '✅ Siap' : '❌ Belum';
    document.getElementById('dot-mic').className = 'status-dot ' + (permissions.mic ? 'dot-ok' : 'dot-no');
    document.getElementById('status-mic').textContent = permissions.mic ? '✅ Siap' : '❌ Belum';
    document.getElementById('dot-cam').className = 'status-dot ' + (permissions.camera ? 'dot-ok' : 'dot-no');
    document.getElementById('status-cam').textContent = permissions.camera ? '✅ Siap' : '❌ Belum';
  }

  // ==================== EVENT LISTENERS ====================
  function bindEvents() {
    document.getElementById('btn-login').addEventListener('click', () => {
      const name = document.getElementById('username-input').value.trim();
      if (!name) return toast('Masukkan nama');
      currentUser = { username: name, chatId: genId() };
      save();
      document.getElementById('username-input').value = '';
      switchScreen('permission');
      updatePermUI();
    });

    document.getElementById('btn-check-perms').addEventListener('click', async () => {
      await checkBluetooth();
      navigator.mediaDevices.getUserMedia({ audio: true }).then(() => { permissions.mic = true; }).catch(() => { permissions.mic = false; });
      navigator.mediaDevices.getUserMedia({ video: true }).then(() => { permissions.camera = true; }).catch(() => { permissions.camera = false; });
      updatePermUI();
      updateBluetoothIndicator();
      if (!permissions.bluetooth) toast('Bluetooth harus diaktifkan! Buka pengaturan.');
      else toast('Bluetooth siap!');
      save();
      switchScreen('main');
      switchTab('chat');
    });

    document.getElementById('btn-skip-perms').addEventListener('click', () => {
      switchScreen('main');
      switchTab('chat');
    });

    document.getElementById('btn-back-chat').addEventListener('click', goBackToMain);
    document.getElementById('btn-send').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

    const voiceBtn = document.getElementById('btn-voice');
    voiceBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!currentPartnerId) return;
      startRecording();
    });
    voiceBtn.addEventListener('pointerup', e => {
      e.preventDefault();
      if (isRecording) stopRecording();
    });
    voiceBtn.addEventListener('pointerleave', () => {
      if (isRecording) stopRecording();
    });

    document.getElementById('btn-chat-menu').addEventListener('click', () => {
      if (!currentPartnerId) return;
      const isBlocked = blockedUsers.some(b => b.chatId === currentPartnerId);
      showModal(`
        <h3>Menu Chat</h3>
        <div class="modal-option" onclick="window._deleteAll()">🗑 Hapus Semua Pesan</div>
        <div class="modal-option" onclick="window._toggleBlockCurrent()">${isBlocked ? '✅ Buka Blokir' : '🚫 Blokir'}</div>
        <div class="modal-option" onclick="hideModal()">Batal</div>
      `);
    });

    window._deleteAll = () => { deleteAllMessages(); };
    window._toggleBlockCurrent = () => {
      if (currentPartnerId) {
        toggleBlock(currentPartnerId);
        hideModal();
        goBackToMain();
      }
    };

    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.getElementById('search-chat').addEventListener('input', e => renderChatList(e.target.value));

    document.getElementById('btn-add-friend').addEventListener('click', () => {
      showModal(`
        <h3>Tambah Teman</h3>
        <div class="modal-option" id="add-via-id">🆔 Via ID Chat</div>
        <div class="modal-option" id="add-via-qr">📷 Scan QR</div>
        <div class="modal-option" onclick="hideModal()">Batal</div>
      `);
      setTimeout(() => {
        document.getElementById('add-via-id')?.addEventListener('click', () => {
          hideModal();
          const id = prompt('Masukkan ID Chat (23 karakter):');
          if (id) addFriend('id', id);
        });
        document.getElementById('add-via-qr')?.addEventListener('click', () => {
          hideModal();
          switchTab('scan');
          setTimeout(startQRScanner, 300);
        });
      }, 100);
    });

    document.getElementById('btn-start-scan').addEventListener('click', startQRScanner);
    document.getElementById('btn-stop-scan').addEventListener('click', stopQRScanner);
    document.getElementById('btn-edit-profile').addEventListener('click', editProfile);
    document.getElementById('btn-copy-id')?.addEventListener('click', () => {
      if (currentUser) navigator.clipboard.writeText(currentUser.chatId).then(() => toast('📋 ID disalin')).catch(() => toast('Gagal'));
    });
    document.getElementById('btn-share-qr')?.addEventListener('click', () => {
      if (currentUser && navigator.share) navigator.share({ title: 'ID AnonMesh', text: currentUser.chatId }).catch(() => {});
      else toast('Bagikan: ' + currentUser.chatId);
    });
    document.getElementById('menu-profile')?.addEventListener('click', () => switchTab('profile'));
    document.getElementById('menu-privacy')?.addEventListener('click', () => {
      const p = settings.privacy;
      showModal(`
        <h3>Privasi</h3>
        <div class="settings-item" id="priv-allowId"><span>Izinkan Tambah via ID</span><div class="toggle-switch ${p.allowAddViaID ? 'on' : ''}"></div></div>
        <div class="settings-item" id="priv-allowQr"><span>Izinkan via QR</span><div class="toggle-switch ${p.allowAddViaQR ? 'on' : ''}"></div></div>
        <div class="settings-item" id="priv-showQr"><span>Tampilkan QR Saya</span><div class="toggle-switch ${p.showMyQR ? 'on' : ''}"></div></div>
        <div class="settings-item" id="priv-voice"><span>Terima Voice Note</span><div class="toggle-switch ${p.acceptVoice ? 'on' : ''}"></div></div>
        <button class="btn btn-outline" style="width:100%;margin-top:12px;" onclick="hideModal()">Tutup</button>
      `);
      ['allowAddViaID', 'allowAddViaQR', 'showMyQR', 'acceptVoice'].forEach(key => {
        setTimeout(() => {
          const elId = 'priv-' + key.replace('allow', '').replace('Via', '').replace('Add', '').toLowerCase().replace('viaqr', 'allowQr').replace('showmyqr', 'showQr').replace('acceptvoice', 'voice');
          document.getElementById(elId)?.addEventListener('click', () => {
            settings.privacy[key] = !settings.privacy[key];
            save();
            document.getElementById('menu-privacy').click();
            updateProfileTab();
          });
        }, 100);
      });
    });
    document.getElementById('menu-blocked')?.addEventListener('click', () => {
      let html = '<h3>Daftar Blokir</h3>';
      if (blockedUsers.length === 0) html += '<p style="text-align:center;padding:20px;">Kosong</p>';
      else html += blockedUsers.map(b => `
        <div class="settings-item">
          <span>${b.name}</span>
          <span style="font-family:monospace;">${b.chatId}</span>
          <button class="btn btn-sm btn-success unblock-btn" data-id="${b.chatId}">Buka</button>
        </div>`).join('');
      html += '<button class="btn btn-outline" style="width:100%;margin-top:12px;" onclick="hideModal()">Tutup</button>';
      showModal(html);
      setTimeout(() => {
        document.querySelectorAll('.unblock-btn').forEach(b => {
          b.addEventListener('click', () => {
            const id = b.dataset.id;
            blockedUsers = blockedUsers.filter(x => x.chatId !== id);
            save();
            document.getElementById('menu-blocked').click();
            renderFriendsList();
            renderChatList();
            toast('Dibuka blokir');
          });
        });
      }, 100);
    });
    document.getElementById('menu-starred')?.addEventListener('click', () => {
      let html = '<h3>Pesan Berbintang</h3>';
      if (starredMessages.length === 0) html += '<p style="text-align:center;padding:20px;">Belum ada</p>';
      else html += starredMessages.map((s, i) => `
        <div class="settings-item">
          <span>⭐ ${s.partnerName}</span>
          <span style="font-size:12px;">${s.content.substring(0, 25)}</span>
          <button class="btn btn-sm btn-outline remove-star" data-index="${i}">Hapus</button>
        </div>`).join('');
      html += '<button class="btn btn-outline" style="width:100%;" onclick="hideModal()">Tutup</button>';
      showModal(html);
      setTimeout(() => {
        document.querySelectorAll('.remove-star').forEach(b => {
          b.addEventListener('click', () => {
            const i = parseInt(b.dataset.index);
            starredMessages.splice(i, 1);
            save();
            document.getElementById('menu-starred').click();
            toast('Dihapus dari bintang');
          });
        });
      }, 100);
    });
    document.getElementById('menu-theme')?.addEventListener('click', () => {
      const themes = ['dark', 'light', 'system'];
      const cur = themes.indexOf(settings.theme);
      settings.theme = themes[(cur + 1) % 3];
      save();
      applyTheme();
      toast('Tema: ' + settings.theme);
    });
    document.getElementById('menu-about')?.addEventListener('click', () => {
      showModal(`<h3>Tentang</h3><div style="text-align:center;"><img src="logo.png" style="width:60px;border-radius:16px;" onerror="this.style.display='none';"><h4>AnonMesh Chat</h4><p>v2.0 · Bluetooth Mesh & P2P</p></div><button class="btn btn-outline" style="width:100%;" onclick="hideModal()">Tutup</button>`);
    });
    document.getElementById('btn-scan-ble').addEventListener('click', scanForDevices);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) hideModal();
    });
  }

  // ==================== INIT ====================
  async function init() {
    load();
    applyTheme();
    await checkBluetooth();
    updateBluetoothIndicator();
    document.getElementById('splash-screen').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('splash-screen').classList.add('hidden');
      if (currentUser) {
        switchScreen('main');
        switchTab('chat');
        renderChatList();
        renderFriendsList();
        updateProfileTab();
      } else {
        switchScreen('login');
      }
    }, 1800);
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
    window.addEventListener('popstate', (e) => {
      if (document.getElementById('chat-detail-screen').classList.contains('active')) {
        goBackToMain();
        e.preventDefault();
      }
    });
    bindEvents();
  }

  init();
})();
