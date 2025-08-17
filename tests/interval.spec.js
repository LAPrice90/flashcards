import { clampInterval, ensureInterval, scheduleNextReview } from '../js/srs.js';
import { persistCard, loadDeck, saveDeck } from '../js/storage.js';

function assert(name, fn) {
  try {
    fn();
    console.log('✅', name);
  } catch (err) {
    console.error('❌', name, err.message);
  }
}

global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); },
  removeItem(key) { delete this.store[key]; }
};

function resetStore() {
  global.localStorage.store = {};
}

assert('ensureInterval defaults to 1', () => {
  const card = {};
  ensureInterval(card);
  if (card.interval !== 1) throw new Error('interval');
});

assert('clampInterval clamps range', () => {
  if (clampInterval(0) !== 1) throw new Error('low');
  if (clampInterval(400) !== 365) throw new Error('high');
});

assert('scheduleNextReview persists interval', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: 'x', interval: 1, ease: 2.5, dueDate: now.toISOString(), reviews: [] };
  scheduleNextReview(card, 'pass', { now });
  const deck = loadDeck();
  if (!deck.length || deck[0].interval !== card.interval) throw new Error('persist');
});

assert('migration fills missing interval', () => {
  resetStore();
  saveDeck([{ id: 'm', dueDate: new Date().toISOString() }]);
  const deck = loadDeck();
  const phrase = ensureInterval(deck[0]);
  persistCard(phrase);
  const deck2 = loadDeck();
  if (deck2[0].interval !== 1) throw new Error('migrated');
});
