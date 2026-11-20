// Generates src/data/lines/grandville-c.json so that Line C's interchange stations coincide on the
// network map with Line B (Grandville Nord) and Line A (Place des Nations, République, Gare Centrale).
// Each leg between two fixed stations starts with a curve; its angle and the section lengths are
// iterated until the next fixed station lands on its target.
import fs from 'node:fs';
import { normalizeLine, expandServices } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/lines/${f}.json`, import.meta.url)));
const posOf = (file, name) => {
  const l = normalizeLine(expandServices(read(file))[0]); const g = new TrackGeometry(l);
  const i = l.stations.findIndex((s) => s.name === name); return g.point(g.stationS[i]);
};
const T = {
  'Grandville Nord': posOf('grandville-b', 'Grandville Nord'),
  'Place des Nations': posOf('grandville-a', 'Place des Nations'),
  'République': posOf('grandville-a', 'République'),
  'Gare Centrale': posOf('grandville-a', 'Gare Centrale'),
};
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
const bearing = (a, b) => Math.atan2(b.x - a.x, -(b.z - a.z));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const st = (length, gradient) => ({ length, ...(gradient ? { gradient } : {}) });
const curve = (angle, R, extra = {}) => ({ length: Math.max(20, Math.round(Math.abs(angle) * R * 10) / 10), radius: R, turn: angle >= 0 ? 'right' : 'left', ...extra });

const S = (name, style, extra = {}) => ({ name, distanceToNext: 600, speedLimit: 70, stopDuration: 20, style, ...extra });
const raw = {
  id: 'grandville-c', line: 'Line C', number: 'C', network: 'Grandville Métro', color: '#00DDF5', textColor: '#16233a',
  language: 'fr-FR', maxSpeed: 75, startTime: '08:20:00', headway: 200,
  tunnel: { profile: 'arch' }, map: { origin: [0, 0], heading: 0 },
  defaults: { platformLength: 110, platformWidth: 4.5, platformType: 'side', approachSpeedLimit: 50, stopDuration: 20, style: 'vault' },
  signaling: { system: 'fixed-block', blockLength: 300, overlap: 40, atpBrakeRate: 0.85 },
  announcements: { nextStation: 'Prochaine station : {station}.', arrival: '{station}.', terminus: "{station}. Terminus. Tout le monde descend, s'il vous plaît." },
  stations: [
    S('Grandville Nord', 'modern', { platformType: 'island', platformWidth: 7, passengers: 26, theme: { wall: '#28362a', accent: '#00DDF5' } }),
    S('Quartier des Affaires', 'modern', { passengers: 30, theme: { wall: '#2b3140', accent: '#00DDF5' } }),
    S('Saint-Michel', 'vault', { theme: { wall: '#f1ede2', accent: '#1f3c88' } }),
    S('Place des Nations', 'vault', { passengers: 24, theme: { accent: '#00DDF5' } }),
    S('République', 'vault', { passengers: 34, theme: { wall: '#f4f1e8', accent: '#00DDF5' } }),
    S('Gare Centrale', 'vault', { interchange: { rail: true }, passengers: 40, platformLength: 120, platformWidth: 5.5, theme: { wall: '#e9e2cf', accent: '#00DDF5' } }),
    S('Palais Royal', 'grand', { passengers: 30, platformLength: 115, platformWidth: 6, theme: { wall: '#efe6d2', accent: '#00DDF5', vault: '#1b2a4a' } }),
    S('Opéra', 'vault', { distanceToNext: 0, passengers: 26, theme: { wall: '#f3eee0', accent: '#b3121b' } }),
  ],
};
const st0 = raw.stations;
const build = () => { const l = normalizeLine(raw); return { l, g: new TrackGeometry(l) }; };
const at = ({ l, g }, name) => { const i = l.stations.findIndex((s) => s.name === name); return { p: g.point(g.stationS[i]), h: g.heading(g.stationS[i]), s: g.stationS[i] }; };

// Start: point straight at Place des Nations, place the origin so Grandville Nord is exact.
let h0 = bearing(T['Grandville Nord'], T['Place des Nations']);
raw.map.heading = deg(h0);
{ const { p } = at(build(), 'Grandville Nord'); raw.map.origin = [T['Grandville Nord'].x - p.x, T['Grandville Nord'].z - p.z]; }

// Legs: [from index, to index] with fixed targets.
const legs = [[0, 3], [3, 4], [4, 5]];
for (const [a, b] of legs) {
  const target = T[st0[b].name];
  const n = b - a;
  let turn = 0, L = 0;
  { const s = at(build(), st0[a].name); turn = wrap(bearing(s.p, target) - s.h); L = Math.hypot(target.x - s.p.x, target.z - s.p.z); }
  for (let it = 0; it < 30; it++) {
    const R = 450;
    for (let k = a; k < b; k++) { st0[k].distanceToNext = Math.max(160, Math.round((L / n) * 10) / 10); st0[k].track = k === a && Math.abs(turn) > 0.002 ? [st(10), curve(turn, R)] : [st(Math.min(200, L / n / 2), k % 2 ? -10 : 10)]; }
    const bb = build(); const s = at(bb, st0[a].name), e = at(bb, st0[b].name);
    const ex = target.x - e.p.x, ez = target.z - e.p.z;
    if (Math.hypot(ex, ez) < 0.3) break;
    const dir = { x: Math.sin(e.h), z: -Math.cos(e.h) };
    L += ex * dir.x + ez * dir.z;
    const perp = ex * Math.cos(e.h) + ez * Math.sin(e.h); // + = right of travel
    turn += Math.atan2(perp, Math.max(200, Math.hypot(e.p.x - s.p.x, e.p.z - s.p.z)));
  }
}
// Terminal loop (raquette), one way: République → Gare Centrale → Palais Royal → (U-turn) → Opéra → République.
raw.loop = { junction: 'République' };
raw.directions = { A: { name: 'Boucle Opéra · Direction Grandville Nord' } };
const PAD = 25;
const half = (k) => (st0[k].platformLength || raw.defaults.platformLength) / 2;
const frame = (h) => ({ t: { x: Math.sin(h), z: -Math.cos(h) }, r: { x: Math.cos(h), z: Math.sin(h) } });
const rel = (o, h, p) => { const f = frame(h); const dx = p.x - o.x, dz = p.z - o.z; return { along: dx * f.t.x + dz * f.t.z, lat: dx * f.r.x + dz * f.r.z }; };
const iR = 4, iG = 5, iP = 6, iO = 7;
const dirOf = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });
const arcDisp = (h, phi, R) => (Math.abs(phi) < 1e-9 ? { x: 0, z: 0 } : { x: Math.sign(phi) * R * (Math.cos(h) - Math.cos(h + phi)), z: Math.sign(phi) * R * (Math.sin(h) - Math.sin(h + phi)) });
/** Arc (radius R) – straight – arc from (P0, h0) to (P1, h1); the shortest solution with a non-negative straight. */
function solveASA(P0, h0, P1, h1, R) {
  let best = null;
  const at = (phi1) => {
    const a1 = arcDisp(h0, phi1, R), psi = h0 + phi1, phi2 = wrap(h1 - psi), a2 = arcDisp(psi, phi2, R);
    const vx = P1.x - P0.x - a1.x - a2.x, vz = P1.z - P0.z - a1.z - a2.z, d = dirOf(psi);
    return { cross: vx * d.z - vz * d.x, b: vx * d.x + vz * d.z, phi1, phi2 };
  };
  if (process.env.DBG) { for (let f = -3; f <= 3; f += 0.25) { const q = at(f); console.log('scan', f, q.cross.toFixed(0), q.b.toFixed(0), deg(q.phi2).toFixed(0)); } console.log(P0, h0, P1, h1); }
  const n = 4000;
  let prev = at(-Math.PI);
  for (let i = 1; i <= n; i++) {
    const cur = at(-Math.PI + (2 * Math.PI * i) / n);
    if (Math.sign(cur.cross) !== Math.sign(prev.cross)) {
      let lo = prev.phi1, hi = cur.phi1, flo = prev.cross;
      for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, fm = at(m).cross; if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
      const r = at((lo + hi) / 2);
      const len = (Math.abs(r.phi1) + Math.abs(r.phi2)) * R + r.b;
      if (process.env.DBG) console.log('root', r.phi1.toFixed(3), r.b.toFixed(1), r.cross.toFixed(3));
      if (r.b >= 0 && Math.abs(r.cross) < 1 && (!best || len < best.len)) best = { ...r, len };
    }
    prev = cur;
  }
  if (!best) throw new Error('no arc-straight-arc solution');
  return best;
}
const asaTrack = (r, R) => [...(Math.abs(r.phi1) > 1e-3 ? [curve(r.phi1, R)] : []), st(Math.max(1, Math.round(r.b))), ...(Math.abs(r.phi2) > 1e-3 ? [curve(r.phi2, R)] : [])];
const asaLen = (r, R) => asaTrack(r, R).reduce((a, x) => a + x.length, 0);
// Line A's heading at Gare Centrale: Line C's platforms run parallel to it.
const gAh = (() => { const l = normalizeLine(expandServices(read('grandville-a'))[0]); const g = new TrackGeometry(l); return g.heading(g.stationS[l.stations.findIndex((x) => x.name === 'Gare Centrale')]); })();
st0[iO].distanceToNext = 1500; // placeholder until the return run is solved
// 1. République → Gare Centrale (outbound branch of the loop).
const R1 = 360;
{
  const b0 = build(); const r = at(b0, 'République');
  const J = b0.g.point(r.s + half(iR) + PAD);
  let aim = { x: T['Gare Centrale'].x, z: T['Gare Centrale'].z };
  for (let it = 0; it < 6; it++) {
    const d = dirOf(gAh), P1 = { x: aim.x - d.x * (half(iG) + PAD), z: aim.z - d.z * (half(iG) + PAD) };
    const sol = solveASA(J, r.h, P1, gAh, R1);
    st0[iR].track = asaTrack(sol, R1);
    st0[iR].distanceToNext = half(iR) + PAD + asaLen(sol, R1) + half(iG) + PAD;
    const g = at(build(), 'Gare Centrale').p;
    const ex = T['Gare Centrale'].x - g.x, ez = T['Gare Centrale'].z - g.z;
    console.log('GC iteration', it, 'error', Math.hypot(ex, ez).toFixed(2), 'turns', deg(sol.phi1).toFixed(1), deg(sol.phi2).toFixed(1), 'straight', sol.b.toFixed(0));
    if (Math.hypot(ex, ez) < 0.5) break;
    aim = { x: aim.x + ex, z: aim.z + ez };
  }
}
// 2. Gare Centrale → Palais Royal: on east alongside Line A, then a quarter turn north; Palais Royal sits at the
//    far end of the loop next to Line A's Université Nord. 3. Palais Royal → Opéra: on north, a second quarter
//    turn west, so the westbound return runs ~WEST m beyond République and rejoins the trunk on the outer side
//    of the outbound branch (no flat crossing).
const WEST = 420, r1 = 200, r2 = 250, dStr = 300;
{
  const b = build(); const g = at(b, 'Gare Centrale'), r = at(b, 'République');
  const J = b.g.point(r.s + half(iR) + PAD);
  const W = { x: J.x - Math.cos(gAh) * WEST, z: J.z - Math.sin(gAh) * WEST };
  const latW = rel(g.p, g.h, W).lat;
  const UN = (() => { const l = normalizeLine(expandServices(read('grandville-a'))[0]); const gg = new TrackGeometry(l); return gg.point(gg.stationS[l.stations.findIndex((x) => x.name === 'Université Nord')]); })();
  const aStr = Math.round(rel(g.p, g.h, UN).along - half(iG) - PAD - r1);
  st0[iG].track = [st(aStr), curve(-Math.PI / 2, r1)];
  st0[iG].distanceToNext = Math.round((half(iG) + PAD + aStr + (Math.PI / 2) * r1 + half(iP) + PAD) * 10) / 10;
  const c = Math.round(-latW - r1 - 2 * (half(iP) + PAD) - r2);
  if (c < 0) throw new Error('loop too narrow');
  st0[iP].track = [st(c), curve(-Math.PI / 2, r2)];
  st0[iP].distanceToNext = Math.round((half(iP) + PAD + c + (Math.PI / 2) * r2 + dStr + half(iO) + PAD) * 10) / 10;
  raw.speedRestrictions = [
    { fromStation: 'Gare Centrale', start: Math.round(half(iG) + PAD + aStr - 40), length: Math.round((Math.PI / 2) * r1 + 60), limit: 45, reason: 'Boucle de retournement' },
    { fromStation: 'Palais Royal', start: Math.round(half(iP) + PAD + c - 40), length: Math.round((Math.PI / 2) * r2 + 60), limit: 50, reason: 'Boucle de retournement' },
  ];
}
// 4. Opéra → République, return track: arc–straight–arc onto the trunk, heading reversed.
const R2 = 420;
{
  const b = build(); const r = at(b, 'République'), o = at(b, 'Opéra');
  const J = b.g.point(r.s + half(iR) + PAD);
  const E = b.g.point(o.s + half(iO) + PAD);
  const sol = solveASA(E, o.h, J, r.h + Math.PI, R2);
  console.log('return turns', deg(sol.phi1).toFixed(1), deg(sol.phi2).toFixed(1), 'straight', sol.b.toFixed(0));
  st0[iO].track = asaTrack(sol, R2);
  st0[iO].distanceToNext = half(iO) + PAD + asaLen(sol, R2) + half(iR) + PAD;
}
const fin = build();
console.log('loop closure error', fin.g.loop.closure.toFixed(2), 'm · chamber', fin.g.loop.chamber, 'm · inner', fin.g.loop.inner);
for (const name of Object.keys(T)) { const q = at(fin, name).p; console.log(name.padEnd(18), 'error', Math.hypot(q.x - T[name].x, q.z - T[name].z).toFixed(2), 'm'); }
// Palais Royal is shown with Line A on the plan: walking connection to the nearest Line A station.
const pr = at(fin, 'Palais Royal').p, op = at(fin, 'Opéra').p;
const A = normalizeLine(expandServices(read('grandville-a'))[0]), gA = new TrackGeometry(A);
const near = A.stations.map((s, i) => ({ name: s.name, d: Math.hypot(gA.point(gA.stationS[i]).x - pr.x, gA.point(gA.stationS[i]).z - pr.z) })).sort((x, y) => x.d - y.d)[0];
st0[6].connections = [near.name];
console.log('Palais Royal → nearest Line A station:', near.name, near.d.toFixed(0), 'm;  Opéra at', op.x.toFixed(0), op.z.toFixed(0));
console.log('distances', st0.map((s) => s.distanceToNext).join(', '), 'clipped', fin.l.stations.filter((s) => s.trackClipped).map((s) => s.name));
raw.map.origin = raw.map.origin.map((v) => Math.round(v * 100) / 100); raw.map.heading = Math.round(raw.map.heading * 1000) / 1000;
fs.writeFileSync(new URL('../src/data/lines/grandville-c.json', import.meta.url), JSON.stringify(raw, null, 1));
