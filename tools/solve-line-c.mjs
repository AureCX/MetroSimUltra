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
const curve = (angle, R, extra = {}) => ({ length: Math.max(20, Math.round(Math.abs(angle) * R)), radius: R, turn: angle >= 0 ? 'right' : 'left', ...extra });

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
    S('Gare Centrale', 'vault', { passengers: 40, platformLength: 120, platformWidth: 5.5, theme: { wall: '#e9e2cf', accent: '#00DDF5' } }),
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
// Free tail: a gentle curve to Palais Royal, then the loop round towards Opéra.
st0[5].distanceToNext = 1150; st0[5].track = [st(150), curve(rad(-25), 1400), st(200, 12)];
st0[6].distanceToNext = 1350; st0[6].track = [st(80), curve(rad(-150), 300), st(150)];
const fin = build();
for (const name of Object.keys(T)) { const q = at(fin, name).p; console.log(name.padEnd(18), 'error', Math.hypot(q.x - T[name].x, q.z - T[name].z).toFixed(2), 'm'); }
// Palais Royal is shown with Line A on the plan: walking connection to the nearest Line A station.
const pr = at(fin, 'Palais Royal').p, op = at(fin, 'Opéra').p;
const A = normalizeLine(read('grandville-a')), gA = new TrackGeometry(A);
const near = A.stations.map((s, i) => ({ name: s.name, d: Math.hypot(gA.point(gA.stationS[i]).x - pr.x, gA.point(gA.stationS[i]).z - pr.z) })).sort((x, y) => x.d - y.d)[0];
st0[6].connections = [near.name];
console.log('Palais Royal → nearest Line A station:', near.name, near.d.toFixed(0), 'm;  Opéra at', op.x.toFixed(0), op.z.toFixed(0));
console.log('distances', st0.map((s) => s.distanceToNext).join(', '), 'clipped', fin.l.stations.filter((s) => s.trackClipped).map((s) => s.name));
raw.map.origin = raw.map.origin.map((v) => Math.round(v * 100) / 100); raw.map.heading = Math.round(raw.map.heading * 1000) / 1000;
fs.writeFileSync(new URL('../src/data/lines/grandville-c.json', import.meta.url), JSON.stringify(raw, null, 1));
