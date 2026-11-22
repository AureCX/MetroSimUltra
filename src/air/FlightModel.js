// Flight dynamics of a transport aircraft (one rigid body, six degrees of freedom).
//
// World frame: x east, y up, z south (metres). Body frame: +X left wing, +Y up, +Z nose (right-handed).
// Forces: lift and drag from the airflow (airspeed relative to the wind, angle of attack, sideslip), with flaps,
// spoilers, gear and ground effect; thrust from the engines (spool-up lag, density lapse, reverse); weight
// (empty + fuel + payload, fuel burnt in flight); landing-gear contact with rolling friction, wheel brakes (dry /
// wet runway), nose-wheel steering. Moments: pitch stability around the trimmed angle of attack, elevator, trim,
// pitch damping; roll from ailerons with damping and dihedral effect; yaw from rudder and weathercock stability.
// Coefficients are normalised by the dynamic pressure, so the handling changes with speed and altitude, and each
// type has its own mass, wing, engines and authority. Stalls happen past the critical angle of attack (lift
// collapses, buffet). The autopilot only moves the controls, like a pilot.
const G = 9.81, RHO0 = 1.225, D2R = Math.PI / 180;

// ---- small vector / quaternion helpers (no three.js: also runs in the tests) ----
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const scl = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const qmul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qnorm = (q) => { const l = Math.hypot(q.w, q.x, q.y, q.z) || 1; return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l }; };
/** Rotate v by q (body → world). */
export function qrot(q, v) {
  const u = { x: q.x, y: q.y, z: q.z }, s = q.w;
  const uv = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const uuv = { x: u.y * uv.z - u.z * uv.y, y: u.z * uv.x - u.x * uv.z, z: u.x * uv.y - u.y * uv.x };
  return { x: v.x + 2 * (s * uv.x + uuv.x), y: v.y + 2 * (s * uv.y + uuv.y), z: v.z + 2 * (s * uv.z + uuv.z) };
}
const qinv = (q) => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
/** Quaternion from compass heading (deg), pitch (deg, nose up +), bank (deg, right wing down +). */
export function qFromHPB(h, p, b) {
  // yaw about +Y: compass heading h means the nose (+Z body) points to (sin h, 0, −cos h): rotation angle π − h.
  const yaw = (Math.PI - h * D2R), qy = { w: Math.cos(yaw / 2), x: 0, y: Math.sin(yaw / 2), z: 0 };
  const qx = { w: Math.cos(-p * D2R / 2), x: Math.sin(-p * D2R / 2), y: 0, z: 0 };   // +X rotation = nose down
  const qz = { w: Math.cos(b * D2R / 2), x: 0, y: 0, z: Math.sin(b * D2R / 2) };     // +Z rotation = right wing down
  return qnorm(qmul(qmul(qy, qx), qz));
}
/** Heading (deg), pitch (deg), bank (deg) of an attitude quaternion. */
export function hpb(q) {
  const f = qrot(q, v3(0, 0, 1)), l = qrot(q, v3(1, 0, 0)), u = qrot(q, v3(0, 1, 0));
  const h = ((Math.atan2(f.x, -f.z) / D2R) + 360) % 360;
  const p = Math.asin(Math.max(-1, Math.min(1, f.y))) / D2R;
  // bank: angle of the wings to the horizon (right wing down = +)
  const b = Math.atan2(l.y, u.y) / D2R;
  return { h, p, b, f, l, u };
}
export const density = (alt) => RHO0 * Math.exp(-Math.max(0, alt) / 8500);
export const KT = 1.94384, FT = 3.28084;

/** Smooth 1-D noise for turbulence. */
function noise1(t, seed) { const i = Math.floor(t), f = t - i, h = (n) => { let x = Math.sin((n + seed * 131.7) * 127.1) * 43758.5453; return x - Math.floor(x); }; const s = f * f * (3 - 2 * f); return (h(i) * (1 - s) + h(i + 1) * s) * 2 - 1; }

