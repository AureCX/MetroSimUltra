// Bus dynamics: dynamic bicycle model with saturating tyre forces (blended to a kinematic model
// at walking pace), torque-converter automatic gearbox or electric drive, air brakes with
// build-up delay and ABS-limited grip, retarder, rolling/air/grade resistance, speed-dependent
// steering, chassis pitch/roll on springs, and a kinematic trailer for articulated buses.
import { clamp } from '../core/util.js';

const G = 9.81;
export const SURFACE_MU = { dry: 0.85, wet: 0.62, heavyRain: 0.52, snow: 0.28, fog: 0.85 };

export class BusPhysics {
  constructor(spec) {
    this.spec = spec;
    const wb = spec.wheelbase;
    this.lf = wb * 0.58; this.lr = wb * 0.42;              // engine at the rear → CG behind mid-wheelbase
    this.x = 0; this.z = 0; this.yaw = 0;                  // yaw: 0 = facing −z (north)
    this.vx = 0; this.vy = 0; this.r = 0;                  // body-frame velocities, yaw rate
    this.ax = 0; this.ay = 0; this.jerk = 0;
    this.delta = 0;                                         // front wheel angle (rad)
    this.wheel = 0;                                         // steering-wheel angle (rad), ratio ~18:1
    this.brakeP = 0;                                        // brake cylinder pressure 0..1
    this.gear = 1; this.shiftT = 0; this.rpm = spec.idleRpm || 0;
    this.trailerYaw = 0;                                    // articulated: trailer heading
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0; this.heave = 0; this.heaveV = 0;
    this.mu = SURFACE_MU.dry;
    this.grade = 0;                                         // ‰ (positive uphill)
    this.payload = 0;                                       // kg
    this.wheelSpin = 0;
    this.slipping = false;
    this.distance = 0;
  }
  get mass() { return this.spec.mass + this.payload; }
  get speed() { return this.vx; }
  heading() { return { fx: Math.sin(this.yaw), fz: -Math.cos(this.yaw), rx: Math.cos(this.yaw), rz: Math.sin(this.yaw) }; }

  /** Engine / motor force at the wheels (N) for a throttle 0..1, updates gear & rpm. */
  driveForce(throttle, dt, sys) {
    const sp = this.spec, v = Math.abs(this.vx), R = 0.5;
    if (sys.gearSel === 'N' || !sys.engineOn) { this.rpm += ((sys.engineOn && sp.idleRpm ? sp.idleRpm + throttle * 1400 : 0) - this.rpm) * Math.min(1, dt * 3); return 0; }
    const dirSign = sys.gearSel === 'R' ? -1 : 1;
    if (sp.powertrain === 'electric') {
      const P = sp.power * 1000, Fmax = (sp.torque * 9.5) / R;
      this.rpm = v * 3.6 * 60; // motor speed display only
      const F = Math.min(Fmax, P / Math.max(v, 1.5)) * throttle * clamp((sp.maxSpeed / 3.6 - v) / 2, 0, 1);
      return dirSign * F * (sys.gearSel === 'R' ? 0.35 : 1);
    }
    // Diesel (and hybrid): automatic gearbox with torque converter.
    const ratios = sp.gears, fd = sp.finalDrive;
    const wheelRpm = (v / (2 * Math.PI * R)) * 60;
    if (sys.gearSel === 'R') this.gear = 1;
    else if (this.shiftT <= 0) {
      const up = 1500 + throttle * 600, down = 900 + throttle * 350;
      const rpmIn = (g) => wheelRpm * ratios[g - 1] * fd;
      if (this.gear < ratios.length && rpmIn(this.gear) > up) { this.gear++; this.shiftT = 0.6; sys.onShift?.(this.gear); }
      else if (this.gear > 1 && rpmIn(this.gear) < down) { this.gear--; this.shiftT = 0.45; sys.onShift?.(this.gear); }
    }
    this.shiftT -= dt;
    const ratio = ratios[this.gear - 1] * fd;
    const coupled = wheelRpm * ratio;
    // Torque converter: engine can run above the coupled speed; multiplication at stall.
    const stallRpm = sp.idleRpm + throttle * 1100;
    const engRpm = Math.max(coupled, this.gear === 1 ? stallRpm : coupled, sp.idleRpm);
    this.rpm += (Math.min(engRpm, sp.maxRpm) - this.rpm) * Math.min(1, dt * 6);
    const n = this.rpm;
    const tq = sp.torque * (n < 1000 ? 0.65 + 0.35 * (n - 600) / 400 : n < 1600 ? 1 : Math.max(0.3, 1 - (n - 1600) / 1400));
    const conv = this.gear === 1 && coupled < stallRpm ? 1 + 0.9 * (1 - coupled / stallRpm) : 1;
    let F = (tq * throttle * ratio * conv * 0.9) / R;
    if (this.shiftT > 0.25) F *= 0.15;                     // torque interruption during shifts
    if (sp.powertrain === 'hybrid' && v < 9) F += Math.min((sp.torque * 4) / R, (sp.electricPower * 1000) / Math.max(v, 1.5)) * throttle * (sys.hybridSoc > 0.05 ? 1 : 0);
    F *= clamp((sp.maxSpeed / 3.6 - v) / 2, 0, 1);
    return dirSign * F * (sys.gearSel === 'R' ? 0.4 : 1);
  }

