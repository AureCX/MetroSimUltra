// Runs a bus service: deadhead from the depot to the first stop, each leg between stops,
// return to the depot. Tracks progress along the lane-level path, detects stopping at stops
// (front door at the pole), departures, missed / skipped stops, schedules, rerouting when the
// driver leaves the route, and produces turn-by-turn GPS instructions.
import { makePath, projectOnPath, pathAt } from './RoadNetwork.js';
import { parseClock } from '../core/util.js';

export class RouteRunner {
  constructor({ net, world, route, dir, mode, startClock, bus }) {
    this.net = net; this.world = world; this.route = route; this.dir = dir; this.mode = mode; this.bus = bus;
    this.phase = 'free';
    this.stops = [];
    this.nextIdx = 0; this.atStopIdx = null; this.sinceDeparture = 99;
    this.leg = null; this.progress = 0; this.offT = 0;
    this.log = [];
    if (route) {
      const list = route.stops.map((s) => { const st = net.stopByName(s.name); if (!st) throw new Error(`Route ${route.route}: stop "${s.name}" is not in the network`); return { st, dwell: s.dwellTime ?? 20 }; });
      const ordered = dir === 'B' ? [...list].reverse() : list;
      this.service = net.buildRoute(ordered.map((o) => o.st));
      this.stops = this.service.stops.map((x, i) => ({ ...x, key: `${x.stop.id}|${x.fwd}`, dwell: ordered[i].dwell, served: false, missed: false }));
      this.destination = this.stops.at(-1).stop.name;
      // Timetable: deadhead allowance, then distance at a scheduled average speed plus dwell.
      const vAvg = (route.type === 'airport' ? 24 : 21) / 3.6;
      this.startClock = startClock;
      let t = startClock + 6 * 60;
      this.stops.forEach((s, i) => {
        if (i > 0) t += (s.s - this.stops[i - 1].s) / vAvg;
        s.arr = Math.round(t / 30) * 30; s.dep = i < this.stops.length - 1 ? s.arr + Math.max(10, s.dwell) : null;
        t = s.dep ?? t;
      });
    }
  }

  get depot() { return this.net.data.depot; }

  start(pos) {
    if (!this.route) { this.phase = 'free'; return; }
    this.phase = 'deadhead';
    this.legTo(0, pos);
  }

  /** Build the navigation leg towards stop k (or the depot when k === 'depot'). */
  legTo(k, pos, forceShortest = false) {
    const net = this.net;
    if (k !== 'depot' && !forceShortest && k > 0 && this.phase === 'service') {
      const a = this.stops[k - 1], b = this.stops[k];
      const pts = [];
      const P = this.service.path;
      for (let s = a.s; s < b.s; s += 3) pts.push(pathAt(P, s, {}));
      pts.push(pathAt(P, b.s, {}));
      const path = makePath(pts.map((p) => ({ x: p.x, z: p.z })));
      const man = [];
      this.service.links.forEach((l, i) => { const s0 = this.service.offsets[i]; if (l.kind === 'turn' && s0 >= a.s && s0 < b.s) man.push(this.maneuver(l, s0 - a.s)); });
      this.leg = { path, target: path.length, k, man };
    } else {
      // Shortest path starting on the lane the bus is driving along (or from the node ahead).
      const cur = this.currentEdge(pos);
      const from = cur ? (cur.fwd ? cur.edge.b : cur.edge.a) : this.nodeAhead(pos);
      let seq, targetEdgeDir;
      if (k === 'depot') {
        const dn = net.nodes.get(this.depot.exitNode);
        const sp = from === dn ? { steps: [] } : net.shortest(from, dn, cur?.edge);
        seq = sp ? sp.steps : [];
      } else {
        const st = this.stops[k];
        const entry = st.fwd ? st.stop.edge.a : st.stop.edge.b;
        if (cur && cur.edge === st.stop.edge && cur.fwd === st.fwd) seq = [];
        else { const sp = net.shortest(from, entry, cur?.edge); seq = [...(sp ? sp.steps : []), { edge: st.stop.edge, fwd: st.fwd }]; }
        targetEdgeDir = st;
      }
      if (cur && !(seq[0] && seq[0].edge === cur.edge)) seq.unshift(cur);
      if (!seq.length) { this.leg = { path: makePath([{ x: pos.x, z: pos.z }, { x: pos.x + 1, z: pos.z }]), target: 1, k, man: [] }; return; }
      const r = net.linksFor(seq, targetEdgeDir ? [{ stop: targetEdgeDir.stop, fwd: targetEdgeDir.fwd }] : []);
      const target = targetEdgeDir ? r.stops[0]?.s ?? r.path.length : r.path.length;
      const man = [];
      r.links.forEach((l, i) => { if (l.kind === 'turn') man.push(this.maneuver(l, r.offsets[i])); });
      this.leg = { path: r.path, target, k, man };
    }
    this.progress = Math.max(0, projectOnPath(this.leg.path, pos.x, pos.z).s - 5);
    this.offT = 0;
  }

