// Longitudinal train dynamics. Integrates traction, braking, running resistance (Davis),
// gradient and curve resistance with realistic actuator lag (dead time + ramp), so the
// train can never accelerate or stop instantaneously.
import { clamp } from '../core/util.js';

const G = 9.81;
const ROTARY_MASS = 1.08;       // rotating-mass allowance
const ADHESION_TRACTION = 0.24; // dry rail
const ADHESION_BRAKE = 0.2;

/** Door centres (car frame, +z = front): evenly spread between end margins that leave room for a cab. */
export function doorCentres(L, dps, dw) {
  const M = Math.min(1.75, Math.max(0.6, (L - dps * (dw + 0.8)) / 2));
  return Array.from({ length: dps }, (_, d) => L / 2 - M - ((L - 2 * M) * (d + 0.5)) / dps);
}

export function deriveTrainSpecs(t) {
  const cars = t.carLengths?.length ?? t.cars ?? 5;
  const gap = t.carGap ?? 0.9;
  // Cars of different lengths (articulated trainsets: power cars longer than trailers) or all the same.
  const carLengths = t.carLengths ? [...t.carLengths] : Array(cars).fill(t.carLength ?? 15);
  const carLength = carLengths.reduce((a, b) => a + b, 0) / cars;
  const carStart = []; { let s = 0; for (const L of carLengths) { carStart.push(s); s += L + gap; } }   // from the front
  const length = carLengths.reduce((a, b) => a + b, 0) + (cars - 1) * gap;
  // Doors measured from the train's front: explicit (passenger cars only) or evenly spread on every car.
  const doorList = t.doorFromFront != null
    ? carStart.flatMap((s0, c) => (c >= (t.passengerCars?.[0] ?? 0) && c <= (t.passengerCars?.[1] ?? cars - 1) ? [s0 + t.doorFromFront] : []))
    : null;
  const massEmpty = t.massEmpty ?? cars * 27;
  return {
    ...t,
    cars, carLength, carLengths, carStart, doorList, carGap: gap, length, massEmpty,
    width: t.width ?? 2.6,
    height: t.height ?? 3.5,
    doorsPerSide: t.doorsPerSide ?? 3,
    doorWidth: t.doorWidth ?? 1.3,
    // Door centres in the car frame (+z = front), spread over the car length clear of the drivers' cabs.
    doorZ: doorCentres(carLength, t.doorsPerSide ?? 3, t.doorWidth ?? 1.3),
    capacity: t.capacity ?? cars * 140,
    maxPower: t.maxPower ?? 1600,          // kW at wheel
    maxTractiveForce: t.maxTractiveForce ?? 180, // kN
    maxSpeed: t.maxSpeed ?? 80,
    serviceDecel: t.serviceDecel ?? 1.15,
    emergencyDecel: t.emergencyDecel ?? 1.45,
    tractionNotches: t.tractionNotches ?? 4,
    brakeNotches: t.brakeNotches ?? 7,
    tractionResponse: t.tractionResponse ?? 0.9, // s for 0 -> full
    brakeResponse: t.brakeResponse ?? 1.1,
    tractionDeadTime: t.tractionDeadTime ?? 0.25,
    brakeDeadTime: t.brakeDeadTime ?? 0.4,
    davis: { a: 11, b: 0.07, c: 0.55, ...(t.davis || {}) },
    maxAccel: ((t.maxTractiveForce ?? 180) * 1000) / (massEmpty * 1000 * ROTARY_MASS),
  };
}

export class TrainPhysics {
  constructor(specs, route) {
    this.specs = specs;
    this.route = route;
    this.s = 0; this.v = 0; this.a = 0; this.jerk = 0;
    this.traction = 0; this.brake = 0; this.eb = 0;  // actual (0..1) after lag
    this.cmd = { traction: 0, brake: 0, emergency: false };
    this.history = [];
    this.time = 0;
    this.payload = 0;   // kg of passengers
    this.wheelSlip = false;
    this.forces = { traction: 0, brake: 0, resistance: 0, gradient: 0, curve: 0 };
    this.odometer = 0;
  }
  get mass() { return this.specs.massEmpty * 1000 + this.payload; }

