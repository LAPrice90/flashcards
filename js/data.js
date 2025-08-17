(function(global){
  const SESSION_KEY = 'tm_session';

  async function getDueCards(deckId, { asOfDate = new Date() } = {}){
    const rows = await loadDeckRows(deckId);
    const prog = loadProgress(deckId);
    const attempts = loadAttemptsMap();
    const seen = prog.seen || {};
    const session = (()=>{ try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch{ return {}; } })();
    const doneSet = new Set(session.done || []);
    const day = new Date(asOfDate); day.setHours(0,0,0,0);
    const now = day.getTime();

    return rows.filter(r => {
      if(!(seen[r.id] || (attempts[r.id] && attempts[r.id].length))) return false;
      if(doneSet.has(r.id)) return false;
      const arr = attempts[r.id] || [];
      for(let i=arr.length-1;i>=0;i--){
        const a = arr[i];
        if(a.pass && a.score !== false){
          if(now - a.ts < SCORE_COOLDOWN_MS) return false;
          break;
        }
      }
      const dueStr = seen[r.id] && seen[r.id].dueDate;
      const due = dueStr ? Date.parse(dueStr) : 0;
      if(due > now) return false;
      r.due = due;
      return true;
    }).sort((a,b)=>a.due - b.due);
  }

  global.getDueCards = getDueCards;
})(typeof window !== 'undefined' ? window : this);

