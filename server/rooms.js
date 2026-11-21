// Authoritative multiplayer logic (no I/O, unit-tested): players, sessions with join codes, vehicle state
// validation (speed limits, no teleporting), movement authority between trains sharing a track (the server
// decides how far each train may go, so players cannot run into each other), bus overlap detection, service
// event feed, reconnection with a token. The transport (server.js) only moves JSON messages.
import crypto from 'node:crypto';

export const LIMITS = { MAX_SESSIONS: 200, MAX_PLAYERS: 12, RESUME_MS: 60000, IDLE_SESSION_MS: 10 * 60000, STATE_HZ_MAX: 30, SAFETY_GAP: 40 };
const COLORS = ['#1f78ff', '#e8590c', '#2fb344', '#d6336c', '#ae3ec9', '#0ca678', '#f59f00', '#1098ad', '#e03131', '#5c7cfa', '#74b816', '#f76707'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (s, n = 32) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);

export class Hub {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.players = new Map();   // id -> player
    this.sessions = new Map();  // code -> session
    this.out = [];              // queued messages: { to: id, msg }
  }
  send(id, msg) { this.out.push({ to: id, msg }); }
  broadcast(sess, msg, except = null) { for (const id of sess.members) if (id !== except) this.send(id, msg); }
  drain() { const o = this.out; this.out = []; return o; }

  // ---- connection ----
  hello(conn, { name, token }) {
    let p = token ? [...this.players.values()].find((x) => x.token === token) : null;
    if (p) { p.conn = conn; p.online = true; p.lastSeen = this.now(); p.name = clean(name) || p.name; }
    else {
      const id = crypto.randomBytes(6).toString('hex');
      p = { id, token: crypto.randomBytes(16).toString('hex'), name: clean(name) || `Driver ${this.players.size + 1}`, color: COLORS[this.players.size % COLORS.length], conn, online: true, session: null, drive: null, state: null, lastSeen: this.now(), stats: { stops: 0, passengers: 0, km: 0 }, ratelimit: { t: 0, n: 0 } };
      this.players.set(id, p);
    }
    this.send(p.id, { t: 'welcome', id: p.id, token: p.token, name: p.name, color: p.color, serverTime: this.now(), resumed: !!token && !!p.session, session: p.session ? this.sessionInfo(this.sessions.get(p.session)) : null });
    if (p.session) { const s = this.sessions.get(p.session); if (s) { this.sendPlayers(s); this.feed(s, `${p.name} reconnected`); } }
    return p;
  }
  disconnect(p) {
    if (!p) return;
    p.online = false; p.conn = null; p.lastSeen = this.now();
    const s = p.session && this.sessions.get(p.session);
    if (s) { this.sendPlayers(s); this.feed(s, `${p.name} lost connection`); }
  }
  /** Periodic housekeeping: drop players gone for good, close idle sessions. */
  sweep() {
    const t = this.now();
    for (const p of [...this.players.values()]) if (!p.online && t - p.lastSeen > LIMITS.RESUME_MS) this.leave(p, true);
    for (const s of [...this.sessions.values()]) if (!s.members.size && t - s.lastActive > LIMITS.IDLE_SESSION_MS) this.sessions.delete(s.code);
  }

  // ---- sessions ----
  code() { let c; do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (this.sessions.has(c)); return c; }
  sessionInfo(s) { return s && { code: s.code, name: s.name, public: s.public, max: s.max, players: [...s.members].filter((id) => this.players.get(id)?.online).length, host: this.players.get(s.host)?.name, created: s.created }; }
  list() { return [...this.sessions.values()].filter((s) => s.public).map((s) => this.sessionInfo(s)).sort((a, b) => b.players - a.players); }
  create(p, { name, public: pub = true, max = 8 }) {
    if (this.sessions.size >= LIMITS.MAX_SESSIONS) return this.error(p, 'full', 'Too many sessions on this server.');
    const s = { code: this.code(), name: clean(name, 40) || `${p.name}'s Grandville`, public: !!pub, max: num(max, 2, LIMITS.MAX_PLAYERS, 8), host: p.id, members: new Set(), created: this.now(), lastActive: this.now() };
    this.sessions.set(s.code, s);
    return this.join(p, { code: s.code });
  }
  join(p, { code }) {
    const s = this.sessions.get(clean(code, 8).toUpperCase());
    if (!s) return this.error(p, 'no-session', `No session with code ${clean(code, 8).toUpperCase()}.`);
    if (!s.members.has(p.id) && s.members.size >= s.max) return this.error(p, 'session-full', 'This session is full.');
    if (p.session && p.session !== s.code) this.leave(p);
    s.members.add(p.id); p.session = s.code; s.lastActive = this.now();
    this.send(p.id, { t: 'joined', session: this.sessionInfo(s) });
    this.sendPlayers(s); this.feed(s, `${p.name} joined`);
    return s;
  }
  leave(p, remove = false) {
    const s = p.session && this.sessions.get(p.session);
    if (s) { s.members.delete(p.id); s.lastActive = this.now(); if (s.host === p.id) s.host = [...s.members][0] || null; this.sendPlayers(s); this.feed(s, `${p.name} left`); }
    p.session = null; p.drive = null; p.state = null;
    if (remove) this.players.delete(p.id);
  }
  publicPlayer(p) { return { id: p.id, name: p.name, color: p.color, online: p.online, drive: p.drive, stats: p.stats }; }
  sendPlayers(s) { this.broadcast(s, { t: 'players', list: [...s.members].map((id) => this.players.get(id)).filter(Boolean).map((p) => this.publicPlayer(p)) }); }
  feed(s, text, from = null) { this.broadcast(s, { t: 'feed', text, from, at: this.now() }); }
  error(p, code, message) { this.send(p.id, { t: 'error', code, message }); return null; }

  // ---- driving ----
  drive(p, d) {
    if (!p.session) return this.error(p, 'no-session', 'Join a session first.');
    if (!d) { p.drive = null; p.state = null; this.sendPlayers(this.sessions.get(p.session)); return; }
    const kind = d.kind === 'bus' ? 'bus' : 'train';
    p.drive = kind === 'train'
      ? { kind, lineId: clean(d.lineId, 64), sourceId: clean(d.sourceId, 64), number: clean(d.number, 4), color: clean(d.color, 12), dir: d.dir === 'B' ? 'B' : 'A', branch: clean(d.branch, 64), trunkEnd: num(d.trunkEnd, 0, 1e6, 1e6), length: num(d.length, 10, 400, 80), maxSpeed: num(d.maxSpeed, 10, 360, 80), model: clean(d.model, 32), uid: clean(d.uid, 32), cars: num(d.cars, 1, 20, 5) }
      : { kind, model: clean(d.model, 32), uid: clean(d.uid, 32), route: clean(d.route, 16), length: num(d.length, 5, 30, 12), width: num(d.width, 2, 3, 2.55), maxSpeed: num(d.maxSpeed, 20, 120, 90) };
    p.state = null;
    this.sendPlayers(this.sessions.get(p.session));
    this.feed(this.sessions.get(p.session), kind === 'train' ? `${p.name} is driving Line ${p.drive.number} (${p.drive.uid || p.drive.model})` : `${p.name} took bus ${p.drive.uid || p.drive.model}${p.drive.route ? ` on route ${p.drive.route}` : ''}`);
  }

  /** Validates and stores a state update; returns the accepted state or null. */
  state(p, st) {
    if (!p.session || !p.drive) return null;
    const t = this.now(), rl = p.ratelimit;
    if (t - rl.t > 1000) { rl.t = t; rl.n = 0; }
    if (++rl.n > LIMITS.STATE_HZ_MAX) return null;
    const prev = p.state, dt = prev ? Math.max(0.02, (t - prev.at) / 1000) : null, vmax = p.drive.maxSpeed / 3.6;
    let s;
    if (p.drive.kind === 'train') {
      s = { s: num(st.s, -50, 1e6), v: num(st.v, -vmax * 1.1, vmax * 1.1 + 1), doors: clean(st.doors, 12), atStop: st.atStop == null ? null : num(st.atStop, 0, 999), next: clean(st.next, 64), load: num(st.load, 0, 300), x: num(st.x, -1e6, 1e6), z: num(st.z, -1e6, 1e6), h: num(st.h, -100, 100), at: t };
      if (prev && Math.abs(s.s - prev.s) > vmax * 1.2 * dt + 8) { this.send(p.id, { t: 'correction', s: prev.s, reason: 'Position rejected (moved faster than the train can)' }); return null; }
    } else {
      s = { x: num(st.x, -1e6, 1e6), z: num(st.z, -1e6, 1e6), yaw: num(st.yaw, -1e3, 1e3), v: num(st.v, -vmax, vmax * 1.15 + 1), doors: Array.isArray(st.doors) ? st.doors.slice(0, 4).map((x) => num(x, 0, 1)) : [], trailerYaw: num(st.trailerYaw, -1e3, 1e3), lights: !!st.lights, brake: !!st.brake, ind: clean(st.ind, 8), at: t };
      if (prev && Math.hypot(s.x - prev.x, s.z - prev.z) > vmax * 1.25 * dt + 6) { this.send(p.id, { t: 'correction', x: prev.x, z: prev.z, yaw: prev.yaw, reason: 'Position rejected (moved faster than the bus can)' }); return null; }
    }
    p.state = s; p.lastSeen = t;
    this.sessions.get(p.session).lastActive = t;
    return s;
  }

  /** Service event (arrival, departure, boarding…): updates stats and goes to the session feed. */
  event(p, e) {
    const s = p.session && this.sessions.get(p.session); if (!s) return;
    const kind = clean(e.e, 16), where = clean(e.where, 64);
    if (kind === 'arrived') { p.stats.stops++; this.feed(s, `${p.name} arrived at ${where}${e.delay != null ? ` (${e.delay >= 0 ? '+' : ''}${Math.round(num(e.delay, -3600, 3600))} s)` : ''}`, p.id); }
    else if (kind === 'departed') this.feed(s, `${p.name} departed ${where}`, p.id);
    else if (kind === 'passengers') { p.stats.passengers += num(e.n, 0, 2000); }
    else if (kind === 'terminus') this.feed(s, `${p.name} reached the terminus ${where}`, p.id);
    else if (kind === 'collision') this.feed(s, `${p.name}: collision (${clean(e.what, 40)})`, p.id);
    else if (kind === 'finished') { p.stats.km += num(e.km, 0, 1000); this.feed(s, `${p.name} finished the service${e.grade ? ` — grade ${clean(e.grade, 2)}` : ''}`, p.id); }
  }

  /**
   * One server tick: broadcasts states, computes movement authorities between trains on the same track and
   * direction (branch-aware), detects bus-bus overlaps.
   */
  tick() {
    for (const s of this.sessions.values()) {
      const members = [...s.members].map((id) => this.players.get(id)).filter((p) => p?.online && p.state && p.drive);
      if (!members.length) continue;
      this.broadcast(s, { t: 'states', at: this.now(), list: members.map((p) => ({ id: p.id, kind: p.drive.kind, ...p.state })) });
      // Trains: order per (line, direction); each gets the rear of the train ahead minus a safety gap as its limit.
      const tracks = new Map();
      for (const p of members) if (p.drive.kind === 'train') { const k = `${p.drive.sourceId}|${p.drive.dir}`; if (!tracks.has(k)) tracks.set(k, []); tracks.get(k).push(p); }
      for (const list of tracks.values()) {
        for (const p of list) {
          let lim = null, aheadP = null;
          for (const q of list) {
            if (q === p || q.state.s <= p.state.s) continue;
            const shared = p.drive.branch === q.drive.branch || p.state.s < p.drive.trunkEnd || q.state.s - q.drive.length < q.drive.trunkEnd;
            if (!shared) continue;
            const rear = q.state.s - q.drive.length;
            if (lim == null || rear < lim) { lim = rear; aheadP = q; }
          }
          const auth = lim == null ? null : lim - LIMITS.SAFETY_GAP;
          if (auth !== p.lastAuth && (auth == null || p.lastAuth == null || Math.abs(auth - p.lastAuth) > 1)) { p.lastAuth = auth; this.send(p.id, { t: 'auth', s: auth, behind: aheadP?.name || null }); }
          if (aheadP && p.state.s > lim + 0.5 && !p.collided) { p.collided = true; this.send(p.id, { t: 'collision', with: aheadP.name, kind: 'train' }); this.send(aheadP.id, { t: 'collision', with: p.name, kind: 'train' }); this.feed(s, `Collision between ${p.name} and ${aheadP.name}`); }
          if (!aheadP || p.state.s < lim - 5) p.collided = false;
        }
      }
      // Buses: footprint overlap (oriented boxes) → both are told; each client resolves the impact physically.
      const buses = members.filter((p) => p.drive.kind === 'bus');
      for (let i = 0; i < buses.length; i++) for (let j = i + 1; j < buses.length; j++) {
        const a = buses[i], b = buses[j], key = [a.id, b.id].sort().join('|');
        const hit = obbOverlap(a, b);
        s.hits ||= new Map();
        if (hit && !s.hits.has(key)) { s.hits.set(key, this.now()); this.feed(s, `Collision between ${a.name}'s and ${b.name}'s buses`); }
        if (!hit && s.hits.has(key) && this.now() - s.hits.get(key) > 2000) s.hits.delete(key);
      }
    }
  }
}

function corners(p) {
  const { x, z, yaw } = p.state, L = p.drive.length / 2, W = p.drive.width / 2;
  const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
  return [[L, -W], [L, W], [-L, W], [-L, -W]].map(([f, l]) => ({ x: x + fx * f + rx * l, z: z + fz * f + rz * l }));
}
export function obbOverlap(a, b) {
  const A = corners(a), B = corners(b);
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const p = P[i], q = P[(i + 1) % 4], nx = -(q.z - p.z), nz = q.x - p.x;
    const pr = (Q) => Q.map((c) => c.x * nx + c.z * nz);
    const a1 = pr(A), b1 = pr(B);
    if (Math.max(...a1) < Math.min(...b1) || Math.max(...b1) < Math.min(...a1)) return false;
  }
  return true;
}
