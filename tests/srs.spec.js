import { scheduleNextReview, applyIntroPath } from '../js/srs.js';

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

assert('PASS increases interval and ease, sets dueDate to now+interval', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: '1', interval: 2, ease: 2.5, dueDate: now.toISOString(), reviews: [] };
  scheduleNextReview(card, 'pass', { now });
  const expectedDue = new Date('2024-01-06T00:00:00.000Z').toISOString();
  if (card.interval !== 5) throw new Error('interval');
  if (Math.abs(card.ease - 2.55) > 1e-9) throw new Error('ease');
  if (card.dueDate !== expectedDue) throw new Error('dueDate');
});

assert('FAIL halves interval, decreases ease, due today', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: '2', interval: 10, ease: 2.5, dueDate: now.toISOString(), reviews: [] };
  scheduleNextReview(card, 'fail', { now });
  if (card.interval !== 5) throw new Error('interval');
  if (Math.abs(card.ease - 2.3) > 1e-9) throw new Error('ease');
  if (card.dueDate !== now.toISOString()) throw new Error('dueDate');
});

assert('EASY multiplies interval by ease*1.5 and clamps to 365 days', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: '3', interval: 300, ease: 2.5, dueDate: now.toISOString(), reviews: [] };
  scheduleNextReview(card, 'easy', { now });
  if (card.interval !== 365) throw new Error(`interval ${card.interval}`);
  if (Math.abs(card.ease - 2.6) > 1e-9) throw new Error('ease');
});

assert('HARD keeps interval and decreases ease', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: '4', interval: 10, ease: 2.5, dueDate: now.toISOString(), reviews: [] };
  scheduleNextReview(card, 'hard', { now });
  const expectedDue = new Date('2024-01-11T00:00:00.000Z').toISOString();
  if (card.interval !== 10) throw new Error('interval');
  if (Math.abs(card.ease - 2.45) > 1e-9) throw new Error('ease');
  if (card.dueDate !== expectedDue) throw new Error('dueDate');
});

assert('Grace mode computes due from original dueDate when late', () => {
  resetStore();
  const now = new Date('2024-01-04T00:00:00Z');
  const originalDue = new Date('2024-01-01T00:00:00Z');
  const card = { id: '5', interval: 2, ease: 2.5, dueDate: originalDue.toISOString(), reviews: [] };
  scheduleNextReview(card, 'pass', { now, grace: true });
  const expectedDue = new Date('2024-01-06T00:00:00.000Z').toISOString();
  if (card.dueDate !== expectedDue) throw new Error(`dueDate ${card.dueDate}`);
});

assert('applyIntroPath schedules steps without logging reviews', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id: '6', reviews: [] };
  applyIntroPath(card, 0, { now });
  if (card.interval !== 1 || card.dueDate !== now.toISOString()) throw new Error('step0');
  applyIntroPath(card, 1, { now });
  const step1Due = new Date('2024-01-02T00:00:00.000Z').toISOString();
  if (card.interval !== 1 || card.dueDate !== step1Due) throw new Error('step1');
  applyIntroPath(card, 2, { now });
  const step2Due = new Date('2024-01-04T00:00:00.000Z').toISOString();
  if (card.interval !== 3 || card.dueDate !== step2Due) throw new Error('step2');
  if (card.reviews.length !== 0) throw new Error('reviews');
});

