(function(){
  let current=null;
  function stop(){
    if(current){
      try{ current.pause(); }catch(e){}
      current=null;
    }
  }
  function create(src, rate=1.0){
    if(!src) return null;
    stop();
    current=new Audio(src);
    current.playbackRate=rate;
    return current;
  }
  function play(src, rate=1.0){
    const a=create(src, rate);
    if(a) a.play().catch(()=>{});
    return a;
  }
  window.fcAudio={ play, stop, create };
})();
(function(){
function deckKeyFromState() {
  const map = {
    'Welsh – A1 Phrases': 'welsh_phrases_A1',
    'Welsh - A1 Phrases': 'welsh_phrases_A1',
    'welsh_a1': 'welsh_phrases_A1'
  };
  const id = (window.STATE && STATE.activeDeckId) || '';
  return map[id] || id || 'welsh_phrases_A1';
}

const dk          = deckKeyFromState();
const progressKey = 'progress_' + dk;          // read/write here
const dailyKey    = 'np_daily_' + dk;          // read in Test/Study; read/write in New Phrases
const attemptsKey = 'tm_attempts_v1';          // global attempts bucket (unchanged)

function fireProgressEvent(payload){
  window.dispatchEvent(new CustomEvent('fc:progress-updated', { detail: payload || {} }));
}


(function migrateProgressIfNeeded(){
  const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
  if (legacy !== progressKey) {
    const legacyVal = localStorage.getItem(legacy);
    if (legacyVal && !localStorage.getItem(progressKey)) {
      localStorage.setItem(progressKey, legacyVal);
    }
  }
})();

// newPhrase.js — unlock and learn new phrases (route: #/newPhrase)
// Loads only active phrases, unlocks next items sequentially and limits
// new unlocks by daily allowance unless all active phrases are mastered.

(() => {
  /* ---------- Utilities ---------- */
  const escapeHTML = (s) =>
    String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // tolerant matching (same rules as test mode)
  function normalizeInput(s){
    if(!s) return '';
    let out = s.toLowerCase();
    out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
    out = out
      .replace(/[\u2019\u2018]/g,"'")
      .replace(/[\u201C\u201D]/g,'"')
      .replace(/\u2026/g,'...')
      .replace(/[\u2013\u2014]/g,'-')
      .replace(/[.,!?;:"'()\-]/g,' ')
      .replace(/\s+/g,' ').trim();
    return out;
  }
  function levenshtein(a,b){
    const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    const prev=new Array(n+1),cur=new Array(n+1);
    for(let j=0;j<=n;j++) prev[j]=j;
    for(let i=1;i<=m;i++){
      cur[0]=i; const ai=a.charCodeAt(i-1);
      for(let j=1;j<=n;j++){
        const cost=ai===b.charCodeAt(j-1)?0:1;
        cur[j]=Math.min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost);
      }
      for(let j=0;j<=n;j++) prev[j]=cur[j];
    }
    return prev[n];
  }
  function equalsLoose(a,b){
    const x=normalizeInput(a), y=normalizeInput(b);
    if(x===y) return true;
    const dist=levenshtein(x,y);
    const tol=Math.max(1,Math.floor(Math.max(x.length,y.length)/8));
    return dist<=tol;
  }

  // prevent global hotkeys from stealing input/Enter
  window.addEventListener('keydown', e => {
    if(e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)){
      e.stopPropagation();
    }
  }, true);

  /* ---------- Progress helpers ---------- */
  function markSeenNow(cardId){
    const today = new Date().toISOString().slice(0,10);
    const prog = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
    if (!prog.seen) prog.seen = {};
    const entry = prog.seen[cardId] || { firstSeen: today, seenCount: 0 };
    entry.seenCount += 1;
    entry.lastSeen = today;
    prog.seen[cardId] = entry;
    localStorage.setItem(progressKey, JSON.stringify(prog));
  }

  function bumpDailyUsed(){
    const daily = JSON.parse(localStorage.getItem(dailyKey) || '{}');
    if (daily && daily.date){
      daily.used = Math.min((daily.used||0)+1, daily.allowed||0);
      localStorage.setItem(dailyKey, JSON.stringify(daily));
    }
  }

  function canUnlock(allMastered){
    if(allMastered) return true;
    const daily = JSON.parse(localStorage.getItem(dailyKey) || '{}');
    console.log('[daily]', deckKeyFromState(), daily);
    return (daily.used || 0) < (daily.allowed || 0);
  }

  function computeAllMastered(deckId, prog){
    const attempts = loadAttemptsMap();
    const ids = Object.keys(prog.seen || {});
    if(!ids.length) return true;
    return ids.every(id => categoryFromPct(lastNAccuracy(id, SCORE_WINDOW, attempts)) === 'Mastered');
  }

  async function syncProgressToGitHub(deckId, prog){
    const token = localStorage.getItem('gh_token');
    const repo  = localStorage.getItem('gh_repo'); // format: owner/repo
    if(!token || !repo) return;
    const path = `progress_${deckId}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(prog))));
    await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({message:`Update ${path}`, content})
    }).catch(()=>{});
  }

  /* ---------- Audio ---------- */
  let audioEl=null;
  function stopAudio(){
    if(window.fcAudio) window.fcAudio.stop();
    audioEl=null;
  }
  function playAudio(src,rate=1){
    if(!src) return;
    audioEl = window.fcAudio ? window.fcAudio.play(src,rate) : null;
  }
  async function playSequence(src){
    await playOne(src,1.0);
    await playOne(src,0.6);
    await playOne(src,1.0);
  }
  function playOne(src,rate){
    return new Promise(res=>{
      if(!src) return res();
      audioEl = window.fcAudio ? window.fcAudio.create(src,rate) : null;
      if(!audioEl) return res();
      audioEl.addEventListener('ended',res,{once:true});
      audioEl.play().catch(()=>res());
    });
  }

  /* ---------- Learning flow ---------- */
  const STEPS={ WELSH:0,MEANING:1,CONTEXT:2,DRILL1:3,DRILL2:4,DRILL3:5 };

  let viewEl=null;
  let deckRows=[];       // full deck rows
  let queue=[];          // active phrases (seen but not learned)
  let idx=0;             // index in queue
  let step=STEPS.WELSH;  // current step
  let allMastered=true;  // recomputed after each change
  let newRemainingToday=0;

  function routeName(){
    const raw=location.hash.startsWith('#/')?location.hash.slice(2):'home';
    return (raw.split('?')[0]||'home');
  }

  function updateAllowancePill(){
    const pill=document.getElementById('np-allowance');
    const wrap=document.getElementById('np-day-wrap');
    if(!pill || !wrap) return;
    if(newRemainingToday>0){
      pill.textContent=`Today's new: ${newRemainingToday}`;
      pill.style.display='inline-block';
    }else{
      pill.style.display='none';
      wrap.textContent='Come back tomorrow';
    }
  }

  async function renderNewPhrase(){
    const host=document.createElement('div');
    host.innerHTML=`<h1 class="h1">New Words</h1>
      <div class="muted" id="np-day-wrap">Day <span id="np-day">1</span></div>
      <div class="status-pill gray" id="np-allowance" style="display:none; margin-top:4px;"></div>
      <section class="card card--center"><div id="np-root" class="flashcard"></div></section>`;
    viewEl=host.querySelector('#np-root');

    const deckId = dk;
    host.querySelector('#np-day').textContent=getDayNumber();

    (function migrateDailyIfNeeded(){
      const canonical = dailyKey;
      const legacy    = 'np_daily_' + ((window.STATE && STATE.activeDeckId) || '');
      if (canonical !== legacy) {
        const legacyVal = localStorage.getItem(legacy);
        const nothing = localStorage.getItem(canonical);
        if (legacyVal && !nothing) localStorage.setItem(canonical, legacyVal);
      }
    })();

    try {
      deckRows = await loadDeckRows(deckId);
      const prog = loadProgress(deckId);
      const attempts = loadAttemptsMap();
      const seenIds = new Set(Object.keys(prog.seen || {}));
      allMastered = computeAllMastered(deckId, prog);

    const today = (new Date()).toISOString().slice(0, 10);

    // 1) Clean up stale half-started items (seenCount=0 from past days)
    {
      const p = prog.seen || {};
      let changed = false;
      for (const [id, s] of Object.entries(p)) {
        if ((s.seenCount || 0) === 0 && s.firstSeen && s.firstSeen < today) {
          delete p[id]; // make it unseen again
          changed = true;
        }
      }
      if (changed) {
        prog.seen = p;
        localStorage.setItem(progressKey, JSON.stringify(prog));
        window.fcSaveCloud && window.fcSaveCloud();
      }
    }

    // 2) Build unseen list in course order
    const unseenCards = deckRows.filter(r => !seenIds.has(r.id) && !(attempts[r.id] || []).length);
    const orderLevels = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
    const sortByCourseOrder = (a, b) => {
      const parseId = id => {
        const parts = String(id || '').split('-');
        return {
          level: parts[0] || '',
          section: parseInt(parts[1] || '0', 10),
          phrase: parseInt(parts[2] || '0', 10)
        };
      };
      const pa = parseId(a.id), pb = parseId(b.id);
      const L = (orderLevels[pa.level] || 99) - (orderLevels[pb.level] || 99);
      if (L) return L;
      const S = pa.section - pb.section; if (S) return S;
      return pa.phrase - pb.phrase;
    };
    unseenCards.sort(sortByCourseOrder);

      const activeRows = deckRows.filter(r => seenIds.has(r.id) || (attempts[r.id] || []).length);
      const enriched = activeRows.map(r=>{
        const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
        const status = categoryFromPct(acc);
        return {status};
      });
      const strugglingCount = enriched.filter(x=>x.status==='Struggling').length;

      const prev = loadNewDaily(deckId);
      const dayKey = todayKey();
      const usedToday = prev.date === dayKey ? (prev.used || 0) : 0;
      const daily = getDailyNewAllowance(unseenCards.length, usedToday, strugglingCount);
      saveNewDaily(deckId, { date: dayKey, ...daily });
      newRemainingToday = Math.max(0, (daily.allowed || 0) - (daily.used || 0));
      const pill=host.querySelector('#np-allowance');
      const wrap=host.querySelector('#np-day-wrap');
      if(newRemainingToday>0){
        pill.textContent=`Today's new: ${newRemainingToday}`;
        pill.style.display='inline-block';
      }else{
        pill.style.display='none';
        wrap.textContent='Come back tomorrow';
      }

      queue = unseenCards.slice(0, newRemainingToday);

      idx = 0;
      step = STEPS.WELSH;

      if (queue.length) {
        render();
      } else {
        renderEmpty();
      }

    } catch(e){
      console.error(e);
      viewEl.innerHTML=`<div class="muted">Failed to load data.</div>`;
    }
    return host;
  }

  function current(){ return queue[idx]; }

  function render(){
    stopAudio();
    const c=current();
    if(!c){ renderEmpty(); return; }

    const img = c.image ? `<img src="${c.image}" alt="${escapeHTML(c.front)}" style="width:100%; border-radius:16px;">`
                         : `<div class="no-image muted">No image</div>`;


    if(step===STEPS.WELSH){
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="tm-audio" style="margin-top:6px;">
          <button class="btn audio-btn" id="np-play" disabled>🔊 Play</button>
          <button class="btn audio-btn" id="np-play-slow" style="margin-left:6px;" disabled>🐢 0.6×</button>
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      const playBtn=viewEl.querySelector('#np-play');
      const slowBtn=viewEl.querySelector('#np-play-slow');
      const nextBtn=viewEl.querySelector('#np-next');
      playBtn.addEventListener('click',()=>playAudio(c.audio,1.0));
      slowBtn.addEventListener('click',()=>playAudio(c.audio,0.6));
      nextBtn.addEventListener('click',()=>{ stopAudio(); step=STEPS.MEANING; render(); });
      (async()=>{
        await playSequence(c.audio);
        playBtn.disabled=false;
        slowBtn.disabled=false;
      })();
      return;
    }

    if(step===STEPS.MEANING){
      const chips=(c.word_breakdown||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span class="chip">${escapeHTML(s)}</span>`).join(' ');
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="translation" style="margin-top:4px;">${escapeHTML(c.back)}</div>
        <div class="breakdown" style="margin-top:6px;">${chips||''}</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      viewEl.querySelector('#np-next').addEventListener('click',()=>{step=STEPS.CONTEXT; render();});
      return;
    }

    if(step===STEPS.CONTEXT){
      const related=(c.pattern_examples||'').split(/[\/|,]/).map(s=>s.trim()).filter(Boolean).map(s=>`<li>${escapeHTML(s)}</li>`).join('');
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="usage" style="margin-top:6px;">${escapeHTML(c.usage_note||'')}</div>
        ${related?`<div class="patterns" style="margin-top:6px;"><ul class="patterns-list">${related}</ul></div>`:''}
        <div class="flashcard-actions">
          <button class="btn primary" id="np-start-drill">Start typing drill</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      viewEl.querySelector('#np-start-drill').addEventListener('click',()=>{step=STEPS.DRILL1; render();});
      return;
    }

    if(step===STEPS.DRILL1 || step===STEPS.DRILL2){
      const label=step===STEPS.DRILL1?'Copy it (1/2)':'Copy it (2/2)';
      viewEl.innerHTML=`
        <div class="term">${escapeHTML(c.front)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">${label}</label>
          <input id="np-typed" class="tm-field" type="text" placeholder="${escapeHTML(c.front)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-submit">Submit</button>
        </div>
        <div class="flashcard-progress muted">Press Enter to submit</div>`;
      const inp=viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click',()=>{
        const ok=equalsLoose(inp.value||'', c.front);
        if(ok){ step = (step===STEPS.DRILL1?STEPS.DRILL2:STEPS.DRILL3); render(); }
        else showIncorrect(inp.value||'', ()=>render());
      });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }

    if(step===STEPS.DRILL3){
      viewEl.innerHTML=`
        <div class="translation">${escapeHTML(c.back)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">Type the Welsh (from memory)</label>
          <input id="np-typed" class="tm-field" type="text" placeholder="Type without looking" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions"><button class="btn nav-btn" id="np-submit">Submit</button></div>
        <div class="flashcard-progress muted">Press Enter to submit</div>`;
      const inp=viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click',()=>{
        const ok=equalsLoose(inp.value||'', c.front);
          if(ok){
            markSeenNow(c.id);
            bumpDailyUsed();
            tickDay();
            newRemainingToday = Math.max(0, newRemainingToday - 1);
            updateAllowancePill();
            fireProgressEvent({ type: 'introduced', id: c.id });
            const deckId = dk;
            const prog = loadProgress(deckId);
            syncProgressToGitHub(deckId,prog); initDeckPicker && initDeckPicker();
            queue.splice(idx,1);
            viewEl.innerHTML=`
            <div class="tm-result tm-correct">✓ Correct</div>
            <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
            <div class="tm-audio" style="margin-top:6px;"><button class="btn audio-btn" id="np-play">🔊 Play</button></div>
            <div class="flashcard-actions"><button class="btn green" id="np-next">Next word</button></div>
            <div class="flashcard-progress muted">Great! Audio plays automatically.</div>`;
          playAudio(c.audio,1.0);
          viewEl.querySelector('#np-play').addEventListener('click',()=>playAudio(c.audio,1.0));
          viewEl.querySelector('#np-next').addEventListener('click',nextCard);
          allMastered = computeAllMastered(deckId, prog);
        } else {
          showIncorrect(inp.value||'', ()=>render());
        }
      });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }
  }

  function renderEmpty(){
    const allow=canUnlock(allMastered);
    if(allow){
      viewEl.innerHTML=`<div class="flashcard-progress muted" style="margin-bottom:8px;">No active phrases.</div>
        <div class="flashcard-actions"><button class="btn primary" id="np-unlock">Unlock next phrase</button></div>`;
      viewEl.querySelector('#np-unlock').addEventListener('click',unlockNext);
    } else {
      viewEl.innerHTML=`<div class="flashcard-progress muted" style="margin-bottom:8px;">No new phrases available today. Come back tomorrow.</div>
        <div class="flashcard-actions"><a class="btn nav-btn" href="#/home">Finish</a></div>`;
      window.dispatchEvent(new CustomEvent('fc:module-complete',{ detail:{ module:'new' }}));
    }
  }

  function nextCard(){
    stopAudio();
    if(idx>=queue.length){ renderEmpty(); return; }
    step=STEPS.WELSH; render();
  }

  function showIncorrect(userTyped,onRetry){
    const c=current();
    viewEl.innerHTML=`
      <div class="tm-result tm-fail">✖ Incorrect</div>
      <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
      <div class="tm-mismatch" style="margin-top:8px;">
        <div class="tm-label">Your answer</div>
        <div class="tm-ansbox">${escapeHTML(userTyped||'—')}</div>
      </div>
      <div class="flashcard-actions"><button class="btn red" id="np-retry">Try again</button></div>`;
    viewEl.querySelector('#np-retry').addEventListener('click',onRetry);
  }

  async function unlockNext(){
    const deckId = dk;
    const prog = loadProgress(deckId); if(!prog.seen) prog.seen={};
    const active=new Set(Object.keys(prog.seen));
    const next=deckRows.find(r=>!active.has(r.id));
    if(!next){ viewEl.innerHTML=`<div class="flashcard-progress muted">All phrases unlocked.</div>`; return; }
    queue.push(next); idx=queue.length-1; step=STEPS.WELSH; render();
    allMastered = computeAllMastered(deckId, prog);
  }

  /* ---------- Boot ---------- */
  window.renderNewPhrase = renderNewPhrase;

  // If the page was loaded directly on the New Words route, the initial render
  // occurs before this script defines `renderNewPhrase`, leaving the view blank.
  // Now that the route's renderer is available, re-run the global router so the
  // host element is inserted properly.
  if (location.hash.startsWith('#/newPhrase') && typeof window.render === 'function') {
    window.render();
  }

  // small style tweaks (reuse flashcard look)
  const style=document.createElement('style');
  style.textContent=`
    .tm-result{ text-align:center; font-weight:800; margin-top:4px; }
    .tm-fail{ color:#ff6b6b; }
    .tm-correct{ color:#3bd16f; }
    .tm-label{ font-size:12px; color: var(--muted); text-align:center; }
    .tm-ansbox{ border:1px dashed var(--border); border-radius:10px; padding:8px 10px; margin-top:4px; background:rgba(255,255,255,0.02); }
    .tm-audio{ display:flex; justify-content:center; }
    .chip{ display:inline-block; border:1px solid var(--border); background:var(--panel); border-radius:999px; padding:4px 10px; font-size:12px; color:var(--text); margin:2px; }
  `;
  document.head.appendChild(style);
})();

})();

(function(){
function deckKeyFromState() {
  const map = {
    'Welsh – A1 Phrases': 'welsh_phrases_A1',
    'Welsh - A1 Phrases': 'welsh_phrases_A1',
    'welsh_a1': 'welsh_phrases_A1'
  };
  const id = (window.STATE && STATE.activeDeckId) || '';
  return map[id] || id || 'welsh_phrases_A1';
}

const dk          = deckKeyFromState();
const progressKey = 'progress_' + dk;          // read/write here
const dailyKey    = 'np_daily_' + dk;          // read in Test/Study; read/write in New Phrases
const attemptsKey = 'tm_attempts_v1';          // global attempts bucket (unchanged)

(function migrateProgressIfNeeded(){
  const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
  if (legacy !== progressKey) {
    const legacyVal = localStorage.getItem(legacy);
    if (legacyVal && !localStorage.getItem(progressKey)) {
      localStorage.setItem(progressKey, legacyVal);
    }
  }
})();

async function loadDeckSorted(deckId){
  return await loadDeckRows(deckId || dk);
}

function loadProgressSeen(){
  try { return (JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}').seen) || {}; }
  catch { return {}; }
}

function loadAttempts(){
  try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}'); }
  catch { return {}; }
}

function isActiveCard(id, seen, attempts){
  return !!(seen[id] || (attempts[id] && attempts[id].length));
}

const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

function logAttempt(cardId, pass){
  const obj = loadAttempts();
  const arr = obj[cardId] || [];
  const now = Date.now();
  let score = true;
  if (pass) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (a.pass && a.score !== false) {
        if (now - a.ts < SCORE_COOLDOWN_MS) score = false;
        break;
      }
    }
  }
  arr.push({ ts: now, pass: !!pass, score });
  obj[cardId] = arr;
  localStorage.setItem(attemptsKey, JSON.stringify(obj));
}

async function renderReview(query) {
  // We keep 'mode' param but always start with Welsh front in flashcards
  const deckId = query.get('deck') && DECKS.some(d => d.id === query.get('deck'))
    ? query.get('deck') : STATE.activeDeckId;
  if (deckId !== STATE.activeDeckId) setActiveDeck(deckId);

  const dk = deckKeyFromState();
  const activeDeck = DECKS.find(d => d.id === dk);
  const deck = await loadDeckSorted(dk);
  const seen = loadProgressSeen();
  const attempts = loadAttempts();
  const cards = deck.filter(c => isActiveCard(c.id, seen, attempts));
  console.log('[active-count]', deckKeyFromState(), cards.length);
  console.log('[progress-key-used]', progressKey);

  if (!cards.length) {
    const err = document.createElement('div');
    err.innerHTML = `<h1 class="h1">Review <span class="muted">(${activeDeck.name})</span></h1>` +
      `<section class="card card--center">No introduced cards. Use New Phrases first.</section>`;
    return err;
  }

  // UI state
  let idx = 0;
  const startId = query.get('card');
  if (startId) {
    const i = cards.findIndex(c => c.id === startId);
    if (i >= 0) idx = i;
  }
  let showBack = false;   // front(Welsh) → back(English) in flash mode
  let slowNext = false;   // audio alternator

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Review <span class="muted">(${activeDeck.name})</span></h1>
    <section class="card card--center">
      <div class="flashcard" id="flashcard" data-view="${STATE.viewMode}">
        <div class="fc-topbar">
          <div class="fc-viewtoggle">
            <label class="toggle">
              <input type="checkbox" id="viewToggle" ${STATE.viewMode === 'detail' ? 'checked' : ''}>
              <span class="tlabel"><span>Flashcard</span><span>Detailed</span></span>
            </label>
          </div>
        </div>

        <div class="flashcard-image" id="fcImg"></div>

        <div class="fc-phrase">
          <div class="term" id="fcTerm" title="Tap to flip in Flashcard mode"></div>
          <button class="btn audio-btn" id="audioBtn" title="Play (alternates fast/slow)">🔊 Play</button>
          <div class="phonetic" id="fcPhon"></div>
        </div>

        <div class="translation" id="fcTrans"></div>
        <div class="breakdown" id="fcBreak"></div>
        <div class="usage" id="fcUsage"></div>
        <div class="example" id="fcExample"></div>
        <div class="patterns" id="fcPatterns"></div>

        <div class="flashcard-actions">
          <button class="btn nav-btn" id="prevBtn">Previous</button>
          <button class="btn nav-btn" id="nextBtn">Next</button>
          <a class="btn end-btn" href="#/phrases">End Session</a>
        </div>

        <div class="flashcard-progress muted" id="fcProg"></div>
      </div>
    </section>
  `;

  const root     = wrap.querySelector('#flashcard');
  const imgEl    = wrap.querySelector('#fcImg');
  const termEl   = wrap.querySelector('#fcTerm');
  const phonEl   = wrap.querySelector('#fcPhon');
  const transEl  = wrap.querySelector('#fcTrans');
  const brkEl    = wrap.querySelector('#fcBreak');
  const useEl    = wrap.querySelector('#fcUsage');
  const exEl     = wrap.querySelector('#fcExample');
  const patEl    = wrap.querySelector('#fcPatterns');
  const prevBtn  = wrap.querySelector('#prevBtn');
  const nextBtn  = wrap.querySelector('#nextBtn');
  const audioBtn = wrap.querySelector('#audioBtn');
  const progEl   = wrap.querySelector('#fcProg');
  const viewTgl  = wrap.querySelector('#viewToggle');

  // toggle view
  viewTgl.addEventListener('change', () => {
    const mode = viewTgl.checked ? 'detail' : 'flash';
    setViewMode(mode);
    root.dataset.view = mode;
    showBack = false; // reset flip when switching
    renderCard();
  });

  // audio helpers
  function stopAudio() {
    if (window.fcAudio) window.fcAudio.stop();
  }
  function playAudio(src) {
    if (!src) return;
    stopAudio();
    const rate = slowNext ? 0.6 : 1.0; // alternate fast/slow
    if (window.fcAudio) window.fcAudio.play(src, rate);
    slowNext = !slowNext;
  }

  // parsing helpers
  const parsePairs = s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);
  const parsePatterns = s => {
    if (!s) return [];
    // support '|', '/', or ',' as separators
    const sep = s.includes('|') ? '|' : (s.includes('/') ? '/' : ',');
    return s.split(sep).map(x => x.trim()).filter(Boolean);
  };


  // render card (no duplicate English, click term flips in flash)
  function renderCard() {
    const c = cards[idx];
    const isDetail = (STATE.viewMode === 'detail');

    // image
    imgEl.innerHTML = c.image
      ? `<img src="${c.image}" alt="${c.front}">`
      : `<div class="no-image muted">No image</div>`;

    // phrase + phonetic
    if (isDetail) {
      termEl.textContent = c.front;              // Welsh always on top in detailed
      phonEl.textContent = c.phonetic || '';
      transEl.textContent = c.back || '';        // English shown once below
      transEl.classList.remove('hidden');
    } else {
      termEl.textContent = showBack ? c.back : c.front; // flip between Welsh/English
      phonEl.textContent = '';                            // keep flashcard clean
      transEl.textContent = '';                           // never show separate translation line in flash
      transEl.classList.add('hidden');
    }

    // breakdown (detail only)
    brkEl.innerHTML = '';
    if (isDetail && c.word_breakdown) {
      const list = document.createElement('div');
      list.className = 'breakdown-list';
      parsePairs(c.word_breakdown).forEach(pair => {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = pair;
        list.appendChild(chip);
      });
      brkEl.appendChild(list);
    }

    // usage
    useEl.textContent = isDetail ? (c.usage_note || '') : '';

    // example (detail always; flash only on back if you want)
    if (isDetail) {
      exEl.innerHTML = c.example ? `<div class="ex-welsh">${c.example}</div>` : '';
    } else {
      exEl.innerHTML = showBack && c.example ? `<div class="ex-welsh">${c.example}</div>` : '';
    }


    // patterns (detail only) — tap anywhere in the area to toggle English
    patEl.innerHTML = '';
    if (isDetail && c.pattern_examples) {
      const normalize = s => (s || '').toLowerCase().trim();

      // Use your existing parsePatterns so separators stay consistent (/, or ,)
      const welshArr = parsePatterns(c.pattern_examples);
      const enArr    = parsePatterns(c.pattern_examples_en || '');

      // Pair up W/EN and exclude the current phrase
      const pairs = welshArr
        .map((w, i) => ({ w, e: enArr[i] || '' }))
        .filter(p =>
          normalize(p.w) !== normalize(c.front) &&
          normalize(p.w) !== normalize(c.back)
        );

      if (pairs.length) {
        // Header hint
        const hdr = document.createElement('div');
        hdr.className = 'muted';
        hdr.style.textAlign = 'center';
        hdr.style.fontSize = '12px';
        hdr.style.userSelect = 'none';
        hdr.textContent = STATE.showExamplesEN
          ? 'Related phrases (tap to hide English)'
          : 'Related phrases (tap to show English)';
        patEl.appendChild(hdr);

        // List
        const ul = document.createElement('ul');
        ul.className = 'patterns-list';
        ul.style.cursor = 'pointer';
        pairs.forEach(p => {
          const li = document.createElement('li');
          li.textContent =
            (STATE.showExamplesEN && p.e) ? `${p.w} — ${p.e}` : p.w;
          ul.appendChild(li);
        });
        patEl.appendChild(ul);

        // Tap anywhere in header or list to toggle EN
        const toggleEN = () => {
          setExamplesEN(!STATE.showExamplesEN); // persist + update state
          renderCard();                         // re-render this card
        };
        hdr.addEventListener('click', toggleEN);
        ul.addEventListener('click', toggleEN);
      }
    }



    // progress
    progEl.textContent = `Card ${idx + 1} of ${cards.length}`;

    // click-to-flip behaviour
    termEl.style.cursor = (STATE.viewMode === 'flash') ? 'pointer' : 'default';
  }

  // initial render
  renderCard();
  // autoplay new card at normal speed
  slowNext = false;
  const first = cards[idx];
  if (first.audio) playAudio(first.audio);

  // interactions
  imgEl.addEventListener('click', () => {
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });
  audioBtn.addEventListener('click', () => {
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });
  termEl.addEventListener('click', () => {
    if (STATE.viewMode === 'flash') {
      showBack = !showBack;
      renderCard();
    }
  });
  nextBtn.addEventListener('click', () => {
    stopAudio();
    idx = (idx + 1) % cards.length;
    showBack = false;
    renderCard();
    // autoplay next card at normal speed
    slowNext = false;
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });
  prevBtn.addEventListener('click', () => {
    stopAudio();
    idx = (idx - 1 + cards.length) % cards.length;
    showBack = false;
    renderCard();
    // autoplay previous card at normal speed
    slowNext = false;
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });

  // keyboard (desktop convenience)
  window.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); nextBtn.click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
    if (e.key?.toLowerCase() === 'a') { e.preventDefault(); audioBtn.click(); }
    if (e.key?.toLowerCase() === 'f' && STATE.viewMode === 'flash') { e.preventDefault(); termEl.click(); }
  };

  return wrap;
}
window.renderReview = renderReview;

/* Run All hook: fire completion when "End Session" is clicked in Review */
window.addEventListener('click', (e) => {
  const btn = e.target.closest('.end-btn, [data-action="end"], button, a');
  if (!btn) return;

  const label = (btn.getAttribute('aria-label') || btn.textContent || '')
    .trim().toLowerCase();

  const isEnd =
    btn.classList.contains('end-btn') ||
    btn.matches('[data-action="end"]') ||
    label === 'end session';

  if (!isEnd) return;

  // Tell the runner that Review finished
  window.dispatchEvent(
    new CustomEvent('fc:module-complete', { detail: { module: 'review' } })
  );
});


})();
(function(){
  function deckKeyFromState() {
    const map = {
      'Welsh – A1 Phrases': 'welsh_phrases_A1',
      'Welsh - A1 Phrases': 'welsh_phrases_A1',
      'welsh_a1': 'welsh_phrases_A1'
    };
    const id = (window.STATE && STATE.activeDeckId) || '';
    return map[id] || id || 'welsh_phrases_A1';
  }

const dk          = deckKeyFromState();
const progressKey = 'progress_' + dk;          // read/write here
const dailyKey    = 'np_daily_' + dk;          // read in Test/Study; read/write in New Phrases
const attemptsKey = 'tm_attempts_v1';          // global attempts bucket (unchanged)

function fireProgressEvent(payload){
  window.dispatchEvent(new CustomEvent('fc:progress-updated', { detail: payload || {} }));
}

  (function migrateProgressIfNeeded(){
    const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
    if (legacy !== progressKey) {
      const legacyVal = localStorage.getItem(legacy);
      if (legacyVal && !localStorage.getItem(progressKey)) {
        localStorage.setItem(progressKey, legacyVal);
      }
    }
  })();

  async function loadDeckSorted(deckId){
    return await loadDeckRows(deckId || dk);
  }

  function loadProgressSeen(){
    try { return (JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}').seen) || {}; }
    catch { return {}; }
  }

  function loadAttempts(){
    try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}'); }
    catch { return {}; }
  }

  function isActiveCard(id, seen, attempts){
    return !!(seen[id] || (attempts[id] && attempts[id].length));
  }

  const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
  const SCORE_WINDOW = 10;

  function logAttempt(cardId, pass, opts){
    const obj = loadAttempts();
    const arr = obj[cardId] || [];
    const now = Date.now();
    let score = true;
    if (opts && opts.forceNoScore) {
      score = false;
    } else if (pass) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const a = arr[i];
        if (a.pass && a.score !== false) {
          if (now - a.ts < SCORE_COOLDOWN_MS) score = false;
          break;
        }
      }
    }
    arr.push({ ts: now, pass: !!pass, score });
    obj[cardId] = arr;
    localStorage.setItem(attemptsKey, JSON.stringify(obj));
    window.fcSaveCloud && window.fcSaveCloud();
    return score;
  }

  function lastNAccuracy(cardId, n = SCORE_WINDOW, map = loadAttempts()){
    const raw = map[cardId] || [];
    const scored = raw.filter(a => a.score !== false);
    const arr = scored.slice(-n);
    if (!arr.length) return 0;
    const p = arr.filter(a => a.pass).length;
    return Math.round((p / arr.length) * 100);
  }


  // Test Mode – review only. Route: #/test

  /* ---------- Constants & state ---------- */
  let container = null;
  let deck = [];
  let idx = 0;
  let correct = 0;
  let wrong = [];
  let practiceMode = false;
  let seenThisSession = new Set();
  let sessionDue = 0;

  /* ---------- Small helpers ---------- */

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g, '')
      .replace(/[\u2019\u2018]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[.,!?;:"'()\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const prev = new Array(n + 1);
    const cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function equalsLoose(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (x === y) return true;
    const dist = levenshtein(x, y);
    const tol = Math.max(1, Math.floor(Math.max(x.length, y.length) / 8));
    return dist <= tol;
  }

  const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function focusField(sel){ const el = container?.querySelector(sel); if(el){ el.focus(); el.select?.(); }}

  /* ---------- Prevent global hotkeys inside inputs ---------- */
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)) {
      e.stopPropagation();
    }
  }, true);

  /* ---------- Data loading ---------- */
  async function buildActiveDeck() {
    const rows = await loadDeckSorted(dk);
    const deck = rows.map(r => ({ id: r.id, front: r.front, back: r.back, unit: r.unit, section: r.section, card: r.card }));
    const seen = loadProgressSeen();
    const attempts = loadAttempts();
    const session = (()=>{ try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch{ return {}; } })();
    const doneSet = new Set(session.done || []);
    const now = Date.now();
    const active = deck.filter(c => {
      if (!isActiveCard(c.id, seen, attempts)) return false;
      if (doneSet.has(c.id)) return false;
      const arr = attempts[c.id] || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const a = arr[i];
        if (a.pass && a.score !== false) {
          if (now - a.ts < SCORE_COOLDOWN_MS) return false;
          break;
        }
      }
      return true;
    });
    console.log('[active-count]', deckKeyFromState(), active.length);
    console.log('[progress-key-used]', progressKey);
    return active;
  }

  async function buildPracticeDeck() {
    const rows = await loadDeckSorted(dk);
    const deck = rows.map(r => ({ id: r.id, front: r.front, back: r.back, unit: r.unit, section: r.section, card: r.card }));
    const seen = loadProgressSeen();
    const attempts = loadAttempts();
    const active = deck.filter(c => isActiveCard(c.id, seen, attempts));
    return active;
  }

  async function checkPracticeUnlock() {
    const btn = document.getElementById('practiceToggle');
    const hint = document.getElementById('practiceHint');
    if (!btn) return;
    const count = await (window.fcGetTestQueueCount ? window.fcGetTestQueueCount() : Promise.resolve(0));
    const unlocked = count === 0;
    btn.disabled = !unlocked;
    btn.textContent = 'Practice (free retest)';
    if (hint) hint.style.display = unlocked ? 'none' : '';
  }

  function updatePracticeUI() {
    const banner = document.getElementById('practiceBanner');
    const btn = document.getElementById('practiceToggle');
    if (banner) banner.style.display = practiceMode ? '' : 'none';
    if (btn) btn.classList.toggle('active', practiceMode);
  }

  /* ---------- Session tracking ---------- */
  const SESSION_KEY = 'tm_session';

  function resetSession(){
    localStorage.setItem(SESSION_KEY, JSON.stringify({ done: [] }));
  }

  function markSessionDone(id){
    let obj;
    try{ obj = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); }
    catch { obj = {}; }
    if(!Array.isArray(obj.done)) obj.done = [];
    if(!obj.done.includes(id)) obj.done.push(id);
    localStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  }

  /* ---------- Rendering ---------- */
  function renderCard() {
    const c = deck[idx];
    if(!seenThisSession.has(c.id)){
      seenThisSession.add(c.id);
      markSessionDone(c.id);
      fireProgressEvent({ type:'seen', id: c.id });
    }
    container.innerHTML = `
      <div class="flashcard">
        <div class="translation">${escapeHTML(c.back)}</div>
        <div class="tm-inputblock">
          <label for="tm-answer" class="tm-label">Type the Welsh</label>
          <input id="tm-answer" class="tm-field" type="text" placeholder="Type the Welsh…" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="flashcard-actions" style="flex-direction:column; gap:6px;">
          <button class="btn nav-btn big" id="tm-submit">Submit</button>
          <button class="btn link danger" id="tm-skip" title="Counts as incorrect">I don’t know</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx + 1} of ${deck.length}</div>
      </div>`;
    container.querySelector('#tm-submit').addEventListener('click', () => handleSubmit(false));
    container.querySelector('#tm-skip').addEventListener('click', () => handleSubmit(true));
    const inp = container.querySelector('#tm-answer');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(false); } });
    focusField('#tm-answer');
  }

  function handleSubmit(skip) {
    const c = deck[idx];
    const val = container.querySelector('#tm-answer').value || '';
    const pass = !skip && equalsLoose(val, c.front);
    if (pass) tickDay();
    logAttempt(c.id, pass, { forceNoScore: practiceMode });
    fireProgressEvent({ type:'attempt', id: c.id, pass });
    if (pass) {
      correct++;
      showResult(true, val);
    } else {
      wrong.push(c);
      startDrill(c, val);
    }
  }

  function startDrill(card, initialInput) {
    function copyStep(step, wrongVal) {
      const label = step === 1 ? 'Copy it (1/2)' : step === 2 ? 'Copy it (2/2)' : 'Copy it again';
      container.innerHTML = `
        <div class="flashcard">
          <div class="term">${escapeHTML(card.front)}</div>
          ${typeof wrongVal !== 'undefined' ? '<div class="tm-result tm-fail">✖ Incorrect</div>' : ''}
          ${typeof wrongVal !== 'undefined' ? `<div class="tm-mismatch"><div class="tm-label">Your answer</div><div class="tm-ansbox">${escapeHTML(wrongVal || '—')}</div></div>` : ''}
          <div class="tm-inputblock">
            <label class="tm-label">${label}</label>
            <input id="tm-drill" class="tm-field" type="text" placeholder="${escapeHTML(card.front)}" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <div class="flashcard-actions"><button class="btn nav-btn" id="tm-submit">Submit</button></div>
          <div class="flashcard-progress muted">Card ${idx + 1} of ${deck.length}</div>
        </div>`;
      const inp = container.querySelector('#tm-drill');
      function submit(){
        const val = inp.value || '';
        const ok = equalsLoose(val, card.front);
        logAttempt(card.id, ok, { forceNoScore: true });
        fireProgressEvent({ type:'attempt', id: card.id, pass: ok });
        if (ok) {
          if (step === 1) copyStep(2);
          else if (step === 2) blindStep(1);
          else blindStep(2);
        } else {
          copyStep(step, val);
        }
      }
      container.querySelector('#tm-submit').addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      focusField('#tm-drill');
    }

    function blindStep(attempt) {
      container.innerHTML = `
        <div class="flashcard">
          <div class="translation">${escapeHTML(card.back)}</div>
          <div class="tm-inputblock" style="margin-top:8px;">
            <label class="tm-label">Type the Welsh</label>
            <input id="tm-drill" class="tm-field" type="text" placeholder="Type the Welsh…" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <div class="flashcard-actions"><button class="btn nav-btn" id="tm-submit">Submit</button></div>
          <div class="flashcard-progress muted">Card ${idx + 1} of ${deck.length}</div>
        </div>`;
      const inp = container.querySelector('#tm-drill');
      function submit(){
        const val = inp.value || '';
        const ok = equalsLoose(val, card.front);
        if (ok) tickDay();
        const counted = logAttempt(card.id, ok, { forceNoScore: practiceMode });
        fireProgressEvent({ type:'attempt', id: card.id, pass: ok });
        if (ok) {
          showResult(true, val, { scoreCounted: counted });
        } else if (attempt === 1) {
          copyStep(3, val);
        } else {
          showResult(false, val);
        }
      }
      container.querySelector('#tm-submit').addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      focusField('#tm-drill');
    }

    copyStep(1, initialInput);
  }

  function showResult(pass, userInput, opts) {
    const c = deck[idx];
    let resultHtml = '';
    if (pass) {
      resultHtml = '<div class="tm-result tm-correct">✓ Correct</div>';
      if (opts && opts.scoreCounted === false && !practiceMode) {
        resultHtml += '<div class="tm-label">Confidence unchanged (1h cooldown)</div>';
      }
    } else {
      resultHtml = '<div class="tm-result tm-fail">✖ Incorrect</div>\n           <div class="tm-mismatch">\n             <div class="tm-label">Your answer</div>\n             <div class="tm-ansbox">' + escapeHTML(userInput || '—') + '</div>\n           </div>';
    }
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">${escapeHTML(c.front)}</div>
        ${resultHtml}
        <div class="flashcard-actions"><button class="btn nav-btn" id="tm-next">Next</button></div>
        <div class="flashcard-progress muted">Card ${idx + 1} of ${deck.length}</div>
      </div>`;
    const nextBtn = container.querySelector('#tm-next');
    function goNext(){
      window.removeEventListener('keydown', onEnter);
      idx++;
      if (idx < deck.length) renderCard();
      else renderSummary();
    }
    function onEnter(e){
      if(e.key === 'Enter'){ e.preventDefault(); goNext(); }
    }
    nextBtn.addEventListener('click', goNext);
    window.addEventListener('keydown', onEnter);
    focusField('#tm-next');
  }

  function renderSummary() {
    const total = deck.length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const list = wrong.map(c => `<li>${escapeHTML(c.back)} → <strong>${escapeHTML(c.front)}</strong></li>`).join('');
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">Test complete</div>
        <div class="tm-result tm-correct" style="margin-top:8px;">${correct} / ${total} correct (${pct}%)</div>
        ${wrong.length ? `<div class="tm-mismatch"><div class="tm-label">Incorrect</div><ul class="tm-anslist">${list}</ul></div>` : ''}
        <div class="flashcard-actions" style="flex-direction:column; gap:6px;">
          <a class="btn nav-btn" href="#/home">Finish</a>
        </div>
        <div class="flashcard-progress muted">Nice work!</div>
      </div>`;
    window.dispatchEvent(new CustomEvent('fc:module-complete',{ detail:{ module:'test' }}));
    if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge();
  }

  /* ---------- Flow ---------- */
  async function start() {
    seenThisSession = new Set();
    resetSession();
    container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Loading…</div></div>`;
    try {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      const single = params.get('card');
      let active = await buildActiveDeck();
      if (single) {
        active = active.filter(c => c.id === single);
      }
      if (!active.length) {
        const urlPractice = params.get('practice') === '1' || params.get('practice') === 'true';
        if (!single && urlPractice) {
          active = await buildPracticeDeck();
          if (!active.length) {
            container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">No cards available for practice.</div></div>`;
            return;
          }
        } else {
          container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">No introduced cards to test. Use New Phrases to unlock today’s set.</div></div>`;
          return;
        }
      }
      const attemptsMap = loadAttempts();
      active.forEach(c=>{ c.conf = lastNAccuracy(c.id, SCORE_WINDOW, attemptsMap); });
      const groups = {};
      active.forEach(c=>{ (groups[c.conf] = groups[c.conf] || []).push(c); });
      const confKeys = Object.keys(groups).map(Number).sort((a,b)=>a-b);
      active = confKeys.flatMap(conf=>shuffle(groups[conf]));
      sessionDue = Math.min(active.length, SESSION_MAX);
      if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge(active.length);
      active = active.slice(0, SESSION_MAX);
      deck = active;
      idx = 0; correct = 0; wrong = [];
      renderCard();
    } catch (e) {
      console.error(e);
      container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Failed to load cards.</div></div>`;
    }
  }

  function routeName() {
    const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
    return (raw.split('?')[0] || 'home');
  }

  async function mountIfTestRoute() {
    if (routeName() !== 'test') {
      if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge();
      return;
    }

    document.querySelectorAll('.nav a').forEach(a =>
      a.classList.toggle('active', a.getAttribute('href') === '#/test')
    );

    container = document.getElementById('test-container');
    if (!container) { setTimeout(mountIfTestRoute, 0); return; }

    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    practiceMode = params.get('practice') === '1' || params.get('practice') === 'true';
    updatePracticeUI();
    const pBtn = document.getElementById('practiceToggle');
    if (pBtn) {
      pBtn.addEventListener('click', () => {
        if (pBtn.disabled) return;
        practiceMode = !practiceMode;
        updatePracticeUI();
      });
    }
    checkPracticeUnlock();

    const sec = container.parentElement; // section
    if (!document.getElementById('tm-day')) {
      const dayEl = document.createElement('div');
      dayEl.id = 'tm-day';
      dayEl.className = 'muted';
      dayEl.style.marginBottom = '8px';
      dayEl.textContent = `Day ${getDayNumber()}`;
      sec.before(dayEl);
    } else {
      document.getElementById('tm-day').textContent = `Day ${getDayNumber()}`;
    }

    start();
  }

  window.addEventListener('DOMContentLoaded', mountIfTestRoute);
  window.addEventListener('hashchange', mountIfTestRoute);
  window.addEventListener('fc:progress-updated', () => { checkPracticeUnlock(); });

  // If the Test route was loaded before this script executed, mount immediately.
  if (location.hash.startsWith('#/test')) {
    mountIfTestRoute();
  }

  /* ---------- Styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
    .tm-label{font-size:12px;color:var(--muted);text-align:center;margin-top:6px;}
    .tm-field{width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text);font-size:16px;}
    .tm-inputblock{margin-top:8px;}
    .tm-result{text-align:center;font-weight:800;margin-top:4px;}
    .tm-fail{color:#ff6b6b;}
    .tm-correct{color:#3bd16f;}
    .tm-mismatch{margin-top:8px;}
    .tm-ansbox{border:1px dashed var(--border);border-radius:10px;padding:8px 10px;margin-top:4px;background:rgba(255,255,255,0.02);}
    .tm-anslist{margin:8px 0 0;padding:0;list-style:none;text-align:left;}
    .tm-anslist li{padding:4px 0;border-bottom:1px solid var(--border);}
    .btn.big{padding:12px 18px;font-weight:700;}
    .btn.link{background:transparent;border:none;text-decoration:underline;padding:0;}
    .btn.link.danger{color:#ff6b6b;font-size:12px;}
    .practice-badge{background:#555;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:700;margin-right:6px;}
    .practice-banner{padding:8px 12px;border:1px solid var(--border);border-radius:8px;}
  `;
  document.head.appendChild(style);
})();

