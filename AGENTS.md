# AGENTS.md

> **Repo status: complete (all 6 phases done and verified end-to-end in multi-browser sessions).** Manual checks: the 10-point multi-tab checklist in `build-spec.md` §8.
> - `build-spec.md` — authoritative spec: stack, data model, socket contract, server invariants, UI behavior, tanbi kei theme
> - `implementation-plan.md` — 5 build phases (deck engine → server rooms → game events → static UI → client wiring), each with its own runnable verification. Build in phase order; don't skip ahead.

## Commands

- `npm install` — already run once; rerun after pulling dep changes
- `npm start` — binds `0.0.0.0:3000` (LAN mobile testing is a requirement, keep `0.0.0.0`)
- `npm run dev` — nodemon auto-restart (devDep, or `npx nodemon`)

## Architecture

- `server.js` — Express + Socket.io bootstrap, room lifecycle, all socket events
- `game.js` — pure deck/shuffle/deal logic + room factory, no I/O
- `public/index.html` — join screen + game screen (Tailwind CDN + Google Fonts CDN)
- `public/style.css` — tanbi kei theme
- `public/client.js` — socket wiring + imperative DOM rendering
- No build step, no bundler, no framework — spec forbids them.
- Socket contract refinements (recorded in `implementation-plan.md` Phase 3/5 as-built notes): `game:dealt` is personalized per seat; `card:received` is a targeted event carrying the drawn/penalty card to its owner only; state payload includes `hostId`.

## Intentional design — do NOT "fix"

- **Sandbox mode**: server is a physical card table. It enforces zero Mao rules or turns — only card-in-hand and target-exists checks. Humans penalize each other via `issuePenalty`. Never add rule/turn logic.
- **Never broadcast other players' hands** — only cardIds, counts, top discard, log.
- **No automated tests** (explicitly out of scope) — verify manually: per-phase checks in `implementation-plan.md`, plus the 10-point multi-tab checklist in `build-spec.md` §8.

## Conventions

- Cards are `<button>` elements with `aria-label="X of Y"`; suit glyphs `♥` `♦` (red), `♣` `♠` (black); decorative glyphs `aria-hidden`
- Roster/log rendering: incremental row updates, never full rebuild (rooms support 50 players)
- Client persists `mao_playerId` / `mao_roomId` in sessionStorage for reconnect; `beforeunload` leave-prompt required
- Google Fonts CDN requires `font-display: swap` + preconnect links (googleapis + gstatic)
