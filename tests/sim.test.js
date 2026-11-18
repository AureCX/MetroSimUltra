import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLine, expandServices, LineValidationError } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';
import { Route } from '../src/lines/Route.js';
import { TrainPhysics, deriveTrainSpecs } from '../src/physics/TrainPhysics.js';
import { PlayerTrain } from '../src/driving/PlayerTrain.js';
import { SignalSystem } from '../src/signaling/SignalSystem.js';
import { StationManager } from '../src/stations/StationManager.js';
import { Timetable } from '../src/stations/Timetable.js';
import { EventBus } from '../src/core/EventBus.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../src/data/${p}`, import.meta.url)));
const lineFiles = fs.readdirSync(new URL('../src/data/lines/', import.meta.url)).filter((f) => f.endsWith('.json'));
const train = deriveTrainSpecs(read('trains/mx80-classic.json'));
const settings = { v: { 'gameplay.atp': true, 'gameplay.vigilance': false, 'gameplay.stopTolerance': 1.5 }, get(k) { return this.v[k]; } };

function setup(file = 'lines/grandville-a.json', dir = 'A', service = 0) {
  const line = normalizeLine(expandServices(read(file))[service]);
  const geom = new TrackGeometry(line);
  return { line, geom, route: new Route(line, geom, dir) };
}

test('minimal example line from the brief imports', () => {
  const line = normalizeLine(read('example-minimal.json'));
  assert.equal(line.stations.length, 3);
  assert.equal(line.color, '#FFCC00');
  assert.equal(line.stations[1].speedLimit, 60);
});

test('invalid lines are rejected with readable errors', () => {
  assert.throws(() => normalizeLine({ line: 'x', stations: [{ name: 'a' }] }), LineValidationError);
  assert.throws(() => normalizeLine({ line: 'x', stations: [{ name: 'a', distanceToNext: 20 }, { name: 'b' }] }), /distanceToNext/);
});

test('all built-in lines build in both directions', () => {
  for (const f of lineFiles) for (let svc = 0; svc < expandServices(read(`lines/${f}`)).length; svc++) {
    const { line, geom } = setup(`lines/${f}`, 'A', svc);
    for (const d of ['A', 'B']) {
      const r = new Route(line, geom, d);
      assert.equal(r.stops.length, line.stations.length);
      for (let k = 1; k < r.stops.length; k++) assert.ok(r.stops[k].stopR > r.stops[k - 1].stopR, `${f} ${d} stops ordered`);
      const tt = new Timetable(r, train, line.startTime);
      for (let k = 1; k < tt.entries.length; k++) assert.ok(tt.entries[k].arr > (tt.entries[k - 1].dep ?? 0));
    }
  }
});

test('branching line B expands into two services sharing the trunk', () => {
  const svcs = expandServices(read('lines/grandville-b.json')).map((r) => normalizeLine(r));
  assert.deepEqual(svcs.map((l) => l.stations.at(-1).name), ['Bellevue – Centre', 'Aéroport Est']);
  const [g1, g2] = svcs.map((l) => new TrackGeometry(l));
  const i = svcs[0].stations.findIndex((s) => s.name === 'Parc Monceau');
  const p1 = g1.point(g1.stationS[i]), p2 = g2.point(g2.stationS[i]);
  assert.ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) < 0.01, 'trunk identical');
  const a = normalizeLine(read('lines/grandville-a.json')), ga = new TrackGeometry(a);
  for (const name of ['République', 'Gare Centrale']) {
    const pa = ga.point(ga.stationS[a.stations.findIndex((s) => s.name === name)]);
    const pb = g1.point(g1.stationS[svcs[0].stations.findIndex((s) => s.name === name)]);
    assert.ok(Math.hypot(pa.x - pb.x, pa.z - pb.z) < 5, `${name} shared on the map`);
  }
});

test('train never accelerates instantaneously and reaches 50 km/h progressively', () => {
  const { route } = setup();
  const p = new TrainPhysics(train, route);
  p.s = 1000;
  p.setCommand(1, 0, false);
  for (let i = 0; i < 12; i++) p.step(1 / 120);
  assert.ok(p.v < 0.05, `v after 0.1 s = ${p.v}`);
  let t = 0;
  while (p.v * 3.6 < 50 && t < 60) { p.step(1 / 120); t += 1 / 120; }
  assert.ok(t > 10 && t < 30, `0-50 km/h took ${t.toFixed(1)} s`);
});

test('service brake stops within a realistic distance; EB is shorter', () => {
  const { route } = setup();
  const stopDist = (eb) => {
    const p = new TrainPhysics(train, route);
    p.s = 2000; p.v = 60 / 3.6;
    p.setCommand(0, eb ? 0 : 1, eb);
    const s0 = p.s;
    let t = 0;
    while (p.v > 0 && t < 120) { p.step(1 / 120); t += 1 / 120; }
    return p.s - s0;
  };
  const service = stopDist(false), emergency = stopDist(true);
  assert.ok(service > 110 && service < 190, `service ${service.toFixed(1)} m`);
  assert.ok(emergency < service, `EB ${emergency.toFixed(1)} m`);
});

test('traction is cut while doors are open', () => {
  const { route } = setup();
  const bus = new EventBus();
  const pt = new PlayerTrain(train, route, bus, settings);
  pt.physics.s = route.stops[0].stopR;
  pt.doors.sides.right.state = 'open';
  pt.controller.set(4);
  for (let i = 0; i < 600; i++) pt.update(1 / 120, { staticLimit: 70, authorityDist: null, brakeRate: 0.85 });
  assert.equal(pt.speed, 0);
  assert.ok(pt.tractionCut);
});

