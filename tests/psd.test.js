import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlatformDoorSide, trainDoorOffsets } from '../src/world/PlatformDoors.js';
import { deriveTrainSpecs } from '../src/physics/TrainPhysics.js';
import fs from 'node:fs';

const mk = () => new PlatformDoorSide(new THREE.Group(), { x: -1, facing: 1, doorZ: [-20, 0, 20], Lp: 90, doorWidth: 1.9, platformY: 0.95, id: 't' });
const run = (d, secs, ctx) => { let ev = []; for (let t = 0; t < secs; t += 0.05) { const e = d.update(0.05, ctx); if (e) ev.push(e); } return ev; };

test('platform doors: open, close and lock; not locked while moving', () => {
  const d = mk();
  assert.equal(d.locked, true);
  d.open(); run(d, 1, {}); assert.equal(d.locked, false);
  run(d, 3, {}); assert.equal(d.state, 'open');
  d.close(); const ev = run(d, 6, { obstructed: () => false });
  assert.ok(ev.includes('locked')); assert.equal(d.locked, true); assert.equal(d.amount, 0);
});

test('platform doors: obstruction reopens, persistent obstruction is a fault that blocks departure until reset', () => {
  const d = mk();
  d.open(); run(d, 3, {}); d.close();
  const ev = run(d, 30, { obstructed: () => true });
  assert.ok(ev.includes('obstructed'));
  assert.ok(ev.includes('fault'));
  assert.equal(d.locked, false);
  assert.equal(d.open(), false, 'no command accepted while faulty');
  d.reset(); assert.equal(d.open(), true);
});

test('platform door openings line up with every train door of each formation', () => {
  for (const f of fs.readdirSync(new URL('../src/data/trains/', import.meta.url))) {
    const sp = deriveTrainSpecs(JSON.parse(fs.readFileSync(new URL(`../src/data/trains/${f}`, import.meta.url))));
    const offs = trainDoorOffsets(sp);
    assert.equal(offs.length, sp.doorList ? sp.doorList.length : sp.cars * sp.doorsPerSide, f);   // power cars have no passenger doors
    for (let i = 1; i < offs.length; i++) assert.ok(offs[i] - offs[i - 1] > sp.doorWidth, `${f}: doors do not overlap`);
  }
});
