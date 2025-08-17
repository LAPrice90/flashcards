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
const LS_ATTEMPTS_KEY = 'tm_attempts_v1';
const LS_DAY_COUNT = 'tm_day_count';
const LS_DAY_LAST  = 'tm_last_increment';
const SCORE_WINDOW = 10;
const LS_TEST_SESSION = 'tm_session';
const SCORE_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
const STRUGGLE_CAP = 10;
const SESSION_MAX = 15;
const { getBucket, BUCKETS, BUCKET_LABELS, getDailyNewAllowance, peekAllowance } = FC_UTILS;

function hideRestrictionToast(){
  const el=document.getElementById('restrictionToast');
  if(!el) return;
  el.remove();
  document.removeEventListener('keydown',onToastKey);
  window.removeEventListener('popstate',hideRestrictionToast);
  window.removeEventListener('hashchange',hideRestrictionToast);
}

function onToastKey(e){ if(e.key==='Escape') hideRestrictionToast(); }

function showRestrictionToast(){
  if(document.getElementById('restrictionToast')) return;
  const toast=document.createElement('div');
  toast.id='restrictionToast';
  toast.setAttribute('aria-live','polite');
  toast.style.position='fixed';
  toast.style.left='50%';
  toast.style.transform='translateX(-50%)';
  toast.style.bottom='calc(env(safe-area-inset-bottom,0) + 20px)';
  toast.style.background='rgba(17,17,17,0.92)';
  toast.style.color='#fff';
  toast.style.padding='10px 14px';
  toast.style.borderRadius='9999px';
  toast.style.maxWidth='88%';
  toast.style.display='flex';
  toast.style.alignItems='center';
  toast.style.gap='8px';
  toast.style.zIndex='1000';
  toast.textContent='Master your current phrases to unlock more.';

  const btn=document.createElement('button');
  btn.setAttribute('aria-label','Close');
  btn.textContent='\u00d7';
  btn.style.width='40px';
  btn.style.height='40px';
  btn.style.marginLeft='8px';
  btn.style.background='transparent';
  btn.style.border='none';
  btn.style.color='#fff';
  btn.style.fontSize='20px';
  btn.style.cursor='pointer';
  btn.addEventListener('click',hideRestrictionToast);
  toast.appendChild(btn);

  document.body.appendChild(toast);
  document.addEventListener('keydown',onToastKey);
  window.addEventListener('popstate',hideRestrictionToast);
  window.addEventListener('hashchange',hideRestrictionToast);
  setTimeout(hideRestrictionToast,4000);
}

function maybeShowRestrictionToast(deckId,restricted){
  const key='np_restrict_state_'+deckId;
  const today=todayKey();
  let stored={};
  try{ stored=JSON.parse(localStorage.getItem(key)||'{}'); }catch{}
  if(restricted){
    const shouldShow=(stored.date!==today)||stored.restricted===false||stored.restricted===undefined;
    localStorage.setItem(key,JSON.stringify({date:today,restricted:true}));
    if(shouldShow) showRestrictionToast();
  }else{
    localStorage.setItem(key,JSON.stringify({date:today,restricted:false}));
  }
}

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
const attemptsKey = 'tm_attempts_v1';          // global attempts

// Backfill introducedAt for cards with attempts but no introduction
function backfillIntroducedAt(){
  let updated = 0;
  let prog;
  try { prog = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}'); }
  catch { prog = { seen:{} }; }
  const attempts = JSON.parse(localStorage.getItem(attemptsKey) || '{}');
  const seen = prog.seen || {};
  Object.keys(attempts).forEach(id => {
    const arr = attempts[id] || [];
    if(!arr.length) return;
    const entry = seen[id] || {};
    if(entry.introducedAt) return;
    const ts = arr[0]?.ts;
    entry.introducedAt = ts ? new Date(ts).toISOString() : new Date().toISOString();
    if(!entry.firstSeen){
      const d = new Date(entry.introducedAt);
      entry.firstSeen = d.toISOString().slice(0,10);
    }
    seen[id] = entry;
    updated++;
  });
  if(updated){
    prog.seen = seen;
    localStorage.setItem(progressKey, JSON.stringify(prog));
  }
  return updated;
}

const _backfilledCount = backfillIntroducedAt();
if(_backfilledCount) console.info(`Backfilled introducedAt for ${_backfilledCount} cards`);

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
  document.querySelectorAll('.deck-select').forEach(sel=>{ sel.value = id; });
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

