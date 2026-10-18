import * as C from './crypto.js';
const $ = (i) => document.getElementById(i), te = new TextEncoder(), td = new TextDecoder();
const MAX = 25 << 20, CH = 48 << 10;
const S = { over: false, up: false, rx: new Map(), urls: [], ic: [], q: Promise.resolve(), tx: Promise.resolve(), n: 0, r: 0, fid: 0, ls: 0 };
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
  for (const t of S.stream.getTracks()) t.onended = () => finish('Session ended', 'Camera or microphone access was turned off.', true);
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
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => { S.q = S.q.then(typeof e.data === 'string' ? ctl(JSON.parse(e.data)) : () => frame(new Uint8Array(e.data))).catch(fail); };
  ws.onclose = () => { S.q = S.q.then(() => finish('Session ended', 'The connection closed.', S.up)); };
}
const ERR = { used: ['Link already used', 'Someone already opened this link. Ask for a new one.'], ended: ['Chat ended', 'This chat has ended and the link is no longer valid.'], notfound: ['Link not active', 'This link isn’t active. Ask for a new one.'] };
const ctl = (x) => x.s === 'peer' ? hs : x.s === 'end' ? () => finish('Session ended', 'The other person left.', S.up) : x.s === 'error' ? () => finish(...(ERR[x.code] || ERR.used), false) : () => {};

// ---- authenticated key exchange ----
async function hs() {
  show('connect');
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
  p.onicecandidate = (e) => e.candidate && send({ k: 'ice', c: e.candidate.toJSON() });
  p.ontrack = (e) => { $('remote-video').srcObject = e.streams[0]; $('remote-audio').srcObject = e.streams[0]; };
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
  else if (x.k === 'loc') peerLoc(x);
  else if (x.k === 'msg') bubble('them').textContent = String(x.t).slice(0, 4000);
  else if (x.k === 'file') {
    if (!Number.isInteger(x.id) || !Number.isInteger(x.size) || x.size > MAX || S.rx.size > 3) throw 'bad';
    const b = bubble('them'); b.textContent = `Receiving ${nm(x.name)}…`;
    S.rx.set(x.id, { name: nm(x.name), size: x.size, got: 0, parts: [], b });
  } else if (x.k === 'fend') {
    const r = S.rx.get(x.id); if (!r || r.got !== r.size) throw 'bad';
    const u = URL.createObjectURL(new Blob(r.parts, { type: 'application/octet-stream' })); S.urls.push(u);
    const a = document.createElement('a'); a.href = u; a.download = r.name; a.textContent = `${r.name} (${kb(r.size)}). Save`;
    r.b.replaceChildren(a); S.rx.delete(x.id);
  } else if (x.k === 'bye') finish('Session ended', 'The other person ended the chat.', true);
}
function chunk(p) {
  const r = S.rx.get(new DataView(p.buffer, p.byteOffset + 1, 4).getUint32(0)); if (!r) throw 'bad';
  const d = p.slice(5); r.got += d.length; if (r.got > r.size) throw 'bad'; r.parts.push(d);
}

// ---- chat UI ----
const say = () => { const t = $('text').value.trim(); if (t) { $('text').value = ''; bubble('me').textContent = t; send({ k: 'msg', t }); } };
$('btn-send').onclick = say; $('text').onkeydown = (e) => { if (e.key === 'Enter') say(); };
$('file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > MAX) return sys('File too large (max 25 MB).');
  const id = ++S.fid; bubble('me').textContent = `Sent ${nm(f.name)} (${kb(f.size)})`;
  await send({ k: 'file', id, name: f.name, size: f.size });
  for (let o = 0; o < f.size; o += CH) { const h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, id); await tx(2, C.cat(h, new Uint8Array(await f.slice(o, o + CH).arrayBuffer()))); }
  await send({ k: 'fend', id });
};
// camera / mic buttons only change what *you* see and hear; streams flow the whole session
const vp = $('vp');
$('btn-cam').onclick = (e) => { vp.hidden = !vp.hidden; e.currentTarget.setAttribute('aria-pressed', String(!vp.hidden)); if (!vp.hidden) $('remote-video').play().catch(() => {}); };
$('btn-mic').onclick = (e) => { const a = $('remote-audio'); a.muted = !a.muted; e.currentTarget.setAttribute('aria-pressed', String(!a.muted)); a.play().catch(() => {}); };
for (const k of ['half', 'full']) $('vp-' + k).onclick = () => (vp.dataset.mode = k);
$('vp-close').onclick = () => { vp.hidden = true; $('btn-cam').setAttribute('aria-pressed', 'false'); };
$('btn-loc').onclick = (e) => { const p = $('loc'); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-pressed', String(!p.hidden)); };
$('btn-end').onclick = async () => { await Promise.race([send({ k: 'bye' }), new Promise((r) => setTimeout(r, 300))]); finish('Session ended', 'You ended the chat.', true); };
$('btn-cancel').onclick = () => finish('Link cancelled', 'Nothing was shared.', false);
$('btn-copy').onclick = async () => { await navigator.clipboard.writeText($('link').value).catch(() => $('link').select()); $('btn-copy').textContent = 'Copied'; setTimeout(() => ($('btn-copy').textContent = 'Copy link'), 1500); };
$('btn-new').onclick = () => location.reload();