  maneuver(l, s) {
    const out = l.to.edge;
    const kind = l.node.roundabout ? 'roundabout' : Math.abs(l.turn) < 0.45 ? 'straight' : l.turn > 0 ? 'right' : 'left';
    let exit = 0;
    if (kind === 'roundabout') {
      // Count arms passed (anticlockwise) to give an exit number.
      const ang = (dx, dz) => Math.atan2(-dz, dx);
      const aIn = ang(-l.from.d.dx, -l.from.d.dz), aOut = ang(out === l.from.edge ? -l.from.d.dx : l.to.d.dx, out === l.from.edge ? -l.from.d.dz : l.to.d.dz);
      const arms = l.node.edges.map((e) => { const d = this.net.dir(e, e.a === l.node); return ang(d.dx, d.dz); });
      const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const span = norm(aOut - aIn) || 2 * Math.PI;
      exit = arms.filter((a) => { const x = norm(a - aIn); return x > 0.1 && x <= span + 0.05; }).length;
    }
    return { s, kind, exit, name: out.name, turn: l.turn };
  }

  /** Directed edge the bus is driving along (aligned with its heading), if any. */
  currentEdge(pos) {
    let best = null, bd = 9;
    for (const e of this.net.edges) {
      let t = (pos.x - e.a.x) * e.dx + (pos.z - e.a.z) * e.dz;
      if (t < 0 || t > e.len) continue;
      const lat = (pos.x - e.a.x) * -e.dz + (pos.z - e.a.z) * e.dx, d = Math.abs(lat);
      const align = pos.fx * e.dx + pos.fz * e.dz;
      if (d < bd && Math.abs(align) > 0.7) { bd = d; best = { edge: e, fwd: align > 0 }; }
    }
    return best;
  }

  nodeAhead(pos) {
    let best = null, bd = Infinity;
    for (const n of this.net.nodes.values()) {
      const dx = n.x - pos.x, dz = n.z - pos.z, d = Math.hypot(dx, dz);
      const ahead = (dx * pos.fx + dz * pos.fz) / (d || 1);
      const score = d * (ahead > 0.2 ? 1 : 3);
      if (score < bd) { bd = score; best = n; }
    }
    return best;
  }

  viewFor(k) { const s = this.stops[k]; return this.world.stopViews.find((v) => v.stop === s.stop && v.fwd === s.fwd); }
  isServiceStop(k) { return this.phase === 'service' || (this.phase === 'deadhead' && k === 0); }

  /** Signed distance (m) from the front door to stop k's pole, along the stop's lane direction. */
  doorError(k, door) {
    const sv = this.viewFor(k);
    return { along: (door.x - sv.polePoint.x) * sv.d.dx + (door.z - sv.polePoint.z) * sv.d.dz, lat: Math.abs((door.x - sv.polePoint.x) * sv.d.rx + (door.z - sv.polePoint.z) * sv.d.rz), sv };
  }
  distanceToStop(k) {
    if (k == null || !this.stops[k]) return Infinity;
    if (this.leg && this.leg.k === k) return Math.max(0, this.leg.target - this.progress);
    if (this.leg && typeof this.leg.k === 'number' && k > this.leg.k) return Math.max(0, this.leg.target - this.progress) + (this.stops[k].s - this.stops[this.leg.k].s);
    return Infinity;
  }
  nextManeuver() {
    if (!this.leg) return null;
    const m = this.leg.man.find((x) => x.s > this.progress - 5 && x.kind !== 'straight');
    return m ? { ...m, dist: Math.max(0, m.s - this.progress) } : null;
  }

