// AI road users: cars, taxis, vans, trucks and motorcycles driving the lane graph with the
// Intelligent Driver Model; they obey traffic signals, give way at unsignalled junctions and
// roundabouts, stop for pedestrians on crossings, queue behind the player's bus, use their
// indicators and brake lights, and are involved in collisions. Pedestrians walk the sidewalks,
// wait for the green man and cross. Density follows the time of day.
import * as THREE from 'three';
import { pathAt } from './RoadNetwork.js';
import { Person } from '../world/Passengers.js';
import { seededRandom } from '../core/util.js';

const TYPES = {
  car: { len: 4.4, w: 1.8, vmax: 55, accel: 1.8, weight: 0.62 },
  taxi: { len: 4.6, w: 1.85, vmax: 55, accel: 1.8, weight: 0.12 },
  van: { len: 5.4, w: 2.0, vmax: 50, accel: 1.4, weight: 0.1 },
  truck: { len: 9.0, w: 2.5, vmax: 45, accel: 0.9, weight: 0.08 },
  moto: { len: 2.1, w: 0.8, vmax: 60, accel: 2.6, weight: 0.08 },
};
const COLORS = [0xb8bec4, 0x1d1f22, 0xf2f2f2, 0x8a1c1c, 0x23406e, 0x5f6b72, 0xc9a227, 0x2e5a3a, 0x6b2a8a, 0xd06a1a];

/** Traffic density 0..1 by hour (two rush hours) and day (weekend quieter mornings). */
export function trafficDensity(hour, day = 1) {
  const g = (m, s) => Math.exp(-((hour - m) ** 2) / (2 * s * s));
  let d = 0.12 + 0.75 * g(8.2, 1.3) + 0.55 * g(13, 2.5) + 0.85 * g(17.8, 1.5) + 0.25 * g(21, 1.5);
  if (hour < 5.5 || hour > 23) d = 0.06;
  if (day >= 6) d *= hour < 11 ? 0.55 : 0.8;
  return Math.min(1, d);
}

function carMesh(type, color, rand) {
  const g = new THREE.Group(), T = TYPES[type];
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2229 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const add = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const lights = { brake: new THREE.MeshBasicMaterial({ color: 0x440000 }), indL: new THREE.MeshBasicMaterial({ color: 0x332000 }), indR: new THREE.MeshBasicMaterial({ color: 0x332000 }), head: new THREE.MeshBasicMaterial({ color: 0x999999 }) };
  if (type === 'moto') {
    add(0.3, 0.5, 1.9, paint, 0, 0.6, 0); add(0.1, 0.62, 0.62, dark, 0, 0.32, -0.75); add(0.1, 0.62, 0.62, dark, 0, 0.32, 0.75);
    const rider = new Person(rand); rider.g.scale.setScalar(0.95); rider.g.position.set(0, 0.25, 0.15); rider.legs.forEach((l) => { l.hip.rotation.x = -1.2; l.knee.rotation.x = 1.4; }); rider.g.rotation.y = Math.PI; g.add(rider.g);
    add(0.12, 0.08, 0.05, lights.brake, 0, 0.75, 0.97);
  } else if (type === 'truck') {
    add(2.4, 2.3, 2.2, paint, 0, 1.55, -3.3); add(2.2, 0.8, 0.05, glass, 0, 2.1, -4.42);
    add(2.5, 3.0, 6.4, new THREE.MeshLambertMaterial({ color: 0xe6e3dc }), 0, 1.95, 1.2); add(2.3, 0.35, 8.8, dark, 0, 0.45, -0.1);
  } else {
    const h = type === 'van' ? 1.9 : 0.75;
    add(T.w, h, T.len, paint, 0, 0.35 + h / 2, 0);
    if (type !== 'van') add(T.w - 0.15, 0.6, T.len * 0.5, glass, 0, 1.15 + 0.02, 0.05); else add(T.w + 0.01, 0.6, 1.0, glass, 0, 1.75, -T.len / 2 + 0.6);
    if (type === 'taxi') { add(0.6, 0.18, 0.25, new THREE.MeshBasicMaterial({ color: 0xfff2a0 }), 0, 1.55, 0); }
  }
  if (type !== 'moto') {
    for (const sx of [-1, 1]) {
      add(0.3, 0.14, 0.05, lights.brake, sx * (T.w / 2 - 0.25), 0.8, T.len / 2 + 0.01);
      add(0.12, 0.1, 0.05, sx < 0 ? lights.indL : lights.indR, sx * (T.w / 2 - 0.08), 0.8, T.len / 2 + 0.01);
      add(0.12, 0.1, 0.05, sx < 0 ? lights.indL : lights.indR, sx * (T.w / 2 - 0.08), 0.7, -T.len / 2 - 0.01);
      add(0.3, 0.12, 0.05, lights.head, sx * (T.w / 2 - 0.3), 0.7, -T.len / 2 - 0.01);
      for (const sz of [-1, 1]) add(0.25, 0.6, 0.6, dark, sx * (T.w / 2 - 0.1), 0.3, sz * (T.len / 2 - (type === 'truck' ? 1.5 : 0.85)));
    }
  }
  return { g, lights };
}

