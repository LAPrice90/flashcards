(function(global){
  const SESSION_KEY = 'tm_session';

  async function getDueCards(deckId, { asOfDate = new Date() } = {}){
    const rows = await loadDeckRows(deckId);
    const prog = loadProgress(deckId);
    const attempts = loadAttemptsMap();
    const seen = prog.seen || {};
    const session = (()=>{ try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch{ return {}; } })();
    const doneSet = new Set(session.done || []);
    const day = new Date(asOfDate); day.setUTCHours(0,0,0,0);

    const candidates = rows.filter(r => {
      if(!(seen[r.id] || (attempts[r.id] && attempts[r.id].length))) return false;
      if(doneSet.has(r.id)) return false;
      const arr = attempts[r.id] || [];
      for(let i=arr.length-1;i>=0;i--){
        const a = arr[i];
        if(a.pass && a.score !== false){
          if(day.getTime() - a.ts < SCORE_COOLDOWN_MS) return false;
          break;
        }
      }
      return true;
    }).map(r => ({ ...r, dueDate: seen[r.id] && seen[r.id].dueDate }));

    const due = (global.FC_SRS && FC_SRS.getDuePhrases)
      ? FC_SRS.getDuePhrases(candidates, day)
      : candidates.filter(c => c.dueDate && new Date(c.dueDate) <= day)
          .sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));

    return due.map(r => ({ ...r, due: Date.parse(r.dueDate || 0) }));
  }

  global.getDueCards = getDueCards;
})(typeof window !== 'undefined' ? window : this);

