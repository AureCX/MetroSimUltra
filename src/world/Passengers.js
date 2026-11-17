// Animated passengers with an articulated body (hips, torso, head, two-segment arms and legs),
// a speed-driven walking gait, idle behaviour (breathing, weight shift, looking around, phones),
// steering with personal space, and realistic boarding: wait beside the doors, let passengers
// off first, then board one by one. Boarding progress feeds dwell management and door obstruction.
import * as THREE from 'three';
import { seededRandom } from '../core/util.js';
import { PLATFORM_Y, EDGE_GAP } from './StationBuilder.js';

const COATS = [0x1f2a3d, 0x23252b, 0x3b3f46, 0x8a6a45, 0x4b5a3a, 0x6b2430, 0x34507a, 0x7d7f83, 0xb9a98c, 0x2e4a4a, 0x5b4a6b, 0xa3472f];
const PANTS = [0x2b3a55, 0x1c1c1e, 0x4a4d52, 0x8b7d5e, 0x31404f, 0x3a3027];
const SHOES = [0x111111, 0x3a2a1c, 0xe8e8e8, 0x222a33];
const HAIR = [0x16120f, 0x2b1d14, 0x4a3020, 0x8a6a3a, 0x6e3b22, 0x9a9a9a, 0xd8c08a];
const SKIN = [0xf1c7a5, 0xe0b08a, 0xc68b62, 0x9a6a46, 0x6b4630];

const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.22) }));
  return matCache.get(c);
};

// Shared geometries (body parts hang from their joint: geometry translated so the joint is at 0).
const G = (() => {
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const limb = (r0, r1, len) => { const g = new THREE.CylinderGeometry(r0, r1, len, 8); g.translate(0, -len / 2, 0); return g; };
  const shin = (() => {
    const leg = new THREE.CylinderGeometry(0.052, 0.042, 0.44, 8); leg.translate(0, -0.22, 0);
    return leg;
  })();
  const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.25); shoe.translate(0, -0.47, 0.05);
  const head = new THREE.SphereGeometry(0.1, 14, 12); head.scale(1, 1.18, 1.08);
  const hair = new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.scale(1, 1.15, 1.1); hair.translate(0, 0.012, -0.008);
  const hairLong = new THREE.CylinderGeometry(0.1, 0.12, 0.22, 12, 1, true, Math.PI * 0.25, Math.PI * 1.5); hairLong.translate(0, -0.06, -0.01);
  const nose = new THREE.ConeGeometry(0.018, 0.04, 6); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 0.11);
  return {
    torso: {
      slim: lathe([[0.001, 0], [0.15, 0.01], [0.155, 0.12], [0.165, 0.32], [0.18, 0.5], [0.16, 0.58], [0.06, 0.64], [0.001, 0.65]]),
      broad: lathe([[0.001, 0], [0.17, 0.01], [0.175, 0.14], [0.19, 0.34], [0.21, 0.5], [0.19, 0.59], [0.07, 0.65], [0.001, 0.66]]),
      long: lathe([[0.001, -0.42], [0.2, -0.42], [0.18, -0.15], [0.16, 0.12], [0.17, 0.32], [0.19, 0.5], [0.17, 0.59], [0.065, 0.65], [0.001, 0.66]]),
    },
    neck: (() => { const g = new THREE.CylinderGeometry(0.04, 0.045, 0.1, 8); g.translate(0, 0.68, 0); return g; })(),
    head, hair, hairLong, nose,
    hatBrim: (() => { const g = new THREE.CylinderGeometry(0.15, 0.15, 0.012, 16); g.translate(0, 0.1, 0); return g; })(),
    hatCrown: (() => { const g = new THREE.CylinderGeometry(0.09, 0.1, 0.09, 16); g.translate(0, 0.15, 0); return g; })(),
    upperArm: limb(0.048, 0.04, 0.29),
    foreArm: limb(0.038, 0.032, 0.26),
    hand: (() => { const g = new THREE.SphereGeometry(0.038, 8, 6); g.scale(0.8, 1.2, 0.6); g.translate(0, -0.29, 0); return g; })(),
    thigh: limb(0.072, 0.056, 0.44),
    shin, shoe,
    backpack: (() => { const g = new THREE.BoxGeometry(0.28, 0.36, 0.14); g.translate(0, 0.36, -0.2); return g; })(),
    bag: (() => { const g = new THREE.BoxGeometry(0.08, 0.26, 0.3); g.translate(0, -0.42, 0); return g; })(),
    phone: (() => { const g = new THREE.BoxGeometry(0.04, 0.075, 0.008); g.translate(0, -0.29, 0.03); return g; })(),
  };
})();

