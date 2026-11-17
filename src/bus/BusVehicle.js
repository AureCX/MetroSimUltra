// On-board systems of the driven bus: ignition, gear selector, parking brake, doors with door
// brake interlock, kneeling, indicators / hazards, lights, wipers, compressed air, fuel or
// battery energy, coolant temperature, vehicle condition and stop request. Wraps BusPhysics.
import { BusPhysics } from './BusPhysics.js';
import { clamp } from '../core/util.js';

const DOOR_TIME = 1.8;

export class BusVehicle {
  constructor(spec, bus, saved = {}) {
    this.spec = spec; this.bus = bus;
    this.ph = new BusPhysics(spec);
    this.engineOn = false; this.cranking = 0;
    this.gearSel = 'N';
    this.parking = true;
    this.doors = spec.doors.map((pos, i) => ({ i, pos, amount: 0, target: 0 }));
    this.kneel = false; this.kneelT = 0;
    this.indicator = null; this.hazards = false; this.blink = 0; this.blinkOn = false;
    this.lights = 1; // 0 off, 1 low, 2 high
    this.wipers = 0; this.wiperPhase = 0;
    this.airPressure = 8.0;
    const electric = spec.powertrain === 'electric';
    this.energyMax = electric ? spec.battery : spec.fuelCapacity;
    this.energy = clamp(saved.energy ?? this.energyMax * 0.9, 0, this.energyMax);
    this.hybridSoc = 0.6;
    this.coolant = saved.coolant ?? 25;
    this.condition = saved.condition ?? 1;      // 1 = perfect
    this.cleanliness = saved.cleanliness ?? 1;
    this.stopRequest = false;
    this.emergency = false;
    this.horn = false;
    this.mirrorYaw = [0, 0];
    this.interiorLights = true;
  }
  get speed() { return this.ph.vx; }
  get electric() { return this.spec.powertrain === 'electric'; }
  get doorsClosed() { return this.doors.every((d) => d.amount === 0 && d.target === 0); }
  get energyPct() { return this.energy / this.energyMax; }

  // ---- controls ----
  toggleEngine() {
    if (this.engineOn) { if (Math.abs(this.speed) < 0.5) { this.engineOn = false; this.bus.emit('bus:engine', false); } return; }
    if (this.energy <= 0) { this.bus.emit('bus:refused', this.electric ? 'Battery empty' : 'Fuel tank empty'); return; }
    this.cranking = this.electric ? 0.6 : 1.6;
    this.bus.emit('bus:crank', this.electric);
  }
  setGear(g) {
    if (g === this.gearSel) return;
    if ((g === 'R' || this.gearSel === 'R') && Math.abs(this.speed) > 0.5) { this.bus.emit('bus:refused', 'Stop the bus before selecting R or D from reverse'); return; }
    this.gearSel = g; this.bus.emit('bus:gear', g);
  }
  toggleParking() { this.parking = !this.parking; this.bus.emit('bus:parking', this.parking); }
  door(i, open) {
    const d = this.doors[i]; if (!d) return;
    if (open && Math.abs(this.speed) > 0.8) { this.bus.emit('bus:doorWhileMoving', i); return; }
    d.target = open ? 1 : 0;
    this.bus.emit(open ? 'bus:doorOpen' : 'bus:doorClose', i);
  }
  toggleDoor(i) { this.door(i, this.doors[i]?.target === 0); }
  allDoors(open) { for (const d of this.doors) if ((d.target === 1) !== open) this.door(d.i, open); }
  toggleKneel() {
    if (Math.abs(this.speed) > 1) { this.bus.emit('bus:refused', 'Kneeling only at a standstill'); return; }
    this.kneel = !this.kneel; this.bus.emit('bus:kneel', this.kneel);
  }
  setIndicator(side) { this.indicator = this.indicator === side ? null : side; this.bus.emit('bus:indicator', this.indicator); }
  toggleHazards() { this.hazards = !this.hazards; this.bus.emit('bus:indicator', this.hazards ? 'hazard' : this.indicator); }
  cycleWipers() { this.wipers = (this.wipers + 1) % 4; this.bus.emit('bus:click'); }
  cycleLights() { this.lights = (this.lights + 1) % 3; this.bus.emit('bus:click'); }
  toggleEmergency() { this.emergency = !this.emergency; if (this.emergency) this.hazards = true; this.bus.emit('bus:emergency', this.emergency); }

