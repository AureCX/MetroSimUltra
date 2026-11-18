// Generates src/data/lines/grandville-d.json: Metro Line D "Aéroval", the automated airport line.
// Aéroport International – Terminal 1 (Est), next to Line A's Aéroport International and Line B's
// Aéroport Est (walking connections) → Terminal 2 (Ouest) → round the south of the airfield →
// Zone Cargo & Fret → Parc des Expositions, on the same spot as Line B's station (interchange).
import fs from 'node:fs';
import { normalizeLine, expandServices } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/lines/${f}.json`, import.meta.url)));
const station = (file, svc, name) => {
  const l = normalizeLine(expandServices(read(file))[svc]); const g = new TrackGeometry(l);
  const i = l.stations.findIndex((s) => s.name === name); return { p: g.point(g.stationS[i]), h: g.heading(g.stationS[i]) };
};
const bAir = station('grandville-b', 1, 'Aéroport Est').p, aAir = station('grandville-a', 0, 'Aéroport International').p;
const pde = station('grandville-b', 1, 'Parc des Expositions');
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

const S = (name, extra = {}) => ({ name, distanceToNext: 900, speedLimit: 70, stopDuration: 25, style: 'modern', ...extra });
const raw = {
  id: 'grandville-d', line: 'Line D', number: 'D', network: 'Grandville Métro', color: '#FFD000', textColor: '#16233a',
  service: null, language: 'fr-FR', maxSpeed: 80, startTime: '07:40:00', headway: 150,
  tunnel: { profile: 'box' }, map: { origin: [0, 0], heading: 180 },
  directions: { A: { name: 'Aéroval · Direction Parc des Expositions' }, B: { name: 'Aéroval · Direction Aéroport – Terminal 1' } },
  defaults: { platformLength: 90, platformWidth: 6, platformType: 'island', approachSpeedLimit: 45, stopDuration: 25, style: 'modern' },
  signaling: { system: 'cbtc', blockLength: 200, overlap: 30, atpBrakeRate: 0.9 },
  announcements: {
    nextStation: 'Prochaine station : {station}.', arrival: '{station}.',
    terminus: "{station}. Terminus. Merci d'avoir voyagé avec Aéroval.",
  },
  stations: [
    S('Aéroport International – Terminal 1 (Est)', { passengers: 40, connections: ['Aéroport International', 'Aéroport Est'], theme: { wall: '#e9edf2', accent: '#FFD000' } }),
    S('Aéroport International – Terminal 2 (Ouest)', { passengers: 34, theme: { wall: '#eef0f3', accent: '#FFD000' } }),
    S('Zone Cargo & Fret', { passengers: 14, theme: { wall: '#3a3f46', accent: '#FFD000' } }),
    S('Parc des Expositions', { distanceToNext: 0, passengers: 28, theme: { wall: '#2b3140', accent: '#FFD000' } }),
  ],
};
delete raw.service;
const st0 = raw.stations, half = 45, PAD = 25;
const build = () => { const l = normalizeLine(raw); return { l, g: new TrackGeometry(l) }; };
const at = (b, i) => ({ p: b.g.point(b.g.stationS[i]), h: b.g.heading(b.g.stationS[i]), s: b.g.stationS[i] });
// Terminal 1 sits between the two airport stations, 140 m north of them; Line D leaves southwards.
const T1 = { x: (aAir.x + bAir.x) / 2, z: Math.min(aAir.z, bAir.z) - 140 };
{ const p = at(build(), 0).p; raw.map.origin = [T1.x - p.x, T1.z - p.z]; }
// T1 → T2: under the terminals, turning west.
st0[0].track = [st(120), curve(rad(70), 420), st(280)];
st0[0].distanceToNext = half + PAD + 120 + curve(rad(70), 420).length + 280 + half + PAD;
// T2 → Cargo: a long sweep round the south of the airfield, back to the east.
st0[1].track = [st(180), curve(rad(-165), 480), st(400)];
st0[1].distanceToNext = Math.round((half + PAD + 180 + curve(rad(-165), 480).length + 400 + half + PAD) * 10) / 10;
// Cargo → Parc des Expositions: arc–straight–arc onto Line B's station, platforms parallel to Line B.
const hP = pde.h + Math.PI, R = 500;
let aim = { x: pde.p.x, z: pde.p.z };
for (let it = 0; it < 6; it++) {
  const b = build(); const c = at(b, 2);
  const E = b.g.point(c.s + half + PAD), d = dirOf(hP);
  const sol = solveASA(E, c.h, { x: aim.x - d.x * (half + PAD), z: aim.z - d.z * (half + PAD) }, hP, R);
  st0[2].track = asaTrack(sol, R);
  st0[2].distanceToNext = Math.round((half + PAD + asaLen(sol, R) + half + PAD) * 10) / 10;
  const q = at(build(), 3).p, ex = pde.p.x - q.x, ez = pde.p.z - q.z;
  console.log('PdE iteration', it, 'error', Math.hypot(ex, ez).toFixed(2), 'turns', deg(sol.phi1).toFixed(1), deg(sol.phi2).toFixed(1));
  if (Math.hypot(ex, ez) < 0.5) break;
  aim = { x: aim.x + ex, z: aim.z + ez };
}
const fin = build();
fin.l.stations.forEach((s, i) => { const p = at(fin, i).p; console.log(s.name.padEnd(46), p.x.toFixed(0), p.z.toFixed(0)); });
console.log('to Line A', Math.hypot(at(fin, 0).p.x - aAir.x, at(fin, 0).p.z - aAir.z).toFixed(0), 'm, to Line B', Math.hypot(at(fin, 0).p.x - bAir.x, at(fin, 0).p.z - bAir.z).toFixed(0), 'm; distances', st0.map((s) => s.distanceToNext).join(', '));
raw.map.origin = raw.map.origin.map((v) => Math.round(v * 100) / 100);
fs.writeFileSync(new URL('../src/data/lines/grandville-d.json', import.meta.url), JSON.stringify(raw, null, 1));
