// Airport complex modelled on the surface above an underground station (Aéroport Est):
// two parallel runways with full markings and lights, parallel/connecting taxiways, apron with
// stand markings, curved-roof terminal with three piers and jet bridges, parked airliners
// (narrow- and wide-body, several fictional airlines), control tower, hangars, cargo terminal,
// fuel farm, fire station, multi-storey car parks, hotel, forecourt roads and ground vehicles.
// Local frame: origin at the station's surface point, +x along the line (direction A), +z landside.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cityTextures, boxGeo } from './City.js';
import { Textures } from './Textures.js';
import { seededRandom } from '../core/util.js';

function ctex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const rnd = seededRandom(2024);
const speckle = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${a * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } };

let TX;
function tex() {
  if (TX) return TX;
  TX = {
    grass: ctex(256, 256, (g) => { g.fillStyle = '#6b8a46'; g.fillRect(0, 0, 256, 256); speckle(g, 256, 256, 9000, 0.12); }),
    concrete: ctex(256, 256, (g) => {
      g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, 256, 256); speckle(g, 256, 256, 6000, 0.06);
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    }),
    // Runway: 45 m wide (u across), 60 m per tile (v along): edge lines + centreline dash.
    runway: ctex(256, 512, (g) => {
      g.fillStyle = '#34363a'; g.fillRect(0, 0, 256, 512); speckle(g, 256, 512, 9000, 0.05);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(100, 0, 56, 512); // rubber deposits
      g.fillStyle = '#ecebe6'; g.fillRect(6, 0, 5, 512); g.fillRect(245, 0, 5, 512);
      g.fillRect(126, 0, 4, 256);
    }),
    taxiway: ctex(128, 256, (g) => {
      g.fillStyle = '#3d3f43'; g.fillRect(0, 0, 128, 256); speckle(g, 128, 256, 3000, 0.05);
      g.fillStyle = '#e8c21a'; g.fillRect(62, 0, 4, 256); g.fillRect(2, 0, 3, 256); g.fillRect(123, 0, 3, 256);
    }),
    road: ctex(128, 256, (g) => {
      g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, 128, 256); speckle(g, 128, 256, 2000, 0.05);
      g.fillStyle = '#eeeae0'; for (let y = 0; y < 256; y += 64) { g.fillRect(41, y, 3, 32); g.fillRect(84, y, 3, 32); } g.fillRect(3, 0, 3, 256); g.fillRect(122, 0, 3, 256);
    }),
    roof: ctex(256, 256, (g) => { g.fillStyle = '#cfd4d8'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(80,90,100,0.35)'; for (let i = 0; i < 256; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); } }),
    hangarDoor: ctex(256, 128, (g) => { g.fillStyle = '#9aa4ad'; g.fillRect(0, 0, 256, 128); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 256; i += 16) g.fillRect(i, 0, 2, 128); g.fillStyle = '#d23b2f'; g.fillRect(0, 118, 256, 10); }),
  };
  return TX;
}

/** Runway designator from a magnetic-ish heading in degrees. */
const designator = (deg) => String(((Math.round((((deg % 360) + 360) % 360) / 10) + 35) % 36) + 1).padStart(2, '0');

function runwayEndTexture(num, suffix) {
  return ctex(512, 1024, (g) => {
    g.fillStyle = '#34363a'; g.fillRect(0, 0, 512, 1024); speckle(g, 512, 1024, 12000, 0.05);
    g.fillStyle = '#ecebe6';
    g.fillRect(12, 0, 10, 1024); g.fillRect(490, 0, 10, 1024);
    // threshold "piano keys"
    for (let k = 0; k < 16; k++) { if (k === 7 || k === 8) continue; g.fillRect(28 + k * 29, 940, 18, 70); }
    // designator (reads from the approach, i.e. bottom of the texture)
    g.save(); g.translate(256, 760); g.rotate(Math.PI); g.font = 'bold 150px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(num, 0, 0); if (suffix) { g.font = 'bold 110px Arial'; g.fillText(suffix, 0, 140); } g.restore();
    // touchdown zone & aiming point
    for (const y of [420, 300]) { g.fillRect(150, y, 24, 70); g.fillRect(186, y, 24, 70); g.fillRect(302, y, 24, 70); g.fillRect(338, y, 24, 70); }
    g.fillRect(140, 60, 60, 160); g.fillRect(312, 60, 60, 160);
    g.fillRect(253, 0, 6, 240);
  }, false);
}

