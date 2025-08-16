(function(){
/* ===========================
   newPhrase.js — Teaching flow with behaviour awareness
   - Welsh → audio (normal/slow/normal)
   - Meaning & breakdown → usage/related
   - Typing drill: 2× copy, 1× blind
   - Behaviour classifier: thinking / fast guess / idle
   - Idle doesn’t penalise; re-queue later in session
   - Blur pauses timers; 120s hard timeout → “Resume / Skip”
   =========================== */

/* ---------- Deck + storage keys (same mapping as before) ---------- */
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
const attemptsKey = 'tm_attempts_v1';          // global attempts bucket (unchanged, not used here but reserved)

/* Event ping so other modules can react */
function fireProgressEvent(payload){
  window.dispatchEvent(new CustomEvent('fc:progress-updated', { detail: payload || {} }));
}

/* Migrate old progress key if needed (kept from your file) */
(function migrateProgressIfNeeded(){
  const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
  if (legacy !== progressKey) {
    const legacyVal = localStorage.getItem(legacy);
    if (legacyVal && !localStorage.getItem(progressKey)) {
      localStorage.setItem(progressKey, legacyVal);
    }
  }
})();

/* ---------- Small utils ---------- */
const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function normalizeInput(s){
  if(!s) return '';
  let out = s.toLowerCase();
  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g,''); // strip accents (tolerant)
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

/* prevent global hotkeys from stealing Enter inside inputs */
window.addEventListener('keydown', e => {
  if(e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)){
    e.stopPropagation();
  }
}, true);

/* ---------- Behaviour metrics (local, lightweight) ---------- */
const THINK_MIN = 6;      // s
const THINK_MAX = 45;     // s
const LONG_THINK = 120;   // s (hard timeout)
const IDLE_NO_TYPE = 60;  // s (dwell >60s with <2s typing → idle)
const BLUR_PAUSE_MS = 3000;

function makeBehaviourTracker(rootEl, { onNudge } = {}){
  let startTs = 0;
  let typingMs = 0;
  let lastKeyTs = 0;
  let keyCount = 0;
  let backspaceCount = 0;
  let hints = 0;
  let audioPlays = 0;
  let blurredMs = 0;
  let blurStart = 0;
  let paused = false;
  let nudgeTimer = null;

  function now(){ return performance.now(); }

  function begin(){
    startTs = now();
    typingMs = 0; lastKeyTs = 0; keyCount = 0; backspaceCount = 0;
    hints = 0; audioPlays = 0; blurredMs = 0; blurStart = 0; paused = false;
    clearTimeout(nudgeTimer);
    // soft nudge at 45s if still active and no submit yet
    nudgeTimer = setTimeout(()=>{ onNudge && onNudge(); }, THINK_MAX*1000);
  }

  function onKey(e){
    const t = now();
    // crude “active typing” metric: add elapsed since lastKey, capped
    if (lastKeyTs) typingMs += Math.min(1000, t - lastKeyTs);
    lastKeyTs = t;
    keyCount++;
    if (e.key === 'Backspace') backspaceCount++;
  }

  function onHint(){ hints++; }
  function onAudio(){ audioPlays++; }

  function onBlur(){
    blurStart = Date.now();
    paused = true;
  }
  function onFocus(){
    if(blurStart){
      const delta = Date.now() - blurStart;
      if(delta > BLUR_PAUSE_MS) blurredMs += delta;
    }
    blurStart = 0;
    paused = false;
  }

  function end(){
    clearTimeout(nudgeTimer);
    const totalMs = Math.max(0, (now() - startTs));
    return {
      dwellSec: Math.round(totalMs/100)/10,
      typingSec: Math.round(typingMs/100)/10,
      keystrokes: keyCount,
      backspaceRatio: keyCount ? backspaceCount / keyCount : 0,
      hints,
      audioPlays,
      blurredMs,
      paused
    };
  }

  function classify(){
    const m = end(); // snapshot without clearing
    const dwell = m.dwellSec;
    const typing = m.typingSec;

    // Hard timeout state (very long dwell)
    if (dwell >= LONG_THINK) return { kind: 'idle', meta: m };

    // If app/tab lost focus significantly → idle
    if (m.blurredMs > BLUR_PAUSE_MS) return { kind: 'idle', meta: m };

    // Very little typing + long dwell → idle
    if (dwell > IDLE_NO_TYPE && typing < 2) return { kind: 'idle', meta: m };

    // Fast/guessy
    if (dwell < THINK_MIN && typing < 2 && m.hints === 0 && m.audioPlays === 0)
      return { kind: 'fast', meta: m };

    // Deep thinking window
    if ((dwell > THINK_MAX && dwell < LONG_THINK) && typing >= 5)
      return { kind: 'deep', meta: m };

    // Default engaged thinking
    if (dwell >= THINK_MIN && dwell <= LONG_THINK && typing >= 3)
      return { kind: 'thinking', meta: m };

    // Fallback: engaged if any typing happened
    return { kind: typing > 0 ? 'thinking' : 'fast', meta: m };
  }

  // wire up blur/focus at document level once
  const onVis = () => { if (document.hidden) onBlur(); else onFocus(); };
  document.addEventListener('visibilitychange', onVis);

  return {
    begin, end, classify, onKey, onHint, onAudio,
    pause: onBlur, resume: onFocus
  };
}

/* ---------- Progress helpers (same semantics you use) ---------- */
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
  return (daily.used || 0) < (daily.allowed || 0);
}

