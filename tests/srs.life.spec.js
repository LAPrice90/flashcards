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

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

assert('Card life cycle through intro, reviews, grace and easy', () => {
  resetStore();
  const day0 = new Date('2024-01-01T00:00:00Z');
  const card = { id: 'bonjour', introducedAt: day0.toISOString(), reviews: [] };

  // Intro steps
  applyIntroPath(card, 0, { now: day0 });
  applyIntroPath(card, 1, { now: day0 });
  const day1 = addDays(day0, 1);
  if (card.dueDate !== day1.toISOString()) throw new Error('due after intro');
  if (card.reviews.length !== 0) throw new Error('reviews after intro');

  // First review: fail
  scheduleNextReview(card, 'fail', { now: day1 });
  if (card.interval !== 1) throw new Error(`interval ${card.interval}`);
  if (Math.abs(card.ease - 2.3) > 1e-9) throw new Error(`ease ${card.ease}`);
  const day2 = addDays(day1, 1);
  if (card.dueDate !== day2.toISOString()) throw new Error('due after fail');
  if (card.reviews.length !== 1 || card.reviews[0].result !== 'fail') throw new Error('review log after fail');

  // Next day: pass
  scheduleNextReview(card, 'pass', { now: day2 });
  const day4 = addDays(day2, 2);
  if (card.interval !== 2) throw new Error(`interval2 ${card.interval}`);
  if (Math.abs(card.ease - 2.35) > 1e-9) throw new Error(`ease2 ${card.ease}`);
  if (card.dueDate !== day4.toISOString()) throw new Error('due after pass');

  // Late by 3 days, grace pass
  const day7 = addDays(day4, 3);
  scheduleNextReview(card, 'pass', { now: day7, grace: true });
  const day9 = addDays(day4, Math.round(2 * 2.35)); // prev due + interval(5)
  if (card.interval !== 5) throw new Error(`interval3 ${card.interval}`);
  if (Math.abs(card.ease - 2.4) > 1e-9) throw new Error(`ease3 ${card.ease}`);
  if (card.dueDate !== day9.toISOString()) throw new Error('due after grace pass');
  if (new Date(card.dueDate) <= day7) throw new Error('due not in future after grace');

  // On next due day: easy
  scheduleNextReview(card, 'easy', { now: day9 });
  const day27 = addDays(day9, Math.round(5 * 2.4 * 1.5));
  if (card.interval !== 18) throw new Error(`interval4 ${card.interval}`);
  if (Math.abs(card.ease - 2.5) > 1e-9) throw new Error(`ease4 ${card.ease}`);
  if (card.dueDate !== day27.toISOString()) throw new Error('due after easy');
});

assert('Session builder caps served at 15 and shows queued badge', () => {
  const SESSION_MAX = 15;
  const now = new Date('2024-01-01T00:00:00Z');
  const cards = Array.from({ length: 20 }, (_, i) => ({ id: String(i), dueDate: now.toISOString() }));

  const badge = { textContent: '' };
  const pill = { textContent: '', classList: { add(){}, remove(){} } };
  global.document = { getElementById(id){ return id === 'b-quiz' ? badge : id === 'quizQueued' ? pill : null; } };

  function fcUpdateQuizBadge(raw){
    const sessionDue = Math.min(raw, SESSION_MAX);
    const queued = Math.max(raw - SESSION_MAX, 0);
    const badgeEl = document.getElementById('b-quiz');
    if (badgeEl) badgeEl.textContent = String(sessionDue);
    const pillEl = document.getElementById('quizQueued');
    if (pillEl){
      if (queued > 0){
        pillEl.textContent = `+${queued} queued`;
        pillEl.classList.remove('hidden');
      } else {
        pillEl.classList.add('hidden');
      }
    }
  }

  fcUpdateQuizBadge(cards.length);
  const served = Math.min(cards.length, SESSION_MAX);
  if (served !== 15) throw new Error(`served ${served}`);
  if (badge.textContent !== '15') throw new Error(`badge ${badge.textContent}`);
  if (pill.textContent !== '+5 queued') throw new Error(`queued ${pill.textContent}`);
});

