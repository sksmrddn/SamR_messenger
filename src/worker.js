// SamR messenger relay. Forwards opaque encrypted frames between exactly two sockets.
const MAX = 1 << 20;

export class Room {
  constructor(state) { this.st = state; this.host = null; this.guest = null; this.over = false; }

  async fetch(req) {
    const role = new URL(req.url).searchParams.get('role');
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const no = (code) => { try { server.send(JSON.stringify({ s: 'error', code })); server.close(1008, code); } catch {} };
    if (this.over || (await this.st.storage.get('over'))) no('ended');
    else if (role === 'host' && !this.host && !this.guest) {
      this.host = server; this.wire(server);
      server.send('{"s":"wait"}');
      await this.st.storage.setAlarm(Date.now() + 30 * 60e3); // unclaimed link expires
    } else if (role === 'guest' && this.host && !this.guest) {
      this.guest = server; this.wire(server);
      for (const w of [this.host, this.guest]) w.send('{"s":"peer"}');
    } else no(role === 'guest' && !this.host ? 'notfound' : 'used');
    return new Response(null, { status: 101, webSocket: client });
  }

  wire(ws) {
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string') return; // clients never send text
      const to = ws === this.host ? this.guest : this.host;
      if (!to) return;
      if (e.data.byteLength > MAX) return this.end();
      try { to.send(e.data); } catch { this.end(); }
    });
    ws.addEventListener('close', () => this.end());
    ws.addEventListener('error', () => this.end());
  }

  async end() { // any disconnect kills the room for good
    if (this.over) return;
    this.over = true;
    for (const w of [this.host, this.guest]) if (w) { try { w.send('{"s":"end"}'); w.close(1000, 'ended'); } catch {} }
    this.host = this.guest = null;
    await this.st.storage.put('over', true); // tombstone so the link can never be reused
    await this.st.storage.setAlarm(Date.now() + 864e5);
  }

  async alarm() {
    if (this.over || (await this.st.storage.get('over'))) return this.st.storage.deleteAll();
    if (this.host && !this.guest) return this.end();
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/api/ice') {
      let iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }], relayOnly = false;
      if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) { // optional: hides both IPs from each other
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: '{"ttl":3600}',
        });
        if (!r.ok) return new Response('relay unavailable', { status: 502 }); // fail closed
        iceServers = (await r.json()).iceServers; relayOnly = true;
      }
      return Response.json({ iceServers, relayOnly }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const m = /^\/ws\/([\w-]{22})$/.exec(u.pathname);
    if (!m) return new Response('Not found', { status: 404 });
    const o = req.headers.get('Origin');
    if (req.headers.get('Upgrade') !== 'websocket' || (o && new URL(o).host !== u.host)) return new Response('Forbidden', { status: 403 });
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};