export class FlightModel {
  /**
   * spec: aircraft type (AirData.AIRCRAFT). env: { ground(x, z) → terrain height, wind() → { dir, speed, gust,
   * turb } (dir = where it blows FROM, deg), wet: () → bool }.
   */
  constructor(spec, env = {}) {
    this.spec = spec; this.env = env;
    this.pos = v3(); this.vel = v3(); this.q = qFromHPB(0, 0, 0);
    this.p = 0; this.qr = 0; this.r = 0;                   // body rates: roll right, pitch up, yaw right (rad/s)
    // Controls (pilot + autopilot): -1..1, throttle 0..1, flaps index, gear 0/1 (1 = down), spoilers 0..1.
    this.ctl = { elev: 0, ail: 0, rud: 0, throttle: 0, brake: 0, parking: true, reverse: false, trim: 0 };
    this.flapIdx = 0; this.flapPos = 0; this.gearCmd = 1; this.gearPos = 1; this.spoilerCmd = 0; this.spoilerPos = 0; this.spoilersArmed = false;
    this.fuel = spec.fuelMax * 0.5; this.payload = spec.seats * 90 * 0.7;
    this.engines = Array.from({ length: spec.engines }, () => ({ running: false, starting: 0, n1: 0, n2: 0 }));
    this.onGround = true; this.time = 0; this.seed = Math.random() * 100;
    this.events = [];                                      // { type: 'touchdown' | 'crash' | 'tailstrike' | ..., ... }
    this.stall = false; this.lastTouchdown = null; this.damage = 0; this.crashed = false;
    this.ap = new Autopilot(this);
    this.autoTrim = false;   // the load-factor law already holds the flight path with the stick released
    this.out = {};
  }
  get mass() { return this.spec.massEmpty + this.fuel + this.payload; }
  get flapFrac() { return this.flapPos / Math.max(1, this.spec.flaps.length - 1); }

  /** Place the aircraft on the ground at (x, z), heading hdg, gear down, at rest. */
  placeOnGround(x, z, hdg) {
    const gh = this.env.ground ? this.env.ground(x, z) : 0;
    this.pos = v3(x, gh + this.spec.gearHeight, z); this.vel = v3(); this.q = qFromHPB(hdg, 0, 0);
    this.p = this.qr = this.r = 0; this.onGround = true; this.gearCmd = this.gearPos = 1;
  }
  /** Place in flight (for tests / airborne starts). */
  placeInFlight(x, alt, z, hdg, speed) {
    this.pos = v3(x, alt, z); this.q = qFromHPB(hdg, 2, 0);
    const f = qrot(this.q, v3(0, 0, 1)); this.vel = scl({ x: f.x, y: 0, z: f.z }, speed);
    this.onGround = false; this.gearCmd = this.gearPos = 0; this.ctl.parking = false;
    for (const e of this.engines) { e.running = true; e.n1 = e.n2 = 0.75; }
  }

  // ---- engines ----
  startEngines() { for (const e of this.engines) if (!e.running && e.starting <= 0 && this.fuel > 0) e.starting = 0.001; }
  stopEngines() { for (const e of this.engines) { e.running = false; e.starting = 0; } }
  get enginesRunning() { return this.engines.every((e) => e.running); }