/* Revised app.js with active phrase filtering and day counter */

const DECKS = [{ id: 'welsh_phrases_A1', name: 'Welsh – A1 Phrases', count: 116 }];

const SETTINGS = { newPerDay: 5 };

const STORAGE = {
  theme: 'fc_theme',
  deck: 'fc_active_deck',
  view: 'fc_card_view_mode',
  examplesEN: 'fc_examples_en'
};

const LS_PROGRESS_PREFIX = 'progress_';
const LS_NEW_DAILY_PREFIX = 'np_daily_';
const LS_ATTEMPTS_KEY = 'tm_attempts_v1';
const LS_DAY_COUNT = 'tm_day_count';
const LS_DAY_LAST  = 'tm_last_increment';
const SCORE_WINDOW = 10;
const LS_TEST_SESSION = 'tm_session';
const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
const STRUGGLE_CAP = 10;
const SESSION_MAX = 15;

function deckKeyFromState() {
  // Prefer the JSON filename stem already used by the fetch; fall back to STATE.activeDeckId.
  // Known mapping for now:
  const map = {
    'Welsh – A1 Phrases': 'welsh_phrases_A1',
    'Welsh - A1 Phrases': 'welsh_phrases_A1',
    'welsh_a1': 'welsh_phrases_A1'
  };
  const id = (STATE && STATE.activeDeckId) || '';
  return map[id] || id || 'welsh_phrases_A1';
}