export class Person {
  constructor(rand) {
    this.rand = rand;
    const r = rand;
    this.scale = 0.9 + r() * 0.2;
    const build = r() < 0.35 ? 'broad' : r() < 0.25 ? 'long' : 'slim';
    const coat = mat(COATS[Math.floor(r() * COATS.length)]);
    const pants = mat(PANTS[Math.floor(r() * PANTS.length)]);
    const shoes = mat(SHOES[Math.floor(r() * SHOES.length)]);
    const skin = mat(SKIN[Math.floor(r() * SKIN.length)]);
    const hairM = mat(HAIR[Math.floor(r() * HAIR.length)]);
    const root = this.g = new THREE.Group();
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.93; root.add(hips);
    const torso = this.torso = new THREE.Group(); hips.add(torso);
    torso.add(new THREE.Mesh(G.torso[build], coat), new THREE.Mesh(G.neck, skin));
    const head = this.head = new THREE.Group(); head.position.y = 0.8; torso.add(head);
    head.add(new THREE.Mesh(G.head, skin), new THREE.Mesh(G.hair, hairM), new THREE.Mesh(G.nose, skin));
    if (r() < 0.3) head.add(new THREE.Mesh(G.hairLong, hairM));
    if (r() < 0.12) { const hat = mat(COATS[Math.floor(r() * COATS.length)]); head.add(new THREE.Mesh(G.hatBrim, hat), new THREE.Mesh(G.hatCrown, hat)); }
    if (r() < 0.25) torso.add(new THREE.Mesh(G.backpack, mat(0x2a2f36)));
    const sw = build === 'broad' ? 0.215 : 0.19;
    this.arms = [-1, 1].map((sd) => {
      const sh = new THREE.Group(); sh.position.set(sd * sw, 0.57, 0); torso.add(sh);
      sh.add(new THREE.Mesh(G.upperArm, coat));
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      el.add(new THREE.Mesh(G.foreArm, coat), new THREE.Mesh(G.hand, skin));
      return { sh, el, sd };
    });
    this.legs = [-1, 1].map((sd) => {
      const hip = new THREE.Group(); hip.position.set(sd * 0.085, 0, 0); hips.add(hip);
      hip.add(new THREE.Mesh(G.thigh, pants));
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      knee.add(new THREE.Mesh(G.shin, pants), new THREE.Mesh(G.shoe, shoes));
      return { hip, knee, sd };
    });
    this.phone = r() < 0.28;
    if (this.phone) this.arms[1].el.add(new THREE.Mesh(G.phone, mat(0x101215)));
    else if (r() < 0.25) this.arms[0].el.add(new THREE.Mesh(G.bag, mat([0x3b2a1a, 0x1b1b1b, 0x6b2430][Math.floor(r() * 3)])));
    root.scale.setScalar(this.scale);
    // Motion state (platform coordinates: along = route chainage, depth = metres from the platform edge).
    this.along = 0; this.depth = 1; this.va = 0; this.vd = 0;
    this.pref = 1.15 + r() * 0.35;       // preferred walking speed m/s
    this.phase = r() * 6.28;
    this.seed = r() * 100;
    this.yaw = 0; this.look = 0; this.lookT = r() * 5;
    this.state = 'wait';
    this.target = null;
    this.faceYaw = null;
  }

