import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Economy, START_BALANCE } from '../src/economy/Economy.js';

const mkSave = () => ({ data: {}, save() {} });
const catalog = { train: [{ id: 'mx80', name: 'MX-80', price: 120000, serviceIntervalKm: 400 }, { id: 'nv24', name: 'NV-24', price: 260000 }], bus: [{ id: 'urbano12', name: 'Urbano 12', price: 60000 }] };

test('economy: starter balance and fleet with unique IDs', () => {
  const e = new Economy(mkSave(), catalog);
  assert.equal(e.balance, START_BALANCE);
  assert.deepEqual(e.fleet.map((v) => v.uid), ['MX80-001', 'BUS-URBANO12-001']);
});

test('economy: purchases are refused without enough money, IDs stay unique', () => {
  const e = new Economy(mkSave(), catalog);
  const r = e.buy('train', 'nv24');
  assert.equal(r.ok, false);
  assert.equal(e.owned('train').length, 1);
  e.d.balance = 300000;
  assert.equal(e.buy('train', 'mx80').vehicle.uid, 'MX80-002');
  assert.equal(e.balance, 180000);
});

test('economy: run settlement rewards quality and charges penalties; repairs cost money', () => {
  const e = new Economy(mkSave(), catalog);
  const good = e.settleMetro({ completed: true, score: 950, distanceKm: 20, stationsServed: 24, carried: 600, punctuality: 1, penalties: [], uid: 'MX80-001' });
  const bad = e.settleMetro({ completed: true, score: 300, distanceKm: 20, stationsServed: 24, carried: 600, punctuality: 0.2, missed: 2, penalties: [{ text: 'Collision', points: 200, count: 1 }], uid: 'MX80-001' });
  assert.ok(good.total > bad.total + 1000);
  const v = e.wear('MX80-001', { km: 20, crash: true });
  assert.ok(v.condition < 0.7);
  const before = e.balance, cost = e.repairCost(v);
  assert.ok(e.repair('MX80-001').ok);
  assert.equal(e.balance, before - cost);
  assert.equal(v.condition, 1);
});
