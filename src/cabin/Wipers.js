// Windscreen wipers of the TGV power car, with rain on the glass.
// Two tandem arms pivot at the foot of the windscreen and sweep it on the real glass surface (the arm is a ribbon
// laid on the lofted windscreen, recomputed each frame). Rain lands on the glass as droplets that build up into a
// haze — drawn on a texture covering the windscreen, so it really reduces what the driver sees — and every
// sweep removes the droplets inside the swept sector. Modes: OFF, INT (one sweep every few seconds), LOW, HIGH,
// and a single-wipe command; arms always finish their sweep and park.
import * as THREE from 'three';
import { wsPoint, windscreenGeometry, powerCarHeight } from '../world/TrainModel.js';

export const WIPER_MODES = ['off', 'int', 'low', 'high'];
export const WIPER_LABEL = { off: 'OFF', int: 'INT', low: 'LOW', high: 'HIGH' };
const PERIOD = { int: 1.6, low: 1.5, high: 0.85 };   // seconds per sweep (out and back)
const PAUSE = { int: 4.5, low: 0, high: 0 };          // dwell at the park position between sweeps
const MAX_DROPS = 1400;

export class Wipers {
  /** model: the player's TrainModel (TGV); the arms and the rain layer are attached to its leading power car. */
  constructor(model) {
    const sp = model.specs;
    this.W = sp.width; this.L = sp.carLength; this.H = powerCarHeight(sp);
    this.mode = 'off'; this.single = false; this.phase = 0; this.wait = 0; this.angle = 0; this.prevAngle = 0;
    this.Wm = 2.4; this.Hm = 3.4;                          // metric size of the glass (u across, v up)
    this.arms = [{ pu: 0.2, len: 1.9 }, { pu: 0.62, len: 1.9 }];
    this.drops = [];
    this.wetness = 0;
    // Rain layer on the glass (inside the windscreen opening, just in front of the glass).
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    this.canvas = c; this.ctx = c.getContext('2d');
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this.rainMesh = new THREE.Mesh(windscreenGeometry(this.W, this.L, this.H).glass, mat);
    this.rainMesh.renderOrder = 5;
    this.rainMesh.scale.setScalar(1.0);
    const host = model.noseFront;
    host.add(this.rainMesh);
    // Drop sprite.
    const d = document.createElement('canvas'); d.width = d.height = 32;
    const g = d.getContext('2d'), gr = g.createRadialGradient(13, 12, 1, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(210,225,235,0.55)'); gr.addColorStop(0.8, 'rgba(120,140,155,0.35)'); gr.addColorStop(1, 'rgba(120,140,155,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    this.dropImg = d;
    // Arms: ribbons on the glass (arm + blade), updated each frame.
    const armMat = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide });
    this.N = 14;
    for (const a of this.arms) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((this.N + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const idx = []; for (let i = 0; i < this.N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      geo.setIndex(idx);
      a.mesh = new THREE.Mesh(geo, armMat); a.mesh.frustumCulled = false; a.mesh.renderOrder = 6;
      host.add(a.mesh);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), armMat);
      const P = this.surface(a.pu, 0.02, 1.02); hub.position.set(P.x, P.y, P.z); host.add(hub);
    }
    this.drawAcc = 1;
    this.updateArms();
    this.draw();
  }

  /** Point on the glass for (u across 0..1, v up 0..1), pushed slightly outwards by `out`. */
  surface(u, v, out = 1.012) {
    return wsPoint(this.W, this.L, this.H, Math.max(-1.05, Math.min(1.05, u * 2 - 1)), Math.max(0, Math.min(1, v)), {}, out);
  }

  setMode(m) { if (WIPER_MODES.includes(m)) { this.mode = m; if (m !== 'off' && this.phase === 0 && this.wait <= 0) this.wait = 0; } }
  cycle() { this.setMode(WIPER_MODES[(WIPER_MODES.indexOf(this.mode) + 1) % WIPER_MODES.length]); return this.mode; }
  wipeOnce() { this.single = true; }
  get label() { return WIPER_LABEL[this.mode] + (this.single ? ' · 1×' : ''); }
  /** Share of the glass covered with water (0..1): what the driver loses. */
  get coverage() { return Math.min(1, this.drops.length / MAX_DROPS); }

