// Airports of the network. Each one is laid out in its runway frame (u along runway 1, w to its right) and placed in
// the world. Functional layout first: runways (both ends, ILS, touchdown points), parallel taxiways with entries,
// rapid exits and holding points, apron taxilanes and stands, all joined in a taxi graph (shortest paths for AI and
// the player: aircraft never jump from the gate to the runway). Then the scenery: markings, runway edge / threshold
// / end / centreline lights, approach lighting, PAPI, taxiway lights, terminal (size by class), jet bridges, tower,
// hangars, fuel farm, fire station, ground vehicles, windsock, ILS / VOR antennas, holding-point signs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hdgVec, runwayEnds } from './AirData.js';

const tex = (w, h, draw, rep = [1, 1]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 8; return t; };
let T = null;
function textures() {
  if (T) return T;
  const noise = (g, w, h, base, n) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < w * h * 0.02; i++) { g.fillStyle = `rgba(${n},${n},${n},${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
  T = {
    asphalt: tex(256, 256, (g, w, h) => noise(g, w, h, '#3b3d40', 200)),
    concrete: tex(256, 256, (g, w, h) => { noise(g, w, h, '#a9a9a3', 60); g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 2; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } }),
    grass: tex(256, 256, (g, w, h) => { noise(g, w, h, '#5f7d3b', 30); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40},${80 + Math.random() * 50},${30},0.3)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 3); } }),
  };
  return T;
}
function runwayTexture(len, width, n1, n2) {
  // Drawn along v (canvas height = runway length, 1 px ≈ len/2048 m), width across.
  const H = 4096, W = 256, mpp = len / H;
  return tex(W, H, (g) => {
    g.fillStyle = '#34363a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 3); }
    const m = (meters) => meters / mpp;
    g.fillStyle = '#e8e8e2';
    // edge stripes, centreline dashes (30 m / 20 m gaps)
    g.fillRect(4, 0, 4, H); g.fillRect(W - 8, 0, 4, H);
    for (let y = m(180); y < H - m(180); y += m(50)) g.fillRect(W / 2 - 2, y, 4, m(30));
    for (const [end, name] of [[0, n1], [1, n2]]) {
      g.save(); if (end) { g.translate(W, H); g.rotate(Math.PI); }
      // threshold "piano keys", designator, aiming point, touchdown zone
      for (let k = 0; k < 12; k++) { const x = 14 + k * ((W - 28) / 12); g.fillRect(x, m(6), (W - 28) / 12 - 6, m(30)); }
      g.save(); g.translate(W / 2, m(70)); g.font = `bold ${Math.round(m(18))}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.scale(1, 1); g.fillText(name, 0, 0); g.restore();
      for (const sd of [-1, 1]) { g.fillRect(W / 2 + sd * 55 - 16, m(300), 32, m(45)); for (const z of [150, 450, 600, 750]) for (let b = 0; b < (z < 500 ? 3 : 2); b++) g.fillRect(W / 2 + sd * (40 + b * 22) - 8, m(z), 14, m(22)); }
      g.restore();
    }
  });
}
function signTex(text, bg = '#ffd000', fg = '#111') { return tex(256, 64, (g) => { g.fillStyle = bg; g.fillRect(0, 0, 256, 64); g.fillStyle = fg; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34); }); }

/** Taxi graph with Dijkstra. */
class TaxiGraph {
  constructor() { this.nodes = []; this.adj = []; }
  node(x, z, info = {}) { this.nodes.push({ x, z, i: this.nodes.length, ...info }); this.adj.push([]); return this.nodes.length - 1; }
  link(a, b, info = {}) { const d = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z); this.adj[a].push({ to: b, d, ...info }); this.adj[b].push({ to: a, d, ...info }); }
  nearest(x, z, filter = () => true) { let best = -1, bd = Infinity; for (const n of this.nodes) { if (!filter(n)) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = n.i; } } return best; }
  path(from, to, avoidRunway = true) {
    const N = this.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    dist[from] = 0;
    for (;;) {
      let u = -1, bd = Infinity; for (let i = 0; i < N; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0 || u === to) break; done[u] = 1;
      for (const e of this.adj[u]) { const pen = avoidRunway && e.runway && u !== from && e.to !== to ? 5000 : 0; const nd = dist[u] + e.d + pen; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; } }
    }
    if (!isFinite(dist[to])) return null;
    const out = []; for (let v = to; v >= 0; v = prev[v]) out.push(this.nodes[v]); return out.reverse();
  }
}

