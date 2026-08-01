// server.js — Express + Socket.io bootstrap, room lifecycle, socket events.
// Sandbox mode: the server is a physical card table. It enforces zero Mao rules or turns.

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const game = require('./game');

const HOST = '0.0.0.0'; // required for LAN mobile testing
const PORT = 3000;

const MAX_PLAYERS = 50;
const GRACE_MS = 30 * 60 * 1000; // reconnect grace after disconnect
const ROOM_TTL_MS = 5 * 60 * 1000; // sweep rooms with 0 connected sockets this long
const SWEEP_INTERVAL_MS = 60 * 1000;
const LOG_CAP = 100; // newest first
const RESHUFFLE_THRESHOLD = 20; // build-spec §5.9: top up when the deck falls below this

// tanbi kei-ish rich tones for player badges; cycles if a room exceeds the palette
const PLAYER_COLORS = [
  '#8a1538', '#1f5c4d', '#1d3461', '#8f6b1f',
  '#5b2a86', '#0f6b6b', '#7a3b12', '#4a6741',
  '#6b1f2a', '#2f4b7c', '#8c5e10', '#5e2b4d',
  '#3d5a45', '#713f12', '#37415c', '#7c2d4e',
];

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L — humans type these

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = new Map(); // roomId -> Room (game.createRoom shape + room.emptySince)
const graceTimers = new Map(); // playerId -> setTimeout handle

function makeRoomId() {
  let id;
  do {
    id = Array.from({ length: 4 }, () => ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(id));
  return id;
}

// LogEntry { ts, type, text } — capped at 100, newest first; every entry broadcast.
function pushLog(room, type, text) {
  const entry = { ts: Date.now(), type, text };
  room.log.unshift(entry);
  if (room.log.length > LOG_CAP) room.log.length = LOG_CAP;
  io.to(room.id).emit('log:entry', entry);
}

// Never send other players' hands — ids, names, counts, colors only.
function rosterOf(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, count: p.hand.length, color: p.color,
  }));
}

// Full state payload for one seat; used for both room:joined and state:sync.
function roomStateFor(room, player) {
  return {
    playerId: player.id,
    roomId: room.id,
    hostId: room.hostId,
    isHost: room.hostId === player.id,
    ownHand: player.hand,
    roster: rosterOf(room),
    deckCount: room.deck.length,
    discardStack: room.discard.slice(-3).reverse(), // up to 3 most recent, newest first
    log: room.log,
  };
}

function clearGrace(playerId) {
  const t = graceTimers.get(playerId);
  if (t) {
    clearTimeout(t);
    graceTimers.delete(playerId);
  }
}

function markEmptyIfNeeded(room) {
  if (room.socketToPlayer.size === 0 && room.emptySince === null) {
    room.emptySince = Date.now();
  }
}

// Shared by leaveRoom (immediate, logged) and grace expiry (silent).
function removePlayer(room, player, { log }) {
  clearGrace(player.id);
  for (const [sid, pid] of room.socketToPlayer) {
    if (pid === player.id) room.socketToPlayer.delete(sid);
  }
  room.players.delete(player.id);
  io.to(room.id).emit('player:left', { playerId: player.id });
  if (log) pushLog(room, 'leave', `${player.name} left`);
  if (room.hostId === player.id) {
    const next = room.players.values().next().value; // earliest remaining joiner (Map order)
    room.hostId = next ? next.id : null;
    if (next) io.to(room.id).emit('host:changed', { hostId: next.id });
  }
  markEmptyIfNeeded(room);
}

function addPlayer(room, name) {
  const player = {
    id: crypto.randomUUID(),
    name,
    hand: [],
    color: PLAYER_COLORS[room.players.size % PLAYER_COLORS.length],
  };
  room.players.set(player.id, player);
  return player;
}

function joinSocket(socket, room, player) {
  socket.join(room.id);
  room.socketToPlayer.set(socket.id, player.id);
  room.emptySince = null;
}

function nameTaken(room, name) {
  const lower = name.toLowerCase();
  for (const p of room.players.values()) {
    if (p.name.toLowerCase() === lower) return true;
  }
  return false;
}