test('block signals show red behind a train and yellow before it', () => {
  const { line, route } = setup();
  const bus = new EventBus();
  const sig = new SignalSystem(route, line, bus);
  const i0 = sig.signals.findIndex((s, k) => k > 2 && sig.signals[k + 1] && sig.signals[k + 1].r - s.r > 130);
  const mid = sig.signals[i0];
  sig.update([{ front: mid.r + 120, rear: mid.r + 45 }], { front: 0, rear: -70 });
  const i = sig.signals.indexOf(mid);
  assert.equal(sig.signals[i].aspectOthers, 'red');
  assert.equal(sig.signals[i - 1].aspectOthers, 'yellow');
  assert.equal(sig.signals[i - 2].aspectOthers, 'green');
  assert.equal(sig.authority, mid.r - 3);
});

test('station manager detects a precise stop and authorises departure after dwell', () => {
  const { route, line } = setup();
  const bus = new EventBus();
  const pt = new PlayerTrain(train, route, bus, settings);
  const tt = new Timetable(route, train, line.startTime);
  const sm = new StationManager(route, tt, pt, bus, settings);
  const events = [];
  bus.on('*', (t, e) => events.push([t, e]));
  pt.physics.s = route.stops[0].stopR;
  sm.update(0.1, tt.start - 30);
  pt.physics.s = route.stops[1].stopR + 0.4; pt.physics.v = 0;
  sm.atStop = null; sm.nextStop = 1;
  sm.update(0.1, tt.entry(1).arr);
  const arr = events.find(([t]) => t === 'station:arrived');
  assert.ok(arr, 'arrived');
  assert.ok(Math.abs(arr[1].error - 0.4) < 1e-6);
  assert.equal(sm.alignment().ok, true);
  assert.equal(sm.alignment().side, route.stops[1].doorSide);
  pt.doors.sides.right.state = 'open'; pt.doors.sides.right.amount = 1;
  for (let i = 0; i < 400; i++) sm.update(0.1, tt.entry(1).arr + i * 0.1);
  assert.ok(sm.dwell.authorized);
});

test('speed limits rise only when the tail clears', () => {
  const { route } = setup();
  const L = route.limits;
  let r = 0;
  for (let i = Math.ceil(route.stops[1].stopR); i < L.length - 1; i++) if (L[i + 1] > L[i]) { r = i + 1; break; }
  assert.ok(r > 0);
  assert.equal(route.permittedFor(r + 10, 80), L[r - 1]);
  assert.equal(route.permittedFor(r + 81, 80), Math.min(...Array.from(L.slice(r, r + 82))));
});

test('a junction with no route set holds the movement authority before the points', () => {
  const line = normalizeLine(expandServices(read('lines/grandville-b.json'))[0]);
  const route = new Route(line, new TrackGeometry(line), 'A');
  const sig = new SignalSystem(route, line, new EventBus());
  sig.hold = 5770;
  sig.update([], { front: 5000, rear: 4900 });
  assert.equal(sig.authority, 5770);
  sig.hold = null;
  sig.update([], { front: 5000, rear: 4900 });
  assert.ok(sig.authority > 5770);
});

test('Line C: one-way terminal loop closes on itself and returns on the other track', async () => {
  const fs = await import('node:fs');
  const raw = JSON.parse(fs.readFileSync(new URL('../src/data/lines/grandville-c.json', import.meta.url)));
  const line = normalizeLine(raw);
  assert.ok(line.loop, 'loop expanded');
  const names = line.stations.map((s) => s.name);
  assert.deepEqual(names.slice(4, 9), ['République', 'Gare Centrale', 'Palais Royal', 'Opéra', 'République']);
  assert.equal(names.at(-1), 'Grandville Nord');
  const g = new TrackGeometry(line);
  const route = new Route(line, g, 'A');
  // The return platform of every trunk station is the twin of its outbound one: same place, other track.
  for (const s of line.stations.filter((x) => x.mirrorOf != null)) {
    const a = g.point(g.stationS[s.mirrorOf]), b = g.point(g.stationS[s.index]);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.5, `${s.name} twin`);
    const ra = route.point(route.stops[s.mirrorOf].centerR), rb = route.point(route.stops[s.index].centerR);
    const d = Math.hypot(ra.x - rb.x, ra.z - rb.z);
    assert.ok(d > 3 && d < 12, `${s.name}: tracks ${d.toFixed(2)} m apart`);
  }
  // The circuit is continuous (no jumps along the train's path).
  let max = 0;
  for (let r = 1; r < route.length; r += 1) { const p = route.point(r - 1), q = route.point(r); max = Math.max(max, Math.abs(Math.hypot(p.x - q.x, p.z - q.z) - 1)); }
  assert.ok(max < 0.08, `max step error ${max.toFixed(3)}`);
  assert.equal(route.stops.at(-1).name, 'Grandville Nord');
  assert.ok(g.loop.closure < 3, `closure ${g.loop.closure}`);
});

test('Line D (Aéroval) shares Parc des Expositions with Line B and connects to Lines A and B at Terminal 1', () => {
  const d = normalizeLine(read('lines/grandville-d.json'));
  assert.deepEqual(d.stations.map((s) => s.name), ['Aéroport International – Terminal 1 (Est)', 'Aéroport International – Terminal 2 (Ouest)', 'Zone Cargo & Fret', 'Parc des Expositions']);
  assert.deepEqual(d.stations[0].connections, ['Aéroport International', 'Aéroport Est']);
  const gd = new TrackGeometry(d), pd = gd.point(gd.stationS[3]);
  const b = normalizeLine(expandServices(read('lines/grandville-b.json'))[1]), gb = new TrackGeometry(b);
  const pb = gb.point(gb.stationS[b.stations.findIndex((s) => s.name === 'Parc des Expositions')]);
  assert.ok(Math.hypot(pd.x - pb.x, pd.z - pb.z) < 6);
});
