/**
 * Spaced repetition scheduling helpers.
 *
 * The card object conforms to:
 * {
 *   introducedAt: string,
 *   reviews: Array<{date: string, result: string}>,
 *   interval: number,
 *   dueDate: string,
 *   ease: number
 * }
 */

import { persistCard } from './storage.js';

/** Clamp a numeric value between min and max. */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/** Add a number of days to a Date and return a new Date. */
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Difference in whole days between two dates. */
function daysBetween(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / msPerDay);
}

/**
 * Compute the next review schedule for a card based on the result of a review.
 *
 * @param {Object} card Card object to update.
 * @param {('fail'|'hard'|'pass'|'easy')} result Review outcome.
 * @param {Object} [opts]
 * @param {Date} [opts.now=new Date()] Current date/time.
 * @param {boolean} [opts.grace=false] Whether to apply grace period for late reviews.
 * @returns {Object} Updated card.
 */
export function scheduleNextReview(card, result, { now = new Date(), grace = false } = {}) {
  if (!card) throw new Error('Card required');
  const nowDate = new Date(now);

  let intervalDays = Math.max(1, Math.round(card.interval || 1));
  let due = addDays(nowDate, intervalDays);
  card.ease = typeof card.ease === 'number' ? card.ease : 2.5;

  switch (result) {
    case 'fail':
      intervalDays = Math.max(1, Math.round(intervalDays / 2));
      card.ease -= 0.20;
      due = nowDate;
      break;
    case 'hard':
      card.ease -= 0.05;
      due = addDays(nowDate, intervalDays);
      break;
    case 'pass':
      intervalDays = Math.round(intervalDays * card.ease);
      card.ease += 0.05;
      due = addDays(nowDate, intervalDays);
      break;
    case 'easy':
      intervalDays = Math.round(intervalDays * card.ease * 1.5);
      card.ease += 0.10;
      due = addDays(nowDate, intervalDays);
      break;
    default:
      throw new Error('Invalid result');
  }

  card.ease = clamp(card.ease, 1.3, 3.0);
  intervalDays = clamp(intervalDays, 1, 365);

  let dueDate;
  if (grace && card.dueDate) {
    const prevDue = new Date(card.dueDate);
    if (nowDate > prevDue) {
      const lateness = daysBetween(prevDue, nowDate); // eslint-disable-line no-unused-vars
      const newDue = addDays(prevDue, intervalDays);
      dueDate = newDue > nowDate ? newDue : nowDate;
    } else {
      dueDate = due;
    }
  } else {
    dueDate = due;
  }

  card.interval = intervalDays;
  card.dueDate = dueDate.toISOString();
  card.reviews = Array.isArray(card.reviews) ? card.reviews : [];
  card.reviews.push({ date: nowDate.toISOString(), result });

  persistCard(card);
  return card;
}

/**
 * Returns the default introduction interval sequence for a new card.
 * @returns {number[]} Array of days until next reviews.
 */
export function nextIntervalsForNew() {
  return [0, 1, 3, 7, 14, 30];
}

/**
 * Apply an introduction schedule step to a card without logging a review.
 *
 * @param {Object} card Card object to update.
 * @param {number} stepIndex Index within the introduction path.
 * @param {Object} [opts]
 * @param {Date} [opts.now=new Date()] Base date for scheduling.
 * @returns {Object} Updated card.
 */
export function applyIntroPath(card, stepIndex, { now = new Date() } = {}) {
  const steps = nextIntervalsForNew();
  const stepDays = steps[stepIndex] ?? 0;
  const storeInterval = Math.max(1, stepDays);
  const due = addDays(new Date(now), stepDays);
  card.interval = storeInterval;
  card.dueDate = due.toISOString();
  return card;
}

export default {
  scheduleNextReview,
  nextIntervalsForNew,
  applyIntroPath
};

if (typeof window !== 'undefined') {
  window.FC_SRS = { scheduleNextReview, nextIntervalsForNew, applyIntroPath, persistCard };
}
