// Animated passengers: waiting crowds on platforms near the train, boarding through the
// nearest open door, alighting passengers walking to the exits. Boarding progress feeds
// back into dwell management (departure is only authorised once boarding is complete).
import * as THREE from 'three';
import { seededRandom } from '../core/util.js';
import { PLATFORM_Y, EDGE_GAP } from './StationBuilder.js';

const COLORS = [0x2b3a55, 0x5a1f1f, 0x2f4f2f, 0x6b5b3e, 0x1c1c1c, 0x7a7a7a, 0x3d2b5a, 0x8c4a2f, 0x204a5e, 0xa08040, 0x404040, 0x6e2a4a];
const SKIN = [0xf1c7a5, 0xd9a47c, 0xa8754f, 0x6b4630, 0xe8b894];

const geo = {
  torso: new THREE.CylinderGeometry(0.2, 0.17, 0.62, 10),
  head: new THREE.SphereGeometry(0.11, 12, 10),
  leg: new THREE.CylinderGeometry(0.07, 0.06, 0.82, 8),
  arm: new THREE.CylinderGeometry(0.05, 0.045, 0.6, 6),
  bag: new THREE.BoxGeometry(0.28, 0.32, 0.12),
};
const matCache = new Map();
const mat = (c) => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.25) })); return matCache.get(c); };

class Person {
  constructor(rand) {
    this.g = new THREE.Group();
    const scale = 0.9 + rand() * 0.22;
    const coat = COLORS[Math.floor(rand() * COLORS.length)];
    const pants = COLORS[Math.floor(rand() * COLORS.length)];
    const torso = new THREE.Mesh(geo.torso, mat(coat)); torso.position.y = 1.15; this.g.add(torso);
    const head = new THREE.Mesh(geo.head, mat(SKIN[Math.floor(rand() * SKIN.length)])); head.position.y = 1.6; this.g.add(head);
    this.legs = [-0.09, 0.09].map((x) => { const l = new THREE.Mesh(geo.leg, mat(pants)); l.geometry = geo.leg; l.position.set(x, 0.41, 0); this.g.add(l); return l; });
    this.arms = [-0.25, 0.25].map((x) => { const a = new THREE.Mesh(geo.arm, mat(coat)); a.position.set(x, 1.15, 0); this.g.add(a); return a; });
    if (rand() < 0.35) { const b = new THREE.Mesh(geo.bag, mat(0x3b2a1a)); b.position.set(0.28, 0.95, 0); this.g.add(b); }
    this.g.scale.setScalar(scale);
    this.phase = rand() * 10;
    this.speed = 1.1 + rand() * 0.5;
    this.state = 'idle';
    this.target = null;
  }
  animate(dt, walking) {
    this.phase += dt * (walking ? this.speed * 5 : 1.2);
    const sw = walking ? Math.sin(this.phase) * 0.5 : 0;
    this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
    this.arms[0].rotation.x = -sw * 0.7; this.arms[1].rotation.x = sw * 0.7;
    if (!walking) this.g.children[0].rotation.z = Math.sin(this.phase * 0.7) * 0.02;
  }
}

export class PassengerSystem {
  constructor(scene, line, routes, playerRoute, bus) {
    this.scene = scene; this.line = line; this.routes = routes; this.route = playerRoute; this.bus = bus;
    this.group = new THREE.Group(); scene.add(this.group);
    this.crowds = new Map();     // stopIndex(k on player route) -> crowd
    this.tmp = {};
    this.onboard = Math.round(line.stations.length * 30);
    bus.on('doors:open', ({ side }) => this.onDoorsOpen(side));
    bus.on('doors:opening', ({ side }) => this.onDoorsOpen(side));
  }

