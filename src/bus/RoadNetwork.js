// Road network for the bus simulator, built from a JSON network file: nodes (intersections,
// roundabouts, signals), two-way edges with lanes / bus lanes / speed limits, stops and crossings.
// Provides lane geometry, turning paths (incl. roundabouts), traffic-signal states, shortest paths
// and full lane-level route paths. Pure logic (no three.js) so it can be unit-tested.
export const LANE = 3.5;
export const WALK = 3.0; // sidewalk width

const ang = (dx, dz) => Math.atan2(-dz, dx);                 // 0 = east, π/2 = north (−z), CCW from above
const onRing = (c, R, a) => ({ x: c.x + R * Math.cos(a), z: c.z - R * Math.sin(a) });
const norm = (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; };

function bezier(p0, p1, p2, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z }); }
  return out;
}
function intersectLines(p, d, q, e) {
  const den = d.x * e.z - d.z * e.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}
/** Polyline with cumulative lengths. */
export function makePath(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  return { points, cum, length: cum.at(-1) };
}
/** Position + heading at distance s along a path. */
export function pathAt(path, s, out = {}) {
  const { points: P, cum } = path;
  s = Math.max(0, Math.min(path.length, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / seg;
  const a = P[lo], b = P[hi];
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x) / seg; out.dz = (b.z - a.z) / seg;
  return out;
}
/** Closest point on a path to (x, z), searching a window [s0, s1]. */
export function projectOnPath(path, x, z, s0 = 0, s1 = Infinity) {
  const { points: P, cum } = path;
  let best = { d: Infinity, s: 0, lat: 0 };
  for (let i = 1; i < P.length; i++) {
    if (cum[i] < s0 || cum[i - 1] > s1) continue;
    const a = P[i - 1], b = P[i], L = cum[i] - cum[i - 1];
    if (L < 1e-6) continue;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    let t = (x - a.x) * ux + (z - a.z) * uz; t = Math.max(0, Math.min(L, t));
    const px = a.x + ux * t, pz = a.z + uz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, s: cum[i - 1] + t, lat: (x - px) * -uz + (z - pz) * ux, ux, uz };
  }
  return best;
}

export class RoadNetwork {
  constructor(data) {
    this.data = data;
    this.nodes = new Map();
    for (const n of data.nodes) this.nodes.set(n.id, { ...n, edges: [], signal: !!n.signal, roundabout: n.roundabout || 0 });
    this.edges = data.edges.map((e, i) => {
      const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
      if (!a || !b) throw new Error(`Edge ${e.a}–${e.b}: unknown node`);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const lanes = e.lanes || 1;
      const edge = { i, id: `${e.a}>${e.b}`, a, b, len, lanes, busLane: !!e.busLane && lanes > 1, speed: e.speed || 50, name: e.name || '', oneway: !!e.oneway,
        dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, half: lanes * LANE };
      a.edges.push(edge); b.edges.push(edge);
      return edge;
    });
    for (const n of this.nodes.values()) {
      const widest = Math.max(0, ...n.edges.map((e) => e.half));
      n.trim = n.roundabout ? n.roundabout + 9 : n.edges.length >= 3 ? widest + WALK + 1.5 : n.edges.length === 2 ? widest + 1 : 2;
      n.crosswalk = n.signal;
      n.phaseOffset = (n.x * 0.37 + n.z * 0.11) % 46;
    }
    this.stops = [];
    for (const s of data.stops || []) {
      const e = this.findEdge(s.edge[0], s.edge[1]);
      if (!e) throw new Error(`Stop ${s.name}: no edge ${s.edge.join('–')}`);
      const along = s.edge[0] === e.a.id ? s.along : e.len - s.along;
      this.stops.push({ ...s, edge: e, along });
    }
    this.crossings = (data.crossings || []).map((c) => { const e = this.findEdge(c.edge[0], c.edge[1]); return { edge: e, along: c.edge[0] === e.a.id ? c.along : e.len - c.along }; });
    this.links = new Map(); // cache of lane / turn paths
  }