function findSeat(socket) {
  for (const room of rooms.values()) {
    const pid = room.socketToPlayer.get(socket.id);
    if (pid && room.players.has(pid)) return { room, player: room.players.get(pid) };
  }
  return null;
}

function socketIdOf(room, playerId) {
  for (const [sid, pid] of room.socketToPlayer) {
    if (pid === playerId) return sid;
  }
  return null;
}

// build-spec §5.9: deck === 0 → reshuffle all of discard (fresh deck if discard is
// empty too); deck < 20 → add one fresh shuffled deck. Logged as "Deck reshuffled".
function ensureDeckSufficient(room) {
  if (room.deck.length === 0) {
    if (room.discard.length > 0) {
      room.deck = game.shuffle(room.discard);
      room.discard = [];
    } else {
      room.deck = game.buildFreshDeck(++room.deckSerial);
    }
    pushLog(room, 'reshuffle', 'Deck reshuffled');
  } else if (room.deck.length < RESHUFFLE_THRESHOLD) {
    room.deck.push(...game.buildFreshDeck(++room.deckSerial));
    pushLog(room, 'reshuffle', 'Deck reshuffled');
  }
}

// Draw one card off the deck top, with auto-resupply before and after.
function drawOne(room) {
  ensureDeckSufficient(room);
  const [card] = game.deal(room.deck, 1);
  ensureDeckSufficient(room);
  return card;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload) => {
    const name = ((payload && payload.name) || '').trim();
    if (!name) return socket.emit('room:error', { message: 'Name required' });
    const roomId = makeRoomId();
    const room = game.createRoom(roomId, 1);
    room.emptySince = null;
    room.deckSerial = room.deck.length / game.CARDS_PER_DECK; // next fresh deck number (card-id uniqueness)
    rooms.set(roomId, room);
    const player = addPlayer(room, name);
    room.hostId = player.id; // first joiner is host
    joinSocket(socket, room, player);
    socket.emit('room:joined', roomStateFor(room, player));
    console.log(`[${roomId}] created by ${name}`);
  });

  socket.on('joinRoom', (payload) => {
    const { roomId } = payload || {};
    const name = ((payload && payload.name) || '').trim();
    const room = rooms.get((roomId || '').trim().toUpperCase());
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    if (!name) return socket.emit('room:error', { message: 'Name required' });
    if (nameTaken(room, name)) return socket.emit('room:error', { message: 'Name already taken' });
    if (room.players.size >= MAX_PLAYERS) return socket.emit('room:error', { message: 'Room full' });
    const player = addPlayer(room, name);
    joinSocket(socket, room, player);
    socket.emit('room:joined', roomStateFor(room, player));
    socket.to(room.id).emit('player:joined', {
      player: { id: player.id, name: player.name, count: 0, color: player.color },
    });
    console.log(`[${room.id}] ${name} joined (${room.players.size} players)`);
  });

  socket.on('rejoinRoom', (payload) => {
    const { roomId, playerId } = payload || {};
    const room = rooms.get((roomId || '').trim().toUpperCase());
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    const player = room.players.get(playerId);
    if (!player) return socket.emit('room:error', { message: 'Player not found' });
    clearGrace(player.id);
    // One seat per player id: disconnect the old socket, rebind the new one.
    for (const [sid, pid] of room.socketToPlayer) {
      if (pid === player.id && sid !== socket.id) {
        room.socketToPlayer.delete(sid);
        const old = io.sockets.sockets.get(sid);
        if (old) old.disconnect(true);
      }
    }
    joinSocket(socket, room, player);
    socket.emit('state:sync', roomStateFor(room, player));
    console.log(`[${room.id}] ${player.name} rejoined`);
  });

  socket.on('leaveRoom', () => {
    const seat = findSeat(socket);
    if (!seat) return;
    socket.leave(seat.room.id);
    removePlayer(seat.room, seat.player, { log: true });
    console.log(`[${seat.room.id}] ${seat.player.name} left`);
  });

  socket.on('dealGame', (payload) => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    if (room.hostId !== player.id) return; // host only
    const count = payload && payload.count;
    if (count !== 3 && count !== 5) return;
    // Deal resets the table: fresh deck sized for the deal, clear discard, redeal all.
    room.deck = game.buildDeck(room.players.size, count);
    room.deckSerial = room.deck.length / game.CARDS_PER_DECK;
    room.discard = [];
    for (const p of room.players.values()) p.hand = game.deal(room.deck, count);
    // Auto-flip: the deck's top card starts the discard pile (no play-blocking; sandbox unchanged).
    const [flipped] = game.deal(room.deck, 1);
    room.discard.push(flipped);
    // Hands stay private: each connected seat gets its own personalized game:dealt.
    for (const [sid, pid] of room.socketToPlayer) {
      io.to(sid).emit('game:dealt', {
        count,
        deckCount: room.deck.length,
        ownHand: room.players.get(pid).hand,
        discardStack: room.discard.slice(-3).reverse(),
      });
    }
    pushLog(room, 'deal', `Host dealt ${count} cards`);
    console.log(`[${room.id}] dealt ${count} to ${room.players.size} players`);
  });

  socket.on('playCard', (payload) => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    const idx = player.hand.findIndex((c) => c.id === (payload && payload.cardId));
    if (idx === -1) return; // card must be in the sender's hand
    const [card] = player.hand.splice(idx, 1);
    room.discard.push(card);
    io.to(room.id).emit('card:played', { playerId: player.id, card, deckCount: room.deck.length });
    pushLog(room, 'play', `${player.name} played ${card.rank} of ${card.suit}`);
  });

  socket.on('drawCard', () => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    const card = drawOne(room);
    player.hand.push(card);
    io.to(room.id).emit('card:drawn', { playerId: player.id, newHandCount: player.hand.length, deckCount: room.deck.length });
    socket.emit('card:received', { card }); // only the drawer learns which card
    pushLog(room, 'draw', `${player.name} drew a card`);
  });

  socket.on('issuePenalty', (payload) => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    const target = room.players.get(payload && payload.targetId);
    if (!target || target.id === player.id) return; // target must exist and ≠ sender
    const card = drawOne(room);
    target.hand.push(card);
    io.to(room.id).emit('penalty:issued', { fromId: player.id, toId: target.id, targetNewCount: target.hand.length, deckCount: room.deck.length });
    const tSid = socketIdOf(room, target.id);
    if (tSid) io.to(tSid).emit('card:received', { card }); // only the target learns which card
    pushLog(room, 'penalty', `${player.name} penalised ${target.name} (+1 Card)`);
  });

  socket.on('undoPenalty', (payload) => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    const target = room.players.get(payload && payload.targetId);
    if (!target || target.hand.length === 0) return;
    const card = target.hand.pop(); // reverse the draw: last card goes back onto the deck
    room.deck.push(card);
    io.to(room.id).emit('penalty:undone', { fromId: player.id, toId: target.id, targetNewCount: target.hand.length, deckCount: room.deck.length });
    pushLog(room, 'undo', `${player.name} undid penalty to ${target.name}`);
  });

  socket.on('disconnect', () => {
    const seat = findSeat(socket);
    if (!seat) return;
    const { room, player } = seat;
    room.socketToPlayer.delete(socket.id);
    markEmptyIfNeeded(room);
    // Reconnect grace: seat kept 30 min; expiry removes silently (no log).
    graceTimers.set(player.id, setTimeout(() => {
      graceTimers.delete(player.id);
      const r = rooms.get(room.id);
      if (!r || !r.players.has(player.id)) return;
      removePlayer(r, player, { log: false });
      console.log(`[${room.id}] ${player.name} removed (grace expired)`);
    }, GRACE_MS));
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.socketToPlayer.size > 0) {
      room.emptySince = null;
      continue;
    }
    if (room.emptySince === null) {
      room.emptySince = now;
      continue;
    }
    if (now - room.emptySince >= ROOM_TTL_MS) {
      for (const pid of room.players.keys()) clearGrace(pid);
      rooms.delete(id);
      console.log(`[${id}] swept (empty ${Math.round(ROOM_TTL_MS / 60000)} min)`);
    }
  }
}, SWEEP_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`mao-online listening on http://${HOST}:${PORT}`);
});
