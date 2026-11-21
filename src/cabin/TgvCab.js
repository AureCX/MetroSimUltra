// TGV Duplex-style driver's cab, inside the power car's nose. Layout after the real cab: a black wrap-around desk
// under the large windscreen, blue padded walls and ceiling with speaker grilles, a red driver's seat on the
// centreline. On the desk, in front of the driver: the black manipulator box with the brake lever on its left and
// the traction lever (with its hand-wheel) on its right; behind it the two cab screens with their button bezels
// (TVM driver display, network map). Left wing: LED speed / clock readout, brake-pipe and brake-cylinder pressure
// gauges, analogue speedometer, horn joystick, the red emergency mushroom. Right wing: radio screen with keypad
// (line diagram), vigilance (yellow) and door-closing (red) buttons, wiper rotary, headlight rotary, single-wipe
// joystick. Lower side panels: door buttons and status lamps. Every control works and has a key.
import * as THREE from 'three';
import { Cabin } from './Cabin.js';
import { Speedometer, Clock } from './CabinDisplays.js';
import { TgvDmi } from './TgvDisplays.js';
import { NOSE } from '../world/TrainModel.js';
import { Textures } from '../world/Textures.js';
import { WIPER_MODES } from './Wipers.js';

const lbl = (text, w = 256, h = 48, fg = '#e8e8e8', bg = '#0d0e10', size = 22) => Textures.label(text, { w, h, bg, fg, font: `bold ${size}px Arial`, radius: 4 });
const canvasTex = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { c, g: c.getContext('2d'), t }; };

/** Round pressure gauge (bar) drawn on a canvas. */
class Gauge {
  constructor(label, max, ticks) { Object.assign(this, canvasTex(256, 256)); this.label = label; this.max = max; this.ticks = ticks; this.v = -1; }
  draw(v) {
    if (Math.abs(v - this.v) < 0.02) return; this.v = v;
    const g = this.g, c = 128, R = 120, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (x) => a0 + (a1 - a0) * Math.max(0, Math.min(1, x / this.max));
    g.fillStyle = '#f2f2ee'; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 3;
    for (let i = 0; i <= this.max * this.ticks; i++) { const a = ang(i / this.ticks), big = i % this.ticks === 0; g.beginPath(); g.moveTo(c + Math.cos(a) * (R - 6), c + Math.sin(a) * (R - 6)); g.lineTo(c + Math.cos(a) * (R - (big ? 26 : 14)), c + Math.sin(a) * (R - (big ? 26 : 14))); g.stroke(); if (big) { g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i / this.ticks), c + Math.cos(a) * (R - 44), c + Math.sin(a) * (R - 44)); } }
    g.fillStyle = '#333'; g.font = 'bold 20px Arial'; g.fillText(this.label, c, c + 52); g.font = '16px Arial'; g.fillText('bar', c, c + 74);
    const a = ang(v); g.strokeStyle = '#c8102e'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * (R - 24), c + Math.sin(a) * (R - 24)); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(c, c, 10, 0, Math.PI * 2); g.fill();
    this.t.needsUpdate = true;
  }
}

export class TgvCab extends Cabin {
  constructor(specs, actions, bus) {
    super(specs, actions, bus);
    const zN = specs.carLength / 2 - NOSE;
    this.eye.set(0, 3.02, zN + 2.0);   // seated eye height: over the desk, through the lower windscreen
    this.light.position.set(0, 3.45, zN + 1.6);
    this.instrumentLight.position.set(0, 2.6, zN + 2.7);
    this.instrumentLight.distance = 2.6; this.instrumentLight.intensity = 0.9;
  }

  get zN() { return this.specs.carLength / 2 - NOSE; }

