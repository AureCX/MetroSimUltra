// Passenger simulation for the bus: demand per stop (time of day, day of week, district,
// route type, weather), waiting crowds at the stops ahead, alighting through the rear doors,
// boarding through the front door with ticket / contactless validation, seat or standing place,
// stop requests, kneeling for reduced-mobility passengers, and reactions to harsh braking.
import { Person } from '../world/Passengers.js';
import { seededRandom } from '../core/util.js';

/** Demand multiplier by hour / day / route type (airport demand follows flight waves). */
export function demandFactor(hour, day, type) {
  const g = (m, s) => Math.exp(-((hour - m) ** 2) / (2 * s * s));
  if (type === 'airport') return (0.35 + 0.9 * g(7, 1.5) + 0.7 * g(11.5, 1.5) + 0.8 * g(16, 1.8) + 0.6 * g(20.5, 1.5)) * (day >= 6 ? 1.1 : 1);
  let d = 0.2 + 1.1 * g(8, 1.2) + 0.5 * g(12.5, 1.8) + 1.0 * g(17.5, 1.4);
  if (hour < 5.5 || hour > 23.5) d = 0.08;
  if (day === 7) d *= 0.45; else if (day === 6) d *= 0.75;
  return d;
}

export class BusPassengers {
  constructor(scene, vehicle, model, runner, bus) {
    this.scene = scene; this.v = vehicle; this.model = model; this.runner = runner; this.bus = bus;
    this.rand = seededRandom(4711);
    this.waiting = new Map();   // stopKey -> [Person]
    this.onboard = [];          // { p, dest, slot, seated }
    this.boarding = []; this.alighting = [];
    this.validations = 0; this.contactless = 0;
    this.validatorTimer = 0;
    this.heightAt = () => 0;   // ground elevation (set by the game from the network terrain)
    this.cashWaiting = 0; this.ticketsToHand = 0; this.cashSales = 0; this.ticketPrice = 2.1;
    this.comfortHits = 0;
    this.seatMix();
  }
  seatMix() { for (const s of this.model.seatSlots) s.taken = false; for (const s of this.model.standSlots) s.taken = false; }
  get count() { return this.onboard.length + this.boarding.filter((b) => b.state === 'inside').length; }
  get capacity() { return this.v.spec.capacity; }

  /**
   * Collision: passengers are thrown opposite to the impulse. Standing passengers stumble (strong impacts: they
   * fall and get up again after a while), seated ones lurch in their seat. Movement stays within each person's
   * place so nobody passes through seats or walls. Returns the number of passengers who fell.
   */
  onImpact(res, ph) {
    const h = ph.heading();
    // Impulse direction in the bus frame (forward f, right l); people move the other way relative to the bus.
    const jf = (res.Jx * h.fx + res.Jz * h.fz), jl = (res.Jx * h.rx + res.Jz * h.rz), jn = Math.hypot(jf, jl) || 1;
    const df = -jf / jn, dl = -jl / jn, k = Math.min(1, res.dv / 7);
    let fell = 0;
    for (const o of this.onboard) {
      const r = this.rand();
      const falls = !o.seated && k > 0.35 && r < k * 0.9;
      if (falls) fell++;
      o.react = { t: 0, df, dl, k: k * (0.7 + r * 0.6), fall: falls, base: { x: o.p.g.position.x, z: o.p.g.position.z, ry: o.p.g.rotation.y }, recover: falls ? 4 + r * 4 : 1.2 + k * 1.5 };
    }
    if (fell) this.injured = (this.injured || 0) + fell;
    this.comfortHits += Math.round(k * 6);
    return fell;
  }
  stepReaction(o, dt) {
    const R = o.react, p = o.p;
    R.t += dt;
    // Bus frame: −z forward, +x right (BusModel local frame).
    const shift = Math.min(0.28, R.k * 0.35);                 // stays within the person's place
    const ease = R.t < 0.25 ? R.t / 0.25 : Math.max(0, 1 - (R.t - R.recover) / 1.2);
    const lx = R.dl * shift * ease, lz = -R.df * shift * ease;
    p.g.position.x = R.base.x + lx; p.g.position.z = R.base.z + lz;
    if (o.seated) {
      p.torso.rotation.x = Math.max(-0.9, Math.min(0.9, R.df * 0.9 * R.k)) * ease;
      p.torso.rotation.z = Math.max(-0.6, Math.min(0.6, -R.dl * 0.6 * R.k)) * ease;
    } else if (R.fall) {
      // Falls over (towards the throw direction), lies a moment, gets up.
      const lie = R.t < 0.45 ? R.t / 0.45 : R.t < R.recover ? 1 : Math.max(0, 1 - (R.t - R.recover) / 1.5);
      p.g.rotation.x = -R.df * 1.35 * lie; p.g.rotation.z = -R.dl * 1.35 * lie;
      p.g.position.y = 0.38 - 0.25 * lie;
      p.arms.forEach((a) => { a.sh.rotation.x = -1.2 * lie; });
    } else {
      // Stumbles: leans, catches the rail.
      p.torso.rotation.x = R.df * 0.7 * R.k * ease; p.torso.rotation.z = -R.dl * 0.5 * R.k * ease;
      p.arms[0].sh.rotation.x = -2.2 * ease;
    }
    if (R.t > R.recover + 1.6) {
      p.g.position.set(R.base.x, o.seated ? p.g.position.y : 0.38, R.base.z);
      p.g.rotation.set(0, R.base.ry, 0); p.torso.rotation.set(0, 0, 0);
      o.react = null;
    }
  }

