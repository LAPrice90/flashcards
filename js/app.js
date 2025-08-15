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
const LS_DAY_START = 'tm_day_start';
const LS_DAY_COUNT = 'tm_day_count';
const LS_DAY_LAST  = 'tm_last_increment';
const SCORE_WINDOW = 10;
const LS_TEST_SESSION = 'tm_session';
const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

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

/* ---------- Theme (locked to light) ---------- */
(function initTheme(){
  document.body.setAttribute('data-theme', 'light');
  // Remove any theme controls if they exist
  ['themeToggle','themeToggleTop'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.closest('label')) el.closest('label').style.display = 'none';
  });
})();


/* ---------- Utils ---------- */
function escapeHTML(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* ---------- Router ---------- */
const routes = {
  home: renderHome,
  phrases: renderPhraseDashboard,
  words: renderComingSoon('Words'),
  songs: renderComingSoon('Songs'),
  stories: renderComingSoon('Stories'),
  conversations: renderComingSoon('Conversations'),
  challenges: renderComingSoon('Challenges'),
  review: renderReview,
  decks: renderComingSoon('Custom Phrases'),
  learned: renderLearned,
  add: renderPlaceholder('Add Cards'),
  stats: renderPlaceholder('Stats'),
  settings: renderSettings,
  test: renderTestShell,
  newPhrase: () => window.renderNewPhrase ? window.renderNewPhrase() : document.createElement('div')
};

async function render() {
  const [route, query] = parseHash();                 // ✅ read current route
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === route || (route === 'phrases' && a.dataset.route === 'home'))
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

  document.addEventListener('click', (e) => {
    if (!side.contains(e.target) && e.target !== btn && side.classList.contains('open')) {
      side.classList.remove('open');
    }
  });

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
function tickDay(){
  const today = todayKey();
  let start = localStorage.getItem(LS_DAY_START);
  if(!start){
    localStorage.setItem(LS_DAY_START, today);
  }
  const last = localStorage.getItem(LS_DAY_LAST);
  if(last !== today){
    const count = parseInt(localStorage.getItem(LS_DAY_COUNT) || '0', 10) + 1;
    localStorage.setItem(LS_DAY_COUNT, String(count));
    localStorage.setItem(LS_DAY_LAST, today);
  }
}
function getDayNumber(){
  return parseInt(localStorage.getItem(LS_DAY_COUNT) || '0', 10);
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

async function fcGetTestQueueCount(){
  const dk = deckKeyFromState();
  const rows = await loadDeckRows(dk);
  const prog = loadProgress(dk);
  const attempts = loadAttemptsMap();
  const seen = prog.seen || {};
  const activeRows = rows.filter(r => seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const session = (()=>{ try{ return JSON.parse(localStorage.getItem(LS_TEST_SESSION) || '{}'); } catch{ return {}; } })();
  const doneSet = new Set(session.done || []);
  const now = Date.now();
  return activeRows.filter(r=>{
    if(doneSet.has(r.id)) return false;
    const arr = attempts[r.id] || [];
    for(let i=arr.length-1;i>=0;i--){
      const a=arr[i];
      if(a.pass){
        if(now - a.ts < SCORE_COOLDOWN_MS) return false;
        break;
      }
    }
    return true;
  }).length;
}
window.fcGetTestQueueCount = fcGetTestQueueCount;

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
function renderSettings(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Settings</h1>`;

  const sub = document.createElement('h2');
  sub.className = 'h2';
  sub.textContent = 'Deck Options';
  wrap.appendChild(sub);

  const list = document.createElement('div');
  list.className = 'row';
  DECKS.forEach(d => {
    const prog = loadProgress(d.id);
    const count = Object.keys(prog.seen || {}).length;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.minWidth = '260px';
    card.innerHTML = `
      <div style="font-weight:700">${d.name}</div>
      <div class="muted">${count} active</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn">Set Active</button>
        <a class="btn" href="#/review?mode=quiz&deck=${d.id}">Review</a>
      </div>`;
    card.querySelector('button').addEventListener('click', () => setActiveDeck(d.id));
    list.appendChild(card);
  });
  wrap.appendChild(list);
  return wrap;
}

async function renderLearned(){
  const dk = deckKeyFromState();
  const deckId = dk;
  const rows = await loadDeckRows(deckId);
  const prog = loadProgress(deckId);
  const attempts = loadAttemptsMap();
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length));

  const data = activeRows.map(r=>{
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = acc >= 80 ? 'Mastered' : 'Needs review';
    const tries = (attempts[r.id]||[]).length;
    return { ...r, acc, status, tries };
  });

  const wrap=document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Learned Phrases</h1>`;
  const table=document.createElement('table');
  table.className='phrase-table';
  table.innerHTML=`<thead><tr>
    <th>Phrase (Welsh)</th>
    <th>Meaning (English)</th>
    <th>Status</th>
    <th>Accuracy</th>
    <th>Last attempts</th>
    <th>Tags</th>
    <th>Actions</th>
  </tr></thead><tbody></tbody>`;
  const tbody=table.querySelector('tbody');
  data.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${escapeHTML(r.front)}</td>
      <td>${escapeHTML(r.back)}</td>
      <td>${r.status}</td>
      <td><div class="progress"><i style="--w:${r.acc}%"></i></div> ${r.acc}%</td>
      <td>${r.tries}</td>
      <td>${escapeHTML(r.tags)}</td>
      <td class="actions"><a class="btn" href="#/review?card=${encodeURIComponent(r.id)}">Study</a> <a class="btn" href="#/test?card=${encodeURIComponent(r.id)}">Test</a></td>`;
    tbody.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}
function renderPlaceholder(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1>`;return div;};
}

function renderComingSoon(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1><p>Coming soon</p>`;return div;};
}

function go(route){
  const [cur] = parseHash();
  if (cur === route) {
    render(); // force re-render when same route
  } else {
    location.hash = '#/' + route;
  }
}



/* ========= Mode selection dashboard ========= */
async function renderHome(){
  const wrap=document.createElement('div');
  wrap.innerHTML=`
    <div class="duo-layout">
      <section class="skills-wrap">
        <div class="skills-grid grid-3">
          <a class="skill" data-target="phrases" href="#/phrases">
            <div class="bubble"><svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFFFFF" d="M8 8C8 5.8 9.8 4 12 4h24c2.2 0 4 1.8 4 4v20c0 2.2-1.8 4-4 4H24Q22 32 20.5 33.5L17 37Q16 38 16 40V32H12C9.8 32 8 30.2 8 28V8Z"/></svg></div>
            <div class="label">Phrases</div>
            <div class="sub">Start</div>
          </a>
          <a class="skill" data-target="words" href="#/words">
            <div class="bubble"><img class="icon" src="media/icons/Words.png" alt="Words icon"></div>
            <div class="label">Words</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="songs" href="#/songs">
            <div class="bubble"><img class="icon" src="media/icons/Songs.png" alt="Songs icon"></div>
            <div class="label">Songs</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="stories" href="#/stories">
            <div class="bubble"><img class="icon" src="media/icons/Stories.png" alt="Stories icon"></div>
            <div class="label">Stories</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="conversations" href="#/conversations">
            <div class="bubble"><img class="icon" src="media/icons/Conversations.png" alt="Conversations icon"></div>
            <div class="label">Conversations</div>
            <div class="sub">Coming soon</div>
          </a>
          <a class="skill" data-target="challenges" href="#/challenges">
            <div class="bubble"><img class="icon" src="media/icons/Challenges.png" alt="Challenges icon"></div>
            <div class="label">Challenges</div>
            <div class="sub">Coming soon</div>
          </a>
        </div>
      </section>
      <aside class="sidebar">
        <div class="panel-white stat-card" id="stat-phrases">
          <div class="panel-title">Phrases</div>
          <div class="ring" id="homePhraseRing"><span id="homePhraseRingTxt">0%</span></div>
          <div class="list">
            <div><span class="k">Today</span> · <span class="v" id="homePhraseToday">0/0</span></div>
            <div><span class="k">Deck progress</span> · <span class="v" id="homePhraseProgLabel">0%</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Words</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Songs</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Stories</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Conversations</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Challenges</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>
      </aside>
    </div>
  `;
  wrap.querySelectorAll('.skill').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.target);}));

  // phrase stats
  const dk = deckKeyFromState();
  const deckId = dk;
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const rows  = await loadDeckRows(deckId);
  const learned = Object.keys(prog.seen || {}).length;
  const deckPct = rows.length ? Math.round((learned/rows.length)*100) : 0;

  const daily = JSON.parse(localStorage.getItem(dailyKey) || '{}');
  const allowed = daily.allowed || 0;
  const used    = daily.used    || 0;
  const pct     = allowed ? Math.round((used/allowed)*100) : 0;

  wrap.querySelector('#homePhraseRing').style.setProperty('--pct', pct + '%');
  wrap.querySelector('#homePhraseRingTxt').textContent = pct + '%';
  wrap.querySelector('#homePhraseToday').textContent = `${used}/${allowed}`;
  wrap.querySelector('#homePhraseProgLabel').textContent = `${deckPct}%`;

  return wrap;
}

/* ========= Dashboard (Duolingo-style) ========= */
async function renderPhraseDashboard(){
  const dk = deckKeyFromState();
  const deckId = dk;
  const active = DECKS.find(d=>d.id===deckId);
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const attempts = JSON.parse(localStorage.getItem(attemptsKey) || '{}');

  // data
  const rows = await loadDeckRows(deckId);
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const unseenRows = rows.filter(r=>!seen[r.id] && !(attempts[r.id] && attempts[r.id].length > 0));
  const unseenCount = unseenRows.length;

  const enriched = activeRows.map(r=>{
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const status = categoryFromPct(acc);
    return { ...r, acc, status };
  });
  const strugglingCount = enriched.filter(x=>x.status==='Struggling').length;
  const needsCount      = enriched.filter(x=>x.status==='Needs review').length;
  const reviewDue       = strugglingCount + needsCount;

  // new phrases allowance
  getDailyNewAllowance(deckId, strugglingCount, unseenCount);
  const daily = JSON.parse(localStorage.getItem(dailyKey) || '{}');
  const allowed = daily.allowed || 0;
  const used    = daily.used    || 0;
  const newToday = Math.max(0, allowed - used);

  const quizCount = activeRows.length;
  const learned   = Object.keys(seen).length;
  const deckPct   = rows.length ? Math.round((learned/rows.length)*100) : 0;

  // UI
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="duo-layout">
      <section>
        <h1 class="h1">Dashboard</h1>
        <div class="muted" style="margin:-6px 0 18px">
          Deck: <strong>${active.name}</strong> · Day <span id="day-count">1</span>
        </div>

        <div class="skills-wrap">
        <div class="skills-grid grid-2">
          <a class="skill" id="sk-new">
            <div class="bubble">
              <img class="icon" src="media/icons/New%20Phrases.png" alt="New Phrases icon">
              <div class="badge" id="b-new">0</div>
            </div>
            <div class="label">New Phrases</div>
            <div class="sub">Start today</div>
          </a>

          <a class="skill" id="sk-review">
            <div class="bubble">
              <img class="icon" src="media/icons/Flashcards.png" alt="Flashcards icon">
              <div class="badge" id="b-review">0</div>
            </div>
            <div class="label">Flashcards</div>
            <div class="sub">SRS review</div>
          </a>

          <a class="skill" id="sk-quiz">
            <div class="bubble">
              <img class="icon" src="media/icons/Quiz.png" alt="Quiz icon">
              <div class="badge" id="b-quiz">0</div>
            </div>
            <div class="label">Quiz</div>
            <div class="sub">Multiple choice / type</div>
          </a>

          <a class="skill" id="sk-all">
            <div class="bubble">
              <img class="icon" src="media/icons/Play%20All.png" alt="Play All icon">
            </div>
            <div class="label">Play All</div>
            <div class="sub">Run modules</div>
          </a>
        </div>
        </div>
      </section>

      <aside class="sidebar">
        <div class="panel-white">
          <div class="panel-title">Daily target</div>
          <div class="ring" id="dailyRing"><span id="ringTxt">0%</span></div>
          <div class="list">
            <div><span class="k">Today</span> · <span class="v" id="dailyLabel">0/0</span></div>
            <div><span class="k">Streak</span> · <span class="v" id="streakNum">–</span></div>
            <div><span class="k">Words learned</span> · <span class="v" id="wordsLearned">–</span></div>
            <div><span class="k">Deck progress</span> · <span class="v" id="deckProg">–</span></div>
          </div>
        </div>

        <div class="panel-white">
          <div class="panel-title">Progress</div>
          <div class="progress" id="xpBar"><i></i></div>
        </div>
      </aside>
    </div>
  `;

  // counts
  wrap.querySelector('#b-new').textContent    = newToday;
  wrap.querySelector('#b-review').textContent = reviewDue;
  wrap.querySelector('#b-quiz').textContent   = quizCount;
  wrap.querySelector('#day-count').textContent = getDayNumber();

  // daily ring
  const pct = allowed ? Math.round((used/allowed)*100) : 0;
  wrap.querySelector('#dailyRing').style.setProperty('--pct', pct + '%');
  wrap.querySelector('#ringTxt').textContent = pct + '%';
  wrap.querySelector('#dailyLabel').textContent = `${used}/${allowed}`;
  wrap.querySelector('#wordsLearned').textContent = learned;
  wrap.querySelector('#deckProg').textContent = `${deckPct}%`;

  // progress bar (use deck progress)
  wrap.querySelector('#xpBar').style.setProperty('--w', deckPct + '%');

  // actions
  wrap.querySelector('#sk-new').addEventListener('click', () => go('newPhrase'));
  wrap.querySelector('#sk-review').addEventListener('click', () => go('review'));
  wrap.querySelector('#sk-quiz').addEventListener('click', () => go('test'));
  wrap.querySelector('#sk-all').addEventListener('click', () => window.runAllDaily && window.runAllDaily());

  return wrap;
}



window.addEventListener('fc:progress-updated', () => {
  if (location.hash === '#/phrases') {
    const view = document.getElementById('view');
    renderPhraseDashboard().then(el => view.replaceChildren(el));
  }
});

window.addEventListener('visibilitychange', () => {
  if (!document.hidden && location.hash === '#/phrases') {
    const view = document.getElementById('view');
    renderPhraseDashboard().then(el => view.replaceChildren(el));
  }
});

/* ---------- stat tint helper ---------- */
function colorStatCard(el,pct=50){
  const hue=accuracyHue(pct);
  el.style.boxShadow=`0 0 0 1px rgba(255,255,255,0.06), 0 0 0 3px hsl(${hue} 70% 25% / .25) inset`;
}

/* --- Run All (sequential modules) --- */
(function(){
  let step = 0; // 0=new, 1=review, 2=test
  function onComplete(e){
    const m = e.detail && e.detail.module;
    if (step === 0 && m === 'new'){ step = 1; go('review'); return; }
    if (step === 1 && m === 'review'){ step = 2; go('test'); return; }
    if (step === 2 && m === 'test'){
      step = 0;
      window.removeEventListener('fc:module-complete', onComplete);
      go('phrases');
    }
  }
  window.runAllDaily = function(){
    step = 0;
    window.addEventListener('fc:module-complete', onComplete);
    go('newPhrase');
  };
})();


/* ---------- Boot ---------- */
window.addEventListener('DOMContentLoaded',()=>{
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange',render);
