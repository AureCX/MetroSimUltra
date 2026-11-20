// Generates the Grandville main-line (TGV) network: src/data/lines/tgv-*.json.
// Three corridors leave the platforms of Gare Centrale: east-south (Montreval, Saint-Roch-les-Alpes, Port-Azur),
// west (Valdor, Belle-Rive) and north (Clairmont). The horizontal alignment is made of arcs and straights through
// control points; the vertical profile is fitted to the country terrain (gradients ≤ 35 ‰), with tunnels where the
// ground rises well above it. Each destination's position along its corridor is tuned so that the timetable gives
// the commercial journey time.
import fs from 'node:fs';
import { normalizeLine } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';
import { Route } from '../src/lines/Route.js';
import { Timetable } from '../src/stations/Timetable.js';
import { deriveTrainSpecs } from '../src/physics/TrainPhysics.js';
import { RailTerrain, COUNTRY } from '../src/rail/RailTerrain.js';

const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dirOf = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
const arcDisp = (h, phi, R) => (Math.abs(phi) < 1e-9 ? { x: 0, z: 0 } : { x: Math.sign(phi) * R * (Math.cos(h) - Math.cos(h + phi)), z: Math.sign(phi) * R * (Math.sin(h) - Math.sin(h + phi)) });
function solveASA(P0, h0, P1, h1, R) {
  let best = null;
  const at = (phi1) => {
    const a1 = arcDisp(h0, phi1, R), psi = h0 + phi1, phi2 = wrap(h1 - psi), a2 = arcDisp(psi, phi2, R);
    const vx = P1.x - P0.x - a1.x - a2.x, vz = P1.z - P0.z - a1.z - a2.z, d = dirOf(psi);
    return { cross: vx * d.z - vz * d.x, b: vx * d.x + vz * d.z, phi1, phi2 };
  };
  let prev = at(-Math.PI);
  for (let i = 1; i <= 6000; i++) {
    const cur = at(-Math.PI + (2 * Math.PI * i) / 6000);
    if (Math.sign(cur.cross) !== Math.sign(prev.cross)) {
      let lo = prev.phi1, hi = cur.phi1, flo = prev.cross;
      for (let k = 0; k < 70; k++) { const m = (lo + hi) / 2, fm = at(m).cross; if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
      const r = at((lo + hi) / 2), len = (Math.abs(r.phi1) + Math.abs(r.phi2)) * R + r.b;
      if (r.b >= 0 && Math.abs(r.cross) < 1 && (!best || len < best.len)) best = { ...r, len };
    }
    prev = cur;
  }
  return best;
}
const seg = (len, R = 0, phi = 0) => (R ? { length: Math.round(Math.abs(phi) * R * 10) / 10, radius: R, turn: phi >= 0 ? 'right' : 'left' } : { length: Math.round(len * 10) / 10 });
/** Arc–straight–arc with the largest radius (down to rMin) that fits. */
function leg(P0, h0, P1, h1, R, rMin = 1200) {
  for (let r = R; r >= rMin; r = Math.round(r * 0.85)) {
    const s = solveASA(P0, h0, P1, h1, r);
    if (s) return { track: [...(Math.abs(s.phi1) > 1e-4 ? [seg(0, r, s.phi1)] : []), seg(Math.max(1, s.b)), ...(Math.abs(s.phi2) > 1e-4 ? [seg(0, r, s.phi2)] : [])], len: s.len };
  }
  throw new Error('no alignment');
}

const terrain = new RailTerrain(COUNTRY);
const GC = { x: 3570, z: 220 };            // centre of the Gare Centrale train shed (above the metro station)
const SLOT = 22;                           // lateral spacing of the island platforms in the shed
const slotPos = (k) => ({ x: GC.x, z: GC.z + (k - 2.5) * SLOT });
const HALF = 135, PAD = 25;                // half platform (270 m) + straight pad
const specs = deriveTrainSpecs(JSON.parse(fs.readFileSync(new URL('../src/data/trains/tgv-duplex.json', import.meta.url))));

const CITY = {
  'Montreval': { identity: 'regional', desc: 'Major regional city', y: 140 },
  'Valdor': { identity: 'coastal', desc: 'Coastal city', y: 6 },
  'Clairmont': { identity: 'industrial', desc: 'Industrial and cultural city', y: 95 },
  'Saint-Roch-les-Alpes': { identity: 'alpine', desc: 'Mountain city', y: 780 },
  'Belle-Rive': { identity: 'western', desc: 'Large western city', y: 30 },
  'Port-Azur': { identity: 'southern', desc: 'Southern coastal metropolis', y: 8 },
};

/**
 * Corridor: start heading at Gare Centrale, then legs to stations; each leg lists via points [x, z] and the
 * station's approximate position (scaled along the leg to tune journey times) and platform heading.
 */
const CORRIDORS = [
  // vias: [t, offset] — fraction of the leg from the previous station, lateral offset (m, + = right of the leg).
  // The first via of the first leg is absolute ([x, z]): the throat out of Gare Centrale.
  { id: 'est', slot: 1, startHeading: 90, throat: [16000, 900], legs: [
    { name: 'Montreval', vias: [[0.45, -6000]], at: [152000, -6000], heading: 92, limit: 300, target: 35 * 60 },
    { name: 'Saint-Roch-les-Alpes', vias: [[0.4, -9000]], at: [262000, 70000], heading: 140, limit: 230, target: 80 * 60 },
    { name: 'Port-Azur', vias: [[0.45, 14000]], at: [322000, 300000], heading: 172, limit: 300, target: 135 * 60 },
  ] },
  { id: 'ouest', slot: 3, startHeading: 270, throat: [-14000, 600], legs: [
    { name: 'Valdor', vias: [[0.5, -9000]], at: [-238000, -62000], heading: 285, limit: 300, target: 55 * 60 },
    { name: 'Belle-Rive', vias: [[0.5, 9000]], at: [-468000, -12000], heading: 275, limit: 300, target: 105 * 60 },
  ] },
  { id: 'nord', slot: 4, startHeading: 90, throat: [14000, -2500], legs: [
    { name: 'Clairmont', vias: [[0.12, 6000], [0.55, 9000]], at: [22000, -330000], heading: 355, limit: 300, target: 70 * 60 },
  ] },
];
const bearing = (a, b) => Math.atan2(b.x - a.x, -(b.z - a.z));
const avgAngle = (a, b) => Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));