  /** Driver's ticket machine: sells a single ticket to the passenger paying cash (refused when nobody is waiting). */
  sellTicket() {
    if (this.cashWaiting > this.ticketsToHand) { this.ticketsToHand++; return true; }
    return false;
  }

  /** Initial load at the start (if the run begins mid-route) and expected waiting counts. */
  expectedAt(stopIdx, env) {
    const st = this.runner.stops[stopIdx];
    if (!st || stopIdx === this.runner.stops.length - 1) return 0;
    const lambda = (st.stop.demand ?? 1) * 3.2 * demandFactor(env.hour, env.day, this.runner.route.type) * (env.rain ? 1.15 : 1) * (stopIdx === 0 ? 1.6 : 1);
    // Poisson sample.
    let k = 0, p = Math.exp(-lambda), s = p; const u = this.rand();
    while (u > s && k < 40) { k++; p *= lambda / k; s += p; }
    return k;
  }

  spawnWaiting(stopIdx, env) {
    const st = this.runner.stops[stopIdx];
    const key = st.key;
    if (this.waiting.has(key)) return;
    const sv = this.runner.viewFor(stopIdx);
    const n = Math.min(24, this.expectedAt(stopIdx, env));
    const list = [];
    for (let i = 0; i < n; i++) {
      const p = new Person(this.rand);
      const later = this.runner.stops.length - 1 - stopIdx;
      p.dest = stopIdx + 1 + Math.min(later - 1, Math.floor(Math.pow(this.rand(), 0.8) * later));
      p.mobility = this.rand() < 0.1;
      { const u = this.rand(); p.pay = u < 0.55 ? 'nfc' : u < 0.92 ? 'ok' : 'cash'; } // cash: buys a ticket from the driver
      p.speed = (p.mobility ? 0.6 : 1.0) + this.rand() * 0.5;
      const a = this.rand() * 6 - 3, b = this.rand() * 1.2;
      p.home = { x: sv.waitPoint.x + sv.d.dx * a + sv.d.rx * b, z: sv.waitPoint.z + sv.d.dz * a + sv.d.rz * b };
      p.g.position.set(p.home.x, 0.15, p.home.z);
      p.g.rotation.y = Math.atan2(-sv.d.rx, -sv.d.rz) + (this.rand() - 0.5);
      p.state = 'wait'; p.va = 0; p.vd = 0;
      this.scene.add(p.g); list.push(p);
    }
    this.waiting.set(key, list);
  }
  clearWaiting(key) { for (const p of this.waiting.get(key) || []) this.scene.remove(p.g); this.waiting.delete(key); }
  waitingAt(stopIdx) { const st = this.runner.stops[stopIdx]; return st ? (this.waiting.get(st.key)?.length ?? 0) : 0; }

  /** Number still to alight or board at the stop the bus is standing at. */
  pending(stopIdx) {
    const st = this.runner.stops[stopIdx];
    const w = st ? (this.waiting.get(st.key) || []).length : 0;
    return w + this.boarding.length + this.alighting.filter((a) => a.state !== 'gone').length + this.onboard.filter((o) => o.dest === stopIdx).length;
  }

  freeSlot() {
    const seat = this.model.seatSlots.find((s) => !s.taken);
    if (seat && this.rand() < 0.92) { seat.taken = true; return { slot: seat, seated: true }; }
    const stand = this.model.standSlots.find((s) => !s.taken);
    if (stand) { stand.taken = true; return { slot: stand, seated: false }; }
    return null;
  }

