// newPhrase.js — Learning mode (route: #/newPhrase)
// Unrolls a new phrase step-by-step, then a 3-step typing drill.
// Uses the same tolerant matching as Test Mode.

(() => {
  // ---------- Utilities ----------
  const pick = (arr, n) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  };
  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // tolerant matching (same rules as test mode)
  function normalizeInput(s) {
    if (!s) return '';
    let out = s.toLowerCase();
    out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    out = out
      .replace(/[\u2019\u2018]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/[\u2013\u2014]/g, '-');
    out = out.replace(/[.,!?;:"'()\-]/g, ' ');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const prev = new Array(n + 1), cur = new Array(n + 1);
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
    const tol = Math.max(1, Math.floor(Math.max(a.length, b.length) / 8));
    return dist <= tol;
  }

  // prevent global hotkeys from stealing input/Enter
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)) {
      e.stopPropagation();
    }
  }, true);

  // ---------- JSON loader ----------
  async function fetchDeckJSON() {
    const res = await fetch('data/welsh_phrases_A1.json');
    if (!res.ok) throw new Error('Failed to load JSON');
    const data = await res.json();
    const entries = Object.values(data.by_status || {}).flat();
    return entries.map((r, i) => ({
      card: r.card || '',
      unit: r.unit || '',
      section: r.section || '',
      id: r.id || String(i),
      front: r.welsh || r.front || r.word || '',
      back:  r.english || r.back  || r.translation || '',
      image: r.image || '',
      audio: r.audio || '',
      phonetic: r.pronunciation || r.phonetic || '',
      word_breakdown: r.word_breakdown || r.grammar_notes || '',
      usage_note: r.usage_note || r.use || '',
      pattern_examples: r.pattern_examples || '',
      pattern_examples_en: r.pattern_examples_en || '',
      example: r.example || ''
    })).filter(r => r.id && r.front && r.back);
  }

  // ---------- Audio ----------
  let audioEl = null;
  function stopAudio() { if (audioEl) { audioEl.pause(); audioEl = null; } }
  function playAudio(src, rate = 1.0) {
    if (!src) return;
    stopAudio();
    audioEl = new Audio(src);
    audioEl.playbackRate = rate;
    audioEl.play().catch(() => {});
  }
  async function playSequence(src) {
    // normal → 0.6 → normal, sequentially
    await playOne(src, 1.0);
    await playOne(src, 0.6);
    await playOne(src, 1.0);
  }
  function playOne(src, rate) {
    return new Promise(resolve => {
      if (!src) return resolve();
      stopAudio();
      audioEl = new Audio(src);
      audioEl.playbackRate = rate;
      audioEl.addEventListener('ended', resolve, { once: true });
      audioEl.play().catch(() => resolve());
    });
  }

  // ---------- Learning flow ----------
  const STEPS = {
    INTRO: 0,       // image + play to continue
    WELSH: 1,       // reveal Welsh + auto play (normal)
    LISTEN: 2,      // auto sequence normal→0.6→normal
    MEANING: 3,     // show English + breakdown
    CONTEXT: 4,     // usage + related
    DRILL1: 5,      // copy 1/2
    DRILL2: 6,      // copy 2/2
    DRILL3: 7       // blind recall (English prompt)
  };

  let viewEl = null;
  let queue = [];      // cards selected for today
  let idx = 0;         // which card in queue
  let step = STEPS.INTRO;

  function routeName() {
    const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
    return (raw.split('?')[0] || 'home');
  }

  async function mountIfLearningRoute() {
    if (routeName() !== 'newPhrase') return;

    // highlight nav
    document.querySelectorAll('.nav a').forEach(a =>
      a.classList.toggle('active', a.getAttribute('href') === '#/newPhrase')
    );

    const host = document.getElementById('view');
    host.innerHTML = `<h1 class="h1">New Words</h1>
      <section class="card card--center"><div id="np-root" class="flashcard"></div></section>`;
    viewEl = document.getElementById('np-root');

    // load JSON and pick 5 random for now
    try {
      const all = await fetchDeckJSON();
      queue = pick(all, 5);
      idx = 0;
      step = STEPS.INTRO;
      render();
    } catch (e) {
      console.error(e);
      viewEl.innerHTML = `<div class="muted">Failed to load data.</div>`;
    }
  }

  function current() { return queue[idx]; }

  function render() {
    stopAudio();
    const c = current();
    if (!c) { viewEl.innerHTML = `<div class="muted">No items.</div>`; return; }

    // common header image (from step 2 onwards we keep the phrase visible too)
    const img = c.image ? `<img src="${c.image}" alt="${escapeHTML(c.front)}" style="width:100%; border-radius:16px;">`
                        : `<div class="no-image muted">No image</div>`;

    // decide body by step
    if (step === STEPS.INTRO) {
      viewEl.innerHTML = `
        <div class="flashcard-image">${img}</div>
        <div class="flashcard-progress muted" style="margin-top:8px;">Tap Play to begin</div>
        <div class="flashcard-actions">
          <button class="btn audio-btn" id="np-play">🔊 Play</button>
          <button class="btn nav-btn" id="np-skip" style="display:none">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>
      `;
      const playBtn = viewEl.querySelector('#np-play');
      playBtn.addEventListener('click', () => {
        playAudio(c.audio, 1.0);
        step = STEPS.WELSH;
        // slightly delay to let audio start
        setTimeout(render, 250);
      });
      return;
    }

    if (step === STEPS.WELSH) {
      viewEl.innerHTML = `
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="tm-audio" style="margin-top:6px;">
          <button class="btn audio-btn" id="np-play">🔊 Play</button>
          <button class="btn audio-btn" id="np-play-slow" style="margin-left:6px;">🐢 0.6×</button>
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>
      `;
      // auto play once at normal speed
      playAudio(c.audio, 1.0);
      viewEl.querySelector('#np-play').addEventListener('click', () => playAudio(c.audio, 1.0));
      viewEl.querySelector('#np-play-slow').addEventListener('click', () => playAudio(c.audio, 0.6));
      viewEl.querySelector('#np-next').addEventListener('click', () => { step = STEPS.LISTEN; render(); });
      return;
    }

    if (step === STEPS.LISTEN) {
      viewEl.innerHTML = `
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="flashcard-progress muted" id="np-status" style="margin-top:6px;">Listening drill: normal → 0.6× → normal</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next" disabled>Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>
      `;
      // play the three sounds automatically, then enable Next
      (async () => {
        await playSequence(c.audio);
        const nxt = viewEl.querySelector('#np-next');
        if (nxt) nxt.disabled = false;
      })();
      viewEl.querySelector('#np-next').addEventListener('click', () => { step = STEPS.MEANING; render(); });
      return;
    }

    if (step === STEPS.MEANING) {
      // show English + breakdown chips
      const chips = (c.word_breakdown || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => `<span class="chip">${escapeHTML(s)}</span>`)
        .join(' ');
      viewEl.innerHTML = `
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="translation" style="margin-top:4px;">${escapeHTML(c.back)}</div>
        <div class="breakdown" style="margin-top:6px;">${chips || ''}</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>
      `;
      viewEl.querySelector('#np-next').addEventListener('click', () => { step = STEPS.CONTEXT; render(); });
      return;
    }

    if (step === STEPS.CONTEXT) {
      // usage + related (Welsh only)
      const related = (c.pattern_examples || '')
        .split(/[\/|,]/).map(s => s.trim()).filter(Boolean)
        .map(s => `<li>${escapeHTML(s)}</li>`).join('');
      viewEl.innerHTML = `
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="usage" style="margin-top:6px;">${escapeHTML(c.usage_note || '')}</div>
        ${related ? `<div class="patterns" style="margin-top:6px;"><ul class="patterns-list">${related}</ul></div>` : ''}
        <div class="flashcard-actions">
          <button class="btn primary" id="np-start-drill">Start typing drill</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>
      `;
      viewEl.querySelector('#np-start-drill').addEventListener('click', () => { step = STEPS.DRILL1; render(); });
      return;
    }

    if (step === STEPS.DRILL1 || step === STEPS.DRILL2) {
      const label = step === STEPS.DRILL1 ? 'Copy it (1/2)' : 'Copy it (2/2)';
      viewEl.innerHTML = `
        <div class="term">${escapeHTML(c.front)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">${label}</label>
          <input id="np-typed" class="tm-field" type="text"
                 placeholder="${escapeHTML(c.front)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-submit">Submit</button>
        </div>
        <div class="flashcard-progress muted">Press Enter to submit</div>
      `;
      const inp = viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click', () => {
        const ok = equalsLoose(inp.value || '', c.front);
        if (ok) { step = (step === STEPS.DRILL1 ? STEPS.DRILL2 : STEPS.DRILL3); render(); }
        else showIncorrect(inp.value || '', () => render()); // retry same step
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }

    if (step === STEPS.DRILL3) {
      viewEl.innerHTML = `
        <div class="translation">${escapeHTML(c.back)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">Type the Welsh (from memory)</label>
          <input id="np-typed" class="tm-field" type="text"
                 placeholder="Type without looking" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-submit">Submit</button>
        </div>
        <div class="flashcard-progress muted">Press Enter to submit</div>
      `;
      const inp = viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click', () => {
        const ok = equalsLoose(inp.value || '', c.front);
        if (ok) {
          // success screen + auto audio then Next card
          viewEl.innerHTML = `
            <div class="tm-result tm-correct">✓ Correct</div>
            <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
            <div class="tm-audio" style="margin-top:6px;">
              <button class="btn audio-btn" id="np-play">🔊 Play</button>
            </div>
            <div class="flashcard-actions">
              <button class="btn green" id="np-next">Next word</button>
            </div>
            <div class="flashcard-progress muted">Great! Audio plays automatically.</div>
          `;
          playAudio(c.audio, 1.0);
          viewEl.querySelector('#np-play')?.addEventListener('click', () => playAudio(c.audio, 1.0));
          viewEl.querySelector('#np-next').addEventListener('click', nextCard);
        } else {
          showIncorrect(inp.value || '', () => render()); // retry blind step
        }
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }
  }

  function nextCard() {
    stopAudio();
    idx++;
    if (idx >= queue.length) {
      viewEl.innerHTML = `
        <div class="term">🎉 All done for today</div>
        <div class="flashcard-actions">
          <a class="btn nav-btn" href="#/home">Home</a>
          <a class="btn nav-btn" href="#/test">Go to Test Mode</a>
        </div>
      `;
      return;
    }
    step = STEPS.INTRO;
    render();
  }

  function showIncorrect(userTyped, onRetry) {
    const c = current();
    viewEl.innerHTML = `
      <div class="tm-result tm-fail">✖ Incorrect</div>
      <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
      <div class="tm-mismatch" style="margin-top:8px;">
        <div class="tm-label">Your answer</div>
        <div class="tm-ansbox">${escapeHTML(userTyped || '—')}</div>
      </div>
      <div class="flashcard-actions">
        <button class="btn red" id="np-retry">Try again</button>
      </div>
    `;
    viewEl.querySelector('#np-retry').addEventListener('click', onRetry);
  }

  // ---------- Boot ----------
  window.addEventListener('DOMContentLoaded', mountIfLearningRoute);
  window.addEventListener('hashchange', mountIfLearningRoute);

  // small style tweaks (reuse flashcard look)
  const style = document.createElement('style');
  style.textContent = `
    .tm-result { text-align:center; font-weight:800; margin-top:4px; }
    .tm-fail { color:#ff6b6b; }
    .tm-correct { color:#3bd16f; }
    .tm-label { font-size:12px; color: var(--muted); text-align:center; }
    .tm-ansbox { border:1px dashed var(--border); border-radius:10px; padding:8px 10px; margin-top:4px; background: rgba(255,255,255,0.02); }
    .tm-audio { display:flex; justify-content:center; }
    .chip { display:inline-block; border:1px solid var(--border); background: var(--panel); border-radius:999px; padding:4px 10px; font-size:12px; color:#fff; margin:2px; }
  `;
  document.head.appendChild(style);
})();
