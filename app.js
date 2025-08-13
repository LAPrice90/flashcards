/* ===========================
   Mobile-first card
   Flashcard ⇄ Detailed toggle
   Click-term flip (flash only)
   Single-button fast/slow audio
   =========================== */

// Updated to use the new data file `welsh_phrases_A1.json` which includes
// additional metadata and uses `welsh`/`english` headers instead of
// the previous `front`/`back` pair.
const DECKS = [
  { id: 'welsh_phrases_A1', name: 'Welsh – A1 Phrases', count: 116 }
];

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

// Safe text -> HTML
function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}


/* ---- Router ---- */
const routes = {
  home: renderHome,
  review: renderReview,
  decks: renderDecks,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderPlaceholder('Settings'),
  test: renderTestShell,
  // Provide a stub so the dashboard doesn't render over the
  // dedicated New Phrase flow handled in `js/newPhrase.js`.
  newPhrase: () => document.createElement('div'),
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

/* ========= Dashboard helpers ========= */

// Local attempts (shared with Test Mode)
const LS_ATTEMPTS_KEY = 'tm_attempts_v1';
const LS_NEW_DAILY_PREFIX = 'np_daily_';
const SCORE_WINDOW = 10;

function todayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function loadNewDaily(deckId){
  try{ return JSON.parse(localStorage.getItem(LS_NEW_DAILY_PREFIX+deckId) || '{}'); }catch{ return {}; }
}
function saveNewDaily(deckId,obj){
  localStorage.setItem(LS_NEW_DAILY_PREFIX+deckId, JSON.stringify(obj));
}

function loadAttemptsMap() {
  try { return JSON.parse(localStorage.getItem(LS_ATTEMPTS_KEY) || '{}'); }
  catch { return {}; }
}
function lastNAccuracy(cardId, n = SCORE_WINDOW, map = loadAttemptsMap()) {
  const arr = (map[cardId] || []).slice(0, n);
  if (!arr.length) return 0;
  const p = arr.filter(a => a.pass).length;
  return Math.round((p / arr.length) * 100);
}
function categoryFromPct(pct) {
  if (pct < 50) return 'Struggling';
  if (pct < 80) return 'Needs review';
  return 'Mastered';
}
function dailyNewCount(struggling, maxDaily = 5) {
  if (struggling >= 15) return 0;
  // throttle: 6–10 → 3, 11–14 → 2, <=5 → 5
  if (struggling >= 11) return Math.min(2, maxDaily);
  if (struggling >= 6)  return Math.min(3, maxDaily);
  return Math.min(5, maxDaily);
}

function getDailyNewAllowance(deckId, strugglingCount, unseenCount){
  const key = todayKey();
  const st = loadNewDaily(deckId);
  if (st.date !== key) {
    const allowed = dailyNewCount(strugglingCount); // uses your existing 15-rule
    const cap = Math.min(allowed, unseenCount);
    const fresh = { date:key, allowed:cap, used:0 };
    saveNewDaily(deckId, fresh);
    return fresh;
  }
  // same day: don’t exceed original allowance
  const allowed = Math.min(st.allowed ?? 0, unseenCount);
  return { date:key, allowed, used: st.used ?? 0 };
}

// Tiny JSON loader (local file)
async function loadDeckRows(deckId) {
  // Load the deck JSON which includes extra metadata and explicit Welsh/English headers
  const res = await fetch(`data/${deckId}.json`);
  if (!res.ok) throw new Error('Failed to load deck JSON');
  const data = await res.json();
  const rows = Object.values(data.by_status || {}).flat();
  return rows.map((r, i) => ({
    card: r.card || '',
    unit: r.unit || '',
    section: r.section || '',
    id: r.id || String(i),
    front: r.welsh || r.front || r.word || '',
    back:  r.english || r.back  || r.translation || '',
    tags:  r.tags || '',
  })).filter(r => r.id && r.front);
}

// Hue (red→green) from 0–100%
function accuracyHue(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  // 0 → red(0), 100 → green(120)
  return Math.round((clamped / 100) * 120);
}

/* ========= NEW Home (Dashboard) ========= */

async function renderHome() {
  const deckId = STATE.activeDeckId;
  const active = DECKS.find(d => d.id === deckId);

  // Shell
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Dashboard</h1>
    <div class="muted" style="margin-bottom:8px;">Active deck: <strong>${active.name}</strong></div>

    <!-- CTA / Hero -->
    <section class="card cta-card">
      <div class="cta-left">
        <div class="cta-title" id="cta-title">Welcome back</div>
        <div class="cta-sub muted" id="cta-sub">Let’s keep the streak alive.</div>
      </div>
      <div class="cta-right">
        <button class="btn primary" id="cta-btn">Start</button>
      </div>
    </section>

    <!-- Stat cards -->
    <section class="stats-grid dashboard">
      <div class="card stat" id="stat-review">
        <div class="title">Due for Review</div>
        <div class="big" id="stat-review-num">—</div>
        <button class="btn" id="btn-review">Review Now</button>
      </div>

      <div class="card stat" id="stat-new">
        <div class="title">New Phrases Today</div>
        <div class="big" id="stat-new-num">—</div>
        <button class="btn" id="btn-new">Start New</button>
      </div>

      <div class="card stat" id="stat-test">
        <div class="title">Test Queue</div>
        <div class="big" id="stat-test-num">—</div>
        <button class="btn" id="btn-test">Start Test</button>
      </div>
    </section>

    <!-- Attention chips -->
    <section class="card chips-card">
      <div class="chips-title">What needs your attention</div>
      <div class="chips" id="chips"></div>
    </section>

    <!-- Progress table -->
    <section class="card table-card">
      <div class="table-head">
        <div class="table-title">Progress</div>
        <div class="filters">
          <button class="pill" data-filter="all"  aria-pressed="true">All</button>
          <button class="pill" data-filter="Struggling">Struggling</button>
          <button class="pill" data-filter="Needs review">Needs review</button>
          <button class="pill" data-filter="Mastered">Mastered</button>
          <input class="search" id="searchBox" placeholder="Search…" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="data" id="progressTable">
          <thead>
            <tr>
              <th>Phrase (Welsh)</th>
              <th>Meaning</th>
              <th>Status</th>
              <th>Accuracy (last ${SCORE_WINDOW})</th>
              <th>Last attempts</th>
              <th>Tags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="progressBody">
            <tr><td colspan="7" class="muted">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  // Wire static buttons
  wrap.querySelector('#btn-review').addEventListener('click', () => location.hash = '#/review');
  wrap.querySelector('#btn-new').addEventListener('click', () => location.hash = '#/newPhrase');
  wrap.querySelector('#btn-test').addEventListener('click', () => location.hash = '#/test');

  // Load data
  const attempts = loadAttemptsMap();
  const rows = await loadDeckRows(deckId);

  // Derive per-card metrics
  const enriched = rows.map(r => {
    const arr = attempts[r.id] || [];
    const lastCount = arr.slice(0, SCORE_WINDOW).length;
    if (!arr.length) {
      return { ...r, acc: 0, status: 'Unseen', lastCount };
    }
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = categoryFromPct(acc);
    return { ...r, acc, status, lastCount };
  });

  // Counts
  const unseenCount     = enriched.filter(x => x.status === 'Unseen').length;
  const strugglingCount = enriched.filter(x => x.status === 'Struggling').length;
  const needsCount      = enriched.filter(x => x.status === 'Needs review').length;
  const masteredCount   = enriched.filter(x => x.status === 'Mastered').length;

  const reviewDue = strugglingCount + needsCount; // could add spaced-boost for mastered later
  const daily = getDailyNewAllowance(deckId, strugglingCount, unseenCount);
  // TODO: New Phrase Mode will increment `used` when a new card is completed.
  const newToday  = Math.max(0, (daily.allowed - daily.used));
  const testCount = strugglingCount + Math.ceil(needsCount * 0.3); // simple heuristic

  // Fill stat cards
  wrap.querySelector('#stat-review-num').textContent = reviewDue;
  wrap.querySelector('#stat-new-num').textContent    = newToday;
  wrap.querySelector('#stat-test-num').textContent   = testCount;

  // Color accents by “goodness”
  colorStatCard(wrap.querySelector('#stat-review'), 100 - Math.min(100, reviewDue * 8)); // fewer due → greener
  colorStatCard(wrap.querySelector('#stat-new'), newToday ? 80 : 30);
  colorStatCard(wrap.querySelector('#stat-test'), Math.max(30, 100 - strugglingCount * 6));

  // CTA logic
  const ctaTitle = wrap.querySelector('#cta-title');
  const ctaSub   = wrap.querySelector('#cta-sub');
  const ctaBtn   = wrap.querySelector('#cta-btn');

  if (strugglingCount >= 15 && reviewDue > 0) {
    ctaTitle.textContent = `🔁 ${reviewDue} due for review`;
    ctaSub.textContent   = `You’re juggling ${strugglingCount} struggling items. Let’s stabilise these first.`;
    ctaBtn.textContent   = 'Review now';
    ctaBtn.onclick = () => location.hash = '#/review';
  } else if (newToday > 0) {
    ctaTitle.textContent = `🌱 ${newToday} New Phrase${newToday>1?'s':''} ready`;
    ctaSub.textContent   = `Struggling: ${strugglingCount}. We’ll pace new items accordingly.`;
    ctaBtn.textContent   = 'Start new';
    ctaBtn.onclick = () => location.hash = '#/newPhrase';
  } else if (reviewDue > 0) {
    ctaTitle.textContent = `🔁 ${reviewDue} due for review`;
    ctaSub.textContent   = `Mastered: ${masteredCount}. Keep the momentum.`;
    ctaBtn.textContent   = 'Review now';
    ctaBtn.onclick = () => location.hash = '#/review';
  } else {
    ctaTitle.textContent = '🧪 Test Mode';
    ctaSub.textContent   = 'Quick checks keep recall sharp.';
    ctaBtn.textContent   = 'Start test';
    ctaBtn.onclick = () => location.hash = '#/test';
  }

  // Attention chips (top 6 hardest by accuracy, then recent failures if you track timestamps)
  const chipsBox = wrap.querySelector('#chips');
  chipsBox.innerHTML = '';
  enriched
    .sort((a,b) => a.acc - b.acc)
    .slice(0, 6)
    .forEach(c => {
      const pill = document.createElement('button');
      pill.className = 'chip ' + (c.acc < 50 ? 'bad' : c.acc < 80 ? 'warn' : 'good');
      pill.textContent = `${c.front} • ${c.acc}%`;
      pill.title = c.back;
      pill.addEventListener('click', () => {
        // jump to Test Mode focusing this card (future: pass id via hash if you like)
        location.hash = '#/test';
      });
      chipsBox.appendChild(pill);
    });

  // Progress table
  const tbody = wrap.querySelector('#progressBody');
  const renderRows = (filter = 'all', q = '') => {
    const qlc = q.trim().toLowerCase();
    const list = enriched.filter(r => {
      const matchFilter = (filter === 'all') || (r.status === filter);
      const matchQ = !qlc || r.front.toLowerCase().includes(qlc) || r.back.toLowerCase().includes(qlc);
      return matchFilter && matchQ;
    });
    tbody.innerHTML = '';
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No results.</td></tr>`;
      return;
    }
    list.forEach(r => {
      const tr = document.createElement('tr');
      const hue = accuracyHue(r.acc);
      tr.innerHTML = `
        <td class="w">${escapeHTML(r.front)}</td>
        <td class="e muted">${escapeHTML(r.back)}</td>
        <td><span class="status ${r.status.replace(/\s/g,'-').toLowerCase()}">${r.status}</span></td>
        <td>
          <div class="acc">
            <span>${r.acc}%</span>
            <div class="bar"><span style="width:${r.acc}%; background:hsl(${hue} 70% 45%);"></span></div>
          </div>
        </td>
        <td>${r.lastCount}</td>
        <td>${escapeHTML(r.tags)}</td>
        <td class="actions">
          <button class="btn xs" data-act="study">Study</button>
          <button class="btn xs" data-act="test">Test</button>
        </td>
      `;
      tr.querySelector('[data-act="study"]').addEventListener('click', () => location.hash = '#/review');
      tr.querySelector('[data-act="test"]').addEventListener('click',  () => location.hash = '#/test');
      tbody.appendChild(tr);
    });
  };

  // Filter + search
  let currentFilter = 'all';
  wrap.querySelectorAll('.filters .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.filters .pill').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      currentFilter = btn.dataset.filter;
      renderRows(currentFilter, wrap.querySelector('#searchBox').value || '');
    });
  });
  wrap.querySelector('#searchBox').addEventListener('input', (e) => {
    renderRows(currentFilter, e.target.value || '');
  });

  renderRows(); // first paint

  return wrap;
}

// helper to tint stat cards
function colorStatCard(el, goodnessPct = 50) {
  const hue = accuracyHue(goodnessPct);
  el.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.06), 0 0 0 3px hsl(${hue} 70% 25% / .25) inset`;
}


/* ---- Boot ---- */
window.addEventListener('DOMContentLoaded', () => {
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange', render);
