// Open-air sections: ground and track bed (cuttings / low embankments), tunnel portal
// headwalls, fences, a road with street lights, buildings and trees. Everything is generated
// from the alignment, so any line with "portal" segments gets a surface section.
import * as THREE from 'three';
import { sweep, tunnelProfile, FLOOR_Y } from './Sweep.js';
import { Textures } from './Textures.js';
import { seededRandom, hashString } from '../core/util.js';
import { City } from './City.js';
import { buildCityHall, buildUniversity, landmarkFrame } from './Landmarks.js';
import { buildAirport } from './Airport.js';

const LANDMARKS = { cityHall: buildCityHall, university: buildUniversity, airport: buildAirport };

const VIADUCT_CLEAR = 5;  // bed this high above the street (m) or more = viaduct, streets pass underneath
const CHUNK = 100;

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
let texCache;
function textures() {
  if (texCache) return texCache;
  const r = seededRandom(4242);
  const grass = canvasTex(256, 256, (g) => {
    g.fillStyle = '#4a6a2f'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(40,70,25,${0.25 * r()})` : `rgba(150,170,90,${0.2 * r()})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
  });
  const road = canvasTex(128, 256, (g) => {
    g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${0.05 * r()})`; g.fillRect(r() * 128, r() * 256, 1, 1); }
    g.fillStyle = '#e8e4d8'; g.fillRect(62, 0, 4, 120);
    g.fillRect(4, 0, 3, 256); g.fillRect(121, 0, 3, 256);
  });
  const facades = [['#d8cbb3', '#33404d'], ['#b9a48a', '#2b3440'], ['#8f9aa5', '#1e2832'], ['#c9b8a6', '#3b2f2a'], ['#e5e2da', '#435468'], ['#a1574a', '#2d2a28']].map(([wall, win], k) =>
    canvasTex(256, 256, (g) => {
      g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const lit = r() < 0.18;
        g.fillStyle = lit ? '#f3d58a' : win; g.fillRect(x * 64 + 14, y * 64 + 12, 36, 42);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x * 64 + 14, y * 64 + 12, 36, 4);
        if (k % 2) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x * 64 + 10, y * 64 + 56, 44, 4); }
      }
    }));
  const strip = canvasTex(256, 256, (g) => {
    // planting bed with a gravel footpath along the middle
    g.fillStyle = '#4f6b34'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7000; i++) { g.fillStyle = r() < 0.5 ? `rgba(30,50,20,${0.3 * r()})` : `rgba(120,150,70,${0.25 * r()})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
    g.fillStyle = '#c9c0ab'; g.fillRect(140, 0, 52, 256);
    g.fillStyle = '#b9b2a4'; g.fillRect(0, 0, 14, 256);
  });
  texCache = { grass, road, facades, strip };
  return texCache;
}