async function updateStatusPills(){
  const deckId = deckKeyFromState();
  const progressKey = 'progress_' + deckId;
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const attempts = JSON.parse(localStorage.getItem(LS_ATTEMPTS_KEY) || '{}');
  const rows = await loadDeckRows(deckId);
  const seen = prog.seen || {};
  const activeRows = rows.filter(r=>seen[r.id] || (attempts[r.id] && attempts[r.id].length > 0));
  const unseenRows = rows.filter(r=>!seen[r.id] && !(attempts[r.id] && attempts[r.id].length > 0));
  const unseenCount = unseenRows.length;
  const enriched = activeRows.map(r=>{
    const arr = attempts[r.id] || [];
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const meta = deriveAttemptMeta(arr);
    const bucket = getBucket({
      accuracyPct: acc,
      attempts: meta.attempts,
      introducedAt: seen[r.id] && (seen[r.id].introducedAt || seen[r.id].firstSeen)
    });
    return {bucket};
  });
  const strugglingCount = enriched.filter(x=>x.bucket===BUCKETS.STRUGGLING).length;
  const reviewDue       = await fcGetTestQueueCount();
  await fcUpdateQuizBadge(reviewDue);
  const dailyInfo = getDailyNewAllowance(unseenCount, strugglingCount);
  const newToday = dailyInfo.allowed || 0;

  const newEl=document.getElementById('newDisplay');
  if(newEl){
    let txt=`${newToday} new`;
    if(newToday===0 && strugglingCount >= STRUGGLE_CAP){
      txt += ` — Paused — too many struggling (${strugglingCount}/${STRUGGLE_CAP})`;
    }
    newEl.textContent=txt;
  }
  const dueEl=document.getElementById('dueDisplay');
  if(dueEl) dueEl.textContent=`${reviewDue} due`;
}