  /** Gait and idle animation from the current speed. */
  animate(dt, t) {
    const speed = Math.hypot(this.va, this.vd);
    const amp = Math.min(1, speed / 1.25);
    this.phase += dt * (speed / 0.72) * Math.PI;
    const ph = this.phase;
    const L = this.legs, A = this.arms;
    for (const [i, leg] of L.entries()) {
      const p = ph + (i ? Math.PI : 0);
      leg.hip.rotation.x = -0.48 * amp * Math.sin(p) + (1 - amp) * 0.02 * Math.sin(t * 0.5 + this.seed + i);
      leg.knee.rotation.x = amp * (0.12 + 0.75 * Math.max(0, Math.sin(p + 1.25))) + (1 - amp) * 0.03;
    }
    this.hips.position.y = 0.93 - 0.012 * amp + 0.022 * amp * Math.cos(2 * ph);
    this.hips.rotation.z = 0.035 * amp * Math.sin(ph) + (1 - amp) * 0.025 * Math.sin(t * 0.35 + this.seed);
    this.torso.rotation.y = -0.09 * amp * Math.sin(ph);
    this.torso.rotation.x = 0.05 * amp;
    const breathe = 1 + 0.008 * Math.sin(t * 1.6 + this.seed);
    this.torso.scale.set(breathe, 1, breathe);
    for (const [i, arm] of A.entries()) {
      const p = ph + (i ? 0 : Math.PI);
      if (this.phone && i === 1) { arm.sh.rotation.x = -0.55; arm.sh.rotation.z = 0.12; arm.el.rotation.x = -1.35; continue; }
      if (this.watch > 0 && i === 0) { arm.sh.rotation.x = -0.6; arm.el.rotation.x = -1.5; arm.sh.rotation.z = -0.2; continue; }
      arm.sh.rotation.x = 0.42 * amp * Math.sin(p) + (1 - amp) * 0.03 * Math.sin(t + this.seed);
      arm.sh.rotation.z = arm.sd * (0.07 + 0.02 * amp);
      arm.el.rotation.x = -(0.18 + 0.3 * amp * Math.max(0, -Math.sin(p)));
    }
    // Head: looks at the phone, glances around while waiting, otherwise eyes front.
    this.lookT -= dt;
    if (this.lookT < 0) { this.lookT = 2 + this.rand() * 6; this.lookTarget = speed > 0.3 ? 0 : (this.rand() - 0.5) * 1.4; if (!this.phone && this.rand() < 0.1) this.watch = 1.8; }
    if (this.watch > 0) this.watch -= dt;
    this.look += ((this.lookTarget || 0) - this.look) * Math.min(1, dt * 2.5);
    this.head.rotation.y = this.look;
    this.head.rotation.x = this.phone ? 0.45 : this.watch > 0 ? 0.5 : 0.02 * Math.sin(t * 0.7 + this.seed);
  }
}

export class PassengerSystem {
  constructor(scene, line, routes, playerRoute, bus) {
    this.scene = scene; this.line = line; this.routes = routes; this.route = playerRoute; this.bus = bus;
    this.group = new THREE.Group(); scene.add(this.group);
    this.crowds = new Map();
    this.tmp = {};
    this.onboard = Math.round(line.stations.length * 30);
    this.time = 0;
    bus.on('doors:opening', () => this.onDoorsOpen());
  }

  /** Waiting passengers on the player's platform (and the opposite one) at stop k. */
  spawnCrowd(k) {
    const stp = this.route.stops[k];
    const st = stp.station;
    const rand = seededRandom(k * 7919 + st.name.length * 13);
    const island = st.platformType === 'island';
    const maxDepth = island ? st.platformWidth / 2 - 0.35 : st.platformWidth - 0.5;
    const crowd = {
      k, stp, people: [], other: [], alighting: [], served: false, rand,
      sideSign: stp.doorSide === 'right' ? 1 : -1, maxDepth,
      exits: [stp.platformStartR + 14, stp.platformEndR - 14],
      exitDepth: island ? maxDepth : maxDepth - 0.3,
      spawnTimer: 2,
    };
    // Frame vectors of the (straight) platform for converting velocities to world headings.
    const a = this.route.point(stp.centerR - 1, 0, 0, {}), b = this.route.point(stp.centerR + 1, 0, 0, {}), c = this.route.point(stp.centerR, crowd.sideSign, 0, {}), o = this.route.point(stp.centerR, 0, 0, {});
    crowd.f = new THREE.Vector2((b.x - a.x) / 2, (b.z - a.z) / 2);
    crowd.d = new THREE.Vector2(c.x - o.x, c.z - o.z); // +depth direction for the player's platform
    const n = Math.round(Math.min(36, st.passengers * (0.75 + rand() * 0.5)));
    for (let i = 0; i < n; i++) this.addWaiting(crowd, rand, true);
    if (!island) for (let i = 0; i < Math.round(n * 0.5); i++) {
      const p = new Person(rand);
      p.other = true; p.state = 'wait';
      p.along = stp.platformStartR + 8 + rand() * (st.platformLength - 16);
      p.depth = 0.9 + rand() * (maxDepth - 1);
      this.place(crowd, p); p.yaw = this.trackYaw(crowd, p) + (rand() - 0.5) * 0.8; p.g.rotation.y = p.yaw;
      this.group.add(p.g); crowd.other.push(p);
    }
    this.crowds.set(k, crowd);
    return crowd;
  }