function station(name, extra = {}) {
  return { name, distanceToNext: 1000, speedLimit: 300, stopDuration: name === 'Gare Centrale' ? 30 : 150, style: 'modern', platformType: 'island', platformLength: 270, platformWidth: 10, approachSpeedLimit: 160, approachDistance: 5500, passengers: 40, ...extra };
}

function buildCorridor(c, scale) {
  // scale[i]: factor applied to the i-th destination's distance along its leg (journey-time tuning).
  const raw = {
    id: `tgv-${c.id}`, line: 'TGV', number: 'TGV', network: 'Grandville Grandes Lignes', category: 'hst',
    color: '#1b2a4a', textColor: '#ffffff', language: 'fr-FR', maxSpeed: 320, startTime: '06:30:00', headway: 3600,
    tunnel: { profile: 'arch' }, map: { origin: [0, 0], heading: c.startHeading },
    defaults: { platformLength: 270, platformWidth: 10, platformType: 'island', stopDuration: 150, style: 'modern' },
    signaling: { system: 'tvm', blockLength: 1500, overlap: 200, atpBrakeRate: 0.55 },
    announcements: { nextStation: 'Prochain arrêt : {station}. {connections}', arrival: '{station}. {doors}', terminus: "{station}. Terminus de ce train. Merci d'avoir voyagé sur Grandville Grandes Lignes." },
    stations: [station('Gare Centrale', { stopDuration: 60, passengers: 60, interchange: { metro: ['A', 'B', 'C'] } })],
    speedRestrictions: [],
  };
  const st = raw.stations;
  let fromPos = slotPos(c.slot);
  c.legs.forEach((L, i) => {
    const from = fromPos, to = { x: from.x + (L.at[0] - from.x) * scale[i], z: from.z + (L.at[1] - from.z) * scale[i] };
    L._from = from; fromPos = to;
    const s = station(L.name, { speedLimit: L.limit, landmark: { type: `city-${CITY[L.name].identity}`, side: 'right', offset: 0, along: 0 }, theme: { accent: '#b48a3c' }, passengers: 45 });
    st.at(-1).speedLimit = L.limit;
    st.push(s);
    L._to = to;
  });
  // Plan: legs between stations through the via points (headings = bearing between neighbours).
  const pts = (i) => {
    const L = c.legs[i], a = L._from, b = L._to, len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const v = L.vias.map(([t, off]) => ({ x: a.x + (b.x - a.x) * t - uz * off, z: a.z + (b.z - a.z) * t + ux * off }));
    return [...(i === 0 ? [{ x: c.throat[0], z: c.throat[1] }] : []), ...v, b];
  };
  let cur = { pos: slotPos(c.slot), h: rad(c.startHeading) };
  for (let i = 0; i < c.legs.length; i++) {
    const L = c.legs[i], P = pts(i);
    const track = [];
    let pos = { x: cur.pos.x + dirOf(cur.h).x * (HALF + PAD), z: cur.pos.z + dirOf(cur.h).z * (HALF + PAD) }, h = cur.h, len = HALF + PAD;
    for (let k = 0; k < P.length; k++) {
      const last = k === P.length - 1;
      const hk = last ? rad(L.heading) : avgAngle(bearing(pos, P[k]), bearing(P[k], P[k + 1]));
      const tgt = last ? { x: P[k].x - dirOf(hk).x * (HALF + PAD), z: P[k].z - dirOf(hk).z * (HALF + PAD) } : P[k];
      const R = i === 0 && k === 0 ? 2500 : L.limit > 250 ? 7000 : 3500;
      const lg = leg(pos, h, tgt, hk, R, i === 0 && k === 0 ? 1200 : 2000);
      track.push(...lg.track); len += lg.len;
      pos = tgt; h = hk;
    }
    st[i].track = track;
    st[i].distanceToNext = Math.round((len + HALF + PAD) * 10) / 10;
    cur = { pos: L._to, h: rad(L.heading) };
  }
  st.at(-1).distanceToNext = 0;
  // Speed restrictions: station throats (both sides of every station) at 160 km/h.
  for (const s of st) raw.speedRestrictions.push({ fromStation: s.name, start: -5000, length: 10000, limit: 160, reason: 'Zone de gare' });
  // Place the network: Gare Centrale platform centre on its shed slot.
  return raw;
}

