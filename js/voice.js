/* 커넥톡 음성 모듈: 녹음 → 음성 변조(피치 변환) → 16kHz WAV로 저장.
   원래 목소리는 저장하지 않고, 변조된 소리만 남긴다. 마이크는 https 또는 localhost에서만 동작한다. */
const Voice = (() => {
  const SR = 16000, MAX_SEC = 10;
  let actx = null;
  const ac = () => actx || (actx = new (window.AudioContext || window.webkitAudioContext)());

  /* 피치 변환 (지연선 두 개를 번갈아 읽는 방식: 길이는 그대로, 높낮이만 바뀐다) */
  function pitchShift(x, ratio, sr) {
    const win = Math.floor(sr * 0.06), y = new Float32Array(x.length), rate = 1 - ratio;
    let phase = 0;
    for (let i = 0; i < x.length; i++) {
      phase += rate; phase = ((phase % win) + win) % win;
      const d1 = phase, d2 = (phase + win / 2) % win;
      const w1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * d1 / win), w2 = 0.5 - 0.5 * Math.cos(2 * Math.PI * d2 / win);
      y[i] = w1 * tap(x, i - d1) + w2 * tap(x, i - d2);
    }
    return y;
  }
  function tap(x, p) { if (p < 0) return 0; const i = Math.floor(p), f = p - i; return (x[i] || 0) * (1 - f) + (x[i + 1] || 0) * f; }

  function wavDataURL(f32, sr) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 32767, true);
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:audio/wav;base64,' + btoa(bin);
  }

  async function disguise(arrayBuffer) {
    const decoded = await ac().decodeAudioData(arrayBuffer);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(Math.min(decoded.duration, MAX_SEC + 1) * SR)), SR);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const x = (await off.startRendering()).getChannelData(0).slice();
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    const g = peak > 0.001 ? 0.85 / peak : 1; for (let i = 0; i < x.length; i++) x[i] *= g;
    const ratio = Math.random() < 0.5 ? 0.72 : 1.38;                       // 낮고 걸걸하게, 또는 높고 가볍게
    const y = pitchShift(x, ratio, SR);
    for (let i = 0; i < y.length; i++) y[i] = Math.tanh(y[i] * 1.3) * 0.85;   // 살짝 눌러서 원래 소리의 특징을 더 흐린다
    return wavDataURL(y, SR);
  }

  /* 녹음 시작. 반환: { stop(): Promise<{audio, dur}|null>, cancel() } */
  async function record(onLevel) {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const a = ac(); if (a.state === 'suspended') a.resume();
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [], t0 = performance.now();
    rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
    const src = a.createMediaStreamSource(stream), an = a.createAnalyser(); an.fftSize = 256; src.connect(an);
    const buf = new Uint8Array(an.fftSize); let raf = 0, done = false;
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); onLevel && onLevel(m / 128); raf = requestAnimationFrame(tick); };
    tick(); rec.start();
    const release = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); try { src.disconnect(); } catch (e) { } };
    return {
      stop: () => new Promise(res => {
        if (done) return res(null); done = true;
        rec.onstop = async () => {
          release(); const dur = (performance.now() - t0) / 1000;
          if (dur < 0.4) return res(null);
          try { res({ audio: await disguise(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()), dur: Math.min(dur, MAX_SEC) }); } catch (e) { res(null); }
        };
        try { rec.stop(); } catch (e) { release(); res(null); }
      }),
      cancel() { done = true; try { rec.stop(); } catch (e) { } release(); },
    };
  }

  let cur = null;
  function play(url, onEnd) {
    stop(); const au = new Audio(url); cur = au;
    au.onended = () => { cur = null; onEnd && onEnd(); };
    au.play().catch(() => { cur = null; onEnd && onEnd(); });
    return au;
  }
  function stop() { if (cur) { cur.pause(); cur = null; } }

  /* 예시 음성 메시지: 웅얼거리는 소리를 직접 합성해서 만든다 */
  function synthSample() {
    const f0s = [138, 172, 124, 158, 132], dur = 0.3, n = Math.floor(SR * dur * f0s.length), x = new Float32Array(n);
    for (let s = 0; s < f0s.length; s++) for (let i = 0; i < SR * dur; i++) {
      const t = i / SR, f = f0s[s] * (1 + 0.03 * Math.sin(2 * Math.PI * 5.5 * t)), env = Math.sin(Math.PI * i / (SR * dur)) ** 0.7; let v = 0;
      for (let k = 1; k <= 14; k++) { const fk = k * f; v += Math.sin(2 * Math.PI * fk * t * 1) / k * (Math.exp(-(((fk - 700) / 320) ** 2)) + 0.6 * Math.exp(-(((fk - 1250) / 380) ** 2))); }
      x[s * SR * dur + i] = v * env * 0.5;
    }
    return wavDataURL(pitchShift(x, 0.78, SR), SR);
  }
  return { record, play, stop, synthSample };
})();
