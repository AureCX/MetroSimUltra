import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BusPhysics } from '../src/bus/BusPhysics.js';
import { resolveImpact, BusDamage, obstacle, severityOf } from '../src/bus/Crash.js';

const spec = JSON.parse(fs.readFileSync(new URL('../src/data/bus/vehicles/urbano12.json', import.meta.url)));
const bus = (v) => { const ph = new BusPhysics(spec); ph.x = 0; ph.z = 0; ph.yaw = 0; ph.vx = v; ph.vy = 0; ph.r = 0; return ph; };
const front = () => spec.wheelbase * 0.58 + spec.frontOverhang;

test('crash: head-on into a wall stops the bus; severity grows with speed', () => {
  const slow = bus(2.4), fast = bus(14);
  const n = { x: 0, z: 1 }; // wall ahead (bus faces −z), pushes the bus back (+z)
  const a = resolveImpact(slow, n, { x: 0, z: -front() }, obstacle('building'));
  const b = resolveImpact(fast, n, { x: 0, z: -front() }, obstacle('building'));
  assert.ok(a && b);
  assert.ok(fast.vx < 2 && fast.vx > -3, `rebound ${fast.vx}`);
  assert.ok(b.dv > a.dv * 3);
  assert.equal(severityOf(a.dv), 'minor');
  assert.ok(['severe', 'major'].includes(severityOf(b.dv)));
});

test('crash: an offset impact makes the bus rotate; a light object barely slows it', () => {
  const ph = bus(10);
  resolveImpact(ph, { x: 0, z: 1 }, { x: 1.2, z: -front() }, obstacle('building'));
  assert.ok(Math.abs(ph.r) > 0.05, `yaw rate ${ph.r}`);
  const p2 = bus(10);
  const r = resolveImpact(p2, { x: 0, z: 1 }, { x: 0, z: -front() }, { ...obstacle('moto'), vx: 0, vz: 0 });
  assert.ok(p2.vx > 9, 'momentum mostly kept against a motorcycle');
  assert.ok(r.otherDv > r.dv * 10);
});

test('crash: damage depends on where it hits and persists', () => {
  const d = new BusDamage(spec);
  const ev = d.apply({ f: front() - 0.1, l: 0 }, 9, 1.2, () => 0.1);
  assert.ok(d.zones.front > 0.5 && d.zones.left === 0);
  assert.ok(ev.events.some((e) => /Windscreen/.test(e)));
  const side = d.apply({ f: front() - spec.doors[1], l: spec.width / 2 - 0.05 }, 7, 1.1, () => 0.9);
  assert.ok(d.zones.right > 0.3);
  assert.ok(d.jammed.includes(1), `jammed ${d.jammed}`);
  const again = new BusDamage(spec, JSON.parse(JSON.stringify(d.state())));
  assert.deepEqual(again.state(), d.state());
  again.repair(1);
  assert.equal(again.any, false); assert.equal(again.jammed.length, 0);
});
