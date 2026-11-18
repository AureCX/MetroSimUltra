// Visual train: articulated cars placed on the track by bogie positions, sliding doors,
// head/tail lights and destination displays. Shared by the player train and AI traffic.
import * as THREE from 'three';
import { Textures, shade } from './Textures.js';
import { glowTexture } from './SignalView.js';

const FLOOR = 1.0;
const geoCache = new Map();

function bodyGeometry(W, L) {
  const key = `${W}x${L}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = new THREE.Shape();
  const h = W / 2;
  s.moveTo(-h + 0.08, 0.82); s.lineTo(h - 0.08, 0.82); s.lineTo(h, 1.0);
  s.lineTo(h, 2.95); s.quadraticCurveTo(h, 3.55, h - 0.5, 3.58);
  s.lineTo(-h + 0.5, 3.58); s.quadraticCurveTo(-h, 3.55, -h, 2.95); s.lineTo(-h, 1.0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -L / 2);
  geoCache.set(key, g);
  return g;
}

let windowTex;
function interiorTexture() {
  if (windowTex) return windowTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#f6f3e6'); grd.addColorStop(0.55, '#d9d4c2'); grd.addColorStop(1, '#6d6a62');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(40,40,50,0.55)';
  for (let x = 6; x < 128; x += 22) { g.fillRect(x, 34, 14, 30); g.beginPath(); g.arc(x + 7, 28, 5, 0, Math.PI * 2); g.fill(); }
  windowTex = new THREE.CanvasTexture(c); windowTex.colorSpace = THREE.SRGBColorSpace;
  return windowTex;
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
    const glassMat = new THREE.MeshBasicMaterial({ map: interiorTexture(), color: 0xbfbfbf });
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
      shell.add(new THREE.Mesh(bodyGeometry(W, L), body));
      const rf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.9, 0.12, L - 0.4), roof);
      rf.position.y = 3.6; shell.add(rf);
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
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.2, 0.16), stripeMat);
        stripe.position.set(x + side * 0.002, 1.25, 0); stripe.rotation.y = ry; shell.add(stripe);
        const doorZ = [];
        for (let d = 0; d < dps; d++) doorZ.push(L / 2 - (L * (d + 0.5)) / dps);
        // windows between doors
        const bounds = [L / 2 - 0.3, ...doorZ.flatMap((z) => [z + dw / 2 + 0.25, z - dw / 2 - 0.25]), -L / 2 + 0.3];
        for (let i = 0; i < bounds.length; i += 2) {
          const za = bounds[i], zb = bounds[i + 1];
          const len = za - zb;
          if (len < 0.6 || (c === 0 && player && i === 0 && false)) continue;
          const win = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.2, 0.85), glassMat);
          win.position.set(x + side * 0.003, 2.35, (za + zb) / 2); win.rotation.y = ry; shell.add(win);
        }
        for (const z of doorZ) {
          for (const leaf of [-1, 1]) {
            const g = new THREE.Group();
            const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.95, dw / 2), doorMat);
            const dwin = new THREE.Mesh(new THREE.PlaneGeometry(dw / 2 - 0.16, 0.8), glassMat);
            dwin.position.set(side * 0.022, 0.45, 0); dwin.rotation.y = ry;
            g.add(panel, dwin);
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
    if (player) this.buildInterior(line);
  }

  /**
   * Passenger saloons of the driven train (seen from the interior camera): floor, ceiling, wall linings that
   * leave the windows clear (the exterior glass is single-sided, so the outside shows through), benches,
   * grab poles, light strips, end walls and next-station displays above the doors.
   */
  buildInterior(line) {
    const sp = this.specs, W = sp.width, L = sp.carLength, dps = sp.doorsPerSide, dw = sp.doorWidth;
    const lam = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
    const M = {
      floor: lam({ color: 0x5b6068, emissive: 0x15171a }), wall: lam({ color: 0xe9ebee, emissive: 0x3a3c40 }), ceiling: lam({ color: 0xf2f3f5, emissive: 0x4a4b4e }),
      seat: lam({ color: new THREE.Color(line.color).lerp(new THREE.Color(0x24324a), 0.45), emissive: 0x111111 }), pole: new THREE.MeshStandardMaterial({ color: line.color, metalness: 0.5, roughness: 0.35 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfffaf0 }), dark: lam({ color: 0x2b2f35 }),
    };
    const c = document.createElement('canvas'); c.width = 768; c.height = 160;
    this.infoCanvas = c; this.infoTex = new THREE.CanvasTexture(c); this.infoTex.colorSpace = THREE.SRGBColorSpace;
    const infoMat = new THREE.MeshBasicMaterial({ map: this.infoTex });
    const y0 = FLOOR + 0.02, yc = 3.22, xi = W / 2 - 0.07;
    const doorZ = []; for (let d = 0; d < dps; d++) doorZ.push(L / 2 - (L * (d + 0.5)) / dps);
    const plane = (w, h, mat, x, y, z, rx, ry, parent) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); parent.add(m); return m; };
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
    this.cars.forEach((car, ci) => {
      const g = new THREE.Group(); g.name = 'interior'; car.add(g);
      const zFront = ci === 0 ? L / 2 - 2.5 : L / 2 - 0.08, zBack = -L / 2 + 0.08; // car 0: behind the driver's cab
      const len = zFront - zBack, zm = (zFront + zBack) / 2;
      plane(W - 0.14, len, M.floor, 0, y0, zm, -Math.PI / 2, 0, g);
      plane(W - 0.14, len, M.ceiling, 0, yc, zm, Math.PI / 2, 0, g);
      for (const sx of [-0.45, 0.45]) plane(0.16, len - 0.4, M.light, sx, yc - 0.01, zm, Math.PI / 2, 0, g);
      // Wall linings: below and above the window band, skipping door openings.
      const spans = []; let cur = zBack;
      for (const z of [...doorZ].sort((a, b) => a - b)) { if (z - dw / 2 > cur) spans.push([cur, Math.min(zFront, z - dw / 2)]); cur = z + dw / 2; }
      if (cur < zFront) spans.push([cur, zFront]);
      for (const side of [-1, 1]) for (const [a, b] of spans) {
        if (b - a < 0.05) continue;
        const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        plane(b - a, 1.92 - y0, M.wall, side * xi, (1.92 + y0) / 2, (a + b) / 2, 0, ry, g);
        plane(b - a, yc - 2.78, M.wall, side * xi, (yc + 2.78) / 2, (a + b) / 2, 0, ry, g);
        if (b - a > 1.2) box(0.48, 0.1, b - a - 0.4, M.seat, side * (W / 2 - 0.34), FLOOR + 0.46, (a + b) / 2, g);   // bench
        if (b - a > 1.2) box(0.08, 0.45, b - a - 0.4, M.seat, side * (W / 2 - 0.12), FLOOR + 0.72, (a + b) / 2, g);  // backrest
      }
      // Lintels above the doors with the next-station display, grab poles at each door.
      for (const z of doorZ) {
        if (z > zFront) continue;
        for (const side of [-1, 1]) {
          plane(dw, yc - (FLOOR + 1.98), M.wall, side * xi, (yc + FLOOR + 1.98) / 2, z, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2, g);
          plane(dw - 0.1, (dw - 0.1) * 160 / 768, infoMat, side * (xi - 0.02), yc - 0.2, z, 0, side > 0 ? -Math.PI / 2 : Math.PI / 2, g);
        }
        for (const dz of [-0.55, 0.55]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, yc - y0, 8), M.pole); pole.position.set(0, (yc + y0) / 2, z + dz); g.add(pole); }
      }
      // End walls (gangway opening between cars), cab partition with its door in car 0.
      for (const [z, dir] of [[zFront, -1], [zBack, 1]]) {
        const isCabWall = ci === 0 && dir < 0;
        const open = isCabWall ? 0 : 1.2;
        const sideW = (W - 0.14 - open) / 2;
        for (const sx of [-1, 1]) plane(sideW, yc - y0, isCabWall ? M.dark : M.wall, sx * (open / 2 + sideW / 2), (yc + y0) / 2, z, 0, dir > 0 ? 0 : Math.PI, g);
        if (!isCabWall) plane(open, yc - (FLOOR + 2.2), M.wall, 0, (yc + FLOOR + 2.2) / 2, z, 0, dir > 0 ? 0 : Math.PI, g);
      }
    });
    this.setInfo({ line, next: '', terminus: '' });
  }

  /** Next-station displays inside the train. */
  setInfo({ line, next, terminus, clock, side, atStation }) {
    if (!this.infoCanvas) return;
    const key = `${next}|${terminus}|${side}|${atStation}|${Math.floor((clock || 0) / 60)}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const g = this.infoCanvas.getContext('2d'), W = 768, H = 160;
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
