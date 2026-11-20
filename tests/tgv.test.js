// Main-line (TGV) network: line data, journey times, timetable statuses, rail economy, end-to-end run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLine } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';
import { Route } from '../src/lines/Route.js';
import { deriveTrainSpecs } from '../src/physics/TrainPhysics.js';
import { Timetable } from '../src/stations/Timetable.js';
import { TgvTimetable, fmt } from '../src/rail/TgvTimetable.js';
import { RailTerrain, COUNTRY } from '../src/rail/RailTerrain.js';
import { Economy } from '../src/economy/Economy.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../src/data/${p}`, import.meta.url)));
const DEST = { montreval: 35, valdor: 55, clairmont: 70, 'saint-roch-les-alpes': 80, 'belle-rive': 105, 'port-azur': 135 };
const lines = Object.keys(DEST).map((k) => normalizeLine(read(`lines/tgv-${k}.json`)));
const duplex = deriveTrainSpecs(read('trains/tgv-duplex.json'));

test('six TGV services leave Gare Centrale on their own track and reach their destination on time', () => {
  for (const l of lines) {
    assert.equal(l.category, 'hst');
    assert.equal(l.stations[0].name, 'Gare Centrale');
    const g = new TrackGeometry(l), r = new Route(l, g, 'A');
    const p = g.point(g.stationS[0]);
    assert.ok(Math.abs(p.x - 3570) < 1 && Math.abs(p.z - (220 + (l.rail.slot - 2.5) * 22)) < 1, `${l.id} sits on its shed slot`);
    const tt = new Timetable(r, duplex, '06:30:00');
    const arr = (tt.entry(r.stops.length - 1).arr - tt.start) / 60;
    const want = DEST[l.id.replace('tgv-', '')];
    assert.ok(Math.abs(arr - want) <= 1.5, `${l.id}: ${arr.toFixed(1)} min, expected ≈ ${want}`);
    assert.ok(g.length > 100000, 'a real main line (> 100 km)');
  }
});

test('the line profile follows the country: gradients ≤ 35 ‰, stations at ground level, tunnels in the mountains', () => {
  const T = new RailTerrain(COUNTRY);
  for (const l of lines) {
    const g = new TrackGeometry(l);
    let maxGrad = 0;
    for (let s = 200; s < g.length - 200; s += 100) maxGrad = Math.max(maxGrad, Math.abs(g.gradientAt(s)));
    assert.ok(maxGrad <= 36, `${l.id}: max gradient ${maxGrad.toFixed(1)} ‰`);
    l.stations.forEach((st, i) => { if (!i) return; const p = g.point(g.stationS[i]); assert.ok(Math.abs(p.y - T.height(p.x, p.z)) < 3, `${st.name} at ground level`); });
  }
  const alps = lines.find((l) => l.id === 'tgv-saint-roch-les-alpes');
  assert.ok(alps.rail.tunnels.length >= 3 && lines.find((l) => l.id === 'tgv-port-azur').rail.tunnels.length >= 20, 'tunnels through the Alps');
});

test('timetable: brief departures, train numbers, platforms, durations and statuses', () => {
  const tt = new TgvTimetable(lines, 3);
  const dep = (h, dest) => tt.services.find((s) => s.kind === 'dep' && fmt(s.time) === h && s.destination === dest);
  for (const [h, d] of [['06:30', 'Montreval'], ['07:15', 'Valdor'], ['08:00', 'Clairmont'], ['09:00', 'Saint-Roch-les-Alpes'], ['10:30', 'Belle-Rive'], ['12:00', 'Port-Azur']]) {
    const sv = dep(h, d);
    assert.ok(sv, `${h} ${d}`);
    assert.ok(sv.no > 6000 && sv.voie >= 1 && sv.voie <= 12 && sv.duration > 30 * 60);
  }
  // Several trains run at the same time (Port-Azur 06:45 is still running when Valdor 07:15 leaves).
  const running = (c) => tt.services.filter((s) => s.kind === 'dep' && c >= s.time && c < s.time + s.duration).length;
  assert.ok(running(7.5 * 3600) >= 2);
  const sv = dep('08:00', 'Clairmont');
  const codes = [sv.time - 3600, sv.time - 600, sv.time + sv.delay + 120].map((c) => tt.status(sv, c).code);
  if (!sv.cancelled) assert.deepEqual(codes, [sv.delay ? 'delayed' : 'ontime', 'boarding', 'departed']);
  const arrival = tt.services.find((s) => s.kind === 'arr');
  assert.equal(tt.status(arrival, arrival.time + arrival.delay + 10).code, arrival.cancelled ? 'cancelled' : 'arrived');
  // Same day → same delays everywhere (boards, menu, platform displays).
  assert.deepEqual(new TgvTimetable(lines, 3).services.map((s) => s.delay), tt.services.map((s) => s.delay));
});