  addWaiting(crowd, rand, initial) {
    const stp = crowd.stp, st = stp.station;
    const p = new Person(rand);
    p.boarding = rand() < 0.88;
    if (initial) {
      p.along = stp.platformStartR + 8 + rand() * (st.platformLength - 16);
      p.depth = 0.9 + rand() * (crowd.maxDepth - 1.1);
      p.state = 'wait';
    } else {
      // A new arrival walks in from an exit to a free spot.
      p.along = crowd.exits[rand() < 0.5 ? 0 : 1]; p.depth = crowd.exitDepth;
      p.state = 'walkin';
      p.target = { along: stp.platformStartR + 8 + rand() * (st.platformLength - 16), depth: 0.9 + rand() * (crowd.maxDepth - 1.1) };
    }
    p.home = { along: p.along, depth: p.depth };
    this.place(crowd, p);
    p.yaw = this.trackYaw(crowd, p) + (rand() - 0.5) * 0.9; p.g.rotation.y = p.yaw;
    this.group.add(p.g);
    crowd.people.push(p);
    return p;
  }

  place(crowd, p) {
    const lat = p.other ? -(2 * this.route.geom.halfSpacingAt(this.route.toTrack(p.along)) + EDGE_GAP + p.depth) : crowd.sideSign * (EDGE_GAP + p.depth);
    this.route.point(p.along, lat, PLATFORM_Y, this.tmp);
    p.g.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
  }
  /** World yaw facing the track (towards depth 0). */
  trackYaw(crowd, p) { const s = p.other ? 1 : -1; return Math.atan2(crowd.d.x * s, crowd.d.y * s); }
  velYaw(crowd, p) {
    const wx = crowd.f.x * p.va + crowd.d.x * p.vd * (p.other ? -1 : 1), wz = crowd.f.y * p.va + crowd.d.y * p.vd * (p.other ? -1 : 1);
    return Math.atan2(wx, wz);
  }

  /** Passengers still to board/alight at a stop (departure is authorised at 0). */
  pending(stp) {
    const c = this.crowds.get(stp.k);
    if (!c) return 0;
    return c.people.filter((p) => p.assigned && p.state !== 'gone').length + c.alighting.filter((p) => p.state !== 'gone' && p.depth < 1.2).length;
  }

  isObstructing() {
    const sm = this.stationManager;
    if (!sm || sm.atStop == null) return false;
    const c = this.crowds.get(sm.atStop);
    if (!c) return false;
    return c.people.some((p) => p.state === 'board' && p.depth < 0.5 && p.depth > -0.6) || c.alighting.some((p) => p.depth < 0.4 && p.depth > -0.7 && p.state === 'alight');
  }

  doorPositions() { return this.train.doorOffsets().map((o) => this.train.front - o); }