const STATE = {
  activeDeckId: loadActiveDeckId(),
  viewMode: loadViewMode(),
  showExamplesEN: loadExamplesEN()
};

const dk          = deckKeyFromState();
const progressKey = 'progress_' + dk;          // read/write
const dailyKey    = 'np_daily_' + dk;          // read in Home/Test; read/write in New Phrases
const attemptsKey = 'tm_attempts_v1';          // global attempts

function fireProgressEvent(payload){
  window.dispatchEvent(new CustomEvent('fc:progress-updated', { detail: payload || {} }));
}

function loadActiveDeckId() {
  const saved = localStorage.getItem(STORAGE.deck);
  return (saved && DECKS.some(d => d.id === saved)) ? saved : DECKS[0].id;
}
function setActiveDeck(id) {
  if (!DECKS.some(d => d.id === id)) return;
  STATE.activeDeckId = id;
  localStorage.setItem(STORAGE.deck, id);
  document.querySelectorAll('.deck-select').forEach(sel => {
    sel.value = id;
  });
  render();
}

function loadViewMode() {
  const saved = localStorage.getItem(STORAGE.view);
  return (saved === 'detail' || saved === 'flash') ? saved : 'flash';
}
function setViewMode(mode) {
  STATE.viewMode = mode;
  localStorage.setItem(STORAGE.view, mode);
}
function loadExamplesEN() {
  return localStorage.getItem(STORAGE.examplesEN) === 'true';
}
function setExamplesEN(v) {
  STATE.showExamplesEN = !!v;
  localStorage.setItem(STORAGE.examplesEN, String(!!v));
}

