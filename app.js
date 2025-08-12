/* ===========================
   Mobile-first card
   Flashcard ⇄ Detailed toggle
   Click-term flip (flash only)
   Single-button fast/slow audio
   =========================== */

const DECKS = [{ id: 'welsh_basics', name: 'Welsh – Basics', count: 29 }];

const STORAGE = {
  theme: 'fc_theme',
  deck:  'fc_active_deck',
  view:  'fc_card_view_mode', // 'flash' | 'detail'
  examplesEN: 'fc_examples_en', // <--- ADD THIS
};

const STATE = {
  activeDeckId: loadActiveDeckId(),
  viewMode: loadViewMode(), // 'flash' (default) | 'detail'
  showExamplesEN: loadExamplesEN(), // <--- ADD THIS
};

function loadActiveDeckId() {
  const saved = localStorage.getItem(STORAGE.deck);
  return (saved && DECKS.some(d => d.id === saved)) ? saved : DECKS[0].id;
}
function setActiveDeck(id) {
  if (!DECKS.some(d => d.id === id)) return;
  STATE.activeDeckId = id;
  localStorage.setItem(STORAGE.deck, id);
  const sel = document.getElementById('deckSelect');
  if (sel) sel.value = id;
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
  const saved = localStorage.getItem(STORAGE.examplesEN);
  return saved === 'true'; // default false
}
function setExamplesEN(v) {
  STATE.showExamplesEN = !!v;
  localStorage.setItem(STORAGE.examplesEN, String(!!v));
}


/* ---- Deck picker ---- */
function initDeckPicker() {
  const sel = document.getElementById('deckSelect');
  if (!sel) return;
  sel.innerHTML = '';
  DECKS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.count})`;
    if (d.id === STATE.activeDeckId) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', e => setActiveDeck(e.target.value));
}

/* ---- Theme ---- */
(function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme);
  if (saved === 'light' || saved === 'dark') {
    document.body.setAttribute('data-theme', saved);
  }
  const isLight = document.body.getAttribute('data-theme') === 'light';
  ['themeToggle','themeToggleTop'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = isLight;
    el.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'light' : 'dark';
      document.body.setAttribute('data-theme', mode);
      localStorage.setItem(STORAGE.theme, mode);
    });
  });
})();

/* ---- Router ---- */
const routes = {
  home: renderHome,
  review: renderReview,
  decks: renderDecks,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderPlaceholder('Settings'),
  test: renderTestShell,
};

async function render() {
  const [route, query] = parseHash();
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route)
  );
  const el = document.getElementById('view');
  const fn = routes[route] || routes.home;
  const out = fn(query);
  el.replaceChildren(out instanceof Promise ? await out : out);
}

function parseHash() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : 'home';
  const [path, qs] = raw.split('?');
  return [path || 'home', new URLSearchParams(qs || '')];
}

/* ---- Views ---- */
function renderHome() {
  const active = DECKS.find(d => d.id === STATE.activeDeckId);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Home</h1>
    <div class="muted" style="margin-bottom:8px;">Active deck: <strong>${active.name}</strong></div>
    <section class="stats-grid">
      <div class="card stat"><div class="title">Due Today</div><div class="big" id="stat-due">0</div></div>
      <div class="card stat"><div class="title">New Cards</div><div class="big" id="stat-new">${active.count}</div></div>
      <div class="card stat"><div class="title">Streak</div><div class="big" id="stat-streak">—</div></div>
    </section>
    <section class="card session-card">
      <h2 style="margin:0 0 8px; font-size:18px;">Choose mode:</h2>
      <div class="actions">
        <button class="btn primary" id="btn-study">Study</button>
        <button class="btn green" id="btn-quiz">Quiz</button>
      </div>
    </section>
  `;
  wrap.querySelector('#btn-study').addEventListener('click', () =>
    location.hash = `#/review?mode=study&deck=${STATE.activeDeckId}`
  );
  wrap.querySelector('#btn-quiz').addEventListener('click', () =>
    location.hash = '#/test'
  );
  return wrap;
}

