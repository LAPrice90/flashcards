// testMode.js — Test Mode styled like your flashcards, route: #/test
// English → type Welsh; loose matching; audio on correct (normal first); three-step drill as separate cards
// Big Submit; small “I don’t know” that counts as a fail. Enter key submits.

(() => {
  const LS_ATTEMPTS_KEY = 'tm_attempts_v1';
  const MAX_HISTORY = 50;
  const SCORE_WINDOW = 10;

  // queue item kinds
  const K_PROMPT = 'prompt'; // normal test (English -> type Welsh)
  const K_DRILL  = 'drill';  // { step: 1|2|3 }

  let deck = [];              // [{id, front(Welsh), back(English), audio}]
  let queue = [];             // [{kind, card, step?}]
  let current = null;         // current queue item
  let container = null;

  // Prevent global key handlers (from app.js) from eating letters/Enter inside inputs
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)) {
      e.stopPropagation(); // don't let global hotkeys handle this
    }
  }, true);

  // ---------- Storage ----------
  const nowISO = () => new Date().toISOString();
  const loadAttempts = () => {
    try { return JSON.parse(localStorage.getItem(LS_ATTEMPTS_KEY) || '{}'); }
    catch { return {}; }
  };
  const saveAttempts = (obj) => localStorage.setItem(LS_ATTEMPTS_KEY, JSON.stringify(obj));
  const attemptsMap = loadAttempts();

  function pushAttempt(id, pass) {
    if (!attemptsMap[id]) attemptsMap[id] = [];
    attemptsMap[id].unshift({ ts: nowISO(), pass: !!pass });
    if (attemptsMap[id].length > MAX_HISTORY) attemptsMap[id].length = MAX_HISTORY;
    saveAttempts(attemptsMap);
  }
  function passPctLastN(id, n = SCORE_WINDOW) {
    const arr = (attemptsMap[id] || []).slice(0, n);
    if (!arr.length) return 0;
    const p = arr.filter(a => a.pass).length;
    return Math.round((p / arr.length) * 100);
  }
  function categoryFromPct(p) {
    if (p < 50) return 'Very Low';
    if (p < 80) return 'Medium';
    return 'Easy';
  }

  // ---------- Audio helpers ----------
  let audioEl = null;
  let slowNext = false; // alternator for subsequent clicks (not for first play)

  function stopAudio() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
  }
  function playAudio(src, alternate = true) {
    if (!src) return;
    stopAudio();
    audioEl = new Audio(src);
    // normal speed by default; if alternate==true, subsequent clicks will toggle slow/normal
    audioEl.playbackRate = (alternate && slowNext) ? 0.6 : 1.0;
    if (alternate) slowNext = !slowNext;
    audioEl.play().catch(() => {/* autoplay might be blocked; user can tap button */});
  }

  // ---------- CSV ----------
  async function fetchDeckCSV() {
    const res = await fetch('data/welsh_basics.csv');
    if (!res.ok) throw new Error('Failed to load CSV');
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(',');
    const rows = lines.filter(l => l.trim().length).map(line => {
      const values = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (values[i] || '').replace(/^"|"$/g, '').trim();
      });
      return obj;
    });
    return rows.map(r => ({
      id: r.id || '',
      front: r.front || r.word || '',       // Welsh
      back:  r.back  || r.translation || '',// English
      audio: r.audio || ''                  // optional audio file
    })).filter(r => r.id && r.front && r.back);
  }

  // ---------- Queue helpers ----------
  function shuffle(a) {
    const arr = a.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function buildQueueFromDeck(d) {
    return shuffle(d).map(card => ({ kind: K_PROMPT, card }));
  }

  // ---------- Normalization / Matching ----------
  function normalizeInput(s) {
    if (!s) return '';
    let out = s.toLowerCase();
    out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // strip accents if typed without
    out = out
      .replace(/[\u2019\u2018]/g, "'")    // apostrophes
      .replace(/[\u201C\u201D]/g, '"')    // quotes
      .replace(/\u2026/g, '...')          // ellipsis
      .replace(/[\u2013\u2014]/g, '-')    // en/em dash
      ;
    // strip punctuation-ish and collapse spaces
    out = out.replace(/[.,!?;:"'()\-]/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const prev = new Array(n + 1);
    const cur  = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = (ai === b.charCodeAt(j - 1)) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function equalsLoose(userRaw, answerRaw) {
    const a = normalizeInput(userRaw);
    const b = normalizeInput(answerRaw);
    if (a === b) return true;
    const dist = levenshtein(a, b);
    const tol = Math.max(1, Math.floor(Math.max(a.length, b.length) / 8)); // ~12.5%
    return dist <= tol;
  }

  // ---------- Small utils ----------
  function escapeHTML(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function escapeAttr(s){return String(s).replace(/"/g,'&quot;')}
  function focusField(sel){const el=container?.querySelector(sel); if(el){el.focus(); el.select?.();}}

  function chips(card) {
    const pct = passPctLastN(card.id, SCORE_WINDOW);
    const cat = categoryFromPct(pct);
    return `
      <div class="tm-chips">
        <span class="chip chip-muted">Last ${SCORE_WINDOW}: ${pct}%</span>
        <span class="chip ${cat==='Very Low'?'chip-bad':cat==='Medium'?'chip-warn':'chip-good'}">${cat}</span>
        <span class="chip chip-muted">Queue ${queue.length + 1}</span>
      </div>
    `;
  }

  // ---------- Screens (all inside .flashcard) ----------
  function renderPrompt() {
    const card = current.card;
    container.innerHTML = `
      <div class="flashcard">
        ${chips(card)}
        <div class="translation" style="margin-top:4px;">${escapeHTML(card.back)}</div>
        <div class="tm-inputblock">
          <label for="tm-answer" class="tm-label">Type the Welsh</label>
          <input id="tm-answer" class="tm-field" type="text"
                 placeholder="Type the Welsh…" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions" style="flex-direction:column; gap:6px;">
          <button class="btn nav-btn big" id="tm-submit">Submit</button>
          <button class="btn link danger" id="tm-dont-know" title="Counts as a fail">I don’t know</button>
        </div>
        <div class="flashcard-progress muted">Press Enter to submit</div>
      </div>
    `;
    container.querySelector('#tm-submit').addEventListener('click', onSubmit);
    container.querySelector('#tm-dont-know').addEventListener('click', onIDontKnow);
    const ans = container.querySelector('#tm-answer');
    ans.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
    });
    focusField('#tm-answer');
  }

  function renderCorrect(userTyped) {
    const card = current.card;

    // First play MUST be normal speed → reset alternator
    slowNext = false;

    container.innerHTML = `
      <div class="flashcard">
        ${chips(card)}
        <div class="tm-result tm-correct">✓ Correct</div>
        <div class="term" style="margin-top:-6px;">${escapeHTML(card.front)}</div>

        <div class="tm-audio">
          <button class="btn audio-btn" id="tm-audio-btn" title="Play audio">🔊 Play</button>
        </div>

        <div class="flashcard-actions">
          <button class="btn green" id="tm-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Nice! Audio plays automatically.</div>
      </div>
    `;

    // autoplay (normal speed), button as fallback
    playAudio(card.audio, /*alternate*/ false); // normal first
    const btn = container.querySelector('#tm-audio-btn');
    btn.addEventListener('click', () => playAudio(card.audio, /*alternate*/ true));

    container.querySelector('#tm-next').addEventListener('click', nextItem);
  }

  function renderIncorrectIntro(userTyped) {
    const card = current.card;
    container.innerHTML = `
      <div class="flashcard">
        ${chips(card)}
        <div class="tm-result tm-fail">✖ Incorrect</div>
        <div class="term" style="margin-top:-6px;">${escapeHTML(card.front)}</div>

        <div class="tm-mismatch">
          <div class="tm-label">Your answer</div>
          <div class="tm-ansbox">${escapeHTML(userTyped || '—')}</div>
        </div>

        <div class="flashcard-actions">
          <button class="btn red" id="tm-start-drill">Start correction</button>
        </div>
        <div class="flashcard-progress muted">You’ll copy it twice, then type it from memory.</div>
      </div>
    `;
    container.querySelector('#tm-start-drill').addEventListener('click', () => {
      queue.unshift(
        { kind: K_DRILL, card, step: 1 },
        { kind: K_DRILL, card, step: 2 },
        { kind: K_DRILL, card, step: 3 }
      );
      nextItem();
    });
  }

  function renderDrill(step) {
    const card = current.card;
    const labels = {
      1: 'Copy it (1/2)',
      2: 'Copy it (2/2)',
      3: 'Now from memory'
    };
    const placeholder = (step === 3) ? 'Type without looking' : card.front;

    container.innerHTML = `
      <div class="flashcard">
        ${chips(card)}
        <div class="term" style="margin-top:-6px;">${step === 3 ? '' : escapeHTML(card.front)}</div>

        <div class="tm-inputblock">
          <label class="tm-label">${labels[step]}</label>
          <input id="tm-drill" class="tm-field" type="text"
                 placeholder="${escapeAttr(placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>

        <div class="flashcard-actions">
          <button class="btn nav-btn" id="tm-continue">Continue</button>
        </div>
        <div class="flashcard-progress muted">${step === 3 ? 'From memory' : 'Copy exactly (tolerant to small typos)'}</div>
      </div>
    `;
    container.querySelector('#tm-continue').addEventListener('click', onDrillContinue);
    const inp = container.querySelector('#tm-drill');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onDrillContinue(); }});
    focusField('#tm-drill');
  }

  function renderDone() {
    container.innerHTML = `
      <div class="flashcard">
        <div class="term">🎉 Test complete</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="tm-restart">Restart</button>
          <a class="btn nav-btn" href="#/home">Home</a>
        </div>
        <div class="flashcard-progress muted">Great work</div>
      </div>
    `;
    container.querySelector('#tm-restart').addEventListener('click', restart);
  }

  // ---------- Flow ----------
  function restart() {
    stopAudio();
    queue = buildQueueFromDeck(deck);
    nextItem();
  }

  function nextItem() {
    stopAudio();
    if (!queue.length) { renderDone(); return; }
    current = queue.shift();
    if (current.kind === K_PROMPT) renderPrompt();
    else renderDrill(current.step);
  }

  function onSubmit() {
    const inputRaw = container.querySelector('#tm-answer').value || '';
    const ok = equalsLoose(inputRaw, current.card.front);
    pushAttempt(current.card.id, ok);
    if (ok) renderCorrect(inputRaw);
    else renderIncorrectIntro(inputRaw);
  }

  function onIDontKnow() {
    const userTyped = container.querySelector('#tm-answer')?.value || '';
    pushAttempt(current.card.id, false);
    renderIncorrectIntro(userTyped);
  }

  function onDrillContinue() {
    const val = container.querySelector('#tm-drill').value || '';
    if (!equalsLoose(val, current.card.front)) {
      focusField('#tm-drill');
      return;
    }
    nextItem();
  }

  // ---------- Router hook ----------
  function routeName() {
    const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
    return (raw.split('?')[0] || 'home');
  }

  async function mountIfTestRoute() {
    if (routeName() !== 'test') return;

    // highlight nav
    document.querySelectorAll('.nav a').forEach(a =>
      a.classList.toggle('active', a.getAttribute('href') === '#/test')
    );

    container = document.getElementById('test-container');
    if (!container) { setTimeout(mountIfTestRoute, 0); return; }

    container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Loading Test Mode…</div></div>`;

    try {
      deck = await fetchDeckCSV();
      if (!deck.length) {
        container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">No cards found in CSV.</div></div>`;
        return;
      }
      restart();
    } catch (e) {
      console.error(e);
      container.innerHTML = `<div class="flashcard"><div class="flashcard-progress muted">Failed to load deck.</div></div>`;
    }
  }

  window.addEventListener('DOMContentLoaded', mountIfTestRoute);
  window.addEventListener('hashchange', mountIfTestRoute);

  // ---------- Minimal style tweaks ----------
  const style = document.createElement('style');
  style.textContent = `
    .tm-chips { display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-bottom:6px; }
    .chip { border:1px solid var(--border); background: var(--panel); border-radius:999px; padding:4px 10px; font-size:12px; color:#fff; }
    .chip-muted { opacity:.75; }
    .chip-bad { background:#3b0e0e; }
    .chip-warn { background:#3b310e; }
    .chip-good { background:#0e283b; }
    .tm-label { font-size:12px; color: var(--muted); text-align:center; margin-top:6px; }
    .tm-field { width:100%; margin-top:6px; padding:10px 12px; border:1px solid var(--border); border-radius:12px; background: var(--panel); color:#fff; }
    .tm-inputblock { margin-top:8px; }
    .tm-result { text-align:center; font-weight:800; margin-top:4px; }
    .tm-fail { color:#ff6b6b; }
    .tm-correct { color:#3bd16f; }
    .tm-mismatch { margin-top:8px; }
    .tm-ansbox { border:1px dashed var(--border); border-radius:10px; padding:8px 10px; margin-top:4px; background: rgba(255,255,255,0.02); }
    .btn.red { background:#6b1a1a; border:1px solid #7e2323; }
    .btn.green { background:#1e6b3b; border:1px solid #268a4c; }
    .tm-audio { display:flex; justify-content:center; margin:8px 0 0; }
    .audio-btn { background: var(--panel); border: 1px solid var(--border); }
    .btn.big { padding: 12px 18px; font-weight: 700; }
    .btn.link { background: transparent; border: none; text-decoration: underline; padding: 0; }
    .btn.link.danger { color: #ff6b6b; font-size: 12px; }
  `;
  document.head.appendChild(style);
})();
