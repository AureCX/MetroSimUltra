// Gare Centrale — Grandes Lignes. The main-line station of Grandville, built above the metro station: a monumental
// limestone façade with a giant glazed arch and clock, a great hall under a coffered vault with a skylight, marble
// floors, colonnades, chandeliers, a split-flap departure board, shops, cafés, a brasserie, ticket offices, a first-
// class lounge, indoor trees and a fountain; a glass-and-steel train shed over six island platforms (twelve
// tracks) reached by a footbridge; a landscaped forecourt with fountains, gardens, taxis and buses. Travellers walk,
// queue, sit and board; other TGVs arrive and depart according to the timetable. Original design.
// World frame: origin at the centre of the shed (Gare Centrale, above the metro), +x east along the tracks, +z south.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { stationTextures, signTexture } from './StationTextures.js';
import { TgvTimetable, fmt } from './TgvTimetable.js';
import { PLATFORM_Y } from '../world/StationBuilder.js';

export const GC = { x: 3570, z: 220 };
export const SLOT = 22, SLOTS = 6;
export const slotZ = (k) => (k - 2.5) * SLOT;
// Platform top = the standard platform height used by trains (door sills) and boarding passengers.
const PLAT_Y = PLATFORM_Y + 0.45, HALF_P = 135;
const SHED = { x0: -175, x1: 175, hw: 78, rise: 40, spring: 8 };
const HALL = { x0: -115, x1: 115, z0: 84, z1: 152, h: 21, vault: 22 };
let envCache = null;
// Ground levels around the station (world): the building footprint at rail level, the forecourt 1.6 m lower
// (reached by the grand stairs). Used by the country terrain so the landscape meets the architecture.
export const GARE_PADS = [
  { x0: GC.x - 270, x1: GC.x + 270, z0: GC.z - 100, z1: GC.z + HALL.z1 + 4, y: 6 - 0.62, blend: 30 },   // under the track bed
  { x0: GC.x - 230, x1: GC.x + 230, z0: GC.z + HALL.z1 + 6, z1: GC.z + HALL.z1 + 210, y: 6 + PLATFORM_Y - 1.55 - 0.8, blend: 60 },
];