  /** One integration step (dt ≈ 1/120 s). */
  step(dt) {
    const S = this.spec, c = this.ctl; this.time += dt;
    if (this.crashed) { this.vel = scl(this.vel, Math.max(0, 1 - dt * 2)); this.pos = add(this.pos, this.vel, dt); return; }
    // Autopilot moves the controls.
    this.ap.update(dt);
    // Auto-trim (pitch): with the stick released in flight, the trim holds the current flight path.
    if (this.autoTrim && !this.onGround && !(this.ap.on) && Math.abs(c.pilotElev || 0) < 0.03 && this.out.att) {
      if (this.fpHold == null) this.fpHold = this.out.vs;
      c.trim = Math.max(-0.8, Math.min(0.8, c.trim + ((this.fpHold - this.out.vs) * 0.004 - this.qr * 0.6) * dt * 6));
    } else this.fpHold = null;
    // Actuators: flaps (~2 s per notch), gear (~10 s), spoilers.
    this.flapPos += Math.max(-dt * 0.5, Math.min(dt * 0.5, this.flapIdx - this.flapPos));
    this.gearPos += Math.max(-dt / 9, Math.min(dt / 9, this.gearCmd - this.gearPos));
    this.spoilerPos += Math.max(-dt * 1.5, Math.min(dt * 1.5, this.spoilerCmd - this.spoilerPos));
    // Engines: start sequence, spool (jets slower than turboprops), fuel flow.
    const jet = S.kind === 'jet', spool = jet ? 0.22 : 0.45;
    let thrustFrac = 0;
    for (const e of this.engines) {
      if (e.starting > 0) { e.starting += dt; e.n2 = Math.min(0.6, e.n2 + dt * 0.03); e.n1 = Math.min(0.22, e.n1 + dt * 0.012); if (e.starting > (jet ? 30 : 18)) { e.running = true; e.starting = 0; } }
      if (this.fuel <= 0) e.running = false;
      const target = e.running ? 0.21 + 0.79 * c.throttle : 0;
      e.n1 += Math.max(-dt * spool * 1.3, Math.min(dt * spool, target - e.n1));
      e.n2 = e.running ? 0.6 + e.n1 * 0.4 : Math.max(0, e.n2 - dt * 0.05);
      thrustFrac += e.running ? Math.pow(Math.max(0, (e.n1 - 0.21) / 0.79), 1.5) : 0;   // thrust rises faster than N1
      if (e.running) this.fuel = Math.max(0, this.fuel - (S.fuelBurn / S.engines / 3600) * (0.3 + 1.1 * e.n1 * e.n1) * dt);
    }
    thrustFrac /= S.engines;
    const idle = this.engines.filter((e) => e.running).length / S.engines * 0.04;

    // Air data.
    const alt = this.pos.y, rho = density(alt), w = this.windVec(alt);
    const vAir = add(this.vel, w, -1), qi = qinv(this.q), vb = qrot(qi, vAir);
    const V = Math.max(0.01, len(vb));
    // Below ~10 m/s of forward airflow (parked, tailwind) the angles are meaningless: taken as zero.
    const flowK = Math.max(0, Math.min(1, (vb.z - 4) / 8));
    const alpha = Math.atan2(-vb.y, Math.max(0.1, vb.z)) * flowK, beta = Math.atan2(vb.x, Math.max(0.1, vb.z)) * flowK;
    const qbar = 0.5 * rho * V * V;
    // Lift / drag coefficients.
    const ff = this.flapFrac, clmax = S.clmax + ff * (S.clmaxFlaps - S.clmax), cl0 = S.cl0 + ff * (S.clmaxFlaps - S.clmax) * 0.45;
    const aStall = (clmax - cl0) / S.cla;
    let CL = cl0 + S.cla * alpha;
    this.stall = alpha > aStall && !this.onGround;
    if (alpha > aStall) CL = clmax - (alpha - aStall) * S.cla * 1.1;
    if (alpha < -0.2) CL = cl0 + S.cla * -0.2 + (alpha + 0.2) * S.cla * -0.5;
    CL = Math.max(-1.2, CL) * (1 - 0.45 * this.spoilerPos);
    const hAGL = this.agl();
    const ge = hAGL < S.span ? 1 - 0.4 * (1 - hAGL / S.span) ** 2 : 1;          // ground effect: less induced drag
    if (hAGL < S.span * 0.5) CL *= 1 + 0.08 * (1 - hAGL / (S.span * 0.5));
    const CD = S.cd0 + S.k * CL * CL * ge + ff * 0.065 + this.gearPos * S.gearDrag + this.spoilerPos * 0.09 + Math.abs(beta) * 0.25 + (this.stall ? 0.12 : 0);
    // Forces in body frame.
    const vh = scl(vb, 1 / V);
    const up = v3(0, 1, 0), liftDir = (() => { const d = add(up, vh, -dot(up, vh)); const l = len(d) || 1; return scl(d, 1 / l); })();
    let Fb = add(scl(liftDir, qbar * S.wingArea * CL), vh, -qbar * S.wingArea * CD);
    Fb = add(Fb, v3(1, 0, 0), -qbar * S.wingArea * 0.6 * beta * 0.5);              // side force
    // Thrust.
    const lapse = Math.pow(rho / RHO0, jet ? 0.75 : 0.7);
    // Jet thrust falls with speed (ram drag), less so at altitude.
    let T = S.thrust * (idle + thrustFrac) * lapse * (jet ? Math.max(0.55, 1 - V * 0.0026 * (rho / RHO0) - 0.1 * Math.min(1, V / 250)) : 1);
    if (!jet && S.power) T = Math.min(T, (S.power * 0.8 * (idle + thrustFrac) * lapse) / Math.max(V, 35));
    if (c.reverse && this.onGround) T = -T * 0.45;
    this.thrust = T;
    Fb = add(Fb, v3(0, 0, 1), T);
    // To world, plus gravity.
    let F = qrot(this.q, Fb);
    F = add(F, v3(0, -this.mass * G, 0));
    // Moments (normalised): pitch, roll, yaw angular accelerations.
    const qn = qbar / (0.5 * RHO0 * S.vref * S.vref), sq = Math.sqrt(Math.max(qn, 0.02));
    const att0 = hpb(this.q), onGroundNow = this.onGround;
    const stallBuffet = this.stall ? noise1(this.time * 9, 3) * 0.6 : 0;
    // Elevator = load-factor demand (fly-by-wire / C* style): neutral stick holds 1 g along the flight path, full pull
    // asks ~2.5 g, full push ~−0.5 g; at low speed the demanded angle of attack can exceed the stall angle (no
    // protection). Trim biases the demand. Pitch stability returns the angle of attack towards the demand.
    const CL1g = (this.mass * G * Math.max(0.2, Math.cos((att0.p * Math.PI) / 180)) * Math.cos((att0.b * Math.PI) / 180)) / Math.max(200, qbar * S.wingArea);
    const a1g = (CL1g - cl0) / S.cla, nTarget = c.elev >= 0 ? 1 + c.elev * 1.5 : 1 + c.elev * 1.5;
    const aTarget = Math.min(a1g + (nTarget - 1) * CL1g / S.cla + c.trim * 0.08, onGroundNow ? 0.035 + c.elev * 0.2 : 0.6);
    const Cm = -(alpha - aTarget) * 4.0 + stallBuffet;
    let qdot = S.pitch * 1.25 * qn * Cm - 2.8 * S.pitch * sq * this.qr;
    // beta > 0: the aircraft slips towards its left wing → dihedral rolls it right, weathercock yaws the nose left.
    let pdot = S.roll * qn * (c.ail * 1.0 + beta * 0.6) - 3.6 * S.roll * sq * this.p;
    let rdot = S.yaw * qn * (c.rud * 0.8 - beta * 2.4) - 2.6 * S.yaw * sq * this.r;
    // Ground.
    const gh = this.env.ground ? this.env.ground(this.pos.x, this.pos.z) : 0;
    const att = hpb(this.q);
    const contact = this.pos.y <= gh + S.gearHeight + 0.02;
    if (contact && !this.onGround) this.touchdown(att, gh);
    if (this.onGround) {
      // Weight on wheels: normal force cancels the downward resultant; friction, brakes, steering.
      const fwd = { x: att.f.x, z: att.f.z }, fl = Math.hypot(fwd.x, fwd.z) || 1; fwd.x /= fl; fwd.z /= fl;
      const lat = { x: -fwd.z, z: fwd.x };
      const vF = this.vel.x * fwd.x + this.vel.z * fwd.z, vL = this.vel.x * lat.x + this.vel.z * lat.z;
      const N = Math.max(0, -F.y);
      F.y = Math.max(F.y, 0);
      const wet = this.env.wet?.() ? 1 : 0;
      const brake = (c.parking ? 1 : c.brake) * (wet ? 0.28 : 0.5);
      const mu = 0.016 + brake;
      const fr = Math.min(Math.abs(vF) * this.mass / dt * 0.5, mu * N) * Math.sign(vF);
      F.x -= fwd.x * fr; F.z -= fwd.z * fr;
      // Tyres resist sideways motion.
      const fl2 = Math.min(Math.abs(vL) * this.mass / dt * 0.5, 0.7 * N) * Math.sign(vL);
      F.x -= lat.x * fl2; F.z -= lat.z * fl2;
      // Nose-wheel steering (rudder pedals / tiller): turn rate from the geometry, fading with speed.
      const steer = c.rud * (Math.abs(vF) < 15 ? 65 : Math.max(6, 65 * 15 / Math.abs(vF))) * D2R;
      if (att.p < 4) { rdot = 0; this.r = (vF * Math.tan(steer)) / S.wheelbase; }
      // Wings level on the wheels; nose wheel holds the pitch at ≥ 0.
      pdot = -this.p * 8 - att.b * D2R * 20;
      // Nose wheel firmly on the ground until the elevator has authority (≈ 0.75 Vr): no pitching while parked or taxiing.
      if (this.ias < S.vr * 0.75) { qdot = -att.p * D2R * 12 - this.qr * 8; }
      if (att.p <= 0.05 && qdot < 0) { qdot = 0; this.qr = Math.max(0, this.qr); }
      if (att.p > S.tailstrike || (att.p > 11.5 && S.tailstrike == null)) this.event('tailstrike', { pitch: att.p });
      // Lift-off: lift has overcome the weight.
      const settled = this.lastTouchdown && this.time - (this.tdTime ?? -99) < 4 && c.throttle < 0.6;   // no bounce right after touchdown
      if (!settled && F.y > 0.02 * this.mass * G && this.vel.y >= 0) { this.onGround = false; this.event('liftoff', { ias: this.ias }); }
      // Spoilers: ground spoilers deploy on touchdown if armed / with reverse.
      if (this.spoilersArmed && (c.throttle < 0.05 || c.reverse) && Math.abs(vF) > 20) this.spoilerCmd = 1;
      if (this.ap.on && this.ap.vert === 'FLARE') { this.ap.on = false; this.ap.vert = 'ALT'; c.elev = 0; this.event('apDisconnect', { reason: 'touchdown' }); }
    }
    // Integrate.
    const acc = scl(F, 1 / this.mass);
    this.vel = add(this.vel, acc, dt);
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;
    this.pos = add(this.pos, this.vel, dt);
    if (this.onGround) this.pos.y = gh + S.gearHeight + Math.max(0, Math.sin(att.p * D2R)) * S.mainGearX * 0.15;
    if (!this.onGround && this.pos.y < gh + S.gearHeight * 0.3) this.crash('Terrain impact');
    this.qr += qdot * dt; this.p += pdot * dt; this.r += rdot * dt;
    // Attitude: body rates → quaternion derivative. +X = nose down, +Y = yaw left, +Z = roll right.
    const wq = { w: 0, x: -this.qr, y: -this.r, z: this.p };
    const dq = qmul(this.q, wq);
    this.q = qnorm({ w: this.q.w + 0.5 * dq.w * dt, x: this.q.x + 0.5 * dq.x * dt, y: this.q.y + 0.5 * dq.y * dt, z: this.q.z + 0.5 * dq.z * dt });
    if (this.onGround) {   // keep wings level and nose up only by rotation
      const a2 = hpb(this.q);
      if (Math.abs(a2.b) > 0.3 || a2.p < -0.05) this.q = qFromHPB(a2.h, Math.max(0, a2.p), a2.b * 0.9);
    }
    // Outputs for instruments.
    const vs = this.vel.y, gs = Math.hypot(this.vel.x, this.vel.z);
    this.ias = V * Math.sqrt(rho / RHO0);
    const gLoad = (dot(F, qrot(this.q, v3(0, 1, 0))) + this.mass * G * qrot(this.q, v3(0, 1, 0)).y) / (this.mass * G);
    if (!this.onGround && gLoad > 3.0) { this.damage += dt * 0.2; this.event('overstress', { g: gLoad }); }
    Object.assign(this.out, { alpha, beta, V, qbar, CL, CD, ias: this.ias, tas: V, gs, vs, alt, agl: hAGL, att, n1: this.engines.map((e) => e.n1), n2: this.engines.map((e) => e.n2), g: gLoad, stall: this.stall, aStall, mach: V / (340 - alt * 0.004) });
  }