function finish(raw, c) {
  // Origin so that the first station lands on its slot.
  { const l = normalizeLine(raw), g = new TrackGeometry(l), p = g.point(g.stationS[0]), q = slotPos(c.slot); raw.map.origin = [raw.map.origin[0] + q.x - p.x, raw.map.origin[1] + q.z - p.z]; }
  // Vertical profile against the terrain.
  const l = normalizeLine(raw), g = new TrackGeometry(l);
  const N = Math.floor(g.length / 100) + 1, S = [], G = [];
  for (let i = 0; i < N; i++) { const s = Math.min(g.length, i * 100), p = g.point(s); S.push(s); G.push(terrain.height(p.x, p.z)); }
  const stS = g.stationS;
  // Cities: flat at station level.
  const pin = new Map();
  stS.forEach((s, k) => { const p = g.point(s), y = k === 0 ? 6 : Math.max(6, Math.round(terrain.height(p.x, p.z))); for (let i = 0; i < N; i++) if (Math.abs(S[i] - s) < 1200) pin.set(i, y); });
  // Smoothed ground, then gradient limits (35 ‰), pins respected.
  const win = 30; const Y = G.map((_, i) => { let a = 0, n = 0; for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win); j++) { a += G[j]; n++; } return a / n; });
  for (const [i, y] of pin) Y[i] = y;
  const gmax = 0.033 * 100;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < N; i++) if (!pin.has(i)) Y[i] = Math.max(Y[i - 1] - gmax, Math.min(Y[i - 1] + gmax, Y[i]));
    for (let i = N - 2; i >= 0; i--) if (!pin.has(i)) Y[i] = Math.max(Y[i + 1] - gmax, Math.min(Y[i + 1] + gmax, Y[i]));
  }
  Y.forEach((y, i) => { if (Y[i] < 2) Y[i] = 2; });
  raw.rail = { slot: c.slot, corridor: c.id, profile: S.map((s, i) => [Math.round(s), Math.round(Y[i] * 10) / 10]), tunnels: [] };
  // Tunnels where the ground stands > 25 m above the rails for 400 m or more.
  let a = null;
  for (let i = 0; i <= N; i++) {
    const deep = i < N && G[i] - Y[i] > 25 && !stS.some((s) => Math.abs(S[i] - s) < 1500);
    if (deep && a == null) a = i;
    if (!deep && a != null) { if (i - a >= 4) raw.rail.tunnels.push([S[a] - 60, S[i - 1] + 60]); a = null; }
  }
  return raw;
}

