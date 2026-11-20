// Bus collision physics and damage. Impacts are resolved as rigid-body impulses at the real contact point
// (bus mass with its passengers, yaw inertia, the other body's mass, restitution and friction that depend on
// what is hit and on the road), so speed, impact angle, masses, braking before impact and grip all shape the
// outcome: momentum transfer, rotation, secondary impacts. The bus records damage by zone (front / rear /
// left / right, each with local dents at the contact points), breaks glass, mirrors and lights, can jam doors
// and suffer mechanical failures that reduce performance. Damage persists until the bus is repaired.

/** What can be hit: effective mass (kg, Infinity = fixed), restitution, hardness (damage multiplier). */
export const OBSTACLES = {
  building: { mass: Infinity, e: 0.08, hard: 1.2, label: 'a building' },
  house: { mass: Infinity, e: 0.08, hard: 1.1, label: 'a building' },
  wall: { mass: Infinity, e: 0.1, hard: 1.1, label: 'a wall' },
  pole: { mass: 1800, e: 0.15, hard: 1.0, label: 'a pole' },
  lamp: { mass: 1500, e: 0.15, hard: 1.0, label: 'a lamp post' },
  sign: { mass: 400, e: 0.2, hard: 0.6, label: 'a sign' },
  tree: { mass: 6000, e: 0.12, hard: 1.0, label: 'a tree' },
  shelter: { mass: 900, e: 0.2, hard: 0.6, label: 'a bus shelter' },
  car: { mass: 1450, e: 0.18, hard: 0.85, label: 'a car' },
  taxi: { mass: 1500, e: 0.18, hard: 0.85, label: 'a taxi' },
  van: { mass: 2300, e: 0.16, hard: 0.9, label: 'a van' },
  truck: { mass: 14000, e: 0.1, hard: 1.2, label: 'a truck' },
  moto: { mass: 260, e: 0.3, hard: 0.3, label: 'a motorcycle' },
  bus: { mass: 13000, e: 0.1, hard: 1.2, label: 'another bus' },
};
export const obstacle = (kind) => OBSTACLES[kind] || (kind === 'pedestrian' ? { mass: 75, e: 0.1, hard: 0.05, label: 'a pedestrian' } : { mass: Infinity, e: 0.1, hard: 1, label: `a ${kind}` });

const SEVERITY = [[1.2, 'scrape'], [3, 'minor'], [6, 'moderate'], [10, 'severe'], [Infinity, 'major']];
export const severityOf = (dv) => SEVERITY.find(([lim]) => dv < lim)[1];

/**
 * Resolves one contact. ph: BusPhysics (x, z, yaw, vx, vy, r, mass, spec). n: unit normal pushing the bus out of the
 * obstacle (world), contact: world contact point. other: { mass, e, vx, vz } (velocity of the other body, world).
 * Returns { dv, j, vn, local: { f, l }, nx, nz } or null if the bodies are separating.
 */
export function resolveImpact(ph, n, contact, other, { mu = 0.8 } = {}) {
  const sp = ph.spec, m = ph.mass, Iz = (m * (sp.length * sp.length + sp.width * sp.width)) / 12;
  const h = ph.heading();
  const vcx = h.fx * ph.vx + h.rx * ph.vy, vcz = h.fz * ph.vx + h.rz * ph.vy;   // centre of mass, world
  const dx = contact.x - ph.x, dz = contact.z - ph.z;
  const px = -dz, pz = dx;                                                      // ω × r (yaw rate convention of BusPhysics)
  const vpx = vcx + ph.r * px, vpz = vcz + ph.r * pz;                           // contact point velocity
  const rvx = vpx - (other.vx || 0), rvz = vpz - (other.vz || 0);
  const vn = rvx * n.x + rvz * n.z;
  if (vn >= 0) return null;
  const M = other.mass, invM = Number.isFinite(M) ? 1 / M : 0;
  const rn = px * n.x + pz * n.z;
  const kn = 1 / m + invM + (rn * rn) / Iz;
  const e = other.e ?? 0.1;
  const j = (-(1 + e) * vn) / kn;
  // Friction impulse along the contact (scraping), limited by Coulomb; lower on a wet road.
  const tx = -n.z, tz = n.x, vt = rvx * tx + rvz * tz, rt = px * tx + pz * tz;
  const kt = 1 / m + invM + (rt * rt) / Iz;
  const jt = Math.max(-mu * 0.5 * j, Math.min(mu * 0.5 * j, -vt / kt));
  const Jx = n.x * j + tx * jt, Jz = n.z * j + tz * jt;
  const nvx = vcx + Jx / m, nvz = vcz + Jz / m;
  ph.r += (px * Jx + pz * Jz) / Iz;
  ph.vx = h.fx * nvx + h.fz * nvz;
  ph.vy = h.rx * nvx + h.rz * nvz;
  const dv = Math.hypot(Jx, Jz) / m;
  ph.impactT = 1.4 + Math.min(2, dv * 0.25);                                  // dynamic (sliding) handling for a while
  return { dv, j, jt, vn: -vn, local: { f: dx * h.fx + dz * h.fz, l: dx * h.rx + dz * h.rz }, Jx, Jz, otherDv: Number.isFinite(M) ? Math.hypot(Jx, Jz) / M : 0 };
}

