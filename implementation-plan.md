# Implementation Plan — Mao Online

**Principle**: every phase is independently verifiable by running something and observing output. No phase ships incomplete work — they stack cleanly.

---

### Phase 1 — Deck engine (`game.js`) ✅

**Files**: `package.json`, `game.js`

**What it builds**:
- `buildDeck(playerCount, cardsPerPlayer)` → returns a shuffled Card[] using merged decks
- `shuffle(array)` — Fisher-Yates
- `deal(deck, count)` → Splice `count` cards from top of deck array (mutates it)
- Constants: `SUITS`, `RANKS`, `SUIT_GLYPHS` (♥♦ red, ♣♠ black)

**Sub-tasks**:
1. Create `package.json` with `express` and `socket.io` as deps (and `nodemon` as devDep).
2. Implement `game.js` — pure functions, no I/O.
3. Export `createRoom(id, playerCount)` — initializes a room with a built deck, empty players, empty discard, empty log.

**Testable**:
```bash
node -e "
const g = require('./game');
const deck = g.buildDeck(50, 5);
console.assert(deck.length >= 250, 'too few cards');
console.assert(deck.length % 52 < 52, 'not full decks');
const d2 = g.buildDeck(50, 5);
console.assert(deck[0].id !== d2[0].id, 'not shuffled');
const hand = g.deal(deck, 5);
console.assert(hand.length === 5 && deck.length === deck.length, 'deal count');
console.log('Phase 1 OK');
"
```

**Done when**: script prints `Phase 1 OK` with no assertion failures.

---

### Phase 2 — Server skeleton (`server.js`, rooms) ✅

**Files**: `server.js` (new), extends `game.js`

**What it builds**:
- Express static serve from `public/`
- Socket.io server on `0.0.0.0:3000`
- In-memory `rooms` Map
- Events: `createRoom`, `joinRoom`, `leaveRoom`, `disconnect`
- Name uniqueness check, room cap check, player color assignment
- Host assignment + transfer
- Room sweep interval (60s, TTL 5 min empty)

**Sub-tasks**:
1. Wire Express + Socket.io.
2. Implement `createRoom` handler — call `createRoom()`, assign host, assign color from palette, store room.
3. Implement `joinRoom` — validate room exists, name unique (trim + lowercase compare), room < 50, add player.
4. Implement `disconnect` — set timeout for 30-min grace; if no reconnect, remove player. Transfer host if needed.
5. Implement `leaveRoom` — same as timeout expiry but immediate.
6. Implement room sweep — `setInterval`, check each room for 0 connected sockets + >5 min, delete.
7. Implement `rejoinRoom` — validate player id, rebind socket, disconnect old socket, emit `state:sync` with full room state.
8. Emit `room:joined` with: `{ playerId, roomId, isHost, ownHand, roster: [{id, name, count, color}], deckCount, topCard, log }`.

**Testable**:
```bash
npm start
```
Open browser at `localhost:3000`, in console:
```js
const socket = io();
socket.emit('createRoom', {name: 'Alice'});
// Observe room:joined in response
```
Open second tab, in console:
```js
socket.emit('joinRoom', {roomId: '<from tab 1>', name: 'Alice'});
// Should get room:error "Name already taken"
socket.emit('joinRoom', {roomId: '<from tab 1>', name: 'Bob'});
// Should get room:joined
```
Close second tab → first tab's console (if wired) sees `player:left`.

**Done when**: create room, join room, duplicate reject, leave, and host transfer all work from browser console.

---

### Phase 3 — Full server game logic ✅

**Files**: `server.js` (extended)

**What it builds**:
- `dealGame` — rebuild deck + clear discard + deal to every player; broadcast `game:dealt`
- `playCard` — validate card in sender's hand; remove → push to discard; broadcast `card:played`
- `drawCard` — splice deck top → sender's hand; auto-reshuffle if deck falls below 20; broadcast `card:drawn`
- `issuePenalty` — target ≠ sender + target exists; splice deck top → target's hand; broadcast `penalty:issued`
- `undoPenalty` — target exists; remove last card from target's hand → push to deck; broadcast `penalty:undone`
- Deck auto-resupply: `ensureDeckSufficient()` called after every draw; if deck < 20 cards, add fresh shuffled deck; if deck === 0, reshuffle discard; if discard also empty, add fresh deck.
- Log push: every action pushes to `room.log` (capped at 100), emits `log:entry`.

**Testable**:
Console test in a browser tab (after Phase 2 join):
```js
socket.emit('dealGame', {count: 5});
// Observe game:dealt broadcast, hand length = 5

socket.emit('playCard', {cardId: '<one from hand>'});
// Observe card:played broadcast, deck count, top card

socket.emit('drawCard');
// Observe card:drawn, hand count +1

socket.emit('issuePenalty', {targetId: '<player2 id>'});
// Observe penalty:issued, target count +1

socket.emit('undoPenalty', {targetId: '<player2 id>'});
// Observe penalty:undone, target count -1
```

Cross-tab: Tab A deals, Tab B sees the deal. Tab A plays a card, Tab B sees it appear as top discard and feed entry. Tab B draws, Tab A sees B's count change.

**Done when**: every event triggers its broadcast in a second tab, deck auto-resupplies below 20, and log is populated.

