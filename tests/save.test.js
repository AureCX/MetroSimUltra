// Save system: checksummed records with backups, independent per-station checkpoints, error handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveSystem, unwrap } from '../src/core/SaveSystem.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const cp = (station, extra = {}) => ({ network: 'Grandville Grandes Lignes', stationName: station, stopIndex: 1, lineId: 'tgv-saint-roch-les-alpes', direction: 'A', clock: 25000, trainModel: 'tgv-duplex', trainUid: 'TGVDUPLEX-001', onboard: 300, ...extra });

test('save: round trip, checksum and automatic recovery from a corrupted file', () => {
  const st = mem();
  const a = new SaveSystem(st);
  a.data.economy = { balance: 123456 }; assert.ok(a.save().ok);
  a.data.economy.balance = 99; assert.ok(a.save().ok);            // previous good copy goes to the backup
  assert.equal(new SaveSystem(st).data.economy.balance, 99);
  // Truncated write / tampering: the main record fails its checksum → the backup is restored, with a warning.
  st.setItem('metrosim.save.v2', st.getItem('metrosim.save.v2').slice(0, 60));
  const b = new SaveSystem(st);
  assert.equal(b.status, 'recovered');
  assert.equal(b.data.economy.balance, 123456);
  assert.match(b.warning, /restored/);
  // Both copies broken: a fresh career, never a crash.
  st.setItem('metrosim.save.v2', '{bad json'); st.setItem('metrosim.save.v2.bak', 'nope');
  const c = new SaveSystem(st);
  assert.equal(c.status, 'reset'); assert.ok(c.data.records);
});

test('save: each station keeps its own checkpoint and progress; saving one never overwrites another', () => {
  const st = mem(), s = new SaveSystem(st);
  assert.ok(s.saveStation(cp('Montreval', { arrival: true, stopError: 0.4 })).ok);
  assert.ok(s.saveStation(cp('Saint-Roch-les-Alpes', { stopIndex: 2, clock: 28000 })).ok);
  assert.ok(s.saveStation(cp('Montreval', { arrival: true, stopError: -0.2, clock: 26000 })).ok);
  const fresh = new SaveSystem(st);                                    // as after restarting the game
  const mv = fresh.loadStation(SaveSystem.stationId('Grandville Grandes Lignes', 'Montreval'));
  const sr = fresh.loadStation(SaveSystem.stationId('Grandville Grandes Lignes', 'Saint-Roch-les-Alpes'));
  assert.equal(mv.checkpoint.clock, 26000);
  assert.equal(mv.progress.visits, 2); assert.equal(mv.progress.arrivals, 2); assert.equal(mv.progress.bestStopError, -0.2);
  assert.equal(sr.checkpoint.clock, 28000); assert.equal(sr.checkpoint.stopIndex, 2);
  assert.equal(fresh.listStations().length, 2);
  assert.equal(fresh.data.rail.last, mv.id);
  // A damaged station record falls back to its own backup; the other station is unaffected.
  st.setItem(`metrosim.station.${mv.id}`, 'garbage');
  assert.equal(fresh.loadStation(mv.id).checkpoint.clock, 25000);
  assert.equal(fresh.loadStation(sr.id).checkpoint.clock, 28000);
  fresh.deleteStation(sr.id);
  assert.equal(fresh.listStations().length, 1);
});

test('save: storage errors are reported, not thrown', () => {
  const st = mem(); const s = new SaveSystem(st);
  st.setItem = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; };
  const r = s.saveStation(cp('Valdor'));
  assert.equal(r.ok, false); assert.match(r.error, /Storage is full/);
  assert.equal(unwrap('not an envelope'), null);
});
