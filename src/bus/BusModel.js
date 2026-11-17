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
    const section = (parent, z0, z1, doors, cabFront, cabRear) => {
      const len = z1 - z0, mz = (z0 + z1) / 2;
      add(Bx(W, 0.95, len), M.body, 0, 0.78, mz, parent);
      add(Bx(W + 0.02, 0.22, len), M.skirt, 0, 0.36, mz, parent);
      add(Bx(W + 0.01, 0.16, len), M.stripe, 0, 1.18, mz, parent);
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
    section(this.body, this.zFront, this.zFront + L1, true, true, !spec.trailerLength);
    // Front face: windscreen, destination display, lights, bumper.
    const zf = this.zFront;
    add(new THREE.PlaneGeometry(W - 0.15, dd ? 1.3 : 1.75), M.glass, 0, dd ? 1.85 : 1.95, zf - 0.01);
    add(Bx(W, 0.3, 0.12), M.dark, 0, 0.5, zf - 0.03);
    this.ledFront = ledTexture(512, 64);
    add(new THREE.PlaneGeometry(W - 0.4, 0.3), new THREE.MeshBasicMaterial({ map: this.ledFront.t }), 0, dd ? 2.55 : 3.0, zf - 0.02).rotation.y = Math.PI;
    if (dd) { add(new THREE.PlaneGeometry(W - 0.15, 1.1), M.glass, 0, 3.35, zf - 0.01); }
    for (const sx of [-1, 1]) {
      add(new THREE.CircleGeometry(0.13, 16).rotateY(Math.PI), M.head, sx * (W / 2 - 0.35), 0.82, zf - 0.04);
      add(Bx(0.18, 0.1, 0.05), sx < 0 ? M.indL : M.indR, sx * (W / 2 - 0.12), 0.82, zf - 0.04);
    }
    // Side destination display near the front door.
    this.ledSide = ledTexture(512, 64);
    add(new THREE.PlaneGeometry(1.6, 0.22).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.ledSide.t }), W / 2 + 0.01, dd ? 2.5 : 2.48, zf + 3.2);
    // Mirrors (exterior arms) — the cockpit renders their images.
    for (const sx of [-1, 1]) { add(Bx(0.06, 0.06, 0.5), M.dark, sx * (W / 2 + 0.15), 2.5, zf + 0.15); add(Bx(0.08, 0.45, 0.25), M.dark, sx * (W / 2 + 0.4), 2.25, zf + 0.25); }
    // Rear face of the last section (built below for trailers).
    const rearFace = (parent, zr) => {
      add(Bx(W, 2.3, 0.08), M.body, 0, 1.4, zr - 0.04, parent);
      add(new THREE.PlaneGeometry(W - 0.6, 0.7), M.glass, 0, 2.0, zr + 0.01, parent);
      for (const sx of [-1, 1]) { add(Bx(0.2, 0.25, 0.05), M.brake, sx * (W / 2 - 0.25), 0.95, zr + 0.02, parent); add(Bx(0.18, 0.1, 0.05), sx < 0 ? M.indL : M.indR, sx * (W / 2 - 0.25), 1.18, zr + 0.02, parent); add(Bx(0.12, 0.1, 0.05), M.rev, sx * (W / 2 - 0.55), 0.95, zr + 0.02, parent); }
      this.ledRear = ledTexture(128, 64);
      add(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: this.ledRear.t }), 0, 2.55, zr + 0.02, parent);
    };
    // Wheels.
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18); wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.34, 12); rimGeo.rotateZ(Math.PI / 2);
    const wheel = (x, z, steer, parent) => { const g = new THREE.Group(); g.position.set(x, 0.5, z); g.add(new THREE.Mesh(wheelGeo, M.tyre), new THREE.Mesh(rimGeo, M.rim)); parent.add(g); this.wheels.push({ g, steer }); };
    const lr = spec.wheelbase * 0.42;
    for (const sx of [-1, 1]) { wheel(sx * (W / 2 - 0.3), -lf, true, this.group); wheel(sx * (W / 2 - 0.3), lr, false, this.group); }
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
    const seats = (parent, z0, z1, zOff = 0) => {
      let n = 0;
      for (let z = z0; z < z1 && n < spec.seats; z += 0.85) {
        for (const x of [-W / 2 + 0.35, -W / 2 + 0.8, W / 2 - 0.35, W / 2 - 0.8]) {
          if (x > 0 && !freeZ(z + zOff)) continue;
          add(seatGeo, M.seat, x, 0.6, z, parent); add(backGeo, M.seat, x, 1.0, z + 0.22, parent);
          this.seatSlots.push({ parent, x, y: 0.62, z, taken: false });
          n++;
        }
        this.standSlots.push({ parent, x: 0.05, y: 0.38, z, taken: false });
      }
    };
    seats(this.body, zf + 1.8, zf + L1 - 0.6);
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
      section(this.trailer, 0.4, T, true, false, true);
      rearFace(this.trailer, T);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.0, 16, 6, true), new THREE.MeshLambertMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide }));
      bell.rotation.x = Math.PI / 2; bell.scale.set(1, 1, 1.15); bell.position.set(0, 1.55, 0); this.trailer.add(bell);
      const at = spec.trailerAxle ?? 5.4;
      for (const sx of [-1, 1]) wheel(sx * (W / 2 - 0.3), at, false, this.trailer);
      seats(this.trailer, 1.2, T - 0.8, 0);
      // Doors on the trailer: re-parent leaves that belong to it.
      this.doorLeaves.forEach((pair, i) => {
        const pos = spec.doors[i];
        if (pos <= L1) return;
        for (const leaf of pair) { this.body.remove(leaf); this.trailer.add(leaf); const local = zf + pos - (spec.wheelbase * 0.42 + (spec.hitchBehindRear ?? 2)); leaf.userData.base = local + leaf.userData.s * 0.31; leaf.position.z = leaf.userData.base; }
      });
    } else rearFace(this.body, this.zFront + L1);
    this.hitchZ = lr + (spec.hitchBehindRear ?? 2);
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
    this.group.position.set(ph.x, 0, ph.z);
    this.group.rotation.y = -ph.yaw;
    this.body.rotation.set(-ph.pitch, 0, ph.roll);
    this.body.position.y = ph.heave + (v.kneelT ? -0.07 * v.kneelT : 0);
    for (const w of this.wheels) { w.g.rotation.x = -ph.wheelSpin; if (w.steer) w.g.rotation.y = -ph.delta; }
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
    this.M.head.color.setHex(night ? (v.lights === 2 ? 0xffffff : 0xfff4d6) : 0x777777);
    this.M.brake.color.setHex(ph.brakeP > 0.05 || v.parking ? 0xff1a00 : night ? 0x661100 : 0x330000);
    this.M.rev.color.setHex(v.gearSel === 'R' ? 0xffffff : 0x444444);
    const bl = v.blinkOn;
    this.M.indL.color.setHex(bl && (v.indicator === 'left' || v.hazards) ? 0xffa000 : 0x553300);
    this.M.indR.color.setHex(bl && (v.indicator === 'right' || v.hazards) ? 0xffa000 : 0x553300);
    this.M.strip.color.setHex(v.interiorLights ? 0xfff6e0 : 0x555555);
    void t;
  }

  /** World transform helper for points in the front-section local frame. */
  localToWorld(p) { return this.body.localToWorld(p); }
  dispose(scene) { scene.remove(this.group); }
}