class Kit {
  constructor(group) { this.g = group; }
  mesh(geo, mat, x, y, z, ry = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; this.g.add(m); return m; }
  box(w, h, d, mat, x, y, z, ry = 0) { return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry); }
  /** Flat textured strip; tile = metres per texture repeat along the long axis. */
  strip(w, len, mat, x, z, y, ry = 0, tileAcross = w, tileAlong = len) {
    const geo = new THREE.PlaneGeometry(w, len); geo.rotateX(-Math.PI / 2);
    const u = geo.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (w / tileAcross), u.getY(i) * (len / tileAlong));
    return this.mesh(geo, mat, x, y, z, ry);
  }
}

/** Mirrors a geometry across z and restores correct (counter-clockwise) triangle winding. */
function mirrorZ(geo) {
  geo.scale(1, 1, -1);
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array, n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) for (let c = 0; c < n; c++) { const i1 = (t + 1) * n + c, i2 = (t + 2) * n + c; const tmp = a[i1]; a[i1] = a[i2]; a[i2] = tmp; }
  }
  return g;
}

/** Generic airliner, nose towards +x, origin on the ground under the wing root. */
function aircraftGeometry(kind) {
  const W = kind === 'wide';
  const L = W ? 63 : 38, R = W ? 2.9 : 1.95, span = W ? 60 : 34, gear = W ? 2.9 : 2.0;
  const col = (geo, c) => { const n = geo.attributes.position.count; const a = new Float32Array(n * 3); const cc = new THREE.Color(c); for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo.index ? geo.toNonIndexed() : geo; };
  const parts = [];
  const cy = gear + R; // fuselage centre height
  const fus = new THREE.CylinderGeometry(R, R, L * 0.72, 20, 1, true); fus.rotateZ(Math.PI / 2); fus.translate(L * 0.04, cy, 0); parts.push(col(fus, 0xf4f5f7));
  const nose = new THREE.SphereGeometry(R, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); nose.scale(1, 1.0, 1); nose.rotateZ(-Math.PI / 2); nose.scale(2.1, 1, 1); nose.translate(L * 0.4, cy, 0); parts.push(col(nose, 0xf4f5f7));
  const tail = new THREE.CylinderGeometry(R, R * 0.25, L * 0.22, 20, 1, true); tail.rotateZ(Math.PI / 2); tail.translate(-L * 0.43, cy + R * 0.35, 0); parts.push(col(tail, 0xf4f5f7));
  const belly = new THREE.BoxGeometry(L * 0.5, R * 0.5, R * 1.6); belly.translate(-L * 0.02, cy - R * 0.72, 0); parts.push(col(belly, 0xc9ccd1));
  const cockpit = new THREE.BoxGeometry(R * 0.9, R * 0.35, R * 1.3); cockpit.translate(L * 0.44, cy + R * 0.45, 0); parts.push(col(cockpit, 0x1b2229));
  const windows = new THREE.BoxGeometry(L * 0.62, R * 0.16, R * 2.02); windows.translate(L * 0.03, cy + R * 0.3, 0); parts.push(col(windows, 0x2a3138));
  // Wings (swept trapezoid planform), stabilisers.
  const wingShape = (root, tip, half, sweep) => new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-sweep, half), new THREE.Vector2(-sweep - tip, half), new THREE.Vector2(-root, 0)]);
  for (const s of [-1, 1]) {
    let wing = new THREE.ExtrudeGeometry(wingShape(W ? 11 : 6.5, W ? 2.6 : 1.6, span / 2, W ? 14 : 8), { depth: W ? 0.7 : 0.45, bevelEnabled: false });
    wing.rotateX(Math.PI / 2); if (s < 0) wing = mirrorZ(wing);
    wing.translate(L * 0.08, cy - R * 0.55, 0); parts.push(col(wing, 0xe7e9ec));
    let hs = new THREE.ExtrudeGeometry(wingShape(W ? 6 : 3.6, W ? 1.6 : 1.0, span * 0.18, W ? 5 : 3), { depth: 0.3, bevelEnabled: false });
    hs.rotateX(Math.PI / 2); if (s < 0) hs = mirrorZ(hs);
    hs.translate(-L * 0.4, cy + R * 0.4, 0); parts.push(col(hs, 0xe7e9ec));
    // Engines under the wings.
    const nEng = W && kind === 'wide' ? 1 : 1;
    for (let e = 0; e < nEng; e++) {
      const er = W ? 1.6 : 1.0, ez = s * span * (W ? 0.17 : 0.18);
      const eng = new THREE.CylinderGeometry(er, er * 0.85, W ? 6 : 4.2, 16); eng.rotateZ(Math.PI / 2);
      eng.translate(L * 0.1 + (W ? 3.5 : 2.4), cy - R * 0.55 - er * 0.9, ez); parts.push(col(eng, 0x8d939b));
      const intake = new THREE.CircleGeometry(er * 0.85, 16); intake.rotateY(Math.PI / 2); intake.translate(L * 0.1 + (W ? 6.5 : 4.5), cy - R * 0.55 - er * 0.9, ez); parts.push(col(intake, 0x22272c));
      const pylon = new THREE.BoxGeometry(W ? 4 : 2.6, er * 0.8, 0.4); pylon.translate(L * 0.1 + 1.5, cy - R * 0.55 - er * 0.3, ez); parts.push(col(pylon, 0xd0d3d7));
    }
    const mg = new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10); mg.rotateX(Math.PI / 2); mg.translate(L * 0.0, 0.55, s * R * 0.9); parts.push(col(mg, 0x1a1a1a));
    const leg = new THREE.CylinderGeometry(0.15, 0.15, gear, 6); leg.translate(L * 0.0, gear / 2 + 0.3, s * R * 0.9); parts.push(col(leg, 0x9aa0a6));
  }
  const ng = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 10); ng.rotateX(Math.PI / 2); ng.translate(L * 0.36, 0.45, 0); parts.push(col(ng, 0x1a1a1a));
  const nleg = new THREE.CylinderGeometry(0.12, 0.12, gear + 0.2, 6); nleg.translate(L * 0.36, gear / 2 + 0.3, 0); parts.push(col(nleg, 0x9aa0a6));
  const body = mergeGeometries(parts);
  // Fin (separate, painted in the airline colour).
  const fin = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-(W ? 6 : 4), W ? 11 : 7), new THREE.Vector2(-(W ? 10 : 6.6), W ? 11 : 7), new THREE.Vector2(-(W ? 11 : 7), 0)]), { depth: 0.4, bevelEnabled: false });
  fin.translate(-L * 0.36, cy + R * 0.6, -0.2);
  return { body, fin, L, span, door: [L * 0.3, cy + R * 0.1, R] };
}

