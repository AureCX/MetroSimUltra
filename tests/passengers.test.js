import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { normalizeLine, expandServices } from '../src/lines/LineSchema.js';
import { TrackGeometry } from '../src/lines/TrackGeometry.js';
import { Route } from '../src/lines/Route.js';
import { EventBus } from '../src/core/EventBus.js';
import { deriveTrainSpecs } from '../src/physics/TrainPhysics.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../src/data/${p}`, import.meta.url)));

test('passengers: empty train at the first station, full evacuation and no boarding at the terminus', async () => {
  globalThis.document ??= { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) };
  const { PassengerSystem } = await import('../src/world/Passengers.js');
  for (const file of ['lines/grandville-a.json', 'lines/grandville-c.json', 'lines/grandville-d.json']) {
    const line = normalizeLine(expandServices(read(file))[0]);
    const route = new Route(line, new TrackGeometry(line), 'A');
    const bus = new EventBus();
    const ps = new PassengerSystem(new THREE.Scene(), line, { A: route }, route, bus);
    const specs = deriveTrainSpecs(read('trains/mx80-classic.json'));
    const train = { specs, front: 0, doors: { sides: { left: { amount: 1 }, right: { amount: 1 } } }, doorOffsets: () => [10, 30, 50] };
    const sm = { atStop: 0 };
    ps.train = train; ps.stationManager = sm;
    const at = (k) => { sm.atStop = k; train.front = route.stops[k].stopR; ps.update(0.1, train.front); ps.onDoorsOpen(); };
    at(0);
    assert.equal(ps.crowds.get(0).alighting.length, 0, `${file}: nobody gets off a train that starts empty`);
    ps.onboard = 120; // passengers picked up along the line
    const last = route.stops.length - 1;
    at(last);
    const c = ps.crowds.get(last);
    assert.equal(ps.onboard, 0, `${file}: everyone alights at the terminus`);
    assert.equal(c.people.filter((p) => p.assigned).length, 0, `${file}: nobody boards a terminating train`);
    assert.equal(ps.terminating, true);
  }
});