  windVec(alt) {
    const w = this.env.wind ? this.env.wind() : { dir: 0, speed: 0, gust: 0, turb: 0 };
    const k = Math.min(1.4, 0.55 + Math.log10(Math.max(10, alt + 10)) * 0.2);       // stronger aloft
    const t = this.time, tb = w.turb || 0;
    const sp = w.speed * k + (w.gust || 0) * Math.max(0, noise1(t * 0.35, 1)) ;
    // Wind blows FROM dir: velocity points to dir + 180.
    const r = ((w.dir + 180) * Math.PI) / 180;
    return v3(Math.sin(r) * sp + tb * 4 * noise1(t * 1.3, 2), tb * 2.5 * noise1(t * 1.7, 4), -Math.cos(r) * sp + tb * 4 * noise1(t * 1.1, 5));
  }
  agl() { const gh = this.env.ground ? this.env.ground(this.pos.x, this.pos.z) : 0; return this.pos.y - gh - this.spec.gearHeight; }

  touchdown(att, gh) {
    const vs = -this.vel.y;
    this.onGround = true;
    const rec = { vs, fpm: vs * 60 * FT, bank: att.b, pitch: att.p, ias: this.ias, gear: this.gearPos, x: this.pos.x, z: this.pos.z };
    this.lastTouchdown = rec; this.tdTime = this.time;
    if (this.gearPos < 0.95) return this.crash('Gear-up landing');
    if (vs > 6 || Math.abs(att.b) > 12) return this.crash(vs > 6 ? `Crash landing (${Math.round(rec.fpm)} ft/min)` : 'Wing strike on touchdown');
    if (vs > 3.2) { this.damage += 0.25; this.event('hardLanding', rec); }
    this.event('touchdown', rec);
    if (this.spoilersArmed) { this.spoilerCmd = 1; this.spoilerPos = Math.max(this.spoilerPos, 0.6); }
    this.vel.y = 0;
  }
  crash(reason) { if (this.crashed) return; this.crashed = true; this.event('crash', { reason }); }
  event(type, data = {}) { if ((type === 'tailstrike' || type === 'overstress') && (this.lastEv?.[type] ?? -9) > this.time - 3) return; (this.lastEv ||= {})[type] = this.time; this.events.push({ type, t: this.time, ...data }); }
  takeEvents() { const e = this.events; this.events = []; return e; }
}