  findEdge(a, b) { return this.edges.find((e) => (e.a.id === a && e.b.id === b) || (e.a.id === b && e.b.id === a)); }
  stopByName(name) { return this.stops.find((s) => s.name === name || s.id === name); }

  /** Lateral offset (to the right of travel) of lane k (0 = outermost / kerb lane). */
  laneOffset(edge, k) { return edge.half - (k + 0.5) * LANE; }
  /** Usable lanes for general traffic (bus lane excluded). */
  carLanes(edge) { return edge.busLane ? [1] : edge.lanes > 1 ? [0, 1] : [0]; }

  /** Directed travel along an edge: fwd = a→b. */
  dir(edge, fwd) {
    const from = fwd ? edge.a : edge.b, to = fwd ? edge.b : edge.a;
    const dx = fwd ? edge.dx : -edge.dx, dz = fwd ? edge.dz : -edge.dz;
    return { edge, fwd, from, to, dx, dz, rx: -dz, rz: dx };
  }
  /** Point at distance `s` from the start of a directed edge, `off` metres to the right. */
  pointOn(d, s, off) { return { x: d.from.x + d.dx * s + d.rx * off, z: d.from.z + d.dz * s + d.rz * off }; }

  /** Straight lane path between the two intersection boxes. */
  lanePath(edge, fwd, k) {
    const key = `L${edge.i}${fwd ? 'f' : 'b'}${k}`;
    if (this.links.has(key)) return this.links.get(key);
    const d = this.dir(edge, fwd), off = this.laneOffset(edge, k);
    const s0 = d.from.trim, s1 = edge.len - d.to.trim;
    const path = makePath([this.pointOn(d, s0, off), this.pointOn(d, s1, off)]);
    const link = { key, kind: 'lane', edge, fwd, k, d, path, speed: edge.speed, s0,
      stopAt: path.length - (d.to.crosswalk ? 6.5 : 1.0), node: d.to, cars: new Set() };
    this.links.set(key, link);
    return link;
  }

  /** Turning path through a node from (inEdge, inFwd, inLane) to (outEdge, outFwd, outLane). */
  turnPath(node, a, b) {
    const key = `T${node.id}|${a.edge.i}${a.fwd ? 'f' : 'b'}${a.k}|${b.edge.i}${b.fwd ? 'f' : 'b'}${b.k}`;
    if (this.links.has(key)) return this.links.get(key);
    const pa = a.path.points.at(-1), pb = b.path.points[0];
    let pts;
    if (node.roundabout) {
      const R = node.roundabout + (a.k === 0 ? 0 : -3.5) + 1.75;
      const c = { x: node.x, z: node.z };
      const aIn = ang(-a.d.dx, -a.d.dz) - 0.42, aOut = ang(b.d.dx, b.d.dz) + 0.42;
      let a1 = norm(aIn), a2 = norm(aOut);
      if (a2 <= a1 + 0.2) a2 += Math.PI * 2;
      const e1 = onRing(c, R, a1), e2 = onRing(c, R, a2);
      pts = [...bezier(pa, { x: pa.x + a.d.dx * 4, z: pa.z + a.d.dz * 4 }, e1, 6)];
      const n = Math.ceil((a2 - a1) / 0.12);
      for (let i = 1; i < n; i++) pts.push(onRing(c, R, a1 + ((a2 - a1) * i) / n));
      pts.push(...bezier(e2, { x: pb.x - b.d.dx * 4, z: pb.z - b.d.dz * 4 }, pb, 6));
    } else {
      const ctrl = intersectLines(pa, { x: a.d.dx, z: a.d.dz }, pb, { x: b.d.dx, z: b.d.dz });
      pts = ctrl && Math.hypot(ctrl.x - pa.x, ctrl.z - pa.z) < 60 ? bezier(pa, ctrl, pb, 12) : [pa, pb];
    }
    const path = makePath(pts);
    const turn = Math.atan2(a.d.dx * b.d.dz - a.d.dz * b.d.dx, a.d.dx * b.d.dx + a.d.dz * b.d.dz); // + = right
    const link = { key, kind: 'turn', node, path, speed: node.roundabout ? 25 : Math.abs(turn) > 0.6 ? 20 : 50, from: a, to: b, turn, cars: new Set() };
    this.links.set(key, link);
    return link;
  }

