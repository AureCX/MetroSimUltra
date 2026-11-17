// Generates src/data/lines/grandville-b.json so that Line B shares République and Gare Centrale
// with Line A on the network map and its airport branch ends next to Aéroport International.
import fs from 'node:fs';
import { normalizeLine, expandServices } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';

const A = normalizeLine(JSON.parse(fs.readFileSync(new URL('../src/data/lines/grandville-a.json', import.meta.url))));
const gA = new TrackGeometry(A);
const posA = (name) => { const i = A.stations.findIndex((s) => s.name === name); return gA.point(gA.stationS[i]); };
const rep = posA('République'), gc = posA('Gare Centrale'), apt = posA('Aéroport International');
const bearing = (a, b) => ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const thetaRG = bearing(rep, gc);
const turnIn = 45;
const c = (length, radius, turn, gradient) => ({ length, radius, turn, ...(gradient ? { gradient } : {}) });
const st = (length, gradient) => ({ length, ...(gradient ? { gradient } : {}) });
const arc = (deg, radius) => Math.round((Math.abs(deg) * Math.PI / 180) * radius);

const S = (name, distanceToNext, speedLimit, stopDuration, style, extra = {}, track) => ({ name, distanceToNext, speedLimit, stopDuration, style, ...extra, ...(track ? { track } : {}) });

const raw = {
  id: 'grandville-b', line: 'Line B', number: 'B', network: 'Grandville Métro', color: '#33E633', textColor: '#111111',
  language: 'fr-FR', maxSpeed: 80, startTime: '08:10:00', headway: 240,
  tunnel: { profile: 'box' },
  map: { origin: [0, 0], heading: thetaRG + turnIn },
  defaults: { platformLength: 110, platformWidth: 6, platformType: 'island', style: 'pillars', approachSpeedLimit: 50, stopDuration: 22 },
  signaling: { system: 'cbtc', atpBrakeRate: 0.9 },
  announcements: { nextStation: 'Prochaine station : {station}.', arrival: '{station}.', terminus: "{station}. Terminus du train. Merci de descendre." },
  stations: [
    S('Grandville Nord', 800, 70, 25, 'modern', { passengers: 24, theme: { wall: '#28362a', accent: '#33E633' } }, [st(300, -15), st(250)]),
    S('Porte des Lilas', 850, 65, 20, 'pillars', { theme: { wall: '#c9b7e0', accent: '#5b2a86' } }, [st(150), c(arc(turnIn, 500), 500, 'left', -10)]),
    S('République', Math.round(dist(rep, gc)), 60, 30, 'vault', { platformType: 'side', platformWidth: 4.5, passengers: 34, theme: { wall: '#f4f1e8', accent: '#8B1E8F' } }, [st(400, -12), st(300, 8)]),
    S('Gare Centrale', 800, 60, 35, 'vault', { platformType: 'side', platformWidth: 5.5, platformLength: 120, passengers: 45, approachSpeedLimit: 45, theme: { wall: '#e9e2cf', accent: '#8B1E8F' } }, [st(120), c(arc(75, 420), 420, 'right')]),
    S('Place du Marché', 750, 65, 20, 'pillars', { theme: { wall: '#e7c36a', accent: '#8a5a00' } }, [st(120), c(arc(30, 500), 500, 'right', 15)]),
    S('Saint-Augustin', 800, 70, 30, 'grand', { platformLength: 120, platformWidth: 8, passengers: 40, theme: { wall: '#efe6d2', accent: '#33E633', vault: '#1b2a4a' } }, [st(350, -10), st(250)]),
    S('Parc Monceau', null, 65, 25, 'modern', { passengers: 26, theme: { wall: '#24402e', accent: '#33E633' } }),
  ],
  branches: [
    { id: 'bellevue', name: 'Bellevue – Centre',
      link: { distanceToNext: 1150, speedLimit: 60, track: [st(60), c(arc(140, 330), 330, 'left')] },
      stations: [
        S('Mairie de Bellevue', 1000, 75, 22, 'vault', { theme: { wall: '#f1ede2', accent: '#b3121b' }, landmark: { type: 'cityHall', side: 'right', offset: 80, along: 700 } }, [st(80), st(250, 40), { length: 180, gradient: 40, portal: 'exit' }, st(190, 40), st(100)]),
        S('Les Vignes', 1100, 80, 20, 'modern', { passengers: 22, theme: { accent: '#556b2f' } }, [st(300), c(400, 1500, 'left')]),
        S('Université Ouest', 1100, 80, 20, 'modern', { passengers: 30, theme: { accent: '#5ab0ff' }, landmark: { type: 'university', side: 'left', offset: 44, along: 0 } }, [st(300), c(400, 1500, 'right')]),
        S('Bellevue – Centre', 0, 60, 30, 'modern', { passengers: 30, theme: { wall: '#30283a', accent: '#33E633' } }),
      ] },
    { id: 'aeroport', name: 'Aéroport Est',
      link: { distanceToNext: 1500, speedLimit: 70, track: [st(80), c(arc(55, 500), 500, 'right')] },
      stations: [
        S("Fort d'Orsay", 1900, 80, 20, 'pillars', { theme: { wall: '#d6a7a0', accent: '#7a2e24' } }, [st(500, -15), st(500)]),
        S('Cité des Sciences', 2000, 80, 25, 'modern', { passengers: 28, theme: { wall: '#1f3b55', accent: '#00b4d8' } }, [st(600), st(500, 12)]),
        S('Parc des Expositions', 1600, 80, 22, 'modern', { passengers: 22, theme: { wall: '#3b3f46', accent: '#ff8c00' } }, []),
        S('Aéroport Est', 0, 60, 30, 'modern', { passengers: 34, platformWidth: 8, connections: ['Aéroport International'], theme: { wall: '#20303f', accent: '#ffc400' } }),
      ] },
  ],
};