export function buildAirport(parent, ap, elev, { headless = false } = {}) {
  // headless: layout only (taxi graph, runways, stands) for the simulation and the tests, no scenery.
  const HL = headless;
  const grp = new THREE.Group(); grp.name = `airport-${ap.id}`; if (parent) parent.add(grp);
  const T0 = HL ? { grass: null, asphalt: null, concrete: null } : textures();
  const rw0 = ap.runways[0], d = hdgVec(rw0.hdg), n = { x: -d.z, z: d.x };
  const W2 = (u, w) => ({ x: ap.x + d.x * u + n.x * w, z: ap.z + d.z * u + n.z * w });
  const yaw = Math.atan2(d.x, d.z);   // local +Z (three) → runway direction
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const M = {
    grass: lam({ map: T0.grass }), asphalt: lam({ map: T0.asphalt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    concrete: lam({ map: T0.concrete, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    yellow: new THREE.MeshBasicMaterial({ color: 0xe8c21a, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    white: lam({ color: 0xe9ecef }), glass: new THREE.MeshStandardMaterial({ color: 0x5d7f95, metalness: 0.7, roughness: 0.15 }), grey: lam({ color: 0x8d949b }), dark: lam({ color: 0x2a2e33 }),
    red: lam({ color: 0xc8352a }), roof: new THREE.MeshStandardMaterial({ color: 0xb8bec5, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }),
    vehicle: lam({ color: 0xf2c200 }), fire: lam({ color: 0xd02020 }), tank: lam({ color: 0xf0f0ea }),
  };
  const parts = new Map(); const put = (m, g) => { if (HL) return; if (!parts.has(m)) parts.set(m, []); parts.get(m).push(g.index ? g.toNonIndexed() : g); };
  // Flat strips in the runway frame (centre u, w, length along u, width along w).
  const strip = (mat, u, w, len, wid, y = 0.02, uvRep = null) => {
    if (HL) return;
    const g = new THREE.PlaneGeometry(wid, len); g.rotateX(-Math.PI / 2);
    if (uvRep) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvRep[0], uv.getY(i) * uvRep[1]); }
    g.rotateY(yaw); const p = W2(u, w); g.translate(p.x - ap.x, elev + y, p.z - ap.z); put(mat, g);
  };
  const box = (mat, u, w, len, wid, h, y = 0, rot = 0) => { if (HL) return; const g = new THREE.BoxGeometry(wid, h, len); g.rotateY(yaw + rot); const p = W2(u, w); g.translate(p.x - ap.x, elev + y + h / 2, p.z - ap.z); put(mat, g); };
  grp.position.set(ap.x, 0, ap.z);

  // ---- layout ----
  const rws = ap.runways.map((rw) => ({ rw, w: rw.offset || 0, ends: runwayEnds(ap, rw), shift: rw.shift || 0 }));
  const two = rws.length > 1, termW = two ? 0 : 430, side = two ? 0 : 1;
  const L = Math.max(...rws.map((r) => r.rw.length));
  // Grass field.
  strip(M.grass, 0, termW / 2, L + 1600, (two ? 1600 : 1300) + 400, 0.0, [(L + 1600) / 40, 40]);
  const graph = new TaxiGraph(), lights = { edge: [], thr: [], end: [], twy: [], twyC: [], app: [] };
  const holdPoints = [];
  const runways = [];
  for (const R of rws) {
    const { rw, w } = R, len = rw.length, u0 = R.shift - len / 2, u1 = R.shift + len / 2;
    const [n1, n2] = rw.id.split('/');
    // Runway surface with markings (+ blast pads / shoulders).
    if (!HL) { const g = new THREE.PlaneGeometry(rw.width, len); g.rotateX(-Math.PI / 2); g.rotateY(yaw); const p = W2(R.shift, w); g.translate(p.x - ap.x, elev + 0.04, p.z - ap.z); const m = new THREE.Mesh(g, lam({ map: runwayTexture(len, rw.width, n1, n2), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); grp.add(m); }
    strip(M.asphalt, R.shift, w, len + 120, rw.width + 16, 0.03, [3, len / 20]);
    // Taxiway parallel to the runway, on the terminal side.
    const tw = two ? w + (w < 0 ? 200 : -200) : w + 190 * (side || 1);
    strip(M.asphalt, R.shift, tw, len, 23, 0.03, [1, len / 20]);
    strip(M.yellow, R.shift, tw, len, 0.3, 0.05);
    const nodesT = [], step = len / 6;
    for (let k = 0; k <= 6; k++) nodesT.push(graph.node(W2(u0 + k * step, tw).x, W2(u0 + k * step, tw).z, { kind: 'twy', u: u0 + k * step, w: tw }));
    for (let k = 0; k < 6; k++) graph.link(nodesT[k], nodesT[k + 1], { name: `T${runways.length + 1}` });
    // Entries at both ends and rapid exits (connectors), with holding points 80 m from the centreline.
    const conns = [];
    const connector = (u, kind) => {
      const pR = W2(u, w), pH = W2(u, w + Math.sign(tw - w) * 85), pT = W2(u, tw);
      const r = graph.node(pR.x, pR.z, { kind: 'rwy', runway: rw.id, u }), h = graph.node(pH.x, pH.z, { kind: 'hold', runway: rw.id, u }), t = graph.nearest(pT.x, pT.z, (nn) => nn.kind === 'twy' && nn.w === tw);
      graph.link(r, h, { runway: true }); graph.link(h, t);
      strip(M.asphalt, u, (w + tw) / 2, 23, Math.abs(tw - w), 0.03);
      strip(M.yellow, u, (w + tw) / 2, 0.3, Math.abs(tw - w), 0.05);
      // holding-point markings and sign
      strip(M.yellow, u, w + Math.sign(tw - w) * 85, 0.6, 22, 0.06);
      if (!HL) { const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: signTex(`${n1}-${n2}`, '#c81010', '#ffffff'), side: THREE.DoubleSide })); const p = W2(u + 18, w + Math.sign(tw - w) * 85); s.position.set(p.x - ap.x, elev + 1.2, p.z - ap.z); s.rotation.y = yaw; grp.add(s); }
      holdPoints.push({ node: h, runway: rw.id, u });
      conns.push({ r, h, u, kind });
      return { r, h };
    };
    connector(u0 + 40, 'end'); connector(u1 - 40, 'end'); connector(R.shift - len * 0.12, 'exit'); connector(R.shift + len * 0.12, 'exit');
    // Runway centreline nodes (for the take-off roll / landing).
    const sorted = conns.slice().sort((a, b) => a.u - b.u);
    for (let k = 0; k < sorted.length - 1; k++) graph.link(sorted[k].r, sorted[k + 1].r, { runway: true });
    // Lights: edge (every 60 m), threshold (green) / end (red), centreline, approach lighting (both ends).
    for (let u = u0; u <= u1; u += 60) for (const sd of [-1, 1]) lights.edge.push(W2(u, w + sd * (rw.width / 2 + 1)));
    for (let x = -rw.width / 2; x <= rw.width / 2; x += 3) { lights.thr.push(W2(u0 - 2, w + x)); lights.end.push(W2(u1 + 2, w + x)); lights.thr.push(W2(u1 + 2, w + x)); lights.end.push(W2(u0 - 2, w + x)); }
    for (const [uu, dir] of [[u0, -1], [u1, 1]]) for (let k = 1; k <= 15; k++) { const u = uu + dir * k * 60; lights.app.push(W2(u, w)); if (k % 5 === 0) for (let x = -15; x <= 15; x += 3) lights.app.push(W2(u, w + x)); }
    const ends = R.ends, y = elev;
    runways.push({
      id: rw.id, rw, ends, w, tw, nodesT,
      // Landing towards end.a heading touches down 300 m after threshold a, etc.
      dirs: [
        { name: n1, hdg: rw.hdg, thr: ends.a, stop: ends.b, ils: { x: ends.a.x + ends.dir.x * 300, z: ends.a.z + ends.dir.z * 300, y, hdg: rw.hdg, dx: ends.dir.x, dz: ends.dir.z }, entry: sorted[0].r, entryHold: sorted[0].h, exits: sorted.slice(1).map((c) => c.r) },
        { name: n2, hdg: (rw.hdg + 180) % 360, thr: ends.b, stop: ends.a, ils: { x: ends.b.x - ends.dir.x * 300, z: ends.b.z - ends.dir.z * 300, y, hdg: (rw.hdg + 180) % 360, dx: -ends.dir.x, dz: -ends.dir.z }, entry: sorted.at(-1).r, entryHold: sorted.at(-1).h, exits: sorted.slice(0, -1).reverse().map((c) => c.r) },
      ],
    });
    // PAPI (4 boxes left of each touchdown zone): colours set per frame from the viewer's angle.
    R.papi = [ [u0 + 300, -1], [u1 - 300, 1] ].map(([u, sgn]) => ({ u, w: w - sgn * 0 - (rw.width / 2 + 15) * sgn, sgn, lamps: [] }));
  }
  // Apron, stands, taxilane, terminal.
  const nStands = ap.stands, apW = two ? termW + 0 : termW - 110, laneW = two ? -90 : termW - 160;
  const standW = two ? [-150, 150] : [termW - 95];
  const span = Math.min(L - 400, nStands * (two ? 34 : 60));
  strip(M.concrete, rws[0].shift, two ? 0 : apW, span + 160, two ? 360 : 150, 0.025, [(span + 160) / 30, 8]);
  const lane = [], laneN = 8;
  const laneWs = two ? [-80, 80] : [laneW];
  for (const lw of laneWs) {
    const row = [];
    for (let k = 0; k <= laneN; k++) { const u = rws[0].shift - span / 2 + (k * span) / laneN; const p = W2(u, lw); row.push(graph.node(p.x, p.z, { kind: 'lane', u, w: lw })); }
    for (let k = 0; k < laneN; k++) graph.link(row[k], row[k + 1], { name: 'Apron' });
    strip(M.yellow, rws[0].shift, lw, span, 0.3, 0.05);
    lane.push(row);
    // Link the lane to the nearest taxiway at three points.
    for (const k of [0, Math.floor(laneN / 2), laneN]) {
      const ln = graph.nodes[row[k]];
      const t = graph.nearest(ln.x, ln.z, (nn) => nn.kind === 'twy'); const tn = graph.nodes[t];
      graph.link(row[k], t, { name: 'Link' });
      strip(M.asphalt, ln.u, (lw + tn.w) / 2, 23, Math.abs(tn.w - lw), 0.03);
      strip(M.yellow, ln.u, (lw + tn.w) / 2, 0.3, Math.abs(tn.w - lw), 0.05);
    }
  }
  const stands = [];
  for (let i = 0; i < nStands; i++) {
    const rowI = two ? i % 2 : 0, k = two ? Math.floor(i / 2) : i, per = two ? Math.ceil(nStands / 2) : nStands;
    const u = rws[0].shift - span / 2 + ((k + 0.5) * span) / per, sw = standW[rowI], lw = laneWs[rowI];
    const p = W2(u, sw), into = Math.sign(sw - lw);
    const node = graph.node(p.x, p.z, { kind: 'stand', u, w: sw, gate: `${two ? (rowI ? 'B' : 'A') : 'G'}${k + 1}` });
    const ln = graph.nearest(W2(u, lw).x, W2(u, lw).z, (nn) => nn.kind === 'lane' && nn.w === lw);
    graph.link(node, ln, { name: 'Stand' });
    // Facing the terminal (nose in): heading from lane to stand.
    const hdg = ((Math.atan2(n.x * into, -n.z * into) * 180) / Math.PI + 360) % 360;
    stands.push({ i, node, x: p.x, z: p.z, hdg, gate: graph.nodes[node].gate, occupied: null });
    strip(M.yellow, u, (sw + lw) / 2, 0.25, Math.abs(sw - lw), 0.05);
    // Jet bridge at the larger airports.
    if (ap.size === 'international' || ap.size === 'large') { box(M.grey, u + 6, sw + into * 18, 3, 18, 3, 3.5); }
  }
  // Terminal.
  const tLen = ap.terminal === 'large' ? Math.min(span, 900) : ap.terminal === 'medium' ? 260 : 110, tDep = ap.terminal === 'large' ? 90 : 45;
  const tw0 = two ? 0 : termW + 15;
  box(M.glass, rws[0].shift, tw0, tLen, tDep, ap.terminal === 'large' ? 22 : 12);
  { const g = new THREE.CylinderGeometry(tDep * 0.75, tDep * 0.75, tLen, 24, 1, true, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateY(yaw); g.scale(1, 0.25, 1); const p = W2(rws[0].shift, tw0); g.translate(p.x - ap.x, elev + (ap.terminal === 'large' ? 22 : 12), p.z - ap.z); put(M.roof, g); }
  if (two) for (const sw of [-1, 1]) box(M.glass, rws[0].shift, sw * 105, span * 0.9, 14, 8);   // piers
  // Tower.
  const towerP = { u: rws[0].shift + Math.min(span / 2, L / 2) * 0.55, w: two ? 0 : termW + 120 };
  const th = ap.size === 'international' ? 72 : ap.size === 'altiport' ? 20 : 38;
  { const p = W2(towerP.u, towerP.w); const sh = new THREE.CylinderGeometry(3.2, 4.2, th, 16); sh.translate(p.x - ap.x, elev + th / 2, p.z - ap.z); put(M.white, sh); const cab = new THREE.CylinderGeometry(7, 5.5, 6, 16); cab.translate(p.x - ap.x, elev + th + 3, p.z - ap.z); put(M.glass, cab); const rf = new THREE.CylinderGeometry(7.6, 7.6, 1, 16); rf.translate(p.x - ap.x, elev + th + 6.5, p.z - ap.z); put(M.dark, rf); }
  // Hangars, fuel farm, fire station, radar / VOR, windsock.
  const far = rws[0].shift - Math.min(span / 2 + 260, L / 2);
  for (let k = 0; k < (ap.size === 'international' ? 3 : 1); k++) { const u = far - k * 110, w = two ? 0 : termW - 20; box(M.white, u, w, 80, 70, 18); const p = W2(u, w); const r = new THREE.CylinderGeometry(42, 42, 70, 18, 1, true, 0, Math.PI); r.rotateZ(Math.PI / 2); r.rotateY(yaw + Math.PI / 2); r.scale(1, 0.3, 1); r.translate(p.x - ap.x, elev + 18, p.z - ap.z); put(M.roof, r); }
  for (let k = 0; k < 4; k++) { const p = W2(far - 60 - (k % 2) * 30, (two ? 0 : termW) + 110 + Math.floor(k / 2) * 30); const t2 = new THREE.CylinderGeometry(10, 10, 12, 20); t2.translate(p.x - ap.x, elev + 6, p.z - ap.z); put(M.tank, t2); }
  box(M.red, far + 100, (two ? 0 : termW) + 140, 40, 30, 9);
  const ws = new THREE.Group(); if (!HL) { const p = W2(rws[0].shift - L * 0.32, rws[0].w + (two ? -110 : -110)); ws.position.set(p.x - ap.x, elev, p.z - ap.z); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), M.white); pole.position.y = 3.5; ws.add(pole); const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 12, 1, true), lam({ color: 0xff6a10, side: THREE.DoubleSide })); sock.rotation.x = Math.PI / 2; sock.position.set(0, 7, -2); const piv = new THREE.Group(); piv.position.y = 0; piv.add(sock); ws.add(piv); ws.userData.piv = piv; grp.add(ws); }
  for (const R of rws) for (const end of [R.ends.a, R.ends.b]) { const p = { x: end.x - R.ends.dir.x * (end === R.ends.a ? -1 : 1) * 0 , z: end.z }; void p; }
  // Ground vehicles on the apron (tugs, fuel trucks, buses, catering), fire tenders at the station.
  const veh = [];
  for (let i = 0; i < Math.min(30, nStands * 2); i++) { const st = stands[i % stands.length]; const kind = i % 4; const p = { x: st.x + (i % 3 - 1) * 18 + n.x * 10, z: st.z + (i % 3 - 1) * 18 * 0 + n.z * 10 }; const L2 = kind === 2 ? 12 : 6, H2 = kind === 2 ? 3 : 2.2; const gm = new THREE.BoxGeometry(2.4, H2, L2); gm.rotateY(yaw + (i % 2) * Math.PI / 2); gm.translate(p.x - ap.x + d.x * (i % 2 ? 22 : -22), elev + H2 / 2, p.z - ap.z + d.z * (i % 2 ? 22 : -22)); put(kind === 1 ? M.tank : kind === 2 ? M.white : M.vehicle, gm); veh.push(p); }
  for (let k = 0; k < 3; k++) box(M.fire, far + 100 + (k - 1) * 9, (two ? 0 : termW) + 165, 10, 3, 3.4);
  // Merge static meshes.
  for (const [m, list] of parts) grp.add(new THREE.Mesh(mergeGeometries(list.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })), m));
  // Lights (points: always visible, brighter at night / in poor visibility).
  const pts = (list, color, size) => {
    if (HL) return { material: {} };
    const pos = new Float32Array(list.length * 3); list.forEach((p, i) => pos.set([p.x - ap.x, elev + 0.4, p.z - ap.z], i * 3));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, depthWrite: false, map: dotTex(), blending: THREE.AdditiveBlending });
    const o = new THREE.Points(g, m); grp.add(o); return o;
  };
  // taxiway edge lights (blue) along the taxiway nodes.
  for (const r of runways) for (let k = 0; k < r.nodesT.length - 1; k++) { const a = graph.nodes[r.nodesT[k]], b = graph.nodes[r.nodesT[k + 1]]; for (let t = 0; t < 1; t += 0.1) for (const sd of [-1, 1]) lights.twy.push({ x: a.x + (b.x - a.x) * t + n.x * 12 * sd, z: a.z + (b.z - a.z) * t + n.z * 12 * sd }); }
  const L1 = [pts(lights.edge, 0xfff2d0, 5), pts(lights.thr, 0x30ff60, 6), pts(lights.end, 0xff3020, 6), pts(lights.app, 0xfff4e0, 7), pts(lights.twy, 0x3a6cff, 4)];
  // PAPI units.
  const papis = [];
  if (!HL) for (const R of rws) for (const P of R.papi) {
    for (let k = 0; k < 4; k++) {
      const pp = W2(P.u, R.w - (R.rw.width / 2 + 15 + k * 9) * 1);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(pp.x - ap.x, elev + 0.8, pp.z - ap.z); s.scale.setScalar(5); grp.add(s);
      papis.push({ s, x: pp.x, z: pp.z, k, thrU: P.u });
    }
  }
  return {
    ap, group: grp, elev, graph, stands, runways, holdPoints,
    tower: { ...W2(towerP.u, towerP.w), y: elev + th + 3 },
    /** Landing / take-off direction into the wind (wind FROM dir). */
    activeDir(windDir = 270, rwIdx = 0) {
      const r = runways[rwIdx] || runways[0];
      const diff = (h) => Math.abs((((h - windDir) % 360) + 540) % 360 - 180);
      return diff(r.dirs[0].hdg) <= diff(r.dirs[1].hdg) ? r.dirs[0] : r.dirs[1];
    },
    freeStand(pref = null) { return this.stands.find((s) => !s.occupied && (!pref || s.gate === pref)) || this.stands.find((s) => !s.occupied) || null; },
    update(t, nightK, cam, wind) {
      const k = 0.25 + 0.75 * nightK;
      for (const o of L1) o.material.opacity = k;
      if (wind && ws.userData.piv) { ws.userData.piv.rotation.y = Math.PI - (wind.dir * Math.PI) / 180 + Math.PI; ws.userData.piv.children[0].rotation.x = Math.PI / 2 - Math.max(0, 0.9 - wind.speed * 0.08); }
      // PAPI: each light white above its own angle (2.5°, 2.83°, 3.17°, 3.5° from the outermost).
      if (cam) for (const p of papis) {
        const dist = Math.hypot(cam.x - p.x, cam.z - p.z), ang = Math.atan2(cam.y - elev, Math.max(1, dist)) * 180 / Math.PI;
        const thr = [3.5, 3.17, 2.83, 2.5][p.k];
        p.s.material.color.setHex(ang > thr ? 0xffffff : 0xff2a1a);
        p.s.material.opacity = 0.4 + 0.6 * nightK;
      }
    },
    dispose() { parent.remove(grp); grp.traverse((o) => { o.geometry?.dispose(); }); },
  };
}
let dotT = null;
function dotTex() { if (dotT) return dotT; const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); dotT = new THREE.CanvasTexture(c); return dotT; }