  /**
   * controls: { throttle 0..1, brake 0..1, wheelTarget (rad, steering wheel) }
   * sys: { engineOn, gearSel 'D'|'N'|'R', parking, doorBrake, retarder, ... }
   */
  step(dt, controls, sys) {
    const sp = this.spec, m = this.mass, Iz = m * (sp.length * sp.length) / 14;
    const v = this.vx;
    // Steering: wheel turns at a rate that drops with speed; front wheels follow via ratio.
    const rate = (sys.steerRate ?? 10) * (1 / (1 + Math.abs(v) / 14));
    this.wheel += clamp(controls.wheelTarget - this.wheel, -rate * dt, rate * dt);
    const maxWheel = sp.steerMax * 18;
    this.wheel = clamp(this.wheel, -maxWheel, maxWheel);
    this.delta = this.wheel / 18;

    // Air brakes: pressure follows the pedal with a short delay; parking & door brakes use springs.
    let pTarget = controls.brake;
    if (sys.doorBrake) pTarget = Math.max(pTarget, 0.35);
    const fill = pTarget > this.brakeP ? 2.6 : 4.0;
    this.brakeP += clamp(pTarget - this.brakeP, -fill * dt, fill * dt * (sys.airPressure > 6.5 ? 1 : 0.3));
    const throttle = sys.doorBrake || sys.parking ? 0 : controls.throttle;
    let Fx = this.driveForce(throttle, dt, sys);
    // Drive-away limiter (city buses cap launch acceleration for standing passengers).
    const aCap = (sp.maxAccel ?? 1.25) * m;
    Fx = clamp(Fx, -aCap, aCap);
    // Electric/hybrid regenerative braking and diesel retarder on the first part of the pedal.
    const vabs = Math.abs(v);
    let regen = 0;
    if (sp.powertrain !== 'diesel' && vabs > 1) regen = Math.min(controls.brake * 1.4 + (controls.throttle === 0 ? 0.04 * (sys.retarderLevel ?? 1) : 0), 1) * (sp.regen ?? 0.5) * m * 1.2;
    const retarder = sp.powertrain === 'diesel' && vabs > 2 ? clamp(controls.brake * 3, 0, 1) * 0.07 * m * G + (controls.throttle === 0 ? 0.008 * (sys.retarderLevel ?? 1) * m * G : 0) : 0;
    let Fb = this.brakeP * sp.brakeDecel * m + regen + retarder;
    if (sys.parking) Fb = Math.max(Fb, 0.8 * m * G);
    const gripMax = this.mu * m * G;
    this.slipping = Fb > gripMax * 0.98 || Math.abs(Fx) > this.mu * m * G * 0.6;
    Fb = Math.min(Fb, gripMax * 0.95); // ABS
    Fx = clamp(Fx, -this.mu * m * G * 0.6, this.mu * m * G * 0.6);
    const Fres = 0.008 * m * G + 0.5 * 1.2 * 0.7 * sp.width * sp.height * v * v;
    const Fgrade = m * G * (this.grade / 1000);
    this.lastPower = { drive: Fx * v, regen: regen * vabs };

    // Longitudinal.
    const prevAx = this.ax;
    let along = Fx - Fgrade;
    const resist = Fb + Fres;
    if (vabs < 0.05 && Math.abs(along) <= resist) { this.vx = 0; this.ax = 0; }
    else {
      const sgn = vabs < 0.05 ? Math.sign(along) : Math.sign(v);
      const a = (along - sgn * resist) / m;
      const nv = v + a * dt;
      this.vx = vabs > 0.05 && Math.sign(nv) !== Math.sign(v) && Fb > Math.abs(along) ? 0 : nv;
      this.ax = (this.vx - v) / dt;
    }

    // Lateral / yaw: kinematic at low speed, dynamic (with tyre saturation) above.
    const vxs = this.vx;
    const kin = clamp(1 - (Math.abs(vxs) - 2) / 4, 0, 1);
    const L = sp.wheelbase;
    const rKin = (vxs * Math.tan(this.delta)) / L, vyKin = rKin * this.lr;
    let rDyn = this.r, vyDyn = this.vy;
    if (kin < 1) {
      const Fzf = (m * G * this.lr) / L, Fzr = (m * G * this.lf) / L;
      const Cf = 7 * Fzf, Cr = 8 * Fzr;
      const u = Math.max(2, Math.abs(vxs)) * Math.sign(vxs || 1);
      const af = Math.atan2(this.vy + this.lf * this.r, Math.abs(u)) * Math.sign(u) - this.delta;
      const ar = Math.atan2(this.vy - this.lr * this.r, Math.abs(u)) * Math.sign(u);
      const sat = (F, Fmax) => Fmax * Math.tanh(F / Fmax);
      const Fyf = sat(-Cf * af, this.mu * Fzf), Fyr = sat(-Cr * ar, this.mu * Fzr);
      const dvy = (Fyf * Math.cos(this.delta) + Fyr) / m - vxs * this.r;
      const dr = (this.lf * Fyf * Math.cos(this.delta) - this.lr * Fyr) / Iz;
      vyDyn = this.vy + dvy * dt; rDyn = this.r + dr * dt;
    }
    this.r = rKin * kin + rDyn * (1 - kin);
    this.vy = vyKin * kin + vyDyn * (1 - kin);
    this.ay = this.vx * this.r + (this.vy - (this.prevVy ?? this.vy)) / dt;
    this.prevVy = this.vy;

    // Integrate pose (yaw 0 = facing −z).
    this.yaw += this.r * dt;
    const h = this.heading();
    this.x += (h.fx * this.vx + h.rx * this.vy) * dt;
    this.z += (h.fz * this.vx + h.rz * this.vy) * dt;
    this.distance += Math.abs(this.vx) * dt;
    this.wheelSpin += (this.vx / 0.5) * dt;
    const j = (this.ax - prevAx) / dt;
    this.jerk += (j - this.jerk) * Math.min(1, dt * 5);

    // Articulated: trailer follows the hitch.
    if (sp.trailerLength) {
      const hb = this.lr + (sp.hitchBehindRear ?? 2), Lt = sp.trailerAxle ?? 5.5;
      const phi = this.yaw - this.trailerYaw;
      const dTy = (this.vx / Lt) * Math.sin(phi) - ((hb * this.r) / Lt) * Math.cos(phi);
      this.trailerYaw += dTy * dt;
      const lim = 0.85;
      this.trailerYaw = this.yaw - clamp(Math.atan2(Math.sin(this.yaw - this.trailerYaw), Math.cos(this.yaw - this.trailerYaw)), -lim, lim);
    }

    // Suspension (visual body motion): pitch on accel/brake, roll on lateral accel.
    const kRoll = 1 / (sp.rollStiffness ?? 1);
    const tgtPitch = clamp(-this.ax * 0.0065, -0.035, 0.035);
    const tgtRoll = clamp(this.ay * 0.0075 * kRoll * (sp.height / 3.1), -0.07, 0.07) + (sys.kneel ? 0.012 : 0);
    const spring = (val, vel, tgt, w, z) => { const acc = w * w * (tgt - val) - 2 * z * w * vel; vel += acc * dt; return [val + vel * dt, vel]; };
    [this.pitch, this.pitchV] = spring(this.pitch, this.pitchV, tgtPitch, 7, 0.35);
    [this.roll, this.rollV] = spring(this.roll, this.rollV, tgtRoll, 5.5, 0.3);
    [this.heave, this.heaveV] = spring(this.heave, this.heaveV, sys.kneel ? -0.07 : 0, 6, 0.6);
  }

