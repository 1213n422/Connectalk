/* 커넥톡 메인: 종이컵 한 개로 모든 기능을 다루는 화면
   상태: far(멀리 있는 컵) → near(당겨온 컵) → reading(쪽지 읽기) / writing(쪽지 쓰기) → sending(던지기) → far */
(() => {
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, ease = t => t * t * (3 - 2 * t);
  const stage = $('#stage'), ropeC = $('#rope'), rctx = ropeC.getContext('2d'), cupEl = $('#cup'), hubEl = $('#hub'), hubCups = [...document.querySelectorAll('.hubCup')];
  const paper = $('#paper'), body = $('#paperBody'), dotsEl = $('#dots'), hintEl = $('#hint'), toastEl = $('#toast'), tally = $('#tally');
  let W = 0, H = 0, dpr = 1, cupW = 0, cupH = 0, hubW = 0, hubH = 0, K = { x: 0, y: 0 };

  /* ---------- 상태 ---------- */
  const st = {
    mode: 'far', t: 0, v: 0, target: 0, manual: false, throwY: 0, slack: 0.3,
    shake: 0, sendT: -1, popT: 1, list: [], idx: 0,
    draft: { text: '', urgent: false, voice: null, mode: 'text' }, rec: null, recBusy: false, time: 0,
  };
  const counts = () => Store.counts();

  /* ---------- 화면 배치 ---------- */
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight; dpr = Math.min(devicePixelRatio || 1, 2);
    ropeC.width = W * dpr; ropeC.height = H * dpr;
    cupW = clamp(Math.min(W * 0.8, H * 0.42), 210, 340); cupH = cupW * 260 / 300;
    hubW = cupW * 0.42; hubH = hubW * 260 / 300;
    hubCups.forEach(c => { c.setAttribute('viewBox', '0 0 300 260'); c.style.width = hubW + 'px'; c.style.height = hubH + 'px'; c.style.transform = `translate(${W / 2 - hubW / 2}px,${H * 0.035}px) scaleY(-1)`; });
    K = { x: W / 2, y: H * 0.035 + hubH * 0.877 };
    cupEl.style.width = cupW + 'px'; cupEl.style.height = cupH + 'px';
    paper.style.top = Math.max(14, H * 0.115) + 'px';
    initRope();
  }
  const pose = t => ({ cx: W / 2, cy: lerp(H * 0.4, H * 0.665, ease(t)), s: lerp(0.4, 1, ease(t)) });
  const anchorOf = p => ({ x: p.cx, y: p.cy + (32 - 130) / 260 * cupH * p.s });
  const hubAnchors = () => [{ x: W / 2, y: H * 0.035 + hubH * 0.877 }];

  /* ---------- 실 (물리 시뮬레이션) ---------- */
  const N = 24; let rope = [];
  function initRope() {
    const p = pose(st.t), a = anchorOf(p); rope = [];
    for (let i = 0; i < N; i++) { const f = i / (N - 1); rope.push({ x: lerp(K.x, a.x, f), y: lerp(K.y, a.y, f), px: lerp(K.x, a.x, f), py: lerp(K.y, a.y, f) }); }
  }
  function stepRope(dt, a) {
    const dist = Math.hypot(a.x - K.x, a.y - K.y), seg = dist * (1 + st.slack) / (N - 1);
    const sub = 2, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 1; i < N - 1; i++) { const r = rope[i], vx = (r.x - r.px) * 0.985, vy = (r.y - r.py) * 0.985; r.px = r.x; r.py = r.y; r.x += vx; r.y += vy + 1500 * h * h; }
      rope[0].x = K.x; rope[0].y = K.y; rope[N - 1].x = a.x; rope[N - 1].y = a.y;
      for (let it = 0; it < 14; it++) {
        for (let i = 0; i < N - 1; i++) {
          const A = rope[i], B = rope[i + 1], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6, diff = (d - seg) / d;
          if (d > seg || st.slack > 0.05) {                       // 늘어진 실은 길이를 지키되 구부러질 수 있다
            const wa = i === 0 ? 0 : 0.5, wb = i === N - 2 ? 0 : 0.5, tot = (wa + wb) || 1;
            A.x += dx * diff * wa / tot * (i === 0 ? 0 : 1); A.y += dy * diff * wa / tot * (i === 0 ? 0 : 1);
            B.x -= dx * diff * wb / tot * (i === N - 2 ? 0 : 1); B.y -= dy * diff * wb / tot * (i === N - 2 ? 0 : 1);
          }
        }
        rope[0].x = K.x; rope[0].y = K.y; rope[N - 1].x = a.x; rope[N - 1].y = a.y;
      }
    }
  }
  function drawRope(a) {
    const c = rctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.strokeStyle = '#1b1a19'; c.lineCap = 'round'; c.lineJoin = 'round';
    const taut = st.slack < 0.06, urgent = counts().urgent > 0;
    const pts = rope.map((r, i) => {                              // 팽팽하고 급하면 떨린다
      const f = Math.sin(Math.PI * i / (N - 1));
      const vib = taut ? Math.sin(st.time * (urgent ? 70 : 28) + i * 1.3) * (urgent ? 3.2 : 1.3) * f : 0;
      return { x: r.x + vib, y: r.y };
    });
    const path = off => { c.beginPath(); c.moveTo(pts[0].x + off, pts[0].y); for (let i = 1; i < N - 1; i++) { const m = { x: (pts[i].x + pts[i + 1].x) / 2 + off, y: (pts[i].y + pts[i + 1].y) / 2 }; c.quadraticCurveTo(pts[i].x + off, pts[i].y, m.x, m.y); } c.lineTo(pts[N - 1].x + off, pts[N - 1].y); c.stroke(); };
    c.lineWidth = 2.6; path(0); c.lineWidth = 1; c.globalAlpha = .45; path(1.6); c.globalAlpha = 1;
  }

  /* ---------- 컵 움직임 ---------- */
  function updateCup(dt) {
    if (st.mode === 'sending') return;
    if (!st.manual) st.target = (st.mode === 'far') ? 0 : 1;
    const k = 120, d = 17;                                        // 스프링: 살짝 묵직하게 도착한다
    st.v += (k * (st.target - st.t) - d * st.v) * dt; st.t = clamp(st.t + st.v * dt, -0.05, 1.04);
  }
  function renderCup() {
    let p = pose(st.t), rot = 0, ox = 0, oy = st.throwY, alpha = 1;
    const c = counts();
    if (st.mode === 'sending') {                                   // 위로 날아가 저쪽 컵에 닿는다
      const f = ease(clamp(st.sendT, 0, 1)), near = st.sendFrom || pose(1);
      p = { cx: lerp(near.cx, W / 2, f), cy: lerp(near.cy, H * 0.035 + hubH * 0.5, f), s: lerp(near.s, 0.1, f) }; rot = f * 12; oy = 0; ox = 0;
    } else {
      if (c.urgent > 0 && st.mode !== 'writing' && st.mode !== 'reading') { rot = Math.sin(st.time * 55) * 2.6; ox = Math.sin(st.time * 47) * 2.2; }   // 긴급: 컵이 떨린다
      else if (c.unread > 0 && st.mode === 'far') rot = Math.sin(st.time * 4) * 1.4;
      else if (st.mode === 'far') rot = Math.sin(st.time * 1.6) * 0.8;
      if (st.popT < 1) alpha = st.popT;
    }
    cupEl.style.opacity = alpha;
    cupEl.style.transform = `translate(${p.cx - cupW / 2 + ox}px,${p.cy - cupH / 2 + oy}px) rotate(${rot}deg) scale(${p.s})`;
    return { a: anchorOf({ cx: p.cx + ox, cy: p.cy + oy, s: p.s }), p };
  }
  function renderTally() {                                         // 컵 띠에 쪽지 수를 줄로 표시 (안 읽은 것은 진하게, 읽은 것은 흐리게)
    const list = Store.sorted().slice(0, 9); let h = '';
    list.forEach((m, i) => { const x = 150 + (i - (list.length - 1) / 2) * 14, y = 116 + Math.abs(x - 150) * 0.02; h += `<line x1="${x}" y1="${y - 11}" x2="${x}" y2="${y + 9}" stroke="#1b1a19" stroke-width="${Store.isRead(m) ? 2 : 5}" stroke-linecap="round" opacity="${Store.isRead(m) ? .32 : 1}"/>`; });
    tally.innerHTML = h;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now; st.time += dt;
    if (st.popT < 1) st.popT = Math.min(1, st.popT + dt * 2.5);
    if (st.mode === 'sending') { st.sendT += dt / 0.85; if (st.sendT >= 1) finishSend(); }
    updateCup(dt);
    const { a } = renderCup();
    const target = (counts().unread > 0 || st.mode === 'sending') ? 0.0 : 0.3;      // 쪽지가 있으면 실이 팽팽, 없으면 느슨
    st.slack += (target - st.slack) * Math.min(1, dt * 3.5);
    stepRope(dt, a); drawRope(a);
    requestAnimationFrame(frame);
  }

  /* ---------- 안내 / 알림 ---------- */
  let toastTimer = 0;
  function toast(t, ms = 1900) { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms); }
  function hint() {
    const c = counts(), m = st.mode, g = Gesture.isOn();
    const t = m === 'far' ? (g ? '손바닥 → 주먹 → 끌어당겨요' : (c.unread ? '컵을 당겨서 쪽지를 확인해요' : '컵을 끌어당겨요'))
      : m === 'near' ? (g ? '손바닥을 펴요' : (c.unread ? '컵을 눌러 쪽지를 꺼내요' : '컵을 눌러 쪽지를 써요'))
      : m === 'reading' ? (g ? '주먹 → 손바닥 : 다음 쪽지' : '쪽지를 눌러 다음으로')
      : m === 'writing' ? (g ? (st.closed ? '앞으로 뻗고 → 손바닥을 펴서 보내요' : '손바닥 → 주먹 : 쪽지 닫기') : (st.closed ? '컵을 눌러 쪽지 다시 열기, 위로 던지면 전송' : '꾹 누르면 녹음, 위로 던지면 전송')) : '';
    hintEl.textContent = t;
  }
  const gMode = m => ({ far: 'call', near: 'reveal', reading: 'next', writing: 'send' }[m] || 'none');
  function setMode(m) {
    st.mode = m; st.closed = false; st.manual = false; hint();
    if (Gesture.isOn()) Gesture.setMode(gMode(m));
  }

  /* ---------- 쪽지 (읽기) ---------- */
  function renderDots(curId) {
    dotsEl.innerHTML = '';
    st.list.forEach((m, i) => { const b = document.createElement('button'); b.className = (Store.isRead(m) ? '' : 'unread ') + (i === st.idx && st.mode === 'reading' ? 'cur' : ''); b.setAttribute('aria-label', '쪽지 ' + (i + 1)); b.onclick = e => { e.stopPropagation(); openMessage(i); }; dotsEl.appendChild(b); });
    const p = document.createElement('button'); p.className = 'plus' + (st.mode === 'writing' ? ' cur' : ''); p.setAttribute('aria-label', '쪽지 쓰기'); p.onclick = e => { e.stopPropagation(); openWriting(); }; dotsEl.appendChild(p);
  }
  function showPaper(cls) { paper.hidden = false; paper.className = cls || ''; void paper.offsetWidth; }
  function timeAgo(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.floor(m / 60) + '시간 전' : Math.floor(m / 1440) + '일 전'; }

  function openReading() {
    st.list = Store.sorted();
    const first = st.list.findIndex(m => !Store.isRead(m));
    if (first < 0) return openWriting();
    openMessage(first, true);
  }
  function openMessage(i, fromCup) {
    Voice.stop(); st.idx = i; setMode('reading');
    const m = st.list[i]; if (!m) return openWriting();
    const wasUnread = !Store.isRead(m); Store.markRead(m.id);
    showPaper((fromCup ? 'pop ' : 'flip ') + (m.urgent ? 'urgent' : ''));
    if (m.kind === 'voice') {
      body.innerHTML = `<div class="voice"><button class="play" aria-label="듣기"></button><div class="wave">${'<i></i>'.repeat(18)}</div></div><div class="msgMeta">${timeAgo(m.ts)}</div>`;
      const btn = body.querySelector('.play'), box = body.querySelector('.voice'), bars = [...body.querySelectorAll('.wave i')];
      bars.forEach((b, k) => { b.style.height = (22 + Math.abs(Math.sin(k * 1.7 + 1)) * 60) + '%'; });
      btn.onclick = e => { e.stopPropagation(); if (btn.classList.contains('on')) { Voice.stop(); btn.classList.remove('on'); box.classList.remove('playing'); return; } if (!m.audio) return toast('이 음성은 저장 공간이 부족해 지워졌어요'); btn.classList.add('on'); box.classList.add('playing'); Voice.play(m.audio, () => { btn.classList.remove('on'); box.classList.remove('playing'); }); };
    } else body.innerHTML = `<div class="msgText"></div><div class="msgMeta">${timeAgo(m.ts)}</div>`, body.querySelector('.msgText').textContent = m.text;
    renderDots(); renderTally();
    paper.onclick = e => { if (e.target.closest('button')) return; const next = st.list.findIndex((x, k) => k > st.idx && !Store.isRead(x)); next >= 0 ? openMessage(next) : openWriting(); };
  }

  /* ---------- 쪽지 (쓰기) ---------- */
  function openWriting() {
    Voice.stop(); st.list = Store.sorted(); setMode('writing');
    showPaper('pop'); paper.onclick = null;
    const d = st.draft;
    body.innerHTML = `<textarea id="msgText" maxlength="120" placeholder="여기에 적어요" rows="4"></textarea><div id="voiceSlot"></div>
      <div class="tools"><button class="chip" id="mText">글</button><button class="chip" id="mVoice">음성</button><span class="grow"></span><button class="chip ${d.urgent ? 'on' : ''}" id="urgentBtn">긴급</button></div><div class="msgMeta" id="count"></div>`;
    const ta = $('#msgText'); ta.value = d.text;
    ta.oninput = () => { d.text = ta.value; updateCount(); };
    ta.onkeydown = e => e.stopPropagation();
    $('#mText').onclick = () => { d.mode = 'text'; renderVoiceSlot(); };
    $('#mVoice').onclick = () => { d.mode = 'voice'; renderVoiceSlot(); };
    $('#urgentBtn').onclick = e => { d.urgent = !d.urgent; e.currentTarget.classList.toggle('on', d.urgent); paper.classList.toggle('urgent', d.urgent); };
    paper.classList.toggle('urgent', d.urgent);
    renderVoiceSlot(); renderDots(); renderTally();
  }
  function updateCount() { const el = $('#count'); if (el) el.textContent = st.draft.mode === 'voice' ? '' : (st.draft.text.length + ' / 120'); }
  function renderVoiceSlot() {
    const slot = $('#voiceSlot'), ta = $('#msgText'), d = st.draft; if (!slot) return;
    $('#mText').classList.toggle('on', d.mode !== 'voice'); $('#mVoice').classList.toggle('on', d.mode === 'voice'); updateCount();
    if (d.mode !== 'voice') { slot.innerHTML = ''; ta.hidden = false; return; }
    ta.hidden = true;
    if (!d.voice) {
      slot.innerHTML = '<button class="recBtn" id="recBtn">꾹 눌러서 말해요</button>';
      const rb = $('#recBtn');
      rb.onpointerdown = e => { e.preventDefault(); rb.setPointerCapture(e.pointerId); rb.classList.add('on'); rb.textContent = '듣고 있어요…'; startRec(); };
      const up = () => { rb.classList.remove('on'); rb.textContent = '꾹 눌러서 말해요'; stopRec(); };
      rb.onpointerup = up; rb.onpointercancel = up;
      return;
    }
    slot.innerHTML = `<div class="voice"><button class="play" aria-label="들어 보기"></button><div class="wave">${'<i></i>'.repeat(18)}</div><button class="x" aria-label="지우기">×</button></div>`;
    const btn = slot.querySelector('.play'), box = slot.querySelector('.voice');
    slot.querySelectorAll('.wave i').forEach((b, k) => { b.style.height = (22 + Math.abs(Math.sin(k * 1.3 + 2)) * 60) + '%'; });
    btn.onclick = () => { if (btn.classList.contains('on')) { Voice.stop(); btn.classList.remove('on'); box.classList.remove('playing'); return; } btn.classList.add('on'); box.classList.add('playing'); Voice.play(d.voice.audio, () => { btn.classList.remove('on'); box.classList.remove('playing'); }); };
    slot.querySelector('.x').onclick = () => { Voice.stop(); d.voice = null; renderVoiceSlot(); };
  }

  /* ---------- 녹음 (컵을 꾹 누르면 말하기) ---------- */
  async function startRec() {
    if (st.rec || st.recBusy || st.draft.voice) return; st.recBusy = true;
    try {
      st.rec = await Voice.record(); cupEl.classList.add('rec');
      st.recTimer = setTimeout(stopRec, 10000);
    } catch (e) { toast(location.protocol === 'file:' || !window.isSecureContext ? '마이크는 https나 localhost에서만 써요' : '마이크를 켤 수 없어요'); }
    st.recBusy = false;
  }
  async function stopRec() {
    clearTimeout(st.recTimer); const r = st.rec; if (!r) return; st.rec = null; cupEl.classList.remove('rec');
    const out = await r.stop(); if (!out) return toast('너무 짧아요. 꾹 누른 채로 말해요');
    st.draft.voice = out; st.draft.mode = 'voice'; if (st.mode === 'writing') renderVoiceSlot();
  }

  /* ---------- 보내기 ---------- */
  function reopenPaper() { st.closed = false; paper.hidden = false; paper.className = 'pop'; paper.classList.toggle('urgent', st.draft.urgent); hint(); }
  function trySend(force) {
    const d = st.draft, vm = d.mode === 'voice'; if (force && !(vm ? d.voice : d.text.trim())) { vm ? (d.mode = 'text', d.text = '...') : d.text = '...'; }
    const useV = d.mode === 'voice', ok = useV ? d.voice : d.text.trim();
    if (!ok) { toast('먼저 쪽지를 써요', 2600); st.v = -3; return false; }
    if (st.mode !== 'writing') return false;
    Store.send({ kind: useV ? 'voice' : 'text', text: useV ? '' : d.text.trim(), audio: useV ? d.voice.audio : null, urgent: d.urgent });
    st.draft = { text: '', urgent: false, voice: null, mode: 'text' };
    st.sendFrom = pose(st.t); st.manual = false; paper.hidden = true; Voice.stop(); st.throwY = 0; st.mode = 'sending'; st.sendT = 0; hint();
    if (Gesture.isOn()) Gesture.setMode('none');
    return true;
  }
  function finishSend() {
    st.mode = 'far'; st.t = 0; st.v = 0; st.popT = 0; st.sendT = -1; st.target = 0;
    hubEl.classList.remove('wiggle'); void hubEl.offsetWidth; hubEl.classList.add('wiggle');
    stamp(); renderTally(); setMode('far'); initRope();
  }

  function stamp() { const s = $('#sent'); s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); }

  /* ---------- 컵 조작 (마우스/터치) ---------- */
  let drag = null;
  cupEl.addEventListener('pointerdown', e => {
    e.preventDefault(); cupEl.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, t0: performance.now(), moved: false, startT: st.t, holdTimer: 0 };
    if (st.mode === 'writing' && !st.closed) drag.holdTimer = setTimeout(() => { if (drag && !drag.moved) { drag.rec = true; startRec(); } }, 320);
  });
  cupEl.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 10) drag.moved = true;
    if (st.mode === 'far') { st.manual = true; st.target = clamp(drag.startT + dy / (H * 0.3), 0, 1); }                       // 끌어당기기
    else if (st.mode === 'writing' && drag.moved && !drag.rec) { clearTimeout(drag.holdTimer); st.throwY = Math.min(0, dy * 0.8); }  // 위로 던지기 준비
  });
  const endDrag = e => {
    if (!drag) return; const d = drag; drag = null; clearTimeout(d.holdTimer);
    const dy = e.clientY - d.y, dt = performance.now() - d.t0, tap = !d.moved && dt < 400;
    if (st.mode === 'far') { st.manual = false; if (tap || st.target > 0.55) { callCup(); } else st.target = 0; }
    else if (st.mode === 'near' && tap) openReading();
    else if (st.mode === 'writing') {
      if (d.rec) { stopRec(); return; }
      if (tap && st.closed) { reopenPaper(); return; }
      if (dy < -70 || (dy < -30 && dt < 220)) { if (!trySend()) st.throwY = 0; } else { st.throwY = 0; }
    }
  };
  cupEl.addEventListener('pointerup', endDrag); cupEl.addEventListener('pointercancel', endDrag);
  cupEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (st.mode === 'far') callCup(); else if (st.mode === 'near') openReading(); else if (st.mode === 'writing') trySend(); } });
  function callCup() { st.manual = false; setMode('near'); }

  /* ---------- 발표용 단축키 (화면에는 보이지 않음): 1~4 사용자 전환, S 예시 쪽지, R 초기화 ---------- */
  function switchUser(id) { if (id === Store.me()) return; Store.setMe(id); resetScene(); }
  function resetScene() {
    Voice.stop(); if (st.rec) { st.rec.cancel(); st.rec = null; cupEl.classList.remove('rec'); }
    paper.hidden = true; st.draft = { text: '', urgent: false, voice: null, mode: 'text' }; st.t = 0; st.v = 0; st.target = 0; st.throwY = 0; st.sendT = -1; setMode('far'); renderTally(); initRope();
  }
  document.addEventListener('keydown', e => {
    if (/TEXTAREA|INPUT/.test(e.target.tagName)) return; const k = e.key.toLowerCase();
    if ('1234'.includes(k) && k) switchUser('u' + k);
    else if (k === 's') { Store.addSamples(Voice.synthSample()); resetScene(); toast('쪽지가 도착했어요'); }
    else if (k === 'r') { Store.reset(); seed(); resetScene(); toast('처음으로 돌아갔어요'); }
  });

  /* ---------- 손동작: 처음부터 켜진다 ---------- */
  async function startGesture() {
    try {
      $('#camBox').hidden = false; document.body.classList.add('cam');
      await Gesture.start($('#cam'), {
        onProgress: p => { if (st.mode === 'far') { st.manual = p > 0; st.target = p; } },
        onArrive: () => { if (st.mode === 'far') callCup(); },
        onReveal: () => { if (st.mode === 'near') openReading(); },
        onNext: () => { if (st.mode === 'reading') { const n = st.list.findIndex((x, k) => k > st.idx && !Store.isRead(x)); n >= 0 ? openMessage(n) : openWriting(); } },
        onPhase: p => { const L = { idle: '', open: '① 손바닥', fist: '② 주먹', pull: '② 주먹 → 당겨요', armed: '② 주먹 → 뻗어요', extended: '③ 뻗음 → 손바닥!', done: '✓' }; $('#camPhase').textContent = L[p] || ''; },
        onGrab: () => { if (st.mode === 'writing' && !st.closed) { st.closed = true; Voice.stop(); if (st.rec) stopRec(); paper.hidden = true; hint(); } },
        onThrow: () => { if (st.mode === 'writing' && !trySend(true)) { reopenPaper(); Gesture.setMode('send'); } },
        onExtend: p => { if (st.mode === 'writing' && st.closed) { st.manual = true; st.target = 1 - p * 0.75; } },
        onError: e => { $('#camPhase').textContent = '오류: ' + e.message; },
        onStatus: s => { $('#camState').textContent = s === 'fist' ? '✊ 주먹' : s === 'open' ? '🖐 손바닥' : '손'; },
      });
      Gesture.setMode(gMode(st.mode)); hint();
    } catch (err) { $('#camBox').hidden = true; document.body.classList.remove('cam'); hint(); toast('카메라를 켤 수 없어요. 터치로 써요', 3000); }
  }

  /* ---------- 시작 ---------- */
  function seed() { if (!Store.seeded) { Store.addSamples(Voice.synthSample()); Store.markSeeded(); } }
  seed();
  addEventListener('resize', layout); layout(); hint(); renderTally();
  window.__ct = { st, Store, counts, trySend };
  requestAnimationFrame(frame);
  startGesture();
})();
