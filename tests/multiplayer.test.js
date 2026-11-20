import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, LIMITS } from '../server/rooms.js';

const setup = () => {
  let t = 1000;
  const hub = new Hub(() => t);
  const conn = () => ({ open: true });
  const a = hub.hello(conn(), { name: 'Alice' }), b = hub.hello(conn(), { name: 'Bob' });
  const s = hub.create(a, { name: 'Test' });
  hub.join(b, { code: s.code });
  hub.drain();
  return { hub, a, b, s, adv: (ms) => { t += ms; } };
};
const msgs = (hub, id, type) => hub.drain().filter((m) => m.to === id && m.msg.t === type).map((m) => m.msg);

test('multiplayer: sessions, join codes, player list and feed', () => {
  let t = 0; const hub = new Hub(() => t);
  const a = hub.hello({}, { name: 'Alice' });
  const s = hub.create(a, { name: 'Grandville' });
  assert.match(s.code, /^[A-Z2-9]{5}$/);
  const b = hub.hello({}, { name: 'Bob' });
  hub.join(b, { code: s.code.toLowerCase() });
  const pl = hub.drain().filter((m) => m.to === b.id && m.msg.t === 'players').at(-1).msg.list;
  assert.deepEqual(pl.map((p) => p.name).sort(), ['Alice', 'Bob']);
  assert.equal(hub.list()[0].players, 2);
  assert.equal(hub.join(b, { code: 'ZZZZZ' }), null);
});

test('multiplayer: the server rejects impossible moves and over-speed', () => {
  const { hub, a, adv } = setup();
  hub.drive(a, { kind: 'train', lineId: 'grandville-a', sourceId: 'grandville-a', dir: 'A', length: 80, maxSpeed: 80 });
  assert.ok(hub.state(a, { s: 300, v: 10 }));
  adv(100);
  assert.equal(hub.state(a, { s: 900, v: 10 }), null, 'teleport rejected');
  assert.equal(msgs(hub, a.id, 'correction').at(-1).s, 300);
  adv(100);
  assert.ok(hub.state(a, { s: 301.5, v: 200 }).v <= 80 / 3.6 * 1.1 + 1, 'speed clamped');
});

test('multiplayer: trains on the same track get a movement authority behind the train ahead', () => {
  const { hub, a, b, adv } = setup();
  for (const p of [a, b]) hub.drive(p, { kind: 'train', lineId: 'grandville-a', sourceId: 'grandville-a', dir: 'A', length: 80, maxSpeed: 80 });
  hub.state(a, { s: 1000, v: 0 }); hub.state(b, { s: 400, v: 10 });
  adv(100); hub.tick();
  const auth = msgs(hub, b.id, 'auth').at(-1);
  assert.equal(auth.s, 1000 - 80 - LIMITS.SAFETY_GAP);
  assert.equal(auth.behind, 'Alice');
  // Other direction: no interaction.
  hub.drive(b, { kind: 'train', lineId: 'grandville-a', sourceId: 'grandville-a', dir: 'B', length: 80, maxSpeed: 80 });
  hub.state(b, { s: 400, v: 0 }); adv(100); hub.tick();
  assert.equal(msgs(hub, b.id, 'auth').at(-1)?.s ?? null, null);
});

test('multiplayer: reconnection with the token resumes the same player in the session', () => {
  const { hub, a, s } = setup();
  hub.disconnect(a);
  const again = hub.hello({}, { name: 'Alice', token: a.token });
  assert.equal(again.id, a.id);
  assert.equal(again.session, s.code);
  assert.equal(hub.drain().find((m) => m.to === a.id && m.msg.t === 'welcome').msg.resumed, true);
});
