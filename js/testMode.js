(function(){
  /* ===========================
     testMode.js — Quiz/Review with behaviour awareness
     - English → type Welsh (active recall)
     - Behaviour classifier: thinking / fast guess / idle
     - Session cap + struggling-first queue
     - Re-teach loop on miss (2× copy + 1–2× blind)
     - Practice mode (no scoring)
     =========================== */

  /* ---------- Config (matches your policy) ---------- */
  const SESSION_MAX       = 15;       // max questions in a test session
  const STRUGGLE_CAP_INFO = { gate: 10 }; // for banner only; new is gated elsewhere
  const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // do not count another "pass" within 1h
  const SCORE_WINDOW      = 10;       // last-N window for confidence/accuracy

  // Behaviour thresholds
  const THINK_MIN_S     = 6;
  const THINK_MAX_S     = 45;     // nudge at this time
  const LONG_THINK_S    = 120;    // hard timeout → idle
  const IDLE_NO_TYPE_S  = 60;     // long dwell but almost no typing
  const BLUR_PAUSE_MS   = 3000;

  /* ---------- Deck + storage keys ---------- */
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
  const progressKey = 'progress_' + dk;          // read/write here (seen/intro)
  const attemptsKey = 'tm_attempts_v1';          // attempts history (global)
  const SESSION_KEY = 'tm_session';              // transient "done" list per session

  function fireProgressEvent(detail){ window.dispatchEvent(new CustomEvent('fc:progress-updated',{ detail: detail || {} })); }

  // migrate progress if old key format existed
  (function migrateProgressIfNeeded(){
    const legacy = 'progress_' + ((window.STATE && STATE.activeDeckId) || '');
    if (legacy !== progressKey) {
      const legacyVal = localStorage.getItem(legacy);
      if (legacyVal && !localStorage.getItem(progressKey)) {
        localStorage.setItem(progressKey, legacyVal);
      }
    }
  })();

  /* ---------- Utilities ---------- */
  const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function focusField(sel){ const el = container?.querySelector(sel); if(el){ el.focus(); el.select?.(); } }

  // Prevent global hotkeys inside inputs
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.matches('input,textarea') || e.target.isContentEditable)) e.stopPropagation();
  }, true);

  // Text normalisation (accent/space tolerant) + near-match
  function normalize(s){
    return (s||'').toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[\u2019\u2018]/g,"'")
      .replace(/[\u201C\u201D]/g,'"')
      .replace(/\u2026/g,'...')
      .replace(/[\u2013\u2014]/g,'-')
      .replace(/[.,!?;:"'()\-]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
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
    const x=normalize(a), y=normalize(b);
    if(x===y) return true;
    const dist=levenshtein(x,y);
    const tol=Math.max(1,Math.floor(Math.max(x.length,y.length)/8));
    return dist<=tol;
  }

  /* ---------- Behaviour tracker (per card) ---------- */
  function makeBehaviourTracker() {
    let start=0, typingMs=0, lastKey=0, keystrokes=0, backspaces=0, hints=0, audio=0, blurredMs=0, blurStart=0;
    let nudgeTimer=null;

    function now(){ return performance.now(); }
    function begin(){
      start = now(); typingMs=0; lastKey=0; keystrokes=0; backspaces=0; hints=0; audio=0; blurredMs=0; blurStart=0;
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(()=>{ showNudge(); }, THINK_MAX_S*1000);
    }
    function onKey(e){
      const t=now();
      if(lastKey) typingMs += Math.min(1000, t-lastKey);
      lastKey=t;
      keystrokes++; if(e.key==='Backspace') backspaces++;
    }
    function onHint(){ hints++; }
    function onBlur(){ blurStart = Date.now(); }
    function onFocus(){ if(blurStart){ const d=Date.now()-blurStart; if(d>BLUR_PAUSE_MS) blurredMs += d; } blurStart=0; }
    function end(){
      clearTimeout(nudgeTimer);
      const dwellSec = (now()-start)/1000;
      return {
        dwellSec,
        typingSec: typingMs/1000,
        keystrokes,
        backspaceRatio: keystrokes ? backspaces/keystrokes : 0,
        hints,
        audioPlays: audio,
        blurredMs
      };
    }
    function classify(){
      const m=end(); const dwell=m.dwellSec, typing=m.typingSec;
      if (dwell >= LONG_THINK_S) return { kind:'idle', meta:m };
      if (m.blurredMs > BLUR_PAUSE_MS) return { kind:'idle', meta:m };
      if (dwell > IDLE_NO_TYPE_S && typing < 2) return { kind:'idle', meta:m };
      if (dwell < THINK_MIN_S && typing < 2 && m.hints===0) return { kind:'fast', meta:m };
      if ((dwell > THINK_MAX_S && dwell < LONG_THINK_S) && typing >= 5) return { kind:'deep', meta:m };
      if (dwell >= THINK_MIN_S && typing >= 3) return { kind:'thinking', meta:m };
      return { kind: typing>0 ? 'thinking' : 'fast', meta:m };
    }
    document.addEventListener('visibilitychange', ()=>{ if(document.hidden) onBlur(); else onFocus(); });
    return { begin, onKey, onHint, classify };
  }

  /* ---------- Attempts history ---------- */
  function loadAttempts(){
    try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}'); }
    catch { return {}; }
  }
  function saveAttempts(map){ localStorage.setItem(attemptsKey, JSON.stringify(map)); window.fcSaveCloud && window.fcSaveCloud(); }

  // Log an attempt with optional behaviour + scoring control
  // meta: { behaviour: 'thinking'|'fast'|'idle'|'deep', forceNoScore?:boolean }
  function logAttempt(cardId, pass, meta){
    const obj = loadAttempts();
    const arr = obj[cardId] || [];
    const now = Date.now();

    // Decide if this pass should count towards accuracy window
    let score = true;
    const forceNoScore = meta && meta.forceNoScore;
    if (forceNoScore) {
      score = false;
    } else if (pass) {
      // enforce 1h cooldown between counted passes
      for (let i = arr.length - 1; i >= 0; i--) {
        const a = arr[i];
        if (a.pass && a.score !== false) {
          if (now - a.ts < SCORE_COOLDOWN_MS) score = false;
          break;
        }
      }
      // If behaviour looked like a fast guess, don't score it
      if (meta && meta.behaviour === 'fast') score = false;
    }

    arr.push({ ts: now, pass: !!pass, score, beh: meta?.behaviour || null });
    obj[cardId] = arr;
    saveAttempts(obj);
    return score;
  }

  function lastNAccuracy(cardId, n=SCORE_WINDOW, map=loadAttempts()){
    const raw = map[cardId] || [];
    const scored = raw.filter(a => a.score !== false);
    const arr = scored.slice(-n);
    if (!arr.length) return 0;
    const p = arr.filter(a => a.pass).length;
    return Math.round((p/arr.length)*100);
  }

  /* ---------- Progress / seen ---------- */
  function loadProgressSeen(){
    try { return (JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}').seen) || {}; }
    catch { return {}; }
  }
  function isActiveCard(id, seen, attempts){
    return !!(seen[id] || (attempts[id] && attempts[id].length));
    // active = anything introduced or ever attempted
  }

  /* ---------- Build the test queue (struggling-first) ---------- */
  async function loadDeckSorted(deckId){ return await loadDeckRows(deckId || dk); }

  function classifyStruggling(cardId, attemptsMap){
    const arr = attemptsMap[cardId] || [];
    if (!arr.length) return true; // unseen in attempts but “active” → likely newish → treat as struggling
    const recent = arr.slice(-3);
    const recentFails = recent.filter(a => a.score !== false && a.pass === false).length;
    const acc = lastNAccuracy(cardId, SCORE_WINDOW, attemptsMap);
    const lastTs = recent.length ? recent[recent.length-1].ts : 0;
    const failedRecently = recent.length && recent[recent.length-1].pass === false && (Date.now() - lastTs) < (48*3600*1000);
    // struggling if poor accuracy or several recent fails or a fresh fail in last 48h
    return acc < 40 || recentFails >= 2 || failedRecently;
  }

  function buildQueue(allCards){
    // 1) compute confidence + struggling flag
    const attemptsMap = loadAttempts();
    allCards.forEach(c => {
      c.conf = lastNAccuracy(c.id, SCORE_WINDOW, attemptsMap); // 0..100
      c.isStruggling = classifyStruggling(c.id, attemptsMap);
    });

    // 2) split
    const struggling = allCards.filter(c => c.isStruggling);
    const maintenance = allCards.filter(c => !c.isStruggling);

    // 3) order within buckets:
    // struggling: lowest confidence first, then older last attempt first
    const lastTs = id => {
      const arr = attemptsMap[id] || [];
      return arr.length ? arr[arr.length-1].ts : 0;
    };
    struggling.sort((a,b) => (a.conf - b.conf) || (lastTs(a.id) - lastTs(b.id)));
    // maintenance: lower confidence first but still mix
    maintenance.sort((a,b) => (a.conf - b.conf) || (lastTs(a.id) - lastTs(b.id)));

    // 4) take up to SESSION_MAX with a target mix (10 struggling, 5 maintenance)
    const takeStrug = Math.min(10, struggling.length, SESSION_MAX);
    const takeMaint = Math.min(SESSION_MAX - takeStrug, maintenance.length);
    const q = struggling.slice(0, takeStrug).concat(maintenance.slice(0, takeMaint));

    // If still short (e.g., tiny deck), just add more maintenance
    if (q.length < SESSION_MAX) {
      const extra = maintenance.slice(takeMaint, takeMaint + (SESSION_MAX - q.length));
      q.push(...extra);
    }
    return q;
  }

  /* ---------- Session state ---------- */
  let container = null;
  let deck = [];
  let idx = 0;
  let correct = 0;
  let wrong = [];
  let practiceMode = false;
  let seenThisSession = new Set();
  let tracker = null; // behaviour tracker for the active card
  let sessionDue = 0;

  function resetSession(){ localStorage.setItem(SESSION_KEY, JSON.stringify({ done: [] })); }
  function markSessionDone(id){
    let obj; try{ obj = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); }catch{ obj = {}; }
    if(!Array.isArray(obj.done)) obj.done = [];
    if(!obj.done.includes(id)) obj.done.push(id);
    localStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  }

  /* ---------- Practice toggle UI ---------- */
  async function checkPracticeUnlock(){
    const btn  = document.getElementById('practiceToggle');
    const hint = document.getElementById('practiceHint');
    if (!btn) return;
    const count = await (window.fcGetTestQueueCount ? window.fcGetTestQueueCount() : Promise.resolve(0));
    const unlocked = count === 0;
    btn.disabled = !unlocked;
    btn.textContent = 'Practice (free retest)';
    if (hint) hint.style.display = unlocked ? 'none' : '';
  }
  function updatePracticeUI(){
    const banner = document.getElementById('practiceBanner');
    const btn = document.getElementById('practiceToggle');
    if (banner) banner.style.display = practiceMode ? '' : 'none';
    if (btn) btn.classList.toggle('active', practiceMode);
  }

  /* ---------- Build active list (due items) ---------- */
  async function buildActiveList(){
    const rows = await loadDeckSorted(dk);
    const base = rows.map(r => ({ id:r.id, front:r.front, back:r.back, unit:r.unit, section:r.section, card:r.card }));
    const seen = loadProgressSeen();
    const attempts = loadAttempts();
    const session = (()=>{ try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); } catch{ return {}; } })();
    const doneSet = new Set(session.done || []);
    const now = Date.now();

    // "Due" logic:
    // - Only cards that are "active" (seen/attempted)
    // - Exclude cards completed earlier in THIS session
    // - Exclude cards that had a counted PASS within last hour (cooldown)
    const active = base.filter(c => {
      if (!isActiveCard(c.id, seen, attempts)) return false;
      if (doneSet.has(c.id)) return false;
      const arr = attempts[c.id] || [];
      for (let i=arr.length-1;i>=0;i--){
        const a = arr[i];
        if (a.pass && a.score !== false) {
          if (now - a.ts < SCORE_COOLDOWN_MS) return false;
          break;
        }
      }
      return true;
    });

    // Order & cap
    const queue = buildQueue(active).slice(0, SESSION_MAX);
    return queue;
  }

  /* ---------- Renderers ---------- */
  function renderCard(){
    const c = deck[idx];
    // mark seen-once per session to block immediate re-serve
    if(!seenThisSession.has(c.id)){
      seenThisSession.add(c.id);
      markSessionDone(c.id);
      fireProgressEvent({ type:'seen', id:c.id });
    }

    tracker = makeBehaviourTracker(); // new tracker per card
    tracker.begin();

    container.innerHTML = `
      <div class="flashcard">
        <div class="translation tm-question">${escapeHTML(c.back)}</div>
        <div class="tm-inputblock">
          <label for="tm-answer" class="tm-label">Type the Welsh</label>
          <input id="tm-answer" class="tm-field" type="text" placeholder="Type the Welsh…" autocomplete="off" autocapitalize="off" spellcheck="false">
        </div>
        <div class="flashcard-actions" style="flex-direction:column; gap:6px;">
          <button class="btn nav-btn big" id="tm-submit">Submit</button>
          <button class="btn link danger" id="tm-skip" title="Counts as incorrect">I don’t know</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${deck.length} • Session cap ${SESSION_MAX}</div>
      </div>
      <div class="muted" id="tm-hintnudges" style="text-align:center;margin-top:6px;display:none;">
        Still working on it? Try a hint or think out loud.
      </div>`;
    const inp = container.querySelector('#tm-answer');
    inp.addEventListener('keydown', e => tracker.onKey(e));

    // submit handlers
    container.querySelector('#tm-submit').addEventListener('click', ()=> handleSubmit(false));
    container.querySelector('#tm-skip').addEventListener('click',  ()=> handleSubmit(true));
    inp.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); handleSubmit(false); } });

    focusField('#tm-answer');
  }

  function showNudge(){
    const n = container && container.querySelector('#tm-hintnudges');
    if (n) n.style.display = '';
  }

  function handleSubmit(skip){
    const c = deck[idx];
    const val = container.querySelector('#tm-answer').value || '';
    const behaviour = tracker.classify(); // 'thinking' | 'fast' | 'idle' | 'deep'

    // Idle/timeout → do not mark wrong; push the card later in session if possible
    if (behaviour.kind === 'idle'){
      return renderIdlePause(() => renderCard(), () => {
        // skip without penalty: move this card near the end if room remains
        const item = deck.splice(idx,1)[0];
        deck.push(item);
        if (idx >= deck.length) idx = deck.length-1;
        renderCard();
      });
    }

    const pass = !skip && equalsLoose(val, c.front);

    // Decide scoring count for this attempt
    const countThis = logAttempt(c.id, pass, {
      behaviour: behaviour.kind,
      forceNoScore: practiceMode
    });

    fireProgressEvent({ type:'attempt', id:c.id, pass });

    if (pass) {
      // If "fast" guess, we logged but likely didn't count; we still advance.
      if (countThis) tickDay && tickDay();
      correct++;
      showResult(true, val, { scoreCounted: countThis });
    } else {
      wrong.push(c);
      // Start your re-teach loop
      startDrill(c, val);
    }
  }

  function startDrill(card, initialInput){
    // Simple three-step: 2× copy (with visible Welsh), 1–2× blind (English → Welsh).
    function copyStep(step, wrongVal){
      const label = step===1 ? 'Copy it (1/2)' : step===2 ? 'Copy it (2/2)' : 'Copy it again';
      container.innerHTML = `
        <div class="flashcard">
          <div class="term">${escapeHTML(card.front)}</div>
          ${typeof wrongVal !== 'undefined'
             ? `<div class="tm-result tm-fail">✖ Incorrect</div>
                <div class="tm-mismatch"><div class="tm-label">Your answer</div><div class="tm-ansbox">${escapeHTML(wrongVal||'—')}</div></div>`
             : ''
          }
          <div class="tm-inputblock">
            <label class="tm-label">${label}</label>
            <input id="tm-drill" class="tm-field" type="text" placeholder="${escapeHTML(card.front)}" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <div class="flashcard-actions"><button class="btn nav-btn" id="tm-submit">Submit</button></div>
          <div class="flashcard-progress muted">Re-teach • Card ${idx+1} of ${deck.length}</div>
        </div>`;
      const inp = container.querySelector('#tm-drill');
      const localTracker = makeBehaviourTracker(); localTracker.begin();
      inp.addEventListener('keydown', e => localTracker.onKey(e));

      function submit(){
        const val = inp.value || '';
        const ok = equalsLoose(val, card.front);
        logAttempt(card.id, ok, { behaviour: localTracker.classify().kind, forceNoScore: true });
        fireProgressEvent({ type:'attempt', id: card.id, pass: ok });
        if (ok){
          if (step===1) copyStep(2);
          else if (step===2) blindStep(1);
          else blindStep(2);
        } else {
          copyStep(step, val);
        }
      }
      container.querySelector('#tm-submit').addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); submit(); } });
      focusField('#tm-drill');
    }

    function blindStep(attempt){
      container.innerHTML = `
        <div class="flashcard">
          <div class="translation tm-question">${escapeHTML(card.back)}</div>
          <div class="tm-inputblock" style="margin-top:8px;">
            <label class="tm-label">Type the Welsh</label>
            <input id="tm-drill" class="tm-field" type="text" placeholder="Type the Welsh…" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <div class="flashcard-actions"><button class="btn nav-btn" id="tm-submit">Submit</button></div>
          <div class="flashcard-progress muted">Re-teach • Card ${idx+1} of ${deck.length}</div>
        </div>`;
      const inp = container.querySelector('#tm-drill');
      const localTracker = makeBehaviourTracker(); localTracker.begin();
      inp.addEventListener('keydown', e => localTracker.onKey(e));

      function submit(){
        const val = inp.value || '';
        const ok = equalsLoose(val, card.front);
        const counted = logAttempt(card.id, ok, { behaviour: localTracker.classify().kind, forceNoScore: practiceMode });
        fireProgressEvent({ type:'attempt', id: card.id, pass: ok });
        if (ok){
          if (counted && !practiceMode) tickDay && tickDay();
          showResult(true, val, { scoreCounted: counted });
        } else if (attempt === 1){
          copyStep(3, val);
        } else {
          showResult(false, val);
        }
      }
      container.querySelector('#tm-submit').addEventListener('click', submit);
      inp.addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); submit(); } });
      focusField('#tm-drill');
    }

    copyStep(1, initialInput);
  }

  function renderIdlePause(onResume, onSkip){
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">Paused</div>
        <div class="tm-label" style="margin-top:6px;">No penalty — resume when ready.</div>
        <div class="flashcard-actions" style="gap:8px;">
          <button class="btn nav-btn" id="tm-resume">Resume</button>
          <button class="btn link danger" id="tm-skip">Skip for now</button>
        </div>
        <div class="flashcard-progress muted">We’ll resurface this later.</div>
      </div>`;
    container.querySelector('#tm-resume').addEventListener('click', onResume);
    container.querySelector('#tm-skip').addEventListener('click', onSkip);
  }

  function showResult(pass, userInput, opts){
    const c = deck[idx];
    let resultHtml='';
    if (pass){
      resultHtml = '<div class="tm-result tm-correct">✓ Correct</div>';
      if (opts && opts.scoreCounted === false && !practiceMode){
        resultHtml += '<div class="tm-label">Confidence unchanged (cooldown or fast guess)</div>';
      }
    } else {
      resultHtml = `
        <div class="tm-result tm-fail">✖ Incorrect</div>
        <div class="tm-mismatch">
          <div class="tm-label">Your answer</div>
          <div class="tm-ansbox">${escapeHTML(userInput || '—')}</div>
        </div>`;
    }
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">${escapeHTML(c.front)}</div>
        ${resultHtml}
        <div class="flashcard-actions"><button class="btn nav-btn" id="tm-next">Next</button></div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${deck.length}</div>
      </div>`;
    const nextBtn = container.querySelector('#tm-next');
    function goNext(){
      window.removeEventListener('keydown', onEnter);
      idx++;
      if (idx < deck.length) renderCard();
      else renderSummary();
    }
    function onEnter(e){ if(e.key==='Enter'){ e.preventDefault(); goNext(); } }
    nextBtn.addEventListener('click', goNext);
    window.addEventListener('keydown', onEnter);
    focusField('#tm-next');
  }

  function renderSummary(){
    const total = deck.length;
    const pct = total ? Math.round((correct/total)*100) : 0;
    const list = wrong.map(c => `<li>${escapeHTML(c.back)} → <strong>${escapeHTML(c.front)}</strong></li>`).join('');
    const gateInfo = `<div class="tm-label">Struggling gate (info): ${STRUGGLE_CAP_INFO.gate} max counts toward new unlocks (managed in New Phrases).</div>`;
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">Test complete</div>
        <div class="tm-result tm-correct" style="margin-top:8px;">${correct} / ${total} correct (${pct}%)</div>
        ${wrong.length ? `<div class="tm-mismatch"><div class="tm-label">Incorrect</div><ul class="tm-anslist">${list}</ul></div>` : ''}
        <div class="flashcard-actions" style="flex-direction:column; gap:6px;">
          <a class="btn nav-btn" href="#/home">Finish</a>
        </div>
        <div class="flashcard-progress muted">Nice work!</div>
        ${gateInfo}
      </div>`;
    window.dispatchEvent(new CustomEvent('fc:module-complete',{ detail:{ module:'test' }}));
    if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge();
  }

  /* ---------- Flow ---------- */
  async function start(){
    seenThisSession = new Set();
    resetSession();
    container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Loading…</div></div>`;
    try{
      // Build "due" list and cap to session size
      const due = await buildActiveList();
      sessionDue = Math.min(due.length, SESSION_MAX);
      if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge(due.length);
      if (!due.length){
        container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">No introduced cards due. Use New Phrases or come back later.</div></div>`;
        return;
      }
      deck = due.slice(0, SESSION_MAX);
      idx = 0; correct = 0; wrong = [];
      renderCard();
    }catch(e){
      console.error(e);
      container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Failed to load cards.</div></div>`;
    }
  }

  function routeName(){ const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home'; return (raw.split('?')[0] || 'home'); }

  async function mountIfTestRoute(){
    if (routeName() !== 'test'){
      if(window.fcUpdateQuizBadge) window.fcUpdateQuizBadge();
      return;
    }

    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/test'));

    container = document.getElementById('test-container');
    if (!container){ setTimeout(mountIfTestRoute, 0); return; }

    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    practiceMode = params.get('practice') === '1' || params.get('practice') === 'true';
    updatePracticeUI();
    const pBtn = document.getElementById('practiceToggle');
    if (pBtn){
      pBtn.addEventListener('click', ()=>{
        if (pBtn.disabled) return;
        practiceMode = !practiceMode;
        updatePracticeUI();
      });
    }
    checkPracticeUnlock();

    // Day badge
    const sec = container.parentElement;
    if (!document.getElementById('tm-day')){
      const dayEl = document.createElement('div');
      dayEl.id = 'tm-day';
      dayEl.className = 'muted';
      dayEl.style.marginBottom = '8px';
      dayEl.textContent = `Day ${getDayNumber ? getDayNumber() : ''}`;
      sec.before(dayEl);
    } else {
      document.getElementById('tm-day').textContent = `Day ${getDayNumber ? getDayNumber() : ''}`;
    }

    start();
  }

  window.addEventListener('DOMContentLoaded', mountIfTestRoute);
  window.addEventListener('hashchange',   mountIfTestRoute);
  window.addEventListener('fc:progress-updated', () => { checkPracticeUnlock(); });

  if (location.hash.startsWith('#/test')) mountIfTestRoute();

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
