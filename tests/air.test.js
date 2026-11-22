// Aviation: flight physics (take-off, climb, stall, autoland for every type), airport layouts (taxi routes at all
// seven airports), ATC (runway occupancy, departure queue, arrival spacing / landing clearance), timetable, AI
// traffic completing flights between airports without ground deadlocks, and the flight economy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS, AIRCRAFT, AIRCRAFT_IDS, hdgVec } from '../src/air/AirData.js';
import { FlightModel, KT, FT } from '../src/air/FlightModel.js';
import { buildAirport } from '../src/air/AirportBuilder.js';
import { ATC } from '../src/air/ATC.js';
import { FlightSchedule, AirTraffic } from '../src/air/AirTraffic.js';
import { airTerrain } from '../src/air/FlightWorld.js';
import { Economy } from '../src/economy/Economy.js';

const calm = { wind: () => ({ dir: 270, speed: 0, gust: 0, turb: 0 }) };
const weather = { wind: () => ({ dir: 280, speed: 6 }), visibility: () => 10000, storm: () => false, stormHere: () => false };

test('every aircraft type takes off, climbs and is controllable', () => {
  for (const id of AIRCRAFT_IDS) {
    const S = AIRCRAFT[id], fm = new FlightModel(S, calm);
    fm.placeOnGround(0, 0, 90); fm.engines.forEach((e) => { e.running = true; e.n1 = 0.21; }); fm.ctl.parking = false; fm.ctl.throttle = 1; fm.flapIdx = fm.flapPos = 2;
    let lift = null;
    for (let t = 0; t < 120; t += 1 / 120) {
      fm.ctl.elev = fm.onGround ? (fm.ias > S.vr ? 0.55 : 0) : fm.out.att.p < 12 ? 0.25 : 0;
      fm.step(1 / 120);
      if (!lift && !fm.onGround) lift = { t, x: fm.pos.x };
      if (fm.out.agl > 300) break;
    }
    assert.ok(lift, `${id} lifts off`);
    assert.ok(lift.t < 60 && lift.x < 2600, `${id} lift-off in ${lift.t.toFixed(0)} s / ${lift.x.toFixed(0)} m`);
    assert.ok(fm.out.agl > 300 && !fm.crashed, `${id} climbs to 1000 ft`);
  }
});

test('stall: lift collapses past the critical angle of attack', () => {
  const fm = new FlightModel(AIRCRAFT.a320, calm);
  fm.placeInFlight(0, 3000, 0, 90, 75); fm.ctl.throttle = 0;
  let stalled = false;
  for (let t = 0; t < 40; t += 1 / 120) { fm.ctl.elev = 1; fm.step(1 / 120); if (fm.stall) stalled = true; }
  assert.ok(stalled, 'stall warning with full back stick at idle');
});

test('autoland: every type flies the ILS and touches down gently on the centreline', () => {
  for (const id of AIRCRAFT_IDS) {
    const S = AIRCRAFT[id], fm = new FlightModel(S, calm);
    const I = { x: 0, z: 0, y: 0, hdg: 90, dx: 1, dz: 0 };
    fm.placeInFlight(-16000, Math.tan(3 * Math.PI / 180) * 16000 + 40, 300, 90, S.vref + 15);
    fm.flapIdx = fm.flapPos = S.flaps.length - 1; fm.gearCmd = fm.gearPos = 1; fm.spoilersArmed = true;
    fm.ap.engage(true); fm.ap.at = true; fm.ap.spd = S.vref + 3; fm.ap.ils = I; fm.ap.appArmed = true; fm.ap.autoland = true;
    let td = null;
    for (let t = 0; t < 400 && !td; t += 1 / 120) { fm.step(1 / 120); for (const e of fm.takeEvents()) if (e.type === 'touchdown' || e.type === 'crash') td = e; }
    assert.ok(td && td.type === 'touchdown', `${id} touches down (${td?.reason || ''})`);
    assert.ok(td.fpm < 400, `${id} touchdown ${td.fpm.toFixed(0)} fpm`);
    assert.ok(Math.abs(fm.pos.z) < 25, `${id} on the centreline (${fm.pos.z.toFixed(1)} m)`);
  }
});

test('seven airports: runways, stands and taxi routes stand ↔ holding point ↔ exits', () => {
  const { elev } = airTerrain();
  for (const ap of AIRPORTS) {
    const L = buildAirport(null, ap, elev[ap.id], { headless: true });
    assert.ok(L.stands.length >= 4, `${ap.id} stands`);
    for (const r of L.runways) for (const d of r.dirs) {
      assert.ok(L.graph.path(L.stands[0].node, d.entryHold), `${ap.id} taxi to holding point ${d.name}`);
      assert.ok(L.graph.path(d.exits[0], L.stands.at(-1).node, false), `${ap.id} exit ${d.name} to stand`);
    }
    assert.ok(Math.abs(airTerrain().terrain.height(ap.x, ap.z) - elev[ap.id]) < 0.01, `${ap.id} flat at its elevation`);
  }
});

