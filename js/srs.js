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

/** Return ISO string for start of current UTC day. */
export function startOfTodayISO(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Add whole days to an ISO timestamp and return ISO string. */
export function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + (days || 0));
  return d.toISOString();
}

/** Calculate a due date from an interval in days. */
export function calcDueDateFromInterval(now, intervalDays) {
  const base = startOfTodayISO(now);
  return addDaysISO(base, Math.max(1, Math.round(intervalDays || 1)));
}

/** Clamp an interval in days to the supported range. */
export function clampInterval(days) {
  return Math.max(1, Math.min(365, Math.round(days || 1)));
}

/** Ensure a card has a valid interval property. */
export function ensureInterval(card) {
  if (typeof card.interval !== 'number' || !isFinite(card.interval)) {
    card.interval = 1;
  } else {
    card.interval = clampInterval(card.interval);
  }
  return card;
}

/** Clamp a numeric value between min and max. */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
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

  ensureInterval(card);
  let intervalDays = clampInterval(card.interval);
  card.ease = typeof card.ease === 'number' ? card.ease : 2.5;

  switch (result) {
    case 'fail':
      intervalDays = Math.max(1, Math.round(intervalDays / 2));
      card.ease -= 0.20;
      break;
    case 'hard':
      card.ease -= 0.05;
      break;
    case 'pass':
      intervalDays = Math.round(intervalDays * card.ease);
      card.ease += 0.05;
      break;
    case 'easy':
      intervalDays = Math.round(intervalDays * card.ease * 1.5);
      card.ease += 0.10;
      break;
    default:
      throw new Error('Invalid result');
  }

  card.ease = clamp(card.ease, 1.3, 3.0);
  intervalDays = clampInterval(intervalDays);

  card.interval = intervalDays;

  const base = (grace && card.dueDate) ? new Date(card.dueDate) : nowDate;
  const baseISO = startOfTodayISO(base);
  card.dueDate = addDaysISO(baseISO, card.interval);

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
  const storeInterval = clampInterval(stepDays);
  card.interval = storeInterval;
  const baseISO = startOfTodayISO(now);
  card.dueDate = addDaysISO(baseISO, card.interval);
  return card;
}

/** Check if a phrase is due for review. */
export function isDue(phrase, now = new Date()) {
  return !!(phrase && phrase.dueDate && new Date(phrase.dueDate) <= now);
}

/** Return phrases due for review, sorted by dueDate ascending. */
export function getDuePhrases(all = [], now = new Date()) {
  return all
    .filter(p => isDue(p, now))
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

export default {
  scheduleNextReview,
  nextIntervalsForNew,
  applyIntroPath,
  clampInterval,
  ensureInterval,
  startOfTodayISO,
  addDaysISO,
  calcDueDateFromInterval,
  isDue,
  getDuePhrases
};

if (typeof window !== 'undefined') {
  window.FC_SRS = {
    scheduleNextReview,
    nextIntervalsForNew,
    applyIntroPath,
    persistCard,
    clampInterval,
    ensureInterval,
    startOfTodayISO,
    addDaysISO,
    calcDueDateFromInterval,
    isDue,
    getDuePhrases
  };
}