function renderTestShell() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Test Mode</h1>
    <section class="card card--center">
      <div id="test-container"></div>
    </section>
  `;
  return wrap;
}


function renderDecks() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Decks</h1>`;
  const list = document.createElement('div');
  list.className = 'row';
  DECKS.forEach(d => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.minWidth = '260px';
    card.innerHTML = `
      <div style="font-weight:700">${d.name}</div>
      <div class="muted">${d.count} cards</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn">Set Active</button>
        <a class="btn" href="#/review?mode=quiz&deck=${d.id}">Review</a>
      </div>
    `;
    card.querySelector('button').addEventListener('click', () => setActiveDeck(d.id));
    list.appendChild(card);
  });
  wrap.appendChild(list);
  return wrap;
}

async function renderReview(query) {
  // We keep 'mode' param but always start with Welsh front in flashcards
  const deckId = query.get('deck') && DECKS.some(d => d.id === query.get('deck'))
    ? query.get('deck') : STATE.activeDeckId;
  if (deckId !== STATE.activeDeckId) setActiveDeck(deckId);

  const active = DECKS.find(d => d.id === deckId);
  const cards = await loadDeckData(deckId);
  if (!cards.length) {
    const err = document.createElement('div');
    err.innerHTML = `<h1>No cards found for ${active.name}</h1>`;
    return err;
  }

  // UI state
  let idx = 0;
  let showBack = false;   // front(Welsh) → back(English) in flash mode
  let slowNext = false;   // audio alternator
  let audio = null;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Review <span class="muted">(${active.name})</span></h1>
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
          <a class="btn end-btn" href="#/home">End Session</a>
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
    if (audio) { audio.pause(); audio = null; }
  }
  function playAudio(src) {
    if (!src) return;
    stopAudio();
    audio = new Audio(src);
    audio.playbackRate = slowNext ? 0.6 : 1.0; // alternate fast/slow
    slowNext = !slowNext;
    audio.play();
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
  });
  prevBtn.addEventListener('click', () => {
    stopAudio();
    idx = (idx - 1 + cards.length) % cards.length;
    showBack = false;
    renderCard();
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

function renderPlaceholder(title) {
  return function () {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<h1 class="h1">${title}</h1><div class="card muted">Content coming soon.</div>`;
    return wrap;
  };
}

/* ---- Mobile sidebar ---- */
function initMobileMenu() {
  const btn = document.getElementById('menuToggle');
  const side = document.querySelector('.side');
  if (!btn || !side) return;
  btn.addEventListener('click', () => side.classList.toggle('open'));
  document.querySelectorAll('.nav a').forEach(a =>
    a.addEventListener('click', () => side.classList.remove('open'))
  );
}

/* ---- Boot ---- */
window.addEventListener('DOMContentLoaded', () => {
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange', render);

/* ---- CSV loader ---- */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines
    .filter(line => line.trim().length)
    .map(line => {
      const values = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
      const obj = {};
      headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').replace(/^\"|\"$/g, '').trim(); });
      return obj;
    });
}

async function loadDeckData(deckId) {
  try {
    const res = await fetch('data/welsh_basics.csv');
    if (!res.ok) throw new Error(`Failed to load deck: ${deckId}`);
    const text = await res.text();
    const rows = parseCSV(text);
    rows.forEach((r, i) => {
      const expected = ['id','front','back','image','audio','example','tags','phonetic','word_breakdown','usage_note','pattern_examples','pattern_examples_en'];
      const missing = expected.filter(k => !(k in r));
      if (missing.length) {
        console.warn(`Row ${i+2} likely misparsed. Missing: ${missing.join(', ')}. Did a field with commas lack quotes?`, r);
      }
    });

    return rows.map(r => ({
      id: r.id || '',
      front: r.front || r.word || '',
      back: r.back || r.translation || '',
      example: r.example || '',
      image: r.image || '',
      audio: r.audio || '',
      phonetic: r.phonetic || '',
      word_breakdown: r.word_breakdown || '',
      usage_note: r.usage_note || '',
      pattern_examples: r.pattern_examples || '',
      pattern_examples_en: r.pattern_examples_en || '',
      slow_audio: r.slow_audio || '',
      tags: r.tags || '',
    }));
  } catch (err) {
    console.error(err);
    return [];
  }
}