/** Contact point: the bus corner (or obstacle corner) deepest along the normal. */
export function contactPoint(busPts, obstPts, n) {
  let best = null, bd = Infinity;
  for (const p of busPts) { const d = p.x * n.x + p.z * n.z; if (d < bd) { bd = d; best = p; } }
  // If an obstacle corner lies inside the bus, use it (side impacts on a corner of a car / pole).
  let ob = null, od = -Infinity;
  for (const p of obstPts || []) { const d = p.x * n.x + p.z * n.z; if (d > od) { od = d; ob = p; } }
  if (ob && inside(busPts, ob)) return ob;
  return best;
}
function inside(poly, p) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

const FAILURES = {
  steering: 'Steering damaged — the bus pulls to one side',
  engine: 'Engine damage — reduced power, overheating',
  brakes: 'Brake circuit leak — air pressure falling',
  suspension: 'Suspension damaged — the bus sits low and rolls more',
  electrical: 'Electrical fault — lights and displays failing',
};

/** Damage state of one bus: zones, dents, broken parts, jammed doors and failures (serialisable). */
export class BusDamage {
  constructor(spec, saved) {
    this.spec = spec;
    const s = saved || {};
    this.zones = { front: 0, rear: 0, left: 0, right: 0, ...(s.zones || {}) };
    this.dents = s.dents ? s.dents.map((d) => ({ ...d })) : [];     // { f, l, side, depth, r }
    this.broken = { windscreen: 0, mirrorL: false, mirrorR: false, headL: false, headR: false, tailL: false, tailR: false, windowsL: 0, windowsR: 0, ...(s.broken || {}) };
    this.jammed = s.jammed ? [...s.jammed] : [];
    this.failures = s.failures ? [...s.failures] : [];
    this.distortion = s.distortion || 0;
    this.version = 0;
  }
  state() { return { zones: { ...this.zones }, dents: this.dents.map((d) => ({ ...d })), broken: { ...this.broken }, jammed: [...this.jammed], failures: [...this.failures], distortion: this.distortion }; }
  get any() { return Object.values(this.zones).some((x) => x > 0.02); }
  failureText(k) { return FAILURES[k]; }

  /** Effects on driving. */
  powerScale() { return this.failures.includes('engine') ? 0.55 : 1; }
  steerBias() { return this.failures.includes('steering') ? (this.zones.left > this.zones.right ? -0.9 : 0.9) : 0; }
  airLeak() { return this.failures.includes('brakes') ? 0.25 : 0; }
  rideDrop() { return this.failures.includes('suspension') ? -0.06 : 0; }