class AICar {
  constructor(id, type, rand) {
    this.id = id; this.type = type; this.T = TYPES[type];
    this.len = this.T.len; this.w = this.T.w;
    const color = type === 'taxi' ? 0xf2c200 : COLORS[Math.floor(rand() * COLORS.length)];
    const m = carMesh(type, color, rand); this.g = m.g; this.lights = m.lights;
    this.links = []; this.s = 0; this.v = 0; this.a = 0;
    this.v0f = 0.85 + rand() * 0.25;       // personal speed preference
    this.T_gap = 1.2 + rand() * 0.6;
    this.crashed = 0; this.waitT = 0;
    this.pos = { x: 0, z: 0, dx: 0, dz: -1 };
  }
}

export class Traffic {
  constructor(scene, net, world, bus) {
    this.scene = scene; this.net = net; this.world = world; this.bus = bus;
    this.group = new THREE.Group(); scene.add(this.group);
    this.cars = []; this.peds = [];
    this.rand = seededRandom(9001);
    this.nextId = 1;
    this.laneLinks = [];
    for (const e of net.edges) for (const fwd of [true, false]) for (const k of net.carLanes(e)) this.laneLinks.push(net.lanePath(e, fwd, k));
    this.tmp = {};
    this.crossingPeds = new Map(); // crossing key -> count of peds on it
  }