  /** rain 0..1, v (m/s). */
  update(dt, rain, v) {
    dt = Math.min(dt, 0.1);
    // Arm motion: 0 → 1 → 0 (out and back) per sweep; the park position is angle 0.
    const running = this.mode !== 'off' || this.single || this.phase > 0;
    this.prevAngle = this.angle;
    if (running) {
      if (this.phase === 0 && this.wait > 0 && !this.single) this.wait -= dt;
      else {
        const per = PERIOD[this.mode] || PERIOD.low;
        this.phase += dt / per;
        if (this.phase >= 1) {
          this.phase = 0; this.single = false;
          this.wait = PAUSE[this.mode] || 0;
        }
      }
    }
    const x = this.phase;
    this.angle = (1 - Math.cos(x * Math.PI * 2)) / 2;        // smooth crank-driven motion, zero speed at both ends
    // Rain: drops land faster at speed (the train runs into the rain); they run down slowly.
    if (rain > 0.01) {
      const rate = rain * (60 + Math.min(Math.abs(v), 90) * 4.5);
      let n = rate * dt; while (n > 0) { if (n >= 1 || Math.random() < n) this.addDrop(); n -= 1; }
    }
    for (const d of this.drops) { d.v -= d.run * dt * (0.2 + rain); if (d.v < -0.05) d.dead = true; }
    // Wiping: remove the drops in the sector swept since the last frame.
    if (this.angle !== this.prevAngle) this.sweep(Math.min(this.prevAngle, this.angle), Math.max(this.prevAngle, this.angle));
    if (this.drops.some((d) => d.dead)) this.drops = this.drops.filter((d) => !d.dead);
    this.updateArms();
    this.drawAcc += dt;
    if (this.drawAcc > 0.08) { this.drawAcc = 0; this.draw(); }
  }

  armAngle(a) { return 0.05 + a * 1.92; }                     // radians from the park position (along the foot of the glass)
  addDrop() {
    if (this.drops.length >= MAX_DROPS) this.drops.splice(0, 40);   // old drops merge into the film
    const big = Math.random() < 0.15;
    this.drops.push({ u: Math.random(), v: Math.random(), r: (big ? 2.5 : 1.1) + Math.random() * 2.2, run: big ? 0.03 + Math.random() * 0.05 : 0.004 });
  }
  sweep(a0, a1) {
    const th0 = this.armAngle(a0) - 0.02, th1 = this.armAngle(a1) + 0.02;
    for (const arm of this.arms) {
      const px = arm.pu * this.Wm, py = 0.03 * this.Hm;
      for (const d of this.drops) {
        if (d.dead) continue;
        const dx = d.u * this.Wm - px, dy = d.v * this.Hm - py, r = Math.hypot(dx, dy);
        if (r < 0.12 || r > arm.len) continue;
        const th = Math.atan2(dy, dx);                               // 0 = park (pointing across the glass), π/2 = up
        if (th >= th0 && th <= th1) d.dead = true;
      }
    }
  }
  updateArms() {
    const th = this.armAngle(this.angle);
    for (const arm of this.arms) {
      const pos = arm.mesh.geometry.attributes.position.array;
      const px = arm.pu * this.Wm, py = 0.03 * this.Hm, dx = Math.cos(th), dy = Math.sin(th);
      for (let i = 0; i <= this.N; i++) {
        const r = 0.06 + (arm.len - 0.06) * (i / this.N), w = i < this.N * 0.3 ? 0.028 : 0.018;
        for (const [k, sgn] of [[0, -1], [1, 1]]) {
          const X = px + dx * r - dy * w * sgn, Y = py + dy * r + dx * w * sgn;
          const P = this.surface(Math.max(-0.05, Math.min(1.05, X / this.Wm)), Math.max(0, Math.min(1.02, Y / this.Hm)), 1.016);
          pos.set([P.x, P.y, P.z], (i * 2 + k) * 3);
        }
      }
      arm.mesh.geometry.attributes.position.needsUpdate = true;
      arm.mesh.geometry.computeBoundingSphere();
    }
  }
  draw() {
    const g = this.ctx, S = 512;
    g.clearRect(0, 0, S, S);
    const cov = this.coverage;
    this.wetness = cov;
    if (cov > 0.01) { g.fillStyle = `rgba(190,200,210,${(cov * 0.42).toFixed(3)})`; g.fillRect(0, 0, S, S); }
    // Swept areas stay clearer: the haze is drawn only where drops are, as soft blobs.
    for (const d of this.drops) { const s = d.r * 3.2; g.drawImage(this.dropImg, d.u * S - s / 2, (1 - d.v) * S - s / 2, s, s * (d.run > 0.01 ? 1.6 : 1)); }
    this.tex.needsUpdate = true;
  }
  dispose() { this.rainMesh.parent?.remove(this.rainMesh); for (const a of this.arms) a.mesh.parent?.remove(a.mesh); this.tex.dispose(); }
}