  setCommand(traction, brake, emergency) {
    this.cmd.traction = clamp(traction, 0, 1);
    this.cmd.brake = clamp(brake, 0, 1);
    this.cmd.emergency = !!emergency;
  }

  _delayed(dead) {
    const target = this.time - dead;
    let found = this.history[0];
    for (let i = this.history.length - 1; i >= 0; i--) { if (this.history[i].t <= target) { found = this.history[i]; break; } }
    return found;
  }

  step(dt) {
    const sp = this.specs;
    this.time += dt;
    this.history.push({ t: this.time, ...this.cmd });
    while (this.history.length > 2 && this.history[1].t < this.time - 1.5) this.history.shift();

    // Actuator response: dead time then ramp.
    const tCmd = this._delayed(sp.tractionDeadTime).traction;
    const bCmdD = this._delayed(sp.brakeDeadTime);
    const rampT = dt / sp.tractionResponse;
    this.traction += clamp(tCmd - this.traction, -rampT * 2.5, rampT);
    const rampB = dt / sp.brakeResponse;
    this.brake += clamp(bCmdD.brake - this.brake, -rampB * 1.6, rampB);
    const ebTarget = this.cmd.emergency ? 1 : 0; // EB valve acts with minimal delay
    this.eb += clamp(ebTarget - this.eb, -dt / 1.5, dt / 0.6);

    const m = this.mass, mEff = m * ROTARY_MASS;
    const v = this.v, vk = Math.abs(v) * 3.6;

    // Traction: constant force up to base speed, then constant power, tapered at max speed.
    const fMax = sp.maxTractiveForce * 1000, p = sp.maxPower * 1000;
    let fAvail = Math.abs(v) < 0.5 ? fMax : Math.min(fMax, p / Math.abs(v));
    fAvail *= clamp((sp.maxSpeed + 2 - vk) / 4, 0, 1);
    let ft = this.traction * fAvail;
    const adh = ADHESION_TRACTION * m * G;
    this.wheelSlip = ft > adh;
    if (this.wheelSlip) ft = adh * 0.85;

    // Braking (service blended electro-pneumatic + emergency).
    let fb = Math.max(this.brake * sp.serviceDecel, this.eb * sp.emergencyDecel) * mEff;
    fb = Math.min(fb, ADHESION_BRAKE * m * G);

    // Resistances.
    const tons = m / 1000;
    const inTunnel = this.route.geom?.outdoorAt?.(this.s - sp.length / 2) ? 1.0 : 1.35; // tunnel air drag
    const fr = tons * (sp.davis.a + sp.davis.b * vk) + sp.davis.c * (sp.cars / 5) * vk * vk * inTunnel;
    const grad = this.route.gradientAt(this.s - sp.length / 2);
    const fg = m * G * (grad / 1000);
    const R = this.route.radiusAt(this.s - sp.length / 2);
    const rc = R === Infinity ? 0 : R > 300 ? 650 / (R - 55) : 500 / Math.max(R - 30, 30);
    const fc = m * G * (rc / 1000);
    this.forces = { traction: ft, brake: fb, resistance: fr, gradient: fg, curve: fc };

    const aPrev = this.a;
    const drive = ft - fg; // forces independent of motion direction
    const oppose = fb + fr + fc; // forces opposing motion
    if (Math.abs(v) < 1e-3) {
      // Static: brakes/friction hold the train unless the drive force overcomes them.
      if (Math.abs(drive) <= oppose) { this.v = 0; this.a = 0; }
      else { this.a = (drive - Math.sign(drive) * oppose) / mEff; this.v = this.a * dt; }
    } else {
      const dir = Math.sign(v);
      this.a = (drive - dir * oppose) / mEff;
      const nv = v + this.a * dt;
      this.v = Math.sign(nv) !== dir ? 0 : nv; // brakes stop the train, never reverse it
    }
    this.v = Math.max(this.v, -1.5);
    const ds = this.v * dt;
    this.s += ds;
    this.odometer += Math.abs(ds);
    const j = (this.a - aPrev) / dt;
    this.jerk += (j - this.jerk) * Math.min(1, dt * 4);
  }
}
