/* 커넥톡 데이터 저장소 (localStorage)
   - 메시지에는 발신자 정보를 저장하지 않는다. 발신자 대신 "이 사람에게는 보이지 않음" 표시(skip)만 해시로 저장한다.
   - 읽음 표시도 사용자 id가 아니라 해시로만 저장한다.
   ※ 이 앱은 서버 없는 시연용이라 같은 기기에서는 해시를 대조하면 알아낼 수 있다. 실제 서비스에서는 서버가 발신자를 저장하지 않아야 한다. */
const Store = (() => {
  const KEY = 'connectalk.v2';
  const USERS = [{ id: 'u1', name: '1호' }, { id: 'u2', name: '2호' }, { id: 'u3', name: '3호' }, { id: 'u4', name: '4호' }];
  let S = null;
  const rnd = () => Math.random().toString(36).slice(2, 10);
  function hash(str) {                       // cyrb53 (시연용 간단 해시)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function fresh() { return { v: 1, salt: rnd() + rnd(), me: 'u1', msgs: [], seeded: false }; }
  function load() { try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { S = fresh(); } if (!S.msgs) S = fresh(); }
  function save() {
    for (let tries = 0; tries < 12; tries++) {
      try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
      catch (e) { const v = S.msgs.find(m => m.audio); if (!v) return false; v.audio = null; v.lost = true; }   // 용량이 모자라면 오래된 음성부터 비운다
    }
    return false;
  }
  load();
  const tag = uid => hash(S.salt + uid);
  const me = () => S.me;
  const visible = () => S.msgs.filter(m => m.skip !== tag(S.me));            // 내가 보낸 메시지는 나에게 보이지 않는다
  const isRead = m => m.read.includes(tag(S.me));
  function sorted() {                                                       // 안 읽은 것 먼저 → 긴급 먼저 → 오래된 것부터
    return visible().slice().sort((a, b) => (isRead(a) - isRead(b)) || ((b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)) || (a.ts - b.ts));
  }
  function send(msg) {                                                      // msg: {kind, text, audio, urgent}
    const m = { id: rnd() + rnd(), ts: Date.now(), urgent: !!msg.urgent, kind: msg.kind, text: msg.text || '', audio: msg.audio || null, skip: tag(S.me), read: [] };
    S.msgs.push(m); save(); return m;
  }
  function markRead(id) { const m = S.msgs.find(x => x.id === id); if (m && !isRead(m)) { m.read.push(tag(S.me)); save(); } }
  function addSamples(voiceUrl) {                                           // 다른 구성원이 보낸 것처럼 보이는 예시 메시지 (발신자는 나 이외의 아무나)
    const others = USERS.filter(u => u.id !== S.me), now = Date.now();
    const from = i => tag(others[i % others.length].id);
    const mk = (i, ago, urgent, kind, text, audio) => ({ id: rnd() + rnd(), ts: now - ago, urgent, kind, text, audio: audio || null, skip: from(i), read: [] });
    S.msgs.push(
      mk(0, 3 * 3600e3, false, 'text', '싱크대 배수구 좀 비워 주세요. 며칠째 그대로예요.'),
      mk(1, 2 * 3600e3, false, 'text', '냉장고 두 번째 칸에 남은 수박 있어요. 먼저 드시는 분이 임자!'),
      mk(2, 40 * 60e3, true, 'text', '세탁실 건조대 근처에 벌레가 나왔어요. 오늘 밤 조심해요!'));
    if (voiceUrl) S.msgs.push(mk(0, 20 * 60e3, false, 'voice', '', voiceUrl));
    save();
  }
  function setMe(id) { S.me = id; save(); }
  function reset() { S = fresh(); save(); }
  return {
    USERS, me, setMe, sorted, send, markRead, addSamples, reset, isRead, save,
    get seeded() { return S.seeded; }, markSeeded() { S.seeded = true; save(); },
    unread: () => sorted().filter(m => !isRead(m)),
    counts() { const u = sorted().filter(m => !isRead(m)); return { unread: u.length, urgent: u.filter(m => m.urgent).length, total: visible().length }; },
  };
})();
