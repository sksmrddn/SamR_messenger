const S = crypto.subtle, te = new TextEncoder();
export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const b64e = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
export const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// Fresh ECDH key pair per session; never stored.
export const ephemeral = async () => {
  const k = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { priv: k.privateKey, pub: new Uint8Array(await S.exportKey('raw', k.publicKey)) };
};

// The link's fragment secret (never sent to the server) authenticates the key exchange.
export const authKey = async (secret, room) => S.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt: te.encode(room), info: te.encode('samr/auth') },
  await S.importKey('raw', secret, 'HKDF', false, ['deriveKey']),
  { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
const msg = (role, room, pub) => cat(te.encode(`samr/hello|${role}|${room}|`), pub);
export const sign = async (k, role, room, pub) => new Uint8Array(await S.sign('HMAC', k, msg(role, room, pub)));
export const verify = (k, role, room, pub, mac) => S.verify('HMAC', k, mac, msg(role, room, pub));

export async function session(eph, peer, role) {
  const shared = await S.deriveBits({ name: 'ECDH', public: await S.importKey('raw', peer, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, eph.priv, 256);
  const [h, g] = role === 'host' ? [eph.pub, peer] : [peer, eph.pub];
  const salt = new Uint8Array(await S.digest('SHA-256', cat(h, g)));
  const base = await S.importKey('raw', shared, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const p = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) });
  const aes = (info) => S.deriveKey(p(info), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const [a, b] = await Promise.all([aes('samr/h2g'), aes('samr/g2h')]); // one key per direction
  const sas = new DataView(await S.deriveBits(p('samr/sas'), base, 48));
  const code = [0, 2, 4].map((i) => String(sas.getUint16(i) % 10000).padStart(4, '0')).join(' ');
  const alias = [...new Uint8Array(await S.digest('SHA-256', peer)).slice(0, 2)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { tx: role === 'host' ? a : b, rx: role === 'host' ? b : a, alias, code };
}

const iv = (n) => { const v = new Uint8Array(12); new DataView(v.buffer).setUint32(8, n); return v; };
export async function seal(key, n, plain) {
  const h = new Uint8Array(5); h[0] = 1; new DataView(h.buffer).setUint32(1, n);
  return cat(h, new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv: iv(n), additionalData: h }, key, plain)));
}
export async function open(key, f) {
  const h = f.slice(0, 5), n = new DataView(h.buffer).getUint32(1);
  return { n, p: new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: iv(n), additionalData: h }, key, f.slice(5))) };
}
