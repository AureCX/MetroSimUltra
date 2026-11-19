// Visual train: articulated cars placed on the track by bogie positions, sliding doors,
// head/tail lights and destination displays. Shared by the player train and AI traffic.
import * as THREE from 'three';
import { Textures, shade } from './Textures.js';
import { glowTexture } from './SignalView.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FLOOR = 1.0;
const geoCache = new Map();

// Car body built as a real shell (no longer a solid block): hollow roof, floor slab, end caps and side
// panels with door openings and glazed window bands, so open doors and windows show the saloon behind.
const WIN_Y0 = 1.925, WIN_Y1 = 2.775, SIDE_TOP = 2.95;
function outline(W) {
  const s = new THREE.Shape(), h = W / 2;
  s.moveTo(-h + 0.08, 0.82); s.lineTo(h - 0.08, 0.82); s.lineTo(h, 1.0);
  s.lineTo(h, 2.95); s.quadraticCurveTo(h, 3.55, h - 0.5, 3.58);
  s.lineTo(-h + 0.5, 3.58); s.quadraticCurveTo(-h, 3.55, -h, 2.95); s.lineTo(-h, 1.0); s.closePath();
  return s;
}
function shellGeometry(specs) {
  const W = specs.width, L = specs.carLength, dps = specs.doorsPerSide, dw = specs.doorWidth;
  const key = `shell|${W}|${L}|${dps}|${dw}|${specs.doorZ}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const h = W / 2;
  // Hollow roof: outer arc, inner arc 8 cm inside.
  const r = new THREE.Shape();
  r.moveTo(h, SIDE_TOP); r.quadraticCurveTo(h, 3.55, h - 0.5, 3.58); r.lineTo(-h + 0.5, 3.58); r.quadraticCurveTo(-h, 3.55, -h, SIDE_TOP);
  r.lineTo(-h + 0.08, SIDE_TOP); r.quadraticCurveTo(-h + 0.08, 3.47, -h + 0.5, 3.5); r.lineTo(h - 0.5, 3.5); r.quadraticCurveTo(h - 0.08, 3.47, h - 0.08, SIDE_TOP); r.closePath();
  const roof = new THREE.ExtrudeGeometry(r, { depth: L, bevelEnabled: false, steps: 1 }); roof.translate(0, 0, -L / 2);
  // Floor slab with the sloped skirt.
  const f = new THREE.Shape();
  f.moveTo(-h + 0.08, 0.82); f.lineTo(h - 0.08, 0.82); f.lineTo(h, 1.0); f.lineTo(-h, 1.0); f.closePath();
  const floor = new THREE.ExtrudeGeometry(f, { depth: L, bevelEnabled: false, steps: 1 }); floor.translate(0, 0, -L / 2);
  // End caps (the gangway / cab front sits in front of them).
  const [endF, endB] = [L / 2, -L / 2].map((z) => { const g = new THREE.ShapeGeometry(outline(W)); g.translate(0, 0, z); return g; });
  // Side panels.
  const doorZ = specs.doorZ;
  const spans = []; let cur = -L / 2;
  for (const z of [...doorZ].sort((x, y) => x - y)) { if (z - dw / 2 > cur) spans.push([cur, z - dw / 2]); cur = z + dw / 2; }
  if (cur < L / 2) spans.push([cur, L / 2]);
  const panels = [], glass = [], stripe = [];
  const rect = (list, side, z0, z1, y0, y1, out = 0) => {
    if (z1 - z0 < 0.01 || y1 - y0 < 0.01) return;
    const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0); g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(side * (h + out), (y0 + y1) / 2, (z0 + z1) / 2); list.push(g);
  };
  for (const side of [1, -1]) for (const [a, b] of spans) {
    rect(panels, side, a, b, 1.0, WIN_Y0); rect(panels, side, a, b, WIN_Y1, SIDE_TOP);
    const p = 0.35;
    if (b - a > 2 * p + 0.3) { rect(panels, side, a, a + p, WIN_Y0, WIN_Y1); rect(panels, side, b - p, b, WIN_Y0, WIN_Y1); rect(glass, side, a + p, b - p, WIN_Y0, WIN_Y1, 0.002); }
    else rect(panels, side, a, b, WIN_Y0, WIN_Y1);
    rect(stripe, side, a, b, 1.17, 1.33, 0.004);
  }
  const res = { roof, floor, endF, endB, panels: mergeGeometries(panels), glass: mergeGeometries(glass), stripe: mergeGeometries(stripe), doorZ };
  geoCache.set(key, res);
  return res;
}

/** Interior geometry of one car, merged per material: { parts: {material: geometry}, displays: [...] }. */
function interiorGeometry(sp, cabFront, cabBack) {
  const key = `int|${sp.width}|${sp.carLength}|${sp.doorsPerSide}|${sp.doorWidth}|${sp.doorZ}|${cabFront}|${cabBack}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const W = sp.width, L = sp.carLength, dps = sp.doorsPerSide, dw = sp.doorWidth;
  const parts = { floor: [], wall: [], ceiling: [], light: [], seat: [], pole: [], dark: [] }, displays = [];
  const plane = (k, w, h, x, y, z, rx, ry) => { const g = new THREE.PlaneGeometry(w, h); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); parts[k].push(g); };
  const box = (k, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts[k].push(g.toNonIndexed()); };
  const y0 = FLOOR + 0.02, yc = 3.22, xi = W / 2 - 0.07;
  const doorZ = sp.doorZ;
  // Behind the drivers' cabs (the cab interior is 2.35 m deep), but never across the first doorway.
  const cabDepth = Math.min(2.4, L / 2 - (Math.max(...doorZ) + dw / 2) - 0.05);
  const zFront = cabFront ? L / 2 - cabDepth : L / 2 - 0.08, zBack = cabBack ? -L / 2 + cabDepth : -L / 2 + 0.08;
  const len = zFront - zBack, zm = (zFront + zBack) / 2;
  plane('floor', W - 0.14, len, 0, y0, zm, -Math.PI / 2, 0);
  plane('ceiling', W - 0.14, len, 0, yc, zm, Math.PI / 2, 0);
  for (const sx of [-0.45, 0.45]) plane('light', 0.16, len - 0.4, sx, yc - 0.01, zm, Math.PI / 2, 0);
  const spans = []; let cur = zBack;
  for (const z of [...doorZ].sort((a, b) => a - b)) { if (z - dw / 2 > cur) spans.push([cur, Math.min(zFront, z - dw / 2)]); cur = Math.max(cur, z + dw / 2); }
  if (cur < zFront) spans.push([cur, zFront]);
  for (const side of [-1, 1]) for (const [a, b] of spans) {
    if (b - a < 0.05) continue;
    const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    plane('wall', b - a, WIN_Y0 - 0.005 - y0, side * xi, (WIN_Y0 - 0.005 + y0) / 2, (a + b) / 2, 0, ry);
    plane('wall', b - a, yc - (WIN_Y1 + 0.005), side * xi, (yc + WIN_Y1 + 0.005) / 2, (a + b) / 2, 0, ry);
    if (b - a > 1.2) { box('seat', 0.48, 0.1, b - a - 0.4, side * (W / 2 - 0.34), FLOOR + 0.46, (a + b) / 2); box('seat', 0.08, 0.45, b - a - 0.4, side * (W / 2 - 0.12), FLOOR + 0.72, (a + b) / 2); }
  }
  for (const z of doorZ) {
    if (z > zFront || z < zBack) continue;
    for (const side of [-1, 1]) {
      const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      plane('wall', dw, yc - (FLOOR + 1.98), side * xi, (yc + FLOOR + 1.98) / 2, z, 0, ry);
      displays.push({ w: dw - 0.1, h: ((dw - 0.1) * 160) / 768, x: side * (xi - 0.02), y: yc - 0.2, z, ry });
    }
    for (const dz of [-0.55, 0.55]) { const g = new THREE.CylinderGeometry(0.02, 0.02, yc - y0, 8); g.translate(0, (yc + y0) / 2, z + dz); parts.pole.push(g.toNonIndexed()); }
  }
  for (const [z, dir, cab] of [[zFront, -1, cabFront], [zBack, 1, cabBack]]) {
    const open = cab ? 0 : 1.2, sideW = (W - 0.14 - open) / 2;
    for (const sx of [-1, 1]) plane(cab ? 'dark' : 'wall', sideW, yc - y0, sx * (open / 2 + sideW / 2), (yc + y0) / 2, z, 0, dir > 0 ? 0 : Math.PI);
    if (!cab) plane('wall', open, yc - (FLOOR + 2.2), 0, (yc + FLOOR + 2.2) / 2, z, 0, dir > 0 ? 0 : Math.PI);
  }
  const merged = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) merged[k] = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  const res = { parts: merged, displays };
  geoCache.set(key, res);
  return res;
}