  mats() {
    if (this.mm) return this.mm;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mm = {
      desk: std({ color: 0x141517, roughness: 0.55, metalness: 0.1 }),
      deskEdge: std({ color: 0x2a2c30, roughness: 0.4, metalness: 0.4 }),
      box: std({ color: 0x1a1b1d, roughness: 0.45, metalness: 0.15 }),
      blue: std({ color: 0x35587e, roughness: 0.9, side: THREE.DoubleSide }),          // padded wall / ceiling panels
      blueDark: std({ color: 0x24405e, roughness: 0.9, side: THREE.DoubleSide }),
      seat: std({ color: 0xb3172d, roughness: 0.95 }),
      floor: std({ color: 0x5a5e63, roughness: 0.6, metalness: 0.5 }),
      grille: std({ color: 0x0b0b0c, roughness: 0.8 }),
      metal: std({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.3 }),
      black: std({ color: 0x08090a, roughness: 0.5 }),
      bezel: std({ color: 0x2b2d31, roughness: 0.5 }),
      key: std({ color: 0x3a3d42, roughness: 0.6 }),
    };
    return this.mm;
  }

  buildShell() {
    const g = this.group, M = this.mats(), z0 = this.zN;
    const FL = this.floorY = 1.58;                           // raised cab floor
    const box = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
    box(M.floor, 2.3, 0.06, 4.6, 0, FL - 0.03, z0 + 1.2);    // chequer-plate floor
    // Back wall with the machine-room door; blue padded side walls and ceiling; speaker grilles in the corners.
    box(M.blue, 2.5, 2.2, 0.06, 0, FL + 1.1, z0 - 0.9);
    const door = box(M.blueDark, 0.72, 1.9, 0.02, 0.62, FL + 0.95, z0 - 0.86);
    box(M.metal, 0.14, 0.03, 0.04, 0.38, FL + 1.0, z0 - 0.84); void door;
    box(M.blue, 2.2, 0.05, 2.6, 0, 3.58, z0 + 0.3);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), this.m.ceilLight); cl.rotation.x = Math.PI / 2; cl.position.set(0, 3.55, z0 + 0.4); g.add(cl);
    this.ceilPanel = cl;
    for (const sx of [-1, 1]) {
      box(M.blue, 0.06, 1.25, 3.4, sx * 1.15, FL + 1.35, z0 + 1.0);                       // padded side lining
      box(M.blueDark, 0.5, 0.55, 0.06, sx * 0.95, 3.25, z0 + 2.55, -0.65, 0, 0);          // upper corner panels
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 20), M.grille); sp.rotation.x = Math.PI / 2 - 0.65; sp.position.set(sx * 0.95, 3.27, z0 + 2.58); g.add(sp);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.015, 8, 20), M.black); ring.rotation.x = -0.65; ring.position.copy(sp.position); g.add(ring);
    }
    // Red driver's seat on its column, foot rest.
    const seat = box(M.seat, 0.58, 0.14, 0.54, 0, FL + 0.5, z0 + 1.7);
    const backrest = box(M.seat, 0.58, 0.82, 0.12, 0, FL + 0.98, z0 + 1.42, -0.14); void seat; void backrest;
    box(M.metal, 0.1, 0.42, 0.1, 0, FL + 0.21, z0 + 1.7);
    box(M.black, 0.75, 0.05, 0.35, 0, FL + 0.12, z0 + 2.75, -0.35);
  }

  buildDesk() {
    const g = this.group, M = this.mats(), z0 = this.zN, FL = this.floorY, A = this.actions;
    const H = FL + 0.8;                                      // desk top height
    const addBox = (parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
    // ---- Wrap-around desk: centre section and two angled wings, rounded front edge, knee panels. ----
    addBox(g, M.desk, 1.3, 0.06, 0.95, 0, H, z0 + 2.95);
    addBox(g, M.deskEdge, 2.5, 0.05, 0.05, 0, H + 0.02, z0 + 2.46);
    for (const sx of [-1, 1]) {
      const wing = addBox(g, M.desk, 0.75, 0.06, 0.95, sx * 0.98, H + 0.06, z0 + 2.8, 0, sx * 0.45, sx * 0.12); void wing;
      addBox(g, M.desk, 0.7, 0.75, 0.06, sx * 0.95, FL + 0.38, z0 + 2.45, 0, sx * 0.45);          // lower side panels
    }
    addBox(g, M.desk, 1.3, 0.75, 0.06, 0, FL + 0.38, z0 + 2.48);
    // Raised instrument panel behind the box (under the windscreen) — the two screens sit in it.
    const back = new THREE.Group(); back.position.set(0, H + 0.3, z0 + 3.42); back.rotation.set(-0.42, Math.PI, 0, 'YXZ'); g.add(back);
    addBox(back, M.desk, 1.25, 0.4, 0.05, 0, 0, -0.03);
    // Screen 1 (left of centre): TVM driver display. Screen 2 (right): network map. Both with button bezels.
    this.dmi = new TgvDmi(this.specs.maxSpeed);
    const net = canvasTex(720, 400);
    this.netScreen = { c: net.c, tex: net.t };
    const screen = (x, tex, w, h, label, onClick) => {
      addBox(back, M.bezel, w + 0.12, h + 0.08, 0.03, x, 0.0, 0.0);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })); face.position.set(x, 0.01, 0.017); back.add(face);
      for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) addBox(back, M.key, 0.022, 0.022, 0.012, x + sx * (w / 2 + 0.035), -h / 2 + 0.03 + i * (h - 0.06) / 5, 0.018);
      for (let i = 0; i < 6; i++) addBox(back, M.key, 0.022, 0.016, 0.012, x - w / 2 + 0.04 + i * (w - 0.08) / 5, -h / 2 - 0.028, 0.018);
      if (onClick) this.register(face, label, { click: onClick });
      return face;
    };
    screen(0.29, this.dmi.t, 0.44, 0.44 * 760 / 1280, 'Driver display (TVM)');
    screen(-0.29, net.t, 0.4, 0.4 * 400 / 720, 'Network map — click to open', () => A.networkMap?.());

    // ---- Centre: manipulator box with the brake lever (left) and the traction lever + hand-wheel (right). ----
    const bx = new THREE.Group(); bx.position.set(0, H + 0.03, z0 + 2.95); g.add(bx);
    addBox(bx, M.box, 0.58, 0.17, 0.42, 0, 0.085, 0);
    addBox(bx, M.deskEdge, 0.59, 0.01, 0.43, 0, 0.172, 0);
    for (const [x, c] of [[-0.13, 0xd8d8d8], [0.13, 0xd8d8d8]]) addBox(bx, new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }), 0.035, 0.04, 0.012, x, 0.08, -0.215);
    this.speedo = new Speedometer(Math.ceil((this.specs.maxSpeed + 20) / 20) * 20);
    this.clock = new Clock();
    // Traction lever (driver's right = car −x): pivot on the box side, hand-wheel on its knob.
    const tp = this.leverPivot = new THREE.Group(); tp.position.set(-0.36, H + 0.12, z0 + 2.95); g.add(tp);
    addBox(tp, M.metal, 0.03, 0.26, 0.03, 0, 0.13, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), M.black); knob.position.y = 0.27; tp.add(knob);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 10, 24), M.black); wheel.rotation.y = Math.PI / 2; wheel.position.set(-0.06, 0.05, 0); tp.add(wheel);
    const quad = addBox(g, M.box, 0.1, 0.07, 0.3, -0.37, H + 0.065, z0 + 2.95);
    const thit = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.16), new THREE.MeshBasicMaterial({ visible: false })); thit.position.y = 0.16; tp.add(thit);
    this.register(thit, 'Traction lever — push forward / pull back (drag or wheel)', {
      drag: (steps) => { for (let i = 0; i < Math.abs(steps); i++) steps < 0 ? A.tractionUp() : A.tractionDown(); },
      wheel: (d) => (d < 0 ? A.tractionUp() : A.tractionDown()), highlight: knob,
    });
    void quad;
    // Brake lever (driver's left = car +x).
    const bp = this.brakePivot = new THREE.Group(); bp.position.set(0.36, H + 0.12, z0 + 2.95); g.add(bp);
    addBox(bp, M.metal, 0.026, 0.22, 0.026, 0, 0.11, 0);
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 12), M.black); bk.position.y = 0.24; bp.add(bk);
    addBox(g, M.box, 0.1, 0.07, 0.3, 0.37, H + 0.065, z0 + 2.95);
    const bhit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.14), new THREE.MeshBasicMaterial({ visible: false })); bhit.position.y = 0.15; bp.add(bhit);
    this.register(bhit, 'Brake lever — pull back to brake, push to release (drag or wheel)', {
      drag: (steps) => { for (let i = 0; i < Math.abs(steps); i++) steps > 0 ? A.tractionDown() : A.tractionUp(); },
      wheel: (d) => (d > 0 ? A.tractionDown() : A.tractionUp()), highlight: bk,
    });

    // ---- Left wing (car +x): LED readout, gauges, horn joystick, emergency mushroom. ----
    const left = new THREE.Group(); left.position.set(0.98, H + 0.13, z0 + 2.95); left.rotation.set(-(Math.PI / 2 - 0.55), Math.PI + 0.45, 0, 'YXZ'); g.add(left);   // sloped desk wing
    addBox(left, M.desk, 0.7, 0.5, 0.03, 0, 0.12, -0.02);
    this.led = canvasTex(256, 96);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ map: this.led.t })); led.position.set(-0.24, 0.31, 0.0); left.add(led);
    addBox(left, M.black, 0.18, 0.08, 0.02, -0.24, 0.31, -0.012);
    this.gCG = new Gauge('CG', 10, 2); this.gCF = new Gauge('CF', 6, 2);
    const dial = (tex, r, x, y) => { const d = new THREE.Mesh(new THREE.CircleGeometry(r, 36), new THREE.MeshBasicMaterial({ map: tex })); d.position.set(x, y, 0.0); left.add(d); const b = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 36), M.metal); b.position.set(x, y, 0.001); left.add(b); };
    dial(this.speedo.t, 0.075, 0.02, 0.27);
    dial(this.gCG.t, 0.06, -0.05, 0.1);
    dial(this.gCF.t, 0.06, 0.1, 0.1);
    const lb = (text, x, y, w = 0.12) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.025), new THREE.MeshBasicMaterial({ map: lbl(text), transparent: true })); m.position.set(x, y, 0.002); left.add(m); };
    lb('CG', -0.05, 0.025); lb('CF', 0.1, 0.025);
    const clk = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.045), new THREE.MeshBasicMaterial({ map: this.clock.t })); clk.position.set(0.24, 0.31, 0.0); left.add(clk);
    // Emergency mushroom (far left on the desk top).
    const ebMat = new THREE.MeshStandardMaterial({ color: 0xd01010, roughness: 0.35, emissive: 0x200000 });
    const ebBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.4 })); ebBase.position.set(1.12, H + 0.1, z0 + 2.62); g.add(ebBase);
    const eb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), ebMat); eb.position.set(1.12, H + 0.12, z0 + 2.62); g.add(eb);
    this.ebButton = { mesh: eb, press: 0, baseY: H + 0.12 };
    this.register(eb, 'Emergency brake', { click: () => { this.ebButton.press = 0.3; A.emergency(); } });
    // Horn joystick (hold).
    const horn = new THREE.Group(); horn.position.set(0.82, H + 0.12, z0 + 2.62); g.add(horn);
    addBox(horn, M.black, 0.08, 0.02, 0.08, 0, 0, 0);
    const hs = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 10), M.black); hs.position.y = 0.06; horn.add(hs);
    const hk = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), M.black); hk.position.y = 0.13; horn.add(hk);
    this.hornStick = horn;
    this.register(hk, 'Horn (hold)', { down: () => A.horn(true), up: () => A.horn(false), highlight: hk });

    // ---- Right wing (car −x): radio screen with keypad, buttons, rotaries, single-wipe joystick. ----
    const right = new THREE.Group(); right.position.set(-0.98, H + 0.13, z0 + 2.95); right.rotation.set(-(Math.PI / 2 - 0.55), Math.PI - 0.45, 0, 'YXZ'); g.add(right);
    addBox(right, M.desk, 0.7, 0.5, 0.03, 0, 0.12, -0.02);
    const lm = canvasTex(2048, 400);
    this.lineMap = { c: lm.c, tex: lm.t };
    addBox(right, M.bezel, 0.38, 0.17, 0.03, 0.08, 0.27, 0.0);
    const lmf = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.066), new THREE.MeshBasicMaterial({ map: lm.t, color: 0xdddddd })); lmf.position.set(0.08, 0.3, 0.017); right.add(lmf);
    this.register(lmf, 'Line diagram — click to enlarge (M)', { click: () => A.lineMap() });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8), new THREE.MeshStandardMaterial({ color: [0x3a3d42, 0xc8a000, 0x3a3d42][r], roughness: 0.5 })); k.rotation.x = Math.PI / 2; k.position.set(-0.06 + c * 0.035, 0.225 - r * 0.02, 0.017); right.add(k); }
    // Speaker grille.
    const spk = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), M.grille); spk.position.set(-0.24, 0.27, 0.017); right.add(spk);

    // Buttons on the desk top (right side) and lower panels.
    const buttons = [
      // [label, parent, x, y, z, color, action, lit, hold]
      ['VACMA', g, -0.72, H + 0.11, z0 + 2.62, 0xf2c400, () => A.vigilance(), (s) => s.vigAlarm],
      ['FERMETURE PORTES', g, -0.72, H + 0.11, z0 + 2.78, 0xd01818, () => A.doorsClose(), (s) => s.doorsStatus === 'warning' || s.doorsStatus === 'closing'],
      ['ANNONCE', g, -0.92, H + 0.11, z0 + 2.62, 0x9aa1a8, () => A.announce(), () => false],
      ['ÉCLAIRAGE CABINE', g, -0.92, H + 0.11, z0 + 2.78, 0xfff0c0, () => A.cabLight(), (s) => s.cabLight],
      ['PORTES GAUCHE', g, 0.95, FL + 0.55, z0 + 2.4, 0x2a7bff, () => A.doorsOpen('left'), (s) => s.doorsOpenSide === 'left'],
      ['PORTES DROITE', g, -0.95, FL + 0.55, z0 + 2.4, 0x2a7bff, () => A.doorsOpen('right'), (s) => s.doorsOpenSide === 'right'],
    ];
    const bGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 18), ringGeo = new THREE.CylinderGeometry(0.031, 0.031, 0.008, 18);
    for (const [label, parent, x, y, z, color, act, lit] of buttons) {
      const side = y < H - 0.1;                                   // on a vertical lower panel
      const holder = new THREE.Group(); holder.position.set(x, y, z); if (side) holder.rotation.set(-Math.PI / 2, x > 0 ? 0.45 : -0.45, 0, 'YXZ'); parent.add(holder);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.4 });
      const b = new THREE.Mesh(bGeo, mat); b.position.y = 0.01; holder.add(b);
      const ring = new THREE.Mesh(ringGeo, M.metal); holder.add(ring);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.024), new THREE.MeshBasicMaterial({ map: lbl(label, 320, 52, '#e8e8e8', '#0d0e10', 20), transparent: true })); l.rotation.x = -Math.PI / 2; l.rotation.z = Math.PI; l.position.set(0, 0.002, -0.05); holder.add(l);
      const entry = { mesh: b, mat, color: new THREE.Color(color), lit, press: 0, baseY: 0.01 };
      this.buttons.push(entry);
      this.register(b, label.charAt(0) + label.slice(1).toLowerCase(), { click: () => { entry.press = 0.2; this.bus.emit('cab:button'); act(); } });
    }
    // Wiper rotary (orange): OFF / INT / LOW / HIGH; headlight rotary (black): high ⇄ low beam.
    const rotary = (x, z, color, labels, label, onClick, onWheel) => {
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.07, 28), new THREE.MeshBasicMaterial({ map: this.rotaryDial(labels) })); base.rotation.x = -Math.PI / 2; base.rotation.z = Math.PI; base.position.set(x, H + 0.101, z); g.add(base);
      const knob = new THREE.Group(); knob.position.set(x, H + 0.1, z); g.add(knob);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.045, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.4 })); k.position.y = 0.022; knob.add(k);
      const ptr = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.034), new THREE.MeshBasicMaterial({ color: 0xffffff })); ptr.position.set(0, 0.046, 0.016); knob.add(ptr);
      this.register(k, label, { click: onClick, wheel: onWheel, highlight: k });
      return knob;
    };
    this.wiperKnob = rotary(-1.12, z0 + 2.68, 0xe8601c, ['0', 'INT', 'I', 'II'], 'Wipers — click: next position, wheel: turn', () => A.wipers(), (d) => A.wipers(d > 0 ? -1 : 1));
    this.lightKnob = rotary(-1.12, z0 + 2.88, 0x18191b, ['C', 'LOV'], 'Headlights — low / high beam', () => A.headlights(), () => A.headlights());
    // Single-wipe joystick (right).
    const sw = new THREE.Group(); sw.position.set(-0.85, H + 0.12, z0 + 2.95); g.add(sw);
    const sws = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.11, 10), M.black); sws.position.y = 0.055; sw.add(sws);
    const swk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12), M.black); swk.position.y = 0.12; sw.add(swk);
    this.register(swk, 'Single wipe', { click: () => { this.swPress = 0.3; A.wipeOnce(); }, highlight: swk });
    this.swStick = sw;

    // Status lamps on the left lower panel.
    const lampDefs = [
      ['PORTES', 0x22ff66, (s) => s.doorsLocked], ['DÉPART', 0xffffff, (s) => s.departure], ['COUP. TR.', 0xffaa00, (s) => s.tractionCut],
      ['FREIN MAINT.', 0xffaa00, (s) => s.holdBrake], ['TVM', 0xff2a1a, (s) => s.overspeed !== 'none', true], ['URGENCE', 0xff2a1a, (s) => s.ebActive],
      ['VACMA', 0xff7a00, (s) => s.vigAlarm, true], ['PATINAGE', 0xffdd00, (s) => s.wheelSlip], ['PLUIE', 0x5ab0ff, (s) => s.weatherRain > 0.12],
    ];
    const lamps = new THREE.Group(); lamps.position.set(0, H + 0.52, z0 + 3.5); lamps.rotation.set(-0.42, Math.PI, 0, 'YXZ'); g.add(lamps);
    { const bk = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.08, 0.03), M.desk); bk.position.z = -0.02; lamps.add(bk); }
    const lampGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 12);
    lampDefs.forEach(([label, color, fn, blink], i) => {
      const x = -0.56 + i * 0.14;
      const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      const lamp = new THREE.Mesh(lampGeo, mat); lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 0.012, 0.004); lamps.add(lamp);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.022), new THREE.MeshBasicMaterial({ map: lbl(label, 256, 44, '#d8d8d8', '#0d0e10', 20), transparent: true })); l.position.set(x, -0.018, 0.003); lamps.add(l);
      this.lamps.push({ mat, color: new THREE.Color(color), fn, blink });
    });
  }

  rotaryDial(labels) {
    const { c, g, t } = canvasTex(256, 256);
    g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8e8e8'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach((l, i) => { const a = -Math.PI / 2 + (i - (labels.length - 1) / 2) * 0.75; g.fillText(l, 128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); });
    void c; return t;
  }

  buildLever() { /* levers are part of the desk (buildDesk) */ }
  buildLineMap() { /* the line diagram is on the right-hand radio screen (buildDesk) */ }

  update(dt, st, time) {
    // Lamps, buttons, cab light and screens (the base class), adapted to this cab's controls.
    const blinkOn = Math.floor(time * 2.5) % 2 === 0;
    for (const l of this.lamps) l.mat.color.copy(l.fn(st) && (!l.blink || blinkOn) ? l.color : new THREE.Color(0x202020));
    for (const b of this.buttons) {
      const lit = b.lit(st);
      b.mat.emissive.copy(lit ? b.color : new THREE.Color(0)).multiplyScalar(lit ? 0.9 : 0);
      b.press = Math.max(0, b.press - dt); b.mesh.position.y = b.baseY - (b.press > 0 ? 0.008 : 0);
    }
    this.ebButton.press = Math.max(0, this.ebButton.press - dt);
    this.ebButton.mesh.position.y = this.ebButton.baseY - (this.ebButton.press > 0 || st.notch === 'EB' ? 0.012 : 0);
    // Levers: traction forward with power notches, brake back with brake notches.
    const p = st.notchPos || 0;
    this.tAng = (this.tAng || 0) + ((p > 0 ? p * 0.09 : 0) - (this.tAng || 0)) * Math.min(1, dt * 14);
    this.bAng = (this.bAng || 0) + ((p < 0 ? p * 0.08 : 0) - (this.bAng || 0)) * Math.min(1, dt * 14);
    this.leverPivot.rotation.x = this.tAng; this.brakePivot.rotation.x = this.bAng;
    this.hornStick.rotation.x = st.horn ? 0.35 : 0;
    this.swPress = Math.max(0, (this.swPress || 0) - dt); this.swStick.rotation.x = this.swPress > 0 || st.wiperSingle ? 0.4 : 0;
    // Rotaries.
    const wi = Math.max(0, WIPER_MODES.indexOf(st.wiperMode || 'off')), wt = -(wi - 1.5) * 0.75;
    this.wiperKnob.rotation.y += (wt - this.wiperKnob.rotation.y) * Math.min(1, dt * 12);
    const lt = st.headlightsHigh ? -0.375 : 0.375; this.lightKnob.rotation.y += (lt - this.lightKnob.rotation.y) * Math.min(1, dt * 12);
    this.light.intensity = st.cabLight ? 2.2 : 0;
    this.ceilPanel.material.color.setHex(st.cabLight ? 0xfff6e0 : 0x3a3a3a);
    // Instruments at ~20 Hz: TVM display, speedometer, pressure gauges (brake pipe falls / cylinder rises with
    // braking), LED readout.
    this.acc = (this.acc || 0) + dt;
    if (this.acc > 0.05) {
      this.speedo.draw(st); this.dmi.draw(st, this.acc);
      const brake = Math.max(st.brake || 0, st.eb || 0);
      this.gCG.draw(5 - brake * 1.6 - (st.eb > 0.1 ? 3.2 * st.eb : 0)); this.gCF.draw(brake * 3.8);
      const g = this.led.g; g.fillStyle = '#100404'; g.fillRect(0, 0, 256, 96);
      g.fillStyle = '#ff4a2a'; g.font = 'bold 64px "Courier New", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(String(Math.round(st.speed)).padStart(3, ' '), 160, 50); g.font = 'bold 30px "Courier New", monospace'; g.fillText('km/h', 250, 62);
      this.led.t.needsUpdate = true;
      this.acc = 0;
    }
    this.clock.draw(st.clock);
  }
}
