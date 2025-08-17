(function(global){
  const BUCKETS = {
    NEW: 'NEW',
    STRUGGLING: 'STRUGGLING',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
    MASTERED: 'MASTERED'
  };

  const BUCKET_LABELS = {
    NEW: 'New',
    STRUGGLING: 'Struggling',
    NEEDS_REVIEW: 'Needs review',
    MASTERED: 'Mastered'
  };

  function getLocalISODate(){
    const d = new Date();
    d.setHours(0,0,0,0);
    return d.toISOString().slice(0,10);
  }

  function getBucket(card){
    const {
      introducedAt,
      attempts = 0,
      accuracyPct = 0
    } = card || {};

    if(!introducedAt) return null;
    if(attempts === 0) return BUCKETS.NEW;
    if(accuracyPct < 50) return BUCKETS.STRUGGLING;
    if(accuracyPct < 80) return BUCKETS.NEEDS_REVIEW;
    return BUCKETS.MASTERED;
  }

  const ALLOW_PREFIX = 'siarad:newAllowance:';
  let capLogged = false;
  function readAllowance(){
    const today = getLocalISODate();
    const key = ALLOW_PREFIX + today;
    let data;
    try{ data = JSON.parse(localStorage.getItem(key) || '{}'); }catch{}
    const base = (global.SETTINGS && global.SETTINGS.newPerDay) || 5;
    if(!data || data.lastDate !== today || typeof data.remaining !== 'number'){
      data = { remaining: base, lastDate: today };
      localStorage.setItem(key, JSON.stringify(data));
    }
    if(!capLogged){
      console.info(`New cap today: ${data.remaining}/${base}`);
      capLogged = true;
    }
    data.key = key;
    return data;
  }
  function saveAllowance(data){
    localStorage.setItem(data.key, JSON.stringify({ remaining: data.remaining, lastDate: data.lastDate }));
  }

  function getDailyNewAllowance(unseenCount=0, strugglingCount=0){
    const state = readAllowance();
    const base = (global.SETTINGS && global.SETTINGS.newPerDay) || 5;
    const cap = (global.STRUGGLE_CAP || 10);
    const factor = Math.max(0, Math.min(1, (cap - strugglingCount) / cap));
    const baseAllowed = Math.floor(base * factor);
    const allowed = Math.min(state.remaining, baseAllowed, unseenCount, base);
    return { allowed, remaining: state.remaining, baseAllowed };
  }

  function consumeNewAllowance(){
    const state = readAllowance();
    if(state.remaining > 0){
      state.remaining -= 1;
      saveAllowance(state);
      console.info(`New item introduced; remaining now ${state.remaining}`);
    }
  }

  function peekAllowance(){
    const state = readAllowance();
    return { remaining: state.remaining };
  }

  function clampInterval(n){
    n = typeof n === 'number' ? Math.round(n) : 1;
    if(n < 1) n = 1;
    if(n > 365) n = 365;
    return n;
  }

  function calcDueDate(intervalDays){
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + (typeof intervalDays === 'number' ? intervalDays : 1));
    return d.toISOString();
  }

  function deckKeyFromState(){
    const map = {
      'Welsh – A1 Phrases': 'welsh_phrases_A1',
      'Welsh - A1 Phrases': 'welsh_phrases_A1',
      'welsh_a1': 'welsh_phrases_A1'
    };
    const id = (global.STATE && global.STATE.activeDeckId) || '';
    return map[id] || id || 'welsh_phrases_A1';
  }

  function logReview(phrase, result){
    const id = typeof phrase === 'string' ? phrase : phrase && phrase.id;
    if(!id) return;
    const progressKey = 'progress_' + deckKeyFromState();
    let prog;
    try{ prog = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}'); }
    catch{ prog = { seen:{} }; }
    const seen = prog.seen || {};
    const entry = seen[id] || {};
    const reviews = entry.reviews || [];
    reviews.push({ date: new Date().toISOString(), result });
    entry.reviews = reviews;
    const n = typeof entry.interval === 'number' ? entry.interval : 1;
    entry.interval = clampInterval(n);
    entry.dueDate = calcDueDate(entry.interval);
    seen[id] = entry;
    prog.seen = seen;
    localStorage.setItem(progressKey, JSON.stringify(prog));
  }

  global.FC_UTILS = {
    BUCKETS,
    BUCKET_LABELS,
    getBucket,
    getLocalISODate,
    getDailyNewAllowance,
    consumeNewAllowance,
    peekAllowance,
    clampInterval,
    calcDueDate
  };

  global.logReview = logReview;
})(window);
