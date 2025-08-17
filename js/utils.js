(function(global){
  const BUCKETS = {
    NEW: 'NEW',
    STRUGGLING: 'STRUGGLING',
    NEEDS_WORK: 'NEEDS_WORK',
    CONFIDENT: 'CONFIDENT',
    MASTERED: 'MASTERED'
  };

  const BUCKET_LABELS = {
    NEW: 'New',
    STRUGGLING: 'Struggling',
    NEEDS_WORK: 'Needs work',
    CONFIDENT: 'Confident',
    MASTERED: 'Mastered'
  };

  function getLocalISODate(){
    const d = new Date();
    d.setHours(0,0,0,0);
    return d.toISOString().slice(0,10);
  }

  function getBucketFromAccuracy(opts){
    const {
      accPct = 0,
      attempts = 0,
      lastFails = 0,
      lastFailAt = 0,
      isSeen = false,
      isAttempted = false
    } = opts || {};

    if(isSeen && attempts === 0) return BUCKETS.NEW;
    if(attempts > 0 && (accPct < 50 || lastFails >= 2 || (lastFailAt && (Date.now() - lastFailAt) < 48*3600*1000))) return BUCKETS.STRUGGLING;
    if(accPct < 80) return BUCKETS.NEEDS_WORK;
    if(accPct < 90) return BUCKETS.CONFIDENT;
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

  global.FC_UTILS = {
    BUCKETS,
    BUCKET_LABELS,
    getBucketFromAccuracy,
    getLocalISODate,
    getDailyNewAllowance,
    consumeNewAllowance,
    peekAllowance
  };
})(window);