  onDoorsOpen() {
    const sm = this.stationManager;
    if (!sm || sm.atStop == null) return;
    const c = this.crowds.get(sm.atStop);
    if (!c || c.served) return;
    c.served = true;
    const doors = this.doorPositions();
    c.doors = doors.map((along) => ({ along, alightQueue: 0, boardRank: 0, lastBoard: -9 }));
    // Alighting passengers queue inside each door.
    const nAlight = c.stp.isTerminus ? Math.min(40, doors.length * 3) : Math.round(Math.min(30, c.people.length * (0.4 + c.rand() * 0.6)));
    for (let i = 0; i < nAlight; i++) {
      const d = c.doors[i % doors.length];
      const p = new Person(Math.random);
      p.along = d.along + (Math.random() - 0.5) * 0.4; p.depth = -0.9;
      p.door = d; p.release = 0.6 + d.alightQueue * 0.95 + Math.random() * 0.3; d.alightQueue++;
      p.state = 'inside'; p.g.visible = false;
      p.exit = c.exits[Math.random() < 0.5 ? 0 : 1];
      this.place(c, p); this.group.add(p.g);
      c.alighting.push(p);
    }
    this.onboard = Math.max(0, this.onboard - nAlight);
    // Boarders pick the nearest door and stand beside it, leaving the doorway clear.
    for (const p of c.people) {
      if (!p.boarding || p.state === 'gone') continue;
      let best = c.doors[0];
      for (const d of c.doors) if (Math.abs(d.along - p.along) < Math.abs(best.along - p.along)) best = d;
      p.door = best; p.assigned = true;
      const side = p.along < best.along ? -1 : 1;
      const rank = best.boardRank++;
      p.queueSpot = { along: best.along + side * (0.85 + Math.floor(rank / 2) * 0.5), depth: 0.55 + (rank % 2) * 0.45 };
      p.state = 'queue'; p.target = p.queueSpot;
    }
  }

  update(dt, front) {
    this.time += dt;
    for (const stp of this.route.stops) {
      const d = stp.centerR - front;
      const near = d > -160 && d < 380;
      if (near && !this.crowds.has(stp.k)) this.spawnCrowd(stp.k);
      if (!near && this.crowds.has(stp.k)) this.removeCrowd(stp.k);
    }
    const doors = this.train?.doors;
    const openAmt = doors ? Math.max(doors.sides.left.amount, doors.sides.right.amount) : 0;
    const sm = this.stationManager;
    for (const c of this.crowds.values()) {
      const here = sm && sm.atStop === c.k;
      const arriving = sm && sm.atStop == null && sm.nextStop === c.k && c.stp.stopR - front < 220;
      // People keep arriving on the platform while no train is in.
      c.spawnTimer -= dt;
      if (!here && c.spawnTimer < 0 && c.people.filter((p) => p.state !== 'gone').length < 34) { c.spawnTimer = 3 + c.rand() * 5; this.addWaiting(c, c.rand, false); }
      // After the train has left, those left behind go back to waiting.
      if (!here && c.served) {
        c.served = false;
        for (const p of c.people) if (p.state === 'queue' || p.state === 'board') { p.state = 'walkin'; p.assigned = false; p.target = { along: p.along + (c.rand() - 0.5) * 6, depth: 1 + c.rand() * (c.maxDepth - 1.2) }; }
      }
      for (const p of c.alighting) this.stepAlighter(c, p, dt, openAmt);
      for (const p of c.people) this.stepWaiter(c, p, dt, { here, arriving, openAmt });
      this.separate(c, dt);
      for (const p of [...c.people, ...c.alighting]) {
        if (p.state === 'gone' || p.state === 'inside') continue;
        this.integrate(c, p, dt);
        p.animate(dt, this.time);
      }
      for (const p of c.other) p.animate(dt, this.time);
      c.people = c.people.filter((p) => p.state !== 'gone' || (this.group.remove(p.g), false));
    }
  }

  steer(p, target, speed) {
    const da = target.along - p.along, dd = target.depth - p.depth;
    const dist = Math.hypot(da, dd);
    const s = dist < 0.05 ? 0 : Math.min(speed, dist * 1.4); // arrive behaviour
    p.wa = dist > 1e-3 ? (da / dist) * s : 0; p.wd = dist > 1e-3 ? (dd / dist) * s : 0;
    return dist;
  }

