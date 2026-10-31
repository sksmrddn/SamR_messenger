import * as C from './crypto.js';
const $ = (i) => document.getElementById(i), te = new TextEncoder(), td = new TextDecoder();
const MAX = 25 << 20, CH = 48 << 10;
const ONCE = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/;
const S = { over: false, up: false, rx: new Map(), urls: [], ic: [], q: Promise.resolve(), tx: Promise.resolve(), n: 0, r: 0, fid: 0, ls: 0, ln: 0, gt: 0, once: new Map(), vo: new Map(), cool: 0, fxt: 0 };
const show = (n) => { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 's-' + n; };
const kb = (n) => (n > 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB');
const nm = (s) => String(s).replace(/[\\/\u0000-\u001f<>:"|?*]/g, '_').slice(0, 120) || 'file';
const bubble = (c) => { const d = document.createElement('div'); d.className = 'b ' + c; $('messages').append(d); d.scrollIntoView(); return d; };
const sys = (t) => (bubble('sys').textContent = t);

// ---- end of session: everything is torn down and wiped ----
function down() {
  S.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
  if (S.pc) { S.pc.onconnectionstatechange = null; S.pc.close(); }
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  for (const v of ['remote-video', 'local-video', 'remote-audio']) $(v).srcObject = null;
  stopGeo(); S.keys = S.auth = S.eph = S.secret = S.me = null; S.rx.clear();
  S.wl?.release().catch(() => {}); S.wl = null; clearNotes();
  S.mstream?.getTracks().forEach((t) => t.stop()); S.movie = null; $('mv-stage').replaceChildren(); $('mv').hidden = true; $('mchoose').hidden = true;
  S.game = null; $('gp').hidden = true; $('gchoose').hidden = true; $('g-board').replaceChildren();
  closeOnce(); $('fx').replaceChildren(); $('qr').hidden = true; $('qr').width = $('qr').width;
  $('link').value = ''; $('text').value = '';
}
function finish(title, msg, list) {
  if (S.over) return;
  S.over = true; clearTimeout(S.timer); down();
  $('messages').replaceChildren(); for (const u of S.urls) URL.revokeObjectURL(u);
  $('end-title').textContent = title; $('end-msg').textContent = msg; $('end-list').hidden = !list;
  show('end');
}
const fail = (e) => finish('Session ended', e === 'auth' ? 'The secure handshake failed. Someone may be interfering with this link.' : 'A message failed verification.', false);
addEventListener('pagehide', () => { S.over = true; down(); });

// ---- notifications (generic text only) and screen wake lock ----
const onEnded = () => finish('Session ended', 'Camera or microphone access was turned off.', true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
async function notify(body, tag, vibrate) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body, tag, vibrate, renotify: true };
  try { const r = await navigator.serviceWorker.getRegistration(); if (r) return await r.showNotification('SamR messenger', opts); } catch {}
  try { new Notification('SamR messenger', opts); } catch {}
}
async function clearNotes() {
  try { const r = await navigator.serviceWorker.getRegistration(); (await r.getNotifications()).forEach((n) => n.close()); } catch {}
}
async function keepAwake() {
  try {
    if (S.ws && !S.over && !S.wl && navigator.wakeLock && document.visibilityState === 'visible') {
      S.wl = await navigator.wakeLock.request('screen'); S.wl.onrelease = () => { S.wl = null; };
    }
  } catch {}
}
document.addEventListener('visibilitychange', keepAwake);

// ---- boot ----
const m = /^#([\w-]{22})\.([\w-]{43})$/.exec(location.hash);
S.role = m ? 'guest' : 'host';
if (m) { S.room = m[1]; S.secret = C.b64d(m[2]); }
history.replaceState(null, '', location.pathname);
const gate = () => { show('gate'); $('gate-eyebrow').textContent = S.role === 'guest' ? 'You’re invited' : 'Before you start'; };
if (!window.RTCPeerConnection || !navigator.mediaDevices || !crypto.subtle) finish('Browser not supported', 'Open this in an up-to-date browser over HTTPS.', false);
else if (m) gate(); else show('home');
$('btn-start').onclick = gate;

// ---- location: held for the whole session; turning it off ends the chat ----
function stopGeo() { if (S.geo != null) navigator.geolocation.clearWatch(S.geo); S.geo = null; }
function locate() {
  return new Promise((res, rej) => {
    let first = true;
    S.geo = navigator.geolocation.watchPosition((p) => {
      S.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
      if (first) { first = false; res(); }
      shareLoc();
    }, (e) => {
      if (first) { first = false; rej(e); }
      else if (e.code === 1) finish('Session ended', 'Location access was turned off.', true);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  });
}
function shareLoc() {
  if (!S.up || !S.keys || !S.me || Date.now() - S.ls < 3000) return;
  S.ls = Date.now(); send({ k: 'loc', ...S.me });
}
function peerLoc(x) {
  if (![x.lat, x.lon, x.acc].every(Number.isFinite) || Math.abs(x.lat) > 90 || Math.abs(x.lon) > 180 || x.acc < 0) return;
  const a = $('loc-link');
  $('loc-text').textContent = `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)} (about ${Math.round(x.acc)} m)`;
  a.href = `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}`; a.hidden = false;
}

// ---- consent + permissions (camera, mic, location are all required) ----
const gs = (btn, dis, err = '') => { $('btn-allow').textContent = btn; $('btn-allow').disabled = dis; $('gate-error').textContent = err; };
$('btn-allow').onclick = async () => {
  gs('Waiting for permissions…', true);
  S.nick = $('nick').value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} } // optional
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { return gs('Try again', false, 'Camera, microphone and location are all needed. Allow them in your browser, then try again.'); }
  try { await locate(); }
  catch (e) {
    S.stream.getTracks().forEach((t) => t.stop()); stopGeo();
    return gs('Try again', false, e.code === 1 ? 'Location is needed too. Allow it in your browser, then try again.' : 'Couldn’t get your location. Make sure location is on, then try again.');
  }
  try { const r = await fetch('/api/ice', { cache: 'no-store' }); if (!r.ok) throw 0; S.ice = await r.json(); }
  catch { S.stream.getTracks().forEach((t) => t.stop()); stopGeo(); return gs('Try again', false, 'Couldn’t prepare a private connection. Try again.'); }
  gs('Starting…', true);
  for (const t of S.stream.getTracks()) t.onended = onEnded;
  $('local-video').srcObject = S.stream;
  start();
};

// ---- relay connection ----
function start() {
  if (S.role === 'host') {
    S.room = C.b64e(C.rand(16)); S.secret = C.rand(32);
    $('link').value = `${location.origin}/#${S.room}.${C.b64e(S.secret)}`; show('wait');
  } else show('connect');
  const ws = (S.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${S.room}?role=${S.role}`));
  keepAwake();
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => { S.q = S.q.then(typeof e.data === 'string' ? ctl(JSON.parse(e.data)) : () => frame(new Uint8Array(e.data))).catch(fail); };
  ws.onclose = () => { S.q = S.q.then(() => finish('Session ended', 'The connection closed.', S.up)); };
}
const ERR = { used: ['Link already used', 'Someone already opened this link. Ask for a new one.'], ended: ['Chat ended', 'This chat has ended and the link is no longer valid.'], notfound: ['Link not active', 'This link isn’t active. Ask for a new one.'] };
const ctl = (x) => x.s === 'peer' ? hs : x.s === 'end' ? () => finish('Session ended', 'The other person left.', S.up) : x.s === 'error' ? () => finish(...(ERR[x.code] || ERR.used), false) : () => {};

// ---- authenticated key exchange ----
async function hs() {
  show('connect'); notify('Someone joined your chat', 'join');
  S.timer = setTimeout(() => finish('Session ended', 'Couldn’t set up the secure call in time.', false), 45000);
  S.eph = await C.ephemeral(); S.auth = await C.authKey(S.secret, S.room);
  S.ws.send(C.cat([0], S.eph.pub, await C.sign(S.auth, S.role, S.room, S.eph.pub)));
}
async function frame(f) {
  if (f[0] === 0) {
    if (S.keys || f.length !== 98) throw 'bad';
    const pub = f.slice(1, 66);
    if (!(await C.verify(S.auth, S.role === 'host' ? 'guest' : 'host', S.room, pub, f.slice(66)))) throw 'auth';
    S.keys = await C.session(S.eph, pub, S.role);
    S.secret.fill(0); S.secret = S.eph = null;
    $('peer').textContent = 'Peer-' + S.keys.alias; $('code').textContent = S.keys.code;
    if (S.nick) send({ k: 'hi', n: S.nick });
    if (S.role === 'host') await call();
    return;
  }
  if (!S.keys || f[0] !== 1) throw 'bad';
  const { n, p } = await C.open(S.keys.rx, f);
  if (n !== ++S.r) throw 'order';
  return p[0] === 2 ? chunk(p) : json(JSON.parse(td.decode(p.subarray(1))));
}
function tx(type, body) {
  return (S.tx = S.tx.then(async () => {
    if (S.over) return;
    const f = await C.seal(S.keys.tx, ++S.n, C.cat([type], body));
    while (S.ws.bufferedAmount > 1 << 20 && !S.over) await new Promise((r) => setTimeout(r, 25));
    S.ws.send(f);
  }).catch(fail));
}
const send = (o) => tx(1, te.encode(JSON.stringify(o)));

// ---- encrypted call (signaling travels inside the encrypted channel) ----
function pc() {
  const p = (S.pc = new RTCPeerConnection({ iceServers: S.ice.iceServers, iceTransportPolicy: S.ice.relayOnly ? 'relay' : 'all' }));
  for (const t of S.stream.getTracks()) p.addTrack(t, S.stream);
  if (S.role === 'host') bindDC(p.createDataChannel('ctl'));
  p.ondatachannel = (e) => bindDC(e.channel);
  p.onicecandidate = (e) => e.candidate && send({ k: 'ice', c: e.candidate.toJSON() });
  p.ontrack = (e) => {
    const s = e.streams[0]; if (!s) return;
    if (s.id === S.msid) { const v = S.movie?.el; if (v && v.tagName === 'VIDEO') { v.srcObject = s; kick(v); } return; }
    if (S.camid && s.id !== S.camid) return;
    S.camid = s.id; $('remote-video').srcObject = s; $('remote-audio').srcObject = s;
  };
  p.onconnectionstatechange = () => {
    const c = p.connectionState;
    if (c === 'connected' && !S.up) { S.up = true; clearTimeout(S.timer); show('chat'); sys('Session started. Nothing is saved.'); S.ls = 0; shareLoc(); }
    else if (['disconnected', 'failed', 'closed'].includes(c)) finish('Session ended', 'The connection was interrupted.', S.up);
  };
  return p;
}
const flush = async () => { while (S.ic.length && S.pc?.remoteDescription) await S.pc.addIceCandidate(S.ic.shift()).catch(() => {}); };
async function call() { const p = pc(); await p.setLocalDescription(await p.createOffer()); await send({ k: 'sdp', d: { type: 'offer', sdp: p.localDescription.sdp } }); }

async function json(x) {
  if (x.k === 'sdp') {
    if (S.role === 'guest') {
      const p = S.pc || pc();
      await p.setRemoteDescription({ type: 'offer', sdp: String(x.d.sdp) }); await flush();
      await p.setLocalDescription(await p.createAnswer());
      await send({ k: 'sdp', d: { type: 'answer', sdp: p.localDescription.sdp } });
    } else { await S.pc.setRemoteDescription({ type: 'answer', sdp: String(x.d.sdp) }); await flush(); }
  } else if (x.k === 'ice') { S.ic.push(x.c); await flush(); }
  else if (x.k === 'nudge' || x.k === 'fx') misc(x);
  else if (x.k === 'hi') { const n = String(x.n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20); if (n) $('peer').textContent = n; }
  else if (x.k === 'opened') { const b = S.once.get(x.id); if (b) b.textContent = 'Opened by them.'; }
  else if (x.k === 'loc') peerLoc(x);
  else if (x.k === 'msg') { bubble('them').textContent = String(x.t).slice(0, 4000); notify('New message', 'msg'); }
  else if (x.k === 'file') {
    if (!Number.isInteger(x.id) || !Number.isInteger(x.size) || x.size > MAX || S.rx.size > 3) throw 'bad';
    const once = x.once === true, mime = String(x.mime || '');
    if (once && !ONCE.test(mime)) throw 'bad';
    notify('New message', 'msg');
    const b = bubble('them'); b.textContent = once ? 'Receiving a view-once photo or video…' : `Receiving ${nm(x.name)}…`;
    S.rx.set(x.id, { name: nm(x.name), size: x.size, got: 0, parts: [], b, once, mime });
  } else if (x.k === 'fend') {
    const r = S.rx.get(x.id); if (!r || r.got !== r.size) throw 'bad'; S.rx.delete(x.id);
    if (r.once) {
      const u = URL.createObjectURL(new Blob(r.parts, { type: r.mime })); S.urls.push(u);
      const btn = el('button', 'btn sm pri', `View once · ${r.mime.startsWith('video') ? 'video' : 'photo'}`);
      btn.onclick = () => viewOnce(x.id, u, r.mime, r.b); S.vo.set(x.id, 1); r.b.replaceChildren(btn);
    } else {
      const u = URL.createObjectURL(new Blob(r.parts, { type: 'application/octet-stream' })); S.urls.push(u);
      const a = document.createElement('a'); a.href = u; a.download = r.name; a.textContent = `${r.name} (${kb(r.size)}). Save`;
      r.b.replaceChildren(a);
    }
  } else if (x.k === 'bye') finish('Session ended', 'The other person ended the chat.', true);
}
function chunk(p) {
  const r = S.rx.get(new DataView(p.buffer, p.byteOffset + 1, 4).getUint32(0)); if (!r) throw 'bad';
  const d = p.slice(5); r.got += d.length; if (r.got > r.size) throw 'bad'; r.parts.push(d);
}

// ---- chat UI ----
const say = () => { const t = $('text').value.trim(); if (t) { $('text').value = ''; bubble('me').textContent = t; send({ k: 'msg', t }); } };
$('btn-send').onclick = say; $('text').onkeydown = (e) => { if (e.key === 'Enter') say(); };
// ---- composer menus: attach (file / view-once) and express (reactions + nudge) ----
const pops = { 'btn-attach': 'pa', 'btn-express': 'pe' };
const closePops = () => { for (const [b, p] of Object.entries(pops)) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } };
for (const [b, p] of Object.entries(pops)) $(b).onclick = (e) => { e.stopPropagation(); const open = $(p).hidden; closePops(); $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open)); };
document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });
$('pa-file').onclick = () => { closePops(); $('file').click(); };
$('pa-once').onclick = () => { closePops(); $('file-once').click(); };
async function sendMedia(f, once) {
  if (f.size > MAX) return sys('File too large (max 25 MB).');
  if (once && !ONCE.test(f.type)) return sys('View-once works with photos (JPG, PNG, GIF, WebP) and videos (MP4, WebM, MOV).');
  const id = ++S.fid, b = bubble('me');
  b.textContent = once ? `View-once ${f.type.startsWith('video') ? 'video' : 'photo'} sent` : `Sent ${nm(f.name)} (${kb(f.size)})`;
  if (once) S.once.set(id, b);
  await send({ k: 'file', id, name: f.name, size: f.size, once, mime: once ? f.type : '' });
  for (let o = 0; o < f.size; o += CH) { const h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, id); await tx(2, C.cat(h, new Uint8Array(await f.slice(o, o + CH).arrayBuffer()))); }
  await send({ k: 'fend', id });
}
$('file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) sendMedia(f, false); };
$('file-once').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) sendMedia(f, true); };
// view-once: shown full screen once, then wiped. (Nothing can stop a screenshot.)
function viewOnce(id, url, mime, b) {
  if (S.voCur) return;
  S.vo.delete(id); S.voCur = url;
  const m = mime.startsWith('video') ? el('video') : el('img');
  m.src = url; m.oncontextmenu = (e) => e.preventDefault();
  if (m.tagName === 'VIDEO') { m.controls = true; m.autoplay = true; m.playsInline = true; }
  $('vo-stage').replaceChildren(m); $('vo').hidden = false;
  b.textContent = 'Opened. It’s gone.'; send({ k: 'opened', id });
}
function closeOnce() { $('vo').hidden = true; $('vo-stage').replaceChildren(); if (S.voCur) { URL.revokeObjectURL(S.voCur); S.voCur = null; } }
$('vo-close').onclick = closeOnce;

// camera / mic buttons only change what *you* see and hear; streams flow the whole session
const vp = $('vp');
$('btn-cam').onclick = (e) => { vp.hidden = !vp.hidden; e.currentTarget.setAttribute('aria-pressed', String(!vp.hidden)); if (!vp.hidden) $('remote-video').play().catch(() => {}); };
$('btn-mic').onclick = (e) => { const a = $('remote-audio'); a.muted = !a.muted; e.currentTarget.setAttribute('aria-pressed', String(!a.muted)); a.play().catch(() => {}); };
for (const k of ['half', 'full']) $('vp-' + k).onclick = () => (vp.dataset.mode = k);
$('vp-close').onclick = () => { vp.hidden = true; $('btn-cam').setAttribute('aria-pressed', 'false'); };
$('btn-loc').onclick = (e) => { const p = $('loc'); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-pressed', String(!p.hidden)); };
// ---- nudge ----
function nudged() {
  const t = Date.now(); if (t - S.ln < 2000) return; S.ln = t;
  sys('They nudged you.');
  if (document.hidden) return notify('Nudge', 'nudge', [200, 100, 200, 100, 400]);
  navigator.vibrate?.([200, 100, 200, 100, 400]);
  const c = $('s-chat'); c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 600);
}
const tellPeer = (o) => (S.dc?.readyState === 'open' ? dsend(o) : send(o));
function misc(x) { if (x.k === 'nudge') nudged(); else if (x.k === 'fx' && ['kiss', 'slap', 'clap', 'yes'].includes(x.t)) react(x.t, false); }
$('btn-nudge').onclick = () => { const b = $('btn-nudge'); b.disabled = true; setTimeout(() => (b.disabled = false), 3000); tellPeer({ k: 'nudge' }); sys('You nudged them.'); };

// ---- reaction bursts: big full-screen effects ----
function react(t, mine) {
  const now = Date.now(); if (!mine && now - S.fxt < 350) return; S.fxt = now;
  const box = $('fx'); if (box.childElementCount > 40) return;
  const R = (a, b) => a + Math.random() * (b - a);
  const add = (cls, txt, css) => { const d = el('div', cls, txt); if (css) Object.assign(d.style, css); box.append(d); setTimeout(() => d.remove(), 2600); return d; };
  const shake = () => { const c = $('s-chat'); c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 600); };
  if (t === 'kiss') {
    add('fx-big fx-kiss', '💋', { left: R(12, 50) + '%', top: R(12, 42) + '%' });
    for (let i = 0; i < 9; i++) add('fx-float', i % 2 ? '💗' : '💖', { left: R(5, 90) + '%', animationDelay: R(0, 0.7) + 's', fontSize: R(30, 64) + 'px' });
  } else if (t === 'slap') {
    add('fx-flash'); add('fx-big fx-hand', '✋'); add('fx-word fx-smack', 'SMACK!'); setTimeout(shake, 380);
  } else if (t === 'clap') {
    add('fx-big fx-clap', '👏');
    for (let i = 0; i < 8; i++) add('fx-float fx-spark', '✨', { left: R(15, 85) + '%', top: R(25, 70) + '%', animationDelay: R(0.2, 1) + 's', fontSize: R(26, 52) + 'px' });
  } else {
    add('fx-word fx-yes', 'YESSS!');
    for (let i = 0; i < 44; i++) add('fx-conf', ['🎉', '🎊', '✨', '⭐'][i % 4], { left: R(0, 96) + '%', animationDuration: R(1.1, 2.1) + 's', animationDelay: R(0, 0.5) + 's', fontSize: R(22, 46) + 'px' });
    shake();
  }
  if (!mine) navigator.vibrate?.({ kiss: [60], slap: [120, 60, 240], clap: [50, 40, 50, 40, 50], yes: [100, 50, 100, 50, 300] }[t]);
}
function sendFx(t) { const now = Date.now(); if (now - S.cool < 600) return; S.cool = now; react(t, true); tellPeer({ k: 'fx', t }); }
for (const b of document.querySelectorAll('[data-fx]')) b.onclick = () => sendFx(b.dataset.fx);

// ---- sharing the link: share sheet and a QR code drawn on this device ----
$('btn-share').hidden = !navigator.share;
$('btn-share').onclick = () => navigator.share({ title: 'SamR messenger', text: 'Join my private chat', url: $('link').value }).catch(() => {});
function drawQR(c, text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), px = Math.floor(c.width / (n + 8)), off = Math.floor((c.width - px * n) / 2), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect(off + k * px, off + r * px, px, px);
}
$('btn-qr').onclick = () => {
  const c = $('qr'), show = c.hidden; c.hidden = !show; $('btn-qr').textContent = show ? 'Hide QR code' : 'Show QR code';
  if (show) drawQR(c, $('link').value);
};


// ---- watch together: controls and the movie itself go device to device (data channel / WebRTC), never through the relay ----
const YT = /^[\w-]{11}$/;
const bindDC = (dc) => {
  S.dc = dc;
  dc.onmessage = (e) => {
    try {
      if (typeof e.data !== 'string' || e.data.length > 60000) return;
      const x = JSON.parse(e.data);
      if (x.k !== 'msdp' && e.data.length > 4000) return; // only the connection details may be large
      const c = String(x.k)[0];
      Promise.resolve((c === 'g' ? gameMsg : c === 'm' ? movieMsg : misc)(x)).catch(() => {});
    } catch {}
  };
};
function kick(v) { v.play().catch(() => { const b = el('button', 'btn pri tap', 'Tap to play'); b.onclick = () => { v.play(); b.remove(); }; $('mv-stage').append(b); }); }
const dsend = (o) => { if (S.dc?.readyState === 'open') S.dc.send(JSON.stringify(o)); };
function parseLink(s) {
  let u; try { u = new URL(String(s).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.replace(/^(www|m|music)\./, '');
  if (h === 'youtu.be' || h === 'youtube.com') {
    const id = h === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.split('/').pop();
    return YT.test(id) ? { mode: 'yt', id } : null;
  }
  const m = /\.(mp4|webm|m4v|ogv|mp3|m4a|aac|ogg|oga|wav)$/i.exec(u.pathname);
  return m ? { mode: 'url', url: u.href, au: /^(mp3|m4a|aac|ogg|oga|wav)$/i.test(m[1]) } : null;
}
const cur2 = () => { const M = S.movie, e = M.el; return e.tagName === 'VIDEO' ? e.currentTime : M.base + (M.since ? (Date.now() - M.since) / 1000 : 0); };
function run(a, t) {
  const M = S.movie, e = M.el;
  if (e.tagName === 'VIDEO') {
    if (Math.abs(e.currentTime - t) > 0.7) e.currentTime = t;
    if (a === 'play') e.play().catch(() => {}); else if (a === 'pause') e.pause();
  } else {
    const on = a === 'play' ? true : a === 'pause' ? false : !!M.since;
    const f = (fn, args = []) => e.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: fn, args }), 'https://www.youtube-nocookie.com');
    f('seekTo', [t, true]); f(on ? 'playVideo' : 'pauseVideo');
    M.base = t; M.since = on ? Date.now() : null;
  }
}
function mctl(a, d = 0) {
  const M = S.movie; if (!M) return;
  if (M.mode === 'file' && !M.own) return dsend({ k: 'mctl', a, d }); // viewer asks the device that holds the file
  const t = Math.max(0, cur2() + d);
  run(a, t);
  if (M.mode !== 'file') dsend({ k: 'mctl', a, t });
}
function mount(m) {
  const st = $('mv-stage'); st.replaceChildren();
  const M = (S.movie = { mode: m.mode, own: m.own, base: 0, since: null });
  if (m.mode === 'yt') {
    const f = document.createElement('iframe');
    f.allow = 'autoplay; encrypted-media; fullscreen'; f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.src = `https://www.youtube-nocookie.com/embed/${m.id}?enablejsapi=1&controls=0&playsinline=1&rel=0&disablekb=1&origin=${encodeURIComponent(location.origin)}`;
    M.el = f;
  } else {
    const v = m.el || document.createElement('video'); v.playsInline = true;
    if (m.mode === 'url') v.src = m.url;
    if (m.mode === 'file' && !m.own) v.autoplay = true;
    M.el = v;
  }
  st.append(M.el); if (m.cap) st.append(el('div', 'cap', m.cap));
  $('mv').hidden = false; $('mchoose').hidden = true; $('vp').hidden = true; $('btn-cam').setAttribute('aria-pressed', 'false');
  sys('Press Play to start together.');
}
const renego = async () => { const p = S.pc; await p.setLocalDescription(await p.createOffer()); dsend({ k: 'msdp', d: { type: 'offer', sdp: p.localDescription.sdp } }); };
function stopMovie(tell) {
  if (!S.movie) return;
  if (tell) dsend({ k: 'mstop' });
  if (S.mstream) {
    S.mstream.getTracks().forEach((t) => t.stop());
    S.msend.forEach((x) => { try { S.pc.removeTrack(x); } catch {} });
    S.mstream = null; renego().catch(() => {});
  }
  try { S.movie.el.pause?.(); if (S.movie.el.tagName === 'VIDEO') S.movie.el.srcObject = null; } catch {}
  S.movie = null; S.msid = null; $('mv-stage').replaceChildren(); $('mv').hidden = true;
}
async function movieMsg(x) {
  if (x.k === 'mstart') {
    if (S.movie) { if (S.role === 'host') return; stopMovie(false); }
    const ok = x.mode === 'file' ? typeof x.sid === 'string' : x.mode === 'yt' ? YT.test(x.id) : x.mode === 'url' && parseLink(x.url)?.mode === 'url';
    if (!ok) return;
    const pl = x.mode === 'url' ? parseLink(x.url) : null, au = x.mode === 'file' ? x.au === true : !!pl?.au;
    const what = x.mode === 'file' ? (au ? 'music from their device' : 'a movie from their device') : x.mode === 'yt' ? 'a YouTube video' : (au ? 'music from ' : 'a video from ') + new URL(x.url).hostname;
    if (!confirm(`They want to watch ${what} with you. Join?`)) return dsend({ k: 'mstop' });
    if (x.mode === 'file') S.msid = x.sid;
    mount({ mode: x.mode, id: x.id, url: pl ? pl.url : null, own: false, cap: au ? (x.mode === 'file' ? '♪ ' + nm(x.name) : '♪ Listening together') : null });
  } else if (x.k === 'msdp' && x.d && (x.d.type === 'offer' || x.d.type === 'answer')) {
    const p = S.pc, d = { type: x.d.type, sdp: String(x.d.sdp) };
    if (d.type === 'offer') { await p.setRemoteDescription(d); await p.setLocalDescription(await p.createAnswer()); dsend({ k: 'msdp', d: { type: 'answer', sdp: p.localDescription.sdp } }); }
    else await p.setRemoteDescription(d);
  } else if (x.k === 'mctl') {
    const M = S.movie; if (!M || !['play', 'pause', 'seek'].includes(x.a)) return;
    if (M.mode === 'file') { if (M.own) run(x.a, Math.max(0, cur2() + (+x.d || 0))); }
    else if (Number.isFinite(x.t)) run(x.a, Math.max(0, x.t));
  } else if (x.k === 'mstop') stopMovie(false);
}
$('btn-movie').onclick = () => { if (S.movie) $('mv').hidden = !$('mv').hidden; else $('mchoose').hidden = !$('mchoose').hidden; };
$('m-go').onclick = () => {
  const L = parseLink($('m-link').value);
  if (!L) return sys(/spotify\.com/i.test($('m-link').value) ? 'Spotify can’t be kept in sync. Use the YouTube link or pick an audio file.' : 'Only YouTube links and direct video or audio file links work.');
  if (S.dc?.readyState !== 'open' || S.movie) return sys('Not ready yet, or a movie is already on.');
  mount({ ...L, own: true, cap: L.au ? '♪ Listening together' : null }); dsend({ k: 'mstart', ...L }); $('m-link').value = '';
};
$('m-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (S.dc?.readyState !== 'open' || S.movie) return sys('Not ready yet, or a movie is already on.');
  const v = document.createElement('video'); v.playsInline = true; v.src = URL.createObjectURL(f); S.urls.push(v.src);
  try { await v.play(); } catch { return sys('Couldn’t play that file.'); }
  const ms = v.captureStream ? v.captureStream() : v.mozCaptureStream?.();
  await new Promise((r) => setTimeout(r, 400));
  if (!ms || !ms.getTracks().length) { v.pause(); return sys('This browser can’t share a file. Try Chrome or Firefox, or paste a link instead.'); }
  v.pause(); v.currentTime = 0;
  const au = f.type.startsWith('audio/');
  mount({ mode: 'file', own: true, el: v, cap: au ? '♪ ' + nm(f.name) : null });
  S.mstream = ms; S.msend = ms.getTracks().map((t) => S.pc.addTrack(t, ms));
  dsend({ k: 'mstart', mode: 'file', sid: ms.id, au, name: nm(f.name) });
  renego().catch(() => stopMovie(true));
};
for (const [id, a, d] of [['mv-play', 'play', 0], ['mv-pause', 'pause', 0], ['mv-back', 'seek', -10], ['mv-fwd', 'seek', 10]]) $(id).onclick = () => mctl(a, d);
$('mv-full').onclick = () => { const m = $('mv'); m.dataset.mode = m.dataset.mode === 'full' ? 'half' : 'full'; };
$('mv-stop').onclick = () => stopMovie(true);
// ---- games: moves go device to device over the data channel, nothing is stored ----
const GN = { ttt: 'Tic tac toe', c4: 'Connect Four', rps: 'Rock paper scissors', draw: 'Drawing board' };
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
const gstat = (t) => { $('g-status').textContent = t; };
function closeGame(tell) {
  if (!S.game) return;
  if (tell) dsend({ k: 'gstop' });
  S.game = null; $('g-board').replaceChildren(); $('gp').hidden = true;
}
function startGame(g, me) {
  closeGame(false);
  S.game = { g, me, turn: 0, over: false };
  $('gchoose').hidden = true; $('gp').hidden = false; $('g-title').textContent = GN[g]; $('g-board').replaceChildren();
  ({ ttt: tttInit, c4: c4Init, rps: rpsInit, draw: drawInit })[g]();
}
function beginGame(g) {
  if (S.dc?.readyState !== 'open') return sys('Not ready yet.');
  S.gt = Date.now(); startGame(g, 0); dsend({ k: 'gstart', g });
}
const turnText = (G, extra = '') => `${G.turn === G.me ? 'Your turn' : 'Their turn'}${extra}`;

// tic tac toe
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function tttInit() {
  const G = S.game; G.b = Array(9).fill(null); G.cells = [];
  const grid = el('div', 'ttt');
  for (let i = 0; i < 9; i++) { const c = el('button', 'cell'); c.setAttribute('aria-label', 'Cell ' + (i + 1)); c.onclick = () => tttPlay(i, G.me); grid.append(c); G.cells.push(c); }
  $('g-board').append(grid); tttShow();
}
function tttPlay(i, who) {
  const G = S.game;
  if (!G || G.g !== 'ttt' || G.over || G.turn !== who || G.b[i] != null) return;
  G.b[i] = who; G.turn = 1 - who;
  if (who === G.me) dsend({ k: 'gmove', i });
  tttShow();
}
function tttShow() {
  const G = S.game, mk = ['X', 'O'];
  G.cells.forEach((c, i) => { c.textContent = G.b[i] == null ? '' : mk[G.b[i]]; });
  const w = LINES.find((l) => G.b[l[0]] != null && l.every((k) => G.b[k] === G.b[l[0]]));
  if (w) { G.over = true; gstat(G.b[w[0]] === G.me ? 'You win!' : 'They win.'); }
  else if (G.b.every((v) => v != null)) { G.over = true; gstat('Draw.'); }
  else gstat(turnText(G, ` (you are ${mk[G.me]})`));
}

// connect four
function c4Init() {
  const G = S.game; G.b = Array.from({ length: 7 }, () => []); G.cols = [];
  const grid = el('div', 'c4');
  for (let c = 0; c < 7; c++) {
    const col = el('button', 'col'); col.setAttribute('aria-label', 'Column ' + (c + 1)); col.onclick = () => c4Play(c, G.me);
    const cells = []; for (let r = 0; r < 6; r++) { const d = el('span', 'disc'); col.append(d); cells.push(d); }
    G.cols.push(cells); grid.append(col);
  }
  $('g-board').append(grid); c4Show();
}
function c4Play(c, who) {
  const G = S.game;
  if (!G || G.g !== 'c4' || G.over || G.turn !== who || G.b[c].length >= 6) return;
  G.b[c].push(who); G.turn = 1 - who;
  if (who === G.me) dsend({ k: 'gmove', c });
  c4Show();
}
function c4Show() {
  const G = S.game, at = (c, r) => (c < 0 || c > 6 || r < 0 || r > 5 ? null : G.b[c][r] ?? null);
  let win = null;
  for (let c = 0; c < 7; c++) for (let r = 0; r < 6; r++) {
    const p = at(c, r); G.cols[c][5 - r].className = 'disc' + (p == null ? '' : p === 0 ? ' a' : ' b');
    if (p == null) continue;
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) if ([1, 2, 3].every((k) => at(c + dc * k, r + dr * k) === p)) win = p;
  }
  if (win != null) { G.over = true; gstat(win === G.me ? 'You win!' : 'They win.'); }
  else if (G.b.every((col) => col.length === 6)) { G.over = true; gstat('Draw.'); }
  else gstat(turnText(G, ` (you are ${G.me ? 'teal' : 'orange'})`));
}

// rock paper scissors: both lock in a hidden pick first, then reveal, so nobody can change theirs after seeing the other's
const RPS = ['Rock', 'Paper', 'Scissors'];
const sha = async (s) => C.b64e(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s))));
function rpsInit() { S.game.score = [0, 0]; rpsRound(); }
function rpsRound() {
  const G = S.game; Object.assign(G, { pick: null, nonce: null, hash: null, oh: null, orev: null, sent: false, done: false });
  const box = el('div', 'rps'); G.btns = RPS.map((n, i) => { const b = el('button', 'btn', n); b.onclick = () => rpsPick(i); box.append(b); return b; });
  G.res = el('p', 'gres'); $('g-board').replaceChildren(box, G.res); rpsStep();
}
async function rpsPick(i) {
  const G = S.game; if (!G || G.g !== 'rps' || G.pick != null) return;
  G.pick = i; G.nonce = C.b64e(C.rand(12)); G.hash = await sha(`${i}:${G.nonce}`);
  dsend({ k: 'gmove', h: G.hash }); rpsStep();
}
function rpsStep() {
  const G = S.game; if (!G || G.g !== 'rps') return;
  G.btns.forEach((b, i) => { b.disabled = G.pick != null; b.classList.toggle('pri', G.pick === i); });
  if (G.hash && G.oh && !G.sent) { G.sent = true; dsend({ k: 'gmove', r: G.pick, n: G.nonce }); }
  const sc = `Score: you ${G.score[0]}, them ${G.score[1]}`;
  if (G.cheat) { gstat('They changed their pick.'); G.res.textContent = sc; return; }
  if (G.pick != null && G.orev != null && !G.done) {
    G.done = true; const d = (G.pick - G.orev + 3) % 3;
    if (d === 1) G.score[0]++; else if (d === 2) G.score[1]++;
    gstat(d === 0 ? 'Tie.' : d === 1 ? 'You win this round!' : 'They win this round.');
    G.res.textContent = `You: ${RPS[G.pick]} · Them: ${RPS[G.orev]}. Score: you ${G.score[0]}, them ${G.score[1]}. `;
    const nx = el('button', 'btn sm', 'Next round'); nx.onclick = () => { dsend({ k: 'gmove', nx: 1 }); rpsRound(); }; G.res.append(nx);
  } else if (!G.done) {
    gstat(G.pick == null ? 'Pick one.' : 'Waiting for them…'); G.res.textContent = sc;
  }
}
async function rpsMsg(G, x) {
  if (x.nx && G.done) return rpsRound();
  if (typeof x.h === 'string' && x.h.length < 100 && !G.oh) { G.oh = x.h; rpsStep(); }
  else if (Number.isInteger(x.r) && x.r >= 0 && x.r < 3 && typeof x.n === 'string' && x.n.length < 40 && G.oh && G.orev == null) {
    if ((await sha(`${x.r}:${x.n}`)) === G.oh) G.orev = x.r; else G.cheat = true;
    rpsStep();
  }
}

