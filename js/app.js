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
const LS_START_KEY = 'tm_start_date';
const SCORE_WINDOW = 10;

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
  return localStorage.getItem(STORAGE.examplesEN) === 'true';
}
function setExamplesEN(v) {
  STATE.showExamplesEN = !!v;
  localStorage.setItem(STORAGE.examplesEN, String(!!v));
}

/* ---------- Deck picker ---------- */
function initDeckPicker() {
  const sel = document.getElementById('deckSelect');
  if (!sel) return;
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
}

/* ---------- Theme ---------- */
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
    el.addEventListener('change', e => {
      const mode = e.target.checked ? 'light' : 'dark';
      document.body.setAttribute('data-theme', mode);
      localStorage.setItem(STORAGE.theme, mode);
    });
  });
})();

/* ---------- Utils ---------- */
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---------- Router ---------- */
const routes = {
  home: renderHome,
  review: renderReview,
  decks: renderDecks,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderPlaceholder('Settings'),
  test: renderTestShell,
  newPhrase: () => window.renderNewPhrase ? window.renderNewPhrase() : document.createElement('div')
};

async function render() {
  const [route, query] = parseHash();                 // ✅ read current route
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

/* ---------- Mobile menu ---------- */
function initMobileMenu() {
  const btn = document.getElementById('menuToggle');
  const side = document.querySelector('.side');
  if (!btn || !side) return;

  btn.addEventListener('click', () => side.classList.toggle('open'));

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
function getDayNumber(){
  const today = todayKey();
  let start = localStorage.getItem(LS_START_KEY);
  if(!start){
    localStorage.setItem(LS_START_KEY, today);
    return 1;
  }
  const diff = Math.floor((new Date(today) - new Date(start))/86400000);
  return diff + 1;
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

function getDailyNewAllowance(deckId, strugglingCount, unseenCount){
  const key = todayKey();
  let st = loadNewDaily(deckId);
  const cap = SETTINGS.newPerDay; // e.g., 5

  // New day OR nothing stored → start fresh
  if (st.date !== key) {
    const allowed = Math.min(cap, unseenCount);
    st = { date: key, allowed, used: 0 };
    saveNewDaily(deckId, st);
    return st;
  }

  // Always clamp to cap and unseen
  const allowed = Math.min(st.allowed ?? 0, cap, unseenCount);
  const used    = Math.min(st.used ?? 0, allowed);

  // If everything is mastered, keep today's numbers but cap correctly
  const out = { date: key, allowed, used };
  if (out.allowed !== st.allowed || out.used !== st.used) saveNewDaily(deckId, out);
  return out;
}
/* ========= Views ========= */
function renderTestShell(){
  const wrap=document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Test Mode</h1>
    <section class="card card--center"><div id="test-container"></div></section>`;
  return wrap;
}
function renderDecks(){
  const wrap=document.createElement('div');
  wrap.innerHTML=`<h1 class="h1">Decks</h1>`;
  const list=document.createElement('div');
  list.className='row';
  DECKS.forEach(d=>{
    const prog=loadProgress(d.id);
    const count=Object.keys(prog.seen||{}).length;
    const card=document.createElement('div');
    card.className='card';
    card.style.minWidth='260px';
    card.innerHTML=`
      <div style="font-weight:700">${d.name}</div>
      <div class="muted">${count} active</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn">Set Active</button>
        <a class="btn" href="#/review?mode=quiz&deck=${d.id}">Review</a>
      </div>`;
    card.querySelector('button').addEventListener('click',()=>setActiveDeck(d.id));
    list.appendChild(card);
  });
  wrap.appendChild(list);
  return wrap;
}
function renderPlaceholder(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1>`;return div;};
}

function go(route){
  const [cur] = parseHash();
  if (cur === route) {
    render(); // force re-render when same route
  } else {
    location.hash = '#/' + route;
  }
}



/* ========= Dashboard ========= */
async function renderHome(){
  const dk = deckKeyFromState();
  const deckId = dk;
  const active = DECKS.find(d=>d.id===deckId);
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const attempts = JSON.parse(localStorage.getItem(attemptsKey) || '{}');

  (function migrateDailyIfNeeded(){
    const canonical = 'np_daily_' + dk;
    const legacy    = 'np_daily_' + ((STATE && STATE.activeDeckId) || '');
    if (canonical !== legacy) {
      const legacyVal = localStorage.getItem(legacy);
      const nothing = localStorage.getItem(canonical);
      if (legacyVal && !nothing) localStorage.setItem(canonical, legacyVal);
    }
  })();

  const wrap=document.createElement('div');
  wrap.innerHTML = `
    <h1 class="h1">Dashboard</h1>
    <div class="muted" style="margin-bottom:8px;">
      Active deck: <strong>${active.name}</strong> · Day <span id="day-count">1</span>
    </div>
    <section class="card cta-card">
      <div class="cta-left">
        <div class="cta-title" id="cta-title">Welcome back</div>
        <div class="cta-sub muted" id="cta-sub">Let's keep the streak alive.</div>
      </div>
      <div class="cta-right">
        <button class="btn primary" id="cta-btn">Start</button>
      </div>
    </section>
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
    <section class="card chips-card">
      <div class="chips-title">What needs your attention</div>
      <div class="chips" id="chips"></div>
    </section>
    <section class="card table-card">
      <div class="table-head">
        <div class="table-title">Progress</div>
        <div class="filters">
          <button class="pill" data-filter="today" aria-pressed="true">Today</button>
          <button class="pill" data-filter="All">All</button>
          <button class="pill" data-filter="Struggling">Struggling</button>
          <button class="pill" data-filter="Needs review">Needs review</button>
          <button class="pill" data-filter="Mastered">Mastered</button>
          <input class="search" id="searchBox" placeholder="Search…"/>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data" id="progressTable">
          <thead>
            <tr>
              <th>Phrase (Welsh)</th><th>Meaning</th><th>Status</th>
              <th>Accuracy (last ${SCORE_WINDOW})</th><th>Last attempts</th>
              <th>Tags</th><th>Actions</th>
            </tr>
          </thead>
          <tbody id="progressBody">
            <tr><td colspan="7" class="muted">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </section>`;

  // was: ()=>location.hash='#/review'
  wrap.querySelector('#btn-review').addEventListener('click', () => go('review'));
  // was: ()=>location.hash='#/newPhrase'
  wrap.querySelector('#btn-new').addEventListener('click', () => go('newPhrase'));
  // was: ()=>location.hash='#/test'
  wrap.querySelector('#btn-test').addEventListener('click', () => go('test'));


  const rows = await loadDeckRows(deckId);
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const unseenRows = rows.filter(r=>!seen[r.id] && !(attempts[r.id] && attempts[r.id].length > 0));
  const unseenCount = unseenRows.length;

  const enriched = activeRows.map(r=>{
    const arr = (attempts[r.id] || []).filter(a => a.score !== false);
    const acc = lastNAccuracy(r.id,SCORE_WINDOW,attempts);
    const status = categoryFromPct(acc);
    return {...r, acc, status, lastCount: arr.slice(-SCORE_WINDOW).length};
  });

  const strugglingCount = enriched.filter(x=>x.status==='Struggling').length;
  const needsCount      = enriched.filter(x=>x.status==='Needs review').length;
  const masteredCount   = enriched.filter(x=>x.status==='Mastered').length;
  const reviewDue = strugglingCount + needsCount;
  const allMastered = enriched.length > 0 && reviewDue === 0;
  getDailyNewAllowance(deckId, strugglingCount, unseenCount);
  const daily2 = JSON.parse(localStorage.getItem(dailyKey) || '{}');
  const newToday = Math.max(0, (daily2.allowed || 0) - (daily2.used || 0));
  console.log('[daily]', deckKeyFromState(), daily2);

  let newRemaining = newToday;
  const todayList = [];
  for(const r of rows){
    if(seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0)){
      const arr = (attempts[r.id] || []).filter(a => a.score !== false);
      const acc = lastNAccuracy(r.id,SCORE_WINDOW,attempts);
      const status = categoryFromPct(acc);
      todayList.push({...r, acc, status, lastCount: arr.slice(-SCORE_WINDOW).length});
    } else if(newRemaining > 0){
      todayList.push({...r, acc:0, status:'Unseen', lastCount:0});
      newRemaining--;
    }
  }

  const testCount = activeRows.length;

  wrap.querySelector('#stat-review-num').textContent = reviewDue;
  wrap.querySelector('#stat-new-num').textContent = newToday;
  wrap.querySelector('#stat-test-num').textContent = testCount;
  wrap.querySelector('#day-count').textContent = getDayNumber();

  colorStatCard(wrap.querySelector('#stat-review'), 100 - Math.min(100, reviewDue * 8));
  colorStatCard(wrap.querySelector('#stat-new'), newToday ? 80 : 30);
  colorStatCard(wrap.querySelector('#stat-test'), Math.max(30, 100 - strugglingCount * 6));

  const ctaTitle = wrap.querySelector('#cta-title');
  const ctaSub = wrap.querySelector('#cta-sub');
  const ctaBtn = wrap.querySelector('#cta-btn');

  if (strugglingCount >= 15 && reviewDue > 0) {
    ctaTitle.textContent = `🔁 ${reviewDue} due for review`;
    ctaSub.textContent = `You’re juggling ${strugglingCount} struggling items. Let’s stabilise these first.`;
    ctaBtn.textContent = 'Review now';
    ctaBtn.onclick = () => go('review');
  } else if (newToday > 0) {
    ctaTitle.textContent = `🌱 ${newToday} New Phrase${newToday>1?'s':''} ready`;
    ctaSub.textContent = `Struggling: ${strugglingCount}. We’ll pace new items accordingly.`;
    ctaBtn.textContent = 'Start new';
    ctaBtn.onclick = () => go('newPhrase');
  } else if (reviewDue > 0) {
    ctaTitle.textContent = `🔁 ${reviewDue} due for review`;
    ctaSub.textContent = `Mastered: ${masteredCount}. Keep the momentum.`;
    ctaBtn.textContent = 'Review now';
    ctaBtn.onclick = () => go('test');
  } else {
    ctaTitle.textContent = '🧪 Test Mode';
    ctaSub.textContent = 'Quick checks keep recall sharp.';
    ctaBtn.textContent = 'Start test';
    ctaBtn.onclick = () => go('test');
  }

  const chipsBox = wrap.querySelector('#chips');
  chipsBox.innerHTML = '';
  todayList.slice(0,6).forEach(c=>{
    const pill=document.createElement('button');
    pill.className='chip '+(c.acc<50?'bad':c.acc<80?'warn':'good');
    pill.textContent=`${c.front} • ${c.acc}%`;
    pill.title=c.back;
    pill.addEventListener('click', () => go('test'));
    chipsBox.appendChild(pill);
  });

  const tbody = wrap.querySelector('#progressBody');
  let baseList = todayList;
  const renderRows = (filter='today',q='')=>{
    if(filter==='today') baseList = todayList;
    else if(filter==='All') baseList = enriched;
    else if(filter==='Struggling') baseList=enriched.filter(x=>x.status==='Struggling');
    else if(filter==='Needs review') baseList=enriched.filter(x=>x.status==='Needs review');
    else if(filter==='Mastered') baseList=enriched.filter(x=>x.status==='Mastered');
    else baseList = enriched;
    const qlc=q.trim().toLowerCase();
    const list=baseList.filter(r=>!qlc || r.front.toLowerCase().includes(qlc) || r.back.toLowerCase().includes(qlc));
    tbody.innerHTML='';
    if(!list.length){
      tbody.innerHTML=`<tr><td colspan="7" class="muted">No results.</td></tr>`;
      return;
    }
    list.forEach(r=>{
      const tr=document.createElement('tr');
      const hue=accuracyHue(r.acc);
      tr.innerHTML=`
        <td class="w">${escapeHTML(r.front)}</td>
        <td class="e muted">${escapeHTML(r.back)}</td>
        <td><span class="status ${r.status.replace(/\\s/g,'-').toLowerCase()}">${r.status}</span></td>
        <td><div class="acc"><span>${r.acc}%</span><div class="bar"><span style="width:${r.acc}%; background:hsl(${hue} 70% 45%);"></span></div></div></td>
        <td>${r.lastCount}</td>
        <td>${escapeHTML(r.tags)}</td>
        <td class="actions"><button class="btn xs" data-act="study">Study</button><button class="btn xs" data-act="test">Test</button></td>`;
      tr.querySelector('[data-act="study"]').addEventListener('click',()=>location.hash='#/review');
      tr.querySelector('[data-act="test"]').addEventListener('click',()=>location.hash='#/test');
      tbody.appendChild(tr);
    });
  };

  let currentFilter='today';
  wrap.querySelectorAll('.filters .pill').forEach(btn=>{
    btn.addEventListener('click',()=>{
      wrap.querySelectorAll('.filters .pill').forEach(b=>b.setAttribute('aria-pressed','false'));
      btn.setAttribute('aria-pressed','true');
      currentFilter=btn.dataset.filter;
      renderRows(currentFilter, wrap.querySelector('#searchBox').value || '');
    });
  });
  wrap.querySelector('#searchBox').addEventListener('input',e=>{
    renderRows(currentFilter, e.target.value || '');
  });

  renderRows();
  return wrap;
}

window.addEventListener('fc:progress-updated', () => {
  if (location.hash === '' || location.hash === '#/' || location.hash === '#/home') {
    const view = document.getElementById('view');
    renderHome().then(el => view.replaceChildren(el));
  }
});

/* ---------- stat tint helper ---------- */
function colorStatCard(el,pct=50){
  const hue=accuracyHue(pct);
  el.style.boxShadow=`0 0 0 1px rgba(255,255,255,0.06), 0 0 0 3px hsl(${hue} 70% 25% / .25) inset`;
}

/* ---------- Boot ---------- */
window.addEventListener('DOMContentLoaded',()=>{
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange',render);