  /** Outgoing directed edges from a node (excluding a U-turn back onto `exceptEdge`). */
  outgoing(node, exceptEdge) {
    const out = [];
    for (const e of node.edges) {
      if (e === exceptEdge && node.edges.length > 1) continue;
      const fwd = e.a === node;
      if (e.oneway && !fwd) continue;
      out.push({ edge: e, fwd });
    }
    return out;
  }

  // ---------------- signals ----------------
  /** 'green' | 'yellow' | 'red' for traffic arriving at `node` along directed edge d. */
  signalState(node, d, t) {
    if (!node.signal) return 'green';
    const axis = Math.abs(d.dx) > Math.abs(d.dz) ? 0 : 1;           // 0 = east-west, 1 = north-south
    const c = (t + node.phaseOffset) % 46;                             // 20 green, 3 yellow, 0 + 20 + 3 for the other axis
    const ph = c < 23 ? 0 : 1, local = c % 23;
    if (ph !== axis) return 'red';
    return local < 18 ? 'green' : local < 21 ? 'yellow' : 'red';
  }
  /** Pedestrians may cross the arm of `edge` at `node` when its traffic is red. */
  pedestrianGreen(node, edge, t) {
    const d = this.dir(edge, edge.b === node);
    return this.signalState(node, d, t) === 'red' && this.signalState(node, d, t + 2) === 'red';
  }

  // ---------------- routing ----------------
  /** Dijkstra over nodes; returns list of {edge, fwd} from node `from` to node `to`. */
  shortest(from, to, firstExcept = null) {
    const dist = new Map([[from.id, 0]]), prev = new Map(), done = new Set();
    const q = [[0, from]];
    while (q.length) {
      q.sort((x, y) => x[0] - y[0]);
      const [d0, n] = q.shift();
      if (done.has(n.id)) continue;
      done.add(n.id);
      if (n === to) break;
      for (const o of this.outgoing(n, n === from ? firstExcept : prev.get(n.id)?.edge)) {
        const m = o.fwd ? o.edge.b : o.edge.a;
        const nd = d0 + o.edge.len + (m.signal ? 25 : 0);
        if (nd < (dist.get(m.id) ?? Infinity)) { dist.set(m.id, nd); prev.set(m.id, o); q.push([nd, m]); }
      }
    }
    if (!prev.has(to.id) && from !== to) return null;
    const out = []; let n = to;
    while (n !== from) { const o = prev.get(n.id); out.unshift(o); n = o.fwd ? o.edge.a : o.edge.b; }
    return { steps: out, length: dist.get(to.id) ?? 0 };
  }

