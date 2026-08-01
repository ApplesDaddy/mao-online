# Mao Online — Build Spec

Real-time multiplayer card game. **Absolute Sandbox Mode**: server is a physical card table — zero rule enforcement. Humans notice violations and penalize each other.

## 1. Stack
Backend: Node.js, Express, Socket.io.
Frontend: Single `index.html`, Tailwind CDN, Google Fonts, vanilla JS `client.js` + `style.css`.
npm scripts: `start` = `node server.js`, `dev` = `nodemon server.js`. Server binds `0.0.0.0:3000`.

## 2. Files
```
package.json
server.js         # HTTP + Socket.io, room lifecycle, events
game.js           # deck builder, shuffle, room factory (pure)
public/index.html # join screen → game screen
public/style.css  # tanbi kei theme
public/client.js  # socket wiring + DOM rendering
```

## 3. Data model
```js
Card   { id, rank, suit, deck }          // id = `${deck}-${suit}-${rank}`, unique per instance
Player { id, name, hand: Card[], color }  // id = crypto.randomUUID(); color auto-assigned from palette
Room   { id, hostId, players: Map<id, Player>, socketToPlayer: Map<socketId, id>,
         deck: Card[], discard: Card[], log: LogEntry[], createdAt }
LogEntry { ts, type, text }
```
Ranks: `2–10, J, Q, K, A`. Suits: `hearts, clubs, diamonds, spades`.

## 4. Socket contract
All game broadcasts → `io.to(room.id)`. **Never send others' hands** — only cardId, counts, top discard, log.

| Client → Server | Payload | Behavior |
|---|---|---|
| `createRoom` | `{name}` | create room, first player = host, join them, emit `room:joined` |
| `joinRoom` | `{roomId, name}` | room exists + name unique (trimmed, case-insensitive) + **under 50** → `room:joined`; else `room:error {message}` |
| `rejoinRoom` | `{roomId, playerId}` | rebind socket → seat; restore hand; disconnect old socket if duplicate player id |
| `dealGame` | `{count: 3\|5}` | **host only**; rebuild deck, clear discard, deal to all; log "Host dealt N cards" |
| `playCard` | `{cardId}` | card must be in sender's hand; remove → discard top; broadcast `card:played` |
| `drawCard` | — | draw 1 from deck → sender's hand; broadcast `card:drawn` |
| `issuePenalty` | `{targetId}` | target ≠ sender; draw 1 → target's hand; log "X penalised Y (+1 Card)"; broadcast `penalty:issued` |
| `undoPenalty` | `{targetId}` | reverse — remove 1 from target's hand, add to deck; log "X undid penalty to Y" |
| `leaveRoom` | — | leave; broadcast; transfer host if host leaves; log "X left" + expire room if empty 5 min |

**Broadcast events**: `room:joined`, `room:error`, `player:joined`, `player:left`, `state:sync`, `game:dealt`, `card:played` `{playerId, card, deckCount}`, `card:drawn` `{playerId, newHandCount, deckCount}`, `penalty:issued` `{fromId, toId, targetNewCount, deckCount}`, `penalty:undone` `{fromId, toId, targetNewCount, deckCount}`, `log:entry`, `host:changed`.

## 5. Server invariants
1. **Sandbox**: only validate card-in-hand and target-exists. No turn/rule logic.
2. **Name unique** per room: trimmed, case-insensitive "Name already taken". Freed on player removal.
3. **Player id** = `crypto.randomUUID()`. Client stores `mao_playerId` + `mao_roomId` in sessionStorage. Clear on proper leave.
4. **Socket rebind**: player id arrives on new socket → disconnect old socket, rebind new.
5. **Reconnect grace**: kept 30 min after disconnect. Expired = removed silently (no log unless connected at removal).
6. **Host**: first joiner. Leaves → transfer to earliest remaining player; emit `host:changed`.
7. **Room empty** for ≥5 min → sweep (check every 60s). Expired room removed regardless of age.
8. **Room cap**: 50 players. Exceed → `room:error "Room full"`.
9. **Deck build**: `decks = ceil((players * cardsPerPlayer + 200) / 52)`; merged, shuffled. `+200` buffer for penalties. During play, if deck falls below 20 cards → auto-add one fresh shuffled deck. If deck reaches 0 → reshuffle all of discard into deck; if discard also empty, add a fresh deck alone. Log: "Deck reshuffled".
10. **Deal resets table**: new deck, clear discard, redeal all.
11. **Log** capped at 100, newest first.
12. **Deck count** included in every `card:played`, `card:drawn`, `penalty:issued`, `penalty:undone` broadcast.

