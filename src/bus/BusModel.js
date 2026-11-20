// 3D bus: body shell with livery, transparent windows, plug doors that swing out and slide,
// steering and rolling wheels, LED destination displays, head/brake/indicator/reverse lights,
// interior (floor, seats, grab poles, lights, ticket validator) with seat/standing slots for
// passengers, articulated trailer with bellows, and the upper deck of the double-decker.
// Local frame: forward = −z, right = +x, origin at the centre of gravity at road level.
import * as THREE from 'three';

function ledTexture(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { c, t };
}
export function drawLed(led, number, dest, color = '#ff9a1a') {
  const g = led.c.getContext('2d'), W = led.c.width, H = led.c.height;
  g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(H * 0.72)}px "Courier New", monospace`; g.textAlign = 'left';
  g.fillText(number, H * 0.15, H * 0.54);
  const nw = g.measureText(number).width + H * 0.4;
  let size = Math.round(H * 0.52); g.font = `bold ${size}px Arial`;
  while (g.measureText(dest).width > W - nw - 10 && size > 10) { size -= 2; g.font = `bold ${size}px Arial`; }
  g.fillText(dest, nw, H * 0.54);
  // LED dot grid
  g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1); for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  led.t.needsUpdate = true;
}

let DMG_TEX;
/** Procedural textures: scratched paint for dents, radial cracks for glass. */
function damageTextures() {
  if (DMG_TEX) return DMG_TEX;
  const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const scratch = mk(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '90,90,90' : '160,150,140'},${0.25 + Math.random() * 0.5})`; g.lineWidth = 0.5 + Math.random() * 1.8; g.beginPath(); const x = Math.random() * 256, y = Math.random() * 256, a = (Math.random() - 0.5) * 0.6; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (20 + Math.random() * 90), y + Math.sin(a) * (20 + Math.random() * 90)); g.stroke(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(70,60,55,0.35)'; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 7, 0, Math.PI * 2); g.fill(); }
  });
  const crack = mk(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    const cx = 230 + Math.random() * 50, cy = 220 + Math.random() * 60;
    g.strokeStyle = 'rgba(235,240,245,0.85)'; g.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      let x = cx, y = cy, a = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
      g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 9; k++) { a += (Math.random() - 0.5) * 0.5; const L = 14 + Math.random() * 30; x += Math.cos(a) * L; y += Math.sin(a) * L; g.lineTo(x, y); }
      g.stroke();
    }
    for (let r = 26; r < 220; r += 34 + Math.random() * 20) { g.lineWidth = 1; g.beginPath(); for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2, rr = r * (0.85 + Math.random() * 0.3); const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
  });
  DMG_TEX = { scratch, crack };
  return DMG_TEX;
}