async function updateStatusPills(){
  const deckId = deckKeyFromState();
  const progressKey = 'progress_' + deckId;
  const dailyKey    = 'np_daily_' + deckId;
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const attempts = JSON.parse(localStorage.getItem(LS_ATTEMPTS_KEY) || '{}');
  const rows = await loadDeckRows(deckId);
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const unseenRows = rows.filter(r=>!seen[r.id] && !(attempts[r.id] && attempts[r.id].length > 0));
  const unseenCount = unseenRows.length;
  const enriched = activeRows.map(r=>{
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = categoryFromPct(acc);
    return {status};
  });
  const strugglingCount = enriched.filter(x=>x.status==='Struggling').length;
  const reviewDue       = await fcGetTestQueueCount();
  await fcUpdateQuizBadge(reviewDue);
  const daily = loadNewDaily(deckId);
  const today = todayKey();
  const usedToday = daily.date === today ? (daily.used || 0) : 0;
  const updated = getDailyNewAllowance(unseenCount, usedToday, strugglingCount);
  saveNewDaily(deckId, { date: today, ...updated });
  const allowed = updated.allowed || 0;
  const used = updated.used || 0;
  const newToday = Math.max(0, allowed - used);

  const newEl=document.getElementById('newDisplay');
    if(newEl){
      let txt=`${newToday} new`;
      if(allowed < SETTINGS.newPerDay && allowed===0 && strugglingCount >= STRUGGLE_CAP){
        txt += ` — Paused — too many struggling (${strugglingCount}/${STRUGGLE_CAP})`;
      }
      newEl.textContent=txt;
    }
  const dueEl=document.getElementById('dueDisplay');
  if(dueEl) dueEl.textContent=`${reviewDue} due`;
}