/* ---------- Compute “all mastered” using your attempts → accuracy window ---------- */
const SCORE_WINDOW = 10; // same window as test mode selection
function loadAttemptsMap(){
  try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}'); }
  catch { return {}; }
}
function lastNAccuracy(cardId, n = SCORE_WINDOW, map = loadAttemptsMap()){
  const raw = map[cardId] || [];
  const scored = raw.filter(a => a.score !== false);
  const arr = scored.slice(-n);
  if (!arr.length) return 0;
  const p = arr.filter(a => a.pass).length;
  return Math.round((p / arr.length) * 100);
}
function categoryFromPct(p){
  if (p >= 85) return 'Mastered';
  if (p >= 60) return 'Strong';
  if (p >= 40) return 'Developing';
  return 'Struggling';
}
function computeAllMastered(deckId, prog){
  const attempts = loadAttemptsMap();
  const ids = Object.keys(prog.seen || {});
  if(!ids.length) return true;
  return ids.every(id => categoryFromPct(lastNAccuracy(id, SCORE_WINDOW, attempts)) === 'Mastered');
}

/* ---------- Optional: push to GitHub if token+repo present ---------- */
async function syncProgressToGitHub(deckId, prog){
  const token = localStorage.getItem('gh_token');
  const repo  = localStorage.getItem('gh_repo'); // owner/repo
  if(!token || !repo) return;
  const path = `progress_${deckId}.json`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(prog))));
  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method:'PUT',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({message:`Update ${path}`, content})
  }).catch(()=>{});
}

/* ---------- Audio helpers ---------- */
let audioEl=null;
function stopAudio(){
  if(window.fcAudio) window.fcAudio.stop();
  audioEl=null;
}
function playAudio(src,rate=1){
  if(!src) return;
  audioEl = window.fcAudio ? window.fcAudio.play(src,rate) : null;
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
async function playSequence(src, tracker){
  await playOne(src,1.0); tracker && tracker.onAudio();
  await playOne(src,0.6); tracker && tracker.onAudio();
  await playOne(src,1.0); tracker && tracker.onAudio();
}

/* ---------- Steps ---------- */
const STEPS={ WELSH:0,MEANING:1,CONTEXT:2,DRILL1:3,DRILL2:4,DRILL3:5, TIMEOUT: 6 };

let viewEl=null;
let deckRows=[];  // full deck rows
let queue=[];     // today’s new items (unseen)
let idx=0;        // index in queue
let step=STEPS.WELSH;
let allMastered=true;
let tracker=null; // behaviour tracker instance

function routeName(){
  const raw=location.hash.startsWith('#/')?location.hash.slice(2):'home';
  return (raw.split('?')[0]||'home');
}

/* ---------- Render host ---------- */
async function renderNewPhrase(){
  const host=document.createElement('div');
  host.innerHTML=`<h1 class="h1">New Words</h1>
    <div class="muted" id="np-day-wrap">Day <span id="np-day">1</span></div>
    <section class="card card--center"><div id="np-root" class="flashcard"></div></section>`;
  viewEl=host.querySelector('#np-root');
  host.querySelector('#np-day').textContent=getDayNumber?.() || '—';

  // migrate daily key variant if necessary (kept)
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
    deckRows = await loadDeckRows(dk);
    const prog = loadProgress(dk);
    const attempts = loadAttemptsMap();
    const seenIds = new Set(Object.keys(prog.seen || {}));
    allMastered = computeAllMastered(dk, prog);

    const today = (new Date()).toISOString().slice(0, 10);

    // Clean stale half-started items (seenCount=0 from past days)
    {
      const p = prog.seen || {};
      let changed = false;
      for (const [id, s] of Object.entries(p)) {
        if ((s.seenCount || 0) === 0 && s.firstSeen && s.firstSeen < today) {
          delete p[id];
          changed = true;
        }
      }
      if (changed) {
        prog.seen = p;
        localStorage.setItem(progressKey, JSON.stringify(prog));
        window.fcSaveCloud && window.fcSaveCloud();
      }
    }

    // Unseen list in course order
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

    // Daily allowance
    const prev = loadNewDaily(dk);
    const dayKey = todayKey();
    const usedToday = prev.date === dayKey ? (prev.used || 0) : 0;
    const daily = getDailyNewAllowance(unseenCards.length, usedToday, 0);
    saveNewDaily(dk, { date: dayKey, ...daily });
    queue = unseenCards.slice(0, Math.max(0, (daily.allowed || 0) - (daily.used || 0)));

    idx = 0; step = STEPS.WELSH;
    if (queue.length) render(); else renderEmpty();
  } catch(e){
    console.error(e);
    viewEl.innerHTML=`<div class="muted">Failed to load data.</div>`;
  }

  return host;
}