  /** Waiting passengers on both platforms of stop k (player route ordering). */
  spawnCrowd(k) {
    const stp = this.route.stops[k];
    const st = stp.station;
    const rand = seededRandom(k * 7919 + st.name.length);
    const people = [];
    const n = Math.round(st.passengers * (0.7 + rand() * 0.6));
    const depth = st.platformType === 'island' ? st.platformWidth / 2 - 0.6 : st.platformWidth - 0.8;
    const sideSign = stp.doorSide === 'right' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const p = new Person(rand);
      p.along = stp.platformStartR + 8 + rand() * (st.platformLength - 16);
      p.depth = 1.0 + rand() * depth;
      p.side = sideSign;
      p.boarding = rand() < 0.85;
      this.place(p);
      this.faceTrack(p, (rand() - 0.5) * 0.9);
      this.group.add(p.g);
      people.push(p);
    }
    // Opposite platform (other direction) – idle crowd for ambience.
    const other = [];
    if (st.platformType === 'side') {
      for (let i = 0; i < Math.round(n * 0.6); i++) {
        const p = new Person(rand);
        p.along = stp.platformStartR + 8 + rand() * (st.platformLength - 16);
        p.depth = 1.0 + rand() * depth;
        p.side = -1; p.otherTrack = true;
        this.place(p);
        this.faceTrack(p, (rand() - 0.5) * 0.9);
        this.group.add(p.g);
        other.push(p);
      }
    }
    const crowd = { k, people, other, alighting: [], served: false };
    this.crowds.set(k, crowd);
    return crowd;
  }

  /** World placement from (along, depth, side) in player-route platform coordinates. */
  place(p) {
    const r = this.route;
    let lat;
    if (p.otherTrack) {
      // other track's platform: on the far side of the opposite track.
      const hs = r.geom.halfSpacingAt(r.toTrack(p.along));
      lat = -(2 * hs + EDGE_GAP + p.depth);
    } else lat = p.side * (EDGE_GAP + p.depth);
    r.point(p.along, lat, PLATFORM_Y, this.tmp);
    p.g.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
  }
  faceTrack(p, jitter = 0) {
    const lat = p.otherTrack ? -2 * this.route.geom.halfSpacingAt(this.route.toTrack(p.along)) : 0;
    this.route.point(p.along, lat, PLATFORM_Y, this.tmp);
    p.g.rotation.y = Math.atan2(this.tmp.x - p.g.position.x, this.tmp.z - p.g.position.z) + jitter;
  }
  /** Moves the person and turns it to face the direction of travel. */
  move(p) {
    const ox = p.g.position.x, oz = p.g.position.z;
    this.place(p);
    const dx = p.g.position.x - ox, dz = p.g.position.z - oz;
    if (dx * dx + dz * dz > 1e-6) {
      const target = Math.atan2(dx, dz);
      let d = target - p.g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.g.rotation.y += d * 0.25;
    }
  }

  /** Number of passengers still to board at a stop (used for departure authorisation). */
  pending(stp) {
    const c = this.crowds.get(stp.k);
    if (!c) return 0;
    return c.people.filter((p) => p.boarding && p.state !== 'gone').length + c.alighting.filter((p) => p.state === 'exiting' && p.t < 1.2).length;
  }

  /** True while someone is stepping through a door (door obstruction detection). */
  isObstructing() {
    const sm = this.stationManager;
    if (!sm || sm.atStop == null) return false;
    const c = this.crowds.get(sm.atStop);
    return !!c && c.people.some((p) => p.state === 'walk' && p.depth < 0.6 && Math.random() < 0.5);
  }

  onDoorsOpen(side) {
    const sm = this.stationManager;
    if (!sm || sm.atStop == null) return;
    const stp = this.route.stops[sm.atStop];
    const c = this.crowds.get(stp.k);
    if (!c || c.served) return;
    c.served = true;
    const doors = this.train.doorOffsets().map((o) => this.train.front - o);
    for (const p of c.people) {
      if (!p.boarding) continue;
      let best = doors[0];
      for (const d of doors) if (Math.abs(d - p.along) < Math.abs(best - p.along)) best = d;
      p.door = best + (Math.random() - 0.5) * 0.6;
      p.state = 'queue';
      p.delay = Math.random() * 3 + 1.2;
    }
    // Alighting passengers.
    const rand = Math.random;
    const nAlight = stp.isTerminus ? 30 : Math.round(c.people.length * (0.5 + rand() * 0.6));
    const sideSign = stp.doorSide === 'right' ? 1 : -1;
    const exits = [stp.platformStartR + 14, stp.platformEndR - 14];
    for (let i = 0; i < nAlight; i++) {
      const p = new Person(Math.random);
      p.along = doors[i % doors.length] + (rand() - 0.5) * 0.5;
      p.depth = -0.6; p.side = sideSign;
      p.state = 'exiting'; p.t = -(i / doors.length) * 1.1 - 0.4; p.exitAlong = exits[rand() < 0.5 ? 0 : 1];
      p.g.visible = false;
      this.place(p);
      this.group.add(p.g);
      c.alighting.push(p);
    }
    this.onboard = Math.max(0, this.onboard - nAlight);
  }

  update(dt, front) {
    // Keep crowds only for stops near the train.
    for (const stp of this.route.stops) {
      const d = stp.centerR - front;
      const near = d > -260 && d < 450;
      if (near && !this.crowds.has(stp.k)) this.spawnCrowd(stp.k);
      if (!near && this.crowds.has(stp.k)) this.removeCrowd(stp.k);
    }
    const doorsOpen = this.train?.doors.anyOpen;
    const openAmount = Math.max(this.train?.doors.sides.left.amount || 0, this.train?.doors.sides.right.amount || 0);
    for (const c of this.crowds.values()) {
      for (const p of c.people) {
        if (p.state === 'gone') continue;
        let walking = false;
        if (p.state === 'queue' || p.state === 'walk') {
          p.delay -= dt;
          if (p.delay <= 0 && doorsOpen && openAmount > 0.6) p.state = 'walk';
          if (p.state === 'walk' && !(doorsOpen && openAmount > 0.3)) { p.state = 'queue'; p.delay = 0.5; }
          if (p.state === 'walk') {
            const dx = p.door - p.along, dd = p.depth - (-0.9);
            const len = Math.hypot(dx, dd);
            const step = Math.min(len, p.speed * dt);
            if (len > 0.05) { p.along += (dx / len) * step; p.depth -= (dd / len) * step; walking = true; }
            if (len < 0.1 || p.depth <= -0.85) { p.state = 'gone'; p.g.visible = false; this.onboard++; }
            this.move(p);
          }
        }
        p.animate(dt, walking);
      }
      for (const p of c.other) p.animate(dt, false);
      for (const p of c.alighting) {
        if (p.state !== 'exiting') continue;
        p.t += dt;
        if (p.t < 0) continue;
        p.g.visible = true;
        // Step out to depth 2, then walk to the exit.
        let tx, td;
        if (p.depth < 2) { tx = p.along; td = 2.2; } else { tx = p.exitAlong; td = 2.4; }
        const dx = tx - p.along, dd = td - p.depth;
        const len = Math.hypot(dx, dd);
        const step = Math.min(len, p.speed * dt);
        if (len > 0.01) { p.along += (dx / len) * step; p.depth += (dd / len) * step; }
        if (Math.abs(p.exitAlong - p.along) < 0.5 && p.depth >= 2) { p.state = 'gone'; p.g.visible = false; }
        this.move(p);
        p.animate(dt, true);
      }
    }
  }

  removeCrowd(k) {
    const c = this.crowds.get(k);
    for (const p of [...c.people, ...c.other, ...c.alighting]) this.group.remove(p.g);
    this.crowds.delete(k);
  }
  dispose() { this.scene.remove(this.group); }
}