export function buildGrandeGare(parent, opts) {
  const { line, geom, index = 0, slot = 2, renderer, terrain } = opts;
  const c0 = geom.point(geom.stationS[index]);
  const y0 = c0.y;                                       // rail level at Gare Centrale
  const root = new THREE.Group(); root.name = 'gare-centrale';
  root.position.set(GC.x, y0, GC.z);
  parent.add(root);
  const T = stationTextures();
  // Reflections: a small pre-filtered room environment for marble, glass and metal.
  if (!envCache && renderer) { const pm = new THREE.PMREMGenerator(renderer); envCache = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  const env = envCache;
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, envMapIntensity: 0.9, ...o });
  const M = {
    stone: std({ map: T.stone, roughness: 0.82, metalness: 0 }),
    stoneDark: std({ color: 0xcfc3aa, roughness: 0.85 }),
    marble: std({ map: T.marble, color: 0xd9d3c8, roughness: 0.12, metalness: 0.05, envMapIntensity: 1.1 }),
    rose: std({ map: T.rose, roughness: 0.1, metalness: 0.05, envMapIntensity: 1.3 }),
    coffer: std({ map: T.coffer, roughness: 0.7, side: THREE.DoubleSide }),
    // Glazing: light, slightly blue, no black reflections at grazing angles (the reflection probe is an interior).
    glass: new THREE.MeshStandardMaterial({ color: 0xdcebf3, emissive: 0x1a2a33, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    glassTint: new THREE.MeshStandardMaterial({ color: 0xa9c6d8, emissive: 0x18242c, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
    steel: std({ color: 0x33404b, metalness: 0.7, roughness: 0.38 }),
    steelLight: std({ color: 0x8e9aa4, metalness: 0.75, roughness: 0.32 }),
    gold: std({ color: 0xc8a24a, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 }),
    bronze: std({ color: 0x6d5434, metalness: 0.85, roughness: 0.4 }),
    copper: std({ color: 0x5f9c86, metalness: 0.5, roughness: 0.55 }),
    wood: std({ map: T.wood, roughness: 0.55 }),
    leather: std({ color: 0x5a2a20, roughness: 0.6 }),
    velvet: std({ color: 0x1b2a4a, roughness: 0.9 }),
    platform: std({ map: T.paving, color: 0xc9c3b9, roughness: 0.7 }),
    paving: std({ map: T.paving, color: 0xb3aca2, roughness: 0.75 }),
    lawn: new THREE.MeshLambertMaterial({ map: T.lawn }),
    leaves: new THREE.MeshLambertMaterial({ color: 0x3d6b2c }), trunk: new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
    water: new THREE.MeshStandardMaterial({ map: T.water, color: 0x9fd4e6, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.85, envMap: env }),
    jet: new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.55, depthWrite: false }),
    yellow: new THREE.MeshBasicMaterial({ color: 0xf2c200 }), white: new THREE.MeshBasicMaterial({ color: 0xf4f4f0 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x23272d }),
    rail: std({ color: 0x8e8a86, metalness: 0.85, roughness: 0.35 }),
    ballast: new THREE.MeshLambertMaterial({ color: 0x77726b }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xfff1cf }),
    shopGlow: new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
    flowerR: new THREE.MeshLambertMaterial({ color: 0xd8344f }), flowerY: new THREE.MeshLambertMaterial({ color: 0xf2c14e }), flowerW: new THREE.MeshLambertMaterial({ color: 0xf6f2ea }), flowerV: new THREE.MeshLambertMaterial({ color: 0x8a5cc8 }),
    rubber: new THREE.MeshLambertMaterial({ color: 0x1b1d20 }),
  };
  // Night lighting: façade washed, hall lit (emissive boost driven by update()).
  const glowMats = [M.bulb, M.shopGlow];

  // Geometry collectors per layer and material, merged at the end.
  const layers = { ext: new Map(), int: new Map() };
  const put = (layer, mat, geo) => { const L = layers[layer]; if (!L.has(mat)) L.set(mat, []); L.get(mat).push(geo.index ? geo.toNonIndexed() : geo); };
  const box = (layer, mat, w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); put(layer, mat, g); };
  const cyl = (layer, mat, r0, r1, h, x, y, z, seg = 16) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y, z); put(layer, mat, g); };
  const plane = (layer, mat, w, h, x, y, z, rx = 0, ry = 0, rep = null) => {
    const g = new THREE.PlaneGeometry(w, h); if (rep) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep[0], uv.getY(i) * rep[1]); }
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z); put(layer, mat, g);
  };
  const tube = (layer, mat, pts, r, seg = 48) => put(layer, mat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 6, false));
  const dyn = new THREE.Group(); root.add(dyn);                  // moving / updated objects (not merged)
  const interior = new THREE.Group(); root.add(interior);

  // =============== TRAIN SHED ===============
  const archY = (z) => SHED.spring + SHED.rise * Math.sqrt(Math.max(0, 1 - (z / SHED.hw) ** 2));
  const arch = (x, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const z = -SHED.hw + (2 * SHED.hw * i) / n; return new THREE.Vector3(x, archY(z), z); });
  // Main ribs (lattice arch: two chords + web), purlins, diagonal bracing.
  const ribX = []; for (let x = SHED.x0; x <= SHED.x1 + 0.1; x += 12.5) ribX.push(x);
  for (const x of ribX) {
    tube('ext', M.steel, arch(x), 0.32);
    tube('ext', M.steel, arch(x).map((p) => new THREE.Vector3(p.x, p.y - 1.4 * (p.y - SHED.spring) / SHED.rise - 0.4, p.z * 0.985)), 0.2);
    const a = arch(x, 24);
    for (let i = 0; i < a.length - 1; i++) { const p = a[i], q = a[i + 1]; tube('ext', M.steel, [p, new THREE.Vector3((p.x + q.x) / 2, (p.y + q.y) / 2 - 1.2, (p.z + q.z) / 2), q], 0.07, 4); }
    // Cast-iron bracket and column at each foot.
    for (const sd of [-1, 1]) { cyl('ext', M.steel, 0.45, 0.6, SHED.spring, x, SHED.spring / 2, sd * SHED.hw); box('ext', M.gold, 1.3, 0.35, 1.3, x, SHED.spring + 0.1, sd * SHED.hw); }
  }
  for (let i = 1; i < 16; i++) {
    const z = -SHED.hw + (2 * SHED.hw * i) / 16;
    box('ext', M.steel, SHED.x1 - SHED.x0, 0.25, 0.25, 0, archY(z) - 0.15, z);
  }
  // Glass skin.
  {
    const nx = 28, nz = 32, pos = [], idx = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { const x = SHED.x0 + ((SHED.x1 - SHED.x0) * i) / nx, z = -SHED.hw + (2 * SHED.hw * j) / nz; pos.push(x, archY(z) + 0.05, z); }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + nz + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const glass = new THREE.Mesh(g, M.glass); glass.renderOrder = 4; root.add(glass);
    // Bracing (fine ironwork) as lines.
    const lp = [];
    for (let i = 0; i < ribX.length - 1; i++) for (let j = 0; j < 16; j++) {
      const z0 = -SHED.hw + (2 * SHED.hw * j) / 16, z1 = -SHED.hw + (2 * SHED.hw * (j + 1)) / 16;
      lp.push(ribX[i], archY(z0), z0, ribX[i + 1], archY(z1), z1, ribX[i + 1], archY(z0), z0, ribX[i], archY(z1), z1);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2b333b })));
  }
  // Gable ends: fan-glazed screens with radial mullions; the west one carries the city name.
  for (const sx of [-1, 1]) {
    const x = sx > 0 ? SHED.x1 : SHED.x0;
    const shape = new THREE.Shape(); shape.moveTo(-SHED.hw, SHED.spring);
    for (let i = 0; i <= 48; i++) { const z = -SHED.hw + (2 * SHED.hw * i) / 48; shape.lineTo(z, archY(z)); }
    shape.lineTo(SHED.hw, SHED.spring + 14); shape.lineTo(-SHED.hw, SHED.spring + 14); shape.closePath();
    const sg = new THREE.ShapeGeometry(shape, 24); sg.rotateY(Math.PI / 2); sg.translate(x, 0, 0);
    const gl = new THREE.Mesh(sg, M.glassTint); gl.renderOrder = 4; root.add(gl);
    for (let i = 0; i <= 18; i++) { const a = Math.PI * (i / 18), z = -Math.cos(a) * SHED.hw, y = SHED.spring + 14 + Math.sin(a) * (archY(z) - SHED.spring - 14); tube('ext', M.steel, [new THREE.Vector3(x, SHED.spring + 14, 0), new THREE.Vector3(x, (SHED.spring + 14 + y) / 2, z / 2), new THREE.Vector3(x, y, z)], 0.12, 4); }
    box('ext', M.steel, 0.5, 0.6, SHED.hw * 2, x, SHED.spring + 14, 0);
    // Lower screen: arcade of arches over the tracks.
    for (let k = -3; k <= 3; k++) box('ext', M.stone, 2.2, SHED.spring + 14, 2.2, x, (SHED.spring + 14) / 2, k * 22);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(70, 7), new THREE.MeshBasicMaterial({ map: signTexture('GRANDVILLE', { w: 2048, h: 210, bg: '#1b2a4a', fg: '#e8cf8c', font: 'bold 160px Georgia' }), side: THREE.DoubleSide }));
    lbl.position.set(x + sx * 0.6, SHED.spring + 26, 0); lbl.rotation.y = sx * Math.PI / 2; root.add(lbl);
  }
  // North side wall (stone with arched windows); the south side opens onto the hall.
  box('ext', M.stone, SHED.x1 - SHED.x0, SHED.spring + 2, 2, 0, (SHED.spring + 2) / 2 - 0.5, -SHED.hw - 1.2);
  for (let x = SHED.x0 + 12.5; x < SHED.x1; x += 12.5) plane('ext', M.glassTint, 7, 5, x, 4.5, -SHED.hw - 2.25, 0, Math.PI);

  // Track bed under the whole shed (ballast between the islands).
  box('ext', M.ballast, 470, 0.3, SHED.hw * 2 + 6, 20, -0.62, 0);
  // =============== PLATFORMS & TRACKS ===============
  const sleeperZ = [];
  const voieLabel = (k) => `${2 * k + 1} · ${2 * k + 2}`;
  const pids = [];
  for (let k = 0; k < SLOTS; k++) {
    const z = slotZ(k);
    const top = PLAT_Y - 0.45;
    box('ext', M.platform, 270, 0.12, 10, 0, top - 0.06, z);                       // paved surface
    box('ext', M.stoneDark, 270, top + 0.6 - 0.12, 9.9, 0, (top - 0.12 - 0.6) / 2, z); // platform wall
    for (const sd of [-1, 1]) {
      box('ext', M.stoneDark, 270, 0.06, 0.4, 0, PLAT_Y - 0.45 + 0.03, z + sd * 4.8);                    // coping stones
      plane('ext', M.yellow, 270, 0.3, 0, PLAT_Y - 0.44, z + sd * 4.35, -Math.PI / 2);                   // tactile warning strip
      plane('ext', M.white, 270, 0.08, 0, PLAT_Y - 0.44, z + sd * 3.85, -Math.PI / 2);
    }
    // Other islands' tracks (the active island's tracks are the line's own).
    if (k !== slot) for (const sd of [-1, 1]) {
      const tz = z + sd * 6.5;
      box('ext', M.ballast, 420, 0.25, 3.4, 20, -0.62, tz);
      for (const r of [-0.7175, 0.7175]) box('ext', M.rail, 420, 0.16, 0.07, 20, -0.08, tz + r);
      sleeperZ.push(tz);
    }
    // Furniture: benches, lamp standards, signs, departure displays.
    for (let x = -110; x <= 110; x += 22) {
      if (Math.abs(x + 20) < 14) continue;
      box('ext', M.wood, 3.2, 0.12, 0.6, x, PLAT_Y - 0.45 + 0.48, z); box('ext', M.wood, 3.2, 0.5, 0.08, x, PLAT_Y - 0.45 + 0.8, z + 0.28);
      for (const lx of [-1.4, 1.4]) { box('ext', M.steel, 0.08, 0.42, 0.5, x + lx, PLAT_Y - 0.45 + 0.21, z); box('ext', M.steel, 0.08, 0.62, 0.06, x + lx, PLAT_Y - 0.45 + 0.75, z + 0.3); }
      cyl('ext', M.steel, 0.07, 0.1, 4.2, x + 11, PLAT_Y - 0.45 + 2.1, z, 8); box('ext', M.bulb, 0.9, 0.18, 0.4, x + 11, PLAT_Y - 0.45 + 4.1, z);
    }
    const sign = new THREE.MeshBasicMaterial({ map: signTexture([`Voies ${voieLabel(k)}`], { w: 1024, h: 200, bg: '#1b2a4a', fg: '#ffffff', font: 'bold 120px Arial' }), side: THREE.DoubleSide });
    for (const x of [-90, 40, 110]) {
      const top = PLAT_Y - 0.45, h = 3.6;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 1), sign); m.position.set(x, top + h + 0.5, z); m.rotation.y = Math.PI / 2; root.add(m);
      box('ext', M.dark, 0.12, 1.1, 5.2, x, top + h + 0.5, z);
      for (const dz of [-2.3, 2.3]) { box('ext', M.steel, 0.12, h, 0.12, x, top + h / 2, z + dz); box('ext', M.steel, 0.4, 0.06, 0.4, x, top + 0.03, z + dz); }
    }
    // Platform departure display (two-sided) at the stair foot.
    const c = document.createElement('canvas'); c.width = 1024; c.height = 384;
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide });
    for (const x of [-48, 64]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.35), pm); m.position.set(x, 3.4, z); m.rotation.y = Math.PI / 2; root.add(m); box('ext', M.dark, 0.3, 1.5, 3.8, x, 3.4, z); cyl('ext', M.steel, 0.08, 0.08, 2.3, x, 1.6, z, 6); }
    pids.push({ k, c, tx, tracks: [2 * k + 1, 2 * k + 2] });
  }

  {
    const n = sleeperZ.length * 705, sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.16, 2.6), M.ballast.clone(), n);
    sl.material.color.setHex(0x8a8580); const m4 = new THREE.Matrix4(); let i = 0;
    for (const z of sleeperZ) for (let j = 0; j < 700; j++) sl.setMatrixAt(i++, m4.makeTranslation(-190 + j * 0.6, -0.4, z));
    sl.count = i; root.add(sl);
  }
  // Stopping markers for the line's own trains (where the cab must stop), on the platform edge, facing the driver.
  {
    const mk = new THREE.MeshBasicMaterial({ map: signTexture('STOP', { w: 256, h: 256, bg: '#ffffff', fg: '#c8102e', font: 'bold 90px Arial', border: '#c8102e' }) });
    for (const route of Object.values(opts.routes || {})) {
      const k = route.stops.findIndex((st) => st.station.index === index); if (k < 0) continue;
      const st = route.stops[k], side = st.doorSide === 'right' ? 1 : -1;
      const a = route.point(st.stopR + 1.5, side * 1.95, 0, {}), b = route.point(st.stopR + 10, side * 1.95, 0, {});
      const g = new THREE.Group(); g.position.set(a.x - GC.x, PLAT_Y - 0.45, a.z - GC.z); g.lookAt(b.x - GC.x, PLAT_Y - 0.45, b.z - GC.z); g.rotateY(Math.PI);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), M.steel); post.position.y = 0.8; g.add(post);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), mk); board.position.set(0, 1.8, 0.03); g.add(board);
      root.add(g);
    }
  }
  // =============== FOOTBRIDGE & ESCALATORS ===============
  const BR = { x: -20, y: PLAT_Y - 0.45 + 8.9, w: 9 };   // deck level = top of the hall's grand stair
  box('ext', M.steelLight, BR.w + 1, 0.6, SHED.hw * 2 + 10, BR.x, BR.y - 0.3, 6);
  for (const sd of [-1, 1]) { box('ext', M.glass, 0.06, 2.6, SHED.hw * 2 + 10, BR.x + sd * (BR.w / 2), BR.y + 1.3, 6); box('ext', M.gold, 0.12, 0.1, SHED.hw * 2 + 10, BR.x + sd * (BR.w / 2), BR.y + 1.15, 6); }
  box('ext', M.steelLight, BR.w + 1, 0.3, SHED.hw * 2 + 10, BR.x, BR.y + 3.8, 6);
  for (let k = 0; k < SLOTS; k++) {
    const z = slotZ(k);
    // Escalator + stair down to the island (along the platform, under the bridge).
    const len = 16, rise = BR.y - PLAT_Y;
    for (const [dx, mat] of [[-1.3, M.steelLight], [1.3, M.steel]]) {
      const g = new THREE.BoxGeometry(1.6, 0.4, Math.hypot(len, rise)); g.rotateX(-Math.atan2(rise, len)); g.rotateY(Math.PI / 2);   // +x end (bridge) high g.translate(BR.x - BR.w / 2 - len / 2 - 0.5, PLAT_Y - 0.45 + rise / 2 - 0.2, z + dx); put('ext', mat, g);
    }
    for (let x = 0; x < 3; x++) cyl('ext', M.steel, 0.18, 0.18, BR.y, BR.x + (x - 1) * 3.5, BR.y / 2 - 0.45, z, 8);
  }

  // =============== GREAT HALL ===============
  const H = HALL, hx = (H.x1 - H.x0), hz = H.z1 - H.z0, hcz = (H.z0 + H.z1) / 2, FL = PLAT_Y - 0.45;
  plane('int', M.marble, hx, hz, 0, FL + 0.01, hcz, -Math.PI / 2, 0, [hx / 16, hz / 16]);
  plane('int', M.rose, 20, 20, 0, FL + 0.02, hcz, -Math.PI / 2);
  // Long walls (stone) with the colonnades, end walls.
  for (const [z, inner] of [[H.z0, 1], [H.z1, -1]]) {
    if (inner > 0) {
      // North wall towards the train shed: real openings (12 × 12 m arches) — glazed, except the central one where
      // the grand stair climbs to the footbridge.
      const OP = [-60, -20, 20, 60], W2 = 6, Hop = 12;
      let x0 = H.x0 - 2;
      for (const ox of OP) { box('ext', M.stone, ox - W2 - x0, H.h + 2, 2, (x0 + ox - W2) / 2, FL + (H.h + 2) / 2, z - inner); x0 = ox + W2; }
      box('ext', M.stone, H.x1 + 2 - x0, H.h + 2, 2, (x0 + H.x1 + 2) / 2, FL + (H.h + 2) / 2, z - inner);
      for (const ox of OP) box('ext', M.stone, 2 * W2, H.h + 2 - Hop, 2, ox, FL + Hop + (H.h + 2 - Hop) / 2, z - inner);
    } else box('ext', M.stone, hx + 4, H.h + 2, 2, 0, FL + (H.h + 2) / 2, z - inner);
    for (let x = H.x0 + 8; x <= H.x1 - 8; x += 12) {
      const cz = z + inner * 5;
      cyl('int', M.stone, 0.95, 1.05, H.h - 3, x, FL + 1.2 + (H.h - 3) / 2, cz, 20);
      box('int', M.stoneDark, 2.8, 1.2, 2.8, x, FL + 0.6, cz);
      box('int', M.gold, 2.9, 1.0, 2.9, x, FL + H.h - 1.3, cz); box('int', M.stone, 3.2, 0.7, 3.2, x, FL + H.h - 0.45, cz);
    }
    box('int', M.stone, hx, 2.2, 3.4, 0, FL + H.h + 0.9, z + inner * 5);    // entablature
    box('int', M.gold, hx, 0.25, 3.5, 0, FL + H.h - 0.1, z + inner * 5);
  }
  for (const x of [H.x0, H.x1]) box('ext', M.stone, 2, H.h + 2, hz, x, FL + (H.h + 2) / 2, hcz);
  // Arches from the hall to the shed (north wall) — openings.
  for (const x of [-60, -20, 20, 60]) { box('int', M.gold, 12.4, 0.5, 2.4, x, FL + 12.2, H.z0); if (x !== -20) plane('int', M.glass, 12, 12, x, FL + 6, H.z0 - 1); }
  // Coffered barrel vault with a glazed skylight along its crown.
  {
    const R = hz / 2 + 2, base = FL + H.h + 2;
    const vault = (phi0, phi1, mat) => {
      const g = new THREE.CylinderGeometry(R, R, hx + 4, 48, 1, true, phi0, phi1 - phi0); g.rotateZ(Math.PI / 2); g.scale(1, H.vault / R, 1);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 30);
      g.translate(0, base, hcz); put('ext', mat, g);
    };
    vault(0, Math.PI / 2 - 0.32, M.coffer); vault(Math.PI / 2 + 0.32, Math.PI, M.coffer);
    const sky = new THREE.CylinderGeometry(R, R, hx + 4, 12, 1, true, Math.PI / 2 - 0.32, 0.64); sky.rotateZ(Math.PI / 2); sky.scale(1, H.vault / R, 1); sky.translate(0, base, hcz);
    const sk = new THREE.Mesh(sky, M.glass); sk.renderOrder = 4; root.add(sk);
    for (let x = H.x0; x <= H.x1; x += 6) tube('ext', M.gold, Array.from({ length: 25 }, (_, i) => { const a = -Math.PI / 2 + (Math.PI * i) / 24; return new THREE.Vector3(x, base + Math.cos(a) * H.vault, hcz + Math.sin(a) * R); }), 0.18, 24);
    // Exterior roof cladding (copper) above the coffers.
    const out = new THREE.CylinderGeometry(R + 1.2, R + 1.2, hx + 6, 48, 1, true, 0, Math.PI); out.rotateZ(Math.PI / 2); out.scale(1, (H.vault + 1.4) / (R + 1.2), 1); out.translate(0, base, hcz); put('ext', M.copper, out);
  }
  // Chandeliers.
  const chand = [];
  for (const x of [-80, -40, 0, 40, 80]) {
    const y = FL + 15;
    for (const [r, dy] of [[3.2, 0], [2.2, 1.2], [1.2, 2.2]]) {
      const ring = new THREE.TorusGeometry(r, 0.09, 6, 32); ring.rotateX(Math.PI / 2); ring.translate(x, y + dy, hcz); put('int', M.gold, ring);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, b = new THREE.SphereGeometry(0.16, 8, 6); b.translate(x + Math.cos(a) * r, y + dy + 0.18, hcz + Math.sin(a) * r); put('int', M.bulb, b); }
    }
    cyl('int', M.gold, 0.05, 0.05, FL + H.h + H.vault - y - 2, x, (y + FL + H.h + H.vault) / 2, hcz, 6);
    chand.push(new THREE.Vector3(x, y, hcz));
  }
  // Departure board (split-flap style) above the central arches, arrivals on the east wall.
  const board = mkBoard(2048, 720), arrBoard = mkBoard(1536, 640);
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 10.5), board.mat); m.position.set(0, FL + 17.5, H.z0 + 0.9); interior.add(m); box('int', M.dark, 31, 11.4, 0.6, 0, FL + 17.5, H.z0 + 0.5); box('int', M.gold, 31.4, 0.3, 0.8, 0, FL + 23.3, H.z0 + 0.5); }
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 9.2), arrBoard.mat); m.position.set(H.x1 - 1.1, FL + 14, hcz); m.rotation.y = -Math.PI / 2; interior.add(m); box('int', M.dark, 0.6, 10, 23, H.x1 - 0.8, FL + 14, hcz); }
  // Shops, cafés, brasserie, ticket office along the end walls and the south colonnade.
  const shops = [
    ['Café Lumière', '#7a4a2a', [-104, 96]], ['Brasserie Le Grand Train', '#1b2a4a', [-104, 112]], ['Librairie des Voyages', '#2f4a3f', [-104, 128]], ['Fleurs & Jardins', '#4f7d36', [-104, 142]],
    ['Chocolaterie Royale', '#5a2a20', [104, 96]], ['Maison du Thé', '#8a6a2a', [104, 112]], ['Parfums de Grandville', '#6a3a6a', [104, 128]], ['Boulangerie', '#b07a3a', [104, 142]],
  ];
  const doors = [];
  for (const [name, color, [x, z]] of shops) {
    const sx = Math.sign(x), front = x - sx * 3;
    box('int', M.wood, 0.4, 6, 12, front, FL + 3, z); plane('int', M.shopGlow, 9, 4.2, front - sx * 0.25, FL + 2.4, z, 0, -sx * Math.PI / 2);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.3), new THREE.MeshBasicMaterial({ map: signTexture(name, { w: 1024, h: 132, bg: color, fg: '#f3e6c4', font: 'italic bold 72px Georgia' }) }));
    s.position.set(front - sx * 0.3, FL + 5.3, z); s.rotation.y = -sx * Math.PI / 2; interior.add(s);
    const aw = new THREE.BoxGeometry(1.8, 0.12, 11); aw.translate(front - sx * 1.1, FL + 4.6, z); put('int', new THREE.MeshLambertMaterial({ color }), aw);
    doors.push({ x: front - sx * 1.5, z, name });
  }
  // Brasserie terrace (tables & chairs) and café tables.
  for (let i = 0; i < 18; i++) {
    const x = -96 + (i % 3) * 3.2, z = 100 + Math.floor(i / 3) * 4.2;
    cyl('int', M.gold, 0.05, 0.05, 0.75, x, FL + 0.37, z, 6); cyl('int', M.stoneDark, 0.45, 0.45, 0.05, x, FL + 0.76, z, 12);
    for (const d of [-0.75, 0.75]) box('int', M.wood, 0.45, 0.45, 0.45, x + d, FL + 0.23, z);
  }
  // Ticket office (counters with windows) and ticket machines.
  for (let i = 0; i < 6; i++) { const x = 30 + i * 6; box('int', M.wood, 5, 1.1, 1.2, x, FL + 0.55, 144); box('int', M.glass, 5, 1.6, 0.05, x, FL + 1.9, 143.5); }
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.6), new THREE.MeshBasicMaterial({ map: signTexture('BILLETS · TICKETS · RÉSERVATIONS', { w: 2048, h: 126, bg: '#1b2a4a', fg: '#ffffff', font: 'bold 84px Arial' }) })); s.position.set(45, FL + 4.6, 143.3); s.rotation.y = Math.PI; interior.add(s); }
  for (let i = 0; i < 8; i++) { const x = -70 + i * 2.6; box('int', new THREE.MeshLambertMaterial({ color: 0xf2c200 }), 1.4, 1.9, 0.8, x, FL + 0.95, 146); plane('int', M.shopGlow, 0.8, 0.6, x, FL + 1.35, 145.58, 0, Math.PI); }
  // First-class lounge "Salon Grand Voyageur" (west), seating islands.
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.3), new THREE.MeshBasicMaterial({ map: signTexture('Salon Grand Voyageur', { w: 1024, h: 96, bg: '#1b2a4a', fg: '#e8cf8c', font: 'italic bold 64px Georgia' }) })); s.position.set(-75, FL + 4.2, 118); s.rotation.y = Math.PI / 2; interior.add(s); }
  plane('int', M.velvet, 18, 22, -86, FL + 0.03, 118, -Math.PI / 2);
  for (let i = 0; i < 8; i++) { const x = -92 + (i % 2) * 9, z = 108 + Math.floor(i / 2) * 6; box('int', M.leather, 3, 0.6, 1.1, x, FL + 0.3, z); box('int', M.leather, 3, 0.8, 0.3, x, FL + 0.8, z + 0.5); }
  const benches = [];
  for (let i = 0; i < 12; i++) { const x = -52 + (i % 6) * 13 + (i % 6 >= 3 ? 26 : 0), z = i < 6 ? 106 : 132; if (Math.abs(x) < 14) continue; box('int', M.wood, 5, 0.12, 0.7, x, FL + 0.48, z); box('int', M.wood, 5, 0.7, 0.1, x, FL + 0.9, z + 0.35); for (const lx of [-2.2, 0, 2.2]) box('int', M.bronze, 0.1, 0.42, 0.6, x + lx, FL + 0.21, z); benches.push({ x, z }); }
  // Indoor trees in planters, flowers, the fountain and the suspended sculpture.
  for (const [x, z] of [[-30, 104], [30, 104], [-30, 132], [30, 132], [-62, 118], [62, 118]]) {
    cyl('int', M.stone, 2.2, 2.4, 1.0, x, FL + 0.5, z, 20); cyl('int', M.trunk, 0.25, 0.35, 7, x, FL + 4.5, z, 8);
    for (const [r, y] of [[3.4, 7.5], [2.7, 9.2], [1.8, 10.6]]) { const s = new THREE.IcosahedronGeometry(r, 1); s.scale(1, 0.75, 1); s.translate(x, FL + y, z); put('int', M.leaves, s); }
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, f = new THREE.SphereGeometry(0.22, 6, 4); f.translate(x + Math.cos(a) * 1.9, FL + 1.15, z + Math.sin(a) * 1.9); put('int', [M.flowerR, M.flowerY, M.flowerW, M.flowerV][i % 4], f); }
  }
  cyl('int', M.stone, 6.2, 6.4, 0.8, 0, FL + 0.4, hcz, 40); cyl('int', M.marble, 5.6, 5.6, 0.82, 0, FL + 0.42, hcz, 40);
  const fountainWater = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40).rotateX(-Math.PI / 2), M.water); fountainWater.position.set(0, FL + 0.7, hcz); interior.add(fountainWater);
  cyl('int', M.bronze, 0.5, 0.9, 3.2, 0, FL + 2.2, hcz, 16);
  const jets = []; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, j = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 2.6, 6), M.jet); j.position.set(Math.cos(a) * 3.6, FL + 2, hcz + Math.sin(a) * 3.6); j.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); interior.add(j); jets.push(j); }
  const sculpture = new THREE.Group(); sculpture.position.set(0, FL + 28, hcz); interior.add(sculpture);
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2, p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.6, 1.6), M.gold); p.position.set(Math.cos(a) * 7, Math.sin(a * 3) * 0.8, Math.sin(a) * 7); p.rotation.set(0.5, -a, 0.3); sculpture.add(p); }
  // Metro entrance: escalator well with colour-coded signage.
  box('int', M.stoneDark, 14, 1.1, 0.4, 80, FL + 0.55, 120); box('int', M.stoneDark, 14, 1.1, 0.4, 80, FL + 0.55, 130); box('int', M.dark, 14, 0.05, 10, 80, FL - 6, 125);   // floor of the well (the opening itself stays open)
  for (const dz of [-2.2, 2.2]) { const g = new THREE.BoxGeometry(12, 0.3, 1.6); g.rotateZ(-0.52); g.translate(81, FL - 2.6, 125 + dz); put('int', M.steelLight, g); }
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshBasicMaterial({ map: metroSign(), transparent: true })); s.position.set(80, FL + 5.5, 119.6); s.rotation.y = Math.PI; interior.add(s); const s2 = s.clone(); s2.position.z = 130.4; s2.rotation.y = 0; interior.add(s2); }
  // Directional signage (colour coded).
  for (const [txt, x, z, ry, bg] of [['⬆ Grandes Lignes · Voies 1–12', -20, 100, 0, '#1b2a4a'], ['Ⓜ Métro A · B · C ➜', 50, 112, 0, '#8B1E8F'], ['⬅ Salon Grand Voyageur · Brasserie', -40, 136, Math.PI, '#2f4a3f'], ['Sortie · Exit · Taxis · Bus ⬇', 0, 145, Math.PI, '#0f6b3a']]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.2), new THREE.MeshBasicMaterial({ map: signTexture(txt, { w: 1536, h: 150, bg, fg: '#ffffff', font: 'bold 84px Arial' }), side: THREE.DoubleSide }));
    s.position.set(x, FL + 7, z); s.rotation.y = ry; interior.add(s);
    for (const d of [-5.5, 5.5]) { const rx = x + Math.cos(ry) * d, rz = z - Math.sin(ry) * d; box('int', M.dark, 0.04, H.h - 7.6, 0.04, rx, FL + 7.6 + (H.h - 7.6) / 2, rz); }
  }
  // Grand stair from the hall up to the footbridge.
  for (let i = 0; i < 24; i++) box('int', M.marble, 12, 0.37 * (i + 1), 0.6, BR.x, FL + 0.185 * (i + 1), H.z0 + 14 - i * 0.6);
  for (const sd of [-1, 1]) { const g = new THREE.BoxGeometry(0.3, 1.1, 14.4); g.rotateX(-Math.atan2(8.9, 14.4)); g.translate(BR.x + sd * 6.1, FL + 5, H.z0 + 7); put('int', M.gold, g); }

  // =============== FAÇADE (south) ===============
  const FZ = H.z1 + 1.5;
  const facadeY0 = FL;
  box('ext', M.stone, 240, 28, 3, 0, facadeY0 + 14, FZ);                                  // main front
  box('ext', M.stoneDark, 244, 1.6, 4.4, 0, facadeY0 + 28.4, FZ);                         // cornice
  box('ext', M.stone, 240, 3, 2.4, 0, facadeY0 + 30.6, FZ - 0.4);                         // attic
  // Central pavilion with the giant glazed arch.
  box('ext', M.stone, 64, 46, 5, 0, facadeY0 + 23, FZ + 1);
  const archShape = new THREE.Shape(); archShape.moveTo(-18, 0); archShape.lineTo(-18, 18); archShape.absarc(0, 18, 18, Math.PI, 0, true); archShape.lineTo(18, 0); archShape.closePath();
  { const g = new THREE.ShapeGeometry(archShape, 32); g.translate(0, facadeY0 + 2, FZ + 3.6); const m = new THREE.Mesh(g, M.glassTint); m.renderOrder = 4; root.add(m); }
  for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); tube('ext', M.gold, [new THREE.Vector3(0, facadeY0 + 20, FZ + 3.7), new THREE.Vector3(-Math.cos(a) * 18, facadeY0 + 20 + Math.sin(a) * 18, FZ + 3.7)], 0.14, 2); }
  for (const x of [-12, -6, 0, 6, 12]) box('ext', M.gold, 0.25, 18, 0.25, x, facadeY0 + 11, FZ + 3.7);
  for (const y of [7, 13, 20]) box('ext', M.gold, 36, 0.25, 0.25, 0, facadeY0 + y, FZ + 3.7);
  { const t = new THREE.TorusGeometry(18.6, 0.9, 8, 48, Math.PI); t.translate(0, facadeY0 + 20, FZ + 3.8); put('ext', M.stoneDark, t); }
  // Clock tower above the central pavilion: the giant clock, a copper dome and a gilded lantern (the silhouette
  // that identifies the station from anywhere in the city).
  const clock = mkClock();
  box('ext', M.stone, 26, 22, 12, 0, facadeY0 + 57, FZ - 1);
  box('ext', M.stoneDark, 28, 1.4, 13.5, 0, facadeY0 + 68.4, FZ - 1);
  for (const sd of [-1, 1]) { cyl('ext', M.stone, 0.9, 1, 18, sd * 11.5, facadeY0 + 56, FZ + 5.3, 16); box('ext', M.gold, 2.2, 0.8, 2.2, sd * 11.5, facadeY0 + 65.4, FZ + 5.3); }
  { const m = new THREE.Mesh(new THREE.CircleGeometry(8, 64), clock.mat); m.position.set(0, facadeY0 + 57, FZ + 5.08); root.add(m); const ring = new THREE.TorusGeometry(8.3, 0.55, 10, 64); ring.translate(0, facadeY0 + 57, FZ + 5.15); put('ext', M.gold, ring); }
  { const d = new THREE.SphereGeometry(10, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); d.scale(1, 1.35, 1); d.translate(0, facadeY0 + 69, FZ - 1); put('ext', M.copper, d);
    cyl('ext', M.gold, 1.6, 2.2, 5, 0, facadeY0 + 84, FZ - 1, 12); const tip = new THREE.ConeGeometry(1.4, 6, 12); tip.translate(0, facadeY0 + 89.5, FZ - 1); put('ext', M.gold, tip); }
  // Lettering.
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(50, 3.6), new THREE.MeshBasicMaterial({ map: signTexture('GARE CENTRALE', { w: 2048, h: 148, bg: '#e7dcc6', fg: '#8c6d3a', font: 'bold 120px Georgia' }) })); m.position.set(0, facadeY0 + 41.6, FZ + 3.62); root.add(m); }
  // Colonnades and arched windows on both wings; end pavilions with copper domes.
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const x = sd * (38 + i * 8.5);
      cyl('ext', M.stone, 1.0, 1.1, 22, x, facadeY0 + 11 + 1.5, FZ + 3.2, 20); box('ext', M.gold, 2.4, 1.1, 2.4, x, facadeY0 + 23.6, FZ + 3.2); box('ext', M.stoneDark, 2.6, 1.4, 2.6, x, facadeY0 + 0.7, FZ + 3.2);
      if (i < 8) { const ws = new THREE.Shape(); ws.moveTo(-2.6, 0); ws.lineTo(-2.6, 10); ws.absarc(0, 10, 2.6, Math.PI, 0, true); ws.lineTo(2.6, 0); ws.closePath(); const g = new THREE.ShapeGeometry(ws, 12); g.translate(x + sd * 4.25, facadeY0 + 5, FZ + 1.6); put('ext', M.glassTint, g); }
    }
    box('ext', M.stoneDark, 2, 26, 3, sd * 115, facadeY0 + 13, FZ + 2);
    box('ext', M.stone, 22, 36, 14, sd * 120, facadeY0 + 18, FZ - 4);
    const dome = new THREE.SphereGeometry(9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(sd * 120, facadeY0 + 36, FZ - 4); put('ext', M.copper, dome);
    cyl('ext', M.gold, 0.15, 0.15, 6, sd * 120, facadeY0 + 48, FZ - 4, 6); const ball = new THREE.SphereGeometry(0.6, 12, 8); ball.translate(sd * 120, facadeY0 + 51, FZ - 4); put('ext', M.gold, ball);
    // Sculpture groups on the attic (stylised allegorical figures).
    for (let f = 0; f < 3; f++) {
      const x = sd * (14 + f * 6), y = facadeY0 + 46;
      cyl('ext', M.bronze, 0.9, 1.2, 3.4, x, y + 1.7, FZ + 1.5, 10); const head = new THREE.SphereGeometry(0.55, 10, 8); head.translate(x, y + 3.9, FZ + 1.5); put('ext', M.bronze, head);
      const arm = new THREE.BoxGeometry(0.35, 2.4, 0.35); arm.rotateZ(sd * (0.6 + f * 0.3)); arm.translate(x + sd * 0.9, y + 3.6, FZ + 1.5); put('ext', M.bronze, arm);
    }
  }
  // Entrance doors and the glass marquise.
  for (const x of [-9, 0, 9]) { box('ext', M.wood, 5, 7, 0.4, x, facadeY0 + 3.5, FZ + 3.8); box('ext', M.gold, 5.4, 0.3, 0.5, x, facadeY0 + 7.1, FZ + 3.85); }
  box('ext', M.steel, 40, 0.3, 8, 0, facadeY0 + 8, FZ + 8); plane('ext', M.glass, 40, 8, 0, facadeY0 + 8.2, FZ + 8, -Math.PI / 2);
  for (const x of [-18, -6, 6, 18]) cyl('ext', M.steel, 0.12, 0.12, 8, x, facadeY0 + 4, FZ + 11.6, 8);
  // Grand stairs down to the forecourt.
  for (let i = 0; i < 8; i++) box('ext', M.stone, 90 - i * 2, 0.19, 1.2, 0, facadeY0 - 0.095 - i * 0.19, FZ + 4.5 + i * 1.2);

  // =============== FORECOURT ===============
  const FY = facadeY0 - 1.55, fz0 = FZ + 14, fz1 = FZ + 190;
  plane('ext', M.paving, 420, fz1 - fz0, 0, FY, (fz0 + fz1) / 2, -Math.PI / 2, 0, [420 / 8, (fz1 - fz0) / 8]);
  // Great fountain with jets, two smaller ones, gardens and tree avenues.
  const fjets = [];
  for (const [x, z, r] of [[0, fz0 + 60, 14], [-110, fz0 + 70, 7], [110, fz0 + 70, 7]]) {
    cyl('ext', M.stone, r + 0.6, r + 0.8, 0.9, x, FY + 0.45, z, 48);
    const w = new THREE.Mesh(new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2), M.water); w.position.set(x, FY + 0.8, z); root.add(w);
    cyl('ext', M.stone, r * 0.25, r * 0.32, 2.4, x, FY + 1.6, z, 24);
    for (let i = 0; i < (r > 10 ? 16 : 8); i++) { const a = (i / (r > 10 ? 16 : 8)) * Math.PI * 2, j = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, r * 0.5, 6), M.jet); j.position.set(x + Math.cos(a) * r * 0.55, FY + 1.6 + r * 0.25, z + Math.sin(a) * r * 0.55); j.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); root.add(j); fjets.push(j); }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.5, r * 0.7, 8), M.jet); top.position.set(x, FY + 2.8 + r * 0.35, z); root.add(top); fjets.push(top);
  }
  for (const sd of [-1, 1]) {
    plane('ext', M.lawn, 70, 60, sd * 62, FY + 0.05, fz0 + 60, -Math.PI / 2, 0, [6, 5]);
    for (let i = 0; i < 40; i++) { const f = new THREE.SphereGeometry(0.35, 6, 4); f.translate(sd * (28 + (i % 20) * 3.5), FY + 0.3, fz0 + 30 + Math.floor(i / 20) * 60); put('ext', [M.flowerR, M.flowerY, M.flowerW, M.flowerV][i % 4], f); }
  }
  const trees = [];
  for (let i = 0; i < 14; i++) for (const sd of [-1, 1]) trees.push([sd * (16 + 0), fz0 + 6 + i * 12], [sd * 150, fz0 + 6 + i * 12]);
  for (let i = -8; i <= 8; i++) trees.push([i * 24, fz1 - 6]);
  for (const [x, z] of trees) { cyl('ext', M.trunk, 0.25, 0.35, 4, x, FY + 2, z, 6); const s = new THREE.IcosahedronGeometry(3, 1); s.scale(1, 1.15, 1); s.translate(x, FY + 6.5, z); put('ext', M.leaves, s); }
  // Ornate lamp posts.
  for (let i = 0; i < 16; i++) for (const sd of [-1, 1]) { const x = sd * 40, z = fz0 + 5 + i * 11; cyl('ext', M.steel, 0.09, 0.13, 5, x, FY + 2.5, z, 8); const l = new THREE.SphereGeometry(0.4, 10, 8); l.translate(x, FY + 5.2, z); put('ext', M.bulb, l); }
  // Drop-off lane, taxi rank and bus bays.
  plane('ext', new THREE.MeshLambertMaterial({ color: 0x3d3f43 }), 360, 14, 0, FY + 0.02, FZ + 22, -Math.PI / 2);
  const carMats = [0xf0f0f0, 0x222222, 0x1f4fa0, 0xc8352a, 0x9aa1a8].map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.35 }));
  for (let i = 0; i < 10; i++) {
    const x = 60 + i * 5.6;
    box('ext', carMats[i % 5], 4.5, 1.0, 1.85, x, FY + 0.33 + 0.5, FZ + 19); box('ext', M.dark, 2.6, 0.62, 1.7, x, FY + 1.33 + 0.31, FZ + 19);
    box('ext', new THREE.MeshBasicMaterial({ color: 0xfff2a0 }), 0.6, 0.18, 0.25, x, FY + 2.04, FZ + 19);
    for (const wx of [-1.45, 1.45]) for (const wz of [-0.85, 0.85]) { const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14); w.rotateX(Math.PI / 2); w.translate(x + wx, FY + 0.33, FZ + 19 + wz); put('ext', M.rubber, w); }
  }
  { const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), new THREE.MeshBasicMaterial({ map: signTexture('TAXIS', { w: 512, h: 100, bg: '#1b2a4a', fg: '#f2c200', font: 'bold 80px Arial' }), side: THREE.DoubleSide })); s.position.set(84, FY + 4, FZ + 15); root.add(s); }
  for (let i = 0; i < 3; i++) {
    const x = -70 - i * 16;
    box('ext', new THREE.MeshStandardMaterial({ color: 0x1f4fa0, metalness: 0.3, roughness: 0.4 }), 12, 2.75, 2.55, x, FY + 0.45 + 1.375, FZ + 19); box('ext', M.glassTint, 11, 1.1, 2.6, x, FY + 2.35, FZ + 19);
    for (const wx of [-3.9, 3.4]) for (const wz of [-1.1, 1.1]) { const w = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16); w.rotateX(Math.PI / 2); w.translate(x + wx, FY + 0.5, FZ + 19 + wz); put('ext', M.rubber, w); }
  }
  // Metro entrance kiosk on the forecourt.
  box('ext', M.steel, 6, 0.3, 4, 150, FY + 3.2, FZ + 40); { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), new THREE.MeshBasicMaterial({ map: signTexture('M', { w: 256, h: 256, bg: '#ffffff', fg: '#1f3c88', font: 'bold 200px Arial', border: '#1f3c88' }), side: THREE.DoubleSide })); s.position.set(150, FY + 7.3, FZ + 42.5); root.add(s); for (const [dx, dz] of [[-2.8, -1.8], [2.8, -1.8], [-2.8, 1.8], [2.8, 1.8]]) cyl('ext', M.steel, 0.08, 0.08, 3.2, 150 + dx, FY + 1.6, FZ + 40 + dz, 6); cyl('ext', M.steel, 0.1, 0.1, 6, 150, FY + 3, FZ + 42.5, 6); }

  // Two-sided signs read correctly from both sides (a double-sided plane would show mirrored text from behind).
  for (const parent of [root, interior]) for (const m of [...parent.children]) {
    if (!m.isMesh || !m.material?.map || m.material.side !== THREE.DoubleSide || m.geometry.type !== 'PlaneGeometry') continue;
    m.material = m.material.clone(); m.material.side = THREE.FrontSide;
    const back = new THREE.Mesh(m.geometry, m.material); back.position.copy(m.position); back.rotation.copy(m.rotation); back.rotateY(Math.PI); parent.add(back);
  }
  // =============== MERGE STATIC GEOMETRY ===============
  for (const [layer, map] of Object.entries(layers)) for (const [mat, geos] of map) {
    const norm = geos.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; });
    const mesh = new THREE.Mesh(mergeGeometries(norm), mat);
    if (mat.transparent) mesh.renderOrder = 4;
    (layer === 'int' ? interior : root).add(mesh);
  }

  // =============== LIGHTS (hall, only when the viewer is near) ===============
  const hallLights = chand.slice(1, 4).map((p) => { const l = new THREE.PointLight(0xffe2b0, 0, 60, 1.6); l.position.copy(p); interior.add(l); return l; });
  const facadeLight = new THREE.SpotLight(0xffe0b0, 0, 140, 0.6, 0.6, 1.2); facadeLight.position.set(0, FY + 2, FZ + 60); facadeLight.target.position.set(0, facadeY0 + 25, FZ); root.add(facadeLight, facadeLight.target);

  // =============== TRAVELLERS ===============
  const crowd = new Crowd(dyn, { FL, PLAT_Y, BR, H, FZ, FY, doors, benches, slotZ });
  // Travellers head for the island of a departure in the next 45 minutes (as shown on the boards) and board only
  // when a train stands at that island; arrivals leave from the island where a train has just come in.
  crowd.pickIsland = (arriving) => {
    const c = crowd.clock ?? 43200;
    const list = tt.services.filter((sv) => !sv.cancelled && sv.kind === (arriving ? 'arr' : 'dep') && (arriving ? c - (sv.time + sv.delay) < 900 && c > sv.time + sv.delay : sv.time + sv.delay - c < 2700 && sv.time + sv.delay > c));
    const sv = list[Math.floor(Math.random() * list.length)];
    return sv ? Math.floor((sv.voie - 1) / 2) : Math.floor(Math.random() * SLOTS);
  };

  // =============== OTHER TRAINS (timetable-driven, on the other islands) ===============
  const tt = new TgvTimetable(opts.allLines || [line], opts.day ?? Math.floor(Date.now() / 86400000));
  const ghostTrains = new Map();
  const trainFactory = opts.makeTrain;

  // =============== API ===============
  const rootWorld = new THREE.Vector3(GC.x, y0, GC.z);
  let lastBoard = -99, lastClock = -1, t = 0;
  const api = {
    group: root,
    exclude(x, z, pad = 0) { const lx = x - GC.x, lz = z - GC.z; return lx > -260 - pad && lx < 260 + pad && lz > -95 - pad && lz < FZ + 200 + pad; },
    x: GC.x, z: GC.z, radius: 300,
    envelope: { maxLat: 70, ceil: () => 30 },
    timetable: tt,
    pidStation: {
      index, centerS: geom.stationS[index],
      updatePIDs: (clock) => api.updateBoards(clock),
    },
    /** Camera presets for the station tour. */
    views: [
      { name: 'Façade', pos: [GC.x - 60, y0 + 8, GC.z + FZ + 150], look: [GC.x, y0 + 34, GC.z + FZ] },
      { name: 'Forecourt fountain', pos: [GC.x + 40, y0 + 3, GC.z + FZ + 95], look: [GC.x - 10, y0 + 18, GC.z + FZ] },
      { name: 'Great Hall', pos: [GC.x - 95, y0 + 9, GC.z + 120], look: [GC.x + 20, y0 + 12, GC.z + 116] },
      { name: 'Hall from the stair', pos: [GC.x - 20, y0 + 10, GC.z + 92], look: [GC.x + 10, y0 + 6, GC.z + 140] },
      { name: 'Train shed', pos: [GC.x - 20, y0 + 11, GC.z + 30], look: [GC.x + 120, y0 + 8, GC.z - 10] },
      { name: 'Platforms', pos: [GC.x - 140, y0 + 2.6, GC.z + slotZ(2) + 2], look: [GC.x + 60, y0 + 6, GC.z + slotZ(2)] },
      { name: 'Aerial', pos: [GC.x + 260, y0 + 140, GC.z + 320], look: [GC.x, y0, GC.z + 40] },
    ],
    updateBoards(clock) {
      if (Math.abs(clock - lastBoard) < 8) return;
      lastBoard = clock;
      drawBoard(board, 'DÉPARTS · DEPARTURES', tt.board('dep', clock, 10), tt, clock, true);
      drawBoard(arrBoard, 'ARRIVÉES · ARRIVALS', tt.board('arr', clock, 8), tt, clock, false);
      for (const p of pids) drawPid(p, tt, clock);
      if (Math.floor(clock / 60) !== Math.floor(lastClock / 60)) drawClock(clock);
      lastClock = clock;
    },
    update(dt, time, clockS, cam) {
      t += dt;
      const camLocal = cam ? cam.clone().sub(rootWorld) : null;
      const d = camLocal ? Math.hypot(camLocal.x, camLocal.z - 60) : 0;
      interior.visible = d < 520;
      // Lighting by time of day: lamps and shop windows glow at dusk / night, chandeliers always warm inside.
      const hour = ((clockS ?? 43200) / 3600) % 24, night = hour < 6.5 || hour > 20.5 ? 1 : hour < 8 ? (8 - hour) / 1.5 : hour > 19 ? (hour - 19) / 1.5 : 0;
      for (const m of glowMats) m.color.setScalar(0.75 + 0.25 * night).multiply(m === M.bulb ? new THREE.Color(1, 0.95, 0.82) : new THREE.Color(1, 0.88, 0.69));
      M.stone.emissive.setRGB(0.32 * night, 0.25 * night, 0.14 * night);
      facadeLight.intensity = 900 * night;
      for (const l of hallLights) l.intensity = d < 300 ? 260 : 0;
      // Water and art.
      T.water.offset.x = (t * 0.03) % 1; T.water.offset.y = (t * 0.02) % 1;
      for (const [i, j] of [...jets, ...fjets].entries()) j.scale.y = 0.85 + 0.15 * Math.sin(t * 6 + i);
      sculpture.rotation.y = t * 0.03;
      if (d < 700) {
        crowd.clock = clockS ?? 43200;
        crowd.standing = new Set([slot]);                          // the player's train stands at its island
        for (const g of ghostTrains.values()) if (g.standing) crowd.standing.add(Math.round(g.zTrack / SLOT + 2.5));
        crowd.update(dt, clockS ?? 43200, ghostTrains);
      }
      // Other trains of the timetable at their platforms.
      if (clockS != null && trainFactory && d < 2500) updateGhosts(clockS);
    },
    dispose() { crowd.dispose(); for (const g of ghostTrains.values()) g.model.dispose?.(parent); },
  };

  function updateGhosts(clock) {
    const want = new Map();
    for (const sv of tt.services) {
      if (sv.cancelled) continue;
      const tt0 = sv.time + sv.delay, k = Math.floor((sv.voie - 1) / 2);
      if (k === slot) continue;                                  // the player's island
      const zTrack = slotZ(k) + (sv.voie % 2 ? -6.5 : 6.5);
      const east = sv.line.rail?.voie % 2 === 0;                 // eastbound corridors leave towards +x
      let x = null;
      if (sv.kind === 'dep') {
        if (clock > tt0 - 25 * 60 && clock < tt0) x = HALF_P - 10;
        else if (clock >= tt0 && clock < tt0 + 150) { const tt2 = clock - tt0; x = HALF_P - 10 + 0.5 * 0.45 * tt2 * tt2; }
        if (x != null) want.set(`d${sv.no}`, { x: east ? x : -x, zTrack, dirSign: east ? 1 : -1, standing: clock < tt0 });
      } else {
        // Arriving: comes in nose first and brakes to its stop at the far end of the platform.
        if (clock > tt0 - 150 && clock < tt0) { const tt2 = tt0 - clock; x = HALF_P - 10 - 0.5 * 0.45 * tt2 * tt2; }
        else if (clock >= tt0 && clock < tt0 + 15 * 60) x = HALF_P - 10;
        if (x != null) want.set(`a${sv.no}`, { x: east ? -x : x, zTrack, dirSign: east ? -1 : 1, standing: clock >= tt0 });
      }
    }
    for (const [key, g] of ghostTrains) if (!want.has(key)) { g.model.dispose(parent); ghostTrains.delete(key); }
    let n = 0;
    for (const [key, w] of want) {
      if (n++ > 5) break;
      let g = ghostTrains.get(key);
      // Models live in world space (TrainModel orients its cars with world-space lookAt).
      if (!g) { const model = trainFactory(); parent.add(model.group); g = { model }; ghostTrains.set(key, g); }
      const route = { point: (r, lat, h, out = {}) => { out.x = GC.x + w.dirSign * r; out.y = y0; out.z = GC.z + w.zTrack; return out; } };
      g.model.setPose(route, w.dirSign * w.x);
      g.standing = w.standing; g.zTrack = w.zTrack;
    }
  }

  // Clock face (hands follow the game clock).
  function drawClock(c) {
    const g = clock.ctx, R = 236;
    g.fillStyle = '#f6f0e0'; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b2a4a'; g.lineWidth = 10; g.beginPath(); g.arc(256, 256, R, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1b2a4a'; g.font = 'bold 44px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
    ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => { const a = (i / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(n, 256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190); });
    const h = (c / 3600) % 12, m = (c / 60) % 60;
    const hand = (a, L, w) => { g.strokeStyle = '#1b2a4a'; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(a - Math.PI / 2) * L, 256 + Math.sin(a - Math.PI / 2) * L); g.stroke(); };
    hand((h / 12) * Math.PI * 2, 120, 16); hand((m / 60) * Math.PI * 2, 175, 10);
    g.fillStyle = '#c8a24a'; g.beginPath(); g.arc(256, 256, 14, 0, Math.PI * 2); g.fill();
    clock.tex.needsUpdate = true;
  }
  drawClock(0);
  api.updateBoards(6 * 3600);
  return api;
}

