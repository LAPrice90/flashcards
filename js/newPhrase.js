// newPhrase.js — unlock and learn new phrases (route: #/newPhrase)
// Loads only active phrases, unlocks next items sequentially and limits
// new unlocks to once per day unless all active phrases are mastered.

(() => {
  /* ---------- Utilities ---------- */
  const escapeHTML = (s) =>
    String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // tolerant matching (same rules as test mode)
  function normalizeInput(s){
    if(!s) return '';
    let out = s.toLowerCase();
    out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
    out = out
      .replace(/[\u2019\u2018]/g,"'")
      .replace(/[\u201C\u201D]/g,'"')
      .replace(/\u2026/g,'...')
      .replace(/[\u2013\u2014]/g,'-')
      .replace(/[.,!?;:"'()\-]/g,' ')
      .replace(/\s+/g,' ').trim();
    return out;
  }
  function levenshtein(a,b){
    const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
    const prev=new Array(n+1),cur=new Array(n+1);
    for(let j=0;j<=n;j++) prev[j]=j;
    for(let i=1;i<=m;i++){
      cur[0]=i; const ai=a.charCodeAt(i-1);
      for(let j=1;j<=n;j++){
        const cost=ai===b.charCodeAt(j-1)?0:1;
        cur[j]=Math.min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost);
      }
      for(let j=0;j<=n;j++) prev[j]=cur[j];
    }
    return prev[n];
  }
  function equalsLoose(a,b){
    const x=normalizeInput(a), y=normalizeInput(b);
    if(x===y) return true;
    const dist=levenshtein(x,y);
    const tol=Math.max(1,Math.floor(Math.max(x.length,y.length)/8));
    return dist<=tol;
  }

  // prevent global hotkeys from stealing input/Enter
  window.addEventListener('keydown', e => {
    if(e.target && (e.target.matches('input, textarea') || e.target.isContentEditable)){
      e.stopPropagation();
    }
  }, true);

  /* ---------- Progress helpers ---------- */
  const LS_UNLOCK_PREFIX = 'np_unlock_';
  function loadUnlock(deckId){
    try{ return JSON.parse(localStorage.getItem(LS_UNLOCK_PREFIX+deckId) || '{}'); }
    catch{ return {}; }
  }
  function saveUnlock(deckId,obj){
    localStorage.setItem(LS_UNLOCK_PREFIX+deckId, JSON.stringify(obj));
  }
  function canUnlock(deckId, allMastered){
    if(allMastered) return true;
    const st = loadUnlock(deckId);
    return st.date !== todayKey();
  }
  function markUnlock(deckId){
    saveUnlock(deckId,{date:todayKey()});
  }

  function computeAllMastered(deckId, prog){
    const attempts = loadAttemptsMap();
    const ids = Object.keys(prog.seen || {});
    if(!ids.length) return true;
    return ids.every(id => categoryFromPct(lastNAccuracy(id, SCORE_WINDOW, attempts)) === 'Mastered');
  }

  async function syncProgressToGitHub(deckId, prog){
    const token = localStorage.getItem('gh_token');
    const repo  = localStorage.getItem('gh_repo'); // format: owner/repo
    if(!token || !repo) return;
    const path = `progress_${deckId}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(prog))));
    await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({message:`Update ${path}`, content})
    }).catch(()=>{});
  }

  /* ---------- Audio ---------- */
  let audioEl=null;
  function stopAudio(){ if(audioEl){ audioEl.pause(); audioEl=null; } }
  function playAudio(src,rate=1){
    if(!src) return; stopAudio();
    audioEl=new Audio(src); audioEl.playbackRate=rate;
    audioEl.play().catch(()=>{});
  }
  async function playSequence(src){
    await playOne(src,1.0); await playOne(src,0.6); await playOne(src,1.0);
  }
  function playOne(src,rate){
    return new Promise(res=>{
      if(!src) return res();
      stopAudio();
      audioEl=new Audio(src); audioEl.playbackRate=rate;
      audioEl.addEventListener('ended',res,{once:true});
      audioEl.play().catch(()=>res());
    });
  }

  /* ---------- Learning flow ---------- */
  const STEPS={ INTRO:0,WELSH:1,LISTEN:2,MEANING:3,CONTEXT:4,DRILL1:5,DRILL2:6,DRILL3:7 };

  let viewEl=null;
  let deckRows=[];       // full deck rows
  let queue=[];          // active phrases (seen but not learned)
  let idx=0;             // index in queue
  let step=STEPS.INTRO;  // current step
  let allMastered=true;  // recomputed after each change

  function routeName(){
    const raw=location.hash.startsWith('#/')?location.hash.slice(2):'home';
    return (raw.split('?')[0]||'home');
  }

  async function mountIfLearningRoute(){
    if(routeName()!=='newPhrase') return;

    document.querySelectorAll('.nav a').forEach(a=>
      a.classList.toggle('active', a.getAttribute('href') === '#/newPhrase')
    );

    const host=document.getElementById('view');
    host.innerHTML=`<h1 class="h1">New Words</h1>
      <div class="muted" id="np-day-wrap">Day <span id="np-day">1</span></div>
      <section class="card card--center"><div id="np-root" class="flashcard"></div></section>`;
    viewEl=document.getElementById('np-root');

    const deckId=STATE.activeDeckId;
    document.getElementById('np-day').textContent=currentDay(deckId);

    try {
      deckRows = await loadDeckRows(deckId);
      const prog = loadProgress(deckId);
      queue = deckRows.filter(r => (prog.seen||{})[r.id] && ((prog.seen[r.id].seenCount||0)===0));
      idx=0; step=STEPS.INTRO;
      allMastered = computeAllMastered(deckId, prog);
      if(queue.length){ render(); }
      else renderEmpty();
    } catch(e){
      console.error(e);
      viewEl.innerHTML=`<div class="muted">Failed to load data.</div>`;
    }
  }

  function current(){ return queue[idx]; }

  function render(){
    stopAudio();
    const c=current();
    if(!c){ renderEmpty(); return; }

    const img = c.image ? `<img src="${c.image}" alt="${escapeHTML(c.front)}" style="width:100%; border-radius:16px;">`
                         : `<div class="no-image muted">No image</div>`;

    if(step===STEPS.INTRO){
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="flashcard-progress muted" style="margin-top:8px;">Tap Play to begin</div>
        <div class="flashcard-actions">
          <button class="btn audio-btn" id="np-play">🔊 Play</button>
          <button class="btn nav-btn" id="np-skip" style="display:none">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      viewEl.querySelector('#np-play').addEventListener('click',()=>{ playAudio(c.audio,1.0); step=STEPS.WELSH; setTimeout(render,250); });
      return;
    }

    if(step===STEPS.WELSH){
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="tm-audio" style="margin-top:6px;">
          <button class="btn audio-btn" id="np-play">🔊 Play</button>
          <button class="btn audio-btn" id="np-play-slow" style="margin-left:6px;">🐢 0.6×</button>
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      playAudio(c.audio,1.0);
      viewEl.querySelector('#np-play').addEventListener('click',()=>playAudio(c.audio,1.0));
      viewEl.querySelector('#np-play-slow').addEventListener('click',()=>playAudio(c.audio,0.6));
      viewEl.querySelector('#np-next').addEventListener('click',()=>{step=STEPS.LISTEN; render();});
      return;
    }

    if(step===STEPS.LISTEN){
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="flashcard-progress muted" id="np-status" style="margin-top:6px;">Listening drill: normal → 0.6× → normal</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next" disabled>Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      (async()=>{ await playSequence(c.audio); const nxt=viewEl.querySelector('#np-next'); if(nxt) nxt.disabled=false; })();
      viewEl.querySelector('#np-next').addEventListener('click',()=>{step=STEPS.MEANING; render();});
      return;
    }

    if(step===STEPS.MEANING){
      const chips=(c.word_breakdown||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span class="chip">${escapeHTML(s)}</span>`).join(' ');
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="translation" style="margin-top:4px;">${escapeHTML(c.back)}</div>
        <div class="breakdown" style="margin-top:6px;">${chips||''}</div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-next">Next</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      viewEl.querySelector('#np-next').addEventListener('click',()=>{step=STEPS.CONTEXT; render();});
      return;
    }

    if(step===STEPS.CONTEXT){
      const related=(c.pattern_examples||'').split(/[\/|,]/).map(s=>s.trim()).filter(Boolean).map(s=>`<li>${escapeHTML(s)}</li>`).join('');
      viewEl.innerHTML=`
        <div class="flashcard-image">${img}</div>
        <div class="term" style="margin-top:8px;">${escapeHTML(c.front)}</div>
        <div class="usage" style="margin-top:6px;">${escapeHTML(c.usage_note||'')}</div>
        ${related?`<div class="patterns" style="margin-top:6px;"><ul class="patterns-list">${related}</ul></div>`:''}
        <div class="flashcard-actions">
          <button class="btn primary" id="np-start-drill">Start typing drill</button>
        </div>
        <div class="flashcard-progress muted">Card ${idx+1} of ${queue.length}</div>`;
      viewEl.querySelector('#np-start-drill').addEventListener('click',()=>{step=STEPS.DRILL1; render();});
      return;
    }

    if(step===STEPS.DRILL1 || step===STEPS.DRILL2){
      const label=step===STEPS.DRILL1?'Copy it (1/2)':'Copy it (2/2)';
      viewEl.innerHTML=`
        <div class="term">${escapeHTML(c.front)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">${label}</label>
          <input id="np-typed" class="tm-field" type="text" placeholder="${escapeHTML(c.front)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions">
          <button class="btn nav-btn" id="np-submit">Submit</button>
        </div>
        <div class="flashcard-progress muted">Press Enter to submit</div>`;
      const inp=viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click',()=>{
        const ok=equalsLoose(inp.value||'', c.front);
        if(ok){ step = (step===STEPS.DRILL1?STEPS.DRILL2:STEPS.DRILL3); render(); }
        else showIncorrect(inp.value||'', ()=>render());
      });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }

    if(step===STEPS.DRILL3){
      viewEl.innerHTML=`
        <div class="translation">${escapeHTML(c.back)}</div>
        <div class="tm-inputblock" style="margin-top:8px;">
          <label class="tm-label">Type the Welsh (from memory)</label>
          <input id="np-typed" class="tm-field" type="text" placeholder="Type without looking" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="flashcard-actions"><button class="btn nav-btn" id="np-submit">Submit</button></div>
        <div class="flashcard-progress muted">Press Enter to submit</div>`;
      const inp=viewEl.querySelector('#np-typed');
      viewEl.querySelector('#np-submit').addEventListener('click',()=>{
        const ok=equalsLoose(inp.value||'', c.front);
        if(ok){
          const deckId=STATE.activeDeckId; const pk=todayKey();
          const prog=loadProgress(deckId); if(!prog.seen) prog.seen={};
          const entry=prog.seen[c.id] || {firstSeen:pk, seenCount:0};
          entry.seenCount=(entry.seenCount||0)+1; entry.lastSeen=pk; prog.seen[c.id]=entry;
          saveProgress(deckId,prog); syncProgressToGitHub(deckId,prog); initDeckPicker && initDeckPicker();
          queue.splice(idx,1);
          viewEl.innerHTML=`
            <div class="tm-result tm-correct">✓ Correct</div>
            <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
            <div class="tm-audio" style="margin-top:6px;"><button class="btn audio-btn" id="np-play">🔊 Play</button></div>
            <div class="flashcard-actions"><button class="btn green" id="np-next">Next word</button></div>
            <div class="flashcard-progress muted">Great! Audio plays automatically.</div>`;
          playAudio(c.audio,1.0);
          viewEl.querySelector('#np-play').addEventListener('click',()=>playAudio(c.audio,1.0));
          viewEl.querySelector('#np-next').addEventListener('click',nextCard);
          allMastered = computeAllMastered(deckId, prog);
        } else {
          showIncorrect(inp.value||'', ()=>render());
        }
      });
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); viewEl.querySelector('#np-submit').click(); }});
      inp.focus();
      return;
    }
  }

  function renderEmpty(){
    const deckId=STATE.activeDeckId;
    const allow=canUnlock(deckId, allMastered);
    if(allow){
      viewEl.innerHTML=`<div class="flashcard-progress muted" style="margin-bottom:8px;">No active phrases.</div>
        <div class="flashcard-actions"><button class="btn primary" id="np-unlock">Unlock next phrase</button></div>`;
      viewEl.querySelector('#np-unlock').addEventListener('click',unlockNext);
    } else {
      viewEl.innerHTML=`<div class="flashcard-progress muted">No new phrases available today. Come back tomorrow.</div>`;
    }
  }

  function nextCard(){
    stopAudio();
    if(idx>=queue.length){ renderEmpty(); return; }
    step=STEPS.INTRO; render();
  }

  function showIncorrect(userTyped,onRetry){
    const c=current();
    viewEl.innerHTML=`
      <div class="tm-result tm-fail">✖ Incorrect</div>
      <div class="term" style="margin-top:-6px;">${escapeHTML(c.front)}</div>
      <div class="tm-mismatch" style="margin-top:8px;">
        <div class="tm-label">Your answer</div>
        <div class="tm-ansbox">${escapeHTML(userTyped||'—')}</div>
      </div>
      <div class="flashcard-actions"><button class="btn red" id="np-retry">Try again</button></div>`;
    viewEl.querySelector('#np-retry').addEventListener('click',onRetry);
  }

  async function unlockNext(){
    const deckId=STATE.activeDeckId;
    const prog=loadProgress(deckId); if(!prog.seen) prog.seen={};
    const active=new Set(Object.keys(prog.seen));
    const next=deckRows.find(r=>!active.has(r.id));
    if(!next){ viewEl.innerHTML=`<div class="flashcard-progress muted">All phrases unlocked.</div>`; return; }
    const pk=todayKey();
    prog.seen[next.id]={firstSeen:pk, lastSeen:pk, seenCount:0};
    saveProgress(deckId,prog); syncProgressToGitHub(deckId,prog); initDeckPicker && initDeckPicker();
    markUnlock(deckId);
    queue.push(next); idx=queue.length-1; step=STEPS.INTRO; render();
    allMastered = computeAllMastered(deckId, prog);
  }

  /* ---------- Boot ---------- */
  window.addEventListener('DOMContentLoaded', mountIfLearningRoute);
  window.addEventListener('hashchange', mountIfLearningRoute);

  // small style tweaks (reuse flashcard look)
  const style=document.createElement('style');
  style.textContent=`
    .tm-result{ text-align:center; font-weight:800; margin-top:4px; }
    .tm-fail{ color:#ff6b6b; }
    .tm-correct{ color:#3bd16f; }
    .tm-label{ font-size:12px; color: var(--muted); text-align:center; }
    .tm-ansbox{ border:1px dashed var(--border); border-radius:10px; padding:8px 10px; margin-top:4px; background:rgba(255,255,255,0.02); }
    .tm-audio{ display:flex; justify-content:center; }
    .chip{ display:inline-block; border:1px solid var(--border); background:var(--panel); border-radius:999px; padding:4px 10px; font-size:12px; color:#fff; margin:2px; }
  `;
  document.head.appendChild(style);
})();

