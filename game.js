// game.js — pure deck engine + room factory for Mao Online. No I/O, no side effects beyond mutation of passed-in arrays.

const SUITS = ['hearts', 'clubs', 'diamonds', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT_GLYPHS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }; // ♥♦ red, ♣♠ black

const CARDS_PER_DECK = 52;
const MAX_PENALTY_BUFFER = 200; // upper bound on penalty extras — scaled down for small rooms
const MAX_DEAL = 5; // dealGame count is 3|5 — size the initial room deck for the max

// Fisher-Yates shuffle. Mutates and returns the same array.
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// One fresh shuffled 52-card deck. deckNumber keeps card ids unique per instance —
// resupply decks must never reuse numbers already in play.
function buildFreshDeck(deckNumber) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${deckNumber}-${suit}-${rank}`, rank, suit, deck: deckNumber });
    }
  }
  return shuffle(cards);
}

// Build a shuffled Card[] from merged 52-card decks.
// decks = ceil((players * cardsPerPlayer + buffer) / 52).
// buffer scales with players to avoid enormous decks for small rooms
// (a 2-player game shouldn't carry 4 decks), floored at 52, capped at 200.
// Card: { id: `${deck}-${suit}-${rank}`, rank, suit, deck } — id unique per physical card instance.
function buildDeck(playerCount, cardsPerPlayer) {
  const buffer = Math.min(MAX_PENALTY_BUFFER, Math.max(CARDS_PER_DECK, playerCount * cardsPerPlayer * 3));
  const deckCount = Math.ceil((playerCount * cardsPerPlayer + buffer) / CARDS_PER_DECK);
  let cards = [];
  for (let d = 1; d <= deckCount; d++) cards = cards.concat(buildFreshDeck(d));
  return shuffle(cards);
}

// Splice `count` cards from the top of the deck array (mutates it) and return them.
function deal(deck, count) {
  return deck.splice(0, count);
}

// Room factory: fresh table with a built deck, empty players, empty discard, empty log.
// The initial deck is sized with MAX_DEAL; dealGame rebuilds it with the real count anyway.
function createRoom(id, playerCount) {
  return {
    id,
    hostId: null,
    players: new Map(),
    socketToPlayer: new Map(),
    deck: buildDeck(playerCount, MAX_DEAL),
    discard: [],
    log: [],
    createdAt: Date.now(),
  };
}

module.exports = { SUITS, RANKS, SUIT_GLYPHS, CARDS_PER_DECK, shuffle, buildDeck, buildFreshDeck, deal, createRoom };
