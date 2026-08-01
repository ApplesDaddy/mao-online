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
    isHost: room.hostId === player.id,
    ownHand: player.hand,
    roster: rosterOf(room),
    deckCount: room.deck.length,
    topCard: room.discard.length ? room.discard[room.discard.length - 1] : null,
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

io.on('connection', (socket) => {
  socket.on('createRoom', (payload) => {
    const name = ((payload && payload.name) || '').trim();
    if (!name) return socket.emit('room:error', { message: 'Name required' });
    const roomId = makeRoomId();
    const room = game.createRoom(roomId, 1);
    room.emptySince = null;
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
