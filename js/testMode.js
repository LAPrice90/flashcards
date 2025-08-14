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


  // Test Mode – review only. Route: #/test

  /* ---------- Constants & state ---------- */
  const LS_START_KEY = 'tm_start_date';

  let container = null;
  let deck = [];
  let idx = 0;
  let correct = 0;
  let wrong = [];
  let practiceMode = false;

  /* ---------- Small helpers ---------- */
  function todayKey() {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d.toISOString().slice(0,10);
  }

  function getDayNumber() {
    const today = todayKey();
    let start = localStorage.getItem(LS_START_KEY);
    if (!start) {
      localStorage.setItem(LS_START_KEY, today);
      return 1;
    }
    const diff = Math.floor((new Date(today) - new Date(start)) / 86400000);
    return diff + 1;
  }

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
        if (a.pass) {
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
    markSessionDone(c.id);
    fireProgressEvent({ type:'session-update', id: c.id });
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
          <a class="btn nav-btn" href="#/home">Home</a>
        </div>
        <div class="flashcard-progress muted">Nice work!</div>
      </div>`;
  }

  /* ---------- Flow ---------- */
  async function start() {
    container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Loading…</div></div>`;
    try {
      const active = await buildActiveDeck();
      if (!active.length) {
        container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">No introduced cards to test. Use New Phrases to unlock today’s set.</div></div>`;
        return;
      }
      active.sort((a,b)=>{
        const u=(a.unit||'').localeCompare(b.unit||''); if(u) return u;
        const s=(parseInt(a.section,10)||0)-(parseInt(b.section,10)||0); if(s) return s;
        const ca=parseInt(a.card,10)||0; const cb=parseInt(b.card,10)||0; if(ca!==cb) return ca-cb;
        return (a.id||'').localeCompare(b.id||'');
      });
      deck = shuffle(active);
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
    if (routeName() !== 'test') return;

    document.querySelectorAll('.nav a').forEach(a =>
      a.classList.toggle('active', a.getAttribute('href') === '#/test')
    );

    container = document.getElementById('test-container');
    if (!container) { setTimeout(mountIfTestRoute, 0); return; }

    practiceMode = false;
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
    .tm-field{width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:#fff;font-size:16px;}
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

