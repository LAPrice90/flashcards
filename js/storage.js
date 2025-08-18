/**
 * Basic deck storage utilities using localStorage.
 * Provided for environments without a full backend.
 */

const DECK_KEY = 'fc:deck';

/** Save an entire deck. */
export function saveDeck(deck) {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch (e) {
    console.error('saveDeck failed', e);
  }
}

function startOfTodayISO(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + (days || 0));
  return d.toISOString();
}

function calcDue(now, interval) {
  const base = startOfTodayISO(now);
  return addDaysISO(base, Math.max(1, Math.round(interval || 1)));
}

/** Load the current deck. */
export function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_KEY);
    const deck = raw ? JSON.parse(raw) : [];
    const now = new Date();
    let updated = false;
    for (const card of deck) {
      if (typeof card.interval !== 'number' || !isFinite(card.interval)) {
        card.interval = 1;
        updated = true;
      } else {
        card.interval = Math.max(1, Math.min(365, Math.round(card.interval)));
      }
      if (!card.dueDate || isNaN(Date.parse(card.dueDate))) {
        card.dueDate = calcDue(now, card.interval);
        updated = true;
      }
    }
    if (updated) saveDeck(deck);
    return deck;
  } catch {
    return [];
  }
}

/** Persist a single card to storage. */
export function persistCard(card) {
  if (!card) return;
  const deck = loadDeck();
  const idx = deck.findIndex(c => c.id === card.id);
  if (idx >= 0) deck[idx] = card; else deck.push(card);
  saveDeck(deck);
}

export default { saveDeck, loadDeck, persistCard };