const build = (r) => { const svc = expandServices(r); return svc.map((s) => { const l = normalizeLine(s); return { l, g: new TrackGeometry(l) }; }); };
const at = ({ l, g }, name) => { const i = l.stations.findIndex((s) => s.name === name); return { p: g.point(g.stationS[i]), h: (g.heading(g.stationS[i]) * 180) / Math.PI }; };

// 1. Place the origin so République coincides with Line A.
let [b0] = build(raw);
const r0 = at(b0, 'République').p;
raw.map.origin = [rep.x - r0.x, rep.z - r0.z];
// 2. Aim the airport branch's last section at a point 250 m from Aéroport International.
const target = { x: apt.x + 180, z: apt.z - 170 };
for (let it = 0; it < 8; it++) {
  const [, b] = build(raw);
  const pe = at(b, 'Parc des Expositions');
  const need = ((bearing(pe.p, target) - pe.h + 540) % 360) - 180;
  const turn = need >= 0 ? 'right' : 'left';
  const len = Math.max(20, arc(need, 900));
  const pdx = raw.branches[1].stations[2];
  pdx.track = Math.abs(need) < 0.5 ? [] : [st(150), c(len, 900, turn)];
  pdx.distanceToNext = Math.round(dist(pe.p, target) * 1.002 + (Math.abs(need) > 0.5 ? len * 0.004 : 0));
}
const [bb, ba] = build(raw);
const report = (x, n) => { const q = at(x, n); return `${n} (${q.p.x.toFixed(0)}, ${q.p.z.toFixed(0)}) h=${q.h.toFixed(0)}`; };
console.log('A République', rep.x.toFixed(0), rep.z.toFixed(0), '| B', report(bb, 'République'));
console.log('A Gare Centrale', gc.x.toFixed(0), gc.z.toFixed(0), '| B', report(bb, 'Gare Centrale'));
console.log(report(bb, 'Parc Monceau'), '|', report(bb, 'Bellevue – Centre'));
console.log('A Aéroport', apt.x.toFixed(0), apt.z.toFixed(0), '| B', report(ba, 'Aéroport Est'), 'gap', dist(at(ba, 'Aéroport Est').p, apt).toFixed(0), 'm');
console.log('clipped', [...bb.l.stations, ...ba.l.stations].filter((s) => s.trackClipped).map((s) => s.name));
raw.map.origin = raw.map.origin.map((v) => Math.round(v * 10) / 10);
raw.map.heading = Math.round(raw.map.heading * 100) / 100;
fs.writeFileSync(new URL('../src/data/lines/grandville-b.json', import.meta.url), JSON.stringify(raw, null, 1));