export class OutdoorBuilder {
  constructor(world) {
    this.w = world; this.geom = world.geom; this.line = world.line;
    this.group = new THREE.Group(); this.group.name = 'outdoor';
    world.group.add(this.group);
    const T = textures();
    this.mat = {
      grass: new THREE.MeshLambertMaterial({ map: T.grass }),
      bed: new THREE.MeshLambertMaterial({ map: Textures.trackbed(), side: THREE.DoubleSide }),
      wall: new THREE.MeshLambertMaterial({ map: Textures.concrete('#8c877d'), side: THREE.DoubleSide }),
      road: new THREE.MeshLambertMaterial({ map: T.road }),
      facades: T.facades.map((t) => new THREE.MeshLambertMaterial({ map: t })),
      roof: new THREE.MeshLambertMaterial({ color: 0x4a4744 }),
      fence: new THREE.MeshLambertMaterial({ color: 0x5f6a63 }),
      deck: new THREE.MeshLambertMaterial({ map: Textures.concrete('#a39d92'), side: THREE.DoubleSide }),
      strip: new THREE.MeshLambertMaterial({ map: textures().strip, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
      leaves: new THREE.MeshLambertMaterial({ color: 0x3f6b2c }),
      leaves2: new THREE.MeshLambertMaterial({ color: 0x55803a }),
      pole: new THREE.MeshLambertMaterial({ color: 0x3c3f44 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d0 }),
    };
  }

  runs() {
    const from = this.w.opts.fromS;
    return this.geom.outdoorRuns().map(([a, b]) => [Math.max(a, from), b]).filter(([a, b]) => b - a > 1);
  }

  build() {
    const runs = this.runs();
    // Surface sites above underground stations (e.g. the airport): modelled now, hidden until the
    // line offers a way to see them. Their ground level is given in the line file ("ground").
    this.sites = [];
    this.line.stations.forEach((st, i) => {
      const lm = st.landmark;
      if (!lm || st.mirrorOf != null || lm.ground == null || i < this.w.opts.firstStation || !LANDMARKS[lm.type] || this.geom.outdoorAt(this.geom.stationS[i])) return;
      const G = this.geom.point(this.geom.stationS[i]).y + lm.ground;
      const lat = (lm.side === 'left' ? -1 : 1) * (lm.offset ?? 0);
      const site = LANDMARKS[lm.type](this.group, landmarkFrame(this.geom, i, lat, lm.along ?? 0, G), this.line, this.geom, i);
      site.group.visible = false;
      this.sites.push(site);
    });
    if (!runs.length && !this.geom.portals.length) return this;
    for (const [a, b] of runs) this.buildGround(a, b);
    if (runs.length) {
      const G = this.geom.groundAt(runs[0][0] + 1);
      this.landmarks = [];
      this.line.stations.forEach((st, i) => {
        const lm = st.landmark;
        if (!lm || st.mirrorOf != null || lm.ground != null || i < this.w.opts.firstStation || !LANDMARKS[lm.type]) return;
        const lat = (lm.side === 'left' ? -1 : 1) * (lm.offset ?? 50);
        this.landmarks.push(LANDMARKS[lm.type](this.group, landmarkFrame(this.geom, i, lat, lm.along ?? 0, G), this.line));
      });
      this.city = new City(this, runs, this.landmarks);
    }
    for (const p of this.geom.portals) if (p.s >= this.w.opts.fromS) this.buildPortal(p);
    return this;
  }

  chunks(a, b) { const out = []; for (let s = a; s < b - 0.5; s += CHUNK) out.push([s, Math.min(b, s + CHUNK)]); return out; }

  /** Height of the track bed above street level at chainage s (negative in a cutting). */
  bedAbove(s) { return this.geom.point(s).y + FLOOR_Y - this.geom.groundAt(s); }
  /** Half width of the structure carrying the tracks (wider under side platforms). */
  deckHalf(s) {
    const g = this.geom, hwc = g.halfSpacingAt(s) + 2.4;
    const z = g.stationZoneAt(s);
    if (!z) return hwc;
    const st = this.line.stations[z.index];
    return st.platformType === 'island' ? hwc : Math.max(hwc, g.halfSpacingAt(s) + 1.45 + st.platformWidth + 0.3);
  }

  /**
   * Splits an open-air run into a "trench" part (cutting and walled embankment, where the line is
   * near street level: streets cannot cross) and a "viaduct" part (streets continue underneath).
   */
  segmentRun(a, b) {
    const parts = [];
    let cur = null;
    for (let s = Math.floor(a); s <= Math.ceil(b); s += 1) {
      const kind = this.bedAbove(Math.min(Math.max(s, a), b)) < VIADUCT_CLEAR ? 'trench' : 'viaduct';
      if (!cur || cur.kind !== kind) { if (cur) { cur.b = s; parts.push(cur); } cur = { kind, a: Math.max(a, s) }; }
    }
    if (cur) { cur.b = b; parts.push(cur); }
    return parts.filter((p) => p.b - p.a > 1);
  }

  buildGround(a, b) {
    const parts = this.segmentRun(a, b);
    this.parts = (this.parts || []).concat(parts);
    for (const p of parts) (p.kind === 'trench' ? this.buildTrench(p.a, p.b) : this.buildViaduct(p.a, p.b));
  }

  /** Ramp out of the tunnel: track bed between concrete retaining walls, planted strips at street level. */
  buildTrench(a, b) {
    const g = this.geom;
    const hwc = (s) => g.halfSpacingAt(s) + 2.4;
    const rel = (s, yAbs) => yAbs - g.point(s).y;
    const trees = [];
    for (const [s0, s1] of this.chunks(a, b)) {
      const o = this.w.origin(s0);
      this.add(new THREE.Mesh(sweep(g, s0, s1, 4, (s) => [[-hwc(s), FLOOR_Y], [hwc(s), FLOOR_Y]], { origin: o, uScale: 0.3, vScale: 0.3 }), this.mat.bed), o);
      for (const sd of [-1, 1]) {
        // Retaining wall from the lower to the upper level, topped by a 1.1 m parapet.
        const wall = sweep(g, s0, s1, 4, (s) => {
          const gy = rel(s, g.groundAt(s));
          const lo = Math.min(FLOOR_Y, gy), hi = Math.max(FLOOR_Y, gy) + 1.1;
          return [[sd * hwc(s), lo], [sd * hwc(s), hi], [sd * (hwc(s) + 0.35), hi], [sd * (hwc(s) + 0.35), gy]];
        }, { origin: o, uScale: 0.25, vScale: 0.25 });
        this.add(new THREE.Mesh(wall, this.mat.wall), o);
        // Planted strip with a footpath between the wall and the city blocks.
        const strip = sweep(g, s0, s1, 4, (s) => {
          const y = rel(s, g.groundAt(s)) + 0.02;
          return sd < 0 ? [[-(hwc(s) + 13), y], [-(hwc(s) + 0.35), y]] : [[hwc(s) + 0.35, y], [hwc(s) + 13, y]];
        }, { origin: o, uScale: 0.077, vScale: 0.25 });
        this.add(new THREE.Mesh(strip, this.mat.strip), o);
      }
      for (let s = Math.ceil(s0 / 12) * 12; s < s1; s += 12) for (const sd of [-1, 1]) trees.push([s, sd * (hwc(s) + 4)]);
    }
    this.stripTrees(trees);
  }

  /** Elevated section: box-girder deck with parapets, on piers down to the street. */
  buildViaduct(a, b) {
    const g = this.geom;
    const piers = [];
    for (const [s0, s1] of this.chunks(a, b)) {
      const o = this.w.origin(s0);
      this.add(new THREE.Mesh(sweep(g, s0, s1, 4, (s) => [[-this.deckHalf(s), FLOOR_Y], [this.deckHalf(s), FLOOR_Y]], { origin: o, uScale: 0.3, vScale: 0.3 }), this.mat.bed), o);
      const deck = sweep(g, s0, s1, 4, (s) => {
        const h = this.deckHalf(s);
        return [[-h + 0.3, FLOOR_Y + 1.1], [-h, FLOOR_Y + 1.1], [-h, FLOOR_Y - 1.5], [-h + 1.2, FLOOR_Y - 1.9], [h - 1.2, FLOOR_Y - 1.9], [h, FLOOR_Y - 1.5], [h, FLOOR_Y + 1.1], [h - 0.3, FLOOR_Y + 1.1]];
      }, { origin: o, uScale: 0.25, vScale: 0.25 });
      this.add(new THREE.Mesh(deck, this.mat.deck), o);
      for (const sd of [-1, 1]) {
        const inner = sweep(g, s0, s1, 4, (s) => { const h = this.deckHalf(s) * sd; return [[h - sd * 0.3, FLOOR_Y + 1.1], [h - sd * 0.3, FLOOR_Y]]; }, { origin: o });
        this.add(new THREE.Mesh(inner, this.mat.deck), o);
      }
    }
    for (let s = a + 14; s < b - 4; s += 26) {
      const under = this.bedAbove(s) - 1.45; // underside of the deck above street level
      if (under < 2) continue;
      piers.push([s, under, this.deckHalf(s)]);
    }
    this.piers(piers);
    // Abutment where the walled embankment meets the viaduct.
    for (const s of [a, b]) {
      if (s <= this.w.opts.fromS + 1 || s >= this.geom.length - 2) continue;
      const h = Math.max(0.5, this.bedAbove(s));
      const p = g.point(s, 0, FLOOR_Y - h / 2 + 0.55);
      const ab = new THREE.Mesh(new THREE.BoxGeometry(this.deckHalf(s) * 2 + 0.8, h + 1.1, 1.6), this.mat.wall);
      ab.position.set(p.x, p.y, p.z); ab.rotation.y = -g.heading(s);
      this.group.add(ab);
    }
  }

  piers(list) {
    if (!list.length) return;
    const g = this.geom;
    const col = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat.deck, list.length * 2);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat.deck, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let i = 0;
    list.forEach(([s, under, half], k) => {
      q.setFromAxisAngle(up, -g.heading(s));
      const G = g.groundAt(s) - g.point(s).y;
      for (const sd of [-1, 1]) {
        const c = g.point(s, sd * half * 0.55, G + (under - 1.2) / 2);
        m.compose(p.set(c.x, c.y, c.z), q, sc.set(1.3, under - 1.2, 1.3)); col.setMatrixAt(i++, m);
      }
      const h = g.point(s, 0, G + under - 0.6);
      m.compose(p.set(h.x, h.y, h.z), q, sc.set(half * 2 - 0.4, 1.2, 1.8)); head.setMatrixAt(k, m);
    });
    col.computeBoundingSphere(); head.computeBoundingSphere();
    this.group.add(col, head);
  }

  stripTrees(list) {
    if (!list.length) return;
    const g = this.geom;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 3, 5, 1, true), this.mat.trunk, list.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.2, 0), this.mat.leaves, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([s, lat], i) => {
      const p = g.point(s, lat, g.groundAt(s) - g.point(s).y);
      m.makeTranslation(p.x, p.y + 1.5, p.z); trunk.setMatrixAt(i, m);
      m.makeTranslation(p.x, p.y + 4.2, p.z); crown.setMatrixAt(i, m);
    });
    trunk.computeBoundingSphere(); crown.computeBoundingSphere();
    this.group.add(trunk, crown);
  }

  buildPortal(p) {
    const g = this.geom, s = p.s;
    const hw = g.tunnelHalfWidthAt(s), base = g.point(s).y;
    const top = g.groundAt(s) - base + 1.2;
    const W = hw + 9;
    const shape = new THREE.Shape([new THREE.Vector2(-W, FLOOR_Y - 0.2), new THREE.Vector2(W, FLOOR_Y - 0.2), new THREE.Vector2(W, top), new THREE.Vector2(-W, top)]);
    shape.holes.push(new THREE.Path(tunnelProfile(hw, this.line.tunnelProfile).map(([x, y]) => new THREE.Vector2(x, Math.max(y, FLOOR_Y))).reverse()));
    const grp = new THREE.Group();
    const q = g.point(s);
    grp.position.set(q.x, q.y, q.z);
    grp.rotation.y = Math.PI - g.heading(s);
    grp.add(new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), this.mat.wall));
    const cap = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.4, 0.4, 0.9), this.mat.wall); cap.position.set(0, top + 0.2, 0); grp.add(cap);
    // Line-coloured band and wing walls.
    const band = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 1.2, 0.35), new THREE.MeshLambertMaterial({ color: this.line.color, side: THREE.DoubleSide }));
    band.position.set(0, top - 0.6, p.type === 'exit' ? 0.03 : -0.03); grp.add(band);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.6, top - FLOOR_Y, 18), this.mat.wall);
      wing.position.set(sx * (hw + 0.6), (top + FLOOR_Y) / 2, p.type === 'exit' ? 9 : -9); grp.add(wing);
    }
    this.group.add(grp);
  }

  /** Animation of traffic and people, only while the viewer is near. */
  update(dt, t, clock, viewPos) {
    if (!this.city) return;
    if (Math.hypot(viewPos.x - this.city.center.x, viewPos.z - this.city.center.y) > 3500) return;
    this.city.updateCars(dt);
    for (const l of this.landmarks) {
      const near = Math.hypot(viewPos.x - l.x, viewPos.z - l.z) < 450;
      l.people.group.visible = near;
      if (near) l.update(dt, t, clock);
    }
  }

  add(mesh, o) { mesh.position.copy(o); this.group.add(mesh); }
}