**As built — contract refinements Phase 5 must honor**:
- `game:dealt` is personalized per seat: `{ count, deckCount, ownHand }` (keeps hands private; not a plain room broadcast).
- `card:received {card}` — targeted event to the drawer / penalty target only (broadcasts carry counts, never the card).
- On `penalty:undone` with `toId === me`: pop the last card of own hand (server pops last).
- Log strings as built: `Host dealt N cards`, `X played R of S`, `X drew a card`, `X penalised Y (+1 Card)`, `X undid penalty to Y`, `Deck reshuffled`.

---

### Phase 4 — Static UI (`index.html`, `style.css`)

**Files**: `public/index.html`, `public/style.css` (new)

**What it builds**:
Full game screen for the Tanbi Kei theme, using Tailwind CDN + Google Fonts CDN:

**Join screen**:
- Name input, room code input, Create button, Join button
- Error message inline display
- Tanbi Kei styling: ivory background, gold-heading serif, ornamental dividers

**Game screen** (behind JS toggle — display: none until joined):
1. **Table zone** — deck pile (count badge) + top discard card (or "empty" placeholder)
2. **Hand dock** — 5 sample cards in fan layout (mock, no real data yet). Card = button with rank, suit glyph, color. Fan rotation visible. Overflow scroll test with 25 mock cards.
3. **Players panel** — scrollable list of mock players: name, count badge, Penalize button (wine-red wax-seal style). Host row shows "Deal 3" / "Deal 5" buttons. Search input filters names.
4. **Action feed** — scrollable with sample log entries, newest on top, styled with ornamental dividers.

**Mobile**:
```css
@media (max-width: 768px) {
  /* stack layout: table top, hand bottom, buttons above hand, sheets as fixed bottom sheets */
}
```
- `100dvh`, `env(safe-area-inset-*)`
- `touch-action: manipulation`, `overscroll-behavior: contain` on sheets
- 44px minimum heights on buttons/penalize

**Google Fonts**:
- `<link rel="preconnect">` for `fonts.googleapis.com` and `fonts.gstatic.com`
- Playfair Display (headings), Cormorant Garamond (body), Cinzel (indices)
- `font-display: swap`

**Tailwind utility classes used** for the main layout + custom properties in CSS for the ornamental details (filigree borders, gold rules, paper-grain background, vignettes).

**Testable**: open `localhost:3000` → join screen renders beautifully with the correct theme. "Create" → game screen shows with mock data. Resize browser → mobile layout triggers. Open on phone → no horizontal scrollbar, safe areas respected, fonts load correctly.

**Done when**: static layout passes visual validation across desktop + mobile, with tanbi kei palette and type, and mock cards/roster/log all render.

---

### Phase 5 — Client wiring (`client.js`)

**Files**: `public/client.js` (new), modifies `index.html` slightly

**What it builds**:
- Socket connection + event handlers for all Phase 3 events
- SessionStorage: `mao_playerId`, `mao_roomId` (set on `room:joined`, cleared on leave / beforeunload)
- `beforeunload` → `event.preventDefault()` + `event.returnValue = ''` (modern browsers) or `return 'Leave game?'`
- On `room:joined` / `state:sync`:
  - Render own hand (fan, click-to-play)
  - Render roster (name, count, penalize, search filtered)
  - Render top discard + deck count
  - Render initial log
  - Show/hide host Deal buttons
- `card:played` → update own hand (remove card), update top discard, update deck count, append log
- `card:drawn` → update own/roster hand count, update deck count, append log
- `penalty:issued` → update roster count, update deck count, append log; if sender is me, show 2s undo toast
- `penalty:undone` → update roster count, update deck count, append log
- `player:joined` / `player:left` → update roster row, append log
- `host:changed` → show/hide Deal buttons
- Click Penalize → `issuePenalty`. If toast active, send `undoPenalty` instead.
- Hand overflow and fan: dynamically adjust fan rotation based on hand length. Cards are `<button>` elements with `aria-label="X of Y"`, suit glpyhs `aria-hidden`.
- Search: filter roster rows by name substring (client-side).
- Bottom sheets (mobile): toggle "Players" / "Log" sheets via button clicks.

**Testable**: Full Phase 5 test = verification checklist from build-spec.md:
1. 3+ tabs, distinct names → works, duplicate rejected
2. Host deals 5 → counts + deck + hands update everywhere, other players' hands private
3. Card play → discard top + feed + count change in all tabs
4. Penalize → target count +1, feed, undo toast on sender
5. Undo → count reverses
6. Refresh → seat restored
7. Host leaves → host badge moves
8. Phone → works on LAN
9. 50 tabs join → 51st rejected

**Done when**: all 9 verification items pass.

---

### Phase summary

| Phase | Files | Test driver | Effort |
|---|---|---|---|
| 1 | `package.json`, `game.js` | `node -e "..."` | Small |
| 2 | `server.js` (rooms, identity) | Browser console + 2 tabs | Medium |
| 3 | `server.js` (game events) | Browser console + 2 tabs | Medium |
| 4 | `index.html`, `style.css` | Visual in browser + phone | Large |
| 5 | `client.js` (+ minor `index.html`) | Full gameplay in 3+ tabs + phone | Large |