function current(){ return queue[idx]; }

/* ---------- Core renderer with behaviour tracking ---------- */
function render(){
  stopAudio();
  const c=current();
  if(!c){ renderEmpty(); return; }

  // new tracker per step
  tracker = makeBehaviourTracker(viewEl, {
    onNudge: () => showNudge()
  });
  tracker.begin();

  const img = c.image
    ? `<img src="${c.image}" alt="${escapeHTML(c.front)}" style="width:100%; border-radius:16px;">`
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

    playBtn.addEventListener('click',()=>{ playAudio(c.audio,1.0); tracker.onAudio(); });
    slowBtn.addEventListener('click',()=>{ playAudio(c.audio,0.6); tracker.onAudio(); });

    nextBtn.addEventListener('click',()=>{
      step=STEPS.MEANING; render();
    });

    (async()=>{ await playSequence(c.audio, tracker); playBtn.disabled=false; slowBtn.disabled=false; })();
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
    viewEl.querySelector('#np-next').addEventListener('click',()=>{ step=STEPS.CONTEXT; render(); });
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
    viewEl.querySelector('#np-start-drill').addEventListener('click',()=>{ step=STEPS.DRILL1; render(); });
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
      <div class="flashcard-actions" style="gap:8px;">
        <button class="btn ghost" id="np-hint" title="Show first letters">Show hint</button>
        <button class="btn nav-btn" id="np-submit">Submit</button>
      </div>
      <div class="flashcard-progress muted">Press Enter to submit</div>`;
    const inp=viewEl.querySelector('#np-typed');

    // typing & hint tracking
    inp.addEventListener('keydown', (e)=> tracker.onKey(e));
    viewEl.querySelector('#np-hint').addEventListener('click', ()=>{
      tracker.onHint();
      const rev = (c.front||'').slice(0, Math.min(2, (c.front||'').length)) + '…';
      showHint(rev);
    });

    viewEl.querySelector('#np-submit').addEventListener('click',()=>{
      const behaviour = tracker.classify();
      if(behaviour.kind === 'idle') return renderTimeoutCard(() => render()); // no penalty, let them resume
      const ok=equalsLoose(inp.value||'', c.front);
      if(ok){
        step = (step===STEPS.DRILL1?STEPS.DRILL2:STEPS.DRILL3);
        render();
      } else {
        showIncorrect(inp.value||'', ()=>render());
      }
    });
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        viewEl.querySelector('#np-submit').click();
      }
    });
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
      <div class="flashcard-actions" style="gap:8px;">
        <button class="btn ghost" id="np-hint" title="Show first letters">Show hint</button>
        <button class="btn nav-btn" id="np-submit">Submit</button>
      </div>
      <div class="flashcard-progress muted">Press Enter to submit</div>`;
    const inp=viewEl.querySelector('#np-typed');

    // track typing & hints
    inp.addEventListener('keydown', (e)=> tracker.onKey(e));
    viewEl.querySelector('#np-hint').addEventListener('click', ()=>{
      tracker.onHint();
      const rev = (c.front||'').slice(0, Math.min(2, (c.front||'').length)) + '…';
      showHint(rev);
    });

    viewEl.querySelector('#np-submit').addEventListener('click',()=>{
      const behaviour = tracker.classify();
      if(behaviour.kind === 'idle') return renderTimeoutCard(() => render()); // idle → no penalty
      const ok=equalsLoose(inp.value||'', c.front);
      if(ok){
        markSeenNow(c.id);
        bumpDailyUsed();
        tickDay && tickDay();
        fireProgressEvent({ type: 'introduced', id: c.id });

        // cloud sync if configured
        const prog = loadProgress(dk);
        syncProgressToGitHub(dk, prog);
        initDeckPicker && initDeckPicker();

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
        allMastered = computeAllMastered(dk, prog);
      } else {
        showIncorrect(inp.value||'', ()=>render());
      }
    });
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); viewEl.querySelector('#np-submit').click(); }
    });
    inp.focus();
    return;
  }
}