/* ---------- Deck picker ---------- */
function initDeckPicker() {
  document.querySelectorAll('.deck-select').forEach(sel=>{
    sel.innerHTML='';
    DECKS.forEach(d=>{
      const prog=loadProgress(d.id);
      const count=Object.keys(prog.seen||{}).length;
      const opt=document.createElement('option');
      opt.value=d.id;
      opt.textContent=`${d.name} (${count})`;
      if(d.id===STATE.activeDeckId) opt.selected=true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change',e=>setActiveDeck(e.target.value));
  });
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
  words: renderWordsDashboard,
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
  await updateStatusPills();
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
  let obj;
  try { obj = JSON.parse(localStorage.getItem(progressKey) || '{}'); }
  catch { obj = {}; }
  const seen = obj.seen || {};
  Object.keys(seen).forEach(id => {
    const entry = seen[id] || {};
    const n = typeof entry.interval === 'number' ? entry.interval : 1;
    entry.interval = FC_UTILS.clampInterval(n);
    seen[id] = entry;
  });
  obj.seen = seen;
  return obj;
}
function saveProgress(deckId,obj){
  const dk = deckId || deckKeyFromState();
  const progressKey = LS_PROGRESS_PREFIX + dk;
  localStorage.setItem(progressKey, JSON.stringify(obj));
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
function deriveAttemptMeta(arr){
  const a = arr || [];
  let lastFailAt = 0;
  let lastFails = 0;
  for(let i=a.length-1;i>=0;i--){
    const at=a[i];
    if(at.score === false) continue;
    if(!at.pass){
      if(!lastFailAt) lastFailAt = at.ts || 0;
      lastFails++;
    }else{
      break;
    }
  }
  if(!lastFailAt){
    for(let i=a.length-1;i>=0;i--){
      const at=a[i];
      if(at.pass===false){ lastFailAt = at.ts || 0; break; }
    }
  }
  return { attempts:a.length, lastFails, lastFailAt };
}
function accuracyHue(p){
  const clamped=Math.max(0,Math.min(100,p));
  return Math.round((clamped/100)*120);
}
function tickDay(){
  const today = todayKey();
  const last = localStorage.getItem(LS_DAY_LAST);
  if(last !== today){
    const count = parseInt(localStorage.getItem(LS_DAY_COUNT) || '0', 10) + 1;
    localStorage.setItem(LS_DAY_COUNT, String(count));
    localStorage.setItem(LS_DAY_LAST, today);
    window.fcSaveCloud && window.fcSaveCloud();
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
      if(a.pass && a.score !== false){
        if(now - a.ts < SCORE_COOLDOWN_MS) return false;
        break;
      }
    }
    return true;
  }).length;
}
window.fcGetTestQueueCount = fcGetTestQueueCount;

async function fcUpdateQuizBadge(raw){
  if(raw === undefined) raw = await fcGetTestQueueCount();
  const sessionDue = Math.min(raw, SESSION_MAX);
  const queued = Math.max(raw - SESSION_MAX, 0);
  const badge = document.getElementById('b-quiz');
  if(badge) badge.textContent = sessionDue;
  const pill = document.getElementById('quizQueued');
  if(pill){
    if(queued>0){
      pill.textContent = `+${queued} queued`;
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
    }
  }
}
window.fcUpdateQuizBadge = fcUpdateQuizBadge;

async function getPhraseBuckets(deckId){
  const dk = deckId || deckKeyFromState();
  const prog = JSON.parse(localStorage.getItem('progress_' + dk) || '{"seen":{}}');
  const attempts = loadAttemptsMap();
  const rows = await loadDeckRows(dk);
  const seen = prog.seen || {};
  const counts = { new:0, struggling:0, needsReview:0, mastered:0, total:0 };
  const debug = [];
  rows.forEach(r=>{
    const arr = attempts[r.id] || [];
    const meta = deriveAttemptMeta(arr);
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const introducedAt = seen[r.id] && (seen[r.id].introducedAt || seen[r.id].firstSeen);
    const bucket = getBucket({
      introducedAt,
      attempts: meta.attempts,
      accuracyPct: acc
    });
    if(debug.length < 10){
      debug.push({ id:r.id, introducedAt, attempts: meta.attempts, accuracyPct: acc, bucket });
    }
    if(!bucket) return;
    if(bucket === BUCKETS.NEW) counts.new++;
    else if(bucket === BUCKETS.STRUGGLING) counts.struggling++;
    else if(bucket === BUCKETS.NEEDS_REVIEW) counts.needsReview++;
    else if(bucket === BUCKETS.MASTERED) counts.mastered++;
    counts.total++;
  });
  console.debug('[deck-status]', debug, counts);
  return counts;
}

/* ========= Views ========= */
function renderTestShell(){
  const wrap=document.createElement('div');
  wrap.innerHTML = `
    <section class="learn-card is-quiz">
      <div class="learn-card-header">
        <div class="lc-left"><img src="media/icons/Quiz.png" alt="" class="lc-icon"><h2 class="lc-title">Quiz</h2></div>
        <div class="lc-right"></div>
      </div>
      <div class="learn-card-content card--center"><div id="test-container"></div></div>
    </section>`;
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
    const arr = attempts[r.id] || [];
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const meta = deriveAttemptMeta(arr);
    const bucket = getBucket({
      accuracyPct: acc,
      attempts: meta.attempts,
      introducedAt: seen[r.id] && (seen[r.id].introducedAt || seen[r.id].firstSeen)
    });
    const status = bucket ? BUCKET_LABELS[bucket] : '';
    const tries = meta.attempts;
    return { ...r, acc, status, tries };
  });

  const wrap=document.createElement('div');
  wrap.innerHTML = `<h1 class="h1">Learned Phrases</h1>`;

  // Build dropdown of unique tags from learned phrases
  const tagSet = Array.from(new Set(data.map(r=>r.tags).filter(Boolean))).sort();
  if(tagSet.length){
    const filter=document.createElement('div');
    filter.className='filter-bar';
    const opts = tagSet.map(t=>`<option value="${escapeHTML(t)}">${escapeHTML(t.charAt(0).toUpperCase()+t.slice(1))}</option>`).join('');
    filter.innerHTML=`<label for="tagFilter">Category:</label> <select id="tagFilter" class="deck-select"><option value="">All</option>${opts}</select>`;
    wrap.appendChild(filter);
  }

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

  function renderRows(){
    const sel = wrap.querySelector('#tagFilter');
    const tag = sel ? sel.value : '';
    tbody.innerHTML='';
    const rows = tag ? data.filter(r => (r.tags||'').split(/\s*,\s*/).includes(tag)) : data;
    rows.forEach(r=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td data-label="Phrase (Welsh)">${escapeHTML(r.front)}</td>
        <td data-label="Meaning (English)">${escapeHTML(r.back)}</td>
        <td data-label="Status">${r.status}</td>
        <td data-label="Accuracy"><div class="progress"><i style="--w:${r.acc}%"></i></div> ${r.acc}%</td>
        <td data-label="Last attempts">${r.tries}</td>
        <td data-label="Tags">${escapeHTML(r.tags)}</td>
        <td data-label="Actions" class="actions"><a class="btn" href="#/review?card=${encodeURIComponent(r.id)}">Study</a> <a class="btn" href="#/test?card=${encodeURIComponent(r.id)}">Test</a></td>`;
      tbody.appendChild(tr);
    });
  }

  const selectEl = wrap.querySelector('#tagFilter');
  if(selectEl) selectEl.addEventListener('change', renderRows);
  renderRows();

  wrap.appendChild(table);
  return wrap;
}
function renderPlaceholder(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1>`;return div;};
}