function destinationTexture(line, terminus) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#070707'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = line.color; g.beginPath(); g.arc(50, 48, 36, 0, Math.PI * 2); g.fill();
  g.fillStyle = line.textColor; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(line.number, 50, 50);
  g.fillStyle = '#ffb300'; g.font = 'bold 40px "Courier New", monospace'; g.textAlign = 'left';
  g.fillText(terminus.length > 18 ? terminus.slice(0, 17) + '…' : terminus, 100, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TrainModel {
  constructor(specs, line, terminus, { player = false } = {}) {
    this.specs = specs;
    this.group = new THREE.Group();
    this.cars = [];
    this.doors = { left: [], right: [] };
    const W = specs.width, L = specs.carLength;
    const livery = specs.livery || {};
    const body = new THREE.MeshStandardMaterial({ color: livery.body || '#d9dde2', metalness: 0.45, roughness: 0.45 });
    const roof = new THREE.MeshStandardMaterial({ color: livery.roof || '#8b9096', metalness: 0.4, roughness: 0.6 });
    const stripeMat = new THREE.MeshLambertMaterial({ color: livery.stripe || line.color });
    const doorMat = new THREE.MeshStandardMaterial({ color: livery.doors || shade(livery.body || '#d9dde2', -25), metalness: 0.4, roughness: 0.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb8c6, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const bodySides = body.clone(); bodySides.side = THREE.DoubleSide;
    const sg = shellGeometry(specs);
    const darkGlass = new THREE.MeshStandardMaterial({ color: 0x0c1116, metalness: 0.9, roughness: 0.1 });
    const under = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
    const frontMat = new THREE.MeshStandardMaterial({ color: livery.front || livery.body || '#d9dde2', metalness: 0.4, roughness: 0.5 });
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const destTex = destinationTexture(line, terminus);
    const destMat = this.destMat = new THREE.MeshBasicMaterial({ map: destTex });
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16);
    const glow = glowTexture();
    this.glows = [];

    for (let c = 0; c < specs.cars; c++) {
      const car = new THREE.Group();
      const shell = new THREE.Group();
      shell.add(new THREE.Mesh(sg.roof, body));
      const rf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.9, 0.12, L - 0.4), roof);
      rf.position.y = 3.6; shell.add(rf);
      shell.add(new THREE.Mesh(sg.floor, body), new THREE.Mesh(sg.panels, bodySides), new THREE.Mesh(sg.stripe, stripeMat));
      // End walls between cars (the cab ends are closed by the cab front).
      if (c > 0) shell.add(new THREE.Mesh(sg.endF, bodySides));
      if (c < specs.cars - 1) shell.add(new THREE.Mesh(sg.endB, bodySides));
      const glazing = new THREE.Mesh(sg.glass, glassMat); glazing.renderOrder = 2; shell.add(glazing);
      // Under-frame & bogies.
      const uf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.35, L - 3), under); uf.position.y = 0.62; shell.add(uf);
      for (const bz of [L / 2 - 2.4, -L / 2 + 2.4]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 2.6), under); bogie.position.set(0, 0.5, bz); shell.add(bogie);
        for (const wz of [-1, 1]) for (const wx of [-0.72, 0.72]) {
          const w = new THREE.Mesh(wheel, under); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, bz + wz * 1.0); shell.add(w);
        }
      }
      // Sides: stripe, windows, doors.
      const dps = specs.doorsPerSide, dw = specs.doorWidth;
      for (const side of [1, -1]) { // +1 = left (+x), -1 = right
        const x = side * (W / 2 + 0.006);
        const ry = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        const doorZ = sg.doorZ;
        for (const z of doorZ) {
          for (const leaf of [-1, 1]) {
            const g = new THREE.Group();
            // Leaf: lower panel, top rail, stiles and a glazed window (see-through into the car).
            const lw = dw / 2, part = (hh, yc, zw = lw, zc = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, hh, zw), doorMat); m.position.set(0, yc, zc); g.add(m); };
            part(1.025, -0.4625); part(0.125, 0.9125);
            for (const e of [-1, 1]) part(0.8, 0.45, 0.08, e * (lw / 2 - 0.04));
            const dwin = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.16, 0.8), glassMat);
            dwin.position.set(0, 0.45, 0); dwin.rotation.y = ry; g.add(dwin);
            g.position.set(x + side * 0.03, FLOOR + 0.98, z + leaf * dw / 4);
            g.userData = { baseZ: z + leaf * dw / 4, dir: leaf, travel: dw / 2 - 0.02 };
            shell.add(g);
            this.doors[side > 0 ? 'left' : 'right'].push(g);
          }
        }
      }
      car.add(shell);
      // Ends: cab fronts on first & last car, gangways elsewhere.
      for (const end of [1, -1]) {
        const isCab = (c === 0 && end === 1) || (c === specs.cars - 1 && end === -1);
        const z = end * (L / 2 + 0.01);
        const g = new THREE.Group(); g.position.z = z; if (end < 0) g.rotation.y = Math.PI;
        if (isCab) {
          const nose = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 2.75, 0.18), frontMat); nose.position.set(0, 2.2, 0.06); g.add(nose);
          const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, 1.15), darkGlass); ws.position.set(0, 2.55, 0.16); g.add(ws);
          const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), destMat); dest.position.set(0, 3.3, 0.16); g.add(dest);
          for (const hx of [-W / 2 + 0.35, W / 2 - 0.35]) {
            const hl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), end === 1 ? this.headMat : this.headMat);
            hl.position.set(hx, 1.45, 0.16); g.add(hl);
            const tl = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), this.tailMat);
            tl.position.set(hx * 0.82, 1.45, 0.16); g.add(tl);
            const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff4d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            gl.scale.set(1.2, 1.2, 1); gl.position.set(hx, 1.45, 0.25); g.add(gl);
            gl.userData.end = end;
            this.glows.push(gl);
            const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff1a00, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
            tg.scale.set(0.6, 0.6, 1); tg.position.set(hx * 0.82, 1.45, 0.25); g.add(tg);
            tg.userData.end = end; tg.userData.tail = true;
            this.glows.push(tg);
          }
          const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.5), under); coupler.position.set(0, 0.95, 0.3); g.add(coupler);
          if (c === 0 && end === 1) this.cabFront = g;
        } else {
          const gw = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, specs.carGap + 0.1), under); gw.position.set(0, 2.1, (specs.carGap) / 2); g.add(gw);
        }
        car.add(g);
      }
      car.userData.shell = shell;
      this.group.add(car);
      this.cars.push(car);
    }
    this.setLights('forward');
    this.buildInterior(line, player);
  }

  /**
   * Passenger saloons (every train, so open doors and windows show a real interior): floor, ceiling, wall
   * linings leaving the windows clear, benches, grab poles, light strips, end walls, cab partitions. Geometry is
   * merged per material and cached per train type. The driven train also gets next-station displays.
   */
  buildInterior(line, player) {
    const sp = this.specs, n = sp.cars;
    const lam = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
    const M = {
      floor: lam({ color: 0x5b6068, emissive: 0x15171a }), wall: lam({ color: 0xe9ebee, emissive: 0x3a3c40 }), ceiling: lam({ color: 0xf2f3f5, emissive: 0x4a4b4e }),
      seat: lam({ color: new THREE.Color(line.color).lerp(new THREE.Color(0x24324a), 0.45), emissive: 0x111111 }), pole: new THREE.MeshStandardMaterial({ color: line.color, metalness: 0.5, roughness: 0.35 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfffaf0 }), dark: lam({ color: 0x2b2f35 }),
    };
    let infoMat = null;
    if (player) {
      const c = document.createElement('canvas'); c.width = 768; c.height = 160;
      this.infoCanvas = c; this.infoCtx = c.getContext('2d');
      this.infoTex = new THREE.CanvasTexture(c); this.infoTex.colorSpace = THREE.SRGBColorSpace;
      infoMat = new THREE.MeshBasicMaterial({ map: this.infoTex });
    }
    this.cars.forEach((car, ci) => {
      const geo = interiorGeometry(sp, ci === 0, ci === n - 1);
      const g = new THREE.Group(); g.name = 'interior'; car.add(g);
      for (const [k, gg] of Object.entries(geo.parts)) g.add(new THREE.Mesh(gg, M[k]));
      if (infoMat) for (const d of geo.displays) { const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), infoMat); m.position.set(d.x, d.y, d.z); m.rotation.y = d.ry; g.add(m); }
    });
    if (player) this.setInfo({ line, next: '', terminus: '' });
  }

  /** Next-station displays inside the train. */
  setInfo({ line, next, terminus, clock, side, atStation }) {
    if (!this.infoCanvas) return;
    const key = `${next}|${terminus}|${side}|${atStation}|${Math.floor((clock || 0) / 60)}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const g = this.infoCtx, W = 768, H = 160;
    if (!g) return;
    g.fillStyle = '#0c0f14'; g.fillRect(0, 0, W, H);
    g.fillStyle = line.color; g.beginPath(); g.arc(70, 80, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = line.textColor; g.font = 'bold 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(line.number, 70, 84);
    g.textAlign = 'left'; g.fillStyle = '#8fa1b3'; g.font = '26px Arial';
    g.fillText(atStation ? 'Station · Stop' : 'Prochaine station · Next stop', 140, 40);
    g.fillStyle = '#ffffff'; let size = 48; g.font = `bold ${size}px Arial`;
    while (g.measureText(next).width > W - 160 && size > 22) { size -= 2; g.font = `bold ${size}px Arial`; }
    g.fillText(next, 140, 90);
    g.fillStyle = '#ffb000'; g.font = '24px Arial';
    g.fillText(`${terminus ? `Direction ${terminus}` : ''}${side ? `   ·   Descente ${side === 'left' ? 'à gauche ◀' : 'à droite ▶'}` : ''}`, 140, 138);
    if (clock != null) { g.textAlign = 'right'; g.fillStyle = '#8fa1b3'; g.font = 'bold 26px Arial'; const h = Math.floor(clock / 3600) % 24, m = Math.floor(clock / 60) % 60; g.fillText(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, W - 18, 40); }
    this.infoTex.needsUpdate = true;
  }

  setDestination(line, terminus) {
    this.destMat.map?.dispose();
    this.destMat.map = destinationTexture(line, terminus);
    this.destMat.needsUpdate = true;
  }

  /** Front of train at route chainage `front` (m). */
  setPose(route, front) {
    const sp = this.specs, L = sp.carLength;
    const a = this._a || (this._a = {}), b = this._b || (this._b = {});
    for (let c = 0; c < sp.cars; c++) {
      const cf = front - c * (L + sp.carGap);
      route.point(cf - 2.4, 0, 0, a);
      route.point(cf - L + 2.4, 0, 0, b);
      const car = this.cars[c];
      car.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      car.lookAt(a.x, (a.y + b.y) / 2 + (a.y - b.y) / 2, a.z);
    }
  }

  /** side: 'left' | 'right', amount 0..1 */
  setDoors(side, amount) {
    for (const g of this.doors[side]) g.position.z = g.userData.baseZ + g.userData.dir * g.userData.travel * amount;
  }

  setLights(mode, high = true) {
    for (const gl of this.glows) {
      const front = gl.userData.end === 1;
      if (gl.userData.tail) gl.material.opacity = front ? 0 : 0.95;
      else gl.material.opacity = front ? (high ? 0.9 : 0.5) : 0;
    }
    this.tailMat.color.setHex(0xff2200);
  }

  /** Hide the leading cab exterior when the camera is inside it. */
  setCabExteriorVisible(v) { if (this.cabFront) this.cabFront.visible = v; this.cars[0].userData.shell.children[0].visible = v; this.cars[0].userData.shell.children[1].visible = v; }

  dispose(scene) { scene.remove(this.group); }
}
export const TRAIN_FLOOR = FLOOR;