/* ---------- Deck picker ---------- */
function initDeckPicker() {
  document.querySelectorAll('.deck-select').forEach(sel => {
    sel.innerHTML = '';
    DECKS.forEach(d => {
      const prog = loadProgress(d.id);
      const count = Object.keys(prog.seen || {}).length;
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${count})`;
      if (d.id === STATE.activeDeckId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => setActiveDeck(e.target.value));
  });
}

/* ---------- Theme (locked to light) ---------- */
(function initTheme(){
  document.body.setAttribute('data-theme', 'light');
  // Remove any theme controls if they exist
  ['themeToggle','themeToggleTop'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.closest('label')) el.closest('label').style.display = 'none';
  });
})();


/* ---------- Utils ---------- */
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---------- Router ---------- */
const routes = {
  home: renderHome,
  phrases: renderPhraseDashboard,
  words: renderWordsDashboard,
  songs: renderComingSoon('Songs'),
  stories: renderComingSoon('Stories'),
  conversations: renderComingSoon('Conversations'),
  challenges: renderComingSoon('Challenges'),
  review: renderReview,
  decks: renderComingSoon('Custom Phrases'),
  learned: renderLearned,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderSettings,
  test: renderTestShell,
  newPhrase: () => window.renderNewPhrase ? window.renderNewPhrase() : document.createElement('div')
};

async function render() {
  const [route, query] = parseHash();                 // ✅ read current route
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route || (route === 'phrases' && a.dataset.route === 'home'))
  );

  const el = document.getElementById('view');
  const fn = routes[route] || routes.home;
  const out = fn(query);
  el.replaceChildren(out instanceof Promise ? await out : out);
  await updateStatusPills();
}


function parseHash() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
  const [path, qs] = raw.split('?');
  return [path || 'home', new URLSearchParams(qs || '')];
}

/* ---------- Mobile menu ---------- */
function initMobileMenu() {
  const btn = document.getElementById('menuToggle');
  const side = document.querySelector('.side');
  if (!btn || !side) return;

  btn.addEventListener('click', () => side.classList.toggle('open'));

  document.addEventListener('click', (e) => {
    if (!side.contains(e.target) && e.target !== btn && side.classList.contains('open')) {
      side.classList.remove('open');
    }
  });

  document.querySelectorAll('.nav a').forEach(a =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const side = document.querySelector('.side');
      if (side) side.classList.remove('open');
      const route = a.dataset.route || 'home';
      go(route);
    })
  );

}


/* ========= Storage helpers ========= */
function todayKey() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}
function loadProgress(deckId){
  const dk = deckId || deckKeyFromState();
  const progressKey = LS_PROGRESS_PREFIX + dk;
  try{ return JSON.parse(localStorage.getItem(progressKey) || '{}'); }
  catch { return {}; }
}
function saveProgress(deckId,obj){
  const dk = deckId || deckKeyFromState();
  const progressKey = LS_PROGRESS_PREFIX + dk;
  localStorage.setItem(progressKey, JSON.stringify(obj));
  window.fcSaveCloud && window.fcSaveCloud();
}
function loadNewDaily(deckId){
  const dk = deckId || deckKeyFromState();
  const dailyKey = LS_NEW_DAILY_PREFIX + dk;
  try{ return JSON.parse(localStorage.getItem(dailyKey) || '{}'); }
  catch { return {}; }
}
function saveNewDaily(deckId,obj){
  const dk = deckId || deckKeyFromState();
  const dailyKey = LS_NEW_DAILY_PREFIX + dk;
  localStorage.setItem(dailyKey, JSON.stringify(obj));
  window.fcSaveCloud && window.fcSaveCloud();
}
function loadAttemptsMap(){
  try{ return JSON.parse(localStorage.getItem(LS_ATTEMPTS_KEY) || '{}'); }
  catch { return {}; }
}
function lastNAccuracy(cardId,n=SCORE_WINDOW,map=loadAttemptsMap()){
  const raw = map[cardId] || [];
  const scored = raw.filter(a => a.score !== false);
  const arr = scored.slice(-n);
  if (!arr.length) return 0;
  const p = arr.filter(a=>a.pass).length;
  return Math.round((p/arr.length)*100);
}
function categoryFromPct(p){
  if (p<50) return 'Struggling';
  if (p<80) return 'Needs review';
  return 'Mastered';
}
function accuracyHue(p){
  const clamped=Math.max(0,Math.min(100,p));
  return Math.round((clamped/100)*120);
}
function tickDay(){
  const today = todayKey();
  const last = localStorage.getItem(LS_DAY_LAST);
  if(last !== today){
    const count = parseInt(localStorage.getItem(LS_DAY_COUNT) || '0', 10) + 1;
    localStorage.setItem(LS_DAY_COUNT, String(count));
    localStorage.setItem(LS_DAY_LAST, today);
    window.fcSaveCloud && window.fcSaveCloud();
  }
}
function getDayNumber(){
  return parseInt(localStorage.getItem(LS_DAY_COUNT) || '0', 10);
}
async function loadDeckRows(deckId){
  const dk = deckId || deckKeyFromState();
  const res = await fetch(`data/${dk}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Failed to load deck JSON');
  const data = await res.json();

  // Accept several shapes: array, {by_status}, {rows}, {cards}, or a plain object of items
  let raw = [];
  if (Array.isArray(data)) {
    raw = data;
  } else if (Array.isArray(data.rows)) {
    raw = data.rows;
  } else if (Array.isArray(data.cards)) {
    raw = data.cards;
  } else if (data && data.by_status) {
    raw = Object.values(data.by_status).flat();
  } else if (data && typeof data === 'object') {
    // last resort: treat object values as rows
    raw = Object.values(data);
  }

  // Normalize to the fields the app uses
  const rows = (raw || [])
    .map((r, i) => ({
      card: r.card || '',
      unit: r.unit || '',
      section: r.section || '',
      id: r.id || String(i),
      front: r.welsh || r.front || r.word || '',
      back: r.english || r.back || r.translation || '',
      tags: r.tags || '',
      image: r.image || '',
      audio: r.audio || '',
      phonetic: r.pronunciation || r.phonetic || '',
      example: r.example || '',
      usage_note: r.usage_note || r.use || '',
      word_breakdown: r.word_breakdown || r.grammar_notes || '',
      pattern_examples: r.pattern_examples || '',
      pattern_examples_en: r.pattern_examples_en || '',
      slow_audio: r.slow_audio || ''
    }))
    .filter(r => r.id && r.front && r.back);

  // Sort by Level → Section → Phrase using the ID (A1-1-1, etc.)
  const orderLevels = { A1:1, A2:2, B1:3, B2:4, C1:5, C2:6 };
  rows.sort((a, b) => {
    const parseId = id => {
      const p = String(id || '').split('-');
      return { L: p[0] || '', S: parseInt(p[1] || '0', 10), P: parseInt(p[2] || '0', 10) };
    };
    const A = parseId(a.id), B = parseId(b.id);
    const l = (orderLevels[A.L] || 99) - (orderLevels[B.L] || 99); if (l) return l;
    const s = A.S - B.S; if (s) return s;
    return A.P - B.P;
  });

  console.log(`[deck] ${dk} loaded ${rows.length} cards`);
  return rows;
}

async function fcGetTestQueueCount(){
  const dk = deckKeyFromState();
  const rows = await loadDeckRows(dk);
  const prog = loadProgress(dk);
  const attempts = loadAttemptsMap();
  const seen = prog.seen || {};
  const activeRows = rows.filter(r => seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const session = (()=>{ try{ return JSON.parse(localStorage.getItem(LS_TEST_SESSION) || '{}'); } catch{ return {}; } })();
  const doneSet = new Set(session.done || []);
  const now = Date.now();
  return activeRows.filter(r=>{
    if(doneSet.has(r.id)) return false;
    const arr = attempts[r.id] || [];
    for(let i=arr.length-1;i>=0;i--){
      const a=arr[i];
      if(a.pass && a.score !== false){
        if(now - a.ts < SCORE_COOLDOWN_MS) return false;
        break;
      }
    }
    return true;
  }).length;
}
window.fcGetTestQueueCount = fcGetTestQueueCount;

async function fcUpdateQuizBadge(raw){
  if(raw === undefined) raw = await fcGetTestQueueCount();
  const sessionDue = Math.min(raw, SESSION_MAX);
  const queued = Math.max(raw - SESSION_MAX, 0);
  const badge = document.getElementById('b-quiz');
  if(badge) badge.textContent = sessionDue;
  const pill = document.getElementById('quizQueued');
  if(pill){
    if(queued>0){
      pill.textContent = `+${queued} queued`;
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
    }
  }
}
window.fcUpdateQuizBadge = fcUpdateQuizBadge;

function getDailyNewAllowance(unseenCount, newTodayUsed, strugglingCount){
  const base = SETTINGS.newPerDay;
  const factor = Math.max(0, Math.min(1, (STRUGGLE_CAP - strugglingCount) / STRUGGLE_CAP));
  let allowed = Math.floor(base * factor);
  allowed = Math.min(allowed, unseenCount);
  allowed = Math.max(0, Math.min(allowed, base));
  const used = Math.min(newTodayUsed || 0, allowed);
  return { allowed, used };
}
/* ========= Views ========= */
function renderTestShell(){
  const wrap=document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Test Mode</h1>
    <section class="card card--center"><div id="test-container"></div></section>`;
  return wrap;
}
function renderSettings(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Settings</h1>`;

  const sub = document.createElement('h2');
  sub.className = 'h2';
  sub.textContent = 'Deck Options';
  wrap.appendChild(sub);

  const list = document.createElement('div');
  list.className = 'row';
  DECKS.forEach(d => {
    const prog = loadProgress(d.id);
    const count = Object.keys(prog.seen || {}).length;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.minWidth = '260px';
    card.innerHTML = `
      <div style="font-weight:700">${d.name}</div>
      <div class="muted">${count} active</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn">Set Active</button>
        <a class="btn" href="#/review?mode=quiz&deck=${d.id}">Review</a>
      </div>`;
    card.querySelector('button').addEventListener('click', () => setActiveDeck(d.id));
    list.appendChild(card);
  });
  wrap.appendChild(list);
  return wrap;
}

async function renderLearned(){
  const dk = deckKeyFromState();
  const deckId = dk;
  const rows = await loadDeckRows(deckId);
  const prog = loadProgress(deckId);
  const attempts = loadAttemptsMap();
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length));

  const data = activeRows.map(r=>{
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = acc >= 80 ? 'Mastered' : 'Needs review';
    const tries = (attempts[r.id]||[]).length;
    return { ...r, acc, status, tries };
  });

  const wrap=document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Learned Phrases</h1>`;

  // Build dropdown of unique tags from learned phrases
  const tagSet = Array.from(new Set(data.map(r=>r.tags).filter(Boolean))).sort();
  if(tagSet.length){
    const filter=document.createElement('div');
    filter.className='filter-bar';
    const opts = tagSet.map(t=>`<option value="${escapeHTML(t)}">${escapeHTML(t.charAt(0).toUpperCase()+t.slice(1))}</option>`).join('');
    filter.innerHTML=`<label for="tagFilter">Category:</label> <select id="tagFilter" class="deck-select"><option value="">All</option>${opts}</select>`;
    wrap.appendChild(filter);
  }

  const table=document.createElement('table');
  table.className='phrase-table';
  table.innerHTML=`<thead><tr>
    <th>Phrase (Welsh)</th>
    <th>Meaning (English)</th>
    <th>Status</th>
    <th>Accuracy</th>
    <th>Last attempts</th>
    <th>Tags</th>
    <th>Actions</th>
  </tr></thead><tbody></tbody>`;
  const tbody=table.querySelector('tbody');

  function renderRows(){
    const sel = wrap.querySelector('#tagFilter');
    const tag = sel ? sel.value : '';
    tbody.innerHTML='';
    const rows = tag ? data.filter(r => (r.tags||'').split(/\s*,\s*/).includes(tag)) : data;
    rows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td data-label="Phrase (Welsh)">${escapeHTML(r.front)}</td>
        <td data-label="Meaning (English)">${escapeHTML(r.back)}</td>
        <td data-label="Status">${r.status}</td>
        <td data-label="Accuracy"><div class="progress"><i style="--w:${r.acc}%"></i></div> ${r.acc}%</td>
        <td data-label="Last attempts">${r.tries}</td>
        <td data-label="Tags">${escapeHTML(r.tags)}</td>
        <td data-label="Actions" class="actions"><a class="btn" href="#/review?card=${encodeURIComponent(r.id)}">Study</a> <a class="btn" href="#/test?card=${encodeURIComponent(r.id)}">Test</a></td>`;
      tbody.appendChild(tr);
    });
  }

  const selectEl = wrap.querySelector('#tagFilter');
  if(selectEl) selectEl.addEventListener('change', renderRows);
  renderRows();

  wrap.appendChild(table);
  return wrap;
}
function renderPlaceholder(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1>`;return div;};
}

function renderComingSoon(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1><p>Coming soon</p>`;return div;};
}

