// Destination cities of the main-line network. Each one is built around its station (in the station's frame:
// +x along the track, +z to the right) with its own identity: building styles, colours, density, skyline and
// landmarks — a cathedral town (Montreval), a white seaside town with a harbour and lighthouse (Valdor), brick
// factories, chimneys and an opera house (Clairmont), chalets, a spired church and a cable car under snowy peaks
// (Saint-Roch-les-Alpes), a big river city with bridges and towers (Belle-Rive), ochre houses, palms, a marina and
// high-rises on the bay (Port-Azur). Every town also gets a proper passenger building, a forecourt and lighting.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signTexture } from './StationTextures.js';

const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export const STYLES = {
  regional: { walls: [0xe8dcc4, 0xdccfb4, 0xf0e6d2, 0xd8c39c], roofs: [0xa4553a, 0x9b4a35, 0x8a3f2e], roof: 'hip', floors: [2, 5], radius: 1500, density: 0.75, towers: 0, station: 0xe8dcc4, accent: '#8B1E2B' },
  coastal: { walls: [0xf6f4ee, 0xeef2f5, 0xe8eef0, 0xf2ead8], roofs: [0x3d4a5a, 0x5a6878, 0xa4553a], roof: 'gable', floors: [2, 4], radius: 1200, density: 0.7, towers: 0, station: 0xf4f2ec, accent: '#1d4fa0' },
  industrial: { walls: [0x9b5a42, 0x8a4f3a, 0xa86a50, 0x7a6a5a, 0xb0a89a], roofs: [0x3a3d42, 0x4a4d52], roof: 'saw', floors: [3, 8], radius: 1700, density: 0.8, towers: 6, station: 0xa86a50, accent: '#3a3d42' },
  alpine: { walls: [0xf2ece0, 0x8a5a3a, 0xe8e0d0, 0x7a4a2a], roofs: [0x4a3a30, 0x5a4a3a, 0x3a3a3a], roof: 'gable', floors: [2, 4], radius: 900, density: 0.55, towers: 0, station: 0x8a5a3a, accent: '#2f4a3f' },
  western: { walls: [0xe6dfd2, 0xcfc8bc, 0xd8d0c0, 0xb8c0c8, 0x9aa6b2], roofs: [0x5a6068, 0x4a5058, 0x9b4a35], roof: 'mansard', floors: [4, 8], radius: 2200, density: 0.9, towers: 14, station: 0xe6dfd2, accent: '#1b2a4a' },
  southern: { walls: [0xe8b878, 0xf0c890, 0xe0a868, 0xf4dcb0, 0xd89a68, 0xf6f0e4], roofs: [0xc0603a, 0xb0563a, 0xd07048], roof: 'hip', floors: [3, 7], radius: 2000, density: 0.85, towers: 18, station: 0xf0c890, accent: '#c0603a' },
};

