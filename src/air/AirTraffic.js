// Air traffic: the day's flight schedule between the seven airports and the AI aircraft that fly it.
//
// Schedule: routes between Grandville and the six cities (and a few city pairs), more flights in the morning and
// evening peaks, few at night; each flight has a number, airline, aircraft type (by route length, runway and
// airline fleet), stand, scheduled departure and estimated arrival, and a status that follows the simulation.
//
// AI flights are simulated kinematically with each type's performance (acceleration on the runway, rotation speed,
// climb and descent rates, cruise speed, approach speed, bank-limited turns) through every phase: boarding at the
// stand → push-back → taxi along the taxiways (stopping behind other aircraft) → holding point → line-up and
// take-off when ATC clears → climb → cruise → descent → approach (holding pattern when sequenced) → 3° final →
// flare and touchdown → roll-out → taxi to a free stand → parked. Go-around when the runway is still occupied.
import { AIRCRAFT, AIRPORTS, AIRLINES, airport, hdgVec, distKm } from './AirData.js';

const D2R = Math.PI / 180, G = 9.81;
const rnd = (n) => { let h = Math.imul((n | 0) ^ 0x9e3779b9, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967295; };
export const fmtT = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const bearing = (dx, dz) => ((Math.atan2(dx, -dz) / D2R) + 360) % 360;

export const ROUTES = [
  ['GRV', 'MTV'], ['GRV', 'VLD'], ['GRV', 'CLM'], ['GRV', 'SRA'], ['GRV', 'BLR'], ['GRV', 'PAZ'],
  ['PAZ', 'VLD'], ['PAZ', 'BLR'], ['MTV', 'CLM'], ['BLR', 'VLD'],
];

/** Flight time (s) gate to gate estimate for a type over a distance. */
export function blockTime(type, km) { const S = AIRCRAFT[type]; return 9 * 60 + (km * 1000) / (S.cruise * 0.82) + 7 * 60; }

export class FlightSchedule {
  constructor(day = 1) {
    this.day = day; this.flights = [];
    let seq = 0;
    for (const [a, b] of ROUTES) for (const [from, to] of [[a, b], [b, a]]) {
      const A = airport(from), B = airport(to), km = distKm(A, B);
      const main = from === 'GRV' || to === 'GRV';
      const slots = [];
      // Departures: peaks 06:30–09:30 and 17:00–20:30, off-peak, last ones in the evening; fewer on city pairs.
      for (let t = 6 * 3600 + 900 * (seq % 4); t < 22.5 * 3600; ) {
        slots.push(t);
        const h = t / 3600, peak = (h > 6.5 && h < 9.5) || (h > 17 && h < 20.5);
        t += (main ? (peak ? 50 : 90) : peak ? 120 : 210) * 60 + rnd(seq * 7 + t) * 15 * 60;
      }
      for (const dep of slots) {
        seq++;
        const r = rnd(seq * 31 + day * 977);
        const shortField = from === 'SRA' || to === 'SRA';
        const airlines = AIRLINES.filter((al) => (shortField ? al.fleet.includes('atr72') : true));
        const al = airlines[Math.floor(r * airlines.length) % airlines.length];
        let type = shortField ? 'atr72' : km < 150 ? (r < 0.6 ? 'atr72' : 'a320') : km > 380 && main && r < 0.25 && al.fleet.includes('b777') ? 'b777' : al.fleet.filter((f) => f !== 'b777')[Math.floor(rnd(seq + 5) * 10) % al.fleet.filter((f) => f !== 'b777').length];
        if (!al.fleet.includes(type)) type = al.fleet.includes('a320') ? 'a320' : al.fleet[0];
        if (shortField) type = 'atr72';
        const delay = rnd(seq * 13 + day) < 0.12 ? Math.round(5 + rnd(seq * 17) * 35) * 60 : 0;
        const cancelled = rnd(seq * 19 + day * 3) < 0.015;
        const no = `${al.code} ${100 + (seq * 7) % 900}`;
        this.flights.push({ id: `F${seq}`, no, airline: al, type, from, to, km, dep, arr: dep + blockTime(type, km), delay, cancelled, status: cancelled ? 'cancelled' : 'scheduled', gate: null, runway: null });
      }
    }
    this.flights.sort((p, q) => p.dep - q.dep);
  }
  /** Board of an airport around a time. */
  board(apId, kind, clock, n = 12) {
    const list = this.flights.filter((f) => (kind === 'dep' ? f.from === apId : f.to === apId) && (kind === 'dep' ? f.dep + f.delay > clock - 20 * 60 : f.arr + f.delay > clock - 30 * 60));
    return list.sort((p, q) => (kind === 'dep' ? p.dep - q.dep : p.arr - q.arr)).slice(0, n);
  }
  /** Status label for a flight (simulation phase when it is being flown, otherwise from the clock). */
  status(f, clock) {
    if (f.cancelled) return { code: 'cancelled', label: 'Annulé · Cancelled', color: '#ff5a4a' };
    const ph = f.phase;
    const L = {
      boarding: ['boarding', 'Embarquement · Boarding', '#5fe39a'], pushback: ['preparing', 'Préparation · Preparing', '#9fc3ff'],
      taxiOut: ['taxiing', 'Roulage · Taxiing', '#9fc3ff'], holdShort: ['taxiing', 'Roulage · Taxiing', '#9fc3ff'], lineup: ['taxiing', 'Alignement · Lining up', '#9fc3ff'],
      takeoff: ['departed', 'Décollé · Departed', '#8fa1b3'], climb: ['inflight', 'En vol · In flight', '#e8eef4'], cruise: ['inflight', 'En vol · In flight', '#e8eef4'],
      descent: ['inflight', 'En vol · In flight', '#e8eef4'], approach: ['approaching', 'En approche · Approaching', '#5fe39a'], holding: ['approaching', 'En attente · Holding', '#ffb000'],
      final: ['approaching', 'En approche · Approaching', '#5fe39a'], goAround: ['approaching', 'Remise de gaz · Go-around', '#ffb000'], landing: ['landed', 'Atterri · Landed', '#8fa1b3'],
      taxiIn: ['landed', 'Atterri · Landed', '#8fa1b3'], parked: ['landed', 'Arrivé · Arrived', '#8fa1b3'],
    }[ph];
    if (L) return { code: L[0], label: L[1], color: L[2] };
    const dep = f.dep + f.delay;
    if (clock > f.arr + f.delay) return { code: 'landed', label: 'Arrivé · Arrived', color: '#8fa1b3' };
    if (clock > dep) return { code: 'inflight', label: 'En vol · In flight', color: '#e8eef4' };
    if (clock > dep - 30 * 60) return { code: 'boarding', label: 'Embarquement · Boarding', color: '#5fe39a' };
    if (f.delay) return { code: 'delayed', label: `Retardé +${Math.round(f.delay / 60)} min`, color: '#ffb000' };
    return { code: 'scheduled', label: 'Prévu · Scheduled', color: '#9fc3ff' };
  }
}

/** One AI flight in the world. */
export class AIFlight {
  constructor(f, world) {
    this.f = f; this.w = world; this.S = AIRCRAFT[f.type]; this.id = f.id;
    this.from = world.layout(f.from); this.to = world.layout(f.to);
    this.x = 0; this.y = 0; this.z = 0; this.hdg = 0; this.v = 0; this.vs = 0; this.bank = 0; this.pitch = 0;
    this.gear = 1; this.flaps = 0; this.spoilers = 0; this.n1 = 0.25; this.door = 1; this.engines = false;
    this.lights = { nav: true, beacon: false, strobe: false, landing: false };
    this.path = null; this.pi = 0; this.wait = 0; this.phase = 'boarding'; f.phase = 'boarding';
    this.stand = this.from.freeStand(); if (this.stand) { this.stand.occupied = this.id; f.gate = this.stand.gate; this.x = this.stand.x; this.z = this.stand.z; this.hdg = this.stand.hdg; }
    this.y = this.from.elev + this.S.gearHeight;
    this.depDir = null; this.arrDir = null;
  }
  get atc() { return this.w.atc; }
  setPhase(p) { this.phase = p; this.f.phase = p; this.phaseT = 0; this.blocker = null; this.waitT = 0; }
  /** Ground speed limits: straight taxi 12 m/s, turns 5 m/s, stop distance to the aircraft ahead. */
  followPath(dt, vmax = 11) {
    const n = this.path?.[this.pi]; if (!n) return true;
    const dx = n.x - this.x, dz = n.z - this.z, d = Math.hypot(dx, dz);
    const next = this.path[this.pi + 1];
    let turn = 0; if (next) turn = Math.abs(angDiff(bearing(dx, dz), bearing(next.x - n.x, next.z - n.z)));
    let vT = d < 40 && turn > 30 ? 5 : vmax;
    // Keep 80 m behind traffic ahead going the same way; pass opposite traffic keeping right (offset); never wait
    // more than 45 s (crossing deadlocks), then go on for 12 s regardless.
    const g = this.w.groundTraffic(this, 85, 220);
    this.sideT = g.headOn ? 22 : 0;
    if (this.override > 0) this.override -= dt;
    else if (g.ahead) {
      vT = 0; this.blocker = g.ahead; this.waitT = (this.waitT || 0) + dt;
      // Deadlock = the chain of aircraft waiting on each other comes back to me.
      let b = g.ahead, cyc = false; for (let k = 0; k < 6 && b; k++) { if (b === this) { cyc = true; break; } b = b.blocker; }
      if (this.waitT > 20 && cyc) { this.override = 12; this.waitT = 0; }
    } else { this.waitT = 0; this.blocker = null; }
    this.v += Math.max(-2 * dt, Math.min(0.8 * dt, vT - this.v));
    const h = bearing(dx, dz), dh = angDiff(this.hdg, h), rate = Math.min(25, (this.v / Math.max(15, 40)) * 57) * dt;
    this.hdg = (this.hdg + Math.max(-rate * 3, Math.min(rate * 3, dh)) + 360) % 360;
    this.side = (this.side || 0) + Math.max(-4 * dt, Math.min(4 * dt, this.sideT - (this.side || 0)));
    const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt;
    if (d < Math.max(6, this.v * dt * 2)) { this.pi++; if (this.pi >= this.path.length) return true; }
    return false;
  }
  /** Airborne steering toward (tx, tz) at altitude ty and speed tv. */
  fly(dt, tx, tz, ty, tv, vsMax = 12) {
    const S = this.S, h = bearing(tx - this.x, tz - this.z), dh = angDiff(this.hdg, h);
    const bankT = Math.max(-25, Math.min(25, dh * 1.5));
    this.bank += Math.max(-6 * dt, Math.min(6 * dt, bankT - this.bank));
    const turnRate = (G * Math.tan(this.bank * D2R)) / Math.max(40, this.v) / D2R;
    this.hdg = (this.hdg + turnRate * dt + 360) % 360;
    this.v += Math.max(-1.0 * dt, Math.min(1.2 * dt, tv - this.v));
    const vsT = Math.max(-vsMax, Math.min(vsMax, (ty - this.y) * 0.06));
    this.vs += Math.max(-2 * dt, Math.min(2 * dt, vsT - this.vs));
    const hv = hdgVec(this.hdg);
    this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt; this.y += this.vs * dt;
    this.pitch = Math.atan2(this.vs, this.v) / D2R + 2.5 + (this.flaps > 0.5 ? -1 : 0);
    void S;
  }
  update(dt, clock) {
    const S = this.S, f = this.f, A = this.atc.of(f.from), B = this.atc.of(f.to);
    this.phaseT = (this.phaseT || 0) + dt;
    const elev0 = this.from.elev, elev1 = this.to.elev;
    switch (this.phase) {
      case 'boarding':
        this.door = 1; this.engines = false; this.lights.beacon = false;
        if (clock >= f.dep + f.delay - 60) { this.door = 0; this.depDir = A.active(); f.runway = this.depDir.name; const p = this.from.graph.path(this.stand?.node ?? this.from.graph.nearest(this.x, this.z), this.depDir.entryHold); this.path = p ? p.slice(1) : []; this.pi = 0; this.setPhase('pushback'); this.lights.beacon = true; this.engines = true; }
        break;
      case 'pushback': {
        // Back 35 m from the stand (tug), engines start, then taxi.
        const hv = hdgVec(this.hdg); const k = Math.min(1, this.phaseT / 40);
        if (k < 1) { this.x -= hv.x * 0.9 * dt; this.z -= hv.z * 0.9 * dt; this.n1 = 0.15 + 0.1 * k; }
        else { if (this.stand) this.stand.occupied = null; this.stand = null; this.setPhase('taxiOut'); this.n1 = 0.27; }
        break;
      }
      case 'taxiOut':
        this.flaps = Math.min(0.35, this.flaps + dt * 0.1); this.lights.nav = true;
        if (this.followPath(dt)) { this.v = 0; A.requestDeparture(this.id); this.setPhase('holdShort'); }
        break;
      case 'holdShort': {
        const c = A.takeoffClearance(this.id, clock);
        if (c.ok) { this.setPhase('lineup'); this.atc.say(f.from, 'tower', `${f.no}, piste ${this.depDir.name}, autorisé décollage.`, f.no); }
        break;
      }
      case 'lineup': {
        const e = this.from.graph.nodes[this.depDir.entry];
        const dx = e.x - this.x, dz = e.z - this.z, d = Math.hypot(dx, dz);
        if (d > 4) { this.v = Math.min(6, this.v + dt); const h = bearing(dx, dz); this.hdg = (this.hdg + Math.max(-30 * dt, Math.min(30 * dt, angDiff(this.hdg, h))) + 360) % 360; const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt; }
        else { this.hdg = (this.hdg + Math.max(-30 * dt, Math.min(30 * dt, angDiff(this.hdg, this.depDir.hdg))) + 360) % 360; this.v = Math.max(0, this.v - dt * 2); if (Math.abs(angDiff(this.hdg, this.depDir.hdg)) < 1) { this.setPhase('takeoff'); this.lights.strobe = true; this.lights.landing = true; } }
        break;
      }
      case 'takeoff': {
        const accel = Math.max(1.4, (S.thrust * 0.85) / (S.massEmpty * 1.5) - 0.3);
        this.n1 = Math.min(0.95, this.n1 + dt * 0.25);
        if (this.y - elev0 - S.gearHeight < 1) { this.v += accel * dt; const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt; if (this.v > S.vr) { this.pitch = Math.min(15, this.pitch + dt * 3); this.vs = Math.min(13, this.vs + dt * 4); this.y += this.vs * dt; } }
        else { this.v += accel * 0.4 * dt; this.vs = Math.min(13, this.vs + dt * 3); this.y += this.vs * dt; const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt; this.pitch = 12; }
        if (this.y - elev0 > 120) { this.gear = Math.max(0, this.gear - dt / 8); }
        if (this.y - elev0 > 300) { A.release(this.id); this.setPhase('climb'); this.atc.say(f.from, 'departure', `${f.no}, identifié, montez niveau ${Math.round(this.cruiseAlt() * 3.28084 / 100)}.`, f.no); }
        break;
      }
      case 'climb': case 'cruise': case 'descent': {
        this.gear = Math.max(0, this.gear - dt / 8); this.flaps = Math.max(0, this.flaps - dt * 0.05); this.n1 = this.phase === 'descent' ? 0.35 : this.phase === 'climb' ? 0.92 : 0.82;
        this.arrDir = B.active();
        const iaf = this.iaf(), dist = Math.hypot(iaf.x - this.x, iaf.z - this.z);
        const cruise = this.cruiseAlt(), tod = (cruise - (elev1 + 900)) / Math.tan(3.2 * D2R);
        let ty = cruise, tv = S.cruise;
        if (this.phase === 'climb' && this.y > cruise - 50) this.setPhase('cruise');
        if (this.phase !== 'descent' && dist < tod) this.setPhase('descent');
        if (this.phase === 'descent') { ty = elev1 + 900 + Math.tan(3 * D2R) * Math.max(0, dist - 2000); tv = Math.max(S.vref + 25, Math.min(S.cruise, 120 + dist / 900)); }
        if (this.phase === 'climb') tv = Math.min(S.cruise, 120 + (this.y - elev0) * 0.02);
        this.lights.landing = this.y - elev0 < 3000 || this.y - elev1 < 3000;
        this.fly(dt, iaf.x, iaf.z, ty, tv, this.phase === 'descent' ? 9 : 12);
        if (dist < 5000 && this.phase === 'descent') { this.setPhase('approach'); this.atc.say(f.to, 'approach', `${f.no}, ${this.atc.of(f.to).call('approach')}, descendez ${Math.round(900 * 3.28 / 100) * 100} pieds, autorisé ILS piste ${this.arrDir.name}.`, f.no); }
        break;
      }
      case 'approach': case 'holding': case 'final': case 'goAround': {
        const I = this.arrDir.ils, along = -((this.x - I.x) * I.dx + (this.z - I.z) * I.dz), cross = (this.x - I.x) * -I.dz + (this.z - I.z) * I.dx;
        B.arrival(this.id, Math.max(0, along));
        if (this.phase === 'approach') {
          if (!B.sequenceOk(this.id)) { this.setPhase('holding'); this.holdC = { x: this.x, z: this.z }; this.atc.say(f.to, 'approach', `${f.no}, maintenez au point d'attente, attente prévue cinq minutes.`, f.no); break; }
          // Intercept the localiser 14 km out, then follow the 3° glide path.
          const tx = I.x - I.dx * Math.max(0, along - 3000), tz = I.z - I.dz * Math.max(0, along - 3000);
          this.fly(dt, tx, tz, elev1 + Math.min(900, Math.tan(3 * D2R) * along + 15), S.vref + 20, 6);
          if (along < 14000 && Math.abs(cross) < 400) this.setPhase('final');
        } else if (this.phase === 'holding') {
          // Racetrack around the holding fix (~2 min legs); leave when the sequence allows.
          const a = this.phaseT * 0.03; const tx = this.holdC.x + Math.cos(a) * 3500, tz = this.holdC.z + Math.sin(a) * 3500;
          this.fly(dt, tx, tz, elev1 + 1500, S.vref + 40, 5);
          if (B.sequenceOk(this.id) && this.phaseT > 60) this.setPhase('approach');
        } else if (this.phase === 'goAround') {
          const hv = hdgVec(this.arrDir.hdg); this.fly(dt, this.x + hv.x * 3000, this.z + hv.z * 3000, elev1 + 900, S.vref + 30, 10);
          this.gear = Math.max(0, this.gear - dt / 8); B.release(this.id);
          if (this.phaseT > 70) { this.setPhase('approach'); }
        } else {
          // Final: gear and flaps down, 3° glide, landing clearance at 4 km, go-around if not cleared at 1 km.
          this.gear = Math.min(1, this.gear + dt / 8); this.flaps = Math.min(1, this.flaps + dt * 0.08); this.n1 = 0.45; this.lights.landing = true;
          const gsY = elev1 + S.gearHeight + Math.tan(3 * D2R) * along;
          const tx = I.x - I.dx * Math.max(-2000, along - 1200), tz = I.z - I.dz * Math.max(-2000, along - 1200);
          const h = bearing(tx - this.x, tz - this.z); this.hdg = (this.hdg + Math.max(-3 * dt, Math.min(3 * dt, angDiff(this.hdg, h))) + 360) % 360; this.bank *= 0.95;
          this.v += Math.max(-1 * dt, Math.min(1 * dt, S.vref - this.v));
          this.vs = (gsY - this.y) * 0.4 - this.v * Math.tan(3 * D2R);
          const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt; this.y += this.vs * dt;
          this.pitch = 3;
          if (along < 4000 && !this.landClear) { if (B.landingClearance(this.id, clock)) { this.landClear = true; this.atc.say(f.to, 'tower', `${f.no}, vent ${Math.round(this.w.weather.wind().dir)} degrés ${Math.round(this.w.weather.wind().speed * 1.94)} nœuds, piste ${this.arrDir.name}, autorisé atterrissage.`, f.no); } }
          if (along < 1000 && !this.landClear) { this.setPhase('goAround'); this.atc.say(f.to, 'tower', `${f.no}, remettez les gaz, piste occupée.`, f.no); break; }
          if (this.y <= elev1 + S.gearHeight + 0.2 || along < 300) { this.y = elev1 + S.gearHeight; this.vs = 0; B.occupy(this.id, clock); this.setPhase('landing'); this.spoilers = 1; }
        }
        break;
      }
      case 'landing': {
        this.pitch = Math.max(0, this.pitch - dt * 2); this.n1 = 0.3;
        this.v = Math.max(12, this.v - 2.2 * dt);
        const hv = hdgVec(this.hdg); this.x += hv.x * this.v * dt; this.z += hv.z * this.v * dt;
        if (this.v <= 12.5) {
          // Exit at the first rapid exit ahead, then to a free stand.
          const g = this.to.graph, ex = this.arrDir.exits.map((i) => g.nodes[i]).find((nd) => ((nd.x - this.x) * hv.x + (nd.z - this.z) * hv.z) > -30) || g.nodes[this.arrDir.exits.at(-1)];
          this.stand = this.to.freeStand(); if (this.stand) { this.stand.occupied = this.id; this.f.gate = this.stand.gate; }
          const p = g.path(ex.i, this.stand ? this.stand.node : g.nearest(this.x, this.z, (nn) => nn.kind === 'lane'), false);
          this.path = [ex, ...(p ? p.slice(1) : [])]; this.pi = 0; this.spoilers = 0; this.lights.strobe = false; this.lights.landing = false;
          this.setPhase('taxiIn'); this.atc.say(f.to, 'ground', `${f.no}, roulez vers ${this.stand ? 'le poste ' + this.stand.gate : 'l’aire de trafic'}.`, f.no);
        }
        break;
      }
      case 'taxiIn':
        this.flaps = Math.max(0, this.flaps - dt * 0.1);
        if (this.phaseT > 4) B.release(this.id), B.removeArrival(this.id);
        if (this.followPath(dt)) { this.v = 0; this.setPhase('parked'); this.engines = false; this.lights.beacon = false; this.door = 1; if (this.stand) this.hdg = this.stand.hdg; }
        break;
      case 'parked':
        this.n1 = Math.max(0, this.n1 - dt * 0.05);
        break;
    }
    if (this.y < (this.phase === 'climb' || this.phase === 'cruise' || this.phase === 'descent' ? 0 : -1e9)) this.y = 0;
  }
  cruiseAlt() { const km = this.f.km; const c = Math.min(this.S.ceiling - 1500, 2500 + km * 22); return Math.max(this.from.elev, this.to.elev) + Math.max(2500, c); }
  /** Initial approach fix: 16 km out on the extended centreline of the arrival runway. */
  iaf() { const I = this.arrDir.ils; return { x: I.x - I.dx * 16000, z: I.z - I.dz * 16000 }; }
  /** Ground and airborne state for the 3D model / map / multiplayer. */
  get state() { const hv = hdgVec(this.hdg), o = this.onGround ? this.side || 0 : 0; return { x: this.x - hv.z * o, y: this.y, z: this.z + hv.x * o, hdg: this.hdg, pitch: this.pitch, bank: this.bank, v: this.v, vs: this.vs, gear: this.gear, flaps: this.flaps, spoilers: this.spoilers, n1: [this.n1, this.n1], lights: this.lights, door: this.door, phase: this.phase }; }
  get onGround() { return ['boarding', 'pushback', 'taxiOut', 'holdShort', 'lineup', 'taxiIn', 'parked', 'landing'].includes(this.phase) || (this.phase === 'takeoff' && this.y - this.from.elev - this.S.gearHeight < 1); }
}

/** All AI flights currently in the world (spawned from the schedule around the clock). */
export class AirTraffic {
  constructor({ schedule, layouts, atc, weather, density = 1 }) {
    this.schedule = schedule; this.layouts = layouts; this.atc = atc; this.weather = weather; this.density = density;
    this.flights = new Map(); this.player = null;
  }
  layout(id) { return this.layouts.find((l) => l.ap.id === id); }
  /** Ground traffic around `me`: `ahead` = aircraft within `dist` m in front (±35°) going the same way (or stopped
   * across the path); `headOn` = opposite-direction traffic in front within `far` m (passed keeping right). */
  groundTraffic(me, dist, far) {
    const hv = hdgVec(me.hdg); let ahead = null, headOn = false;
    const check = (o) => {
      if (o === me || !o.onGround || o.phase === 'parked' || o.phase === 'boarding') return;
      const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz); if (d > far || d < 0.5) return;
      if ((dx * hv.x + dz * hv.z) / d < 0.82) return;
      const dh = Math.abs(((((o.hdg - me.hdg) % 360) + 540) % 360) - 180);
      if (dh > 120) headOn = true;
      else if (d < dist && (dh < 60 || o.v < 0.5)) ahead = o;
    };
    for (const o of this.flights.values()) check(o);
    if (this.player) check(this.player);
    for (const o of this.others?.values() || []) check(o);
    return { ahead, headOn };
  }
  update(dt, clock) {
    // Spawn flights whose boarding starts, drop finished ones (parked for 15 min).
    for (const f of this.schedule.flights) {
      if (f.cancelled || f.player || this.flights.has(f.id)) continue;
      const dep = f.dep + f.delay;
      if (clock > dep - 25 * 60 && clock < dep + 5 * 60 && !f.done) {
        if (this.density < 1 && rnd(Number(f.id.slice(1))) > this.density) continue;
        const a = new AIFlight(f, this); if (!a.stand) continue; this.flights.set(f.id, a);
      }
    }
    for (const [id, a] of this.flights) {
      a.update(dt, clock);
      if (a.phase === 'parked' && a.phaseT > 15 * 60) { if (a.stand) a.stand.occupied = null; a.f.done = true; this.flights.delete(id); }
    }
  }
}