function go(route){
  const [cur] = parseHash();
  if (cur === route) {
    render(); // force re-render when same route
  } else {
    location.hash = '#/' + route;
  }
}



/* ========= Mode selection dashboard ========= */
async function renderHome(){
  const wrap=document.createElement('div');
  wrap.innerHTML=`
    <div class="duo-layout">
      <section class="skills-wrap">
        <div class="skills-grid grid-3">
          <a class="skill" data-target="phrases" href="#/phrases">
            <div class="bubble"><img class="icon" src="media/icons/Phrases.png" alt="Phrases icon"></div>
            <div class="label">Phrases</div>
            <div class="sub">Start</div>
          </a>
          <a class="skill" data-target="words" href="#/words">
            <div class="bubble"><img class="icon" src="media/icons/Words.png" alt="Words icon"></div>
            <div class="label">Words</div>
            <div class="sub">Start</div>
          </a>
          <a class="skill" data-target="songs" href="#/songs">
            <div class="bubble"><img class="icon" src="media/icons/Songs.png" alt="Songs icon"></div>
            <div class="label">Songs</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="stories" href="#/stories">
            <div class="bubble"><img class="icon" src="media/icons/Stories.png" alt="Stories icon"></div>
            <div class="label">Stories</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="conversations" href="#/conversations">
            <div class="bubble"><img class="icon" src="media/icons/Conversations.png" alt="Conversations icon"></div>
            <div class="label">Conversations</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="challenges" href="#/challenges">
            <div class="bubble"><img class="icon" src="media/icons/Challenges.png" alt="Challenges icon"></div>
            <div class="label">Challenges</div>
            <div class="sub">Coming soon</div>
          </a>
        </div>
      </section>
      <aside class="sidebar">
        <div class="panel-white stat-card" id="stat-phrases">
          <div class="panel-title">Phrases</div>
          <div class="ring" id="homePhraseRing"><span id="homePhraseRingTxt">0%</span></div>
          <div class="list">
            <div><span class="k">Today</span> · <span class="v" id="homePhraseToday">0/0</span></div>
            <div><span class="k">Deck progress</span> · <span class="v" id="homePhraseProgLabel">0%</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Words</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Songs</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Stories</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Conversations</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Challenges</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
      </aside>
    </div>
  `;
  wrap.querySelectorAll('.skill').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.target);}));

  // phrase stats
  const dk = deckKeyFromState();
  const deckId = dk;
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const rows  = await loadDeckRows(deckId);
  const learned = Object.keys(prog.seen || {}).length;
  const deckPct = rows.length ? Math.round((learned/rows.length)*100) : 0;

  const daily = JSON.parse(localStorage.getItem(dailyKey) || '{}');
  const allowed = daily.allowed || 0;
  const used    = daily.used    || 0;
  const pct     = allowed ? Math.round((used/allowed)*100) : 0;

  wrap.querySelector('#homePhraseRing').style.setProperty('--pct', pct + '%');
  wrap.querySelector('#homePhraseRingTxt').textContent = pct + '%';
  wrap.querySelector('#homePhraseToday').textContent = `${used}/${allowed}`;
  wrap.querySelector('#homePhraseProgLabel').textContent = `${deckPct}%`;

  return wrap;
}

