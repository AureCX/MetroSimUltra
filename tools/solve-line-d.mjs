// Generates src/data/lines/grandville-d.json: Metro Line D "Aéroval", the automated elevated airport
// express. Aéroport International – Terminal 1 (Est), above Line A's Aéroport International and Line B's
// Aéroport Est → Aéroport International – Terminal 2 → Quartier des Affaires – Aéroport → Grandville Sud,
// right above Line A's terminus. Whole line on viaducts.
import fs from 'node:fs';
import { normalizeLine, expandServices } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/lines/${f}.json`, import.meta.url)));
const station = (file, svc, name) => {
  const l = normalizeLine(expandServices(read(file))[svc]); const g = new TrackGeometry(l);
  const i = l.stations.findIndex((s) => s.name === name); return { p: g.point(g.stationS[i]), h: g.heading(g.stationS[i]) };
};
const bAir = station('grandville-b', 1, 'Aéroport Est').p, aAir = station('grandville-a', 0, 'Aéroport International').p;
const gs = station('grandville-a', 0, 'Grandville Sud');
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const st = (length) => ({ length });
const curve = (angle, R) => ({ length: Math.max(20, Math.round(Math.abs(angle) * R * 10) / 10), radius: R, turn: angle >= 0 ? 'right' : 'left' });
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
  for (let i = 1; i <= 4000; i++) {
    const cur = at(-Math.PI + (2 * Math.PI * i) / 4000);
    if (Math.sign(cur.cross) !== Math.sign(prev.cross)) {
      let lo = prev.phi1, hi = cur.phi1, flo = prev.cross;
      for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, fm = at(m).cross; if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
      const r = at((lo + hi) / 2), len = (Math.abs(r.phi1) + Math.abs(r.phi2)) * R + r.b;
      if (r.b >= 0 && Math.abs(r.cross) < 1 && (!best || len < best.len)) best = { ...r, len };
    }
    prev = cur;
  }
  if (!best) throw new Error('no arc-straight-arc solution');
  return best;
}
const asaTrack = (r, R) => [...(Math.abs(r.phi1) > 1e-3 ? [curve(r.phi1, R)] : []), st(Math.max(1, Math.round(r.b * 10) / 10)), ...(Math.abs(r.phi2) > 1e-3 ? [curve(r.phi2, R)] : [])];
const asaLen = (r, R) => asaTrack(r, R).reduce((a, x) => a + x.length, 0);

const S = (name, extra = {}) => ({ name, distanceToNext: 800, speedLimit: 65, stopDuration: 25, style: 'modern', ...extra });
const raw = {
  id: 'grandville-d', line: 'Line D', number: 'D', network: 'Grandville Métro', color: '#FF8000', textColor: '#16233a',
  language: 'fr-FR', maxSpeed: 80, startTime: '07:40:00', headway: 180,
  tunnel: { profile: 'box' }, map: { origin: [0, 0], heading: 330 },
  elevated: { height: 9 },
  automation: 'ato',
  platformScreenDoors: true,
  train: 'apm-aeroval',
  directions: { A: { name: 'Aéroval · Direction Grandville Sud' }, B: { name: 'Aéroval · Direction Aéroport – Terminal 1' } },
  defaults: { platformLength: 105, platformWidth: 8, platformType: 'island', approachSpeedLimit: 45, approachDistance: 100, stopDuration: 25, style: 'modern' },
  signaling: { system: 'cbtc', blockLength: 200, overlap: 30, atpBrakeRate: 0.9 },
  announcements: {
    nextStation: 'Prochaine station : {station}. {connections}',
    arrival: '{station}. {doors}',
    terminus: "{station}. Terminus. {connections} Merci d'avoir voyagé avec Aéroval.",
    connections: 'Correspondance : {list}.',
  },
  stations: [
    S('Aéroport International – Terminal 1 (Est)', { speedLimit: 55, passengers: 40, signage: 'airport', interchange: { metro: ['A', 'B'], stations: ['Aéroport International', 'Aéroport Est'], bus: ['Aéroval'], airport: true },
      landmark: { type: 'airport', side: 'right', offset: 100, along: 0 }, theme: { wall: '#e9edf2', accent: '#FF8000' } }),
    S('Aéroport International – Terminal 2', { passengers: 34, signage: 'airport', interchange: { bus: ['Aéroval'], airport: true },
      landmark: { type: 'terminal2', side: 'right', offset: 95, along: 0 }, theme: { wall: '#eef0f3', accent: '#FF8000' } }),
    S('Quartier des Affaires – Aéroport', { passengers: 30, interchange: { bus: ['Aéroval'], busWalk: true }, theme: { wall: '#2b3140', accent: '#FF8000' } }),
    S('Grandville Sud', { distanceToNext: 0, passengers: 36, signage: 'interchange', interchange: { metro: ['A'] }, theme: { wall: '#3a3f46', accent: '#FF8000' } }),
  ],
};
const st0 = raw.stations, half = 52.5, PAD = 25;
const build = () => { const l = normalizeLine(raw); return { l, g: new TrackGeometry(l) }; };
const at = (b, i) => ({ p: b.g.point(b.g.stationS[i]), h: b.g.heading(b.g.stationS[i]), s: b.g.stationS[i] });
// Terminal 1 between Line A's and Line B's airport stations (directly above the interchange).
const T1 = { x: (aAir.x + bAir.x) / 2, z: (aAir.z + bAir.z) / 2 };
// Legs: arc–straight–arc onto each station (position, heading of the platforms).
const targets = [
  null,
  { p: { x: -5430, z: 2030 }, h: rad(268), R: 450 },           // Terminal 2, past the west end of the terminal frontage
  { p: { x: -5880, z: 2120 }, h: rad(262), R: 380 },           // Quartier des Affaires – Aéroport
  { p: gs.p, h: gs.h, R: 380 },                                 // Grandville Sud, above Line A's platforms
];
raw.map.heading = Math.round(deg(Math.atan2(targets[1].p.x - T1.x, -(targets[1].p.z - T1.z))) * 1000) / 1000;
{ const p = at(build(), 0).p; raw.map.origin = [T1.x - p.x, T1.z - p.z]; }
for (let k = 1; k < targets.length; k++) {
  const T = targets[k];
  let aim = { x: T.p.x, z: T.p.z };
  for (let it = 0; it < 8; it++) {
    const b = build(); const c = at(b, k - 1);
    const E = b.g.point(c.s + half + PAD), d = dirOf(T.h);
    let sol = null, Rk = T.R;
    for (; Rk >= 150 && !sol; Rk = Math.round(Rk * 0.85)) { try { sol = solveASA(E, c.h, { x: aim.x - d.x * (half + PAD), z: aim.z - d.z * (half + PAD) }, T.h, Rk); } catch { sol = null; } }
    if (!sol) throw new Error(`no alignment to ${st0[k].name}`);
    Rk = Math.round(Rk / 0.85);
    st0[k - 1].track = asaTrack(sol, Rk);
    st0[k - 1].distanceToNext = Math.round((half + PAD + asaLen(sol, Rk) + half + PAD) * 10) / 10;
    const q = at(build(), k).p, ex = T.p.x - q.x, ez = T.p.z - q.z;
    if (it === 0 || Math.hypot(ex, ez) < 0.5) console.log(st0[k].name, 'R', Rk, 'iteration', it, 'error', Math.hypot(ex, ez).toFixed(2), 'turns', deg(sol.phi1).toFixed(1), deg(sol.phi2).toFixed(1), 'straight', sol.b.toFixed(0));
    if (Math.hypot(ex, ez) < 0.5) break;
    aim = { x: aim.x + ex, z: aim.z + ez };
  }
}
const fin = build();
fin.l.stations.forEach((s, i) => { const p = at(fin, i).p; console.log(s.name.padEnd(46), p.x.toFixed(0), p.z.toFixed(0), deg(at(fin, i).h).toFixed(0)); });
console.log('T1 to Line A', Math.hypot(at(fin, 0).p.x - aAir.x, at(fin, 0).p.z - aAir.z).toFixed(0), 'm, to Line B', Math.hypot(at(fin, 0).p.x - bAir.x, at(fin, 0).p.z - bAir.z).toFixed(0), 'm; distances', st0.map((s) => s.distanceToNext).join(', '));
raw.map.origin = raw.map.origin.map((v) => Math.round(v * 100) / 100);
fs.writeFileSync(new URL('../src/data/lines/grandville-d.json', import.meta.url), JSON.stringify(raw, null, 1));
