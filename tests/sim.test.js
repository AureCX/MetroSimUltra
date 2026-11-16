import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLine, LineValidationError } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';
import { Route } from '../src/lines/Route.js';
import { TrainPhysics, deriveTrainSpecs } from '../src/physics/TrainPhysics.js';
import { PlayerTrain } from '../src/driving/PlayerTrain.js';
import { SignalSystem } from '../src/signaling/SignalSystem.js';
import { StationManager } from '../src/stations/StationManager.js';
import { Timetable } from '../src/stations/Timetable.js';
import { EventBus } from '../src/core/EventBus.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../public/${p}`, import.meta.url)));
const train = deriveTrainSpecs(read('trains/mx80-classic.json'));
const settings = { v: { 'gameplay.atp': true, 'gameplay.vigilance': false, 'gameplay.stopTolerance': 1.5 }, get(k) { return this.v[k]; } };

function setup(file = 'lines/paris-line1-sample.json', dir = 'A') {
  const line = normalizeLine(read(file));
  const geom = new TrackGeometry(line);
  return { line, geom, route: new Route(line, geom, dir) };
}

test('minimal example line from the brief imports', () => {
  const line = normalizeLine(read('lines/example-minimal.json'));
  assert.equal(line.stations.length, 3);
  assert.equal(line.color, '#FFCC00');
  assert.equal(line.stations[1].speedLimit, 60);
});

test('invalid lines are rejected with readable errors', () => {
  assert.throws(() => normalizeLine({ line: 'x', stations: [{ name: 'a' }] }), LineValidationError);
  assert.throws(() => normalizeLine({ line: 'x', stations: [{ name: 'a', distanceToNext: 20 }, { name: 'b' }] }), /distanceToNext/);
});

test('all built-in lines build in both directions', () => {
  for (const f of read('lines/index.json').lines) {
    const { line, geom } = setup(`lines/${f}`);
    for (const d of ['A', 'B']) {
      const r = new Route(line, geom, d);
      assert.equal(r.stops.length, line.stations.length);
      for (let k = 1; k < r.stops.length; k++) assert.ok(r.stops[k].stopR > r.stops[k - 1].stopR, `${f} ${d} stops ordered`);
      const tt = new Timetable(r, train, line.startTime);
      for (let k = 1; k < tt.entries.length; k++) assert.ok(tt.entries[k].arr > (tt.entries[k - 1].dep ?? 0));
    }
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
