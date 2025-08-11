/* ===========================
   Minimal SPA with hardcoded decks,
   active deck selection (persisted),
   mobile sidebar, theme toggle, and
   a basic Review page (UI only).
   =========================== */

/* ---- Hardcoded decks (upgrade later) ---- */
const DECKS = [
  { id: 'welsh_basics', name: 'Welsh – Basics', count: 29 },
  { id: 'french_food',  name: 'French – Food',  count: 80  },
  { id: 'verbs_core',   name: 'Core Verbs',     count: 200 },
];

/* ---- Storage keys ---- */
const STORAGE = {
  theme: 'fc_theme',
  deck:  'fc_active_deck',
};

/* ---- State ---- */
const STATE = {
  activeDeckId: loadActiveDeckId(),
};

function loadActiveDeckId() {
  const saved = localStorage.getItem(STORAGE.deck);
  if (saved && DECKS.some(d => d.id === saved)) return saved;
  return DECKS[0].id;
}
function setActiveDeck(id) {
  if (!DECKS.some(d => d.id === id)) return;
  STATE.activeDeckId = id;
  localStorage.setItem(STORAGE.deck, id);
  // sync sidebar select value
  const sel = document.getElementById('deckSelect');
  if (sel) sel.value = id;
  render();
}

/* ---- Deck picker init ---- */
function initDeckPicker() {
  const sel = document.getElementById('deckSelect');
  if (!sel) return;
  sel.innerHTML = '';
  DECKS.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id; opt.textContent = `${d.name} (${d.count})`;
    if (d.id === STATE.activeDeckId) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', e => setActiveDeck(e.target.value));
}

/* ---- Theme persistence (both toggles) ---- */
(function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme);
  if (saved === 'light' || saved === 'dark') document.body.setAttribute('data-theme', saved);
  const isLight = document.body.getAttribute('data-theme') === 'light';

  const wire = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = isLight;
    el.addEventListener('change', (e) => {
      const mode = e.target.checked ? 'light' : 'dark';
      document.body.setAttribute('data-theme', mode);
      localStorage.setItem(STORAGE.theme, mode);
    });
  };
  wire('themeToggle'); wire('themeToggleTop');
})();

/* ---- Router ---- */
const routes = {
  home: renderHome,
  review: renderReview,
  decks: renderDecks,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderPlaceholder('Settings'),
};

async function render() {
  const [route, query] = parseHash();

  // highlight active link
  document.querySelectorAll('.nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  const el = document.getElementById('view');
  const fn = routes[route] || routes.home;

  // call the route; handle both sync and async views
  const maybeNode = fn(query);
  const node = (maybeNode instanceof Promise) ? await maybeNode : maybeNode;

  el.replaceChildren(node);
}


function parseHash() {
  const raw = (location.hash.startsWith('#/') ? location.hash.slice(2) : 'home');
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  return [path || 'home', query];
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
    location.hash = `#/review?mode=quiz&deck=${STATE.activeDeckId}`
  );
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
        <button class="btn" data-id="${d.id}">Set Active</button>
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
  const mode = (query.get('mode') === 'study' ? 'study' : 'quiz');

  // Pick deck from URL or fallback to current state
  const deckId = query.get('deck') && DECKS.some(d => d.id === query.get('deck'))
    ? query.get('deck') : STATE.activeDeckId;
  if (deckId !== STATE.activeDeckId) setActiveDeck(deckId);

  const active = DECKS.find(d => d.id === deckId);

  // Load the deck's card data
  const cards = await loadDeckData(deckId);
  if (!cards.length) {
    const errorWrap = document.createElement('div');
    errorWrap.innerHTML = `<h1>No cards found for ${active.name}</h1>`;
    return errorWrap;
  }

  // For now just show the first card
  const card = cards[0];

  const wrap = document.createElement('div');
wrap.innerHTML = `
  <h1 class="h1">Review <span class="muted">(${mode} • ${active.name})</span></h1>
  <section class="card card--center">
    <div class="flashcard" id="flashcard">
      <div class="flashcard-image" id="fcImg"></div>

      <div class="flashcard-text">
        <div class="term" id="fcTerm"></div>
        <div class="translation hidden" id="fcTrans"></div>
      </div>

      <div class="flashcard-actions">
        <button class="btn nav-btn" id="prevBtn">Previous</button>
        <button class="btn nav-btn" id="audioBtn" style="display:none">Play Audio</button>
        <button class="btn nav-btn" id="nextBtn">Next</button>
        <a class="btn end-btn" href="#/home">End Session</a>
      </div>

      <div class="flashcard-progress muted" id="fcProg"></div>
    </div>
  </section>
`;

let idx = 0;
const img = wrap.querySelector('#fcImg');
const term = wrap.querySelector('#fcTerm');
const trans = wrap.querySelector('#fcTrans');
const prog = wrap.querySelector('#fcProg');
const prevBtn = wrap.querySelector('#prevBtn');
const audioBtn = wrap.querySelector('#audioBtn');
const nextBtn = wrap.querySelector('#nextBtn');

function renderCard() {
  const c = cards[idx];
  // image
  img.innerHTML = c.image
    ? `<img src="${c.image}" alt="${c.front}">`
    : `<div class="no-image muted">No image</div>`;
  // audio
  audioBtn.style.display = c.audio ? '' : 'none';
  if (c.audio) new Audio(c.audio).play();
  // text
  term.textContent = (mode === 'quiz') ? c.back : c.front;
  trans.textContent = (mode === 'quiz') ? c.front : c.back;
  term.classList.remove('hidden');
  trans.classList.add('hidden');
  // progress
  prog.textContent = `Card ${idx + 1} of ${cards.length}`;
}

renderCard();

term.addEventListener('click', () => {
  term.classList.add('hidden');
  trans.classList.remove('hidden');
});
trans.addEventListener('click', () => {
  trans.classList.add('hidden');
  term.classList.remove('hidden');
});
audioBtn.addEventListener('click', () => {
  const c = cards[idx];
  if (c.audio) new Audio(c.audio).play();
});
nextBtn.addEventListener('click', () => {
  idx = (idx + 1) % cards.length;
  renderCard();
});
prevBtn.addEventListener('click', () => {
  idx = (idx - 1 + cards.length) % cards.length;
  renderCard();
});

// keyboard shortcuts
window.onkeydown = (e) => {
  if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); nextBtn.click(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
  if (e.key?.toLowerCase() === 'a') { e.preventDefault(); audioBtn?.click(); }
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
  document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', () => side.classList.remove('open'));
  });
}

/* ---- Boot ---- */
window.addEventListener('DOMContentLoaded', () => {
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange', render);

// Simple CSV parser returning array of objects using the header row for keys
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines
    .filter(line => line.trim().length)
    .map(line => {
      const values = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (values[i] || '').replace(/^\"|\"$/g, '').trim();
      });
      return obj;
    });
}

// Load deck data from CSV file
async function loadDeckData(deckId) {
  try {
    // Only CSV source is used now; JSON loading removed
    const res = await fetch('data/welsh_basics.csv');
    if (!res.ok) throw new Error(`Failed to load deck: ${deckId}`);
    const text = await res.text();
    const rows = parseCSV(text);
    // Map CSV headers to existing card keys. The CSV may use either
    // `front/back` or the older `word/translation` column names.
    return rows.map(r => ({
      front: r.front || r.word,
      back: r.back || r.translation,
      example: r.example,
      image: r.image,
      audio: r.audio,
    }));
  } catch (err) {
    console.error(err);
    return [];
  }
}