  /** ctx: { pos {x,z,fx,fz}, v, door (world), doorsOpened (bool), doorsClosed, clock, parking, inDepot, waiting(k), stopRequest } */
  update(dt, ctx) {
    this.sinceDeparture += dt;
    if (this.phase === 'free' || this.phase === 'done') return;
    // Progress along the navigation leg.
    if (this.leg) {
      const pr = projectOnPath(this.leg.path, ctx.pos.x, ctx.pos.z, this.progress - 40, this.progress + 120);
      if (pr.d < 12) { this.progress = Math.max(this.progress, pr.s); this.offT = 0; }
      else if (!ctx.inDepot) { this.offT += dt; if (this.offT > 4) { this.bus.emit('bus:reroute'); this.legTo(this.phase === 'return' ? 'depot' : this.nextIdx, ctx.pos, true); } }
    }
    if (this.phase === 'return') {
      if (ctx.inDepot && Math.abs(ctx.v) < 0.1 && ctx.parking) { this.phase = 'done'; this.bus.emit('bus:shiftComplete'); }
      return;
    }
    const k = this.atStopIdx ?? this.nextIdx;
    const st = this.stops[k];
    if (!st) return;
    const e = this.doorError(k, ctx.door);
    if (this.atStopIdx == null) {
      if (Math.abs(ctx.v) < 0.3 && Math.abs(e.along) < 7 && e.lat < 3.6 && this.leg?.k === k) {
        this.atStopIdx = k; this.served = false; this.doorsWereOpen = false; this.arrivedAt = ctx.clock; this.arrivalError = e.along;
        this.bus.emit('bus:arrived', { k, stop: st, error: e.along, delay: ctx.clock - st.arr });
        if (this.phase === 'deadhead' && k === 0) { this.phase = 'service'; }
      } else if (e.along > 10 && this.leg?.k === k && this.progress > this.leg.target - 2) {
        const demand = (k > 0 && (ctx.waiting(k) > 0 || ctx.stopRequest)) || k === 0 || k === this.stops.length - 1;
        st[demand ? 'missed' : 'skipped'] = true;
        this.bus.emit(demand ? 'bus:missedStop' : 'bus:skippedStop', { k, stop: st });
        if (this.phase === 'deadhead' && k === 0) this.phase = 'service';
        this.advance(ctx);
      }
    } else {
      if (ctx.doorsOpened) this.doorsWereOpen = true;
      const moved = Math.abs(e.along - this.arrivalError) > 3 || Math.abs(ctx.v) > 1.5;
      if (moved) {
        st.served = this.doorsWereOpen;
        const early = st.dep != null && this.mode === 'timetable' && ctx.clock < st.dep - 30;
        this.bus.emit('bus:departed', { k, stop: st, early, served: this.doorsWereOpen, delay: st.dep != null ? ctx.clock - st.dep : 0 });
        this.atStopIdx = null; this.sinceDeparture = 0;
        this.advance(ctx);
      }
    }
  }

  advance(ctx) {
    this.nextIdx++;
    if (this.nextIdx >= this.stops.length) {
      this.bus.emit('bus:routeComplete');
      if (this.mode === 'career' || this.mode === 'timetable') { this.phase = 'return'; this.legTo('depot', ctx.pos); }
      else { this.phase = 'done'; this.bus.emit('bus:shiftComplete'); }
      return;
    }
    this.legTo(this.nextIdx, ctx.pos);
  }

  schedule(k) { return this.stops[k] ? { arr: this.stops[k].arr, dep: this.stops[k].dep } : null; }
  delay(clock) {
    const k = this.atStopIdx ?? this.nextIdx, s = this.stops[k];
    if (!s) return 0;
    if (this.atStopIdx != null) return s.dep != null ? Math.max(clock - s.dep, this.arrivedAt - s.arr) : clock - s.arr;
    return Math.max(clock - s.arr, (this.lastDelay ?? 0));
  }
}
export { parseClock };