function renderComingSoon(title){
  return ()=>{const div=document.createElement('div');div.innerHTML=`<h1 class="h1">${title}</h1><p>Coming soon</p>`;return div;};
}

function buildPageHeader(icon,title,chips=[],opts={}){
  const header=document.createElement('div');
  header.className='page-header';
  const chipHtml=chips.length?`<div class="ph-chips">${chips.map(c=>`<span class="ph-chip">${c}</span>`).join('')}</div>`:'';
  const play=opts.playAll?`<button class="play-all" id="playAllBtn"><img src="media/icons/Play%20All.png" alt="Play all"></button>`:'';
  header.innerHTML=`
    <div class="ph-main">
      <div class="ph-left">
        <img src="${icon}" alt="" class="ph-icon">
        <h1 class="ph-title">${title}</h1>
      </div>
      ${play}
    </div>
    ${chipHtml}
  `;
  return header;
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
            <div class="bubble"><img class="icon" src="media/icons/Phrases.png" alt="Phrases icon"></div>
            <div class="label">Phrases</div>
            <div class="sub">Start</div>
          </a>
          <a class="skill" data-target="words" href="#/words">
            <div class="bubble"><img class="icon" src="media/icons/Words.png" alt="Words icon"></div>
            <div class="label">Words</div>
            <div class="sub">Start</div>
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
          <div class="donut-chart">
            <canvas id="deckStatusChart" role="img"></canvas>
            <div class="donut-center" id="deckStatusTotal">0</div>
          </div>
          <div class="donut-legend" id="deckStatusLegend"></div>
          <div class="list">
            <div><span class="k">Today</span> · <span class="v" id="dailyLabel">0/0</span></div>
            <div><span class="k">Streak</span> · <span class="v" id="streakNum">–</span></div>
            <div><span class="k">Words learned</span> · <span class="v" id="wordsLearned">–</span></div>
            <div><span class="k">Deck progress</span> · <span class="v" id="deckProg">–</span></div>
          </div>
        </div>
        <div class="panel-white stat-card">
          <div class="panel-title">Progress</div>
          <div class="progress" id="xpBar"><i></i></div>
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
  const dk=deckKeyFromState();
  const active=DECKS.find(d=>d.id===dk)||{};
  wrap.prepend(buildPageHeader('media/icons/flag.png','Dashboard'));
  wrap.querySelectorAll('.skill').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.target);}));

  // phrase stats
  const deckId = dk;
  const prog  = JSON.parse(localStorage.getItem(progressKey) || '{"seen":{}}');
  const rows  = await loadDeckRows(deckId);
  const learned = Object.keys(prog.seen || {}).length;
  const deckPct = rows.length ? Math.round((learned/rows.length)*100) : 0;
  const allowance = peekAllowance();
  const used    = SETTINGS.newPerDay - (allowance.remaining || 0);

  wrap.querySelector('#dailyLabel').textContent = `${used}/${SETTINGS.newPerDay}`;
  wrap.querySelector('#wordsLearned').textContent = learned;
  wrap.querySelector('#deckProg').textContent = `${deckPct}%`;
  const buckets = await getPhraseBuckets(deckId);
  const total = buckets.total;
  wrap.querySelector('#deckStatusTotal').textContent = total;
  const canvas = wrap.querySelector('#deckStatusChart');
  const legendEl = wrap.querySelector('#deckStatusLegend');
  if(typeof Chart !== 'undefined'){
    if(total === 0){
      new Chart(canvas.getContext('2d'),{
        type:'doughnut',
        data:{datasets:[{data:[1],backgroundColor:['#E0E0E0'],borderWidth:0}]},
        options:{cutout:'64%',plugins:{legend:{display:false},tooltip:{enabled:false}}}
      });
      legendEl.textContent = 'No active phrases yet';
      legendEl.classList.add('muted');
      canvas.setAttribute('aria-label','No active phrases yet');
    }else{
      const labels=['Mastered','Needs review','Struggling','New'];
      const data=[buckets.mastered,buckets.needsReview,buckets.struggling,buckets.new];
      const colors=['#0B8457','#FFB200','#D7263D','#1E88E5'];
      new Chart(canvas.getContext('2d'),{
        type:'doughnut',
        data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0}]},
        options:{cutout:'64%',plugins:{legend:{display:false},tooltip:{enabled:false}},responsive:true,maintainAspectRatio:false}
      });
      legendEl.innerHTML = labels.map((l,i)=>`<span class="item"><span class="dot" style="background:${colors[i]}"></span>${l} ${data[i]}</span>`).join('');
      legendEl.classList.remove('muted');
      canvas.setAttribute('aria-label', labels.map((l,i)=>`${l} ${data[i]}`).join(', '));
    }
  }
  wrap.querySelector('#xpBar').style.setProperty('--w', deckPct + '%');

  return wrap;
}

