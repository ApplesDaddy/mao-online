/* ═══════════════════════════════════════════════════════════════════
   client.js — socket wiring + imperative DOM rendering for Mao Online.
   Roster/log update incrementally (never full rebuild); own hand
   re-renders on change. No framework, no build step.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const socket = io();

  // ── Client state ──────────────────────────────────────────────────
  let me = null;                 // { playerId, roomId }
  let hostId = null;
  let myHand = [];               // Card[] — full objects, private to this client
  let localDiscardStack = [];    // up to 3 most recent discards, newest first
  const roster = new Map();      // playerId -> { id, name, count, color }
  const rows = new Map();        // playerId -> { li, countEl, badgeEl } (incremental updates)
  let pendingRejoin = false;     // a rejoinRoom attempt is in flight

  const RED_SUITS = new Set(['hearts', 'diamonds']);
  const LOG_CAP = 100;           // mirrors server

  const els = {
    joinScreen: $('join-screen'), gameScreen: $('game-screen'),
    joinName: $('join-name'), joinRoom: $('join-room'), joinError: $('join-error'),
    btnCreate: $('btn-create'), btnJoin: $('btn-join'),
    roomCode: $('room-code').querySelector('b'), btnLeave: $('btn-leave'),
    deckPile: $('deck-pile'), deckCount: $('deck-count'), discardTop: $('discard-top'),
    handFan: $('hand-fan'),
    openPlayers: $('open-players'), openLog: $('open-log'),
    playersPanel: $('players-panel'), logPanel: $('log-panel'),
    hostControls: $('host-controls'), playerSearch: $('player-search'),
    roster: $('roster'), actionLog: $('action-log'),
    scrim: $('scrim'),
  };

  // ── Session persistence (refresh / reconnect restores the seat) ───
  function saveSession() {
    sessionStorage.setItem('mao_playerId', me.playerId);
    sessionStorage.setItem('mao_roomId', me.roomId);
  }
  function clearSession() {
    sessionStorage.removeItem('mao_playerId');
    sessionStorage.removeItem('mao_roomId');
  }

  socket.on('connect', () => {
    const playerId = sessionStorage.getItem('mao_playerId');
    const roomId = sessionStorage.getItem('mao_roomId');
    if (playerId && roomId) {
      pendingRejoin = true;
      socket.emit('rejoinRoom', { roomId, playerId });
    }
  });

  // ── Join screen ───────────────────────────────────────────────────
  function showJoinError(msg) {
    els.joinError.textContent = msg;
    els.joinError.hidden = false;
  }

  function createRoom() {
    const name = els.joinName.value.trim();
    if (!name) return showJoinError('Please enter your name.');
    socket.emit('createRoom', { name });
  }
  function joinRoom() {
    const name = els.joinName.value.trim();
    const roomId = els.joinRoom.value.trim();
    if (!name) return showJoinError('Please enter your name.');
    if (!roomId) return showJoinError('Please enter a room code.');
    socket.emit('joinRoom', { roomId, name });
  }

  els.btnCreate.addEventListener('click', createRoom);
  els.btnJoin.addEventListener('click', joinRoom);
  for (const input of [els.joinName, els.joinRoom]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (els.joinRoom.value.trim() ? joinRoom : createRoom)();
    });
  }

  socket.on('room:error', ({ message }) => {
    if (pendingRejoin) { // saved seat is gone — drop it and let the player rejoin manually
      pendingRejoin = false;
      clearSession();
    }
    showJoinError(message);
  });

  // ── Entering the game (initial full render; updates are incremental) ──
  function enterGame(state) {
    pendingRejoin = false;
    me = { playerId: state.playerId, roomId: state.roomId };
    hostId = state.hostId;
    myHand = state.ownHand;
    roster.clear();
    for (const p of state.roster) roster.set(p.id, p);
    saveSession();

    els.joinError.hidden = true;
    els.joinScreen.classList.add('screen-off');
    els.gameScreen.classList.add('active');
    document.title = 'Mao — Room ' + state.roomId;

    els.roomCode.textContent = state.roomId;
    setDeckCount(state.deckCount);
    renderDiscardStack(state.discardStack || []);
    renderHand();

    // initial roster build (one-time full render)
    els.roster.innerHTML = '';
    rows.clear();
    for (const p of state.roster) addRow(p);

    // initial log (server sends newest-first)
    els.actionLog.innerHTML = '';
    for (const entry of state.log) els.actionLog.appendChild(makeLogLi(entry));
    els.actionLog.scrollTop = 0;

    updateHostControls();
  }

  socket.on('room:joined', enterGame);
  socket.on('state:sync', enterGame);

  // ── Leaving (teardown counterpart to enterGame) ───────────────────
  // Leaving destroys the seat for good (no 30-min grace like a disconnect),
  // so confirm — mirroring the beforeunload guard for accidental exits.
  function leaveGame() {
    socket.emit('leaveRoom');
    clearSession();          // stop the reconnect handler rejoining this seat
    me = null;               // disarms the beforeunload guard
    hostId = null;
    myHand = [];
    localDiscardStack = [];
    roster.clear();
    rows.clear();
    closeSheets();
    els.joinError.hidden = true;
    els.gameScreen.classList.remove('active');
    els.joinScreen.classList.remove('screen-off');
    document.title = 'Mao Online';
  }

  els.btnLeave.addEventListener('click', () => {
    if (window.confirm('Leave the room? Your seat and hand will be lost.')) leaveGame();
  });

  // ── Cards & hand fan ──────────────────────────────────────────────
  function makeCardEl(card, asButton) {
    const el = document.createElement(asButton ? 'button' : 'div');
    el.className = 'card ' + (RED_SUITS.has(card.suit) ? 'red' : 'black');
    if (asButton) {
      el.type = 'button';
      el.setAttribute('aria-label', MaoCards.label(card));
      el.addEventListener('click', () => socket.emit('playCard', { cardId: card.id }));
    }
    el.innerHTML = MaoCards.faceSVG(card); // real-deck face art (see cards.js)
    return el;
  }

  // Fan: ±20° at ≤10 cards, linearly compressing to ±5° at 20+ (spec §6.2)
  function layoutFan() {
    const cards = els.handFan.children;
    const n = cards.length;
    const maxAngle = n <= 10 ? 20 : Math.max(5, 20 - (n - 10) * 1.5);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      cards[i].style.transform = 'rotate(' + (-maxAngle + 2 * maxAngle * t).toFixed(2) + 'deg)';
      cards[i].style.marginLeft = i ? 'var(--overlap)' : '';
    }
  }

  function renderHand() {
    els.handFan.innerHTML = '';
    for (const card of myHand) els.handFan.appendChild(makeCardEl(card, true));
    layoutFan();
    const mine = rows.get(me.playerId);
    if (mine) mine.countEl.textContent = myHand.length;
  }

  // ── Table ─────────────────────────────────────────────────────────
  function setDeckCount(n) {
    els.deckCount.textContent = n;
  }

  // Discard pile: up to 3 cards (newest first) in a slightly messy cascade —
  // like a real discard pile, each layer peeking out with a small tilt.
  // Offsets are tuned to the enlarged table piles (see #table-zone --cw/--ch).
  const DISCARD_LAYERS = [
    { top: 0, left: 0, deg: 0 },
    { top: 5, left: 5, deg: 1.5 },
    { top: 10, left: 10, deg: -2 },
  ];

  function renderDiscardStack(cards) {
    localDiscardStack = cards;
    els.discardTop.innerHTML = '';
    if (!cards.length) {
      const empty = document.createElement('div');
      empty.className = 'card-empty';
      empty.textContent = 'Empty';
      els.discardTop.appendChild(empty);
      return;
    }
    for (let i = 0; i < cards.length; i++) {
      const layer = DISCARD_LAYERS[i];
      const el = makeCardEl(cards[i], false);
      el.style.position = 'absolute';
      el.style.top = layer.top + 'px';
      el.style.left = layer.left + 'px';
      el.style.transform = 'rotate(' + layer.deg + 'deg)';
      el.style.zIndex = cards.length - i; // newest on top
      els.discardTop.appendChild(el);
    }
  }

  els.deckPile.addEventListener('click', () => socket.emit('drawCard'));

  // ── Roster (incremental row updates, never a full rebuild) ────────
  function addRow(p) {
    const li = document.createElement('li');
    li.className = 'roster-row' + (p.id === me.playerId ? ' is-self' : '');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.setProperty('--c', p.color);
    dot.setAttribute('aria-hidden', 'true');

    const nameEl = document.createElement('span');
    nameEl.className = 'rname';
    nameEl.textContent = p.name;

    const badgeEl = document.createElement('span');
    badgeEl.className = 'host-badge';
    badgeEl.textContent = 'Host';
    badgeEl.hidden = p.id !== hostId;
    nameEl.appendChild(badgeEl);

    const countEl = document.createElement('span');
    countEl.className = 'count-badge';
    countEl.textContent = p.count;

    const penalizeBtn = document.createElement('button');
    penalizeBtn.className = 'btn-penalize';
    penalizeBtn.type = 'button';
    penalizeBtn.textContent = 'Penalize';
    penalizeBtn.addEventListener('click', () => onPenalize(p.id));

    li.append(dot, nameEl, countEl, penalizeBtn);
    els.roster.appendChild(li);
    rows.set(p.id, { li, countEl, badgeEl });
    filterRow(li);
  }

  function removeRow(playerId) {
    const row = rows.get(playerId);
    if (row) {
      row.li.remove();
      rows.delete(playerId);
    }
  }

  function updateCount(playerId, count) {
    const p = roster.get(playerId);
    if (p) p.count = count;
    const row = rows.get(playerId);
    if (row) row.countEl.textContent = count;
  }

  function updateHostBadges() {
    for (const [id, row] of rows) row.badgeEl.hidden = id !== hostId;
  }

  function updateHostControls() {
    els.hostControls.style.display = hostId === me.playerId ? '' : 'none';
  }

  for (const btn of els.hostControls.querySelectorAll('.deal')) {
    btn.addEventListener('click', () => socket.emit('dealGame', { count: Number(btn.dataset.count) }));
  }

  els.playerSearch.addEventListener('input', () => {
    for (const row of rows.values()) filterRow(row.li);
  });
  function filterRow(li) {
    const q = els.playerSearch.value.trim().toLowerCase();
    const name = li.querySelector('.rname').textContent.toLowerCase();
    li.style.display = !q || name.includes(q) ? '' : 'none';
  }

  // ── Action feed (incremental prepend, 50px auto-scroll rule) ──────
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function makeLogLi(entry) {
    const li = document.createElement('li');
    if (entry.type === 'penalty') li.className = 'log-penalty';
    else if (entry.type === 'reshuffle') li.className = 'log-reshuffle';
    const text = document.createElement('span');
    text.className = 'lt';
    text.textContent = entry.text;
    const time = document.createElement('time');
    time.textContent = fmtTime(entry.ts);
    li.append(text, time);
    return li;
  }

  function prependLog(entry) {
    const nearTop = els.actionLog.scrollTop <= 50; // don't yank scroll while reading history
    els.actionLog.prepend(makeLogLi(entry));
    while (els.actionLog.children.length > LOG_CAP) els.actionLog.lastChild.remove();
    if (nearTop) els.actionLog.scrollTop = 0;
  }

  // ── Penalize ──────────────────────────────────────────────────────
  function onPenalize(targetId) {
    socket.emit('issuePenalty', { targetId });
  }

  // ── Game event handlers ───────────────────────────────────────────
  socket.on('game:dealt', ({ count, deckCount, ownHand, discardStack }) => {
    myHand = ownHand;
    renderHand();
    setDeckCount(deckCount);
    for (const id of roster.keys()) updateCount(id, count);
    renderDiscardStack(discardStack || []); // deal resets the table; the flipped card starts the pile
  });

  socket.on('card:played', ({ playerId, card, deckCount }) => {
    renderDiscardStack([card, ...localDiscardStack].slice(0, 3));
    setDeckCount(deckCount);
    if (playerId === me.playerId) {
      myHand = myHand.filter((c) => c.id !== card.id);
      renderHand();
    } else {
      const p = roster.get(playerId); // payload carries no count — a play is always −1
      if (p) updateCount(playerId, Math.max(0, p.count - 1));
    }
  });

  socket.on('card:drawn', ({ playerId, newHandCount, deckCount }) => {
    updateCount(playerId, newHandCount);
    setDeckCount(deckCount);
    // if it's me, the card itself arrives via card:received
  });

  socket.on('card:received', ({ card }) => { // targeted: only the affected player gets this
    myHand.push(card);
    renderHand();
  });

  socket.on('penalty:issued', ({ fromId, toId, targetNewCount, deckCount }) => {
    updateCount(toId, targetNewCount);
    setDeckCount(deckCount);
    // if toId === me, the card arrives via card:received
  });

  socket.on('player:joined', ({ player }) => {
    roster.set(player.id, player);
    addRow(player);
  });

  socket.on('player:left', ({ playerId }) => {
    roster.delete(playerId);
    removeRow(playerId);
  });

  socket.on('host:changed', ({ hostId: newHostId }) => {
    hostId = newHostId;
    updateHostBadges();
    updateHostControls();
  });

  socket.on('log:entry', prependLog);

  // ── Mobile bottom sheets ──────────────────────────────────────────
  function openSheet(panel) {
    panel.classList.add('open');
    els.scrim.hidden = false;
  }
  function closeSheets() {
    els.playersPanel.classList.remove('open');
    els.logPanel.classList.remove('open');
    els.scrim.hidden = true;
  }
  els.openPlayers.addEventListener('click', () => openSheet(els.playersPanel));
  els.openLog.addEventListener('click', () => openSheet(els.logPanel));
  els.scrim.addEventListener('click', closeSheets);
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', closeSheets);

  // ── Accidental tab-close guard (spec §6) ──────────────────────────
  window.addEventListener('beforeunload', (e) => {
    if (!me) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
