/* 커넥톡 손동작 인식 (MediaPipe HandLandmarker)
   call  : 손바닥 → 주먹 → 끌어당기기(손이 작아짐) → (컵 도착)
   reveal: 손바닥을 펼치면 쪽지가 보인다
   next  : 주먹 → 손바닥이면 다음 쪽지
   send  : 손바닥 → 주먹(쪽지 닫힘) → 앞으로 뻗기(손이 커짐) → 손바닥을 펼치면 전송
   손이 카메라에서 멀어지면 화면 속 손이 작아지는 것으로 앞뒤 움직임을 알아낸다. */
const Gesture = (() => {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  let lm = null, video = null, stream = null, running = false, cb = {}, mode = 'none', lastVT = -1;
  const S = { phase: 'idle', s0: 0, size: 0, since: 0, lost: 0, guard: 0 };
  const OPEN = 1.65, FIST = 1.25;

  async function start(videoEl, callbacks) {
    cb = callbacks || {}; video = videoEl;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    video.srcObject = stream; await video.play();
    try {
      const vision = await import(CDN + '/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(CDN + '/wasm');
      const make = delegate => vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numHands: 1 });
      try { lm = await make('GPU'); } catch (e) { lm = await make('CPU'); }
    } catch (e) { stop(); throw e; }
    running = true; reset(); loop();
  }
  function stop() {
    running = false; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    if (video) video.srcObject = null; if (lm && lm.close) try { lm.close(); } catch (e) { } lm = null;
  }
  function reset() { S.last = ''; S.phase = 'idle'; S.since = 0; S.guard = performance.now() + 700; }
  const setMode = m => { mode = m; reset(); cb.onProgress && mode !== 'call' && 0; };
  const isOn = () => running;

  function loop() {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastVT) {
      lastVT = video.currentTime;
      let res = null; try { res = lm.detectForVideo(video, performance.now()); } catch (e) { }
      const pts = res && res.landmarks && res.landmarks[0];
      try { step(pts ? features(pts) : null); } catch (e) { cb.onError && cb.onError(e); }
    }
    requestAnimationFrame(loop);
  }
  function features(p) {
    const vw = video.videoWidth || 640, vh = video.videoHeight || 480, d = (a, b) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
    const palm = d(p[0], p[9]) / vh;
    const open = [8, 12, 16, 20].reduce((s, i) => s + d(p[i], p[0]), 0) / 4 / (palm * vh);
    return { palm, open };
  }
  const hold = (cond, now, ms) => { if (!cond) { S.since = 0; return false; } if (!S.since) S.since = now; return now - S.since >= ms; };

  function step(f) {
    const now = performance.now();
    if (!f) { if (now - S.lost > 500 && S.phase !== 'idle') { S.phase = 'idle'; S.since = 0; cb.onProgress && mode === 'call' && cb.onProgress(0); } return; }
    S.lost = now; S.size = S.size ? S.size * 0.6 + f.palm * 0.4 : f.palm;
    const fist = f.open < FIST, open = f.open > OPEN;
    cb.onStatus && cb.onStatus(fist ? 'fist' : open ? 'open' : 'hand');
    if (now < S.guard) return;
    const P = S.phase;
    if (S.phase !== S.last) { S.last = S.phase; cb.onPhase && cb.onPhase(S.phase); }
    if (mode === 'call') {                                   // 주먹 → 손바닥 → 끌어당기기
      if (P === 'idle') { if (hold(open, now, 250)) { S.phase = 'open'; S.since = 0; } }
      else if (P === 'open') { if (hold(fist, now, 250)) { S.phase = 'pull'; S.s0 = S.size; S.since = 0; } }
      else if (P === 'pull') {
        const p = Math.max(0, Math.min(1, (S.s0 - S.size) / (S.s0 * 0.3)));
        cb.onProgress && cb.onProgress(p);
        if (p >= 1) { S.phase = 'done'; cb.onArrive && cb.onArrive(); }
      }
    } else if (mode === 'reveal') {                          // 손바닥을 펼치면 보인다
      if (hold(open, now, 350)) { S.phase = 'done'; cb.onReveal && cb.onReveal(); }
    } else if (mode === 'next') {                            // 주먹 → 손바닥
      if (P === 'idle') { if (hold(fist, now, 250)) { S.phase = 'fist'; S.since = 0; } }
      else if (P === 'fist' && hold(open, now, 200)) { S.phase = 'done'; cb.onNext && cb.onNext(); }
    } else if (mode === 'send') {                            // 손바닥 → 주먹 → 앞으로 → 손바닥
      if (P === 'idle') { if (hold(open, now, 250)) { S.phase = 'open'; S.since = 0; } }
      else if (P === 'open') { if (hold(fist, now, 200)) { S.phase = 'armed'; S.s0 = S.size; S.since = 0; cb.onGrab && cb.onGrab(); } }
      else if (P === 'armed') { S.s0 = Math.min(S.s0, S.size); cb.onExtend && cb.onExtend(Math.max(0, Math.min(1, (S.size / S.s0 - 1) / 0.25))); if (S.size > S.s0 * 1.08) { S.phase = 'extended'; S.ext = 0; } else if (hold(!fist, now, 700)) { S.phase = 'done'; cb.onThrow && cb.onThrow(); } }
      else if (P === 'extended') { cb.onExtend && cb.onExtend(Math.max(0, Math.min(1, (S.size / S.s0 - 1) / 0.25))); if (!S.ext) S.ext = now; if (open || !fist || now - S.ext > 1200) { S.phase = 'done'; cb.onThrow && cb.onThrow(); } else if (S.size < S.s0 * 1.02) S.phase = 'armed'; }
    }
  }
  return { start, stop, setMode, isOn };
})();