  stepWaiter(c, p, dt, { here, arriving, openAmt }) {
    p.wa = 0; p.wd = 0;
    switch (p.state) {
      case 'walkin': if (this.steer(p, p.target, p.pref) < 0.15) { p.state = 'wait'; p.home = { ...p.target }; } break;
      case 'wait':
        if (arriving && p.boarding && !p.stepped) { p.stepped = true; p.home = { along: p.home.along, depth: Math.max(0.6, p.home.depth - 0.6 - c.rand() * 0.6) }; }
        this.steer(p, p.home, 0.7);
        break;
      case 'queue': {
        this.steer(p, p.queueSpot, p.pref);
        const d = p.door;
        const blocked = c.alighting.some((a) => a.door === d && (a.state === 'inside' || (a.state === 'alight' && a.depth < 1.3)));
        if (here && openAmt > 0.85 && !blocked && this.time - d.lastBoard > 0.7) {
          // Next in line at this door: the closest waiting boarder.
          const cand = c.people.filter((q) => q.door === d && q.state === 'queue').sort((x, y) => Math.abs(x.along - d.along) - Math.abs(y.along - d.along))[0];
          if (cand === p) { p.state = 'board'; d.lastBoard = this.time; }
        }
        break;
      }
      case 'board': {
        if (!(openAmt > 0.5)) { p.state = 'queue'; break; }
        const dist = this.steer(p, { along: p.door.along, depth: -0.95 }, p.pref);
        if (dist < 0.15 || p.depth < -0.75) { p.state = 'gone'; p.g.visible = false; this.onboard++; }
        break;
      }
      default: break;
    }
  }

  stepAlighter(c, p, dt, openAmt) {
    p.wa = 0; p.wd = 0;
    if (p.state === 'inside') {
      p.release -= dt;
      if (p.release <= 0 && openAmt > 0.8) { p.state = 'alight'; p.g.visible = true; }
      return;
    }
    if (p.state === 'alight') {
      if (this.steer(p, { along: p.along + (p.exit > p.along ? 0.4 : -0.4), depth: 1.7 }, p.pref) < 0.3 || p.depth > 1.6) p.state = 'leave';
    } else if (p.state === 'leave') {
      if (this.steer(p, { along: p.exit, depth: c.exitDepth }, p.pref) < 0.4) { p.state = 'gone'; p.g.visible = false; this.group.remove(p.g); }
    }
  }

  /** Personal space: push apart people closer than ~0.6 m. */
  separate(c, dt) {
    const list = [...c.people, ...c.alighting].filter((p) => p.state !== 'gone' && p.state !== 'inside');
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const da = a.along - b.along, dd = a.depth - b.depth;
      const d2 = da * da + dd * dd;
      if (d2 > 0.42 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), f = (0.65 - d) / 0.65 * 1.6;
      const ua = da / d, ud = dd / d;
      // Boarders/alighters in the doorway get priority (others yield).
      const wa = a.state === 'board' || a.state === 'alight' ? 0.3 : 1, wb = b.state === 'board' || b.state === 'alight' ? 0.3 : 1;
      a.wa += ua * f * wa; a.wd += ud * f * wa; b.wa -= ua * f * wb; b.wd -= ud * f * wb;
    }
  }

  integrate(c, p, dt) {
    const k = Math.min(1, dt * 3.2); // acceleration smoothing
    p.va += ((p.wa || 0) - p.va) * k; p.vd += ((p.wd || 0) - p.vd) * k;
    const sp = Math.hypot(p.va, p.vd);
    if (sp < 0.03) { p.va *= 0.5; p.vd *= 0.5; }
    p.along += p.va * dt; p.depth += p.vd * dt;
    const minDepth = p.state === 'board' || p.state === 'alight' || p.state === 'inside' ? -1.0 : 0.45; // nobody waits on the yellow line
    p.depth = Math.max(minDepth, Math.min(c.maxDepth, p.depth));
    this.place(c, p);
    // Heading: face where you walk; when standing, face the track (or the door you are waiting for).
    let want;
    if (sp > 0.18) want = this.velYaw(c, p);
    else if (p.state === 'queue' && p.door) want = Math.atan2(c.f.x * (p.door.along - p.along) - c.d.x * 0.6, c.f.y * (p.door.along - p.along) - c.d.y * 0.6);
    else want = p.idleYaw ?? (p.idleYaw = this.trackYaw(c, p) + (c.rand() - 0.5) * 0.9);
    if (sp > 0.18) p.idleYaw = null;
    let d = want - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yaw += Math.max(-4 * dt, Math.min(4 * dt, d));
    p.g.rotation.y = p.yaw;
  }

  removeCrowd(k) {
    const c = this.crowds.get(k);
    for (const p of [...c.people, ...c.other, ...c.alighting]) this.group.remove(p.g);
    this.crowds.delete(k);
  }
  dispose() { this.scene.remove(this.group); }
}
