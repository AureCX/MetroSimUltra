// Hand-composed landmark buildings placed next to stations:
//  - Hôtel de Ville (town hall) on a plaza with a fountain, plus the Centre Administratif tower,
//    above Mairie de Bellevue;
//  - the Université Ouest campus (main hall with dome and portico, library, lecture hall,
//    clock tower, quad with paths and a statue) next to Université Ouest.
// Animated people stroll around both.
import * as THREE from 'three';
import { cityTextures, boxGeo } from './City.js';
import { Person } from './Passengers.js';
import { Textures } from './Textures.js';
import { seededRandom } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merges the static meshes that are direct children of `group` into one mesh per material. */
function mergeStatic(group, keep) {
  const buckets = new Map();
  for (const o of [...group.children]) {
    if (!o.isMesh || keep.has(o) || o.isInstancedMesh) continue;
    o.updateMatrix();
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrix);
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const key = `${o.material.uuid}|${attrs}`;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
    buckets.get(key).geos.push(geo);
    group.remove(o);
  }
  for (const { mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos);
    if (merged) group.add(new THREE.Mesh(merged, mat));
    geos.forEach((g) => g.dispose());
  }
}

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
let M;
function mats() {
  if (M) return M;
  const ct = cityTextures();
  const r = seededRandom(77);
  const paving = canvas(256, 256, (g) => {
    g.fillStyle = '#cbc3b3'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = `hsl(36, 14%, ${66 + r() * 10}%)`; g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30); }
  });
  const stone = canvas(256, 256, (g) => {
    g.fillStyle = '#e7dcc5'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(120,100,70,0.25)'; g.lineWidth = 2;
    for (let y = 0; y < 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let x = (y / 32) % 2 ? 0 : 32; x < 256; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
  });
  const slate = canvas(128, 128, (g) => {
    g.fillStyle = '#4d5866'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; for (let y = 0; y < 128; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  });
  const water = canvas(128, 128, (g) => {
    g.fillStyle = '#4b88a8'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${0.25 * r()})`; g.fillRect(r() * 128, r() * 128, 6 + r() * 10, 1.5); }
  });
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  M = {
    classic: lam({ map: ct.facades[1], vertexColors: true }),
    brick: lam({ map: ct.facades[2], vertexColors: true }),
    white: lam({ map: ct.facades[4], vertexColors: true }),
    curtain: new THREE.MeshStandardMaterial({ map: ct.curtain, vertexColors: true, metalness: 0.55, roughness: 0.2 }),
    stone: lam({ map: stone }), slate: lam({ map: slate }), paving: lam({ map: paving, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    column: lam({ color: 0xf1ead9 }), gold: new THREE.MeshStandardMaterial({ color: 0xd8b45a, metalness: 0.8, roughness: 0.3 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x6b5a3a, metalness: 0.7, roughness: 0.5 }),
    copper: lam({ color: 0x5f9d8a }), dark: lam({ color: 0x24262a }),
    lawn: lam({ color: 0x5f8f3b, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    path: lam({ color: 0xd9cfb7, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }),
    water: new THREE.MeshLambertMaterial({ map: water, transparent: true, opacity: 0.9, emissive: 0x0a2030 }),
    leaves: lam({ color: 0x3f6b2c }), trunk: lam({ color: 0x5a4030 }),
    flowers: [0xc23b5a, 0xe9c441, 0xf2f2f2, 0x7a4fb3].map((c) => lam({ color: c })),
    glassFrame: lam({ color: 0x3a3f45 }),
  };
  return M;
}

function sign(text, { w = 1024, h = 128, bg = '#1d2a3a', fg = '#e9cf8a', font = 'bold 72px Georgia, serif' } = {}) {
  return new THREE.MeshBasicMaterial({ map: Textures.label(text, { w, h, bg, fg, font, radius: 4 }) });
}

/** Helper that builds into a local frame: origin at the front-centre at ground level, +z towards the railway. */
class Kit {
  constructor(group) { this.g = group; }
  box(w, h, d, mat, x, y, z, parent = this.g) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
  facade(w, h, d, mat, x, y, z, tile = 4) { const m = new THREE.Mesh(boxGeo(w, h, d, 0, 0, 0, 0, tile, 0.5), mat); m.position.set(x, y, z); this.g.add(m); return m; }
  cyl(rt, rb, h, mat, x, y, z, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); this.g.add(m); return m; }
  plane(w, h, mat, x, y, z, ry = 0, rx = 0) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); this.g.add(m); return m; }
  ground(w, d, mat, x, z, y = 0.03) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); this.g.add(m); if (mat.map) { const u = m.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * w / 8, u.getY(i) * d / 8); } return m; }
  prism(points, depth, mat, x, y, z, alongX = true) {
    const sh = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    if (alongX) geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.g.add(m); return m;
  }
  columns(n, x0, x1, z, h, r, mat, y = 0) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (i * (x1 - x0)) / (n - 1);
      this.cyl(r, r * 1.08, h, mat, x, y + h / 2, z, 14);
      this.box(r * 2.6, 0.35, r * 2.6, mat, x, y + h + 0.17, z);
      this.box(r * 2.6, 0.35, r * 2.6, mat, x, y + 0.17, z);
    }
  }
  steps(w, n, x, z, y0 = 0, stepH = 0.2, stepD = 0.45, mat) { for (let i = 0; i < n; i++) this.box(w, stepH, stepD * (n - i), mat, x, y0 + stepH * (i + 0.5), z + (stepD * i) / 2); }
  tree(x, z, k = 1) { const m = mats(); this.cyl(0.18 * k, 0.25 * k, 3 * k, m.trunk, x, 1.5 * k, z, 6); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 * k, 1), m.leaves); c.position.set(x, 4.4 * k, z); this.g.add(c); }
  lamp(x, z) { const m = mats(); this.cyl(0.07, 0.1, 4, m.dark, x, 2, z, 6); for (const dx of [-0.35, 0.35]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1c8 })); b.position.set(x + dx, 4.1, z); this.g.add(b); } this.box(0.8, 0.05, 0.05, m.dark, x, 4.0, z); }
  bench(x, z, ry = 0) { const m = mats(); const b = this.box(1.8, 0.08, 0.5, m.trunk, x, 0.45, z); b.rotation.y = ry; const back = this.box(1.8, 0.45, 0.06, m.trunk, x, 0.72, z); back.rotation.y = ry; back.translateZ(-0.24); }
}

/** Clock face that shows the game time. */
class ClockFace {
  constructor(size = 256) { this.c = document.createElement('canvas'); this.c.width = this.c.height = size; this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.last = -1; this.mat = new THREE.MeshBasicMaterial({ map: this.tex }); }
  draw(clock) {
    const s = Math.floor(clock); if (s === this.last) return; this.last = s;
    const g = this.c.getContext('2d'), R = this.c.width / 2;
    g.fillStyle = '#f5efe0'; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1c1c1c'; g.lineWidth = R * 0.06; g.stroke();
    g.fillStyle = '#1c1c1c';
    for (let h = 0; h < 12; h++) { const a = (h / 12) * Math.PI * 2; g.save(); g.translate(R, R); g.rotate(a); g.fillRect(-R * 0.025, -R * 0.88, R * 0.05, R * 0.14); g.restore(); }
    const t = ((clock % 43200) + 43200) % 43200;
    const hand = (f, len, w) => { const a = f * Math.PI * 2 - Math.PI / 2; g.strokeStyle = '#1c1c1c'; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(R, R); g.lineTo(R + Math.cos(a) * len, R + Math.sin(a) * len); g.stroke(); };
    hand(t / 43200, R * 0.5, R * 0.08); hand((t % 3600) / 3600, R * 0.75, R * 0.05);
    this.tex.needsUpdate = true;
  }
}

/** People strolling along closed loops (in the landmark's local frame). */
class Strollers {
  constructor(group, loops, count, seed) {
    this.list = [];
    this.group = new THREE.Group(); group.add(this.group); group = this.group;
    const r = seededRandom(seed);
    for (let i = 0; i < count; i++) {
      const loop = loops[i % loops.length];
      const p = new Person(r);
      p.loop = loop; p.u = r(); p.dir = r() < 0.5 ? 1 : -1; p.speed = 0.9 + r() * 0.5;
      p.pause = r() < 0.25 ? 3 + r() * 8 : 0;
      group.add(p.g); this.list.push(p);
    }
    this.t = 0;
  }
  at(loop, u) {
    const n = loop.length, f = ((u % 1) + 1) % 1 * n, i = Math.floor(f), k = f - i;
    const a = loop[i], b = loop[(i + 1) % n];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  perim(loop) { let L = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
  update(dt) {
    this.t += dt;
    for (const p of this.list) {
      let v = p.speed;
      if (p.pause > 0) { p.pause -= dt; v = 0; if (p.pause <= 0 && Math.random() < 0.3) p.pause = -20; }
      else if (p.pause < -1) p.pause += dt; else if (Math.random() < dt * 0.02) p.pause = 2 + Math.random() * 6;
      p.L ??= this.perim(p.loop);
      p.u += (v * p.dir * dt) / p.L;
      const [x, z] = this.at(p.loop, p.u), [x2, z2] = this.at(p.loop, p.u + 0.002 * p.dir);
      p.g.position.set(x, 0, z);
      if (v > 0) p.g.rotation.y = Math.atan2(x2 - x, z2 - z);
      p.va = v; p.vd = 0;
      p.animate(dt, this.t);
    }
  }
}

export function landmarkFrame(geom, stationIndex, lateral, along, G) {
  const s = geom.stationS[stationIndex] + along;
  const p = geom.point(s, lateral, 0), q = geom.point(s, 0, 0);
  return { x: p.x, z: p.z, y: G, yaw: Math.atan2(q.x - p.x, q.z - p.z) };
}

// ------------------------------------------------------------------------------------------------
export function buildCityHall(parent, f, line) {
  const m = mats(), grp = new THREE.Group(); grp.position.set(f.x, f.y, f.z); grp.rotation.y = f.yaw; parent.add(grp);
  const k = new Kit(grp);
  // Plaza in front (towards the railway), with fountain, flower beds, lamps, benches, flags.
  k.ground(96, 52, m.paving, 0, 26);
  const bz = -16; // building centre
  k.box(80, 1.4, 34, m.stone, 0, 0.7, bz);
  k.facade(72, 17, 26, m.classic, 0, 1.4 + 8.5, bz, 4.5);
  k.prism([[-13, 0], [13, 0], [9, 5.5], [-9, 5.5]], 72, m.slate, 0, 18.4, bz);
  for (const sx of [-1, 1]) { // corner pavilions
    k.facade(14, 20, 30, m.classic, sx * 31, 1.4 + 10, bz, 4.5);
    k.prism([[-15, 0], [15, 0], [8, 7], [-8, 7]], 14, m.slate, sx * 31, 21.4, bz);
  }
  // Central pavilion with portico, pediment and clock tower.
  k.facade(24, 22, 30, m.classic, 0, 1.4 + 11, bz + 2, 4.5);
  k.steps(26, 6, 0, 3.6, 0, 0.23, 0.5, m.stone);
  k.columns(8, -10, 10, 3.2, 11, 0.55, m.column, 1.4);
  k.box(24, 1.6, 4, m.stone, 0, 13.6, 3.0);
  k.prism([[-12.5, 0], [12.5, 0], [0, 4.6]], 1.2, m.stone, 0, 14.4, 3.0, false);
  k.plane(20, 1.15, sign('HÔTEL DE VILLE', { bg: '#e7dcc5', fg: '#3a2f1e', font: 'bold 80px Georgia, serif' }), 0, 13.6, 5.02);
  k.plane(30, 1.8, sign('MAIRIE DE BELLEVUE'), 0, 17.6, bz + 17.05);
  const tower = { y: 23.4 };
  k.facade(10, 13, 10, m.classic, 0, tower.y + 6.5, bz + 2, 4.5);
  const clock = new ClockFace();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, d = 5.03;
    k.plane(6, 6, clock.mat, Math.sin(a) * d, tower.y + 8, bz + 2 + Math.cos(a) * d, a);
  }
  k.cyl(4.6, 5.2, 2, m.stone, 0, tower.y + 14, bz + 2, 20);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(4.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.copper); dome.position.set(0, tower.y + 15, bz + 2); grp.add(dome);
  k.cyl(0.9, 1.1, 2.4, m.copper, 0, tower.y + 21, bz + 2, 10);
  k.cyl(0.02, 0.6, 3.5, m.gold, 0, tower.y + 24, bz + 2, 8);
  // Flags.
  const flag = new THREE.MeshLambertMaterial({ map: canvas(96, 64, (g) => { ['#1f3c88', '#f2f2f2', '#c62828'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32, 0, 32, 64); }); }), side: THREE.DoubleSide });
  const flags = [];
  for (const sx of [-1, 1]) { k.cyl(0.07, 0.09, 12, m.dark, sx * 14, 6, 44, 8); flags.push(k.plane(3, 2, flag, sx * 14 + 1.5, 11, 44)); }
  // Fountain.
  k.cyl(7, 7.3, 0.8, m.stone, 0, 0.4, 24, 32);
  const w = k.cyl(6.6, 6.6, 0.1, m.water, 0, 0.75, 24, 32);
  k.cyl(1.4, 1.8, 2.2, m.stone, 0, 1.1, 24, 16); k.cyl(2.6, 0.6, 0.4, m.stone, 0, 2.3, 24, 20);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.55, depthWrite: false }));
  jet.position.set(0, 4.0, 24); grp.add(jet);
  for (const [x, z] of [[-30, 14], [30, 14], [-30, 38], [30, 38]]) {
    k.box(14, 0.5, 6, m.stone, x, 0.25, z);
    for (let i = 0; i < 18; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), m.flowers[i % 4]); b.position.set(x + (i % 6 - 2.5) * 2.1, 0.7, z + (Math.floor(i / 6) - 1) * 1.7); grp.add(b); }
  }
  for (const x of [-42, -20, 20, 42]) k.lamp(x, 48);
  for (const x of [-12, 12]) for (const z of [16, 32]) k.bench(x, z);
  for (const x of [-46, -38, 38, 46]) k.tree(x, 2, 1.1);
  // Metro entrance (with line badge) at the plaza corner.
  const ex = -40, ez = 46;
  k.box(4, 0.02, 7, m.dark, ex, 0.04, ez);
  for (const sx of [-2, 2]) k.box(0.08, 1, 7, m.gold, ex + sx, 0.5, ez);
  k.box(4, 1, 0.08, m.gold, ex, 0.5, ez - 3.5);
  k.cyl(0.12, 0.14, 4.5, m.dark, ex + 3, 2.25, ez + 3.5, 8);
  const mb = new THREE.MeshBasicMaterial({ map: Textures.label('M', { w: 128, h: 128, bg: '#ffffff', fg: '#1f3c88', font: 'bold 96px Arial', border: '#1f3c88', radius: 64 }), transparent: true });
  k.plane(1.2, 1.2, mb, ex + 3, 4.6, ez + 3.56); k.plane(1.2, 1.2, mb, ex + 3, 4.6, ez + 3.44, Math.PI);
  const lb = new THREE.MeshBasicMaterial({ map: Textures.label(line.number, { w: 128, h: 128, bg: line.color, fg: line.textColor, font: 'bold 80px Arial', radius: 64 }), transparent: true });
  k.plane(0.8, 0.8, lb, ex + 3, 3.6, ez + 3.56);
  // Centre administratif: glass office tower beside the town hall.
  const tx = 72, tz = -14;
  k.box(34, 1, 30, m.stone, tx, 0.5, tz);
  k.facade(30, 92, 26, m.curtain, tx, 1 + 46, tz, 4);
  k.facade(24, 6, 20, m.curtain, tx, 1 + 95, tz, 4);
  k.box(31, 0.8, 27, m.glassFrame, tx, 93.4, tz);
  for (const y of [24, 48, 72]) k.box(30.4, 0.5, 26.4, m.glassFrame, tx, y, tz);
  k.plane(22, 2.2, sign('CENTRE ADMINISTRATIF', { bg: '#20303f', fg: '#ffffff', font: 'bold 70px Arial' }), tx, 88, tz + 13.06);
  k.facade(30, 7, 16, m.curtain, tx, 4.5, tz + 20, 4); // lobby
  k.plane(14, 1.2, sign('VILLE DE BELLEVUE', { bg: '#20303f', fg: '#e9cf8a', font: 'bold 64px Arial' }), tx, 7.4, tz + 28.06);
  // People on the plaza.
  const loops = [
    [[-12, 16], [12, 16], [12, 32], [-12, 32]],
    [[-40, 50], [40, 50], [40, 8], [-40, 8]],
    [[-40, 46], [-20, 30], [0, 8], [20, 30], [60, 18], [58, 40]],
  ];
  const people = new Strollers(grp, loops, 12, 99);
  mergeStatic(grp, new Set([w, jet, ...flags]));
  return {
    x: f.x, z: f.z, radius: 120, group: grp,
    people,
    update(dt, t, clockT) {
      clock.draw(clockT);
      w.material.map.offset.x += dt * 0.03;
      jet.scale.y = 1 + Math.sin(t * 6) * 0.05;
      flags.forEach((fl, i) => { fl.rotation.y = Math.sin(t * 2 + i) * 0.18; });
      people.update(dt);
    },
  };
}

// ------------------------------------------------------------------------------------------------
export function buildUniversity(parent, f) {
  const m = mats(), grp = new THREE.Group(); grp.position.set(f.x, f.y, f.z); grp.rotation.y = f.yaw; parent.add(grp);
  const k = new Kit(grp);
  // Campus front (z = 0) faces the railway; buildings around a quad behind it.
  k.ground(150, 150, m.paving, 0, -70);
  k.ground(96, 82, m.lawn, 0, -52, 0.05);
  for (const [w, d, x, z] of [[4, 82, 0, -52], [96, 4, 0, -52], [3, 70, -30, -52], [3, 70, 30, -52]]) k.ground(w, d, m.path, x, z, 0.07);
  // Gate with name.
  for (const sx of [-1, 1]) k.box(2, 7, 2, m.stone, sx * 9, 3.5, 2);
  k.box(20, 1.6, 2.2, m.stone, 0, 7.6, 2);
  k.plane(17, 1.2, sign('UNIVERSITÉ OUEST', { bg: '#e7dcc5', fg: '#2b2418', font: 'bold 84px Georgia, serif' }), 0, 7.6, 3.12);
  for (const sx of [-1, 1]) for (let x = 11; x < 74; x += 2.5) k.box(0.08, 1.3, 0.08, m.dark, sx * x, 0.65, 2);
  for (const sx of [-1, 1]) k.box(63, 0.06, 0.06, m.dark, sx * 42.5, 1.25, 2);
  // Main hall at the back of the quad: portico, pediment, dome.
  const mz = -108;
  k.box(104, 1.2, 28, m.stone, 0, 0.6, mz);
  k.facade(100, 15, 24, m.classic, 0, 1.2 + 7.5, mz, 4.5);
  k.box(102, 1.2, 26, m.stone, 0, 16.8, mz);
  k.steps(34, 6, 0, mz + 16, 0, 0.22, 0.55, m.stone);
  k.columns(10, -15, 15, mz + 14.5, 12.5, 0.7, m.column, 1.2);
  k.box(34, 1.8, 5, m.stone, 0, 14.7, mz + 14.3);
  k.prism([[-17.5, 0], [17.5, 0], [0, 6]], 5, m.stone, 0, 15.6, mz + 14.3, false);
  k.plane(30, 1.2, sign('FACULTAS · SCIENTIA · LIBERTAS', { bg: '#e7dcc5', fg: '#3a2f1e', font: 'bold 64px Georgia, serif' }), 0, 14.7, mz + 16.82);
  k.cyl(8, 8, 5, m.stone, 0, 19.9, mz, 28);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), m.copper); dome.position.set(0, 22.4, mz); grp.add(dome);
  k.cyl(1.2, 1.5, 3, m.stone, 0, 32, mz, 12); k.cyl(0.05, 0.9, 2.5, m.gold, 0, 34.7, mz, 8);
  // Library (modern glass) on the right, lecture hall (brick) on the left.
  k.facade(28, 18, 64, m.curtain, 60, 9, -52, 4);
  k.box(30, 1, 66, m.glassFrame, 60, 18.4, -52);
  k.plane(20, 1.8, sign('BIBLIOTHÈQUE', { bg: '#20303f', fg: '#ffffff', font: 'bold 70px Arial' }), 60 - 14.06, 15, -52, -Math.PI / 2);
  k.facade(24, 14, 68, m.brick, -60, 7, -52, 4);
  k.prism([[-12.5, 0], [12.5, 0], [0, 5]], 68, m.slate, -60, 14, -52, false);
  k.plane(18, 1.6, sign('AMPHITHÉÂTRES', { bg: '#5a1f18', fg: '#f3e1b5', font: 'bold 66px Georgia, serif' }), -60 + 12.06, 11, -52, Math.PI / 2);
  // Clock tower.
  const ctx = -60, ctz = -98;
  k.facade(8, 36, 8, m.brick, ctx, 18, ctz, 4);
  const clock = new ClockFace();
  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; k.plane(5, 5, clock.mat, ctx + Math.sin(a) * 4.03, 30, ctz + Math.cos(a) * 4.03, a); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 8, 4), m.slate); roof.rotation.y = Math.PI / 4; roof.position.set(ctx, 40, ctz); grp.add(roof);
  // Statue on a pedestal in the middle of the quad, trees and benches.
  k.box(3, 2.4, 3, m.stone, 0, 1.2, -52);
  const statue = new Person(seededRandom(5)); statue.g.position.set(0, 2.4, -52); statue.g.scale.setScalar(1.5);
  statue.g.traverse((o) => { if (o.isMesh) o.material = m.bronze; }); grp.add(statue.g);
  for (let x = -44; x <= 44; x += 11) { k.tree(x, -12, 1.05); k.tree(x, -92, 1.05); }
  for (const z of [-30, -74]) for (const x of [-14, 14]) k.bench(x, z);
  for (const [x, z] of [[-48, -10], [48, -10], [-48, -94], [48, -94], [0, -6]]) k.lamp(x, z);
  // Students.
  const loops = [
    [[-2, -8], [-2, -92], [2, -92], [2, -8]],
    [[-46, -50], [46, -50], [46, -54], [-46, -54]],
    [[-30, -14], [30, -14], [30, -90], [-30, -90]],
    [[-46, -12], [-46, -92], [46, -92], [46, -12]],
    [[0, -4], [-20, -90], [0, -93], [20, -90]],
  ];
  const people = new Strollers(grp, loops, 18, 314);
  mergeStatic(grp, new Set());
  return {
    x: f.x - Math.sin(f.yaw) * 60, z: f.z - Math.cos(f.yaw) * 60, radius: 150, group: grp,
    people,
    update(dt, t, clockT) { clock.draw(clockT); people.update(dt); },
  };
}
