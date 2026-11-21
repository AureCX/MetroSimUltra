// TGV driver's cab, inside the power car's nose: the driver sits on the centreline behind the wrap-around
// windscreen (the nose body around it is the real exterior shell), with a wide wrap-around desk. Centre: the large
// TVM driver display (TgvDmi); left: network map screen and the combined traction/brake manipulator; right: a
// backup analogue speedometer, the wiper rotary switch with a single-wipe button, door buttons, emergency
// mushroom; top row: indicator lamps. Same interface and controls as the metro cab (every control is functional
// and mirrored by a key).
import * as THREE from 'three';
import { Cabin } from './Cabin.js';
import { Speedometer, Clock } from './CabinDisplays.js';
import { TgvDmi } from './TgvDisplays.js';
import { NOSE } from '../world/TrainModel.js';
import { Textures } from '../world/Textures.js';
import { WIPER_MODES, WIPER_LABEL } from './Wipers.js';

const lbl = (text, w = 256, h = 56, fg = '#e8e8e8', bg = '#20252b', size = 24) => Textures.label(text, { w, h, bg, fg, font: `bold ${size}px Arial`, radius: 6 });

export class TgvCab extends Cabin {
  constructor(specs, actions, bus) {
    super(specs, actions, bus);
    const zN = specs.carLength / 2 - NOSE;
    this.eye.set(0, 3.02, zN + 2.0);   // seated eye height: over the desk, through the lower windscreen
    this.light.position.set(0, 3.45, zN + 1.6);
    this.instrumentLight.position.set(0, 2.5, zN + 2.9);
    this.instrumentLight.distance = 2.2;
  }

  get zN() { return this.specs.carLength / 2 - NOSE; }