test('rail economy: tickets, punctuality bonus, compensation, hire fee and company-driver runs', () => {
  const save = { data: {}, save() {} };
  const e = new Economy(save, { train: [{ id: 'mx80', price: 120000 }, { id: 'tgv-duplex', name: 'Duplex', price: 520000, serviceIntervalKm: 4000, capacity: 512 }], bus: [{ id: 'urbano12', price: 60000 }] });
  const base = { completed: true, score: 900, distanceKm: 137, carried: 400, capacity: 512, penalties: [] };
  const onTime = e.settleRail({ ...base, finalDelay: 60 });
  const late = e.settleRail({ ...base, finalDelay: 45 * 60 });
  const hired = e.settleRail({ ...base, finalDelay: 60, lease: 2400 });
  assert.ok(onTime.items.some((i) => /Punctuality bonus/.test(i.label)));
  assert.ok(late.items.some((i) => /compensation/.test(i.label)));
  assert.ok(onTime.total > late.total && onTime.total - hired.total === 2400);
  assert.ok(onTime.total > 2000, `a TGV journey pays (${onTime.total} €)`);
  e.d.balance = 600000;
  const v = e.buy('train', 'tgv-duplex').vehicle;
  const r = e.operateRail(v.uid, { no: 6201, destination: 'Montreval', delay: 0 }, { km: 137, capacity: 512, seed: 42 });
  assert.ok(r.ok && typeof r.total === 'number');
  assert.ok(e.vehicle(v.uid).odometer === 137 && e.vehicle(v.uid).condition > 0.95, 'main-line wear is per 4000 km interval');
});

test('a TGV driven automatically from Gare Centrale stops at Montreval on the marker without tripping TVM', async () => {
  const { ATO } = await import('../src/driving/ATO.js');
  const { PlayerTrain } = await import('../src/driving/PlayerTrain.js');
  const { StationManager } = await import('../src/stations/StationManager.js');
  const { SignalSystem } = await import('../src/signaling/SignalSystem.js');
  const { EventBus } = await import('../src/core/EventBus.js');
  const settings = { v: { 'gameplay.atp': true, 'gameplay.vigilance': false, 'gameplay.stopTolerance': 1.5 }, get(k) { return this.v[k]; } };
  const line = lines[0], g = new TrackGeometry(line), route = new Route(line, g, 'A');
  const bus = new EventBus();
  const pt = new PlayerTrain(duplex, route, bus, settings);
  const tt = new Timetable(route, duplex, line.startTime);
  const sm = new StationManager(route, tt, pt, bus, settings);
  const sig = new SignalSystem(route, line, bus);
  sm.boardingPending = () => 0;
  const arrivals = [], trips = [];
  let vmax = 0;
  bus.on('station:arrived', (e) => arrivals.push(e));
  bus.on('safety:emergency', (e) => trips.push(e));
  pt.physics.s = route.stops[0].stopR;
  const ato = new ATO({ player: pt, stations: sm, route, specs: duplex, openDoors: (side) => pt.doors.open(side, { speed: pt.speed, alignment: sm.alignment() }) });
  let clock = tt.start - 30;
  for (let i = 0; i < 60 * 60 * 10 && !sm.finished; i++) {
    const dt = 0.1;
    sig.update([], { front: pt.front, rear: pt.rear });
    ato.step(sig.authority);
    pt.update(dt, { staticLimit: Math.min(route.permittedFor(pt.front, duplex.length), duplex.maxSpeed), authorityDist: sig.authority != null ? sig.authority - pt.front : null, brakeRate: line.signaling.atpBrakeRate });
    sm.update(dt, clock);
    clock += dt; vmax = Math.max(vmax, pt.speed);
  }
  assert.ok(sm.finished, 'reached Montreval');
  assert.equal(arrivals.length, 1);
  assert.ok(Math.abs(arrivals[0].error) < 1.5, `stop error ${arrivals[0].error.toFixed(2)} m`);
  assert.equal(trips.length, 0, 'no emergency brake');
  assert.ok(vmax * 3.6 > 270, `reached high speed (${(vmax * 3.6).toFixed(0)} km/h)`);
  assert.ok((clock - tt.start) / 60 < 42, `journey ${(clock - tt.start) / 60} min`);
});