  /**
   * Applies an impact. local: contact in the bus frame (f forward, l right of the centre), dv: bus delta-v (m/s),
   * hard: obstacle hardness, rand: random source. Returns { severity, events: [...] } describing what broke.
   */
  apply(local, dv, hard, rand = Math.random) {
    const sp = this.spec, half = sp.width / 2;
    const front = sp.wheelbase * 0.58 + sp.frontOverhang, rear = (sp.trailerLength ? sp.length : sp.length) - front;
    const sev = severityOf(dv), k = Math.min(1, (dv * hard) / 12);
    const events = [];
    if (k < 0.02) return { severity: sev, events, k };
    // Which face: the nearest one to the contact point.
    const dF = front - local.f, dR = local.f + rear, dL = local.l + half, dRi = half - local.l;
    const m = Math.min(dF, dR, dL, dRi);
    const zone = m === dF ? 'front' : m === dR ? 'rear' : m === dL ? 'left' : 'right';
    this.zones[zone] = Math.min(1, this.zones[zone] + k * 0.9);
    // A dent where it hit (deeper with energy); merges with a nearby one.
    const along = zone === 'front' || zone === 'rear' ? local.l : local.f;
    const near = this.dents.find((d) => d.side === zone && Math.abs(d.along - along) < 1.2);
    const depth = Math.min(0.35, 0.04 + k * 0.32), r = 0.5 + k * 1.4;
    if (near) { near.depth = Math.min(0.4, near.depth + depth * 0.6); near.r = Math.max(near.r, r); }
    else if (this.dents.length < 24) this.dents.push({ side: zone, along, depth, r });
    // Glass, lights, mirrors.
    const brk = (cond, key, text) => { if (cond && !this.broken[key]) { this.broken[key] = true; events.push(text); } };
    if (zone === 'front') {
      if (k > 0.25) { const w = Math.min(1, this.broken.windscreen + k * 0.8); if (w > 0.2 && this.broken.windscreen <= 0.2) events.push('Windscreen cracked'); this.broken.windscreen = w; }
      brk(k > 0.2 && local.l < 0.3, 'headL', 'Left headlight smashed'); brk(k > 0.2 && local.l > -0.3, 'headR', 'Right headlight smashed');
      brk(k > 0.15 && local.l < -half + 0.6, 'mirrorL', 'Left mirror torn off'); brk(k > 0.15 && local.l > half - 0.6, 'mirrorR', 'Right mirror torn off');
    }
    if (zone === 'rear') { brk(k > 0.15 && local.l < 0.3, 'tailL', 'Left rear lights broken'); brk(k > 0.15 && local.l > -0.3, 'tailR', 'Right rear lights broken'); }
    if (zone === 'left' || zone === 'right') {
      const key = zone === 'left' ? 'windowsL' : 'windowsR';
      if (k > 0.3) { if (this.broken[key] < 0.2) events.push(`${zone === 'left' ? 'Left' : 'Right'} side windows broken`); this.broken[key] = Math.min(1, this.broken[key] + k); }
      if (local.f > front - 1.6) brk(k > 0.12, zone === 'left' ? 'mirrorL' : 'mirrorR', `${zone === 'left' ? 'Left' : 'Right'} mirror broken`);
      // Doors (right side) jam when the impact deforms their frame.
      if (zone === 'right') sp.doors.forEach((pos, i) => {
        const df = front - pos; // door centre, bus frame (front positive)
        if (Math.abs(df - local.f) < 1.4 + k && k > 0.35 && !this.jammed.includes(i)) { this.jammed.push(i); events.push(`Door ${i + 1} jammed`); }
      });
    }
    // Mechanical failures on severe impacts.
    if (k > 0.45) {
      const pool = zone === 'front' ? ['steering', 'engine', 'electrical', 'brakes'] : zone === 'rear' ? ['engine', 'suspension', 'electrical'] : ['suspension', 'brakes', 'steering'];
      const f = pool[Math.floor(rand() * pool.length)];
      if (!this.failures.includes(f) && rand() < 0.4 + k * 0.6) { this.failures.push(f); events.push(FAILURES[f]); }
    }
    if (k > 0.7) { this.distortion = Math.min(1, this.distortion + (k - 0.6)); events.push('Body frame distorted'); }
    this.version++;
    return { severity: sev, events, k, zone };
  }

  /** Repairs (depot hall): reduces all damage by `amount` (fraction of full damage). */
  repair(amount) {
    for (const z of Object.keys(this.zones)) this.zones[z] = Math.max(0, this.zones[z] - amount);
    this.dents = this.dents.map((d) => ({ ...d, depth: d.depth - amount * 0.4 })).filter((d) => d.depth > 0.01);
    if (!this.any) {
      this.broken = { windscreen: 0, mirrorL: false, mirrorR: false, headL: false, headR: false, tailL: false, tailR: false, windowsL: 0, windowsR: 0 };
      this.jammed = []; this.failures = []; this.distortion = 0;
    }
    this.version++;
  }
}
