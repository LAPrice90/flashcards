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
};

const STATE = {
  activeDeckId: loadActiveDeckId(),
  viewMode: loadViewMode(), // 'flash' (default) | 'detail'
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