  buildShell(W) {
    const g = this.group, m = this.m, z0 = this.zN;
    const FL = 1.58;                                         // raised cab floor
    this.floorY = FL;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 4.6), m.floor); floor.position.set(0, FL - 0.04, z0 + 1.2); g.add(floor);
    // Back partition with the door to the machine room, side consoles, ceiling with a light panel.
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 0.06), m.panel); back.position.set(0, FL + 1.1, z0 - 0.9); g.add(back);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.9), new THREE.MeshStandardMaterial({ color: 0x6f747a, roughness: 0.7 })); door.position.set(0.6, FL + 0.95, z0 - 0.86); g.add(door);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 2.4), m.panel); ceil.position.set(0, 3.56, z0 + 0.4); g.add(ceil);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.25), m.ceilLight); cl.rotation.x = Math.PI / 2; cl.position.set(0, 3.53, z0 + 0.6); g.add(cl);
    this.ceilPanel = cl;
    // Driver's seat on its column, foot rest.
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.52), m.seat); seat.position.set(0, FL + 0.48, z0 + 1.75); g.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.1), m.seat); backrest.position.set(0, FL + 0.95, z0 + 1.45); backrest.rotation.x = -0.14; g.add(backrest);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.42), m.metal); col.position.set(0, FL + 0.21, z0 + 1.75); g.add(col);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.35), m.black); foot.position.set(0, FL + 0.12, z0 + 2.7); foot.rotation.x = -0.35; g.add(foot);
    // Windscreen pillars inside (frame the view like the real cab).
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.25, 0.07), m.black); p.position.set(sx * 1.18, 2.85, z0 + 3.25); p.rotation.set(0.62, 0, sx * -0.18); g.add(p); }
  }

  buildDesk() {
    const g = this.group, m = this.m, z0 = this.zN, FL = this.floorY;
    // Wrap-around desk body and the sloped instrument panel facing the driver (below the line of sight).
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 0.7), m.desk); body.position.set(0, FL + 0.31, z0 + 2.95); g.add(body);
    const alpha = 0.6;
    const panel = this.panel = new THREE.Group();
    panel.position.set(0, FL + 0.82, z0 + 2.88);
    panel.rotation.set(-(Math.PI / 2 - alpha), Math.PI, 0, 'YXZ');
    g.add(panel);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.72), m.deskTop); panel.add(top);
    for (const sx of [-1, 1]) { const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.72), m.deskTop); wing.position.set(sx * 1.3, 0, -0.12); wing.rotation.y = sx * 0.5; panel.add(wing); }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.28), m.desk); shelf.position.set(0, FL + 0.95, z0 + 3.3); g.add(shelf);

    // Central driver display.
    this.dmi = new TgvDmi(this.specs.maxSpeed);
    const dw = 0.62, dh = dw * (760 / 1280);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.04, dh + 0.04, 0.02), m.black); frame.position.set(0, 0.04, 0.0); panel.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshBasicMaterial({ map: this.dmi.t })); face.position.set(0, 0.04, 0.011); panel.add(face);
    // Backup analogue speedometer (right).
    const maxScale = Math.ceil((this.specs.maxSpeed + 20) / 20) * 20;
    this.speedo = new Speedometer(maxScale);
    const sp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 40), new THREE.MeshBasicMaterial({ map: this.speedo.t })); sp.position.set(0.5, 0.1, 0.006); panel.add(sp);
    const bez = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.112, 40), m.metal); bez.position.set(0.5, 0.1, 0.008); panel.add(bez);
    this.clock = new Clock();
    const clk = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.064), new THREE.MeshBasicMaterial({ map: this.clock.t })); clk.position.set(0.82, 0.17, 0.006); panel.add(clk);
    // Network map screen (left), click → full map.
    {
      const c = document.createElement('canvas'); c.width = 720; c.height = 400;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.netScreen = { c, tex: t };
      const w = 0.42, h = w * (400 / 720);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), m.black); fr.position.set(-0.6, 0.08, 0); panel.add(fr);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); f.position.set(-0.6, 0.08, 0.007); panel.add(f);
      this.register(f, 'Network map — click to open', { click: () => this.actions.networkMap?.() });
    }
    // Indicator lamps along the top edge.
    const lampDefs = [
      ['PORTES', 0x22ff66, (s) => s.doorsLocked], ['DÉPART', 0xffffff, (s) => s.departure], ['COUPURE TR.', 0xffaa00, (s) => s.tractionCut],
      ['FREIN MAINT.', 0xffaa00, (s) => s.holdBrake], ['TVM', 0xff2a1a, (s) => s.overspeed !== 'none', true], ['URGENCE', 0xff2a1a, (s) => s.ebActive],
      ['VACMA', 0xff7a00, (s) => s.vigAlarm, true], ['PATINAGE', 0xffdd00, (s) => s.wheelSlip], ['PLUIE', 0x5ab0ff, (s) => s.weatherRain > 0.12],
    ];
    const lampGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.01, 14);
    lampDefs.forEach(([label, color, fn, blink], i) => {
      const x = -0.84 + i * 0.21;
      const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      const lamp = new THREE.Mesh(lampGeo, mat); lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 0.31, 0.008); panel.add(lamp);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.032), new THREE.MeshBasicMaterial({ map: lbl(label, 256, 48, '#d8d8d8', '#2a2f35', 22), transparent: true })); lb.position.set(x, 0.275, 0.004); panel.add(lb);
      this.lamps.push({ mat, color: new THREE.Color(color), fn, blink });
    });
    // Push buttons.
    const A = this.actions;
    const btns = [
      ['PORTES G', -0.92, -0.2, 0x2a7bff, () => A.doorsOpen('left'), (s) => s.doorsOpenSide === 'left'],
      ['FERMETURE', -0.72, -0.2, 0xffc400, () => A.doorsClose(), (s) => s.doorsStatus === 'warning' || s.doorsStatus === 'closing'],
      ['PORTES D', 0.92, -0.2, 0x2a7bff, () => A.doorsOpen('right'), (s) => s.doorsOpenSide === 'right'],
      ['KLAXON', -0.42, -0.24, 0x9aa1a8, null, (s) => s.horn, { down: () => A.horn(true), up: () => A.horn(false) }],
      ['ANNONCE', -0.22, -0.24, 0x9aa1a8, () => A.announce(), () => false],
      ['VACMA', 0.0, -0.24, 0xff7a00, () => A.vigilance(), (s) => s.vigAlarm],
      ['PHARES', 0.22, -0.24, 0x3a8bff, () => A.headlights(), (s) => s.headlightsHigh],
      ['ÉCLAIRAGE', 0.42, -0.24, 0xfff0c0, () => A.cabLight(), (s) => s.cabLight],
      ['1 BALAYAGE', 0.7, -0.05, 0x5ab0ff, () => A.wipeOnce(), (s) => s.wiperSingle],
    ];
    const bGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 18), ringGeo = new THREE.CylinderGeometry(0.031, 0.031, 0.008, 18);
    for (const [label, x, y, color, act, lit, hold] of btns) {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.4 });
      const b = new THREE.Mesh(bGeo, mat); b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.014); panel.add(b);
      const ring = new THREE.Mesh(ringGeo, m.metal); ring.rotation.x = Math.PI / 2; ring.position.set(x, y, 0.004); panel.add(ring);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.032), new THREE.MeshBasicMaterial({ map: lbl(label, 256, 48, '#ffffff', '#2a2f35', 22), transparent: true })); lb.position.set(x, y - 0.05, 0.004); panel.add(lb);
      const entry = { mesh: b, mat, color: new THREE.Color(color), lit, press: 0, baseZ: 0.014 };
      this.buttons.push(entry);
      this.register(b, label.charAt(0) + label.slice(1).toLowerCase(), {
        click: act ? () => { entry.press = 0.2; this.bus.emit('cab:button'); act(); } : null,
        down: hold ? () => { entry.press = 0.2; hold.down(); } : null,
        up: hold ? () => hold.up() : null,
      });
    }
    // Wiper rotary switch: OFF / INT / LOW / HIGH (click to turn, wheel both ways).
    {
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshBasicMaterial({ map: this.wiperDial() })); base.position.set(0.7, -0.2, 0.005); panel.add(base);
      const knob = this.wiperKnob = new THREE.Group(); knob.position.set(0.7, -0.2, 0.012); panel.add(knob);
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.085, 0.03), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 })); k.position.y = 0.0; knob.add(k);
      const ptr = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.032), new THREE.MeshBasicMaterial({ color: 0xffffff })); ptr.position.y = 0.03; knob.add(ptr);
      const hit = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), new THREE.MeshBasicMaterial({ visible: false })); hit.position.z = 0.02; knob.add(hit);
      this.register(hit, 'Wipers — click: next position, wheel: turn', { click: () => A.wipers(), wheel: (d) => A.wipers(d > 0 ? -1 : 1), highlight: k });
    }
    // Emergency mushroom.
    const ebMat = new THREE.MeshStandardMaterial({ color: 0xd01010, roughness: 0.35, emissive: 0x200000 });
    const eb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), ebMat); eb.rotation.x = Math.PI / 2; eb.position.set(0.94, 0.1, 0.03); panel.add(eb);
    const ebBase = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0xffd000 })); ebBase.rotation.x = Math.PI / 2; ebBase.position.set(0.94, 0.1, 0.012); panel.add(ebBase);
    this.ebButton = { mesh: eb, press: 0 };
    this.register(eb, 'Emergency brake', { click: () => { this.ebButton.press = 0.3; A.emergency(); } });
  }

  wiperDial() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#20252b'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8e8e8'; g.font = 'bold 24px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    WIPER_MODES.forEach((mde, i) => { const a = -Math.PI / 2 + (i - 1.5) * 0.7; g.fillText(WIPER_LABEL[mde], 128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  buildLever() {
    const g = this.group, m = this.m, z0 = this.zN, FL = this.floorY;
    // Manipulator on the driver's left-hand console.
    const x = 0.62, cz = z0 + 2.15, top = FL + 0.72;
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.3, top - FL, 0.6), m.desk); con.position.set(x, (top + FL) / 2, cz); g.add(con);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.5), new THREE.MeshBasicMaterial({ map: this.notchPlate() }));
    plate.rotation.x = -Math.PI / 2; plate.rotation.z = Math.PI; plate.scale.setScalar(0.9); plate.position.set(x, top + 0.005, cz); g.add(plate);
    const pivot = this.leverPivot = new THREE.Group(); pivot.position.set(x - 0.03, top, cz); g.add(pivot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.22), m.metal); shaft.position.y = 0.11; pivot.add(shaft);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 })); knob.position.y = 0.24; pivot.add(knob);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.12), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.15; pivot.add(hit);
    this.register(hit, 'Traction / brake manipulator — drag up/down or scroll', {
      drag: (steps) => { for (let i = 0; i < Math.abs(steps); i++) steps < 0 ? this.actions.tractionUp() : this.actions.tractionDown(); },
      wheel: (d) => (d < 0 ? this.actions.tractionUp() : this.actions.tractionDown()),
      highlight: knob,
    });
    this.leverAngle = 0;
  }

  buildLineMap() {
    // Line diagram under the cab ceiling, ahead of the driver, above the windscreen's upper edge.
    const c = document.createElement('canvas'); c.width = 2048; c.height = 400;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.lineMap = { c, tex: t };
    const w = 1.1, h = w * (400 / 2048), z0 = this.zN;
    const grp = new THREE.Group(); grp.position.set(-0.45, 3.42, z0 + 1.1); grp.rotation.set(0.5, Math.PI, 0, 'YXZ');
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, 0.03), this.m.black); fr.position.z = -0.018; grp.add(fr);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: 0xdddddd })); grp.add(face);
    this.group.add(grp);
    this.register(face, 'Line map — click to enlarge (M)', { click: () => this.actions.lineMap() });
  }

  update(dt, st, time) {
    super.update(dt, st, time);
    if (this.wiperKnob) { const i = Math.max(0, WIPER_MODES.indexOf(st.wiperMode || 'off')); const target = -(i - 1.5) * 0.7; this.wiperKnob.rotation.z += (target - this.wiperKnob.rotation.z) * Math.min(1, dt * 12); }
  }
}