  placeInside(p, slot, seated) {
    this.scene.remove(p.g);
    slot.parent.add(p.g);
    p.g.position.set(slot.x + (seated ? 0 : (this.rand() - 0.5) * 0.3), seated ? slot.y - 0.45 : 0.38, slot.z);
    p.g.rotation.set(0, Math.PI + (seated ? 0 : (this.rand() - 0.5) * 2), 0);
    p.g.scale.setScalar(p.g.scale.x);
    if (seated) { p.hips.position.y = 0.62; p.legs.forEach((l) => { l.hip.rotation.x = -1.45; l.knee.rotation.x = 1.45; }); p.seated = true; }
    p.va = 0;
  }

  update(dt, t, env) {
    const R = this.runner, v = this.v;
    // Spawn crowds at the next stops of the service.
    if (R.phase === 'service' || R.phase === 'deadhead') {
      for (let k = Math.max(0, R.nextIdx); k < Math.min(R.stops.length, R.nextIdx + 2); k++) {
        if (R.distanceToStop(k) < 420) this.spawnWaiting(k, env);
      }
    }
    // Stop request: someone on board wants the next stop.
    if (R.phase === 'service' && !v.stopRequest && R.atStopIdx == null && this.onboard.some((o) => o.dest === R.nextIdx) && R.distanceToStop(R.nextIdx) < 500 && R.sinceDeparture > 6) {
      v.stopRequest = true; this.bus.emit('bus:stopRequest');
    }
    // Exchange at a stop.
    const k = R.atStopIdx;
    const doorsOpen = v.doors.map((d) => d.amount > 0.85);
    if (k != null) {
      const st = R.stops[k];
      // Alighting: passengers for this stop leave through the rear doors (front if only one open).
      const exitDoors = v.doors.filter((d, i) => i > 0 && doorsOpen[i]).map((d) => d.i);
      const anyExit = exitDoors.length ? exitDoors : doorsOpen[0] ? [0] : [];
      if (anyExit.length) {
        const leaving = this.onboard.filter((o) => o.dest === k);
        if (leaving.length && (this.exitTimer = (this.exitTimer || 0) - dt) <= 0) {
          const o = leaving[0];
          this.onboard.splice(this.onboard.indexOf(o), 1);
          o.slot.taken = false;
          const door = anyExit[this.alighting.length % anyExit.length];
          const pos = v.doorWorld(door);
          o.p.parent?.remove(o.p.g);
          if (o.p.g.parent) o.p.g.parent.remove(o.p.g);
          o.p.seated = false; o.p.hips.position.y = 0.93; o.p.legs.forEach((l) => { l.hip.rotation.x = 0; l.knee.rotation.x = 0; });
          o.p.g.position.set(pos.x, 0.15, pos.z); this.scene.add(o.p.g);
          const sv = R.viewFor(k);
          this.alighting.push({ p: o.p, door, state: 'out', target: { x: pos.x + sv.d.rx * 4 + sv.d.dx * (this.rand() * 10 - 5), z: pos.z + sv.d.rz * 4 + sv.d.dz * (this.rand() * 10 - 5) } });
          this.exitTimer = 0.9 + this.rand() * 0.6;
        }
      }
      // Boarding through the front door once nobody is still getting off there.
      const queue = this.waiting.get(st.key) || [];
      const frontBusy = this.alighting.some((a) => a.state === 'out' && a.door === 0);
      const aeroAllDoors = v.spec.aeroval;
      if (queue.length && (doorsOpen[0] || (aeroAllDoors && doorsOpen.some(Boolean))) && !frontBusy && this.boarding.length < 3 && R.isServiceStop(k)) {
        const p = queue.shift();
        const door = doorsOpen[0] ? 0 : doorsOpen.findIndex(Boolean);
        if (p.pay === 'cash' && door !== 0) p.pay = 'ok'; // no driver at the rear doors: buys at the machine instead
        this.boarding.push({ p, door, state: 'walk', valid: 0 });
      }
    }
    // Animate boarders.
    for (const b of [...this.boarding]) {
      const p = b.p;
      if (b.state === 'walk') {
        if (!(v.doors[b.door].amount > 0.85)) { p.va = 0; p.animate(dt, t); continue; }
        const dp = v.doorWorld(b.door);
        const dx = dp.x - p.g.position.x, dz = dp.z - p.g.position.z, d = Math.hypot(dx, dz);
        const kneelBoost = v.kneelT > 0.6 ? 1 : p.mobility ? 0.35 : 1;
        const step = Math.min(d, p.speed * kneelBoost * dt);
        p.g.position.x += (dx / (d || 1)) * step; p.g.position.z += (dz / (d || 1)) * step;
        p.g.rotation.y = Math.atan2(dx, dz); p.va = p.speed * kneelBoost;
        if (d < 0.3) {
          b.state = p.pay === 'cash' ? 'cash' : 'validate'; b.valid = (p.pay === 'nfc' ? 0.8 : 1.7) * (p.mobility && v.kneelT < 0.6 ? 2.5 : 1);
          if (b.state === 'cash') { this.cashWaiting = (this.cashWaiting || 0) + 1; this.bus.emit('bus:cashFare'); }
        }
      } else if (b.state === 'cash') {
        // Waits at the driver until a ticket is sold, then validates it.
        p.va = 0;
        if (v.doors[b.door].amount < 0.5) { // doors closed on them: left behind at the stop
          this.cashWaiting--; this.boarding.splice(this.boarding.indexOf(b), 1); this.scene.remove(p.g);
          this.bus.emit('bus:cashLeftBehind'); continue;
        }
        if (this.ticketsToHand > 0) { this.ticketsToHand--; this.cashWaiting--; this.cashSales = (this.cashSales || 0) + 1; b.state = 'validate'; b.valid = 1.2; p.pay = 'ok'; }
      } else if (b.state === 'validate') {
        p.va = 0; b.valid -= dt;
        if (b.valid <= 0) {
          this.validations++; if (p.pay === 'nfc') this.contactless++;
          this.model.drawValidator(p.pay); this.validatorTimer = 1.2;
          this.bus.emit('bus:validate', p.pay);
          const slot = this.freeSlot();
          this.boarding.splice(this.boarding.indexOf(b), 1);
          if (!slot) { this.scene.remove(p.g); this.bus.emit('bus:full'); continue; }
          this.placeInside(p, slot.slot, slot.seated);
          this.onboard.push({ p, dest: p.dest, slot: slot.slot, seated: slot.seated });
        }
      }
      p.animate(dt, t);
    }
    for (const a of [...this.alighting]) {
      const p = a.p;
      const dx = a.target.x - p.g.position.x, dz = a.target.z - p.g.position.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, 1.2 * dt);
      p.g.position.x += (dx / (d || 1)) * step; p.g.position.z += (dz / (d || 1)) * step; p.g.rotation.y = Math.atan2(dx, dz); p.va = 1.2;
      p.animate(dt, t);
      if (d < 0.2) { this.scene.remove(p.g); this.alighting.splice(this.alighting.indexOf(a), 1); }
    }
    for (const list of this.waiting.values()) for (const p of list) { p.va = 0; p.animate(dt, t); }
    // On-board: standing passengers sway with the bus; harsh braking makes them stagger.
    const ax = v.ph.ax, ay = v.ph.ay;
    for (const o of this.onboard) {
      if (o.react) { this.stepReaction(o, dt); o.p.animate(dt, t); continue; }
      if (o.seated) { o.p.torso.rotation.x = Math.max(-0.25, Math.min(0.25, ax * 0.03)); continue; }
      o.p.torso.rotation.x = Math.max(-0.5, Math.min(0.5, -ax * 0.06));
      o.p.torso.rotation.z = Math.max(-0.35, Math.min(0.35, ay * 0.05));
      o.p.arms[1].sh.rotation.x = -2.6; // holding the grab rail
      o.p.animate(dt, t);
    }
    if (ax < -3.2 && this.onboard.some((o) => !o.seated)) { if ((this.staggerCd = (this.staggerCd || 0) - dt) <= 0) { this.staggerCd = 3; this.comfortHits++; this.bus.emit('bus:passengersStagger'); } }
    if (this.validatorTimer > 0 && (this.validatorTimer -= dt) <= 0) this.model.drawValidator('ready');
    // Payload mass.
    v.ph.payload = this.count * 72;
    // People outside the bus stand on the ground.
    for (const list of [...this.waiting.values(), this.boarding.map((b) => b.p), this.alighting.map((a) => a.p)]) {
      for (const p of list) if (p.g.parent === this.scene) p.g.position.y = 0.15 + this.heightAt(p.g.position.x, p.g.position.z);
    }
    // Clear crowds behind the bus.
    for (const [key] of this.waiting) { const idx = R.stops.findIndex((s) => s.key === key); if (idx >= 0 && idx < R.nextIdx - 1) this.clearWaiting(key); }
  }

  dispose() {
    for (const k of [...this.waiting.keys()]) this.clearWaiting(k);
    for (const a of this.alighting) this.scene.remove(a.p.g);
    for (const b of this.boarding) this.scene.remove(b.p.g);
    for (const o of this.onboard) o.p.g.parent?.remove(o.p.g);
  }
}