async function renderWordsDashboard(){
  const tabs=[
    {key:'days',label:'Days',icon:'Days'},
    {key:'months',label:'Months',icon:'Months'},
    {key:'numbers',label:'Numbers',icon:'Numbers'},
    {key:'colours',label:'Colours',icon:'Colours'},
    {key:'animals',label:'Animals',icon:'Animals'}
  ];
  const wrap=document.createElement('div');
  wrap.innerHTML=`
    <div class="duo-layout">
      <section>
        <h1 class="h1">Words</h1>
        <div class="skills-wrap">
          <div class="skills-grid grid-3">
            ${tabs.map(t=>`
              <a class="skill" href="#/words?tab=${t.key}">
                <div class="bubble"><img class="icon" src="media/icons/${t.icon}.png" alt="${t.label} icon"></div>
                <div class="label">${t.label}</div>
                <div class="sub">Coming soon</div>
              </a>`).join('')}
          </div>
        </div>
      </section>
      <aside class="sidebar">
        ${tabs.map(t=>`
        <div class="panel-white stat-card">
          <div class="panel-title">${t.label}</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>`).join('')}
      </aside>
    </div>
  `;
  return wrap;
}

/* ========= Dashboard (Duolingo-style) ========= */
async function renderPhraseDashboard(){
  const dk = deckKeyFromState();
  const deckId = dk;
  const active = DECKS.find(d=>d.id===deckId);
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const attempts = JSON.parse(localStorage.getItem(attemptsKey) || '{}');

  // data
  const rows = await loadDeckRows(deckId);
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const unseenRows = rows.filter(r=>!seen[r.id] && !(attempts[r.id] && attempts[r.id].length > 0));
  const unseenCount = unseenRows.length;

  const enriched = activeRows.map(r=>{
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = categoryFromPct(acc);
    return { ...r, acc, status };
  });
  const strugglingCount = enriched.filter(x=>x.status==='Struggling').length;
  const reviewDue       = await fcGetTestQueueCount();
  const quizToday       = Math.min(reviewDue, SESSION_MAX);
  const quizQueued      = Math.max(reviewDue - SESSION_MAX, 0);

  // new phrases allowance
  const daily = loadNewDaily(deckId);
  const today = todayKey();
  const usedToday = daily.date === today ? (daily.used || 0) : 0;
  const updated = getDailyNewAllowance(unseenCount, usedToday, strugglingCount);
  const newTodayAllowed = updated.allowed || 0;
  const used = updated.used || 0;
  saveNewDaily(deckId, { date: today, allowed: newTodayAllowed, used });
  const newToday = Math.max(0, newTodayAllowed - used);

  let bannerText = '';
  if (newTodayAllowed < SETTINGS.newPerDay && newTodayAllowed > 0) {
    bannerText = 'New phrases reduced';
  } else if (newTodayAllowed === 0 && strugglingCount >= STRUGGLE_CAP) {
    bannerText = 'New phrases paused';
  }

  const quizCount = quizToday;
  const learned   = Object.keys(seen).length;
  const deckPct   = rows.length ? Math.round((learned/rows.length)*100) : 0;

  // UI
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="duo-layout">
      <section>
        <h1 class="h1">Dashboard</h1>
        <div class="muted" style="margin:-6px 0 18px">
          Deck: <strong>${active.name}</strong> · Day <span id="day-count">1</span>
        </div>

        <div class="skills-wrap">
        ${bannerText ? '<div class="practice-banner">' + bannerText + '</div>' : ''}
        <div class="skills-grid grid-2">
          <a class="skill" id="sk-new">
            <div class="bubble">
              <img class="icon" src="media/icons/New%20Phrases.png" alt="New Phrases icon">
              <div class="badge" id="b-new">0</div>
            </div>
            <div class="label">New Phrases</div>
            <div class="sub">Start today</div>
          </a>

          <a class="skill" id="sk-review">
            <div class="bubble">
              <img class="icon" src="media/icons/Flashcards.png" alt="Flashcards icon">
              <div class="badge" id="b-review">0</div>
            </div>
            <div class="label">Flashcards</div>
            <div class="sub">SRS review</div>
          </a>

          <a class="skill" id="sk-quiz">
            <div class="bubble">
              <img class="icon" src="media/icons/Quiz.png" alt="Quiz icon">
              <div class="badge" id="b-quiz">0</div>
            </div>
            <div class="label">Quiz</div>
            <div class="sub">Multiple choice / type <span class="queued-pill hidden" id="quizQueued"></span></div>
          </a>

          <a class="skill" id="sk-all">
            <div class="bubble">
              <img class="icon" src="media/icons/Play%20All.png" alt="Play All icon">
            </div>
            <div class="label">Play All</div>
            <div class="sub">Run modules</div>
          </a>
        </div>
        </div>
      </section>

      <aside class="sidebar">
        <div class="panel-white">
          <div class="panel-title">Daily target</div>
          <div class="ring" id="dailyRing"><span id="ringTxt">0%</span></div>
          <div class="list">
            <div><span class="k">Today</span> · <span class="v" id="dailyLabel">0/0</span></div>
            <div><span class="k">Streak</span> · <span class="v" id="streakNum">–</span></div>
            <div><span class="k">Words learned</span> · <span class="v" id="wordsLearned">–</span></div>
            <div><span class="k">Deck progress</span> · <span class="v" id="deckProg">–</span></div>
          </div>
        </div>

        <div class="panel-white">
          <div class="panel-title">Progress</div>
          <div class="progress" id="xpBar"><i></i></div>
        </div>
      </aside>
    </div>
  `;

  // counts
  wrap.querySelector('#b-new').textContent    = newToday;
  wrap.querySelector('#b-review').textContent = reviewDue;
  wrap.querySelector('#b-quiz').textContent   = quizCount;
  if (quizQueued > 0) {
    const qp = wrap.querySelector('#quizQueued');
    qp.textContent = `+${quizQueued} queued`;
    qp.classList.remove('hidden');
  }
  wrap.querySelector('#day-count').textContent = getDayNumber();

  // daily ring
  const pct = newTodayAllowed ? Math.round((used/newTodayAllowed)*100) : 0;
  wrap.querySelector('#dailyRing').style.setProperty('--pct', pct + '%');
  wrap.querySelector('#ringTxt').textContent = pct + '%';
  wrap.querySelector('#dailyLabel').textContent = `${used}/${newTodayAllowed}`;
  wrap.querySelector('#wordsLearned').textContent = learned;
  wrap.querySelector('#deckProg').textContent = `${deckPct}%`;

  // progress bar (use deck progress)
  wrap.querySelector('#xpBar').style.setProperty('--w', deckPct + '%');

  // actions
  wrap.querySelector('#sk-new').addEventListener('click', () => go('newPhrase'));
  wrap.querySelector('#sk-review').addEventListener('click', () => go('review'));
  wrap.querySelector('#sk-quiz').addEventListener('click', () => go('test'));
  wrap.querySelector('#sk-all').addEventListener('click', () => window.runAllDaily && window.runAllDaily());

  return wrap;
}



window.addEventListener('fc:progress-updated', () => {
  updateStatusPills();
  if (location.hash === '#/phrases') {
    const view = document.getElementById('view');
    renderPhraseDashboard().then(el => view.replaceChildren(el));
  }
});

window.addEventListener('visibilitychange', () => {
  if (!document.hidden && location.hash === '#/phrases') {
    const view = document.getElementById('view');
    renderPhraseDashboard().then(el => view.replaceChildren(el));
  }
});

/* ---------- stat tint helper ---------- */
function colorStatCard(el,pct=50){
  const hue=accuracyHue(pct);
  el.style.boxShadow=`0 0 0 1px rgba(255,255,255,0.06), 0 0 0 3px hsl(${hue} 70% 25% / .25) inset`;
}

/* --- Run All (sequential modules) --- */
(function(){
  let step = 0; // 0=new, 1=review, 2=test
  function onComplete(e){
    const m = e.detail && e.detail.module;
    if (step === 0 && m === 'new'){ step = 1; go('review'); return; }
    if (step === 1 && m === 'review'){ step = 2; go('test'); return; }
    if (step === 2 && m === 'test'){
      step = 0;
      window.removeEventListener('fc:module-complete', onComplete);
      go('phrases');
    }
  }
  window.runAllDaily = function(){
    step = 0;
    window.addEventListener('fc:module-complete', onComplete);
    go('newPhrase');
  };
})();


/* ---------- Boot ---------- */
window.addEventListener('DOMContentLoaded',()=>{
  tickDay();
  document.querySelectorAll('.day-display').forEach(el => {
    el.textContent = getDayNumber();
  });
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange',render);