  /** Corners of the front section (and trailer) footprint, for collisions. */
  footprint() {
    const sp = this.spec, h = this.heading();
    const front = this.lf + sp.frontOverhang, rear = sp.length - front;
    const W = sp.width / 2;
    const c = (f, l) => ({ x: this.x + h.fx * f + h.rx * l, z: this.z + h.fz * f + h.rz * l });
    const boxes = [{ pts: [c(front, -W), c(front, W), c(-rear, W), c(-rear, -W)], cx: this.x + h.fx * (front - rear) / 2, cz: this.z + h.fz * (front - rear) / 2 }];
    if (sp.trailerLength) {
      const hb = this.lr + (sp.hitchBehindRear ?? 2);
      const hx = this.x - h.fx * hb, hz = this.z - h.fz * hb;
      const tf = Math.sin(this.trailerYaw), tz = -Math.cos(this.trailerYaw), tr = Math.cos(this.trailerYaw), trz = Math.sin(this.trailerYaw);
      const t = (f, l) => ({ x: hx + tf * f + tr * l, z: hz + tz * f + trz * l });
      boxes.push({ pts: [t(-0.3, -W), t(-0.3, W), t(-sp.trailerLength, W), t(-sp.trailerLength, -W)], cx: hx - tf * sp.trailerLength / 2, cz: hz - tz * sp.trailerLength / 2 });
    }
    return boxes;
  }
}
