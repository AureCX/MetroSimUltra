import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RoadNetwork, pathAt } from '../src/bus/RoadNetwork.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../src/data/bus/${p}`, import.meta.url)));
const net = new RoadNetwork(read('networks/grandville-est.json'));

test('every route builds a continuous lane-level path through all its stops', () => {
  for (const f of fs.readdirSync(new URL('../src/data/bus/routes/', import.meta.url))) {
    const r = read(`routes/${f}`);
    const stops = r.stops.map((s) => net.stopByName(s.name));
    assert.ok(stops.every(Boolean), `${f}: all stops exist`);
    for (const list of [stops, [...stops].reverse()]) {
      const rt = net.buildRoute(list);
      assert.equal(rt.stops.length, list.length, `${f}: stop positions`);
      for (let i = 1; i < rt.stops.length; i++) assert.ok(rt.stops[i].s > rt.stops[i - 1].s, `${f}: stops in order`);
      for (let i = 1; i < rt.links.length; i++) {
        const a = rt.links[i - 1].path.points.at(-1), b = rt.links[i].path.points[0];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.01, `${f}: links connect`);
      }
    }
  }
});

test('traffic signals never show green to crossing approaches at the same time', () => {
  const n = [...net.nodes.values()].find((x) => x.signal);
  const ew = net.dir(n.edges.find((e) => Math.abs(e.dx) > 0.9), true), ns = net.dir(n.edges.find((e) => Math.abs(e.dz) > 0.9), true);
  for (let t = 0; t < 120; t += 0.5) assert.ok(!(net.signalState(n, ew, t) !== 'red' && net.signalState(n, ns, t) !== 'red'));
});

test('roundabout paths circulate anticlockwise (keep the island on the left)', () => {
  const rb = [...net.nodes.values()].find((x) => x.roundabout);
  const [e1, e2] = rb.edges;
  const a = net.lanePath(e1, e1.b === rb, 0), b = net.lanePath(e2, e2.a === rb, 0);
  const t = net.turnPath(rb, a, b);
  const p = pathAt(t.path, t.path.length * 0.5);
  const cross = (p.x - rb.x) * p.dz - (p.z - rb.z) * p.dx; // >0: centre on the left when viewed from above (z down)
  assert.ok(cross < 0 || cross > 0);
  const p1 = pathAt(t.path, t.path.length * 0.45), p2 = pathAt(t.path, t.path.length * 0.55);
  const a1 = Math.atan2(-(p1.z - rb.z), p1.x - rb.x), a2 = Math.atan2(-(p2.z - rb.z), p2.x - rb.x);
  let da = a2 - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
  assert.ok(da > 0, 'angle increases = anticlockwise from above');
});

import { BusPhysics } from '../src/bus/BusPhysics.js';
const spec = read('vehicles/urbano12.json');
const sys = () => ({ engineOn: true, gearSel: 'D', parking: false, doorBrake: false, airPressure: 8.5 });

test('bus accelerates progressively and needs realistic stopping distance', () => {
  const b = new BusPhysics(spec);
  let t = 0;
  while (b.vx * 3.6 < 50 && t < 60) { b.step(1 / 60, { throttle: 1, brake: 0, wheelTarget: 0 }, sys()); t += 1 / 60; }
  assert.ok(t > 12 && t < 32, `0-50 km/h in ${t.toFixed(1)} s`);
  const x0 = Math.hypot(b.x, b.z);
  while (b.vx > 0) b.step(1 / 60, { throttle: 0, brake: 1, wheelTarget: 0 }, sys());
  const d = Math.hypot(b.x, b.z) - x0;
  assert.ok(d > 15 && d < 35, `full braking from 50 km/h: ${d.toFixed(1)} m`);
});

test('wet road lengthens braking distance; door brake holds the bus', () => {
  const dist = (mu) => { const b = new BusPhysics(spec); b.mu = mu; b.vx = 50 / 3.6; let d = 0; while (b.vx > 0) { b.step(1 / 60, { throttle: 0, brake: 1, wheelTarget: 0 }, sys()); d += b.vx / 60; } return d; };
  assert.ok(dist(0.28) > dist(0.85) * 1.5);
  const b = new BusPhysics(spec);
  for (let i = 0; i < 300; i++) b.step(1 / 60, { throttle: 1, brake: 0, wheelTarget: 0 }, { ...sys(), doorBrake: true });
  assert.equal(b.vx, 0);
});

test('turning at speed rolls the body and the bus follows the steering', () => {
  const b = new BusPhysics(spec); b.vx = 30 / 3.6;
  for (let i = 0; i < 240; i++) b.step(1 / 60, { throttle: 0.3, brake: 0, wheelTarget: 6 }, sys());
  assert.ok(b.yaw > 0.3, `yaw ${b.yaw}`);
  assert.ok(Math.abs(b.roll) > 0.005);
});

import { normalizeRoute, RouteError } from '../src/bus/RouteSchema.js';
test('the example route from the brief imports; unknown stops are rejected', () => {
  const nets = [read('networks/grandville-est.json')];
  const r = normalizeRoute({ route: 'B12', name: 'Airport Express', color: '#E6B800', stops: [{ name: 'Aéroport International – Terminal 1 (Est)', dwellTime: 30 }, { name: 'Aéroport International – Terminal 2 (Ouest)', dwellTime: 25 }] }, nets);
  assert.equal(r.route, 'B12');
  assert.throws(() => normalizeRoute({ route: 'X', stops: [{ name: 'Nowhere' }, { name: 'Elsewhere' }] }, nets), RouteError);
});

test('terrain: piecewise profile, gradient along the direction of travel', async () => {
  const { Terrain } = await import('../src/bus/Terrain.js');
  const t = new Terrain({ axis: 'z', profile: [[620, 0], [920, 9], [1210, 18]] });
  assert.equal(t.heightAt(0, 100), 0);
  assert.equal(t.heightAt(0, 770), 4.5);
  assert.equal(t.heightAt(0, 5000), 18);
  assert.ok(Math.abs(t.gradeAt(0, 770, 0, 1) - 30) < 1e-6, 'uphill southwards: +30 ‰');
  assert.ok(Math.abs(t.gradeAt(0, 770, 0, -1) + 30) < 1e-6, 'downhill northwards');
  assert.equal(new Terrain(undefined).flat, true);
});
