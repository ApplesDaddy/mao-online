/* ═══════════════════════════════════════════════════════════════════
   cards.js — playing-card face art for Mao Online.

   Real-deck anatomy:
     · corner indices in the two diagonal corners, the lower one inverted
     · standard pip layouts for A–10, pips below the centre line rotated 180°
     · double-headed court figures (J/Q/K) mirrored about the centre line,
       inside a framed panel with a dividing rule
   Suit-coloured shapes use `currentColor`, so `.card.red` / `.card.black`
   still drive the colour from style.css.

   No build step: exposes `window.MaoCards` and injects ONE hidden <svg>
   sprite that every card <use>s, so a full table of cards stays cheap.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  // Face user space. 100×140 ≈ the 2.5×3.5in proportions of a real card.
  const W = 100, H = 140, MID = H / 2; // MID: pips below it invert, courts mirror about it

  // Art literals. These mirror the style.css custom properties, but SVG
  // presentation attributes can't read var() reliably (iOS Safari), so the
  // palette is duplicated here — keep the two in sync by hand.
  const INK = '#1d2433';
  const GOLD = '#a07d1c';
  const GOLD_SOFT = '#c9b47c';
  const PAPER = '#fbf7ec';   // linen white — collars, ruffs, beard
  const PANEL = '#f7f0e0';   // court panel ground
  const SKIN = '#f2ddc2';
  const BEARD = '#e6dcc6';   // greying court beard — reads apart from a white collar
  const STEEL = '#cfcabb';
  const HAIR = '#7a5c2a';
  const LEAF = '#2f5d3a';

  const RANK_NAMES = {
    A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King',
    2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six',
    7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
  };
  const SUIT_NAMES = { hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs', spades: 'Spades' };

  // ── Suit pips ───────────────────────────────────────────────────────
  // Each pip is drawn centred on the origin, ~20 wide × 22 tall, so a pip
  // is placed with translate(cx cy) scale(s) and inverted with a trailing
  // rotate(180) — no per-pip geometry maths.
  const PIPS = {
    hearts:
      '<path d="M0 9.6C-3.3 5.8-9.5 1.3-9.5-3.5c0-4.5 3.5-7 6.6-5.5C-1.2-8.2-.4-6.8 0-5.6.4-6.8 1.2-8.2 2.9-9c3.1-1.5 6.6 1 6.6 5.5C9.5 1.3 3.3 5.8 0 9.6Z"/>',
    diamonds:
      '<path d="M0-10.8 7.7 0 0 10.8-7.7 0Z"/>',
    spades:
      '<path d="M0-10.8c-1.5 4.7-9.3 8.4-9.3 13.3 0 3.5 2.7 5.6 5.5 5.6 1.9 0 3.2-.8 3.8-1.9.6 1.1 1.9 1.9 3.8 1.9 2.8 0 5.5-2.1 5.5-5.6C9.3-1.6 1.5-5.3 0-10.8Z"/>'
      + '<path d="M0 4.2c1.2 3.1 2.4 5.2 4.7 6.6h-9.4C-2.4 9.4-1.2 7.3 0 4.2Z"/>',
    clubs:
      '<circle cx="0" cy="-5.2" r="4.8"/><circle cx="-5.8" cy="2.4" r="4.8"/><circle cx="5.8" cy="2.4" r="4.8"/>'
      + '<path d="M0 .6c1.1 4.1 2.2 7.6 4.7 10.2h-9.4C-2.2 8.2-1.1 4.7 0 .6Z"/>',
  };

  // ── Pip layouts ─────────────────────────────────────────────────────
  // Columns at 31 / 50 / 69; rows symmetric about MID so the inverted
  // lower half lines up with the upper half, exactly like a real card.
  const L = 31, C = 50, R = 69;
  const TOP = 32, BOT = 108;            // outer rows (MID ± 38)
  const UP = 53.5, LOW = 86.5;          // inner rows for 6/7/8 side columns (MID ± 16.5)
  const Q4 = [32, 57.3, 82.7, 108];     // 9 and 10 run four pips per column
  const SEVEN = 51, EIGHT = 89;         // 7/8 centre pips sit between the rows
  const TEN_A = 44.7, TEN_B = 95.3;

  const LAYOUTS = {
    2: [[C, TOP], [C, BOT]],
    3: [[C, TOP], [C, MID], [C, BOT]],
    4: [[L, TOP], [R, TOP], [L, BOT], [R, BOT]],
    5: [[L, TOP], [R, TOP], [C, MID], [L, BOT], [R, BOT]],
    6: [[L, TOP], [R, TOP], [L, MID], [R, MID], [L, BOT], [R, BOT]],
    7: [[L, TOP], [R, TOP], [C, SEVEN], [L, MID], [R, MID], [L, BOT], [R, BOT]],
    8: [[L, TOP], [R, TOP], [C, SEVEN], [L, MID], [R, MID], [C, EIGHT], [L, BOT], [R, BOT]],
    9: [[L, Q4[0]], [R, Q4[0]], [L, Q4[1]], [R, Q4[1]], [C, MID], [L, Q4[2]], [R, Q4[2]], [L, Q4[3]], [R, Q4[3]]],
    10: [[L, Q4[0]], [R, Q4[0]], [C, TEN_A], [L, Q4[1]], [R, Q4[1]], [L, Q4[2]], [R, Q4[2]], [C, TEN_B], [L, Q4[3]], [R, Q4[3]]],
  };

  const PIP_SCALE = 0.86;  // ~19 units tall — about 1/7 of card height, as on a real card
  const ACE_SCALE = 2.05;
  const IDX_SCALE = 0.42;  // corner index pip

  // ── Court figures ───────────────────────────────────────────────────
  // Each group draws only the UPPER half (y 14…70) of the figure; the card
  // <use>s it twice, the second time rotated 180° about (50, 70), which is
  // how a real double-headed court card is laid out.
  // Robes/caps are currentColor so the suit tints each court card, and the
  // hatch pattern over them stands in for engraved shading.

  const HATCH = `<pattern id="mao-hatch" width="3.6" height="3.6" patternUnits="userSpaceOnUse"`
    + ` patternTransform="rotate(45)"><path d="M0 0V3.6" stroke="${INK}" stroke-width=".5" opacity=".26"/></pattern>`;

  // Engraved features: arched brows, lidded eyes, hooked nose, level mouth.
  // Deliberately not a smile — court faces are stern.
  function face(cy, opts) {
    const o = opts || {};
    const eye = cy - 2.4;
    return ''
      + `<path d="M44.4 ${eye - 3}q2.2-1.8 4-.6M55.6 ${eye - 3}q-2.2-1.8-4-.6" stroke="${INK}" stroke-width=".75" fill="none" stroke-linecap="round"/>`
      + `<path d="M44.4 ${eye - .4}q2-1.9 3.8-.2M55.6 ${eye - .4}q-2-1.9-3.8-.2" stroke="${INK}" stroke-width=".65" fill="none" stroke-linecap="round"/>`
      + `<circle cx="46.2" cy="${eye}" r=".9" fill="${INK}"/><circle cx="53.8" cy="${eye}" r=".9" fill="${INK}"/>`
      + `<path d="M50 ${eye + .2}v3.9l1.7.9" stroke="${INK}" stroke-width=".75" fill="none" stroke-linecap="round"/>`
      + (o.moustache
        ? `<path d="M50 ${cy + 4.2}q-2.9 2.8-5.2.4M50 ${cy + 4.2}q2.9 2.8 5.2.4" stroke="${INK}" stroke-width="1.15" fill="none" stroke-linecap="round"/>`
        : `<path d="M47.5 ${cy + 4.4}h5" stroke="${INK}" stroke-width=".9" stroke-linecap="round"/>`)
      + `<path d="M43.6 ${cy - .8}q-.9 2.2.3 4M56.4 ${cy - .8}q.9 2.2-.3 4" stroke="${INK}" stroke-width=".45" fill="none" opacity=".7"/>`;
  }

  // Head: oval + ears + a hair crescent on the forehead, so the face isn't a
  // bare egg under the headwear.
  function head(cy, rx, ry) {
    const ex = 50 - rx + .5;
    return ''
      + `<ellipse cx="${ex}" cy="${cy + 1}" rx="1.5" ry="2.1" fill="${SKIN}" stroke="${INK}" stroke-width=".6"/>`
      + `<ellipse cx="${100 - ex}" cy="${cy + 1}" rx="1.5" ry="2.1" fill="${SKIN}" stroke="${INK}" stroke-width=".6"/>`
      + `<ellipse cx="50" cy="${cy}" rx="${rx}" ry="${ry}" fill="${SKIN}" stroke="${INK}" stroke-width=".8"/>`
      + `<path d="M${50 - rx + .6} ${cy - ry * .3}C${50 - rx * .8} ${cy - ry * 1.08} ${50 + rx * .8} ${cy - ry * 1.08} ${50 + rx - .6} ${cy - ry * .3}`
      + `C${50 + rx * .5} ${cy - ry * .62} ${50 - rx * .5} ${cy - ry * .62} ${50 - rx + .6} ${cy - ry * .3}Z" fill="${HAIR}"/>`;
  }

  // A gripping hand with a cuff — court figures always hold their prop.
  function hand(x, y, rot) {
    return `<g transform="translate(${x} ${y}) rotate(${rot || 0})">`
      + `<path d="M-3.5-4.2h7v2h-7Z" fill="${PAPER}" stroke="${INK}" stroke-width=".55"/>`
      + `<path d="M-2.7-2.6h5.4c1.1 0 1.9.9 1.9 2.1v2.2c0 1.6-1.1 2.7-2.7 2.7h-3.8c-1.6 0-2.7-1.1-2.7-2.7v-2.2c0-1.2.8-2.1 1.9-2.1Z" fill="${SKIN}" stroke="${INK}" stroke-width=".65"/>`
      + `<path d="M-1.9 1h3.9M-1.9 2.7h3.6" stroke="${INK}" stroke-width=".35" opacity=".7"/>`
      + `</g>`;
  }

  // Robe silhouette shared by all three courts — filled with the suit colour,
  // then again with the hatch pattern for engraved shading, then gold trim.
  function robe(d, trim) {
    return `<path d="${d}" fill="currentColor" stroke="${INK}" stroke-width=".8"/>`
      + `<path d="${d}" fill="url(#mao-hatch)" stroke="none"/>`
      + trim;
  }

  const KING_ROBE = 'M24.6 70v-8.4c0-6.4 6-11.2 13.4-13.4L45 55h10l7-6.8c7.4 2.2 13.4 7 13.4 13.4V70Z';
  const KING = ''
    // scepter up the right side (the mirror puts one down the left)
    + `<rect x="70.4" y="30" width="2.6" height="40" rx="1" fill="${GOLD}" stroke="${INK}" stroke-width=".5"/>`
    + `<circle cx="71.7" cy="26.4" r="3.8" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M71.7 19v4.4M69.4 21.2h4.6" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`
    + robe(KING_ROBE,
      `<path d="M45 55 50 70 55 55" stroke="${GOLD}" stroke-width="1" fill="none"/>`
      + `<path d="M31 56.5 34.5 70M69 56.5 65.5 70" stroke="${GOLD_SOFT}" stroke-width=".7" fill="none" opacity=".9"/>`
      + `<path d="M46.4 60h7.2v10h-7.2Z" fill="${GOLD}" stroke="${INK}" stroke-width=".5"/>`
      + `<circle cx="50" cy="63.4" r="1.2" fill="currentColor"/><circle cx="50" cy="67.4" r="1.2" fill="currentColor"/>`)
    + hand(71.7, 53.5, 0)
    // ermine collar
    + `<path d="M38.2 48.6c3.6 8.4 20 8.4 23.6 0l3.4 6.8c-6 8.8-24.4 8.8-30.4 0Z" fill="${PAPER}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M41.4 54.6v2.2M50 57.8v2.2M58.6 54.6v2.2" stroke="${INK}" stroke-width=".8" stroke-linecap="round"/>`
    // hair scrolls
    + `<path d="M40.6 34.4c-3.2 5.6-3.4 13 .2 17.4-1.4-6-.8-12 1.6-16.6ZM59.4 34.4c3.2 5.6 3.4 13-.2 17.4 1.4-6 .8-12-1.6-16.6Z" fill="${HAIR}"/>`
    + `<path d="M39.8 42c-2.4 1.6-3.4 4.6-2.4 7 1-2.6 1.8-4.6 3.4-6ZM60.2 42c2.4 1.6 3.4 4.6 2.4 7-1-2.6-1.8-4.6-3.4-6Z" fill="${HAIR}"/>`
    // head + beard (greyed parchment so it reads apart from the white collar)
    + head(39.6, 7.8, 9.4)
    + `<path d="M43.4 43.4c.6 7.6 3.2 11.8 6.6 11.8s6-4.2 6.6-11.8c-1.2 3.4-3.6 5.2-6.6 5.2s-5.4-1.8-6.6-5.2Z" fill="${BEARD}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M45.8 49.4q1 3.6.9 5.2M50 50.6v4.6M54.2 49.4q-1 3.6-.9 5.2" stroke="${INK}" stroke-width=".45" fill="none" opacity=".8"/>`
    + face(39.6, { moustache: true })
    // crown
    + `<path d="M36.4 29.6 38.6 19.4 44 25.8 50 16 56 25.8 61.4 19.4 63.6 29.6Z" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/>`
    + `<rect x="36" y="28.8" width="28" height="5.8" rx="1.6" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M36.4 31.7h27.2" stroke="${INK}" stroke-width=".4" opacity=".5"/>`
    + `<circle cx="50" cy="15.8" r="1.9" fill="currentColor"/>`
    + `<circle cx="38.6" cy="19.1" r="1.3" fill="currentColor"/><circle cx="61.4" cy="19.1" r="1.3" fill="currentColor"/>`
    + `<circle cx="43" cy="31.6" r="1.2" fill="currentColor"/><circle cx="57" cy="31.6" r="1.2" fill="currentColor"/>`;

  const QUEEN_ROBE = 'M25.6 70v-7.6c0-6.2 6-10.8 12.8-12.6L45.4 57h9.2l7-7.2C68.4 51.6 74.4 56.2 74.4 62.4V70Z';
  const QUEEN = ''
    // rose, held up the left side
    + `<path d="M29.4 70c-1-9.4-.6-17.4.4-24" stroke="${LEAF}" stroke-width="1.5" fill="none"/>`
    + `<path d="M29.8 54.4c-4.2-1.6-6-5.6-4-8.4 2.8 1 4.8 4 4 8.4Z" fill="${LEAF}"/>`
    + `<path d="M30.4 47.6c3.6-1 6.2-4.2 5.4-7.4-2.8.6-5 3.2-5.4 7.4Z" fill="${LEAF}"/>`
    + `<g fill="currentColor" stroke="${INK}" stroke-width=".4"><circle cx="29.8" cy="35.4" r="2.9"/><circle cx="34.4" cy="38.8" r="2.9"/><circle cx="32.6" cy="44.2" r="2.9"/><circle cx="27" cy="44.2" r="2.9"/><circle cx="25.2" cy="38.8" r="2.9"/></g>`
    + `<circle cx="29.8" cy="40.4" r="1.9" fill="${GOLD}" stroke="${INK}" stroke-width=".4"/>`
    // hair falling behind the shoulders
    + `<path d="M38.8 36c-4 9.6-3.6 17.6-.6 23.4-1.2-8.4-.8-15.6 2-21.6ZM61.2 36c4 9.6 3.6 17.6.6 23.4 1.2-8.4.8-15.6-2-21.6Z" fill="${HAIR}"/>`
    + robe(QUEEN_ROBE,
      `<path d="M45.4 57 50 70 54.6 57" stroke="${GOLD}" stroke-width="1" fill="none"/>`
      + `<path d="M38 58 50 70 62 58" stroke="${GOLD_SOFT}" stroke-width=".65" fill="none"/>`
      + `<path d="M32.6 59.4 37 70M67.4 59.4 63 70" stroke="${GOLD_SOFT}" stroke-width=".65" fill="none"/>`)
    + hand(29.6, 56.5, 4)
    // ruff
    + `<path d="M39 54.4c4.4 6.6 17.6 6.6 22 0l2 5c-5.8 7.2-20.2 7.2-26 0Z" fill="${PAPER}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M42.6 56.6q2.4 4.4 4.8 1q2.4 4.4 4.8 1q2.4 4.2 4.6-.6" stroke="${INK}" stroke-width=".45" fill="none" opacity=".75"/>`
    // hair
    + `<path d="M41 35.8c-3 5.8-3.2 13.4.2 17.6-1.6-6-1-12.2 1.4-16.8ZM59 35.8c3 5.8 3.2 13.4-.2 17.6 1.6-6 1-12.2-1.4-16.8Z" fill="${HAIR}"/>`
    + head(41, 7.4, 9)
    + face(41, {})
    // coronet: open crown of points and pearls, hair showing beneath
    + `<path d="M40.2 30.8 42.6 24.4 46.3 29 50 22.2 53.7 29 57.4 24.4 59.8 30.8Z" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/>`
    + `<rect x="39.6" y="30.4" width="20.8" height="4.4" rx="1.3" fill="${GOLD}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M40.2 32.6h19.6" stroke="${INK}" stroke-width=".35" opacity=".45"/>`
    + `<circle cx="50" cy="21.6" r="1.6" fill="${PAPER}" stroke="${INK}" stroke-width=".5"/>`
    + `<circle cx="42.6" cy="23.7" r="1.3" fill="${PAPER}" stroke="${INK}" stroke-width=".5"/><circle cx="57.4" cy="23.7" r="1.3" fill="${PAPER}" stroke="${INK}" stroke-width=".5"/>`
    + `<circle cx="45" cy="32.7" r="1.1" fill="currentColor"/><circle cx="55" cy="32.7" r="1.1" fill="currentColor"/>`;

  const JACK_ROBE = 'M26 70v-7c0-5.8 5.8-10 12.4-11.8L45 57.4h10l6.6-6.2C68.2 53 74 57.2 74 63v7Z';
  const JACK = ''
    // pike, shouldered on the right
    + `<path d="M67.6 70 73.4 27" stroke="${HAIR}" stroke-width="2" stroke-linecap="round"/>`
    + `<path d="M73.6 25.6 69.4 32.4l8.2-2.6Z" fill="${STEEL}" stroke="${INK}" stroke-width=".6"/>`
    + `<path d="M73.8 25.2c-3.8-4.4-3.2-10.4.6-13.6 3 3.6 3.2 9.6-.6 13.6Z" fill="${STEEL}" stroke="${INK}" stroke-width=".6"/>`
    + `<path d="M74.2 22.4v-8" stroke="${INK}" stroke-width=".4" opacity=".6"/>`
    + robe(JACK_ROBE,
      `<path d="M45 57.4 50 70 55 57.4" stroke="${GOLD}" stroke-width="1" fill="none"/>`
      + `<circle cx="50" cy="62.4" r="1.2" fill="${GOLD}"/><circle cx="50" cy="66.8" r="1.2" fill="${GOLD}"/>`
      + `<path d="M33.4 57.6 36.6 70M66.6 57.6 63.4 70" stroke="${GOLD_SOFT}" stroke-width=".65" fill="none"/>`)
    + hand(69.6, 55.5, -8)
    // ruffed collar
    + `<path d="M39.2 53.6c4.2 6.4 17.4 6.4 21.6 0l2.6 5c-5.8 7.2-21 7.2-26.8 0Z" fill="${PAPER}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M42.4 55.8q2.4 4.4 4.8 1q2.4 4.4 4.8 1q2.4 4.2 4.6-.6" stroke="${INK}" stroke-width=".45" fill="none" opacity=".75"/>`
    // hair
    + `<path d="M41 35.6c-3 5.4-3.2 12.6.2 16.8-1.6-5.8-1-11.6 1.4-16ZM59 35.6c3 5.4 3.2 12.6-.2 16.8 1.6-5.8 1-11.6-1.4-16Z" fill="${HAIR}"/>`
    + head(41, 7.4, 8.8)
    + face(41, { moustache: true })
    // cap + plume sweeping left (the pike owns the right side)
    + `<path d="M39.4 30.8c-4.6-2.4-7.8-6.8-8.2-11.8 4.2 2 7.2 6.4 8.8 11.4Z" fill="${PAPER}" stroke="${INK}" stroke-width=".7"/>`
    + `<path d="M38.6 29.8c-2.6-2.6-4.6-5.6-5.6-8.6" stroke="${INK}" stroke-width=".45" fill="none" opacity=".65"/>`
    + `<path d="M35.8 24.2 33.2 25.8M37.2 27 34.8 28.8" stroke="${INK}" stroke-width=".4" opacity=".6"/>`
    + `<path d="M38.8 31.6C39.4 24 44.2 19.8 50 19.8s10.6 4 11.2 11.8Z" fill="currentColor" stroke="${INK}" stroke-width=".8"/>`
    + `<path d="M38.8 31.6C39.4 24 44.2 19.8 50 19.8s10.6 4 11.2 11.8Z" fill="url(#mao-hatch)" stroke="none"/>`
    + `<rect x="38.2" y="31" width="23.6" height="4.4" rx="1.3" fill="${GOLD}" stroke="${INK}" stroke-width=".6"/>`
    + `<circle cx="50" cy="33.2" r="1.2" fill="currentColor"/>`;

  const COURTS = { K: KING, Q: QUEEN, J: JACK };
  // Where the in-frame suit pip sits, kept clear of each figure's held item.
  const COURT_PIP = { K: [28.6, 21.4], Q: [71.4, 21.4], J: [27.6, 20.6] };

  // Traditional ornament behind the ace pip — spade only, as on a real deck.
  const ACE_FLOURISH = ''
    + `<path d="M50 40.5c-7 0-12.6 3-16 7.6" stroke="${GOLD_SOFT}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
    + `<path d="M50 40.5c7 0 12.6 3 16 7.6" stroke="${GOLD_SOFT}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
    + `<path d="M34 48.1c-2.6-1.4-3.4-3.8-2-5.6 1.8 1 2.6 3 2 5.6ZM66 48.1c2.6-1.4 3.4-3.8 2-5.6-1.8 1-2.6 3-2 5.6Z" fill="${GOLD_SOFT}"/>`
    + `<circle cx="50" cy="40.5" r="1.5" fill="${GOLD_SOFT}"/>`
    + `<g transform="rotate(180 50 70)">`
    + `<path d="M50 40.5c-7 0-12.6 3-16 7.6" stroke="${GOLD_SOFT}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
    + `<path d="M50 40.5c7 0 12.6 3 16 7.6" stroke="${GOLD_SOFT}" stroke-width=".9" fill="none" stroke-linecap="round"/>`
    + `<path d="M34 48.1c-2.6-1.4-3.4-3.8-2-5.6 1.8 1 2.6 3 2 5.6ZM66 48.1c2.6-1.4 3.4-3.8 2-5.6-1.8 1-2.6 3-2 5.6Z" fill="${GOLD_SOFT}"/>`
    + `<circle cx="50" cy="40.5" r="1.5" fill="${GOLD_SOFT}"/>`
    + `</g>`;

  // ── Sprite (injected once; every card face <use>s it) ────────────────
  const SPRITE_ID = 'mao-card-art';

  function sprite() {
    let defs = HATCH;
    for (const suit in PIPS) defs += `<g id="mao-pip-${suit}" fill="currentColor">${PIPS[suit]}</g>`;
    for (const rank in COURTS) defs += `<g id="mao-court-${rank}">${COURTS[rank]}</g>`;
    defs += `<clipPath id="mao-panel-clip"><rect x="21.6" y="13.2" width="56.8" height="113.6" rx="2.6"/></clipPath>`;
    defs += `<g id="mao-ace-flourish">${ACE_FLOURISH}</g>`;
    return `<svg id="${SPRITE_ID}" width="0" height="0" aria-hidden="true" focusable="false"><defs>${defs}</defs></svg>`;
  }

  function ensureSprite() {
    if (document.getElementById(SPRITE_ID)) return;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    holder.innerHTML = sprite();
    document.body.insertBefore(holder, document.body.firstChild);
  }

  // ── Face assembly ───────────────────────────────────────────────────
  function pip(suit, cx, cy, scale, invert) {
    const t = `translate(${cx} ${cy}) scale(${scale})` + (invert ? ' rotate(180)' : '');
    return `<use href="#mao-pip-${suit}" transform="${t}"/>`;
  }

  // Rank + pip in the top-left; the whole group rotated 180° gives the
  // bottom-right index, inverted exactly like a real card.
  function indices(card) {
    const wide = card.rank.length > 1;
    const one = `<text class="idx" x="10.5" y="${wide ? 19.4 : 20}" font-size="${wide ? 14 : 17}"`
      + ` text-anchor="middle">${card.rank}</text>`
      + pip(card.suit, 10.5, wide ? 29.6 : 30, IDX_SCALE, false);
    return `<g fill="currentColor">${one}<g transform="rotate(180 ${W / 2} ${MID})">${one}</g></g>`;
  }

  function pipField(card) {
    if (card.rank === 'A') {
      return (card.suit === 'spades' ? '<use href="#mao-ace-flourish"/>' : '')
        + pip(card.suit, C, MID, ACE_SCALE, false);
    }
    const layout = LAYOUTS[card.rank];
    if (!layout) return '';
    let out = '';
    for (const [cx, cy] of layout) out += pip(card.suit, cx, cy, PIP_SCALE, cy > MID);
    return out;
  }

  // Court: framed panel, the figure drawn once and mirrored, dividing rule,
  // and a suit pip inside the frame (mirrored to the opposite corner).
  function courtField(card) {
    const [px, py] = COURT_PIP[card.rank];
    const framePip = pip(card.suit, px, py, 0.44, false);
    return ''
      + `<rect x="20.4" y="12" width="59.2" height="116" rx="3.4" fill="${PANEL}" stroke="${GOLD_SOFT}" stroke-width="1"/>`
      + `<rect x="22.8" y="14.4" width="54.4" height="111.2" rx="2.2" fill="none" stroke="${GOLD_SOFT}" stroke-width=".5" opacity=".8"/>`
      + `<g clip-path="url(#mao-panel-clip)">`
      + `<use href="#mao-court-${card.rank}"/>`
      + `<use href="#mao-court-${card.rank}" transform="rotate(180 ${W / 2} ${MID})"/>`
      + `</g>`
      + `<path d="M22.8 ${MID}h54.4" stroke="${GOLD_SOFT}" stroke-width=".8"/>`
      + `<g>${framePip}<g transform="rotate(180 ${W / 2} ${MID})">${framePip}</g></g>`;
  }

  /** Inner markup of one card face: an <svg> ready to drop into `.card`. */
  function faceSVG(card) {
    ensureSprite();
    const body = COURTS[card.rank] ? courtField(card) : pipField(card);
    return `<svg class="card-face" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"`
      + ` aria-hidden="true" focusable="false">${body}${indices(card)}</svg>`;
  }

  /** Screen-reader label, e.g. "Queen of Hearts". */
  function label(card) {
    return (RANK_NAMES[card.rank] || card.rank) + ' of ' + (SUIT_NAMES[card.suit] || card.suit);
  }

  global.MaoCards = { faceSVG, label };
})(window);