/* ---------- Empty / unlock ---------- */
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

/* ---------- Result helpers ---------- */
function showIncorrect(userTyped,onRetry){
  const c=current();
  viewEl.innerHTML=`
    <div class="tm-result tm-fail">✖ Incorrect</div>
    <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
    <div class="tm-mismatch" style="margin-top:8px;">
      <div class="tm-label">Your answer</div>
      <div class="tm-ansbox">${escapeHTML(userTyped||'—')}</div>
    </div>
    <div class="flashcard-actions" style="gap:8px;">
      <button class="btn ghost" id="np-replay">🔊 Replay audio</button>
      <button class="btn red" id="np-retry">Try again</button>
    </div>`;
  viewEl.querySelector('#np-replay').addEventListener('click',()=>playAudio(current().audio,1.0));
  viewEl.querySelector('#np-retry').addEventListener('click',onRetry);
}
function showHint(text){
  // lightweight inline hint
  let el = viewEl.querySelector('.np-hint');
  if(!el){
    el = document.createElement('div');
    el.className = 'np-hint muted';
    el.style.marginTop = '6px';
    viewEl.appendChild(el);
  }
  el.innerHTML = `Hint: <strong>${escapeHTML(text)}</strong>`;
}

/* ---------- Idle/timeout card ---------- */
function renderTimeoutCard(onResume){
  const c=current();
  viewEl.innerHTML = `
    <div class="flashcard">
      <div class="term">${escapeHTML(c.front)}</div>
      <div class="tm-label" style="margin-top:6px;">Paused — take a breath and resume when ready.</div>
      <div class="flashcard-actions" style="gap:8px;">
        <button class="btn nav-btn" id="np-resume">Resume</button>
        <button class="btn link danger" id="np-skip">Skip for now</button>
      </div>
      <div class="flashcard-progress muted">No penalty for pausing</div>
    </div>`;
  viewEl.querySelector('#np-resume').addEventListener('click', onResume);
  viewEl.querySelector('#np-skip').addEventListener('click', ()=>{
    // push this card to end of today’s queue
    const item = queue.splice(idx,1)[0];
    queue.push(item);
    step = STEPS.WELSH;
    render();
  });
}

/* ---------- Unlock next ---------- */
async function unlockNext(){
  const prog = loadProgress(dk); if(!prog.seen) prog.seen={};
  const active=new Set(Object.keys(prog.seen));
  const next=deckRows.find(r=>!active.has(r.id));
  if(!next){
    viewEl.innerHTML=`<div class="flashcard-progress muted">All phrases unlocked.</div>`;
    return;
  }
  queue.push(next); idx=queue.length-1; step=STEPS.WELSH; render();
  allMastered = computeAllMastered(dk, prog);
}

/* ---------- Boot & route wire-up ---------- */
window.renderNewPhrase = renderNewPhrase;
if (location.hash.startsWith('#/newPhrase') && typeof window.render === 'function') {
  window.render();
}

/* ---------- Styles ---------- */
const style=document.createElement('style');
style.textContent=`
  .tm-result{ text-align:center; font-weight:800; margin-top:4px; }
  .tm-fail{ color:#ff6b6b; }
  .tm-correct{ color:#3bd16f; }
  .tm-label{ font-size:12px; color: var(--muted); text-align:center; }
  .tm-ansbox{ border:1px dashed var(--border); border-radius:10px; padding:8px 10px; margin-top:4px; background:rgba(255,255,255,0.02); }
  .tm-audio{ display:flex; justify-content:center; }
  .chip{ display:inline-block; border:1px solid var(--border); background:var(--panel); border-radius:999px; padding:4px 10px; font-size:12px; color:var(--text); margin:2px; }
  .np-hint{ font-size:13px; }
`;
document.head.appendChild(style);

})();