  /** controls: { throttle, brake, wheelTarget }, env: { mu, grade, dt } */
  update(dt, controls, env) {
    // Ignition.
    if (this.cranking > 0) { this.cranking -= dt; if (this.cranking <= 0) { this.engineOn = true; this.bus.emit('bus:engine', true); } }
    // Doors.
    for (const d of this.doors) {
      const prev = d.amount;
      d.amount = clamp(d.amount + Math.sign(d.target - d.amount) * dt / DOOR_TIME, 0, 1);
      if (prev > 0 && d.amount === 0) this.bus.emit('bus:doorClosed', d.i);
      if (prev < 1 && d.amount === 1) this.bus.emit('bus:doorOpened', d.i);
    }
    // Kneeling (front-right lowers, raises automatically when driving off).
    if (this.kneel && Math.abs(this.speed) > 3) { this.kneel = false; this.bus.emit('bus:kneel', false); }
    this.kneelT += ((this.kneel ? 1 : 0) - this.kneelT) * Math.min(1, dt * 1.5);
    // Indicators.
    this.blink += dt; if (this.blink > 0.38) { this.blink = 0; this.blinkOn = !this.blinkOn; if (this.indicator || this.hazards) this.bus.emit('bus:tick', this.blinkOn); }
    // Self-cancelling indicator after a completed turn.
    if (this.indicator && Math.abs(this.ph.wheel) > 4) this.turnArmed = true;
    if (this.indicator && this.turnArmed && Math.abs(this.ph.wheel) < 1.2) { this.indicator = null; this.turnArmed = false; this.bus.emit('bus:indicator', null); }
    // Wipers.
    if (this.wipers) this.wiperPhase += dt * [0, 0.45, 0.9, 1.4][this.wipers] * Math.PI * 2;
    // Air: compressor when the engine runs; brake applications consume air.
    const prevP = this.ph.brakeP;
    // Throttle limits: kneeling → walking pace, emergency → full brake.
    const c = { ...controls };
    if (this.kneelT > 0.2 && Math.abs(this.speed) > 1.4) c.throttle = 0;
    if (this.emergency) { c.throttle = 0; c.brake = 1; }
    if (!this.engineOn) c.throttle = 0;
    this.ph.mu = env.mu; this.ph.grade = env.grade || 0;
    this.ph.step(dt, c, {
      engineOn: this.engineOn, gearSel: this.gearSel, parking: this.parking || this.airPressure < 5.5,
      doorBrake: !this.doorsClosed, airPressure: this.airPressure, kneel: this.kneelT > 0.5, hybridSoc: this.hybridSoc,
      onShift: (g) => this.bus.emit('bus:shift', g),
    });
    const used = Math.max(0, this.ph.brakeP - prevP) * 0.9;
    this.airPressure = clamp(this.airPressure - used + (this.engineOn ? 0.35 * dt : 0), 0, 10);
    // Energy.
    const P = this.ph.lastPower || { drive: 0, regen: 0 };
    if (this.electric) {
      const kw = Math.max(0, P.drive) / 1000 / 0.9 - P.regen / 1000 * 0.65 + (this.engineOn ? this.spec.auxPower ?? 8 : 0);
      this.energy = clamp(this.energy - (kw * dt) / 3600, 0, this.energyMax);
    } else if (this.engineOn) {
      const kw = Math.max(0, P.drive) / 1000;
      const lph = 2.2 + kw * 0.21 / 0.835 * (this.spec.powertrain === 'hybrid' ? 0.8 : 1);
      this.energy = clamp(this.energy - (lph * dt) / 3600, 0, this.energyMax);
      if (this.spec.powertrain === 'hybrid') this.hybridSoc = clamp(this.hybridSoc + (P.regen / 1000 * 0.6 - (Math.abs(this.speed) < 9 ? Math.max(0, P.drive) / 1000 * 0.25 : -3)) * dt / 3600 / (this.spec.battery || 25), 0, 1);
    }
    if (this.engineOn && this.energy <= 0) { this.engineOn = false; this.bus.emit('bus:engine', false); this.bus.emit('bus:refused', this.electric ? 'Battery empty' : 'Out of fuel'); }
    // Coolant temperature warms with load.
    const tgt = this.engineOn ? (this.electric ? 40 : 82 + Math.max(0, P.drive) / 1000 * 0.03) : 20;
    this.coolant += (tgt - this.coolant) * dt * (this.engineOn ? 0.02 : 0.004);
    // Wear.
    this.condition = clamp(this.condition - Math.abs(this.speed) * dt * 2e-7, 0, 1);
    this.cleanliness = clamp(this.cleanliness - Math.abs(this.speed) * dt * (env.wet ? 1.2e-6 : 3e-7), 0, 1);
  }

  /** Front-door position (world) — where boarding passengers go, and the stopping reference. */
  doorWorld(i) {
    const ph = this.ph, h = ph.heading(), sp = this.spec;
    const front = ph.lf + sp.frontOverhang;
    const f = front - this.doors[i].pos;
    if (sp.trailerLength && this.doors[i].pos > sp.length - 0.5) {
      const hb = ph.lr + (sp.hitchBehindRear ?? 2);
      const hx = ph.x - h.fx * hb, hz = ph.z - h.fz * hb;
      const along = this.doors[i].pos - (front + hb);
      return { x: hx - Math.sin(ph.trailerYaw) * along + Math.cos(ph.trailerYaw) * sp.width / 2, z: hz + Math.cos(ph.trailerYaw) * along + Math.sin(ph.trailerYaw) * sp.width / 2 };
    }
    return { x: ph.x + h.fx * f + h.rx * sp.width / 2, z: ph.z + h.fz * f + h.rz * sp.width / 2 };
  }
}