export class BusModel {
  constructor(spec) {
    this.spec = spec;
    const L = spec.length, W = spec.width, H = spec.height, liv = spec.livery || {};
    this.group = new THREE.Group();
    this.body = new THREE.Group(); this.group.add(this.body);
    const front = 0; // computed from physics lf at pose time
    void front;
    const lf = spec.wheelbase * 0.58;
    this.zFront = -(lf + spec.frontOverhang); this.zRear = this.zFront + L;
    const zc = (this.zFront + this.zRear) / 2;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide, ...o });
    const M = this.M = {
      body: std({ color: liv.body || '#e8ecef' }), stripe: std({ color: liv.stripe || '#1f4fa0' }), skirt: std({ color: liv.skirt || '#2a3038' }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1d2a33, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }),
      dark: new THREE.MeshLambertMaterial({ color: 0x15181b }), tyre: new THREE.MeshLambertMaterial({ color: 0x141414 }), rim: std({ color: 0xb9c0c6, metalness: 0.7 }),
      floor: new THREE.MeshLambertMaterial({ color: 0x4a4f56, side: THREE.DoubleSide }), seat: new THREE.MeshLambertMaterial({ color: liv.seats || 0x1f3c88 }),
      pole: std({ color: 0xffc400, metalness: 0.5 }), ceiling: new THREE.MeshLambertMaterial({ color: 0xdedede, side: THREE.DoubleSide }),
      head: new THREE.MeshBasicMaterial({ color: 0x777777 }), brake: new THREE.MeshBasicMaterial({ color: 0x440000 }), rev: new THREE.MeshBasicMaterial({ color: 0x555555 }),
      indL: new THREE.MeshBasicMaterial({ color: 0x553300 }), indR: new THREE.MeshBasicMaterial({ color: 0x553300 }), strip: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }),
    };
    const add = (geo, mat, x, y, z, parent = this.body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    const Bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const dd = spec.type === 'doubledecker';
    // Wheel arches: the lower body is cut around each axle, with a dark wheel housing inside.
    const A = 0.68, ARCH = 1.08;
    const tyreW = (steer) => (steer ? 0.3 : 0.46);
    const housingX = (steer) => W / 2 - (steer ? 0.66 : 0.02 + tyreW(false) + 0.06);
    const section = (parent, z0, z1, doors, cabFront, cabRear, axles = [], doorZ = []) => {
      const len = z1 - z0, mz = (z0 + z1) / 2;
      // Hollow shell: side panels only (a solid box would fill the passenger saloon); door openings on the right.
      const gaps = doorZ.map((d) => [d - 0.64, d + 0.64]).sort((p, q) => p[0] - q[0]);
      const sides = (h, y, a, b, mat, t = 0.06, out = 0) => {
        for (const sx of [-1, 1]) {
          let parts = [[a, b]];
          if (sx > 0 && y < 2.3) for (const [g0, g1] of gaps) parts = parts.flatMap(([p, q]) => (g1 <= p || g0 >= q ? [[p, q]] : [[p, g0], [g1, q]].filter(([u, w]) => w - u > 0.01)));
          for (const [p, q] of parts) add(Bx(t, h, q - p), mat, sx * (W / 2 - t / 2 + out), y, (p + q) / 2, parent);
        }
      };
      const seg = (a, b) => { if (b - a < 0.01) return; sides(0.95, 0.78, a, b, M.body); sides(0.22, 0.36, a, b, M.skirt, 0.04, 0.012); };
      let cur = z0;
      for (const ax of [...axles].sort((a, b) => a.z - b.z)) {
        if (ax.z - A < z0 || ax.z + A > z1) continue;
        seg(cur, ax.z - A); cur = ax.z + A;
        sides(1.255 - ARCH, (ARCH + 1.255) / 2, ax.z - A, ax.z + A, M.body);
        const hx = housingX(ax.steer);
        for (const sx of [-1, 1]) {
          add(Bx(0.04, ARCH - 0.3, 2 * A), M.dark, sx * hx, (ARCH + 0.3) / 2, ax.z, parent);            // inner wall
          add(Bx(W / 2 - hx, 0.04, 2 * A), M.dark, sx * (hx + W / 2) / 2, ARCH - 0.02, ax.z, parent);  // top
          for (const e of [-1, 1]) add(Bx(W / 2 - hx, ARCH - 0.3, 0.04), M.dark, sx * (hx + W / 2) / 2, (ARCH + 0.3) / 2, ax.z + e * A, parent); // ends
        }
      }
      seg(cur, z1);
      sides(0.16, 1.18, z0, z1, M.stripe, 0.02, 0.006);
      const roofY = dd ? H - 0.25 : 2.75;
      if (dd) { add(Bx(W, 0.32, len), M.body, 0, 2.55, mz, parent); add(Bx(W, 0.5, len), M.body, 0, H - 0.25, mz, parent); }
      else add(Bx(W, H - 2.65, len), M.body, 0, 2.65 + (H - 2.65) / 2, mz, parent);
      // Window bands (both sides), pillars between windows.
      const bands = dd ? [[1.25, 2.38], [2.72, H - 0.5]] : [[1.25, 2.65]];
      for (const [y0, y1] of bands) {
        for (const sx of [-1, 1]) add(new THREE.PlaneGeometry(len, y1 - y0).rotateY(sx * Math.PI / 2), M.glass, sx * (W / 2 - 0.01), (y0 + y1) / 2, mz, parent);
        for (let z = z0 + 0.2; z < z1; z += 1.9) for (const sx of [-1, 1]) add(Bx(0.06, y1 - y0, 0.12), M.body, sx * (W / 2 - 0.02), (y0 + y1) / 2, z, parent);
      }
      // Roof equipment (batteries / HVAC).
      add(Bx(W * 0.7, 0.35, len * 0.35), M.skirt, 0, roofY + 0.18 + (dd ? 0 : H - 2.75 - 0.2), mz, parent);
      // Interior: floor, ceiling, light strips, poles.
      add(Bx(W - 0.1, 0.05, len - 0.2), M.floor, 0, 0.36, mz, parent);
      add(Bx(W - 0.1, 0.03, len - 0.2), M.ceiling, 0, dd ? 2.32 : 2.55, mz, parent);
      const sz0 = cabFront ? z0 + 2.6 : z0 + 0.3;
      for (const sx of [-0.55, 0.55]) add(Bx(0.12, 0.03, z1 - sz0 - 0.3), M.strip, sx, dd ? 2.3 : 2.53, (sz0 + z1 - 0.3) / 2, parent);
      for (let z = z0 + 2.2; z < z1 - 0.5; z += 2.6) add(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 6), M.pole, 0.35, 1.45, z, parent);
      void doors; void cabFront; void cabRear;
    };
    // Front (and, when articulated, rear) sections.
    const L1 = spec.trailerLength ? spec.length : L;
    const lrAx = spec.wheelbase * 0.42;
    this.axlesBody = [{ z: -lf, steer: true }, { z: lrAx, steer: false }];
    const hitchLocal = spec.wheelbase * 0.42 + (spec.hitchBehindRear ?? 2);
    section(this.body, this.zFront, this.zFront + L1, true, true, !spec.trailerLength, this.axlesBody, spec.doors.filter((p) => p <= L1).map((p) => this.zFront + p));
    // Front face: windscreen, destination display, lights, bumper.
    const zf = this.zFront;
    add(new THREE.PlaneGeometry(W - 0.15, dd ? 1.3 : 1.75), M.glass, 0, dd ? 1.85 : 1.95, zf - 0.01);
    this.windscreen = { w: W - 0.15, h: dd ? 1.3 : 1.75, y: dd ? 1.85 : 1.95, z: zf - 0.02 };
    this.bumperF = add(Bx(W, 0.3, 0.12), M.dark, 0, 0.5, zf - 0.03);
    // Per-side lamp materials (they can be broken one at a time).
    this.headMats = { '-1': M.head.clone(), '1': M.head.clone() };
    this.tailMats = { '-1': M.brake.clone(), '1': M.brake.clone() };
    add(Bx(W, 0.8, 0.05), M.body, 0, 0.7, zf + 0.025); // front panel below the windscreen
    this.ledFront = ledTexture(512, 64);
    add(new THREE.PlaneGeometry(W - 0.4, 0.3), new THREE.MeshBasicMaterial({ map: this.ledFront.t }), 0, dd ? 2.55 : 3.0, zf - 0.02).rotation.y = Math.PI;
    if (dd) { add(new THREE.PlaneGeometry(W - 0.15, 1.1), M.glass, 0, 3.35, zf - 0.01); }
    for (const sx of [-1, 1]) {
      add(new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI), this.headMats[sx], sx * (W / 2 - 0.35), 0.82, zf - 0.04);
      add(Bx(0.18, 0.1, 0.05), sx < 0 ? M.indL : M.indR, sx * (W / 2 - 0.12), 0.82, zf - 0.04);
    }
    // Side destination display near the front door.
    this.ledSide = ledTexture(512, 64);
    add(new THREE.PlaneGeometry(1.6, 0.22).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.ledSide.t }), W / 2 + 0.01, dd ? 2.5 : 2.48, zf + 3.2);
    // Mirrors (exterior arms) — the cockpit renders their images.
    this.mirrorParts = {};
    for (const sx of [-1, 1]) { const arm = add(Bx(0.06, 0.06, 0.5), M.dark, sx * (W / 2 + 0.15), 2.5, zf + 0.15); const head = add(Bx(0.08, 0.45, 0.25), M.dark, sx * (W / 2 + 0.4), 2.25, zf + 0.25); this.mirrorParts[sx] = { arm, head }; }
    // Rear face of the last section (built below for trailers).
    const rearFace = (parent, zr) => {
      add(Bx(W, 2.3, 0.08), M.body, 0, 1.4, zr - 0.04, parent);
      add(new THREE.PlaneGeometry(W - 0.6, 0.7), M.glass, 0, 2.0, zr + 0.01, parent);
      this.bumperR = add(Bx(W, 0.28, 0.12), M.dark, 0, 0.5, zr + 0.03, parent); this.bumperR.userData.parent = parent;
      for (const sx of [-1, 1]) { add(Bx(0.2, 0.25, 0.05), this.tailMats[sx], sx * (W / 2 - 0.25), 0.95, zr + 0.02, parent); add(Bx(0.18, 0.1, 0.05), sx < 0 ? M.indL : M.indR, sx * (W / 2 - 0.25), 1.18, zr + 0.02, parent); add(Bx(0.12, 0.1, 0.05), M.rev, sx * (W / 2 - 0.55), 0.95, zr + 0.02, parent); }
      this.ledRear = ledTexture(128, 64);
      add(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: this.ledRear.t }), 0, 2.55, zr + 0.02, parent);
    };
    // Wheels.
    this.wheels = [];
    const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16); rimGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.06, 12); hubGeo.rotateZ(Math.PI / 2);
    const nutMat = new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.6, roughness: 0.4 });
    const wheel = (sx, z, steer, parent) => {
      const tw = tyreW(steer), x = sx * (W / 2 - 0.02 - tw / 2);
      const g = new THREE.Group(); g.position.set(x, 0.5, z); g.rotation.order = 'YXZ'; // steer about the vertical, then spin
      const tyre = new THREE.CylinderGeometry(0.5, 0.5, tw, 22); tyre.rotateZ(Math.PI / 2);
      g.add(new THREE.Mesh(tyre, M.tyre));
      const rimM = new THREE.Mesh(rimGeo, M.rim); rimM.position.x = sx * (tw / 2 - 0.015); g.add(rimM);
      const hub = new THREE.Mesh(hubGeo, nutMat); hub.position.x = sx * (tw / 2 + 0.005); g.add(hub);
      for (let k = 0; k < 6; k++) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.05), nutMat); const a = (k / 6) * Math.PI * 2; n.position.set(sx * (tw / 2 + 0.01), Math.cos(a) * 0.19, Math.sin(a) * 0.19); g.add(n); }
      parent.add(g); this.wheels.push({ g, steer });
    };
    const lr = spec.wheelbase * 0.42;
    for (const sx of [-1, 1]) { wheel(sx, -lf, true, this.group); wheel(sx, lr, false, this.group); }
    // Doors: two leaves per door on the right side.
    this.doorLeaves = spec.doors.map((pos) => {
      const zc2 = zf + pos;
      return [-1, 1].map((s) => {
        const leaf = add(Bx(0.05, 2.0, 0.6), M.glass, W / 2 + 0.03, 1.38, zc2 + s * 0.31);
        const frame = add(Bx(0.06, 2.0, 0.06), M.dark, 0, 0, s * 0.27, leaf); void frame;
        leaf.userData = { base: zc2 + s * 0.31, s, onTrailer: spec.trailerLength && pos > spec.length - 0.5 };
        return leaf;
      });
    });
    // Seats (left & right rows) and slots for passengers.
    this.seatSlots = []; this.standSlots = [];
    const seatGeo = Bx(0.45, 0.45, 0.45), backGeo = Bx(0.45, 0.6, 0.08);
    const doorZs = spec.doors.map((p) => zf + p);
    const freeZ = (z) => doorZs.every((d) => Math.abs(d - z) > 1.0) && z > zf + 1.8;
    const seats = (parent, z0, z1, zOff = 0, axles = []) => {
      let n = 0;
      for (let z = z0; z < z1 && n < spec.seats; z += 0.85) {
        if (axles.some((a) => Math.abs(a.z - z) < A + 0.3)) continue; // wheel housings
        for (const x of [-W / 2 + 0.35, -W / 2 + 0.8, W / 2 - 0.35, W / 2 - 0.8]) {
          if (x > 0 && !freeZ(z + zOff)) continue;
          add(seatGeo, M.seat, x, 0.6, z, parent); add(backGeo, M.seat, x, 1.0, z + 0.22, parent);
          this.seatSlots.push({ parent, x, y: 0.62, z, taken: false });
          n++;
        }
        this.standSlots.push({ parent, x: 0.05, y: 0.38, z, taken: false });
      }
    };
    seats(this.body, zf + 2.6, zf + L1 - 0.6, 0, this.axlesBody); // behind the driver's cab
    // Ticket validator next to the front door.
    this.validator = ledTexture(128, 96);
    add(Bx(0.18, 0.28, 0.14), M.dark, W / 2 - 0.45, 1.3, zf + 0.7);
    add(new THREE.PlaneGeometry(0.14, 0.1).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.validator.t }), W / 2 - 0.54, 1.33, zf + 0.7);
    add(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), M.pole, W / 2 - 0.45, 0.8, zf + 0.7);
    this.drawValidator('ready');
    // Articulated trailer.
    if (spec.trailerLength) {
      this.trailer = new THREE.Group(); this.group.add(this.trailer);
      const T = spec.trailerLength;
      const at0 = spec.trailerAxle ?? 5.4;
      section(this.trailer, 0.4, T, true, false, true, [{ z: at0, steer: false }], spec.doors.filter((p) => p > L1).map((p) => zf + p - hitchLocal));
      rearFace(this.trailer, T);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.0, 16, 6, true), new THREE.MeshLambertMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide }));
      bell.rotation.x = Math.PI / 2; bell.scale.set(1, 1, 1.15); bell.position.set(0, 1.55, 0); this.trailer.add(bell);
      for (const sx of [-1, 1]) wheel(sx, at0, false, this.trailer);
      seats(this.trailer, 1.2, T - 0.8, 0, [{ z: at0 }]);
      // Doors on the trailer: re-parent leaves that belong to it.
      this.doorLeaves.forEach((pair, i) => {
        const pos = spec.doors[i];
        if (pos <= L1) return;
        for (const leaf of pair) { this.body.remove(leaf); this.trailer.add(leaf); const local = zf + pos - (spec.wheelbase * 0.42 + (spec.hitchBehindRear ?? 2)); leaf.userData.base = local + leaf.userData.s * 0.31; leaf.position.z = leaf.userData.base; }
      });
    } else rearFace(this.body, this.zFront + L1);
    this.hitchZ = lr + (spec.hitchBehindRear ?? 2);
    // "ARRÊT DEMANDÉ" signs, as in French buses: one at the front above the windscreen facing the saloon,
    // repeaters under the ceiling; they light up red when a passenger presses a stop button.
    const signTex = (lit) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 112; const g = c.getContext('2d');
      g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 512, 112);
      g.fillStyle = lit ? '#ff2a1a' : '#241010'; g.font = 'bold 62px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (lit) { g.shadowColor = '#ff3a20'; g.shadowBlur = 18; }
      g.fillText('ARRÊT DEMANDÉ', 256, 60);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    this.stopSignMat = new THREE.MeshBasicMaterial({ map: signTex(false), side: THREE.DoubleSide });
    this.stopSignTex = { off: this.stopSignMat.map, on: signTex(true) };
    const ceil = dd ? 2.3 : 2.53;
    const stopSign = (parent, z, w = 0.62, x = 0) => {
      const h = w * 0.22;
      add(Bx(w + 0.04, h + 0.04, 0.06), M.dark, x, ceil - 0.1, z, parent);
      const pl = add(new THREE.PlaneGeometry(w, h), this.stopSignMat, x, ceil - 0.1, z + 0.031, parent); void pl;
      const pr = add(new THREE.PlaneGeometry(w, h), this.stopSignMat, x, ceil - 0.1, z - 0.031, parent); pr.rotation.y = Math.PI;
    };
    stopSign(this.body, zf + 0.25, 0.7, 0.25); // above the windscreen, right of the driver's line of sight
    for (let z = zf + 5.2; z < zf + L1 - 1.5; z += 4.6) stopSign(this.body, z);
    if (this.trailer) for (let z = 2.2; z < spec.trailerLength - 1; z += 4.6) stopSign(this.trailer, z);
    // Manual wheelchair ramp, hinged at the sill of the second door: folded inside, flips out onto the kerb.
    const rd = Math.min(1, spec.doors.length - 1), leaf = this.doorLeaves[rd][0];
    this.ramp = new THREE.Group(); this.ramp.position.set(W / 2 - 0.02, 0.4, (this.doorLeaves[rd][0].userData.base + this.doorLeaves[rd][1].userData.base) / 2);
    leaf.parent.add(this.ramp);
    const plate = new THREE.Mesh(Bx(0.9, 0.03, 0.82), new THREE.MeshStandardMaterial({ color: 0x8d949b, metalness: 0.5, roughness: 0.6 })); plate.position.x = -0.45; this.ramp.add(plate);
    const edge = new THREE.Mesh(Bx(0.06, 0.035, 0.82), new THREE.MeshLambertMaterial({ color: 0xffc400 })); edge.position.x = -0.87; this.ramp.add(edge);
  }

  drawValidator(state) {
    const g = this.validator.c.getContext('2d');
    const col = { ready: '#1f3c88', ok: '#1f9e4a', nfc: '#1f9e4a', ko: '#c8352a' }[state] || '#1f3c88';
    g.fillStyle = col; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText({ ready: 'VALIDEZ', ok: '✓ VALIDÉ', nfc: '✓ SANS CONTACT', ko: '✗ REFUSÉ' }[state], 64, 48);
    this.validator.t.needsUpdate = true;
  }
  setDestination(number, dest, color) {
    drawLed(this.ledFront, number, dest); drawLed(this.ledSide, number, dest);
    if (this.ledRear) { const g = this.ledRear.c.getContext('2d'); g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#ff9a1a'; g.font = 'bold 44px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(number, 64, 34); this.ledRear.t.needsUpdate = true; }
    void color;
  }

  /** Place the model from the physics state and vehicle systems. */
  update(v, t) {
    const ph = v.ph;
    // On the terrain: height under the centre, pitched to the slope between the axles.
    const H = this.heightAt || (() => 0);
    const fx = Math.sin(ph.yaw), fz = -Math.cos(ph.yaw), half = this.spec.wheelbase / 2;
    const slope = (H(ph.x + fx * half, ph.z + fz * half) - H(ph.x - fx * half, ph.z - fz * half)) / (2 * half);
    this.group.position.set(ph.x, H(ph.x, ph.z), ph.z);
    this.group.rotation.set(Math.atan(slope), -ph.yaw, 0, 'YXZ');
    this.body.rotation.set(-ph.pitch, 0, ph.roll);
    this.body.position.y = ph.heave + (v.kneelT ? -0.07 * v.kneelT : 0);
    for (const w of this.wheels) { w.g.rotation.x = -ph.wheelSpin; if (w.steer) w.g.rotation.y = -ph.delta; }
    // Ramp: folded inside (plate pointing inwards) → flipped out, sloping down to the kerb.
    if (this.ramp) this.ramp.rotation.z = -(v.rampT || 0) * (Math.PI + 0.22);
    if (this.trailer) {
      const hb = this.hitchZ;
      this.trailer.position.set(0, 0, hb);
      this.trailer.rotation.y = -(ph.trailerYaw - ph.yaw);
      this.trailer.rotation.z = ph.roll * 0.8;
    }
    // Doors: plug doors move out 6 cm, then slide apart.
    v.doors.forEach((d, i) => {
      const a = d.amount, out = Math.min(1, a * 3) * 0.08, slide = Math.max(0, a - 0.3) / 0.7 * 0.62;
      for (const leaf of this.doorLeaves[i]) { leaf.position.x = this.spec.width / 2 + 0.03 + out; leaf.position.z = leaf.userData.base + leaf.userData.s * slide; }
    });
    // Lights.
    const night = v.lights > 0;
    const dmg = v.damage;
    if (dmg && dmg.version !== this.dmgVersion) { this.dmgVersion = dmg.version; this.applyDamage(dmg); }
    const flicker = dmg?.failures.includes('electrical') && Math.sin(t * 23) * Math.sin(t * 7.1) > 0.3;
    const headCol = flicker ? 0x222222 : night ? (v.lights === 2 ? 0xffffff : 0xfff4d6) : 0x777777;
    for (const sx of ['-1', '1']) this.headMats[sx].color.setHex(dmg?.broken[sx === '-1' ? 'headL' : 'headR'] ? 0x161616 : headCol);
    const tailCol = ph.brakeP > 0.05 || v.parking ? 0xff1a00 : night ? 0x661100 : 0x330000;
    for (const sx of ['-1', '1']) this.tailMats[sx].color.setHex(dmg?.broken[sx === '-1' ? 'tailL' : 'tailR'] ? 0x1a0a08 : tailCol);
    if (dmg?.distortion) { this.body.rotation.z += dmg.distortion * 0.022; this.body.rotation.y = dmg.distortion * 0.012; }
    if (dmg) this.body.position.y += dmg.rideDrop();
    this.M.rev.color.setHex(v.gearSel === 'R' ? 0xffffff : 0x444444);
    const bl = v.blinkOn;
    this.M.indL.color.setHex(bl && (v.indicator === 'left' || v.hazards) ? 0xffa000 : 0x553300);
    this.M.indR.color.setHex(bl && (v.indicator === 'right' || v.hazards) ? 0xffa000 : 0x553300);
    this.M.strip.color.setHex(v.interiorLights ? 0xfff6e0 : 0x555555);
    const sm = v.stopRequest ? this.stopSignTex.on : this.stopSignTex.off;
    if (this.stopSignMat.map !== sm) { this.stopSignMat.map = sm; this.stopSignMat.needsUpdate = true; }
    void t;
  }

  /**
   * Visible damage: dents deformed into the panels where the bus was hit, scratched paint, cracked windscreen and
   * side windows, broken lamps, torn-off mirrors, bumpers pushed in, a distorted body after major impacts.
   */
  applyDamage(d) {
    if (this.dmgGroup) { this.body.remove(this.dmgGroup); this.dmgGroup.traverse((o) => o.geometry?.dispose()); }
    const G = this.dmgGroup = new THREE.Group(); this.body.add(G);
    const sp = this.spec, W = sp.width, zf = this.zFront, zr = this.zFront + (sp.trailerLength ? sp.length : sp.length);
    const T = damageTextures();
    const dentMat = this.M.body.clone(); dentMat.color.multiplyScalar(0.82); dentMat.map = T.scratch; dentMat.side = THREE.DoubleSide;
    for (const dent of d.dents) {
      const w = Math.min(2.6, dent.r * 2), h = Math.min(1.15, dent.r * 1.3);
      const geo = new THREE.PlaneGeometry(w, h, 14, 8);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2), rr = x * x + y * y;
        const push = dent.depth * Math.exp(-rr * 2.2) * (1 + 0.25 * Math.sin(x * 9 + dent.along) * Math.sin(y * 7));
        pos.setZ(i, -push); // into the body
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, dentMat);
      if (dent.side === 'left' || dent.side === 'right') {
        const sx = dent.side === 'left' ? -1 : 1;
        m.position.set(sx * (W / 2 + 0.012), 0.9, -dent.along); m.rotation.y = sx * Math.PI / 2;
      } else {
        const front = dent.side === 'front';
        m.position.set(dent.along, 0.8, front ? zf - 0.015 : zr + 0.015); m.rotation.y = front ? Math.PI : 0;
      }
      G.add(m);
    }
    // Cracked glass overlays (visible from outside and from the cab).
    const crack = (w, h, x, y, z, ry, amount) => {
      const mat = new THREE.MeshBasicMaterial({ map: T.crack, transparent: true, opacity: Math.min(0.95, 0.3 + amount * 0.7), depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 6; G.add(m);
    };
    if (d.broken.windscreen > 0.2) { const ws = this.windscreen; crack(ws.w * (0.5 + d.broken.windscreen * 0.5), ws.h, d.dents.find((x) => x.side === 'front')?.along * 0.5 || 0, ws.y, ws.z, 0, d.broken.windscreen); }
    for (const [side, key] of [[-1, 'windowsL'], [1, 'windowsR']]) {
      if (d.broken[key] < 0.2) continue;
      for (const dent of d.dents.filter((x) => x.side === (side < 0 ? 'left' : 'right'))) crack(1.6, 1.1, side * (W / 2 + 0.02), 1.9, -dent.along, side * Math.PI / 2, d.broken[key]);
    }
    // Mirrors torn off / hanging.
    for (const sx of [-1, 1]) {
      const br = d.broken[sx < 0 ? 'mirrorL' : 'mirrorR'], mp = this.mirrorParts[sx];
      mp.head.visible = !br; mp.arm.rotation.z = br ? sx * 0.9 : 0; mp.arm.position.y = br ? 2.32 : 2.5;
    }
    // Bumpers pushed in and twisted.
    const fd = d.zones.front, rd = d.zones.rear;
    const fDent = d.dents.filter((x) => x.side === 'front').sort((a, b) => b.depth - a.depth)[0];
    this.bumperF.position.z = zf - 0.03 + fd * 0.22; this.bumperF.rotation.set(fd * 0.12, fDent ? Math.sign(fDent.along) * fd * 0.18 : 0, fd * 0.06);
    if (this.bumperR) { this.bumperR.position.z = (this.bumperR.userData.z0 ??= this.bumperR.position.z) - rd * 0.2; this.bumperR.rotation.set(-rd * 0.1, 0, rd * 0.05); }
  }

  /** World transform helper for points in the front-section local frame. */
  localToWorld(p) { return this.body.localToWorld(p); }
  dispose(scene) { scene.remove(this.group); }
}