/**
 * Autopilot / flight director: holds heading (or follows the route: LNAV), altitude or vertical speed, speed
 * (autothrottle), and flies ILS approaches (localiser + 3° glide path). It moves the same controls as the pilot.
 */
export class Autopilot {
  constructor(fm) { this.fm = fm; this.on = false; this.at = false; this.lat = 'HDG'; this.vert = 'ALT'; this.hdg = 0; this.alt = 3000; this.vsTarget = 0; this.spd = 130; this.route = null; this.ils = null; this.wpt = 0; this.iInt = 0; }
  engage(on = !this.on) {
    const fm = this.fm, o = fm.out;
    this.on = on;
    if (on) { this.hdg = Math.round(o.att?.h ?? 0); this.alt = Math.round((fm.pos.y * FT) / 100) * 100 / FT; this.spd = Math.round(o.ias || 120); this.vert = 'ALT'; this.lat = this.route ? 'LNAV' : 'HDG'; }
    return this.on;
  }
  update(dt) {
    const fm = this.fm, o = fm.out, c = fm.ctl;
    if (!o.att) return;
    if (this.at) {
      const err = this.spd - o.ias;
      this.iInt = Math.max(-20, Math.min(20, this.iInt + err * dt * 0.02));
      c.throttle = Math.max(0, Math.min(1, 0.45 + err * 0.06 + this.iInt * 0.05 - o.vs * 0.004));
    }
    if (!this.on || fm.onGround) return;
    // Lateral.
    let hdgT = this.hdg;
    if (this.lat === 'LNAV' && this.route) {
      const w = this.route[this.wpt];
      if (w) { const dx = w.x - fm.pos.x, dz = w.z - fm.pos.z; hdgT = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360; if (Math.hypot(dx, dz) < 2500 && this.wpt < this.route.length - 1) this.wpt++; if (w.alt != null && this.vert !== 'GS') this.alt = w.alt; }
    }
    if (this.ils && (this.appArmed || this.lat === 'LOC')) {
      const I = this.ils, dx = fm.pos.x - I.x, dz = fm.pos.z - I.z, along = -(dx * I.dx + dz * I.dz), cross = dx * I.dz * -1 + dz * I.dx;
      if (along > 0 && along < 30000 && Math.abs(cross) < 3000) {
        this.lat = 'LOC';
        // cross > 0: right of the centreline (looking along the approach) → turn left; wind drift corrected by integral.
        const crossRate = this.prevCross != null ? (cross - this.prevCross) / Math.max(dt, 1e-3) : 0; this.prevCross = cross;
        this.locInt = Math.abs(cross) > 80 ? (this.locInt || 0) * 0.98 : Math.max(-10, Math.min(10, (this.locInt || 0) + cross * dt * 0.004));   // wind correction, no wind-up
        hdgT = I.hdg - Math.max(-25, Math.min(25, cross * 0.04 + crossRate * 1.8 + this.locInt));
        const gsAlt = I.y + Math.tan(3 * Math.PI / 180) * along + 15;
        if (this.vert !== 'GS' && fm.pos.y >= gsAlt - 30 && along < 18000) this.vert = 'GS';
        if (this.vert === 'GS') { this.vsTarget = -o.gs * Math.tan(3 * Math.PI / 180) + (gsAlt - fm.pos.y) * 0.12; this.gsAlt = gsAlt; }
      }
    }
    // Autoland: below 50 ft on the glide path, flare (sink rate reduced with height), retard, align with the runway.
    if (this.vert === 'GS' && this.autoland && o.agl < 10) { this.vert = 'FLARE'; this.at = false; }
    if (this.vert === 'FLARE') { this.vsTarget = -0.9 - Math.max(0, o.agl) * 0.11; c.throttle = o.agl < 6 ? 0 : c.throttle * 0.98; if (this.ils) hdgT = this.ils.hdg; }
    let dh = ((hdgT - o.att.h + 540) % 360) - 180;
    const bankT = Math.max(-25, Math.min(25, dh * 1.6));
    c.ail = Math.max(-1, Math.min(1, (bankT - o.att.b) * 0.05 - fm.p * 1.2));
    c.rud = Math.max(-1, Math.min(1, -o.beta * 3));
    // Vertical.
    let vsT = this.vsTarget;
    if (this.vert === 'ALT') vsT = Math.max(-15, Math.min(12, (this.alt - fm.pos.y) * 0.08));
    if (this.vert === 'VS' || this.vert === 'FLARE') vsT = this.vsTarget;
    const e = vsT - o.vs;
    this.eInt = Math.max(-0.6, Math.min(0.6, (this.eInt || 0) + e * dt * 0.012));
    c.elev = Math.max(-1, Math.min(1, e * 0.03 + this.eInt - fm.qr * 1.5));
  }
}
