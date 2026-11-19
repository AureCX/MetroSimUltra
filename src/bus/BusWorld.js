// 3D world of the bus simulator, generated from a road network file: carriageways with lane
// markings and bus lanes, intersections, roundabouts, kerbs and sidewalks, zebra crossings,
// stop lines, traffic signals, speed signs, street lamps, bus stops with shelters and passenger
// information displays, district buildings (business, hotels, parking, industry, housing…),
// the bus depot and the airport. Also provides collision boxes and "is this paved road" queries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE, WALK } from './RoadNetwork.js';
import { cityTextures, boxGeo } from '../world/City.js';
import { Textures } from '../world/Textures.js';
import { buildAirport } from '../world/Airport.js';
import { seededRandom } from '../core/util.js';

const RY = 0.05, KERB = 0.15;

function ctex(w, h, draw, rep = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const rnd = seededRandom(31);
function asphalt(g, w, h, base = '#3b3c40') {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 25; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
}
const roadTexCache = new Map();
/** Carriageway texture (u across the full width, v = 12 m along). */
function roadTexture(lanes, bus) {
  const key = `${lanes}${bus}`;
  if (roadTexCache.has(key)) return roadTexCache.get(key);
  const W = 64 * lanes * 2, H = 256, px = W / (lanes * 2 * LANE);
  const t = ctex(W, H, (g) => {
    asphalt(g, W, H);
    if (bus) {
      g.fillStyle = 'rgba(168,58,48,0.85)'; g.fillRect(0, 0, LANE * px, H); g.fillRect(W - LANE * px, 0, LANE * px, H);
      g.fillStyle = '#f2efe6'; g.font = `bold ${Math.round(LANE * px * 0.42)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('BUS', W - (LANE * px) / 2, H * 0.5);
      g.save(); g.translate((LANE * px) / 2, H * 0.5); g.rotate(Math.PI); g.fillText('BUS', 0, 0); g.restore();
      g.fillRect(LANE * px - 3, 0, 6, H); g.fillRect(W - LANE * px - 3, 0, 6, H);
    }
    g.fillStyle = '#f2efe6';
    g.fillRect(2, 0, 4, H); g.fillRect(W - 6, 0, 4, H); // edge lines
    const mid = W / 2;
    if (lanes === 1) for (let y = 0; y < H; y += 128) g.fillRect(mid - 2, y, 4, 64);
    else {
      g.fillRect(mid - 7, 0, 4, H); g.fillRect(mid + 3, 0, 4, H);
      if (!bus) for (let y = 0; y < H; y += 128) { g.fillRect(LANE * px - 2, y, 4, 64); g.fillRect(W - LANE * px - 2, y, 4, 64); }
    }
  });
  roadTexCache.set(key, t);
  return t;
}

export class BusWorld {
  constructor(scene, net, opts = {}) {
    this.scene = scene; this.net = net; this.opts = opts;
    this.group = new THREE.Group(); this.group.name = 'busWorld'; scene.add(this.group);
    this.colliders = [];   // {x0,z0,x1,z1,h,kind}
    this.paved = [];       // extra drivable rectangles (depot, parking lots)
    this.signals = [];     // {node, d, lamps}
    this.stopViews = [];
    this.lampPositions = [];
    this.nightMats = [];   // emissive materials that light up at night
    const ct = cityTextures();
    const lam = (o) => new THREE.MeshLambertMaterial(o);
    this.mat = {
      ground: lam({ map: ctex(256, 256, (g) => { g.fillStyle = '#8c8a84'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${0.05 * rnd()})`; g.fillRect(rnd() * 256, rnd() * 256, 3, 3); } }) }),
      grass: lam({ map: ctex(256, 256, (g) => { g.fillStyle = '#5f7f3e'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < 0.5 ? `rgba(30,50,20,${0.3 * rnd()})` : `rgba(140,170,90,${0.2 * rnd()})`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); } }), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      asphalt: lam({ map: ctex(256, 256, (g) => asphalt(g, 256, 256)), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      walk: lam({ map: ctex(128, 128, (g) => { g.fillStyle = '#b8b3a8'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(0,0,0,0.15)'; for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } }) }),
      kerb: lam({ color: 0xc9c5bc }),
      white: new THREE.MeshBasicMaterial({ color: 0xf2efe6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
      yellowPaint: new THREE.MeshBasicMaterial({ color: 0xf2c200, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
      pole: lam({ color: 0x3a3e44 }), metal: new THREE.MeshStandardMaterial({ color: 0x8e969e, metalness: 0.6, roughness: 0.4 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xa9c6d6, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
      facades: ct.facades.map((t) => lam({ map: t, vertexColors: true })),
      curtain: new THREE.MeshStandardMaterial({ map: ct.curtain, vertexColors: true, metalness: 0.5, roughness: 0.25 }),
      roofGrey: lam({ color: 0x6a6e73 }), roofTile: lam({ color: 0x9b4a35 }), houseWall: lam({ color: 0xe6dccb }),
      leaves: lam({ color: 0x46702f }), trunk: lam({ color: 0x5a4030 }),
      car: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.4 }), carGlass: lam({ color: 0x1b2229 }),
      lampHead: new THREE.MeshBasicMaterial({ color: 0x777777 }),
      parkLines: new THREE.MeshBasicMaterial({ map: ctex(128, 256, (g) => { g.clearRect(0, 0, 128, 256); g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 4, 256); g.fillRect(124, 0, 4, 256); }), transparent: true, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
    };
  }

  build() {
    const n = this.net;
    this.buildGround();
    this.buildRoads();
    this.buildIntersections();
    this.buildSidewalks();
    this.buildMarkings();
    this.buildSignals();
    this.buildSigns();
    this.buildLamps();
    for (const s of n.stops) this.buildStop(s);
    for (const b of n.data.blocks || []) this.buildBlock(b);
    if (n.data.depot) this.buildDepot(n.data.depot);
    if (n.data.airport) this.buildAirportArea(n.data.airport);
    this.mergeStatic();
    this.applyTerrain();
    return this;
  }

  /** Lays the finished world on the terrain: merged geometry vertex by vertex, instances and other objects as a whole. */
  applyTerrain() {
    const T = this.net.terrain;
    if (!T || T.flat) return;
    const m = new THREE.Matrix4();
    for (const p of this.lampPositions) p.y += T.heightAt(p.x, p.z);
    for (const o of this.group.children) {
      if (o.isMesh && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.elements[13] += T.heightAt(m.elements[12], m.elements[14]); o.setMatrixAt(i, m); }
        o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere?.();
      } else if (o.isMesh && (o.userData.merged || (o.rotation.x === 0 && o.rotation.y === 0 && o.rotation.z === 0 && o.scale.x === 1 && o.geometry.boundingSphere?.radius > 4))) {
        // World-aligned geometry (merged statics, roads, ground): follow the terrain vertex by vertex.
        const pos = o.geometry.attributes.position, ox = o.position.x, oz = o.position.z;
        for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + T.heightAt(pos.getX(i) + ox, pos.getZ(i) + oz));
        pos.needsUpdate = true; o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox();
      } else o.position.y += T.heightAt(o.position.x, o.position.z);
    }
  }

  // ---------- helpers ----------
  quad(p0, p1, p2, p3, mat, y, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, y, p0.z, p1.x, y, p1.z, p2.x, y, p2.z, p3.x, y, p3.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
    g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); this.group.add(m); return m;
  }
  rect(x0, z0, x1, z1, mat, y, tile = 8) {
    // On sloping ground, large pieces are split where the slope changes so they follow the terrain.
    const T = this.net.terrain, cuts = T && !T.flat ? T.breaks.filter((c) => (T.axis === 'z' ? c > z0 + 0.5 && c < z1 - 0.5 : c > x0 + 0.5 && c < x1 - 0.5)) : [];
    if (cuts.length) {
      const edges = [T.axis === 'z' ? z0 : x0, ...cuts, T.axis === 'z' ? z1 : x1];
      let m = null;
      for (let i = 0; i < edges.length - 1; i++) m = T.axis === 'z' ? this.rectFlat(x0, edges[i], x1, edges[i + 1], mat, y, tile) : this.rectFlat(edges[i], z0, edges[i + 1], z1, mat, y, tile);
      return m;
    }
    return this.rectFlat(x0, z0, x1, z1, mat, y, tile);
  }
  rectFlat(x0, z0, x1, z1, mat, y, tile = 8) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2);
    const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (x1 - x0) / tile, u.getY(i) * (z1 - z0) / tile);
    const m = new THREE.Mesh(g, mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); this.group.add(m); return m;
  }
  box(w, h, d, mat, x, y, z, ry = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; this.group.add(m); return m; }
  building(x0, z0, x1, z1, h, mat, tile = 4, kind = 'building') {
    const m = new THREE.Mesh(boxGeo(x1 - x0, h, z1 - z0, 0, 0, 0, 0, tile, 0.5), mat);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2); this.group.add(m);
    this.colliders.push({ x0, z0, x1, z1, h, kind });
    return m;
  }
  sign(text, w, h, x, y, z, ry, opts = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: Textures.label(text, { w: 1024, h: Math.round(1024 * h / w), bg: '#1d2a3a', fg: '#ffffff', font: 'bold 64px Arial', ...opts }) }));
    m.position.set(x, y, z); m.rotation.y = ry; this.group.add(m); return m;
  }

  /** True when (x, z) is on a carriageway, intersection, roundabout or paved lot (not a kerb/sidewalk). */
  onRoad(x, z) {
    for (const r of this.paved) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    for (const n of this.net.nodes.values()) {
      const dx = x - n.x, dz = z - n.z;
      if (n.roundabout) { const d = Math.hypot(dx, dz); if (d < n.roundabout + 2.5 + LANE && d > n.roundabout - 5.5) return true; if (d < n.trim + 1) { /* approach throat */ } }
      else if (Math.abs(dx) < n.trim + 0.5 && Math.abs(dz) < n.trim + 0.5) return true;
    }
    for (const e of this.net.edges) {
      const t = (x - e.a.x) * e.dx + (z - e.a.z) * e.dz;
      if (t < -2 || t > e.len + 2) continue;
      const lat = Math.abs((x - e.a.x) * -e.dz + (z - e.a.z) * e.dx);
      if (lat < e.half + 0.35) return true;
    }
    return false;
  }

  // ---------- ground & roads ----------
  buildGround() {
    const { x0, z0, x1, z1 } = this.bounds();
    this.rect(x0 - 600, Math.max(0, z0 - 600), x1 + 600, z1 + 600, this.mat.grass, 0, 30);
    this.rect(x0 - 40, Math.max(-5, z0 - 40), x1 + 40, z1 + 40, this.mat.ground, 0.01, 10);
  }
  bounds() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const n of this.net.nodes.values()) { if (n.z < 0) continue; x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }
    return { x0, z0, x1, z1 };
  }

  buildRoads() {
    for (const e of this.net.edges) {
      const d = this.net.dir(e, true);
      const s0 = e.a.roundabout ? e.a.trim - 6 : 0, s1 = e.len - (e.b.roundabout ? e.b.trim - 6 : 0);
      const P = (s, l) => this.net.pointOn(d, s, l);
      const mat = new THREE.MeshLambertMaterial({ map: roadTexture(e.lanes, e.busLane), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.nightMats.push(mat);
      this.quad(P(s0, -e.half), P(s0, e.half), P(s1, e.half), P(s1, -e.half), mat, RY, [[0, s0 / 12], [1, s0 / 12], [1, s1 / 12], [0, s1 / 12]]);
    }
  }

  buildIntersections() {
    for (const n of this.net.nodes.values()) {
      if (n.roundabout) {
        const R = n.roundabout, outer = R + 2 + LANE * 1.1;
        const ring = new THREE.Mesh(new THREE.RingGeometry(R - 5.5, outer, 48), this.mat.asphalt); ring.rotation.x = -Math.PI / 2; ring.position.set(n.x, RY + 0.001, n.z); this.group.add(ring);
        const isl = new THREE.Mesh(new THREE.CylinderGeometry(R - 5.5, R - 5.2, 0.35, 40), this.mat.grass); isl.position.set(n.x, 0.17, n.z); this.group.add(isl);
        const kerb = new THREE.Mesh(new THREE.TorusGeometry(R - 5.5, 0.18, 6, 48), this.mat.kerb); kerb.rotation.x = Math.PI / 2; kerb.position.set(n.x, 0.2, n.z); this.group.add(kerb);
        const edge = new THREE.Mesh(new THREE.RingGeometry(R - 5.6, R - 5.35, 48), this.mat.white); edge.rotation.x = -Math.PI / 2; edge.position.set(n.x, RY + 0.01, n.z); this.group.add(edge);
        if (R > 18) for (let i = 0; i < 5; i++) { const a = i * 1.3; this.tree(n.x + Math.cos(a) * (R - 10), n.z + Math.sin(a) * (R - 10), 1.1); }
        this.colliders.push({ x0: n.x - (R - 6.5) * 0.7, z0: n.z - (R - 6.5) * 0.7, x1: n.x + (R - 6.5) * 0.7, z1: n.z + (R - 6.5) * 0.7, h: 0.35, kind: 'island' });
        // Throats joining the arms to the ring.
        for (const e of n.edges) {
          const d = this.net.dir(e, e.a === n);
          const P = (s, l) => this.net.pointOn(d, s, l);
          this.quad(P(R - 2, -e.half - 1.5), P(R - 2, e.half + 1.5), P(n.trim - 5.9, e.half), P(n.trim - 5.9, -e.half), this.mat.asphalt, RY);
        }
        continue;
      }
      const t = n.trim;
      this.rect(n.x - t, n.z - t, n.x + t, n.z + t, this.mat.asphalt, RY, 8);
    }
  }

  buildSidewalks() {
    const geos = [], kerbs = [];
    for (const e of this.net.edges) {
      const d = this.net.dir(e, true);
      const endTrim = (node) => {
        if (node.roundabout) return node.trim - 6;
        const others = node.edges.filter((x) => x !== e);
        return others.length ? Math.max(...others.map((x) => x.half)) : 0;
      };
      const s0 = endTrim(e.a), s1 = e.len - endTrim(e.b);
      if (s1 - s0 < 1) continue;
      for (const side of [-1, 1]) {
        const l0 = side * e.half, l1 = side * (e.half + WALK);
        const pts = [this.net.pointOn(d, s0, l0), this.net.pointOn(d, s0, l1), this.net.pointOn(d, s1, l1), this.net.pointOn(d, s1, l0)];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, KERB, p.z]), 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, s0 / 3, 1, s0 / 3, 1, s1 / 3, 0, s1 / 3], 2));
        g.setIndex(side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        if (g.attributes.normal.getY(0) < 0) { g.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]); g.computeVertexNormals(); }
        geos.push(g);
        const a = this.net.pointOn(d, s0, l0 + side * 0.1), b = this.net.pointOn(d, s1, l0 + side * 0.1);
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const k = new THREE.BoxGeometry(0.22, KERB + 0.02, len); k.rotateY(Math.atan2(b.x - a.x, b.z - a.z)); k.translate((a.x + b.x) / 2, KERB / 2, (a.z + b.z) / 2);
        kerbs.push(k);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(geos), this.mat.walk));
    this.group.add(new THREE.Mesh(mergeGeometries(kerbs), this.mat.kerb));
  }

  /** Zebra crossings, stop lines and bus-stop bays. */
  buildMarkings() {
    const zebra = (d, sA, sB, half) => {
      for (let l = -half + 0.4; l < half - 0.3; l += 1.0) {
        const p = (s, ll) => this.net.pointOn(d, s, ll);
        this.quad(p(sA, l), p(sA, l + 0.5), p(sB, l + 0.5), p(sB, l), this.mat.white, RY + 0.002);
      }
    };
    for (const n of this.net.nodes.values()) {
      if (!n.crosswalk) continue;
      for (const e of n.edges) {
        const d = this.net.dir(e, e.b === n); // arriving at n
        const sEnd = e.len - n.trim;
        zebra(d, sEnd + 0.8, sEnd + 4.8, e.half);
        // Stop line across the arriving lanes.
        const p = (s, l) => this.net.pointOn(d, s, l);
        this.quad(p(sEnd - 6.5, 0.1), p(sEnd - 6.5, e.half - 0.2), p(sEnd - 6.1, e.half - 0.2), p(sEnd - 6.1, 0.1), this.mat.white, RY + 0.003);
        void sEnd;
      }
    }
    for (const c of this.net.crossings) {
      const d = this.net.dir(c.edge, true);
      zebra(d, c.along - 2, c.along + 2, c.edge.half);
      // Beacon poles at both ends.
      for (const side of [-1, 1]) {
        const p = this.net.pointOn(d, c.along, side * (c.edge.half + 0.6));
        this.box(0.08, 2.6, 0.08, this.mat.pole, p.x, 1.3, p.z);
        const glob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb300 })); glob.position.set(p.x, 2.7, p.z); this.group.add(glob);
      }
    }
  }

  buildSignals() {
    const housing = new THREE.MeshLambertMaterial({ color: 0x1b1d20 });
    for (const n of this.net.nodes.values()) {
      if (!n.signal) continue;
      for (const e of n.edges) {
        const d = this.net.dir(e, e.b === n);
        const sEnd = e.len - n.trim;
        const p = this.net.pointOn(d, sEnd - 5.6, e.half + 1.2);
        const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = Math.atan2(-d.dx, -d.dz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8), this.mat.pole); pole.position.y = 2.1; g.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.15, 0.28), housing); head.position.set(0, 3.5, 0); g.add(head);
        const lamps = {};
        ['red', 'yellow', 'green'].forEach((c, i) => {
          const m = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), new THREE.MeshBasicMaterial({ color: 0x222222 }));
          m.position.set(0, 3.85 - i * 0.36, 0.145); g.add(m); lamps[c] = m;
        });
        // Overhead repeater on a mast arm for multi-lane roads.
        if (e.lanes > 1) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, e.half), this.mat.pole); arm.rotation.y = Math.PI / 2; arm.position.set(-e.half / 2, 4.5, 0); g.add(arm);
          const h2 = head.clone(); h2.position.set(-e.half + 1, 4.9, 0); g.add(h2);
          ['red', 'yellow', 'green'].forEach((c, i) => { const m = lamps[c].clone(); m.material = lamps[c].material; m.position.set(-e.half + 1, 5.25 - i * 0.36, 0.145); g.add(m); });
        }
        this.group.add(g);
        this.signals.push({ node: n, d, lamps, state: null });
        this.colliders.push({ x0: p.x - 0.2, z0: p.z - 0.2, x1: p.x + 0.2, z1: p.z + 0.2, h: 4, kind: 'pole' });
      }
    }
  }

  /** Speed-limit, give-way and roundabout signs at the start of each directed edge. */
  buildSigns() {
    const speedTex = (v) => Textures.label(String(v), { w: 128, h: 128, bg: '#ffffff', fg: '#111', font: 'bold 64px Arial', border: '#d00000', radius: 64 });
    for (const e of this.net.edges) for (const fwd of [true, false]) {
      const d = this.net.dir(e, fwd);
      const p = this.net.pointOn(d, d.from.trim + 6, e.half + 1.0);
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = Math.atan2(-d.dx, -d.dz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), this.mat.pole); pole.position.y = 1.2; g.add(pole);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.33, 24), new THREE.MeshBasicMaterial({ map: speedTex(e.speed) })); face.position.set(0, 2.3, 0.03); g.add(face);
      // Street name plate.
      const name = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshBasicMaterial({ map: Textures.label(e.name || '—', { w: 512, h: 96, bg: '#1f3c88', fg: '#ffffff', font: 'bold 40px Arial', radius: 6 }) }));
      name.position.set(0, 1.75, 0.03); g.add(name);
      const to = d.to;
      if (to.roundabout || (!to.signal && to.edges.length >= 3 && e.speed <= 50 && !(Math.abs(e.dz) > 0.9))) {
        const tri = new THREE.Mesh(new THREE.CircleGeometry(0.42, 3), new THREE.MeshBasicMaterial({ color: 0xd00000 }));
        const tri2 = new THREE.Mesh(new THREE.CircleGeometry(0.3, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const q = this.net.pointOn(d, e.len - to.trim - 3, e.half + 1.0);
        const gg = new THREE.Group(); gg.position.set(q.x, 0, q.z); gg.rotation.y = Math.atan2(-d.dx, -d.dz);
        tri.rotation.z = -Math.PI / 2; tri2.rotation.z = -Math.PI / 2; tri.position.set(0, 2.1, 0.02); tri2.position.set(0, 2.1, 0.03);
        const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 6), this.mat.pole); pl.position.y = 1.05;
        gg.add(pl, tri, tri2); this.group.add(gg);
        d.giveWay = true;
      }
      this.group.add(g);
    }
  }

  buildLamps() {
    const pts = [];
    for (const e of this.net.edges) {
      const d = this.net.dir(e, true);
      for (let s = e.a.trim + 12; s < e.len - e.b.trim - 6; s += 38) for (const side of [-1, 1]) {
        const p = this.net.pointOn(d, s + (side > 0 ? 19 : 0), side * (e.half + 0.6));
        pts.push({ x: p.x, z: p.z, ox: d.rx * -side * 1.4, oz: d.rz * -side * 1.4 });
      }
    }
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 8, 6), this.mat.pole, pts.length);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.16, 0.35), this.mat.lampHead, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.makeTranslation(p.x, 4, p.z); pole.setMatrixAt(i, m); m.makeTranslation(p.x + p.ox, 8, p.z + p.oz); head.setMatrixAt(i, m); this.lampPositions.push(new THREE.Vector3(p.x + p.ox, 7.8, p.z + p.oz)); });
    pole.computeBoundingSphere(); head.computeBoundingSphere();
    this.group.add(pole, head);
    this.lampHeads = head;
  }

  tree(x, z, k = 1) {
    (this.treeList ||= []).push([x, z, k]);
  }

  // ---------- bus stops ----------
  buildStop(stop) {
    const e = stop.edge, views = [];
    for (const fwd of [true, false]) {
      const d = this.net.dir(e, fwd);
      const s = fwd ? stop.along : e.len - stop.along;
      const P = (ss, l) => this.net.pointOn(d, ss, l);
      // Bay marking (yellow zig-zag outline) on the kerb lane.
      const l0 = e.half - LANE + 0.2, l1 = e.half - 0.15;
      for (let k = -24; k < 4; k += 4) { this.quad(P(s + k, l0), P(s + k + 0.2, l0), P(s + k + 2.2, l1), P(s + k + 2, l1), this.mat.yellowPaint, RY + 0.004); this.quad(P(s + k + 2, l1), P(s + k + 2.2, l1), P(s + k + 4.2, l0), P(s + k + 4, l0), this.mat.yellowPaint, RY + 0.004); }
      const busTxt = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: Textures.label('BUS', { w: 256, h: 128, bg: 'rgba(0,0,0,0)', fg: '#f2c200', font: 'bold 96px Arial' }), transparent: true, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 }));
      const bp = P(s - 12, (l0 + l1) / 2); busTxt.rotation.set(-Math.PI / 2, 0, Math.atan2(d.dx, -d.dz) + Math.PI); busTxt.position.set(bp.x, RY + 0.006, bp.z); this.group.add(busTxt);
      // Pole with flag.
      const pole = P(s, e.half + 0.5);
      this.box(0.08, 3.0, 0.08, this.mat.pole, pole.x, 1.5, pole.z);
      const aeroval = !!stop.aeroval;
      const flagTex = Textures.label(aeroval ? 'AÉROVAL' : 'BUS', { w: 256, h: 128, bg: aeroval ? '#FFD000' : '#1f3c88', fg: aeroval ? '#16233a' : '#ffffff', font: 'bold 60px Arial', radius: 10 });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
      flag.position.set(pole.x + d.dx * 0.01, 2.75, pole.z + d.dz * 0.01); flag.rotation.y = Math.atan2(d.rx, d.rz); this.group.add(flag);
      // Shelter behind the sidewalk.
      const sh = P(s - 8, e.half + WALK - 0.4);
      const g = new THREE.Group(); g.position.set(sh.x, 0, sh.z); g.rotation.y = Math.atan2(d.dx, d.dz);
      const len = 7, dep = 1.8;
      const glassL = (w, h, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), this.mat.glass); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); };
      glassL(dep, 2.2, 0.0, 1.25, len / 2, Math.PI / 2); glassL(dep, 2.2, 0, 1.25, -len / 2, Math.PI / 2);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.2, len), this.mat.glass); back.position.set(dep / 2 * (d.fwd ? 1 : 1), 1.25, 0); g.add(back);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(dep + 0.6, 0.12, len + 0.4), new THREE.MeshLambertMaterial({ color: aeroval ? 0xffd000 : 0x2a3038 })); roof.position.set(0.2, 2.45, 0); g.add(roof);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 3), this.mat.metal); bench.position.set(0.55, 0.5, 0); g.add(bench);
      // Name plate and passenger information display (updated live).
      const name = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.6, 0.38), new THREE.MeshBasicMaterial({ map: Textures.label(stop.name, { w: 1024, h: 64, bg: aeroval ? '#16233a' : '#1f3c88', fg: '#ffffff', font: 'bold 40px Arial', radius: 4 }), side: THREE.DoubleSide }));
      name.position.set(-0.32, 2.2, 0); name.rotation.y = -Math.PI / 2; g.add(name);
      const c = document.createElement('canvas'); c.width = 512; c.height = 192;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const pid = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.5), new THREE.MeshBasicMaterial({ map: tex })); pid.position.set(-0.32, 1.75, 2.2); pid.rotation.y = -Math.PI / 2; g.add(pid);
      const pidBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 1.4), new THREE.MeshLambertMaterial({ color: 0x111111 })); pidBox.position.set(-0.27, 1.75, 2.2); g.add(pidBox);
      // Interchange badges (metro lines) on the totem.
      if (stop.metro?.length) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: Textures.label('M', { w: 128, h: 128, bg: '#ffffff', fg: '#1f3c88', font: 'bold 96px Arial', border: '#1f3c88', radius: 64 }), transparent: true, side: THREE.DoubleSide }));
        m.position.set(pole.x, 3.25, pole.z); m.rotation.y = Math.atan2(d.rx, d.rz); this.group.add(m);
      }
      this.group.add(g);
      this.colliders.push({ x0: Math.min(sh.x, sh.x) - 1.4, z0: sh.z - 1.4, x1: sh.x + 1.4, z1: sh.z + 1.4, h: 2.5, kind: 'shelter', soft: true });
      views.push({ stop, fwd, d, s, pid: { c, tex }, waitPoint: P(s - 6, e.half + WALK * 0.6), polePoint: pole });
    }
    this.stopViews.push(...views);
  }

  // ---------- districts ----------
  inner(b) {
    const m = 14 + WALK + 2; // keep clear of streets & sidewalks
    return { x0: b.x0 + m, z0: b.z0 + m, x1: b.x1 - m, z1: b.z1 - m };
  }
  buildBlock(b) {
    const r = seededRandom(Math.round(b.x0 * 3 + b.z0 * 7));
    const I = this.inner(b);
    const F = this.mat.facades;
    const W = I.x1 - I.x0, D = I.z1 - I.z0, cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2;
    const facing = (x0, z0, x1, z1, h, text, sz = 1) => { // name sign on the side facing the nearest street (south side = +z)
      this.sign(text, Math.min(x1 - x0 - 2, 24 * sz), 2.4 * sz, (x0 + x1) / 2, Math.min(h - 2, 10), z1 + 0.06, 0);
      this.sign(text, Math.min(x1 - x0 - 2, 24 * sz), 2.4 * sz, (x0 + x1) / 2, Math.min(h - 2, 10), z0 - 0.06, Math.PI);
    };
    switch (b.type) {
      case 'business': {
        for (let i = 0; i < 4; i++) {
          const w = 34 + r() * 14, d = 30 + r() * 10, h = 45 + r() * 95;
          const x = I.x0 + (i % 2 ? W * 0.72 : W * 0.25), z = I.z0 + (i < 2 ? D * 0.28 : D * 0.73);
          this.building(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h, r() < 0.6 ? this.mat.curtain : F[3]);
        }
        this.rect(I.x0, I.z0, I.x1, I.z1, this.mat.walk, 0.03, 3);
        this.sign(b.name, 30, 2.4, cx, 3, I.z0 - 0.5, Math.PI);
        break;
      }
      case 'hotel': {
        const names = ['Hôtel Skyline Aéroport', 'Novaterm Hôtel', 'Grandville Airport Inn'];
        for (let i = 0; i < 3; i++) {
          const w = 70, d = 22, h = 28 + i * 9, x = I.x0 + 50 + i * ((W - 100) / 2), z = I.z0 + 25 + (i % 2) * 70;
          this.building(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h, F[i % 2 ? 4 : 0]);
          this.sign(names[i], 26, 2.4, x, h - 2, z - d / 2 - 0.06, Math.PI, { bg: '#20303f', fg: '#e9cf8a', font: 'bold 60px Georgia, serif' });
          this.box(14, 0.2, 6, this.mat.roofGrey, x, 3.6, z - d / 2 - 3); // drop-off canopy
        }
        break;
      }
      case 'parking': this.parkingLot(I, r, b.name, 0.85); break;
      case 'rental': {
        this.parkingLot({ ...I, z0: I.z0 + 60 }, r, null, 0.9);
        this.building(I.x0 + 20, I.z0 + 4, I.x0 + 200, I.z0 + 40, 9, F[4]);
        this.sign('CENTRE DE LOCATION DE VOITURES', 60, 3, I.x0 + 110, 6.5, I.z0 + 3.9, Math.PI, { bg: '#0f6b3a' });
        for (let k = 0; k < 4; k++) this.sign(['AVIS-LOC', 'RENTACAR', 'EUROPCAB', 'GV RENT'][k], 14, 1.6, I.x0 + 40 + k * 44, 8.4, I.z0 + 40.06, 0, { bg: ['#c8352a', '#1f4fa0', '#2f8a4a', '#e07b14'][k] });
        break;
      }
      case 'staff': {
        this.building(I.x0 + 10, I.z0 + 10, I.x0 + 160, I.z0 + 70, 14, F[3]);
        this.building(I.x0 + 200, I.z0 + 10, I.x1 - 10, I.z0 + 90, 11, F[4]);
        this.sign('ZONE DU PERSONNEL – ACCÈS RÉSERVÉ', 50, 2.6, I.x0 + 85, 9, I.z0 + 70.06, 0, { bg: '#c8352a' });
        this.parkingLot({ x0: I.x0 + 10, z0: I.z0 + 120, x1: I.x1 - 10, z1: I.z1 - 10 }, r, null, 0.7);
        break;
      }
      case 'expo': {
        const x0 = I.x0 + 20, x1 = I.x1 - 20, z0 = I.z0 + 70, z1 = I.z1 - 10;
        this.building(x0, z0, x1, z1, 22, F[3]);
        const arch = new THREE.CylinderGeometry((z1 - z0) / 2, (z1 - z0) / 2, x1 - x0, 32, 1, true, -Math.PI / 2, Math.PI);
        arch.rotateZ(Math.PI / 2); arch.scale(1, 0.25, 1);
        const roof = new THREE.Mesh(arch, new THREE.MeshStandardMaterial({ color: 0xc9d0d6, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide })); roof.position.set((x0 + x1) / 2, 22, (z0 + z1) / 2); this.group.add(roof);
        this.sign('PARC DES EXPOSITIONS', 90, 7, (x0 + x1) / 2, 15, z0 - 0.06, Math.PI, { bg: '#16233a', fg: '#ffffff' });
        this.rect(I.x0, I.z0, I.x1, z0, this.mat.walk, 0.03, 3);
        for (let k = 0; k < 6; k++) { const fx = I.x0 + 40 + k * ((W - 80) / 5); this.box(0.1, 12, 0.1, this.mat.pole, fx, 6, I.z0 + 20); this.box(2.4, 1.6, 0.04, new THREE.MeshLambertMaterial({ color: [0x1f4fa0, 0xc8352a, 0xffd000, 0x2f8a4a, 0x5a2a8a, 0xe07b14][k], side: THREE.DoubleSide }), fx + 1.2, 11, I.z0 + 20); }
        break;
      }
      case 'commercial': {
        this.building(I.x0 + 40, I.z0 + 140, I.x1 - 40, I.z1 - 10, 16, F[4]);
        this.sign(b.name.toUpperCase(), 70, 4, cx, 12, I.z0 + 139.94, Math.PI, { bg: '#5a2a8a' });
        this.parkingLot({ x0: I.x0, z0: I.z0, x1: I.x1, z1: I.z0 + 125 }, r, null, 0.6);
        break;
      }
      case 'industrial': {
        for (let i = 0; i < 3; i++) {
          const x0 = I.x0 + 10 + i * (W / 3), x1 = x0 + W / 3 - 25;
          this.building(x0, I.z0 + 30, x1, I.z1 - 40, 12 + r() * 6, F[3], 5);
          for (let k = 0; k < 3; k++) this.truck(x0 + 20 + k * 22, I.z1 - 25, r);
        }
        this.sign(b.name.toUpperCase(), 40, 2.6, cx, 3, I.z0 + 2, Math.PI, { bg: '#555b62' });
        break;
      }
      case 'residential': {
        for (let x = I.x0 + 10; x < I.x1 - 12; x += 22) for (const z of [I.z0 + 12, I.z1 - 12]) this.house(x + 6, z, r, z > cz);
        for (let x = I.x0 + 20; x < I.x1; x += 30) this.tree(x, cz + (r() - 0.5) * 30, 1 + r() * 0.4);
        this.rect(I.x0, I.z0 + 26, I.x1, I.z1 - 26, this.mat.grass, 0.03, 20);
        break;
      }
      case 'depot': break;
      default: break;
    }
  }

  parkingLot(I, r, title, fill) {
    this.rect(I.x0, I.z0, I.x1, I.z1, this.mat.asphalt, 0.03, 8);
    this.paved.push({ ...I });
    const cars = [];
    for (let z = I.z0 + 8; z < I.z1 - 6; z += 16) {
      const lines = new THREE.Mesh(new THREE.PlaneGeometry(I.x1 - I.x0 - 10, 5.2), this.mat.parkLines);
      lines.rotation.x = -Math.PI / 2; lines.position.set((I.x0 + I.x1) / 2, 0.035, z);
      const u = lines.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, u.getX(i) * (I.x1 - I.x0 - 10) / 2.6);
      this.group.add(lines);
      for (let x = I.x0 + 6; x < I.x1 - 6; x += 2.6) if (r() < fill) cars.push([x + 1.3, z, Math.PI / 2 * 0, r]);
    }
    this.instCars(cars.map(([x, z]) => [x, z, 0]));
    if (title) { this.box(0.3, 6, 0.3, this.mat.pole, I.x0 + 5, 3, I.z0 + 2); this.sign(title, 12, 3, I.x0 + 5, 7.5, I.z0 + 2.2, 0, { bg: '#1f4fa0' }); }
  }

  instCars(list) {
    if (!list.length) return;
    const body = new THREE.BoxGeometry(1.8, 0.75, 4.3); body.translate(0, 0.55, 0);
    const cab = new THREE.BoxGeometry(1.6, 0.6, 2.2); cab.translate(0, 1.2, -0.2);
    const b = new THREE.InstancedMesh(body, this.mat.car, list.length), c = new THREE.InstancedMesh(cab, this.mat.carGlass, list.length);
    const m = new THREE.Matrix4(), col = new THREE.Color(), pal = [0xb8bec4, 0x1d1f22, 0xf2f2f2, 0x8a1c1c, 0x23406e, 0x5f6b72, 0xc9a227, 0x2e5a3a];
    list.forEach(([x, z, yaw], i) => { m.makeRotationY(yaw); m.setPosition(x, 0.03, z); b.setMatrixAt(i, m); c.setMatrixAt(i, m); b.setColorAt(i, col.setHex(pal[(i * 7 + Math.round(x)) % pal.length])); });
    b.computeBoundingSphere(); c.computeBoundingSphere();
    this.group.add(b, c);
  }
  truck(x, z, r) {
    this.box(2.4, 2.4, 2.2, new THREE.MeshLambertMaterial({ color: [0xc8352a, 0x1f4fa0, 0xeeeeee][Math.floor(r() * 3)] }), x, 1.6, z - 4.5);
    this.box(2.5, 3.2, 8, this.mat.houseWall, x, 2.1, z + 1);
  }
  house(x, z, r, back) {
    const w = 9 + r() * 4, d = 8 + r() * 3, h = 5.5 + r() * 2.5;
    this.building(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h, this.mat.houseWall, 4, 'house');
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 3, 4), this.mat.roofTile); roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); roof.position.set(x, h + 1.5, z); this.group.add(roof);
    this.tree(x + w / 2 + 3, z + (back ? 3 : -3), 0.9);
  }

  // ---------- depot ----------
  buildDepot(dp) {
    const F = this.mat.facades;
    this.rect(dp.x0, dp.z0, dp.x1, dp.z1, this.mat.asphalt, 0.04, 8);
    this.paved.push({ x0: dp.x0, z0: dp.z0, x1: dp.x1, z1: dp.z1 });
    // Bus bays.
    for (let x = dp.x0 + 20; x < dp.x1 - 20; x += 6) { const l = this.box(0.15, 0.01, 16, this.mat.white, x, 0.05, dp.z1 - 12); void l; }
    // Maintenance hall with two open bays.
    const mb = dp.bays;
    const hall = (x, z, title, color) => {
      this.box(16, 0.4, 24, this.mat.roofGrey, x, 7.2, z);
      for (const sx of [-8, 8]) this.box(0.4, 7, 24, F[3], x + sx, 3.5, z);
      this.box(16, 7, 0.4, F[3], x, 3.5, z - 12);
      this.sign(title, 14, 1.6, x, 8.4, z + 12.05, 0, { bg: color });
      this.colliders.push({ x0: x - 8.3, z0: z - 12.3, x1: x - 7.7, z1: z + 12, h: 7, kind: 'wall' }, { x0: x + 7.7, z0: z - 12.3, x1: x + 8.3, z1: z + 12, h: 7, kind: 'wall' });
    };
    hall(mb.maintenance[0], mb.maintenance[1], 'ATELIER – MAINTENANCE', '#c8352a');
    hall(mb.wash[0], mb.wash[1], 'STATION DE LAVAGE', '#1f4fa0');
    // Wash brushes.
    for (const sx of [-5.5, 5.5]) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.5, 12), new THREE.MeshLambertMaterial({ color: 0x2d6fd2 })); br.position.set(mb.wash[0] + sx, 2.4, mb.wash[1]); this.group.add(br); }
    // Fuel station canopy and pumps.
    const [fx, fz] = mb.fuel;
    this.box(18, 0.5, 14, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), fx, 6, fz);
    for (const sx of [-8, 8]) this.box(0.5, 6, 0.5, this.mat.pole, fx + sx, 3, fz);
    for (const sx of [-4, 4]) { this.box(1, 1.8, 0.6, new THREE.MeshLambertMaterial({ color: 0xc8352a }), fx + sx, 0.95, fz); this.colliders.push({ x0: fx + sx - 0.6, z0: fz - 0.4, x1: fx + sx + 0.6, z1: fz + 0.4, h: 2, kind: 'pump' }); }
    this.sign('CARBURANT – GAZOLE', 12, 1.2, fx, 5.5, fz + 7.06, 0, { bg: '#2a2e33', fg: '#ffd000' });
    // Chargers (plug posts and a pantograph mast).
    const [cx, cz] = mb.charge;
    for (const sx of [-6, 0, 6]) { this.box(0.8, 2, 0.5, new THREE.MeshLambertMaterial({ color: 0x2fa84f }), cx + sx, 1, cz - 4); this.colliders.push({ x0: cx + sx - 0.5, z0: cz - 4.4, x1: cx + sx + 0.5, z1: cz - 3.6, h: 2, kind: 'charger' }); }
    this.box(0.5, 6, 0.5, this.mat.pole, cx + 9, 3, cz); this.box(6, 0.4, 0.6, this.mat.pole, cx + 6, 6, cz);
    this.sign('RECHARGE ÉLECTRIQUE', 12, 1.2, cx, 3.2, cz - 4.3, 0, { bg: '#2fa84f' });
    // Office & departures board.
    this.building(dp.x1 - 40, dp.z0 + 2, dp.x1 - 5, dp.z0 + 20, 8, F[4]);
    this.sign(dp.name, 30, 1.8, dp.x1 - 22.5, 6.5, dp.z0 + 20.06, 0, { bg: '#16233a' });
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(dp.x1 - 22.5, 3.2, dp.z0 + 20.07); this.group.add(board);
    this.depotBoard = { c, tex };
    // Parked fleet (static silhouettes) along the back row.
    for (let x = dp.x0 + 30; x < dp.x1 - 60; x += 6) { this.box(2.5, 3.0, 12, new THREE.MeshLambertMaterial({ color: (x / 6) % 3 < 1 ? 0xffd000 : 0xe8ecef }), x, 1.6, dp.z1 - 12); this.colliders.push({ x0: x - 1.3, z0: dp.z1 - 18, x1: x + 1.3, z1: dp.z1 - 6, h: 3, kind: 'bus' }); }
    this.zones = Object.fromEntries(Object.entries(mb).map(([k, [x, z]]) => [k, { x, z, r: k === 'fuel' || k === 'charge' ? 9 : 7 }]));
  }

  // ---------- airport ----------
  buildAirportArea(ap) {
    const site = buildAirport(this.group, { x: ap.x, z: ap.z, y: 0, yaw: 0 }, null, null, 0, { landside: false, heading: 90 });
    this.airport = site;
    // Terminal 1 is the existing terminal (x −270…270); collision box.
    this.colliders.push({ x0: -270, z0: -95, x1: 270, z1: 18, h: 18, kind: 'terminal' });
    this.colliders.push({ x0: -280, z0: 105, x1: -60, z1: 195, h: 16, kind: 'carpark' }, { x0: 60, z0: 105, x1: 280, z1: 195, h: 16, kind: 'carpark' }, { x0: -35, z0: 248, x1: 35, z1: 272, h: 64, kind: 'hotel' });
    this.sign('TERMINAL 1', 30, 3, 120, 20, 32.4, 0, { bg: '#1d2a3a' });
    // Terminal 2 (west).
    const t2 = this.mat.curtain;
    this.building(-1060, -70, -740, 18, 16, t2);
    const arch = new THREE.Shape(); arch.moveTo(-50, 0); arch.quadraticCurveTo(0, 18, 50, 0); arch.lineTo(50, -1); arch.quadraticCurveTo(0, 17, -50, -1); arch.closePath();
    const roof = new THREE.ExtrudeGeometry(arch, { depth: 330, bevelEnabled: false, curveSegments: 20 }); roof.translate(0, 0, -165); roof.rotateY(Math.PI / 2);
    const rm = new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: 0xcfd4d8, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide })); rm.position.set(-900, 16.2, -26); this.group.add(rm);
    this.sign('TERMINAL 2', 34, 3.4, -900, 12, 18.06, 0, { bg: '#1d2a3a' });
    this.sign('ZONE CARGO & FRET', 40, 3, 950, 14, -359.9, 0, { bg: '#2a2e33', fg: '#e8c21a' });
  }

  /** Merge static meshes per material (keeps draw calls reasonable). */
  mergeStatic() {
    if (this.treeList?.length) {
      const L = this.treeList;
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 3, 5, 1, true), this.mat.trunk, L.length);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.3, 0), this.mat.leaves, L.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      L.forEach(([x, z, k], i) => { m.compose(p.set(x, 1.5 * k, z), q.identity(), s.set(k, k, k)); trunk.setMatrixAt(i, m); m.compose(p.set(x, 4.2 * k, z), q, s.set(k, k * 1.1, k)); crown.setMatrixAt(i, m); });
      trunk.computeBoundingSphere(); crown.computeBoundingSphere();
      this.group.add(trunk, crown);
      for (const [x, z] of L) this.colliders.push({ x0: x - 0.3, z0: z - 0.3, x1: x + 0.3, z1: z + 0.3, h: 3, kind: 'tree' });
    }
    const keep = new Set([...this.signals.flatMap((s) => Object.values(s.lamps))]);
    const buckets = new Map();
    for (const o of [...this.group.children]) {
      if (!o.isMesh || o.isInstancedMesh || keep.has(o) || o.material.map?.isCanvasTexture && o.material.map.image?.width === 512 && o.material.map.image?.height === 192) continue;
      if (this.nightMats.includes(o.material)) continue;
      o.updateMatrix();
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
      const key = `${o.material.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
      buckets.get(key).geos.push(geo); this.group.remove(o);
    }
    for (const { mat, geos } of buckets.values()) { const g = mergeGeometries(geos); if (g) { const mm = new THREE.Mesh(g, mat); mm.userData.merged = true; this.group.add(mm); } }
  }

  // ---------- per-frame ----------
  update(t, clockStr) {
    for (const s of this.signals) {
      const st = this.net.signalState(s.node, s.d, t);
      if (st === s.state) continue;
      s.state = st;
      s.lamps.red.material.color.setHex(st === 'red' ? 0xff2a1a : 0x2a0806);
      s.lamps.yellow.material.color.setHex(st === 'yellow' ? 0xffb300 : 0x2a2000);
      s.lamps.green.material.color.setHex(st === 'green' ? 0x19ff6a : 0x062a12);
    }
    void clockStr;
  }
}
