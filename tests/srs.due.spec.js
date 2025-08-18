import { scheduleNextReview, applyIntroPath } from '../js/srs.js';

function assert(name, fn) {
  try { fn(); console.log('✅', name); }
  catch (err) { console.error('❌', name, err.message); }
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};

assert('dueDate moves correctly with intro, pass, grace', () => {
  const day0 = new Date('2024-01-01T00:00:00Z');
  const card = { id: 'hola', introducedAt: day0.toISOString(), reviews: [], interval: 1, ease: 1 };

  // Intro path → due tomorrow
  applyIntroPath(card, 0, { now: day0 });
  const day1 = addDays(day0, 1);
  if (card.dueDate !== day1.toISOString()) throw new Error('due after intro wrong');

  // Pass with interval=3 → due in 3 days
  card.interval = 3;
  scheduleNextReview(card, 'pass', { now: day1 });
  const day4 = addDays(day1, 3);
  if (card.dueDate !== day4.toISOString()) throw new Error('due after pass wrong');

  // Late by 2 days, grace pass → base off original due (day4), not late day
  const lateDay = addDays(day4, 2);
  scheduleNextReview(card, 'pass', { now: lateDay, grace: true });
  const nextDue = addDays(day4, card.interval);
  if (card.dueDate !== nextDue.toISOString()) throw new Error('due after grace wrong');
});
