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
const SCORE_WINDOW = 10;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lastNAccuracy(cardId, n = SCORE_WINDOW, map = loadAttempts()){
  const raw = map[cardId] || [];
  const scored = raw.filter(a => a.score !== false);
  const arr = scored.slice(-n);
  if (!arr.length) return 0;
  const p = arr.filter(a => a.pass).length;
  return Math.round((p / arr.length) * 100);
}

function logAttempt(cardId, pass){
  const obj = loadAttempts();
  const arr = obj[cardId] || [];
  const now = Date.now();
  let score = true;
  if (pass) {
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
}

async function renderReview(query) {
  // We keep 'mode' param but always start with Welsh front in flashcards
  const deckId = query.get('deck') && DECKS.some(d => d.id === query.get('deck'))
    ? query.get('deck') : STATE.activeDeckId;
  if (deckId !== STATE.activeDeckId) setActiveDeck(deckId);

  const dk = deckKeyFromState();
  const activeDeck = DECKS.find(d => d.id === dk);
  const deck = await loadDeckSorted(dk);
  const seen = loadProgressSeen();
  const attempts = loadAttempts();
  let cards = deck.filter(c => isActiveCard(c.id, seen, attempts));
  cards.forEach(c => { c.conf = lastNAccuracy(c.id, SCORE_WINDOW, attempts); });
  const groups = {};
  cards.forEach(c => (groups[c.conf] = groups[c.conf] || []).push(c));
  const confKeys = Object.keys(groups).map(Number).sort((a,b) => a - b);
  cards = confKeys.flatMap(conf => shuffle(groups[conf]));
  console.log('[active-count]', deckKeyFromState(), cards.length);
  console.log('[progress-key-used]', progressKey);

  if (!cards.length) {
    const err = document.createElement('div');
    err.innerHTML = `<section class="learn-card is-flashcards"><div class="learn-card-header"><div class="lc-left"><img src="media/icons/Flashcards.png" alt="" class="lc-icon"><h2 class="lc-title">Flashcards</h2></div></div><div class="learn-card-content card--center">No introduced cards. Use New Phrases first.</div></section>`;
    return err;
  }

  // UI state
  let idx = 0;
  const startId = query.get('card');
  if (startId) {
    const i = cards.findIndex(c => c.id === startId);
    if (i >= 0) idx = i;
  }
  let showBack = false;   // front(Welsh) → back(English) in flash mode
  let slowNext = false;   // audio alternator

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <section class="learn-card is-flashcards">
      <div class="learn-card-header">
        <div class="lc-left"><img src="media/icons/Flashcards.png" alt="" class="lc-icon"><h2 class="lc-title">Flashcards</h2></div>
        <div class="lc-right"><button class="fc-expand-btn" id="detailToggle" aria-expanded="false" aria-controls="fcDetails" aria-label="Show details">+</button></div>
      </div>
      <div class="learn-card-content card--center">
        <div class="flashcard" id="flashcard">

        <div class="flashcard-image" id="fcImg"></div>

        <div class="fc-phrase">
          <div class="term" id="fcTerm" title="Tap to flip"></div>
          <button class="btn audio-btn play-btn" id="audioBtn" title="Play (alternates fast/slow)">🔊 Play</button>
        </div>

        <div class="fc-details" id="fcDetails" hidden tabindex="-1">
          <div class="phonetic" id="fcPhon"></div>
          <div class="translation" id="fcTrans"></div>
          <div class="breakdown" id="fcBreak"></div>
          <div class="usage" id="fcUsage"></div>
          <div class="example" id="fcExample"></div>
          <div class="patterns" id="fcPatterns"></div>
        </div>

        <div class="flashcard-actions">
          <button class="btn nav-btn" id="prevBtn">Previous</button>
          <button class="btn nav-btn" id="nextBtn">Next</button>
          <a class="btn end-btn" href="#/phrases">End Session</a>
        </div>

        <div class="flashcard-progress muted" id="fcProg"></div>
        </div>
      </div>
    </section>
  `;

  const root       = wrap.querySelector('#flashcard');
  const imgEl      = wrap.querySelector('#fcImg');
  const termEl     = wrap.querySelector('#fcTerm');
  const phonEl     = wrap.querySelector('#fcPhon');
  const transEl    = wrap.querySelector('#fcTrans');
  const brkEl      = wrap.querySelector('#fcBreak');
  const useEl      = wrap.querySelector('#fcUsage');
  const exEl       = wrap.querySelector('#fcExample');
  const patEl      = wrap.querySelector('#fcPatterns');
  const detailsEl  = wrap.querySelector('#fcDetails');
  const expandBtn  = wrap.querySelector('#detailToggle');
  const prevBtn    = wrap.querySelector('#prevBtn');
  const nextBtn    = wrap.querySelector('#nextBtn');
  const audioBtn   = wrap.querySelector('#audioBtn');
  const progEl     = wrap.querySelector('#fcProg');

  // expand/collapse details
  const expanded = {};
  function applyExpand(expand, animate){
    expandBtn.textContent = expand ? '−' : '+';
    expandBtn.setAttribute('aria-label', expand ? 'Hide details' : 'Show details');
    expandBtn.setAttribute('aria-expanded', expand);
    if (expand) {
      detailsEl.hidden = false;
      if (animate) {
        requestAnimationFrame(() => {
          detailsEl.style.maxHeight = '800px';
          detailsEl.style.opacity = '1';
        });
      } else {
        detailsEl.style.maxHeight = '800px';
        detailsEl.style.opacity = '1';
      }
    } else {
      if (animate) {
        detailsEl.style.maxHeight = '0';
        detailsEl.style.opacity = '0';
        detailsEl.addEventListener('transitionend', () => { detailsEl.hidden = true; }, { once: true });
      } else {
        detailsEl.style.maxHeight = '0';
        detailsEl.style.opacity = '0';
        detailsEl.hidden = true;
      }
    }
  }
  expandBtn.addEventListener('click', () => {
    const c = cards[idx];
    const now = !expanded[c.id];
    expanded[c.id] = now;
    applyExpand(now, true);
    if (now) detailsEl.focus();
  });

  // audio helpers
  function stopAudio() {
    if (window.fcAudio) window.fcAudio.stop();
  }
  function playAudio(src) {
    if (!src) return;
    stopAudio();
    const rate = slowNext ? 0.6 : 1.0; // alternate fast/slow
    if (window.fcAudio) window.fcAudio.play(src, rate);
    slowNext = !slowNext;
  }

  // parsing helpers
  const parsePairs = s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);
  const parsePatterns = s => {
    if (!s) return [];
    // support '|', '/', or ',' as separators
    const sep = s.includes('|') ? '|' : (s.includes('/') ? '/' : ',');
    return s.split(sep).map(x => x.trim()).filter(Boolean);
  };


  // render card
  function renderCard() {
    const c = cards[idx];
    const isExpanded = !!expanded[c.id];

    // image
    imgEl.innerHTML = c.image
      ? `<img src="${c.image}" alt="${c.front}">`
      : `<div class="no-image muted">No image</div>`;

    // phrase
    termEl.textContent = showBack ? c.back : c.front;

    // details
    phonEl.textContent = c.phonetic || '';
    transEl.textContent = c.back || '';

    // breakdown
    brkEl.innerHTML = '';
    if (c.word_breakdown) {
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
    useEl.textContent = c.usage_note || '';

    // example
    exEl.innerHTML = c.example ? `<div class="ex-welsh">${c.example}</div>` : '';

    // patterns — tap anywhere in the area to toggle English
    patEl.innerHTML = '';
    if (c.pattern_examples) {
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
    termEl.style.cursor = 'pointer';

    applyExpand(isExpanded, false);
  }

  // initial render
  renderCard();
  // autoplay new card at normal speed
  slowNext = false;
  const first = cards[idx];
  if (first.audio) playAudio(first.audio);

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
      showBack = !showBack;
      renderCard();
    });
  nextBtn.addEventListener('click', () => {
    stopAudio();
    idx = (idx + 1) % cards.length;
    showBack = false;
    renderCard();
    // autoplay next card at normal speed
    slowNext = false;
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });
  prevBtn.addEventListener('click', () => {
    stopAudio();
    idx = (idx - 1 + cards.length) % cards.length;
    showBack = false;
    renderCard();
    // autoplay previous card at normal speed
    slowNext = false;
    const c = cards[idx];
    if (c.audio) playAudio(c.audio);
  });

  // keyboard (desktop convenience)
  window.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); nextBtn.click(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevBtn.click(); }
    if (e.key?.toLowerCase() === 'a') { e.preventDefault(); audioBtn.click(); }
    if (e.key?.toLowerCase() === 'f') { e.preventDefault(); termEl.click(); }
  };

  return wrap;
}
window.renderReview = renderReview;

/* Run All hook: fire completion when "End Session" is clicked in Review */
window.addEventListener('click', (e) => {
  const btn = e.target.closest('.end-btn, [data-action="end"], button, a');
  if (!btn) return;

  const label = (btn.getAttribute('aria-label') || btn.textContent || '')
    .trim().toLowerCase();

  const isEnd =
    btn.classList.contains('end-btn') ||
    btn.matches('[data-action="end"]') ||
    label === 'end session';

  if (!isEnd) return;

  // Tell the runner that Review finished
  window.dispatchEvent(
    new CustomEvent('fc:module-complete', { detail: { module: 'review' } })
  );
});


})();