  // ------------------------------------------------------------------ cars
  spawnCar(player, near = false) {
    const r = this.rand;
    for (let tries = 0; tries < 20; tries++) {
      const link = this.laneLinks[Math.floor(r() * this.laneLinks.length)];
      const s = r() * link.path.length;
      const p = pathAt(link.path, s);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < (near ? 60 : 160) || d > 480) continue;
      if ([...link.cars].some((c) => Math.abs(c.s - s) < 15)) continue;
      let acc = 0, type = 'car'; const roll = r();
      for (const [k, T] of Object.entries(TYPES)) { acc += T.weight; if (roll < acc) { type = k; break; } }
      const c = new AICar(this.nextId++, type, r);
      c.links = [link]; c.s = s; c.v = Math.min(link.speed, c.T.vmax) / 3.6 * 0.7;
      link.cars.add(c);
      this.extend(c);
      this.cars.push(c); this.group.add(c.g);
      return c;
    }
    return null;
  }
  remove(c) { for (const l of c.links) l.cars.delete(c); this.group.remove(c.g); this.cars.splice(this.cars.indexOf(c), 1); }

  /** Append random onward links so a car always knows ~3 links ahead. */
  extend(c) {
    while (c.links.length < 4) {
      const last = c.links.at(-1);
      if (last.kind === 'turn') { c.links.push(last.to); continue; }
      const node = last.d.to;
      const outs = this.net.outgoing(node, last.edge);
      if (!outs.length) return;
      const o = outs[Math.floor(this.rand() * outs.length)];
      const lanes = this.net.carLanes(o.edge);
      const k = lanes.includes(last.k) ? last.k : lanes[Math.floor(this.rand() * lanes.length)];
      const next = this.net.lanePath(o.edge, o.fwd, k);
      const turn = this.net.turnPath(node, last, next);
      c.links.push(turn, next);
    }
  }

  /** Distance from car c to (link index i, position s). */
  distTo(c, i, s) { let d = -c.s; for (let k = 0; k < i; k++) d += c.links[k].path.length; return d + s; }

  update(dt, t, env) {
    const { player, busFoot, hour, day, peds } = env;
    // Population control.
    const target = Math.round(10 + 48 * trafficDensity(hour, day));
    if (this.cars.length < target && this.rand() < dt * 3) this.spawnCar(player, this.cars.length < target * 0.4);
    for (const c of [...this.cars]) {
      const d = Math.hypot(c.pos.x - player.x, c.pos.z - player.z);
      if ((d > 560 || (c.crashed && (c.crashed -= dt) < 0 && d > 60)) && c.links.length) this.remove(c);
      else if (this.cars.length > target + 6 && d > 300) this.remove(c);
    }
    for (const c of this.cars) this.drive(c, dt, t, player, busFoot, peds);
    this.updatePeds(dt, t, player, env);
  }

  drive(c, dt, t, player, busFoot, peds) {
    if (c.crashed) { c.v = 0; this.blink(c, t, true, true); return; }
    const link = c.links[0];
    const v0 = (Math.min(link.speed, c.T.vmax) / 3.6) * c.v0f * env_wet(this.weatherWet);
    let gap = Infinity, dv = 0;
    const consider = (dist, vObs) => { if (dist < gap) { gap = dist; dv = c.v - vObs; } };
    // Leader cars on this and the next links.
    let accLen = -c.s;
    for (let i = 0; i < c.links.length && accLen < 120; i++) {
      const L = c.links[i];
      for (const o of L.cars) { if (o === c) continue; const ds = accLen + o.s; if (ds > 0.1) consider(ds - (c.len + o.len) / 2 - 2.0, o.v); }
      // Signals / give way at the end of lane links.
      if (L.kind === 'lane' && i < c.links.length - 1) {
        const node = L.node, endDist = accLen + L.stopAt;
        if (endDist > -1) {
          if (node.signal) {
            const st = this.net.signalState(node, L.d, t);
            if (st === 'red' || (st === 'yellow' && endDist > (c.v * c.v) / 6 + 2)) consider(endDist - c.len / 2, 0);
          } else if (node.roundabout || node.edges.length >= 3) {
            if (this.mustYield(c, L, node, endDist)) consider(endDist - c.len / 2 + 0.5, 0);
          }
        }
        // Pedestrians on a crossing of this lane.
        for (const pd of peds) {
          if (!pd.onCrossing || pd.crossLink !== L.edge) continue;
          const pr = this.projectOn(L, pd.x, pd.z);
          if (pr && Math.abs(pr.lat) < 6) consider(accLen + pr.s - 4 - c.len / 2, 0);
        }
      }
      accLen += L.path.length;
    }
    // The player's bus as an obstacle on the car's path.
    if (busFoot) {
      let acc2 = -c.s;
      for (let i = 0; i < 3 && i < c.links.length; i++) {
        const L = c.links[i];
        for (const b of busFoot) {
          const pr = this.projectOn(L, b.cx, b.cz);
          if (pr && Math.abs(pr.lat) < 2.6 && acc2 + pr.s > 0) consider(acc2 + pr.s - c.len / 2 - b.half - 2, Math.max(0, player.v * 0.9));
        }
        acc2 += L.path.length;
        if (acc2 > 60) break;
      }
    }
    // IDM.
    const a0 = c.T.accel, b = 2.6, s0 = 2.0;
    const v = c.v;
    let a = a0 * (1 - Math.pow(Math.max(0, v) / Math.max(1, v0), 4));
    if (gap < Infinity) { const sStar = s0 + v * c.T_gap + (v * dv) / (2 * Math.sqrt(a0 * b)); a -= a0 * Math.pow(Math.max(0, sStar) / Math.max(0.5, gap), 2); }
    a = Math.max(-8, Math.min(a0, a));
    c.a = a;
    c.v = Math.max(0, v + a * dt);
    c.s += c.v * dt;
    while (c.links.length && c.s > c.links[0].path.length) {
      c.s -= c.links[0].path.length; c.links[0].cars.delete(c); c.links.shift();
      this.extend(c);
      if (!c.links.length) { this.remove(c); return; }
      c.links[0].cars.add(c);
    }
    const p = pathAt(c.links[0].path, c.s, c.pos);
    c.g.position.set(p.x, this.net.heightAt(p.x, p.z), p.z);
    c.g.rotation.y = Math.atan2(-p.dx, -p.dz);
    // Lights: brake & indicators for the next turn.
    c.lights.brake.color.setHex(c.a < -0.5 || c.v < 0.1 ? 0xff1a00 : 0x440000);
    const nt = c.links.find((l) => l.kind === 'turn');
    const turnDir = nt && Math.abs(nt.turn) > 0.5 && this.distTo(c, c.links.indexOf(nt), 0) < 40 ? Math.sign(nt.turn) : 0;
    this.blink(c, t, turnDir < 0, turnDir > 0);
  }

  blink(c, t, l, r) {
    const on = Math.floor(t * 2.6) % 2 === 0;
    c.lights.indL.color.setHex(l && on ? 0xffa000 : 0x332000);
    c.lights.indR.color.setHex(r && on ? 0xffa000 : 0x332000);
  }

  /** Give way at roundabouts (to circulating traffic) and unsignalled junctions (priority to faster / right). */
  mustYield(c, L, node, endDist) {
    if (endDist > 25) return false;
    if (node.roundabout) {
      const entry = L.path.points.at(-1);
      for (const o of this.cars) {
        if (o === c || o.links[0]?.kind !== 'turn' || o.links[0].node !== node) continue;
        if (Math.hypot(o.pos.x - entry.x, o.pos.z - entry.z) < 16) return true;
      }
      return false;
    }
    const myEdge = L.edge, mySpeed = myEdge.speed;
    const major = node.edges.filter((e) => e !== myEdge).some((e) => e.speed > mySpeed);
    for (const o of this.cars) {
      if (o === c) continue;
      const ol = o.links[0];
      if (ol?.kind === 'turn' && ol.node === node) return true;                     // junction occupied
      if (ol?.kind !== 'lane' || ol.node !== node || ol.edge === myEdge) continue;
      const od = ol.path.length - o.s;
      if (od > 30) continue;
      // Priority to the right (French rule) unless I am on the major road.
      const cross = L.d.dx * ol.d.dz - L.d.dz * ol.d.dx;
      if (major || cross < 0 || o.v > 2) { if (od < 22 && (major || o.v > 1)) return true; }
    }
    return false;
  }

  projectOn(L, x, z) {
    const P = L.path.points;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ux = dx / len, uz = dz / len;
      const t = (x - a.x) * ux + (z - a.z) * uz;
      if (t < -2 || t > len + 2) continue;
      return { s: L.path.cum[i - 1] + t, lat: (x - a.x) * -uz + (z - a.z) * ux };
    }
    return null;
  }

  /** Oriented boxes of AI cars for collision tests with the bus. */
  boxes() {
    return this.cars.map((c) => {
      const fx = c.pos.dx, fz = c.pos.dz, rx = -fz, rz = fx, h = c.len / 2, w = c.w / 2;
      const P = (f, l) => ({ x: c.pos.x + fx * f + rx * l, z: c.pos.z + fz * f + rz * l });
      return { car: c, pts: [P(h, -w), P(h, w), P(-h, w), P(-h, -w)] };
    });
  }

  // ------------------------------------------------------------------ pedestrians
  spawnPed(player) {
    const r = this.rand;
    for (let tries = 0; tries < 10; tries++) {
      const e = this.net.edges[Math.floor(r() * this.net.edges.length)];
      const t = r() * e.len, side = r() < 0.5 ? -1 : 1;
      const x = e.a.x + e.dx * t + -e.dz * side * (e.half + 1.6), z = e.a.z + e.dz * t + e.dx * side * (e.half + 1.6);
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < 40 || d > 260) continue;
      const p = new Person(r);
      Object.assign(p, { edge: e, t, side, dir: r() < 0.5 ? 1 : -1, x, z, speed: 1.1 + r() * 0.5, state: 'walk', wait: 0 });
      p.va = p.speed; p.vd = 0;
      this.group.add(p.g); this.peds.push(p);
      return p;
    }
    return null;
  }

  updatePeds(dt, t, player, env) {
    const target = Math.round(10 + 22 * Math.min(1, trafficDensity(env.hour, env.day) * 1.2) * (env.rain ? 0.6 : 1));
    if (this.peds.length < target && this.rand() < dt * 2) this.spawnPed(player);
    for (const p of [...this.peds]) {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d > 320 || p.dead > 8) { this.group.remove(p.g); this.peds.splice(this.peds.indexOf(p), 1); continue; }
      if (p.hit) { p.dead = (p.dead || 0) + dt; p.g.rotation.x = Math.min(Math.PI / 2, (p.g.rotation.x || 0) + dt * 4); p.va = 0; p.animate(dt, t); continue; }
      const e = p.edge;
      let moving = true;
      if (p.state === 'walk') {
        p.t += p.dir * p.speed * dt;
        const nearEnd = p.dir > 0 ? e.len - p.t : p.t;
        const node = p.dir > 0 ? e.b : e.a;
        // Mid-block zebra crossings: some pedestrians cross.
        for (const cr of this.net.crossings) if (cr.edge === e && Math.abs(p.t - cr.along) < 0.6 && !p.crossedHere && this.rand() < 0.5) { p.state = 'waitCross'; p.cross = { zebra: true, along: cr.along }; p.crossedHere = true; }
        if (p.state === 'walk' && nearEnd < node.trim + 1.5) {
          p.crossedHere = false;
          // Continue straight across the junction (via the crossing) or turn the corner.
          const straight = this.net.outgoing(node, e).find((o) => Math.abs(o.edge.dx * e.dx + o.edge.dz * e.dz) > 0.95);
          if (straight && node.crosswalk) { p.state = 'waitCross'; p.cross = { node, to: straight, perp: node.edges.find((x) => x !== e && x !== straight.edge && Math.abs(x.dx * e.dx + x.dz * e.dz) < 0.3) }; }
          else {
            const outs = this.net.outgoing(node, e); const o = straight || outs[Math.floor(this.rand() * outs.length)];
            if (!o) { p.dir *= -1; } else { p.edge = o.edge; p.dir = o.fwd ? 1 : -1; p.t = o.fwd ? node.trim + 1.5 : o.edge.len - node.trim - 1.5; const cross = e.dx * o.edge.dz - e.dz * o.edge.dx; if (Math.abs(cross) > 0.5) p.side = p.side; }
          }
        }
      } else if (p.state === 'waitCross') {
        moving = false;
        const c = p.cross;
        let go;
        if (c.zebra) go = !this.cars.some((car) => car.links[0]?.edge === e && Math.hypot(car.pos.x - p.x, car.pos.z - p.z) < Math.max(12, car.v * 2.5)) && !(player.v > 2 && Math.hypot(player.x - p.x, player.z - p.z) < 22);
        else go = !c.perp || this.net.pedestrianGreen(c.node, c.perp, t);
        p.wait += dt;
        if (go || p.wait > 90) {
          p.state = 'cross'; p.wait = 0;
          if (c.zebra) { p.crossFrom = p.side; p.crossLink = e; }
          else { p.crossLink = c.perp; }
          p.onCrossing = true; p.crossT = 0;
          p.crossStart = { x: p.x, z: p.z };
          if (c.zebra) { const lat = -p.side * (e.half + 1.6); p.crossEnd = { x: e.a.x + e.dx * p.t + -e.dz * lat, z: e.a.z + e.dz * p.t + e.dx * lat }; }
          else {
            const o = c.to, n = c.node, t2 = o.fwd ? n.trim + 1.5 : o.edge.len - n.trim - 1.5;
            const off = p.side * (o.edge.half + 1.6) * (o.fwd === (p.dir > 0) ? 1 : 1);
            const sideSign = (e.dx * o.edge.dx + e.dz * o.edge.dz) > 0 ? 1 : -1;
            p.crossEnd = { x: o.edge.a.x + o.edge.dx * t2 + -o.edge.dz * off * sideSign, z: o.edge.a.z + o.edge.dz * t2 + o.edge.dx * off * sideSign };
            p.next = { edge: o.edge, dir: o.fwd ? 1 : -1, t: t2, side: p.side * sideSign };
          }
        }
      } else if (p.state === 'cross') {
        const L = Math.hypot(p.crossEnd.x - p.crossStart.x, p.crossEnd.z - p.crossStart.z) || 1;
        p.crossT += (p.speed * 1.1 * dt) / L;
        p.x = p.crossStart.x + (p.crossEnd.x - p.crossStart.x) * Math.min(1, p.crossT);
        p.z = p.crossStart.z + (p.crossEnd.z - p.crossStart.z) * Math.min(1, p.crossT);
        if (p.crossT >= 1) {
          p.onCrossing = false; p.state = 'walk';
          if (p.cross.zebra) p.side = -p.side; else Object.assign(p, p.next);
        }
      }
      if (p.state === 'walk') { const e2 = p.edge; p.x = e2.a.x + e2.dx * p.t + -e2.dz * p.side * (e2.half + 1.6); p.z = e2.a.z + e2.dz * p.t + e2.dx * p.side * (e2.half + 1.6); }
      const hx = p.state === 'cross' ? p.crossEnd.x - p.crossStart.x : p.edge.dx * p.dir, hz = p.state === 'cross' ? p.crossEnd.z - p.crossStart.z : p.edge.dz * p.dir;
      if (moving) p.g.rotation.y = Math.atan2(hx, hz);
      p.g.position.set(p.x, 0.15 + this.net.heightAt(p.x, p.z), p.z);
      p.va = moving ? p.speed : 0; p.vd = 0;
      p.animate(dt, t);
    }
  }

  dispose() { this.scene.remove(this.group); for (const l of this.laneLinks) l.cars.clear(); for (const l of this.net.links.values()) l.cars.clear(); }
}
function env_wet(w) { return w ? 0.85 : 1; }
