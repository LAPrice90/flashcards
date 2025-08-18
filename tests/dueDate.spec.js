import { applyIntroPath, scheduleNextReview, calcDueDateFromInterval, startOfTodayISO, addDaysISO, getDuePhrases } from '../js/srs.js';

function assert(name, fn){
  try{ fn(); console.log('✅', name); }
  catch(err){ console.error('❌', name, err.message); }
}

global.localStorage = {
  store:{},
  getItem(k){ return this.store[k] || null; },
  setItem(k,v){ this.store[k]=String(v); },
  removeItem(k){ delete this.store[k]; }
};

function resetStore(){ global.localStorage.store = {}; }

assert('intro sets dueDate to tomorrow', () => {
  resetStore();
  const now = new Date('2024-01-01T12:00:00Z');
  const card = { id:'n1', introducedAt: now.toISOString(), reviews: [] };
  applyIntroPath(card, 0, { now });
  const expected = new Date('2024-01-02T00:00:00.000Z').toISOString();
  if(card.interval !== 1) throw new Error('interval');
  if(card.dueDate !== expected) throw new Error(`due ${card.dueDate}`);
});

assert('review updates interval and dueDate', () => {
  resetStore();
  const now = new Date('2024-01-01T00:00:00Z');
  const card = { id:'n2', interval:1, ease:2.5, dueDate: calcDueDateFromInterval(now,1), reviews: [] };
  scheduleNextReview(card,'pass',{ now });
  const expected = new Date('2024-01-04T00:00:00.000Z').toISOString();
  if(card.interval !== 3) throw new Error(`interval ${card.interval}`);
  if(card.dueDate !== expected) throw new Error(`due ${card.dueDate}`);
});

assert('grace review schedules from original due date', () => {
  resetStore();
  const original = new Date('2024-01-03T00:00:00Z');
  const card = { id:'n3', interval:2, ease:2.5, dueDate: original.toISOString(), reviews: [] };
  const now = new Date('2024-01-05T00:00:00Z');
  scheduleNextReview(card,'pass',{ now, grace:true });
  const baseISO = startOfTodayISO(original);
  const expected = addDaysISO(baseISO, card.interval);
  if(card.dueDate !== expected) throw new Error(`due ${card.dueDate}`);
  if(new Date(card.dueDate) <= now) throw new Error('not future');
});

assert('getDuePhrases filters and sorts by dueDate', () => {
  const now = new Date('2024-01-05T00:00:00Z');
  const list = [
    { id:'a', dueDate:'2024-01-04T00:00:00Z' },
    { id:'b', dueDate:'2024-01-03T00:00:00Z' },
    { id:'c', dueDate:'2024-01-06T00:00:00Z' }
  ];
  const due = getDuePhrases(list, now);
  const ids = due.map(p=>p.id).join(',');
  if(ids !== 'b,a') throw new Error(ids);
});
