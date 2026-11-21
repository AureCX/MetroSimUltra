// Client side of online multiplayer: WebSocket connection with automatic reconnection (session resumed with a
// token), session browser / create / join / invite links, player list, the other players' vehicles
// (interpolated 150 ms behind for smooth motion), movement authority and corrections from the server,
// service events. The games call startDriving / sendState / event and read remotes() / authority.
const TOKEN_KEY = 'metrosim.mp.token';
const INTERP_MS = 150;

export function defaultServerUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  // Served by the multiplayer server itself (same origin) — not on GitHub Pages or a file.
  if (/^https?:$/.test(location.protocol) && !/github\.io$|claude\.ai$|claudeusercontent/.test(location.hostname) && location.port !== '5173' && location.port !== '5179') return location.origin;
  return '';
}
export function wsUrl(server) {
  const u = new URL(server.includes('://') ? server : `https://${server}`);
  u.protocol = u.protocol === 'http:' ? 'ws:' : u.protocol === 'https:' ? 'wss:' : u.protocol;
  if (!u.pathname.endsWith('/ws')) u.pathname = `${u.pathname.replace(/\/$/, '')}/ws`;
  return u.toString();
}

export class Multiplayer {
  constructor(bus, settings) {
    this.bus = bus; this.settings = settings;
    this.status = 'offline';     // offline | connecting | online | reconnecting | error
    this.error = null; this.ping = null;
    this.me = null; this.session = null; this.players = []; this.feed = [];
    this.remote = new Map();     // id -> { buf: [{at, ...state}], kind }
    this.authority = null; this.authorityBehind = null;
    this.sessions = [];
    this.drive = null; this.lastSent = 0;
    this.retry = 0; this.wantOnline = false;
    this.clockOffset = 0;
  }
  get online() { return this.status === 'online'; }
  get inSession() { return this.online && !!this.session; }
  setStatus(s, err = null) { this.status = s; this.error = err; this.bus.emit('mp:status', this.snapshot()); }
  snapshot() { return { status: this.status, error: this.error, ping: this.ping, session: this.session, players: this.players, me: this.me, server: this.server }; }