// drawing board: both people draw on the same canvas
function drawInit() {
  const G = S.game; G.col = '#5FC9A8'; G.my = { last: null }; G.their = { last: null };
  const cv = el('canvas', 'draw'); cv.width = cv.height = 600; G.cv = cv; G.cx = cv.getContext('2d');
  Object.assign(G.cx, { lineCap: 'round', lineJoin: 'round', lineWidth: 5 });
  const tools = el('div', 'dtools');
  for (const c of ['#5FC9A8', '#E08A6A', '#ECECE9', '#6AA9FF']) { const b = el('button', 'sw'); b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c); b.onclick = () => (G.col = c); tools.append(b); }
  const clr = el('button', 'btn sm', 'Clear'); clr.onclick = () => { G.cx.clearRect(0, 0, 600, 600); dsend({ k: 'gclear' }); }; tools.append(clr);
  let down = false, buf = [];
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.height) * 1000)]; };
  const flush = (s) => { if (buf.length) dsend({ k: 'gdraw', c: G.col, s, p: buf }); buf = []; };
  cv.onpointerdown = (e) => { down = true; cv.setPointerCapture(e.pointerId); const p = pt(e); seg(G, G.my, G.col, 1, p); buf = [...p]; flush(1); };
  cv.onpointermove = (e) => { if (!down) return; const p = pt(e); seg(G, G.my, G.col, 0, p); buf.push(...p); if (buf.length >= 16) flush(0); };
  cv.onpointerup = cv.onpointercancel = () => { if (down) flush(0); down = false; };
  $('g-board').append(tools, cv); gstat('Draw together. Either of you can draw.');
}
function seg(G, st, col, s, p) {
  const cx = G.cx, f = 0.6; cx.strokeStyle = cx.fillStyle = col;
  let prev = s ? null : st.last;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i] * f, y = p[i + 1] * f; cx.beginPath();
    if (prev) { cx.moveTo(prev[0], prev[1]); cx.lineTo(x, y); cx.stroke(); } else { cx.arc(x, y, 2.5, 0, 7); cx.fill(); }
    prev = [x, y];
  }
  st.last = prev;
}
async function gameMsg(x) {
  if (x.k === 'gstart') {
    if (!GN[x.g] || (S.game && S.role === 'host' && Date.now() - S.gt < 1500)) return; // if both start at once, the host's wins
    startGame(x.g, 1); sys(`They started ${GN[x.g]}.`); return;
  }
  if (x.k === 'gstop') { if (S.game) { closeGame(false); sys('They closed the game.'); } return; }
  const G = S.game; if (!G) return;
  if (x.k === 'gmove') {
    if (G.g === 'ttt' && Number.isInteger(x.i) && x.i >= 0 && x.i < 9) tttPlay(x.i, 1 - G.me);
    else if (G.g === 'c4' && Number.isInteger(x.c) && x.c >= 0 && x.c < 7) c4Play(x.c, 1 - G.me);
    else if (G.g === 'rps') await rpsMsg(G, x);
  } else if (G.g === 'draw') {
    if (x.k === 'gdraw' && /^#[0-9a-f]{6}$/i.test(x.c) && Array.isArray(x.p) && x.p.length <= 64 && x.p.every(Number.isFinite)) seg(G, G.their, x.c, x.s ? 1 : 0, x.p);
    else if (x.k === 'gclear') G.cx.clearRect(0, 0, 600, 600);
  }
}
$('btn-games').onclick = () => { if (S.game) $('gp').hidden = !$('gp').hidden; else $('gchoose').hidden = !$('gchoose').hidden; };
for (const b of document.querySelectorAll('#gchoose [data-g]')) b.onclick = () => beginGame(b.dataset.g);
$('g-new').onclick = () => S.game && beginGame(S.game.g);
$('g-close').onclick = () => closeGame(true);
$('btn-end').onclick = async () => { await Promise.race([send({ k: 'bye' }), new Promise((r) => setTimeout(r, 300))]); finish('Session ended', 'You ended the chat.', true); };
$('btn-cancel').onclick = () => finish('Link cancelled', 'Nothing was shared.', false);
$('btn-copy').onclick = async () => { await navigator.clipboard.writeText($('link').value).catch(() => $('link').select()); $('btn-copy').textContent = 'Copied'; setTimeout(() => ($('btn-copy').textContent = 'Copy link'), 1500); };
$('btn-new').onclick = () => location.reload();