export function buildDestinationCity(parent, { line, geom, index, terrain, identity }) {
  const st = line.stations[index], S = STYLES[identity] || STYLES.regional;
  const s0 = geom.stationS[index], c = geom.point(s0), hd = geom.heading(s0);
  const root = new THREE.Group(); root.name = `city-${identity}`;
  root.position.set(c.x, 0, c.z); root.rotation.y = -hd + Math.PI / 2;   // local +x along the track
  parent.add(root);
  const ground = (lx, lz) => { const cs = Math.cos(-hd + Math.PI / 2), sn = Math.sin(-hd + Math.PI / 2); return terrain.height(c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs); };
  const rnd = (i) => hash(index * 7919 + i, identity.length * 31);
  const Y = c.y;                                       // rail level
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const M = {
    wall: lam({ vertexColors: false, color: 0xffffff }), roof: lam({ color: 0xffffff }), win: new THREE.MeshBasicMaterial({ color: 0x2a3440 }),
    stone: lam({ color: 0xd8ccb0 }), dark: lam({ color: 0x3a3d42 }), glass: new THREE.MeshStandardMaterial({ color: 0x8fb3c8, metalness: 0.6, roughness: 0.15 }),
    road: lam({ color: 0x45474b }), green: lam({ color: 0x4f7d36 }), leaves: lam({ color: 0x3f6a2c }), palm: lam({ color: 0x4f8a3a }), trunk: lam({ color: 0x6a4a30 }),
    white: lam({ color: 0xf6f4ee }), red: lam({ color: 0xc8352a }), snow: lam({ color: 0xf4f6f8 }), water: new THREE.MeshStandardMaterial({ color: 0x2a6f98, metalness: 0.3, roughness: 0.12 }),
    copper: lam({ color: 0x5f9c86 }), lamp: new THREE.MeshBasicMaterial({ color: 0xfff1cf }), brick: lam({ color: 0x8a4f3a }), steel: new THREE.MeshStandardMaterial({ color: 0x6b7480, metalness: 0.6, roughness: 0.4 }),
  };
  const parts = new Map(); const put = (mat, g) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(g.index ? g.toNonIndexed() : g); };
  const box = (mat, w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); put(mat, g); };
  const cyl = (mat, r0, r1, h, x, y, z, seg = 12) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y, z); put(mat, g); };
  const cone = (mat, r, h, x, y, z, seg = 4, ry = Math.PI / 4) => { const g = new THREE.ConeGeometry(r, h, seg); g.rotateY(ry); g.translate(x, y, z); put(mat, g); };

  // ---------- Passenger building, forecourt, name boards ----------
  const SB = { z: 26, w: 70, d: 18 };
  const stMat = lam({ color: S.station });
  box(stMat, SB.w, 9, SB.d, 0, Y + 4.5, SB.z);
  box(M.stone, SB.w + 2, 0.8, SB.d + 2, 0, Y + 9.2, SB.z);
  if (identity === 'alpine' || identity === 'regional') { const g = new THREE.CylinderGeometry(0.01, SB.d * 0.75, 7, 4, 1); g.rotateY(Math.PI / 4); g.scale(SB.w / SB.d, 1, 1); g.translate(0, Y + 13, SB.z); put(lam({ color: S.roofs[0] }), g); }
  else if (identity === 'western' || identity === 'southern') { box(M.glass, SB.w * 0.5, 6, SB.d * 0.9, 0, Y + 12.5, SB.z); }
  else box(lam({ color: S.roofs[0] }), SB.w, 1.2, SB.d, 0, Y + 10.2, SB.z);
  for (let i = -4; i <= 4; i++) box(M.win, 3.6, 4.2, 0.2, i * 7.2, Y + 4, SB.z + SB.d / 2 + 0.05);
  box(lam({ color: 0x6b4a30 }), 6, 5, 0.3, 0, Y + 2.5, SB.z + SB.d / 2 + 0.1);
  { const t = signTexture(st.name, { w: 1536, h: 160, bg: S.accent, fg: '#ffffff', font: 'bold 110px Georgia' }); const m = new THREE.Mesh(new THREE.PlaneGeometry(36, 3.6), new THREE.MeshBasicMaterial({ map: t })); m.position.set(0, Y + 7.4, SB.z + SB.d / 2 + 0.25); root.add(m); }
  // Clock tower on the station.
  box(stMat, 6, 20, 6, -SB.w / 2 + 4, Y + 10, SB.z); cone(lam({ color: S.roofs[0] }), 5, 5, -SB.w / 2 + 4, Y + 22.5, SB.z);
  { const cc = document.createElement('canvas'); cc.width = cc.height = 128; const g = cc.getContext('2d'); g.fillStyle = '#f6f0e0'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 20); g.moveTo(64, 64); g.lineTo(94, 64); g.stroke(); const m = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cc) })); m.position.set(-SB.w / 2 + 4, Y + 17, SB.z + 3.05); root.add(m); }
  // Forecourt with trees, lamps and a bus/taxi bay.
  box(lam({ color: 0xb8b0a0 }), 120, 0.3, 40, 0, Y - 0.45, SB.z + 30);
  for (let i = -5; i <= 5; i++) { cyl(M.trunk, 0.2, 0.3, 3, i * 10, Y + 1.2, SB.z + 46); if (identity === 'southern' || identity === 'coastal') { for (let f = 0; f < 6; f++) { const g = new THREE.BoxGeometry(0.4, 0.1, 3.2); g.translate(0, 0, 1.5); g.rotateX(-0.4); g.rotateY((f / 6) * Math.PI * 2); g.translate(i * 10, Y + 6.8, SB.z + 46); put(M.palm, g); } cyl(M.trunk, 0.18, 0.25, 4, i * 10, Y + 4.6, SB.z + 46, 6); } else { const g = new THREE.IcosahedronGeometry(2.6, 0); g.translate(i * 10, Y + 4.6, SB.z + 46); put(M.leaves, g); } }
  for (let i = -6; i <= 6; i += 2) { cyl(M.dark, 0.08, 0.1, 4.5, i * 8, Y + 1.8, SB.z + 14); const l = new THREE.SphereGeometry(0.3, 8, 6); l.translate(i * 8, Y + 4.2, SB.z + 14); put(M.lamp, l); }

  // ---------- Platform canopy over the island (steel columns on the platform axis, glazed butterfly roof) ----------
  {
    const PT = Y + 0.95, H = 5.6, L = 220, accent = lam({ color: new THREE.Color(S.accent).getHex() });
    for (let x = -L / 2; x <= L / 2; x += 15) {
      cyl(M.steel, 0.16, 0.2, H, x, PT + H / 2, 0, 10);
      cyl(M.steel, 0.32, 0.32, 0.12, x, PT + 0.06, 0, 12);                    // base plate on the platform
      for (const sd of [-1, 1]) { const arm = new THREE.BoxGeometry(0.14, 0.14, 4.6); arm.rotateX(sd * 0.12); arm.translate(x, PT + H + 0.25, sd * 2.2); put(M.steel, arm); }
    }
    for (const sd of [-1, 1]) {
      const roof = new THREE.BoxGeometry(L + 4, 0.1, 4.9); roof.rotateX(sd * 0.12); roof.translate(0, PT + H + 0.36, sd * 2.35); put(M.glass, roof);
      box(accent, L + 4, 0.35, 0.12, 0, PT + H + 0.62, sd * 4.85);              // fascia in the town colour
    }
    box(M.steel, L + 4, 0.3, 0.3, 0, PT + H, 0);
    for (let x = -L / 2 + 7.5; x < L / 2; x += 15) { const l = new THREE.BoxGeometry(1.2, 0.08, 0.3); l.translate(x, PT + H - 0.2, 1.2); put(M.lamp, l); const l2 = l.clone(); l2.translate(0, 0, -2.4); put(M.lamp, l2); }
  }

  // ---------- Town fabric: a street grid filled with instanced houses / blocks ----------
  const R = S.radius, cell = identity === 'western' || identity === 'southern' ? 70 : 48;
  const houses = [], towers = [];
  const riverAt = identity === 'regional' ? { z: -420, w: 90 } : identity === 'western' ? { z: 420, w: 220 } : null;
  const occupied = (x, z) => Math.abs(z) < 34 && Math.abs(x) < 700 || (z > 0 && z < 80 && Math.abs(x) < 70)     // track corridor, station
    || (riverAt && Math.abs(z - riverAt.z) < riverAt.w / 2 + 18) || (identity === 'industrial' && Math.abs(x + 1100) < 40)
    || (identity === 'regional' && Math.abs(x - 260) < 70 && Math.abs(z - 320) < 55) || (identity === 'industrial' && Math.abs(x - 220) < 50 && Math.abs(z - 360) < 45)
    || (identity === 'alpine' && Math.abs(x + 190) < 30 && Math.abs(z - 220) < 20) || (identity === 'western' && Math.abs(x + 500) < 50 && Math.abs(z - 520) < 20);
  let i = 0;
  for (let gx = -R; gx <= R; gx += cell) for (let gz = -R; gz <= R; gz += cell) {
    i++;
    const d = Math.hypot(gx, gz) / R; if (d > 1) continue;
    if (Math.abs(gz) < 40) continue;                                  // the railway
    if (rnd(i) > S.density * (1.15 - d * 0.6)) continue;
    // Each block holds a few buildings around its edge.
    const n = 2 + Math.floor(rnd(i + 1) * 3);
    for (let k = 0; k < n; k++) {
      const x = gx + (rnd(i * 5 + k) - 0.5) * cell * 0.6, z = gz + (rnd(i * 7 + k) - 0.5) * cell * 0.6;
      if (occupied(x, z)) continue;
      const g0 = ground(x, z); if (g0 < 0.5) continue;
      const centre = 1 - d;
      const fl = S.floors[0] + Math.floor(rnd(i * 11 + k) * (S.floors[1] - S.floors[0] + 1) * (0.5 + centre * 0.7));
      houses.push({ x, z, y: g0, w: 10 + rnd(i * 13 + k) * 12, d: 9 + rnd(i * 17 + k) * 10, h: fl * 3.1, r: Math.round(rnd(i * 19 + k) * 2) * Math.PI / 2 * 0.0 + (rnd(i * 23 + k) - 0.5) * 0.12, c: S.walls[Math.floor(rnd(i * 29 + k) * S.walls.length)], rc: S.roofs[Math.floor(rnd(i * 31 + k) * S.roofs.length)] });
    }
    if (S.towers && d < 0.45 && rnd(i + 99) < S.towers / 120 && towers.length < S.towers && !occupied(gx, gz)) towers.push({ x: gx, z: gz, y: ground(gx, gz), h: 50 + rnd(i + 98) * 90, w: 22 + rnd(i + 97) * 14 });
  }
  const C = new THREE.Color();
  if (houses.length) {
    const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), M.wall, houses.length);
    const roofGeo = S.roof === 'saw' ? new THREE.BoxGeometry(1, 0.15, 1).translate(0, 0.075, 0) : S.roof === 'mansard' ? new THREE.CylinderGeometry(0.5, 0.72, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0) : S.roof === 'gable' ? gableGeo() : new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const roof = new THREE.InstancedMesh(roofGeo, M.roof, houses.length);
    const winGeo = windowBand();
    const wins = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), houses.length);
    const m4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    houses.forEach((h, k) => {
      Q.setFromAxisAngle(up, h.r);
      m4.compose(P.set(h.x, h.y - 1, h.z), Q, Sc.set(h.w, h.h + 1, h.d)); wall.setMatrixAt(k, m4); wall.setColorAt(k, C.setHex(h.c));
      m4.compose(P.set(h.x, h.y + h.h, h.z), Q, Sc.set(h.w, S.roof === 'saw' ? 1 : Math.min(h.w, h.d) * 0.45, h.d)); roof.setMatrixAt(k, m4); roof.setColorAt(k, C.setHex(h.rc));
      m4.compose(P.set(h.x, h.y, h.z), Q, Sc.set(h.w + 0.1, h.h, h.d + 0.1)); wins.setMatrixAt(k, m4); wins.setColorAt(k, C.setHex(0x34404c));
    });
    for (const im of [wall, roof, wins]) { im.computeBoundingSphere(); root.add(im); }
    var winMesh = wins;
  }
  for (const t of towers) {
    box(identity === 'southern' ? lam({ color: 0xf4e6cc }) : M.glass, t.w, t.h, t.w, t.x, t.y + t.h / 2, t.z);
    box(M.dark, t.w + 0.6, 1.2, t.w + 0.6, t.x, t.y + t.h + 0.6, t.z);
    for (let f = 4; f < t.h; f += 4) box(M.dark, t.w + 0.2, 0.25, t.w + 0.2, t.x, t.y + f, t.z);
  }
  // Main avenue from the station forecourt, perpendicular to the track, with rows of trees.
  box(M.road, 22, 0.2, R * 0.8, 0, Y - 0.5, SB.z + 50 + R * 0.4);

  // ---------- Identity landmarks ----------
  const L = (fn) => fn();
  if (identity === 'regional') L(() => {        // Montreval: Gothic cathedral on the old-town square, a river with stone bridges
    const x = 260, z = 320, g0 = ground(x, z);
    box(M.stone, 90, 26, 34, x, g0 + 13, z); const nave = new THREE.CylinderGeometry(0.1, 24, 18, 4, 1); nave.rotateY(Math.PI / 4); nave.scale(2.6, 1, 1); nave.translate(x, g0 + 35, z); put(lam({ color: 0x5a6068 }), nave);
    for (const sd of [-1, 1]) { box(M.stone, 14, 62, 14, x - 48, g0 + 31, z + sd * 11); cone(lam({ color: 0x5a6068 }), 9, 26, x - 48, g0 + 75, z + sd * 11); }
    const rose = new THREE.CircleGeometry(6, 24); rose.rotateY(-Math.PI / 2); rose.translate(x - 55.1, g0 + 26, z); put(lam({ color: 0x3a4a8a }), rose);
    box(lam({ color: 0xc8bfa8 }), 120, 0.3, 90, x, g0 + 0.1, z);
    river();
  });
  // Nearest shore (local frame) for the seaside towns: harbour works are built there, facing the sea.
  const shore = () => {
    let best = null;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
      for (let r = 200; r < 6000; r += 100) if (ground(ux * r, uz * r) < 0) { if (!best || r < best.r) best = { r, ux, uz }; break; }
    }
    return best;
  };
  const harbour = (kind) => {
    const sh = shore(); if (!sh) return;
    const hb = new THREE.Group(); hb.position.set(sh.ux * sh.r, 0, sh.uz * sh.r); hb.rotation.y = -Math.atan2(sh.uz, sh.ux); root.add(hb);  // hb +x = seaward
    const hbox = (mat, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); hb.add(m); return m; };
    const hcyl = (mat, r0, r1, h, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 16), mat); m.position.set(x, y, z); hb.add(m); return m; };
    hbox(lam({ color: 0xe8d8a8 }), 160, 1.2, 1800, -40, 0.2, 0);                     // beach
    hbox(M.stone, 360, 4, 24, 160, 1.5, -220); hbox(M.stone, 24, 4, 300, 330, 1.5, -80);   // breakwaters
    if (kind === 'lighthouse') {
      hcyl(M.white, 4, 5.2, 34, 330, 18, 70); for (let k = 0; k < 4; k++) hcyl(M.red, 4.15, 4.15, 3, 330, 6 + k * 8, 70);
      hcyl(M.dark, 3.2, 3.2, 4, 330, 37, 70); const lampM = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), M.lamp); lampM.position.set(330, 37, 70); hb.add(lampM); root.userData.beacon = lampM;
    }
    // Moored boats and a promenade with palms (south) or lamps (Atlantic).
    for (let k = 0; k < (kind === 'marina' ? 48 : 24); k++) {
      const bx = 60 + (k % 8) * 30, bz = -190 + Math.floor(k / 8) * 26;
      hbox(M.white, 11, 1.6, 3.6, bx, 0.6, bz); hcyl(lam({ color: 0xdcd6c8 }), 0.12, 0.12, 13, bx, 7.5, bz);
    }
    for (let k = -18; k <= 18; k++) {
      const z = k * 48, x = -110;
      if (kind === 'marina') {
        hcyl(M.trunk, 0.22, 0.3, 9, x, 4.5, z);
        for (let f = 0; f < 7; f++) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 3.6), M.palm); g.geometry.translate(0, 0, 1.7); g.rotation.set(-0.45, (f / 7) * Math.PI * 2, 0, 'YXZ'); g.position.set(x, 9, z); hb.add(g); }
      } else { hcyl(M.dark, 0.08, 0.1, 4.5, x, 2.2, z); const l = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), M.lamp); l.position.set(x, 4.6, z); hb.add(l); }
    }
    hbox(lam({ color: 0xc8bfa8 }), 30, 1, 1800, -110, 0.6, 0);                     // promenade
  };
  if (identity === 'coastal') harbour('lighthouse');
  if (identity === 'southern') harbour('marina');
  if (identity === 'industrial') L(() => {     // Clairmont: factories with chimneys, gasometer, canal, the opera house
    for (let k = 0; k < 7; k++) {
      const x = -900 + k * 140, z = -260 - (k % 2) * 140, g0 = ground(x, z);
      box(M.brick, 110, 16, 60, x, g0 + 8, z); for (let r = 0; r < 6; r++) { const g = new THREE.BoxGeometry(18, 6, 60); g.translate(0, 0, 0); const sh = new THREE.CylinderGeometry(0.01, 10, 6, 3, 1); sh.rotateZ(Math.PI / 2); sh.rotateY(Math.PI / 2); void g; box(lam({ color: 0x5a5d62 }), 1, 6, 60, x - 50 + r * 18 + 9, g0 + 19, z); box(M.glass, 0.5, 6, 60, x - 50 + r * 18 + 0.5, g0 + 19, z); }
      cyl(M.brick, 3.2, 4.4, 70, x + 40, g0 + 35, z + 40, 12);
    }
    const gx = -500, gz = -560, g0 = ground(gx, gz); cyl(M.steel, 40, 40, 36, gx, g0 + 18, gz, 28);
    box(M.water, 40, 0.2, 2400, -1100, Y - 0.4, 0);
    const ox = 220, oz = 360, o0 = ground(ox, oz);
    box(lam({ color: 0xe8dcc4 }), 80, 30, 60, ox, o0 + 15, oz); const dome = new THREE.SphereGeometry(22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(ox, o0 + 30, oz); put(M.copper, dome);
    for (let k = -4; k <= 4; k++) cyl(M.white, 1.1, 1.2, 18, ox + k * 8, o0 + 9, oz - 31, 12);
  });
  if (identity === 'alpine') L(() => {         // Saint-Roch: church with an onion spire, cable car up the mountain, snowy chalets
    const x = -180, z = 220, g0 = ground(x, z);
    box(M.white, 34, 16, 18, x, g0 + 8, z); box(M.white, 9, 36, 9, x - 20, g0 + 18, z); const on = new THREE.SphereGeometry(5.5, 16, 12); on.scale(1, 1.4, 1); on.translate(x - 20, g0 + 40, z); put(M.copper, on); cone(M.copper, 1.6, 10, x - 20, g0 + 50, z, 8, 0);
    // Cable car: valley station → summit across the line.
    const a = new THREE.Vector3(300, ground(300, 300) + 8, 300), b = new THREE.Vector3(1600, ground(1600, 1800) + 30, 1800);
    box(M.dark, 24, 14, 18, a.x, a.y - 1, a.z); box(M.dark, 24, 14, 18, b.x, b.y - 1, b.z);
    const lp = []; for (const off of [-3, 3]) lp.push(a.x + off, a.y + 6, a.z, b.x + off, b.y + 6, b.z);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x222222 })));
    for (let k = 1; k < 5; k++) { const p = a.clone().lerp(b, k / 5); cyl(M.steel, 1, 2, p.y - ground(p.x, p.z) + 6, p.x, (p.y + ground(p.x, p.z) + 6) / 2, p.z, 6); }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), M.red); cab.position.copy(a).y += 3; root.add(cab);
    root.userData.cab = { cab, a: a.clone().setY(a.y + 3), b: b.clone().setY(b.y + 3) };
    // Snow on the roofs: lighter roof tint handled by palette; a few snow fields nearby.
  });
  if (identity === 'western') L(() => {        // Belle-Rive: wide river with bridges, an arched riverside quay, an observation wheel
    river();
    const wx = -500, wz = 520, g0 = ground(wx, wz);
    const wheel = new THREE.Group(); wheel.position.set(wx, g0 + 46, wz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(40, 0.6, 6, 48), M.steel); wheel.add(ring);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; const sp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 40, 0.3), M.steel); sp.position.set(Math.cos(a) * 20, Math.sin(a) * 20, 0); sp.rotation.z = a + Math.PI / 2; wheel.add(sp); const gd = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), M.white); gd.position.set(Math.cos(a) * 40, Math.sin(a) * 40, 0); wheel.add(gd); }
    root.add(wheel); root.userData.wheel = wheel;
    for (const sd of [-1, 1]) { const g = new THREE.BoxGeometry(1.4, 48, 1.4); g.rotateZ(sd * 0.35); g.translate(wx + sd * 8, g0 + 23, wz); put(M.steel, g); }
  });
  function river() {
    const { z, w } = riverAt;
    box(M.water, 3400, 0.2, w, 0, Y - 0.4, z);
    for (const sd of [-1, 1]) box(M.stone, 3400, 1.2, 3, 0, Y - 0.2, z + sd * (w / 2 + 1.5));      // quays
    for (const x of [-500, 0, 500]) { box(M.stone, 16, 1.6, w + 10, x, Y + 1.2, z); for (let k = 1; k < Math.max(2, Math.round(w / 45)); k++) box(M.stone, 6, 2.2, 6, x, Y + 0.6, z - w / 2 + (k * w) / Math.max(2, Math.round(w / 45))); }
  }
  // ---------- merge ----------
  for (const [mat, geos] of parts) {
    const norm = geos.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; });
    root.add(new THREE.Mesh(mergeGeometries(norm), mat));
  }
  let t = 0;
  return {
    group: root,
    update(dt, time, clock) {
      t += dt;
      if (root.userData.wheel) root.userData.wheel.rotation.z = t * 0.03;
      if (root.userData.cab) { const u = 0.5 - 0.5 * Math.cos(t * 0.02); root.userData.cab.cab.position.lerpVectors(root.userData.cab.a, root.userData.cab.b, u); }
      // Windows light up in the evening.
      if (winMesh && clock != null) { const h = (clock / 3600) % 24, night = h < 6.5 || h > 20 ? 1 : 0; if (winMesh.userData.night !== night) { winMesh.userData.night = night; winMesh.material.color.setHex(night ? 0xffd890 : 0xffffff); } }
    },
    dispose() { parent.remove(root); root.traverse((o) => o.geometry?.dispose()); },
  };
}

function gableGeo() {
  const g = new THREE.BufferGeometry();
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
  const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed().scale(1.08, 1, 1.08);
}
/** Window band: thin dark strips around a unit box (scaled per building). */
function windowBand() {
  const parts = [];
  for (let f = 0.12; f < 0.95; f += 0.22) {
    for (const [w, d] of [[1.0, 0.004], [0.004, 1.0]]) {
      const g = new THREE.BoxGeometry(w === 1 ? 0.86 : 1.002, 0.09, d === 1 ? 0.86 : 1.002); g.translate(0, f + 0.05, 0); parts.push(g.toNonIndexed());
    }
  }
  return mergeGeometries(parts);
}