export function buildAirport(parent, f, line, geom, stationIndex, opts = {}) {
  const landside = opts.landside !== false;
  const T = tex(), ct = cityTextures();
  const grp = new THREE.Group(); grp.position.set(f.x, f.y, f.z); grp.rotation.y = f.yaw; grp.name = 'airport';
  parent.add(grp);
  const k = new Kit(grp);
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const M = {
    grass: lam({ map: T.grass }), concrete: lam({ map: T.concrete, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    runway: lam({ map: T.runway, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    taxiway: lam({ map: T.taxiway, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    road: lam({ map: T.road, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    glass: new THREE.MeshStandardMaterial({ map: ct.curtain, vertexColors: true, metalness: 0.55, roughness: 0.2 }),
    roof: new THREE.MeshStandardMaterial({ map: T.roof, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }),
    white: lam({ color: 0xeceff2 }), grey: lam({ color: 0x8d949b }), dark: lam({ color: 0x2a2e33 }), red: lam({ color: 0xc8352a }),
    yellow: new THREE.MeshBasicMaterial({ color: 0xe8c21a }), whiteLine: new THREE.MeshBasicMaterial({ color: 0xecebe6 }),
    towerGlass: new THREE.MeshStandardMaterial({ color: 0x5f8f7f, metalness: 0.7, roughness: 0.1, transparent: true, opacity: 0.8 }),
    plane: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.45, side: THREE.DoubleSide }), // mirrored wings
    office: lam({ map: ct.facades[3], vertexColors: true }), garage: lam({ map: ct.facades[3], vertexColors: true }),
    lightW: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), lightB: new THREE.MeshBasicMaterial({ color: 0x3a6cff }), lightR: new THREE.MeshBasicMaterial({ color: 0xff3a2a }),
    hangarDoor: lam({ map: T.hangarDoor }), tank: lam({ color: 0xf0f0ea }),
  };
  const Y = 0.04;
  // ---- Airfield ground ----
  if (landside) k.strip(5600, 3400, M.grass, 0, -1250, 0, 0, 60, 60); else k.strip(5600, 2960, M.grass, 0, -1480, 0, 0, 60, 60);
  // ---- Runways (along local x) ----
  const hdg = geom ? (geom.heading(geom.stationS[stationIndex]) * 180) / Math.PI : opts.heading ?? 90; // runways run along the line
  const dA = designator(hdg), dB = designator(hdg + 180);
  const runways = [{ z: -980, len: 3400, s: ['L', 'R'] }, { z: -1480, len: 3000, s: ['R', 'L'], x: 300 }];
  for (const rw of runways) {
    const x0 = rw.x || 0;
    k.strip(45, rw.len - 360, M.runway, x0, rw.z, Y, Math.PI / 2, 45, 60);
    for (const [end, num, suf] of [[1, dB, rw.s[1]], [-1, dA, rw.s[0]]]) {
      const m = lam({ map: runwayEndTexture(num, suf), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const e = k.strip(45, 180, m, x0 + end * (rw.len / 2 - 90), rw.z, Y, end > 0 ? -Math.PI / 2 : Math.PI / 2);
      void e;
      // approach lights beyond the threshold
      for (let i = 1; i <= 10; i++) for (let j = -2; j <= 2; j++) k.box(1.2, 0.4, 0.4, M.lightW, x0 + end * (rw.len / 2 + i * 30), 0.3, rw.z + j * 4);
    }
    // edge lights
    const n = Math.floor(rw.len / 60) * 2, edge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), M.lightW, n);
    const m4 = new THREE.Matrix4(); let i = 0;
    for (let x = -rw.len / 2; x <= rw.len / 2 - 1 && i < n; x += 60) for (const s of [-1, 1]) { m4.makeTranslation(x0 + x, 0.2, rw.z + s * 24); edge.setMatrixAt(i++, m4); }
    edge.count = i; edge.computeBoundingSphere(); grp.add(edge);
    // runway shoulders
    for (const s of [-1, 1]) k.strip(8, rw.len, M.concrete, x0, rw.z + s * 26.5, Y * 0.5, Math.PI / 2, 8, 40);
  }
  // ---- Taxiways: parallel taxiways + connectors ----
  k.strip(23, 3600, M.taxiway, 0, -700, Y, Math.PI / 2, 23, 50);
  k.strip(23, 3200, M.taxiway, 150, -1230, Y, Math.PI / 2, 23, 50);
  for (const x of [-1650, -1000, -400, 200, 800, 1400, 1650]) {
    k.strip(23, 280, M.taxiway, x, -840, Y + 0.005, 0, 23, 50);
    k.strip(23, 500, M.taxiway, x + 100, -1230, Y + 0.006, 0, 23, 50);
  }
  const blue = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), M.lightB, 240), m4 = new THREE.Matrix4();
  let bi = 0; for (let x = -1800; x <= 1800 && bi < 240; x += 30) for (const s of [-1, 1]) { m4.makeTranslation(x, 0.2, -700 + s * 13); blue.setMatrixAt(bi++, m4); }
  blue.count = bi; blue.computeBoundingSphere(); grp.add(blue);
  // ---- Apron with stands ----
  k.strip(760, 520, M.concrete, 0, -345, Y * 0.6, 0, 30, 30);
  k.strip(1100, 200, M.concrete, 900, -520, Y * 0.6, 0, 30, 30); // cargo/maintenance apron
  // ---- Terminal ----
  const TZ = -40;
  k.mesh(boxGeo(540, 18, 110, 0, 0, 0, 0, 4, 0.6), M.glass, 0, 9, TZ);
  // Wave roof: shallow arch along x with a landside overhang.
  const arch = new THREE.Shape(); const R = 140, span = 140, rise = 12;
  arch.moveTo(-span / 2, 0); arch.quadraticCurveTo(0, rise * 2, span / 2, 0); arch.lineTo(span / 2, -1.2); arch.quadraticCurveTo(0, rise * 2 - 1.2, -span / 2, -1.2); arch.closePath();
  void R;
  const roof = new THREE.ExtrudeGeometry(arch, { depth: 560, bevelEnabled: false, curveSegments: 24 });
  roof.translate(0, 0, -280); roof.rotateY(Math.PI / 2);
  k.mesh(roof, M.roof, 0, 18.2, TZ + 8);
  for (let x = -260; x <= 260; x += 26) for (const z of [TZ + 72, TZ - 58]) k.box(1.2, 18, 1.2, M.white, x, 9, z); // façade columns supporting the overhang
  k.plane = (w, h, mat, x, y, z, ry = 0) => k.mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z, ry);
  k.plane(180, 12, new THREE.MeshBasicMaterial({ map: Textures.label('AÉROPORT DE GRANDVILLE', { w: 2048, h: 136, bg: '#1d2a3a', fg: '#ffffff', font: 'bold 104px Arial' }) }), 0, 24, TZ + 72.2);
  // Piers (concourses) with gates and jet bridges.
  const piers = [-210, 0, 210];
  const stands = [];
  for (const px of piers) {
    k.mesh(boxGeo(34, 14, 380, 0, 0, 0, 0, 4, 0.6), M.glass, px, 7, TZ - 55 - 190);
    k.box(36, 1.2, 382, M.roof, px, 14.6, TZ - 55 - 190);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) stands.push({ x: px + s * 17, z: TZ - 110 - i * 68, side: s, wide: i < 2 && px === 0 });
  }
  const types = { narrow: aircraftGeometry('narrow'), wide: aircraftGeometry('wide') };
  const airlines = [0x1f4fa0, 0xc8352a, 0x2f8a4a, 0xe07b14, 0x5a2a8a, 0x0f8a8a, 0x222222];
  const finMats = airlines.map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }));
  stands.forEach((st, i) => {
    if (rnd() < 0.18) return; // a few empty stands
    const t = st.wide ? types.wide : types.narrow;
    const yaw = st.side > 0 ? Math.PI : 0; // nose-in: nose (local +x) points back towards the pier
    const ax = st.x + st.side * (t.L * 0.42 + 4);
    const body = k.mesh(t.body, M.plane, ax, 0, st.z, yaw);
    const fin = new THREE.Mesh(t.fin, finMats[i % finMats.length]); body.add(fin);
    // Jet bridge from the pier to the forward door.
    const doorX = ax + Math.cos(yaw) * t.door[0], doorZ = st.z + st.side * (t.door[2] + 1.5);
    const len = Math.abs(doorX - st.x);
    k.box(len, 3, 3.2, M.grey, (doorX + st.x) / 2, t.door[1] + 0.3, doorZ);
    k.box(0.5, t.door[1], 0.5, M.dark, doorX - st.side * 3, t.door[1] / 2, doorZ);
    // Lead-in line and ground vehicles.
    k.strip(0.3, t.L + 20, M.yellow, ax, st.z, Y + 0.01, Math.PI / 2, 1, 1);
    k.box(3, 1.8, 2, [M.white, M.red, M.yellow][i % 3], ax - st.side * 6, 0.9, st.z + 8);
  });
  // A wide-body waiting at a remote stand and one lined up on the runway.
  const remote = k.mesh(types.wide.body, M.plane, 600, 0, -560, -Math.PI / 2); remote.add(new THREE.Mesh(types.wide.fin, finMats[3]));
  const lined = k.mesh(types.narrow.body, M.plane, -1500, 0, -980, 0); lined.add(new THREE.Mesh(types.narrow.fin, finMats[0]));
  // ---- Control tower ----
  const tx = 430, tz = -330;
  k.mesh(new THREE.CylinderGeometry(4.5, 6, 68, 20), M.white, tx, 34, tz);
  k.mesh(new THREE.CylinderGeometry(10, 7, 3, 8), M.white, tx, 69.5, tz);
  k.mesh(new THREE.CylinderGeometry(10.5, 9.5, 6, 8, 1, true), M.towerGlass, tx, 74, tz);
  k.mesh(new THREE.CylinderGeometry(11.5, 10.5, 1.4, 8), M.dark, tx, 77.7, tz);
  k.mesh(new THREE.CylinderGeometry(0.3, 0.4, 14, 6), M.grey, tx, 85, tz);
  k.mesh(new THREE.SphereGeometry(2.2, 14, 10), M.white, tx + 5, 80.5, tz);
  k.box(30, 10, 22, M.office, tx, 5, tz + 22);
  // ---- Hangars ----
  for (let i = 0; i < 3; i++) {
    const hx = -820 + i * 120, hz = -470;
    k.mesh(boxGeo(100, 24, 80, 0, 0, 0, 0, 4, 0.6), M.office, hx, 12, hz);
    const barrel = new THREE.CylinderGeometry(50, 50, 80, 24, 1, true, -Math.PI / 2, Math.PI); barrel.rotateX(Math.PI / 2); barrel.scale(1, 0.24, 1);
    k.mesh(barrel, M.roof, hx, 24, hz);
    k.plane(96, 22, M.hangarDoor, hx, 11.5, hz - 40.05, Math.PI);
  }
  // ---- Cargo terminal, fuel farm, fire station ----
  k.mesh(boxGeo(220, 18, 80, 0, 0, 0, 0, 4, 0.6), M.garage, 950, 9, -400);
  k.plane(60, 6, new THREE.MeshBasicMaterial({ map: Textures.label('CARGO', { w: 512, h: 96, bg: '#2a2e33', fg: '#e8c21a', font: 'bold 70px Arial' }) }), 950, 14, -360.05);
  for (let i = 0; i < 6; i++) k.mesh(new THREE.CylinderGeometry(11, 11, 14, 28), M.tank, 1250 + (i % 3) * 30, 7, -120 - Math.floor(i / 3) * 30);
  k.box(50, 10, 30, M.white, -400, 5, -1120); k.box(46, 7, 0.3, M.red, -400, 3.5, -1104.8);
  // Windsocks.
  for (const [x, z] of [[-1500, -1120], [1500, -1120]]) { k.mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 6), M.grey, x, 4, z); const sock = k.mesh(new THREE.ConeGeometry(0.7, 4, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }), x + 2, 7.6, z); sock.rotation.z = Math.PI / 2; }
  // ---- Landside: forecourt roads, car parks, hotel, station entrance ----
  if (landside) {
  k.strip(14, 620, M.road, 0, TZ + 82, Y, Math.PI / 2, 14, 30);     // departures kerb
  k.strip(14, 700, M.road, 0, TZ + 112, Y, Math.PI / 2, 14, 30);    // arrivals / through road
  k.strip(14, 900, M.road, -380, TZ + 520, Y, 0, 14, 30);            // access road
  k.strip(14, 900, M.road, 380, TZ + 520, Y, 0, 14, 30);
  k.strip(780, 14, M.road, 0, TZ + 960, Y, 0, 30, 14);
  }
  for (const sx of [-1, 1]) {
    const gx = sx * 170, gz = TZ + 190;
    k.mesh(boxGeo(220, 16, 90, 0, 0, 0, 0, 3.5, 0.55), M.garage, gx, 8, gz);
    k.plane(40, 4, new THREE.MeshBasicMaterial({ map: Textures.label(`P${sx < 0 ? 1 : 2}`, { w: 256, h: 64, bg: '#1f4fa0', fg: '#ffffff', font: 'bold 54px Arial' }) }), gx, 13, gz + 45.05);
  }
  k.mesh(boxGeo(70, 64, 24, 0, 0, 0, 0, 4, 0.5), M.glass, 0, 32, TZ + 300);
  k.plane(40, 5, new THREE.MeshBasicMaterial({ map: Textures.label('HÔTEL AÉROPORT', { w: 1024, h: 128, bg: '#20303f', fg: '#ffffff', font: 'bold 80px Arial' }) }), 0, 60, TZ + 312.05);
  const mBadge = new THREE.MeshBasicMaterial({ map: Textures.label('M', { w: 128, h: 128, bg: '#ffffff', fg: '#1f3c88', font: 'bold 96px Arial', border: '#1f3c88', radius: 64 }), transparent: true });
  const lb = line && new THREE.MeshBasicMaterial({ map: Textures.label(line.number, { w: 128, h: 128, bg: line.color, fg: line.textColor, font: 'bold 80px Arial', radius: 64 }), transparent: true });
  if (line) { k.box(0.3, 5, 0.3, M.dark, 40, 2.5, TZ + 74); k.plane(2, 2, mBadge, 40, 5.5, TZ + 74.2); k.plane(1.4, 1.4, lb, 40, 3.8, TZ + 74.2); }
  // Apron floodlight masts.
  for (const x of [-330, -110, 110, 330]) { k.mesh(new THREE.CylinderGeometry(0.4, 0.6, 30, 8), M.grey, x, 15, -560); k.box(6, 1, 2, M.lightW, x, 30, -560); }
  // Merge the many static meshes per material to keep draw calls low.
  const buckets = new Map();
  for (const o of [...grp.children]) {
    if (!o.isMesh || o.isInstancedMesh || o.children.length) continue;
    o.updateMatrix();
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
    const key = `${o.material.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
    buckets.get(key).geos.push(geo); grp.remove(o);
  }
  for (const { mat, geos } of buckets.values()) { const g2 = mergeGeometries(geos); if (g2) grp.add(new THREE.Mesh(g2, mat)); }
  return { x: f.x, z: f.z, radius: 2000, group: grp, people: { group: new THREE.Group() }, hidden: true, update() {} };
}