  connect(server, name) {
    this.server = server.trim(); this.name = (name || '').trim() || 'Driver';
    this.settings?.set('multiplayer.server', this.server); this.settings?.set('multiplayer.name', this.name);
    this.wantOnline = true; this.retry = 0;
    this.open();
  }
  open() {
    clearTimeout(this.retryTimer);
    let url;
    try { url = wsUrl(this.server); } catch { this.setStatus('error', 'Invalid server address.'); return; }
    this.setStatus(this.retry ? 'reconnecting' : 'connecting');
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.fail(`Cannot connect: ${e.message}`); return; }
    this.ws = ws;
    const timeout = setTimeout(() => { if (ws.readyState !== 1) { ws.close(); this.fail('The server did not answer (timeout).'); } }, 8000);
    ws.onopen = () => {
      clearTimeout(timeout);
      this.retry = 0;
      let tokens = {}; try { tokens = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}'); } catch { /* storage blocked */ }
      this.send({ t: 'hello', name: this.name, token: tokens[this.server] });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 3000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.handle(m); };
    ws.onerror = () => {};
    ws.onclose = (e) => {
      clearTimeout(timeout); clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.wantOnline) this.fail(e.code === 1006 && this.status === 'connecting' ? 'Cannot reach the server. Check the address and that it is running.' : 'Connection lost.');
      else this.setStatus('offline');
    };
  }
  fail(msg) {
    if (!this.wantOnline) return;
    // Automatic reconnection with backoff; the session and vehicle are resumed by the server.
    this.retry++;
    const wait = Math.min(15000, 1000 * 2 ** Math.min(4, this.retry - 1));
    this.setStatus(this.retry > 6 ? 'error' : 'reconnecting', `${msg} Retrying in ${Math.round(wait / 1000)} s…`);
    this.retryTimer = setTimeout(() => this.wantOnline && this.open(), wait);
  }
  disconnect() {
    this.wantOnline = false; clearTimeout(this.retryTimer); clearInterval(this.pingTimer);
    const ws = this.ws; this.ws = null; ws?.close();
    this.session = null; this.players = []; this.remote.clear(); this.authority = null;
    this.setStatus('offline');
  }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  handle(m) {
    switch (m.t) {
      case 'welcome': {
        this.me = { id: m.id, name: m.name, color: m.color };
        try { const tokens = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}'); tokens[this.server] = m.token; localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch { /* storage blocked */ }
        this.clockOffset = m.serverTime - Date.now();
        if (m.session) this.session = m.session;
        this.setStatus('online');
        if (m.resumed && this.drive) this.send({ t: 'drive', drive: this.drive });
        else if (this.pendingJoin) { this.join(this.pendingJoin); this.pendingJoin = null; }
        else if (this.session && !m.resumed) this.session = null;
        this.list();
        break;
      }
      case 'pong': this.ping = Math.round(performance.now() - m.c); this.bus.emit('mp:status', this.snapshot()); break;
      case 'sessions': this.sessions = m.list; this.bus.emit('mp:sessions', m.list); break;
      case 'joined': this.session = m.session; this.remote.clear(); if (this.drive) this.send({ t: 'drive', drive: this.drive }); this.setStatus('online'); break;
      case 'left': this.session = null; this.players = []; this.remote.clear(); this.setStatus('online'); break;
      case 'players':
        this.players = m.list;
        for (const id of [...this.remote.keys()]) if (!m.list.some((p) => p.id === id && p.online && p.drive)) this.remote.delete(id);
        this.bus.emit('mp:status', this.snapshot());
        break;
      case 'states': {
        const local = Date.now() + this.clockOffset;
        for (const s of m.list) {
          if (s.id === this.me?.id) continue;
          const r = this.remote.get(s.id) || { buf: [] };
          r.kind = s.kind; r.buf.push({ ...s, recv: local });
          if (r.buf.length > 12) r.buf.shift();
          this.remote.set(s.id, r);
        }
        break;
      }
      case 'auth': this.authority = m.s; this.authorityBehind = m.behind; break;
      case 'correction': this.bus.emit('mp:correction', m); break;
      case 'collision': this.bus.emit('mp:collision', m); break;
      case 'feed':
        this.feed.unshift({ text: m.text, at: m.at, from: m.from }); if (this.feed.length > 30) this.feed.pop();
        this.bus.emit('mp:feed', m);
        break;
      case 'error': this.bus.emit('mp:error', m); this.lastError = m.message; this.bus.emit('mp:status', this.snapshot()); break;
      default: break;
    }
  }

  // ---- sessions ----
  list() { this.send({ t: 'list' }); }
  create(name, isPublic = true, max = 8) { this.send({ t: 'create', name, public: isPublic, max }); }
  join(code) { if (!this.online) { this.pendingJoin = code; return; } this.send({ t: 'join', code }); }
  leave() { this.send({ t: 'leave' }); this.session = null; this.remote.clear(); }
  inviteLink() {
    if (!this.session) return '';
    const u = new URL(location.href); u.search = '';
    u.searchParams.set('server', this.server); u.searchParams.set('join', this.session.code);
    return u.toString();
  }

  // ---- driving ----
  startDriving(drive) { this.drive = drive; this.authority = null; if (this.inSession) this.send({ t: 'drive', drive }); }
  stopDriving() { this.drive = null; this.authority = null; if (this.inSession) this.send({ t: 'drive', drive: null }); }
  /** Throttled to 10 Hz. */
  sendState(s) { const t = performance.now(); if (!this.inSession || t - this.lastSent < 95) return; this.lastSent = t; this.send({ t: 'state', s }); }
  event(e) { if (this.inSession) this.send({ t: 'event', ...e }); }

  /** Other players with their interpolated state: [{ id, name, color, drive, state }]. */
  remotes(kind) {
    const now = Date.now() + this.clockOffset - INTERP_MS, out = [];
    for (const [id, r] of this.remote) {
      if (kind && r.kind !== kind) continue;
      const p = this.players.find((x) => x.id === id); if (!p?.drive || !p.online) continue;
      const b = r.buf; if (!b.length) continue;
      let st = b.at(-1);
      for (let i = b.length - 1; i > 0; i--) {
        if (b[i - 1].at <= now && b[i].at >= now) {
          const a = b[i - 1], c = b[i], k = (now - a.at) / Math.max(1, c.at - a.at);
          st = { ...c };
          for (const key of ['s', 'v', 'x', 'z']) if (typeof a[key] === 'number') st[key] = a[key] + (c[key] - a[key]) * k;
          for (const key of ['yaw', 'h', 'trailerYaw']) if (typeof a[key] === 'number') { let d = c[key] - a[key]; d = Math.atan2(Math.sin(d), Math.cos(d)); st[key] = a[key] + d * k; }
          break;
        }
      }
      if (now - st.at > 5000) continue; // stale
      out.push({ id, name: p.name, color: p.color, drive: p.drive, state: st });
    }
    return out;
  }
}
