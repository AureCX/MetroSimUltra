// Open-air sections: ground and track bed (cuttings / low embankments), tunnel portal
// headwalls, fences, a road with street lights, buildings and trees. Everything is generated
// from the alignment, so any line with "portal" segments gets a surface section.
import * as THREE from 'three';
import { sweep, tunnelProfile, FLOOR_Y } from './Sweep.js';
import { Textures } from './Textures.js';
import { seededRandom, hashString } from '../core/util.js';
import { City } from './City.js';
import { buildCityHall, buildUniversity, landmarkFrame } from './Landmarks.js';

const LANDMARKS = { cityHall: buildCityHall, university: buildUniversity };

const FAR = 52;        // half width of the rail-corridor verge (the city ground takes over beyond)
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
  texCache = { grass, road, facades };
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
    if (!runs.length && !this.geom.portals.length) return this;
    for (const [a, b] of runs) this.buildGround(a, b);
    this.buildCover();
    if (runs.length) {
      const G = this.geom.groundAt(runs[0][0] + 1);
      this.landmarks = [];
      this.line.stations.forEach((st, i) => {
        const lm = st.landmark;
        if (!lm || i < this.w.opts.firstStation || !LANDMARKS[lm.type]) return;
        const lat = (lm.side === 'left' ? -1 : 1) * (lm.offset ?? 50);
        this.landmarks.push(LANDMARKS[lm.type](this.group, landmarkFrame(this.geom, i, lat, lm.along ?? 0, G), this.line));
      });
      this.city = new City(this, runs, this.landmarks);
    }
    for (const p of this.geom.portals) if (p.s >= this.w.opts.fromS) this.buildPortal(p);
    return this;
  }

  chunks(a, b) { const out = []; for (let s = a; s < b - 0.5; s += CHUNK) out.push([s, Math.min(b, s + CHUNK)]); return out; }

  /** Track bed, cutting walls / embankment sides and the surrounding ground. */
  buildGround(a, b) {
    const g = this.geom;
    const hwc = (s) => g.halfSpacingAt(s) + 2.4;
    const bedY = (s) => g.point(s).y + FLOOR_Y; // absolute
    // Heights below are relative to the rail top at s (the sweep adds the track height).
    const rel = (s, yAbs) => yAbs - g.point(s).y;
    const side = (s) => { const d = bedY(s) - g.groundAt(s); return d < -0.05 ? 0.02 : 1.6 * Math.max(0, d) + 0.3; };
    for (const [s0, s1] of this.chunks(a, b)) {
      const o = this.w.origin(s0);
      const bed = sweep(g, s0, s1, 4, (s) => [[-hwc(s), FLOOR_Y], [hwc(s), FLOOR_Y]], { origin: o, uScale: 0.3, vScale: 0.3 });
      this.add(new THREE.Mesh(bed, this.mat.bed), o);
      for (const sd of [-1, 1]) {
        const walls = sweep(g, s0, s1, 4, (s) => (sd < 0
          ? [[-hwc(s) - side(s), rel(s, g.groundAt(s))], [-hwc(s), FLOOR_Y]]
          : [[hwc(s), FLOOR_Y], [hwc(s) + side(s), rel(s, g.groundAt(s))]]), { origin: o, uScale: 0.25, vScale: 0.25 });
        this.add(new THREE.Mesh(walls, this.mat.wall), o);
        const ground = sweep(g, s0, s1, 4, (s) => (sd < 0
          ? [[-FAR, rel(s, g.groundAt(s))], [-hwc(s) - side(s), rel(s, g.groundAt(s))]]
          : [[hwc(s) + side(s), rel(s, g.groundAt(s))], [FAR, rel(s, g.groundAt(s))]]), { origin: o, uScale: 0.08, vScale: 0.08 });
        this.add(new THREE.Mesh(ground, this.mat.grass), o);
      }
      // Fences along the line (not at platforms).
      this.fence(s0, s1, hwc, side);
    }
  }

  /** Flat ground over the tunnel near portals so the landscape continues behind the headwall. */
  buildCover() {
    const g = this.geom, from = this.w.opts.fromS;
    let a = null;
    for (let i = Math.max(0, Math.floor(from)); i <= g.N; i++) {
      const cover = i < g.N && !g.outdoor[i] && !Number.isNaN(g.ground[i]);
      if (cover && a == null) a = i;
      if (!cover && a != null) {
        for (const [s0, s1] of this.chunks(a, i)) {
          const o = this.w.origin(s0);
          const m = sweep(g, s0, s1, 5, (s) => { const y = g.groundAt(s) - g.point(s).y; return [[-FAR, y], [FAR, y]]; }, { origin: o, uScale: 0.08, vScale: 0.08 });
          this.add(new THREE.Mesh(m, this.mat.grass), o);
        }
        a = null;
      }
    }
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

  fence(s0, s1, hwc, side) {
    const g = this.geom, posts = [];
    for (let s = Math.ceil(s0 / 3) * 3; s < s1; s += 3) {
      if (g.stationZoneAt(s)) continue;
      for (const sd of [-1, 1]) {
        const lat = sd * (hwc(s) + side(s) + 0.6);
        const p = g.point(s, lat, g.groundAt(s) - g.point(s).y + 0.7);
        posts.push(p);
      }
    }
    if (!posts.length) return;
    const geo = new THREE.BoxGeometry(0.06, 1.4, 0.06);
    const im = new THREE.InstancedMesh(geo, this.mat.fence, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m); });
    im.computeBoundingSphere();
    this.group.add(im);
    const o = this.w.origin(s0);
    for (const sd of [-1, 1]) for (const h of [0.45, 1.3]) {
      const rail = sweep(g, s0, s1, 4, (s) => {
        const lat = sd * (hwc(s) + side(s) + 0.6), y = g.groundAt(s) - g.point(s).y + h;
        return g.stationZoneAt(s) ? [[lat, y - 5], [lat, y - 5.01]] : [[lat, y], [lat, y + 0.05]];
      }, { origin: o });
      this.add(new THREE.Mesh(rail, this.mat.fence), o);
    }
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