function runTimes(raw) {
  const l = normalizeLine(raw), g = new TrackGeometry(l), r = new Route(l, g, 'A');
  const tt = new Timetable(r, specs, '06:30:00');
  return { l, g, tt, at: l.stations.map((_, k) => (tt.entry(k).arr ?? tt.entry(k).dep) - tt.start) };
}

const out = [];
for (const c of CORRIDORS) {
  const scale = c.legs.map(() => 1);
  let raw;
  for (let it = 0; it < 6; it++) {
    raw = finish(buildCorridor(c, scale), c);
    const { at } = runTimes(raw);
    let ok = true;
    c.legs.forEach((L, i) => {
      const t = at[i + 1], t0 = at[i] + (i ? raw.stations[i].stopDuration : 0);
      const want = L.target - (i ? c.legs[i - 1].target + raw.stations[i].stopDuration : 0);
      const have = t - t0;
      if (Math.abs(L.target - t) > 45) ok = false;
      scale[i] *= Math.max(0.6, Math.min(1.5, 1 + (want - have) / Math.max(600, have) * 0.95));
    });
    if (ok) break;
  }
  const { at, g } = runTimes(raw);
  console.log(c.id, 'length', (g.length / 1000).toFixed(1), 'km; arrivals', at.map((t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`).join(' '), 'tunnels', raw.rail.tunnels.length);
  out.push({ c, raw, at });
}

// One service file per destination (the corridor cut after that station).
const TRAIN_NO = { Montreval: 6201, Valdor: 6401, Clairmont: 6601, 'Saint-Roch-les-Alpes': 6801, 'Belle-Rive': 6411, 'Port-Azur': 6811 };
const DEPARTURES = {
  Montreval: ['06:30', '08:30', '11:30', '14:30', '17:30', '20:30'],
  Valdor: ['07:15', '10:15', '13:15', '16:15', '19:15'],
  Clairmont: ['08:00', '12:00', '15:00', '18:00'],
  'Saint-Roch-les-Alpes': ['09:00', '13:00', '17:00'],
  'Belle-Rive': ['10:30', '15:30', '19:30'],
  'Port-Azur': ['06:45', '12:00', '16:45'],
};
// Track ("voie") used at Gare Centrale: the outbound track of the corridor's island platform (tracks 1–12, north to south).
const voieOf = (c) => 2 * c.slot + (c.startHeading === 90 ? 2 : 1);
for (const { c, raw, at } of out) {
  c.legs.forEach((L, i) => {
    const n = i + 2;
    const svc = JSON.parse(JSON.stringify(raw));
    svc.id = `tgv-${L.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-')}`;
    svc.line = `TGV ${L.name}`;
    svc.number = 'TGV';
    svc.stations = svc.stations.slice(0, n);
    svc.stations.at(-1).distanceToNext = 0;
    delete svc.stations.at(-1).track;
    svc.speedRestrictions = svc.speedRestrictions.filter((r) => svc.stations.some((s) => s.name === r.fromStation));
    const g = new TrackGeometry(normalizeLine(svc));
    svc.rail.profile = svc.rail.profile.filter(([s]) => s <= g.length + 200);
    svc.rail.tunnels = svc.rail.tunnels.filter(([a]) => a < g.length);
    svc.rail.destination = L.name; svc.rail.identity = CITY[L.name].identity; svc.rail.description = CITY[L.name].desc;
    svc.rail.trainNumber = TRAIN_NO[L.name]; svc.rail.departures = DEPARTURES[L.name]; svc.rail.slot = c.slot; svc.rail.voie = voieOf(c);
    svc.rail.duration = Math.round(at[i + 1] / 60);
    svc.directions = { A: { name: `TGV ${TRAIN_NO[L.name]} · ${L.name}` }, B: { name: `TGV ${TRAIN_NO[L.name] + 1} · Grandville Gare Centrale` } };
    svc.startTime = `${DEPARTURES[L.name][0]}:00`;
    fs.writeFileSync(new URL(`../src/data/lines/${svc.id}.json`, import.meta.url), JSON.stringify(svc));
    console.log('wrote', svc.id, 'stations', svc.stations.map((s) => s.name).join(' → '), 'duration', svc.rail.duration, 'min');
  });
}