  /**
   * Lane-level route through a list of stops: chooses each stop's direction of travel to minimise
   * length, then concatenates lane and turn paths. Returns { path, links, stops:[{stop, s}] }.
   */
  buildRoute(stops, { startDir = null } = {}) {
    const opts = stops.map((s) => [true, false].map((fwd) => ({ stop: s, fwd })));
    // DP over stop directions.
    const cost = (x, y) => {
      if (x.stop.edge === y.stop.edge && x.fwd === y.fwd) {
        const ax = x.fwd ? x.stop.along : x.stop.edge.len - x.stop.along, ay = y.fwd ? y.stop.along : y.stop.edge.len - y.stop.along;
        if (ay > ax) return { len: ay - ax, steps: [] };
      }
      const exitNode = x.fwd ? x.stop.edge.b : x.stop.edge.a, entryNode = y.fwd ? y.stop.edge.a : y.stop.edge.b;
      const sp = this.shortest(exitNode, entryNode, x.stop.edge);
      if (!sp) return null;
      if (sp.steps[0]?.edge === x.stop.edge && exitNode.edges.length > 1) return null; // no U-turns except at turning circles
      if (sp.steps.length && sp.steps.at(-1).edge === y.stop.edge) return null;
      return { len: sp.length, steps: sp.steps };
    };
    let best = opts[0].filter((o) => startDir == null || o.fwd === startDir).map((o) => ({ total: 0, chain: [o], legs: [] }));
    for (let i = 1; i < opts.length; i++) {
      const next = [];
      for (const o of opts[i]) {
        let b = null;
        for (const c of best) { const leg = cost(c.chain.at(-1), o); if (!leg) continue; const tot = c.total + leg.len; if (!b || tot < b.total) b = { total: tot, chain: [...c.chain, o], legs: [...c.legs, leg] }; }
        if (b) next.push(b);
      }
      if (!next.length) throw new Error(`No road path to stop "${stops[i].name}"`);
      best = next;
    }
    const plan = best.sort((x, y) => x.total - y.total)[0];
    // Expand into a sequence of directed edges, then lane links with turns.
    const seq = [{ edge: plan.chain[0].stop.edge, fwd: plan.chain[0].fwd }];
    plan.legs.forEach((leg, i) => {
      for (const st of leg.steps) seq.push(st);
      const nx = plan.chain[i + 1];
      const last = seq.at(-1);
      if (!(last.edge === nx.stop.edge && last.fwd === nx.fwd)) seq.push({ edge: nx.stop.edge, fwd: nx.fwd });
    });
    return this.linksFor(seq, plan.chain);
  }

  /** Builds link list + concatenated path for a sequence of directed edges (bus uses the kerb lane). */
  linksFor(seq, stopChain = []) {
    const links = [];
    let prevLane = null;
    for (const st of seq) {
      const lane = this.lanePath(st.edge, st.fwd, 0);
      if (prevLane) links.push(this.turnPath(prevLane.d.to, prevLane, lane));
      links.push(lane);
      prevLane = lane;
    }
    const pts = [], offsets = [];
    let acc = 0;
    for (const l of links) {
      offsets.push(acc);
      const P = l.path.points;
      for (let i = pts.length && Math.hypot(P[0].x - pts.at(-1).x, P[0].z - pts.at(-1).z) < 0.05 ? 1 : 0; i < P.length; i++) pts.push(P[i]);
      acc += l.path.length;
    }
    const path = makePath(pts);
    // Stops: position along the route (bus front stops at the stop pole).
    const stopsOut = [];
    let li = 0;
    for (const c of stopChain) {
      for (; li < links.length; li++) {
        const l = links[li];
        if (l.kind === 'lane' && l.edge === c.stop.edge && l.fwd === c.fwd) {
          const alongDir = c.fwd ? c.stop.along : c.stop.edge.len - c.stop.along;
          stopsOut.push({ stop: c.stop, fwd: c.fwd, s: offsets[li] + Math.max(0, Math.min(l.path.length, alongDir - l.s0)), link: l });
          break;
        }
      }
    }
    return { path, links, offsets, stops: stopsOut, seq };
  }

  /** Speed limit (km/h) and the edge nearest to a point. */
  nearestEdge(x, z) {
    let best = null, bd = Infinity;
    for (const e of this.edges) {
      let t = (x - e.a.x) * e.dx + (z - e.a.z) * e.dz; t = Math.max(0, Math.min(e.len, t));
      const d = Math.hypot(x - (e.a.x + e.dx * t), z - (e.a.z + e.dz * t));
      if (d < bd) { bd = d; best = { edge: e, t, d }; }
    }
    for (const n of this.nodes.values()) if (n.roundabout) { const d = Math.abs(Math.hypot(x - n.x, z - n.z) - n.roundabout); if (d < bd && Math.hypot(x - n.x, z - n.z) < n.roundabout + 10) { bd = d; best = { node: n, d, speed: 30 }; } }
    return best;
  }
}