async function renderWordsDashboard(){
  const tabs=[
    {key:'days',label:'Days',icon:'Days'},
    {key:'months',label:'Months',icon:'Months'},
    {key:'numbers',label:'Numbers',icon:'Numbers'},
    {key:'colours',label:'Colours',icon:'Colours'},
    {key:'animals',label:'Animals',icon:'Animals'}
  ];
  const wrap=document.createElement('div');
  wrap.innerHTML=`
    <div class="duo-layout">
      <section class="skills-wrap">
        <div class="skills-grid grid-3">
          ${tabs.map(t=>`
            <a class="skill" href="#/words?tab=${t.key}">
              <div class="bubble"><img class="icon" src="media/icons/${t.icon}.png" alt="${t.label} icon"></div>
              <div class="label">${t.label}</div>
              <div class="sub">Coming soon</div>
            </a>`).join('')}
        </div>
      </section>
      <aside class="sidebar">
        ${tabs.map(t=>`
        <div class="panel-white stat-card">
          <div class="panel-title">${t.label}</div>
          <div class="list">
            <div><span class="k">Coming soon</span></div>
          </div>
        </div>`).join('')}
      </aside>
    </div>
  `;
  wrap.prepend(buildPageHeader('media/icons/Words.png','Words'));
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
    const arr = attempts[r.id] || [];
    const acc = lastNAccuracy(r.id, SCORE_WINDOW, attempts);
    const meta = deriveAttemptMeta(arr);
    const bucket = getBucket({
      accuracyPct: acc,
      attempts: meta.attempts,
      introducedAt: seen[r.id] && (seen[r.id].introducedAt || seen[r.id].firstSeen)
    });
    return { ...r, acc, bucket };
  });
  const strugglingCount = enriched.filter(x=>x.bucket===BUCKETS.STRUGGLING).length;
  const reviewDue       = await fcGetTestQueueCount();
  const quizToday       = Math.min(reviewDue, SESSION_MAX);
  const quizQueued      = Math.max(reviewDue - SESSION_MAX, 0);

  // new phrases allowance
  const dailyInfo = getDailyNewAllowance(unseenCount, strugglingCount);
  const newToday = dailyInfo.allowed || 0;
  const restrictedDay = dailyInfo.baseAllowed < SETTINGS.newPerDay && newToday > 0;
  const allowanceState = peekAllowance();
  const used = SETTINGS.newPerDay - (allowanceState.remaining || 0);

  let bannerText = '';
  if (restrictedDay) {
    bannerText = 'New phrases reduced';
  } else if (newToday === 0 && strugglingCount >= STRUGGLE_CAP) {
    bannerText = 'New phrases paused';
  }

  const quizCount = quizToday;
  const learned   = Object.keys(seen).length;
  const deckPct   = rows.length ? Math.round((learned/rows.length)*100) : 0;

  // UI
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="duo-layout">
      <section>
        <div class="skills-wrap">
        ${bannerText ? '<div class="practice-banner">' + bannerText + '</div>' : ''}
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
            <div class="sub">Multiple choice / type <span class="queued-pill hidden" id="quizQueued"></span></div>
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
          <div class="panel-title">Deck status</div>
          <div class="donut-chart">
            <canvas id="deckStatusChart" role="img"></canvas>
            <div class="donut-center" id="deckStatusTotal">0</div>
          </div>
          <div class="donut-legend" id="deckStatusLegend"></div>
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
  wrap.prepend(buildPageHeader('media/icons/Phrases.png','Phrases',[],{playAll:true}));

  // counts
  wrap.querySelector('#b-new').textContent    = newToday;
  wrap.querySelector('#b-review').textContent = reviewDue;
  wrap.querySelector('#b-quiz').textContent   = quizCount;
  const newBadge = wrap.querySelector('#b-new');
  if (restrictedDay) {
    newBadge.classList.add('restricted');
    newBadge.setAttribute('aria-label','Restricted: master current phrases to unlock more.');
  } else {
    newBadge.classList.remove('restricted');
    newBadge.removeAttribute('aria-label');
  }
  wrap.querySelector('#sk-new .sub').textContent = newToday > 0 ? 'Start today' : 'Come back tomorrow';
  maybeShowRestrictionToast(deckId, restrictedDay);
  if (quizQueued > 0) {
    const qp = wrap.querySelector('#quizQueued');
    qp.textContent = `+${quizQueued} queued`;
    qp.classList.remove('hidden');
  }

  // deck status donut
  wrap.querySelector('#dailyLabel').textContent = `${used}/${SETTINGS.newPerDay}`;
  wrap.querySelector('#wordsLearned').textContent = learned;
  wrap.querySelector('#deckProg').textContent = `${deckPct}%`;
  const buckets = await getPhraseBuckets(deckId);
  const total = buckets.total;
  wrap.querySelector('#deckStatusTotal').textContent = total;
  const canvas = wrap.querySelector('#deckStatusChart');
  const legendEl = wrap.querySelector('#deckStatusLegend');
  if(typeof Chart !== 'undefined'){
    if(total === 0){
      new Chart(canvas.getContext('2d'),{
        type:'doughnut',
        data:{datasets:[{data:[1],backgroundColor:['#E0E0E0'],borderWidth:0}]},
        options:{cutout:'64%',plugins:{legend:{display:false},tooltip:{enabled:false}}}
      });
      legendEl.textContent = 'No active phrases yet';
      legendEl.classList.add('muted');
      canvas.setAttribute('aria-label','No active phrases yet');
    }else{
      const labels=['Mastered','Needs review','Struggling','New'];
      const data=[buckets.mastered,buckets.needsReview,buckets.struggling,buckets.new];
      const colors=['#0B8457','#FFB200','#D7263D','#1E88E5'];
      new Chart(canvas.getContext('2d'),{
        type:'doughnut',
        data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0}]},
        options:{cutout:'64%',plugins:{legend:{display:false},tooltip:{enabled:false}},responsive:true,maintainAspectRatio:false}
      });
      legendEl.innerHTML = labels.map((l,i)=>`<span class="item"><span class="dot" style="background:${colors[i]}"></span>${l} ${data[i]}</span>`).join('');
      legendEl.classList.remove('muted');
      canvas.setAttribute('aria-label', labels.map((l,i)=>`${l} ${data[i]}`).join(', '));
    }
  }

  // progress bar (use deck progress)
  wrap.querySelector('#xpBar').style.setProperty('--w', deckPct + '%');

  // actions
  wrap.querySelector('#sk-new').addEventListener('click', () => go('newPhrase'));
  wrap.querySelector('#sk-review').addEventListener('click', () => go('review'));
  wrap.querySelector('#sk-quiz').addEventListener('click', () => go('test'));
  wrap.querySelector('#sk-all').addEventListener('click', () => window.runAllDaily && window.runAllDaily());
  const pbtn=wrap.querySelector('#playAllBtn');
  if(pbtn) pbtn.addEventListener('click',()=>window.runAllDaily&&window.runAllDaily());

  return wrap;
}



window.addEventListener('fc:progress-updated', () => {
  updateStatusPills();
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
  tickDay();
  document.querySelectorAll('.day-display').forEach(el => {
    el.textContent = getDayNumber();
  });
  initDeckPicker();
  initMobileMenu();
  render();
});
window.addEventListener('hashchange',render);