test('ATC: runway occupancy, departure queue and arrival spacing', () => {
  const layouts = AIRPORTS.map((ap) => buildAirport(null, ap, 10, { headless: true }));
  const atc = new ATC(layouts, weather), A = atc.of('GRV');
  A.requestDeparture('a'); A.requestDeparture('b');
  assert.equal(A.takeoffClearance('b', 1000).ok, false, 'second in the queue waits');
  assert.equal(A.takeoffClearance('a', 1000).ok, true, 'first cleared');
  assert.equal(A.takeoffClearance('b', 1010).ok, false, 'runway occupied by the departure');
  A.release('a');
  assert.equal(A.takeoffClearance('b', 1030).ok, false, 'spacing with the previous departure');
  assert.equal(A.takeoffClearance('b', 1200).ok, true);
  A.release('b');
  // Arrivals: too close behind → hold; landing clearance only with a free runway.
  A.arrival('x', 5000); A.arrival('y', 8000);
  assert.equal(A.sequenceOk('y'), false, '3 km behind → holding');
  A.arrival('y', 12500); assert.equal(A.sequenceOk('y'), true);
  A.occupy('z', 1300);
  assert.equal(A.landingClearance('x', 1300), false, 'runway occupied → no landing clearance');
  A.release('z'); assert.equal(A.landingClearance('x', 1310), true);
  // Arrival within 6 km blocks departures.
  A.requestDeparture('c'); assert.equal(A.takeoffClearance('c', 2000).ok, false);
});

test('timetable: flights between all seven airports, peaks, boards and statuses', () => {
  const s = new FlightSchedule(1);
  assert.ok(s.flights.length > 150);
  for (const ap of AIRPORTS) { assert.ok(s.flights.some((f) => f.from === ap.id), `${ap.id} departures`); assert.ok(s.flights.some((f) => f.to === ap.id), `${ap.id} arrivals`); }
  const hour = (h) => s.flights.filter((f) => f.from === 'GRV' && f.dep >= h * 3600 && f.dep < (h + 1) * 3600).length;
  assert.ok(hour(8) > hour(14) - 1, 'morning peak at least as busy as mid-afternoon');
  assert.ok(s.flights.every((f) => f.from !== 'SRA' && f.to !== 'SRA' || f.type === 'atr72'), 'altiport served by turboprops');
  const b = s.board('GRV', 'dep', 8 * 3600, 10); assert.equal(b.length, 10);
  assert.ok(['boarding', 'scheduled', 'delayed', 'inflight', 'cancelled', 'landed'].includes(s.status(b[0], 8 * 3600).code));
});

test('AI traffic: scheduled flights are flown gate to gate with ATC, no deadlock on the ground', () => {
  const layouts = AIRPORTS.map((ap) => buildAirport(null, ap, ap.id === 'SRA' ? 1000 : 20, { headless: true }));
  const atc = new ATC(layouts, weather), sch = new FlightSchedule(1), tr = new AirTraffic({ schedule: sch, layouts, atc, weather });
  const phases = new Set();
  for (let t = 6 * 3600; t < 10 * 3600; t += 0.5) { tr.update(0.5, t); for (const a of tr.flights.values()) phases.add(a.phase); }
  const done = sch.flights.filter((f) => f.done || f.phase === 'parked').length;
  assert.ok(done >= 15, `${done} flights completed`);
  for (const p of ['taxiOut', 'takeoff', 'cruise', 'final', 'landing', 'taxiIn', 'parked']) assert.ok(phases.has(p), `phase ${p} seen`);
  const stuck = [...tr.flights.values()].filter((a) => a.phaseT > 1800 && ['taxiOut', 'taxiIn', 'holdShort'].includes(a.phase));
  assert.equal(stuck.length, 0, `stuck on the ground: ${stuck.map((a) => a.f.no + ' ' + a.phase).join(', ')}`);
});

test('flight economy: tickets, fuel, fees, lease, punctuality; aircraft purchase', () => {
  const store = {}; const save = { data: {}, save() { store.saved = true; } };
  const E = new Economy(save, { train: [{ id: 'mx80', name: 'MX80', price: 1000 }], bus: [{ id: 'urbano12', name: 'U12', price: 1000 }], aircraft: Object.values(AIRCRAFT) });
  const b0 = E.balance;
  const r = E.settleFlight({ completed: true, flightNo: 'GV 101', from: 'GRV', to: 'PAZ', km: 410, seats: 174, load: 0.8, fuelUsed: 3200, mtow: 78, lease: 2200, blockMin: 75, costPerHour: 2100, delayMin: 2, landingFpm: 150, penalties: [] });
  assert.ok(r.total > 5000, `profitable flight (${r.total})`);
  assert.ok(r.items.some((i) => /Punctuality/.test(i.label)) && r.items.some((i) => /lease/i.test(i.label)));
  assert.equal(E.balance, b0 + r.total);
  const late = E.settleFlight({ completed: true, flightNo: 'GV 102', from: 'GRV', to: 'PAZ', km: 410, seats: 174, load: 0.8, fuelUsed: 3200, mtow: 78, lease: 2200, blockMin: 140, costPerHour: 2100, delayMin: 70, penalties: [{ text: 'Runway incursion', points: 150, count: 1 }] });
  assert.ok(late.total < r.total, 'late flight with penalties earns less');
  E.d.balance = 1e6; const buy = E.buy('aircraft', 'atr72'); assert.ok(buy.ok); assert.match(buy.vehicle.uid, /^F-ATR72-\d{3}$/);
  assert.ok(E.sell(buy.vehicle.uid).ok, 'the only aircraft can be sold');
});
