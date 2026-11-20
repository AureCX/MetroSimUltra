// Platform screen doors (Line D – Aéroval), after the façades fitted to Paris Metro line 1: glass panels along
// the whole platform edge with a sliding door pair in front of every train door, a steel header carrying the
// door motors, an amber warning light over every opening and floor markings. One PlatformDoorSide per platform
// edge holds the state machine; doors only open when the train is stopped on the marker, open and close together
// with the train doors, reopen on an obstruction, and report "closed & locked" to the train's interlock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PSD = { HEIGHT: 2.15, HEADER: 0.35, OPEN_TIME: 2.0, CLOSE_TIME: 2.4, TOLERANCE: 0.8 };

/** Door centres (m from the train front) of a formation. */
export function trainDoorOffsets(specs) {
  const out = [];
  for (let c = 0; c < specs.cars; c++) {
    const start = c * (specs.carLength + specs.carGap);
    for (const z of specs.doorZ) out.push(start + specs.carLength / 2 - z);
  }
  return out;
}

let MATS;
function mats() {
  if (MATS) return MATS;
  MATS = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfd6e2, metalness: 0.05, roughness: 0.05, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, metalness: 0.75, roughness: 0.32 }),
    header: new THREE.MeshStandardMaterial({ color: 0x5c6168, metalness: 0.5, roughness: 0.45 }),
    rubber: new THREE.MeshLambertMaterial({ color: 0x1b1d20 }),
    markYellow: new THREE.MeshBasicMaterial({ color: 0xf2c200, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    markWhite: new THREE.MeshBasicMaterial({ color: 0xe9e6dc, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    sticker: new THREE.MeshBasicMaterial({ color: 0xff8000, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  };
  return MATS;
}

export class PlatformDoorSide {
  /**
   * parent: station group (local frame: +z along direction A, x lateral). x: lateral position of the screen line.
   * facing: +1 when the platform lies at +x of the screen line. doorZ: local z of the door centres. Lp: platform length.
   */
  constructor(parent, { x, facing, doorZ, Lp, doorWidth, platformY, id, color }) {
    const M = mats();
    this.id = id;
    this.g = new THREE.Group(); this.g.name = `psd:${id}`; parent.add(this.g);
    this.state = 'locked'; this.amount = 0; this.t = 0; this.retries = 0; this.fault = null; this.blink = 0;
    const H = PSD.HEIGHT, y0 = platformY, open = doorWidth + 0.2;
    this.openings = doorZ.map((z) => ({ z, w: open }));
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); this.g.add(m); return m; };
    // Fixed glass panels with mullions between the openings.
    const z0 = -Lp / 2 + 0.8, z1 = Lp / 2 - 0.8;
    const sorted = [...this.openings].sort((a, b) => a.z - b.z);
    const gaps = []; let cur = z0;
    for (const o of sorted) { const a = Math.max(z0, o.z - o.w / 2 - 0.12), b = Math.min(z1, o.z + o.w / 2 + 0.12); if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < z1) gaps.push([cur, z1]);
    const glassGeo = [], frameGeo = [];
    const panel = (a, b) => {
      const g = new THREE.PlaneGeometry(b - a, H - 0.16); g.rotateY(Math.PI / 2); g.translate(x, y0 + 0.08 + (H - 0.16) / 2, (a + b) / 2); glassGeo.push(g);
    };
    const bar = (w, h, d, px, py, pz) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(px, py, pz); frameGeo.push(g.toNonIndexed()); };
    for (const [a, b] of gaps) {
      const n = Math.max(1, Math.round((b - a) / 1.6)), step = (b - a) / n;
      for (let i = 0; i < n; i++) panel(a + i * step + 0.03, a + (i + 1) * step - 0.03);
      for (let i = 0; i <= n; i++) bar(0.07, H, 0.06, x, y0 + H / 2, a + i * step);
      bar(0.07, 0.08, b - a, x, y0 + 0.04, (a + b) / 2);                // bottom rail
    }
    for (const o of sorted) for (const e of [-1, 1]) bar(0.09, H + PSD.HEADER, 0.1, x, y0 + (H + PSD.HEADER) / 2, o.z + e * (o.w / 2 + 0.06)); // door posts
    // Header beam with the door motors, the whole length.
    bar(0.32, PSD.HEADER, z1 - z0 + 0.2, x + facing * 0.08, y0 + H + PSD.HEADER / 2, (z0 + z1) / 2);
    if (glassGeo.length) add(mergeAll(glassGeo), M.glass, 0, 0, 0).renderOrder = 3;
    add(mergeAll(frameGeo), M.frame, 0, 0, 0);
    // Moving leaves (two per opening), warning lights and floor markings.
    this.leaves = []; this.lights = [];
    const lightOff = new THREE.MeshBasicMaterial({ color: 0x4a3410 });
    this.lightOn = new THREE.MeshBasicMaterial({ color: 0xffa000 }); this.lightOff = lightOff;
    for (const o of sorted) {
      for (const s of [-1, 1]) {
        const leaf = new THREE.Group(); leaf.position.set(x - facing * 0.05, y0, o.z + s * o.w / 4); this.g.add(leaf);
        const lw = o.w / 2;
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.06, H - 0.2), M.glass); gl.rotation.y = Math.PI / 2; gl.position.y = H / 2; gl.renderOrder = 3; leaf.add(gl);
        for (const [h, py] of [[0.06, 0.05], [0.06, H - 0.05]]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, lw), M.frame); r.position.y = py; leaf.add(r); }
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, 0.05), M.rubber); edge.position.set(0, H / 2, -s * (lw / 2 - 0.025)); leaf.add(edge);
        const st = new THREE.Mesh(new THREE.PlaneGeometry(lw * 0.6, 0.08), M.sticker); st.rotation.y = Math.PI / 2; st.position.set(facing * 0.004, 1.05, 0); leaf.add(st);
        this.leaves.push({ leaf, base: o.z + s * o.w / 4, dir: s, travel: o.w / 2 - 0.04 });
      }
      const lamp = add(new THREE.BoxGeometry(0.12, 0.08, 0.3), lightOff, x + facing * 0.17, y0 + H + PSD.HEADER - 0.02, o.z);
      this.lights.push(lamp);
      // Door marking on the platform: yellow frame with white arrows (alight at the sides, board in the middle).
      const mk = (w, d, m, px, pz) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); q.rotation.x = -Math.PI / 2; q.position.set(px, y0 + 0.012, pz); this.g.add(q); };
      const dx = facing * 0.9;
      mk(1.4, 0.08, M.markYellow, x + dx, o.z - o.w / 2); mk(1.4, 0.08, M.markYellow, x + dx, o.z + o.w / 2);
      mk(0.08, o.w, M.markYellow, x + facing * 1.6, o.z);
      for (const s of [-1, 1]) mk(0.5, 0.18, M.markWhite, x + facing * 0.7, o.z + s * (o.w / 2 - 0.25));
    }
  }

  get locked() { return this.state === 'locked'; }

  /** Commands from the train / signalling. */
  open() {
    if (this.fault) return false;
    if (this.state === 'open' || this.state === 'opening') return true;
    this.state = 'opening'; this.t = 0; this.retries = 0; return true;
  }
  close() { if (this.state === 'open' || this.state === 'opening') { this.state = 'warning'; this.t = 0; } }
  /** Cleared by the driver re-opening, then closing the doors. */
  reset() { this.fault = null; }

  /**
   * obstructed(): something stands in a doorway. Returns events: 'locked' | 'obstructed' | 'fault' | null.
   * trainAmount (0..1, optional) keeps the screen doors in step with the train doors.
   */
  update(dt, { obstructed, trainAmount, warnSound } = {}) {
    this.t += dt; this.blink += dt;
    let ev = null;
    switch (this.state) {
      case 'opening':
        this.amount = Math.min(1, this.amount + dt / PSD.OPEN_TIME);
        if (trainAmount != null) this.amount = Math.min(this.amount, Math.max(trainAmount, 0.02) + 0.05);
        if (this.amount >= 1) this.state = 'open';
        break;
      case 'warning':
        if (this.t > 1.6) { this.state = 'closing'; this.t = 0; }
        break;
      case 'closing':
        this.amount = Math.max(0, this.amount - dt / PSD.CLOSE_TIME);
        if (this.amount < 0.45 && obstructed?.()) {
          // Light curtain / leaf force detection: reopen, at most twice, then report a fault.
          this.retries++;
          if (this.retries > 2) { this.fault = 'Obstruction — platform doors not locked'; this.state = 'opening'; ev = 'fault'; }
          else { this.state = 'opening'; this.autoReclose = true; ev = 'obstructed'; }
          break;
        }
        if (this.amount <= 0) { this.state = 'locked'; ev = 'locked'; }
        break;
      case 'open':
        if (this.autoReclose && !this.fault) { this.autoReclose = false; this.state = 'warning'; this.t = 0; }
        break;
      default: break;
    }
    // Leaves and warning lights (flash while moving or announcing, steady on a fault).
    for (const l of this.leaves) l.leaf.position.z = l.base + l.dir * l.travel * this.amount;
    const moving = this.state === 'opening' || this.state === 'closing' || this.state === 'warning';
    const on = this.fault ? true : moving && Math.floor(this.blink * 3) % 2 === 0;
    for (const lamp of this.lights) lamp.material = on ? this.lightOn : this.lightOff;
    if (this.state === 'warning' && warnSound && this.t < dt * 1.5) warnSound();
    return ev;
  }
}

function mergeAll(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }));
}