// ---------------- boards ----------------
function mkBoard(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { c, ctx: c.getContext('2d'), tex, mat: new THREE.MeshBasicMaterial({ map: tex }) };
}
function mkClock() { const b = mkBoard(512, 512); return b; }
function drawBoard(b, title, rows, tt, clock, dep) {
  const g = b.ctx, W = b.c.width, H = b.c.height;
  g.fillStyle = '#0a1630'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#132552'; g.fillRect(0, 0, W, 84);
  g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(title, 28, 44);
  g.textAlign = 'right'; g.fillStyle = '#f2c200'; g.fillText(fmt(clock), W - 28, 44);
  const cols = dep ? [[28, 'Heure'], [190, 'Train'], [410, 'Destination'], [W * 0.62, 'Via'], [W * 0.8, 'Voie'], [W * 0.86, 'État']] : [[28, 'Heure'], [190, 'Train'], [410, 'Provenance'], [W * 0.66, 'Voie'], [W * 0.74, 'État']];
  g.textAlign = 'left'; g.font = '28px Arial'; g.fillStyle = '#8fa8d8';
  for (const [x, t] of cols) g.fillText(t, x, 112);
  const rh = (H - 140) / Math.max(8, rows.length);
  rows.forEach((r, i) => {
    const y = 150 + i * rh + rh / 2;
    g.fillStyle = i % 2 ? '#0d1b3b' : '#0a1630'; g.fillRect(0, y - rh / 2, W, rh);
    const st = tt.status(r, clock);
    g.font = 'bold 40px "Courier New", monospace'; g.fillStyle = '#f2c200';
    g.fillText(fmt(r.time), cols[0][0], y);
    g.fillText(`TGV ${r.no}`, cols[1][0], y);
    g.font = 'bold 40px Arial'; g.fillStyle = '#ffffff';
    g.fillText(dep ? r.destination : r.origin, cols[2][0], y);
    g.font = '30px Arial'; g.fillStyle = '#b8c6e6';
    if (dep) g.fillText(r.via.join(', ').slice(0, 30), cols[3][0], y);
    g.font = 'bold 40px Arial'; g.fillStyle = '#ffffff'; g.fillText(st.code === 'cancelled' ? '—' : String(r.voie), cols[dep ? 4 : 3][0], y);
    g.font = 'bold 28px Arial'; g.fillStyle = st.color; g.fillText(st.label, cols[dep ? 5 : 4][0], y);
  });
  b.tex.needsUpdate = true;
}
function drawPid(p, tt, clock) {
  const g = p.c.getContext('2d');
  g.fillStyle = '#0a1630'; g.fillRect(0, 0, 1024, 384);
  g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(`Voies ${p.tracks.join(' · ')}`, 24, 40);
  g.textAlign = 'right'; g.fillStyle = '#f2c200'; g.fillText(fmt(clock), 1000, 40);
  const next = tt.services.filter((s) => p.tracks.includes(s.voie) && s.time + s.delay > clock - 60).slice(0, 2);
  next.forEach((s, i) => {
    const y = 130 + i * 120, st = tt.status(s, clock);
    g.textAlign = 'left'; g.fillStyle = '#f2c200'; g.font = 'bold 50px "Courier New", monospace'; g.fillText(fmt(s.time), 24, y);
    g.fillStyle = '#ffffff'; g.font = 'bold 50px Arial'; g.fillText(s.kind === 'dep' ? s.destination : `de ${s.origin}`, 210, y);
    g.font = '30px Arial'; g.fillStyle = '#b8c6e6'; g.fillText(`TGV ${s.no} · voie ${s.voie}${s.via.length ? ` · via ${s.via.join(', ')}` : ''}`, 210, y + 44);
    g.textAlign = 'right'; g.fillStyle = st.color; g.font = 'bold 32px Arial'; g.fillText(st.label.split(' · ')[0], 1000, y);
  });
  if (!next.length) { g.textAlign = 'left'; g.fillStyle = '#8fa8d8'; g.font = '40px Arial'; g.fillText('Pas de train annoncé', 24, 170); }
  p.tx.needsUpdate = true;
}
function metroSign() {
  const c = document.createElement('canvas'); c.width = 900; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 900, 200); g.strokeStyle = '#1f3c88'; g.lineWidth = 10; g.strokeRect(5, 5, 890, 190);
  g.fillStyle = '#1f3c88'; g.beginPath(); g.arc(100, 100, 70, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 100px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', 100, 106);
  [['A', '#8B1E8F', '#fff'], ['B', '#33E633', '#111'], ['C', '#00DDF5', '#16233a']].forEach(([n, bg, fg], i) => { g.fillStyle = bg; g.beginPath(); g.arc(250 + i * 150, 100, 62, 0, Math.PI * 2); g.fill(); g.fillStyle = fg; g.fillText(n, 250 + i * 150, 106); });
  g.fillStyle = '#1f3c88'; g.font = 'bold 60px Arial'; g.textAlign = 'left'; g.fillText('⬇', 720, 106);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------- travellers ----------------
/**
 * Instanced travellers (legs, body, head, luggage) with simple goal-driven behaviour: arrive from the forecourt or
 * the metro, look at the departure board, visit a shop or café, sit on a bench, meet someone, cross the footbridge
 * and wait on their platform, board when a train stands there; arrivals walk the other way. Density follows the time
 * of day (rush hours). Updated only when the viewer is near.
 */
class Crowd {
  constructor(parent, L) {
    this.L = L; this.N = 260;
    const mk = (geo, color) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), this.N); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; parent.add(m); return m; };
    this.legs = mk(new THREE.BoxGeometry(0.34, 0.85, 0.22).translate(0, 0.425, 0), 0xffffff);
    this.body = mk(new THREE.BoxGeometry(0.46, 0.68, 0.28).translate(0, 1.2, 0), 0xffffff);
    this.head = mk(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.68, 0), 0xffffff);
    this.case = mk(new THREE.BoxGeometry(0.4, 0.55, 0.24).translate(0, 0.3, 0), 0xffffff);
    const coats = [0x2b2f38, 0x5a2a20, 0x1f3c5a, 0x6b6f75, 0x8a6a4a, 0x2f4a3f, 0xa83a3a, 0xc9b8a0, 0x34404a, 0x7a4a7a], skins = [0xf1c9a5, 0xd8a47f, 0xa86b4a, 0x6b4430, 0xe8b896], trousers = [0x1d1f24, 0x2b3242, 0x4a4a4a, 0x6b5a45], cases = [0x1b2a4a, 0x8a1f2b, 0x222222, 0x6b6f75, 0xc8a24a];
    const C = new THREE.Color();
    this.a = [];
    for (let i = 0; i < this.N; i++) {
      this.body.setColorAt(i, C.setHex(coats[i % coats.length])); this.head.setColorAt(i, C.setHex(skins[(i * 7) % skins.length]));
      this.legs.setColorAt(i, C.setHex(trousers[(i * 3) % trousers.length])); this.case.setColorAt(i, C.setHex(cases[(i * 5) % cases.length]));
      this.a.push(this.spawn(i, true));
    }
    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.S = new THREE.Vector3(); this.P = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
  }
  rnd() { return Math.random(); }
  /** A plan: list of { x, y, z, wait, pose: 'stand' | 'sit' | 'hide' }. */
  spawn(i, initial) {
    const L = this.L, r = () => Math.random();
    const hall = (x, z) => ({ x, y: L.FL, z });
    const door = { x: (r() - 0.5) * 24, y: L.FL, z: L.H.z1 - 1.5 };   // just inside the entrance doors (people step through the doorway)
    const viaMetro = r() < 0.3;
    const lane = r() < 0.5 ? -2.2 : 2.2;                                      // down / up escalator of the metro well
    const metro = { x: 85, y: L.FL - 5.3, z: 125 + lane };
    const metroTop = { x: 75.4, y: L.FL + 0.2, z: 125 + lane };
    const arriving = r() < 0.4;
    const k = this.pickIsland ? this.pickIsland(arriving) : Math.floor(r() * 6), pz = L.slotZ(k);
    const stairTop = { x: L.BR.x, y: L.FL + 8.9, z: L.H.z0 - 0.1 }, stairBot = { x: L.BR.x, y: L.FL, z: L.H.z0 + 14.6 };   // along the step nosings
    const bridge = { x: L.BR.x, y: L.BR.y, z: pz }, platform = { x: L.BR.x - 30 - r() * 70, y: L.PLAT_Y - 0.45, z: pz + (r() - 0.5) * 6 };
    const escTop = { x: L.BR.x - 5, y: L.BR.y, z: pz + 1.3 }, escBot = { x: L.BR.x - 22, y: L.PLAT_Y - 0.45, z: pz + 1.3 };
    const boardSpot = hall((r() - 0.5) * 30, L.H.z0 + 10 + r() * 6);
    const plan = [];
    if (!arriving) {
      plan.push(viaMetro ? { ...metro, pose: 'hide' } : { ...door, pose: 'stand' }, viaMetro ? metroTop : { ...door, z: door.z - 4 });
      plan.push({ ...boardSpot, wait: 4 + r() * 10, look: true });
      const v = r();
      if (v < 0.3) { const d = L.doors[Math.floor(r() * L.doors.length)]; plan.push(hall(d.x, d.z), { ...hall(d.x + Math.sign(d.x) * 3, d.z), wait: 10 + r() * 30, pose: 'hide' }, hall(d.x, d.z)); }
      else if (v < 0.55 && L.benches.length) { const b = L.benches[Math.floor(r() * L.benches.length)]; plan.push({ ...hall(b.x + (r() - 0.5) * 3.5, b.z), wait: 20 + r() * 60, pose: 'sit' }); }
      else if (v < 0.7) { const m = hall((r() - 0.5) * 10, 118 + (r() - 0.5) * 30); plan.push({ ...m, wait: 15 + r() * 25 }); }
      plan.push(stairBot, stairTop, bridge, escTop, escBot, { ...platform, wait: 40 + r() * 140, platform: k }, { ...platform, pose: 'hide', board: k });
    } else {
      plan.push({ ...platform, pose: 'stand' }, escBot, escTop, bridge, stairTop, stairBot, { ...boardSpot, wait: r() * 4 }, viaMetro ? metroTop : { ...door, z: door.z - 3 }, viaMetro ? { ...metro, pose: 'hide' } : { ...door, pose: 'hide' });
    }
    // Start somewhere along the plan when the station first fills.
    const start = initial ? Math.floor(r() * (plan.length - 1)) : 0;
    const p0 = plan[start];
    return { plan, i: start + 1, x: p0.x, y: p0.y, z: p0.z, wait: 0, speed: 1.0 + r() * 0.5, phase: r() * 10, suitcase: r() < 0.45, h: 0, pose: 'stand', hidden: false, scale: 0.9 + r() * 0.2 };
  }
  update(dt, clock, trains) {
    dt = Math.min(dt, 0.1);
    const hour = (clock / 3600) % 24, rush = (hour > 7 && hour < 9.5) || (hour > 17 && hour < 19.5) ? 1 : hour < 6 || hour > 22.5 ? 0.25 : 0.65;
    const active = Math.round(this.N * rush);
    const { M, Q, S, P, up } = this;
    for (let i = 0; i < this.N; i++) {
      const a = this.a[i];
      const on = i < active;
      if (on) {
        if (a.wait > 0) a.wait -= dt;
        else {
          const tgt = a.plan[a.i];
          if (!tgt) { this.a[i] = this.spawn(i, false); continue; }
          const dx = tgt.x - a.x, dy = tgt.y - a.y, dz = tgt.z - a.z, d = Math.hypot(dx, dz);
          const step = a.speed * dt;
          if (d <= step || (d < 0.05 && Math.abs(dy) < 0.05)) {
            // Boarding: only into a train standing at this island (never the wrong train, never an empty track).
            if (tgt.board != null && this.standing && !this.standing.has(tgt.board)) { a.x = tgt.x; a.z = tgt.z; a.wait = 5; a.pose = 'stand'; a.hidden = false; continue; }
            a.x = tgt.x; a.y = tgt.y; a.z = tgt.z; a.pose = tgt.pose || 'stand'; a.hidden = a.pose === 'hide';
            a.wait = tgt.wait || 0; a.i++;
            if (tgt.board != null) a.wait = 0;
          } else {
            a.x += (dx / d) * step; a.z += (dz / d) * step; a.y += dy * Math.min(1, step / Math.max(d, 0.01)); a.h = Math.atan2(dx, dz); a.pose = 'walk'; a.hidden = false;
          }
          a.phase += dt * a.speed * 5.5;
        }
      }
      const visible = on && !a.hidden;
      const sit = a.pose === 'sit', walk = a.pose === 'walk';
      const bob = walk ? Math.abs(Math.sin(a.phase)) * 0.04 : 0;
      Q.setFromAxisAngle(up, a.h);
      S.setScalar(visible ? a.scale : 0);
      P.set(a.x, a.y + bob - (sit ? 0.42 : 0), a.z);
      M.compose(P, Q, S); this.body.setMatrixAt(i, M); this.head.setMatrixAt(i, M);
      S.set(visible ? a.scale : 0, visible ? a.scale * (sit ? 0.5 : 1) : 0, visible ? a.scale : 0); P.y = a.y + (sit ? 0.0 : 0); M.compose(P, Q, S); this.legs.setMatrixAt(i, M);
      S.setScalar(visible && a.suitcase ? 1 : 0); P.set(a.x + Math.cos(a.h) * 0.4, a.y, a.z - Math.sin(a.h) * 0.4); M.compose(P, Q, S); this.case.setMatrixAt(i, M);
    }
    for (const m of [this.legs, this.body, this.head, this.case]) m.instanceMatrix.needsUpdate = true;
  }
  dispose() { for (const m of [this.legs, this.body, this.head, this.case]) m.parent?.remove(m); }
}
