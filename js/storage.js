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

/** Load the current deck. */
export function loadDeck() {
  try {
    const raw = localStorage.getItem(DECK_KEY);
    return raw ? JSON.parse(raw) : [];
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