## 6. Client behavior

### Join screen
Name input + room code (Create / Join). Show `room:error` messages inline.

### Game screen — 4 zones
1. **Table** (top portrait / center desktop) — deck pile (remaining count) + top discard card.
2. **Hand dock** (bottom) — overlapping fan of own cards: **`<button>` elements**, `aria-label="X of Y"`, decorative suit glyphs `aria-hidden`. Tap/click to play; drag optional.
   - Fan rotation: ±20° when ≤10 cards, linearly compress to ±5° at 20+ cards.
   - Overflow: `max-width: 100%` + `overflow-x: auto` — prevents 20+ cards from breaking mobile.
3. **Players sheet** — searchable, scrollable. Each row: name, card count, **≥44px Penalize `<button>`** (disabled/hidden for self). Host sees **"Deal 3" + "Deal 5"** side-by-side buttons (no modal).
   - **Penalize undo**: on sender's client only, show 2s toast "Penalized X — tap again to undo". If tapped within 2s, send `undoPenalty`; server reverses draw. Toast shows target name to avoid ambiguity.
4. **Action feed** — scrollable `<ul>` or `<div>`, newest on top, `aria-live="polite"`. Auto-scroll to newest only if viewport is within 50px of latest entry (don't yank scroll while reading history).

### Mobile layout (portrait)
- Table zone top; hand dock bottom.
- "Players" + "Log" buttons above hand → open bottom sheets with `overscroll-behavior: contain`.
- Desktop/landscape: persistent sidebar + log column.

### Key rules
- **`beforeunload`** → `"Leave the game?"` prompt to prevent accidental tab close.
- `100dvh`, `env(safe-area-inset-*)` on full-bleed zones.
- `touch-action: manipulation`, `-webkit-tap-highlight-color` intentional, no `user-scalable=no`.
- `prefers-reduced-motion` off-switch for fan animation.
- Re-render own hand on change; roster + log → incremental row updates, never full rebuild. 50 rows needs no virtualization.

## 7. Aesthetic — tanbi kei (耽美): elegant / aristocratic
- **Palette**: ivory/parchment base, gold-leaf accents, burgundy, deep emerald, ink-navy. `color-scheme: light`; `<meta name="theme-color">` = ivory.
- **Type**: Google Fonts CDN serif — Cormorant Garamond / Playfair Display (headings), Cinzel (indices/numerals). `font-display: swap`; `<link rel="preconnect">` for `fonts.googleapis.com` + `fonts.gstatic.com`. Tabular-nums on counts.
- **Cards**: classic French deck — ornamental gold frames, serif indices, suit glyphs, paper-grain.
- **Chrome**: filigree borders, gold rules, ornamental dividers in feed, damask background pattern.
- **Buttons**: gold-bordered serif; **Penalize** styled wine-red wax-seal — highest-contrast element on screen.
- **Contrast AA**: ink text on cream; never gold on white for body copy.
- **Game zones kept clean** (table, hand, roster rows) — ornament reserved for chrome/panels so 50-player readability is not harmed.

## 8. Verification
1. `npm start` → 3+ tabs, distinct names. Duplicate name → rejected.
2. Cap: script 51 joins → 50th succeeds, 51st gets "Room full".
3. Host deals 5 → counts update; hands private; deck count shows.
4. Tab A plays card → discard top + feed + count update in all tabs.
5. Tab B penalizes A → A count +1, feed entry, undo toast appears on B only.
6. Tap undo within 2s → A count -1, card returned.
7. Refresh tab → seat + hand restored.
8. Host leaves → host badge transfers; feed logs "X left".
9. Empty room after 5 min → gone.
10. Phone on same Wi-Fi → `http://<mac-ip>:3000`, portrait + landscape, safe areas, 44px targets.

## 9. Build order
1. `package.json` + `game.js` — verify deck scaling with `node -e "require('./game')"`.
2. `server.js` — rooms, events, invariants; test with printed debug logs.
3. Static `index.html` + `style.css` — mock data for visual validation.
4. `client.js` — wire sockets; multi-tab test; phone test.

## 10. Out of scope
Auth, persistence, Mao rules, AI, spectators, replay, PWA, automated tests.
