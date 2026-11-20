// The driver's cab: a 3D workspace inside the leading car with working instruments,
// lamps, push-buttons, an emergency mushroom and the combined master controller lever.
// Every control is functional and mirrored by a keyboard / gamepad action.
import * as THREE from 'three';
import { Speedometer, DMI, Clock } from './CabinDisplays.js';
import { Textures } from '../world/Textures.js';

const FLOOR = 1.0;

function labelTex(text, w = 256, h = 64, fg = '#e8e8e8', bg = '#1d2126', size = 26) {
  return Textures.label(text, { w, h, bg, fg, font: `bold ${size}px Arial`, radius: 6 });
}

export class Cabin {
  constructor(specs, actions, bus) {
    this.specs = specs;
    this.actions = actions;
    this.bus = bus;
    this.group = new THREE.Group();
    this.interactive = [];
    this.lamps = [];
    this.buttons = [];
    const W = specs.width, zf = specs.carLength / 2;
    this.zf = zf;
    this.eye = new THREE.Vector3(0, 2.36, zf - 1.62);

    const m = this.m = {
      panel: new THREE.MeshStandardMaterial({ color: 0xb9b8b2, roughness: 0.85, side: THREE.DoubleSide }),
      desk: new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.7 }),
      deskTop: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, side: THREE.DoubleSide }),
      floor: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.95 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x1f3550, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.3 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.5 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x9fc4d8, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0, depthWrite: false }),
      ceilLight: new THREE.MeshBasicMaterial({ color: 0x444444 }),
    };

    this.buildShell(W, zf);
    this.buildDesk(W, zf);
    this.buildLever(W, zf);
    this.buildLineMap(W, zf);
    this.light = new THREE.PointLight(0xfff0d8, 0, 4, 2);
    this.light.position.set(0, 3.25, zf - 1.1);
    this.group.add(this.light);
    // Faint instrument back-light so the desk is readable in dark tunnels.
    this.instrumentLight = new THREE.PointLight(0x9fc0ff, 0.6, 1.6, 2);
    this.instrumentLight.position.set(0, 2.25, zf - 0.75);
    this.group.add(this.instrumentLight);
  }

  buildShell(W, zf) {
    const g = this.group, m = this.m;
    const iw = W / 2 - 0.08, back = zf - 2.35, front = zf - 0.12;
    // Front wall with windshield opening.
    const s = new THREE.Shape();
    s.moveTo(-iw, FLOOR); s.lineTo(iw, FLOOR); s.lineTo(iw, 3.48); s.lineTo(-iw, 3.48); s.closePath();
    const hole = new THREE.Path();
    const hx = W / 2 - 0.28, y0 = 2.0, y1 = 3.12, r = 0.12;
    hole.moveTo(-hx + r, y0); hole.lineTo(hx - r, y0); hole.quadraticCurveTo(hx, y0, hx, y0 + r);
    hole.lineTo(hx, y1 - r); hole.quadraticCurveTo(hx, y1, hx - r, y1); hole.lineTo(-hx + r, y1);
    hole.quadraticCurveTo(-hx, y1, -hx, y1 - r); hole.lineTo(-hx, y0 + r); hole.quadraticCurveTo(-hx, y0, -hx + r, y0);
    s.holes.push(hole);
    const fw = new THREE.Mesh(new THREE.ShapeGeometry(s), m.panel); fw.position.z = front; g.add(fw);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, y1 - y0), m.glass); glass.position.set(0, (y0 + y1) / 2, front + 0.02); g.add(glass);
    // Window frame & wiper.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.06, 0.05, 0.06), m.black); frame.position.set(0, y0, front - 0.02); g.add(frame);
    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.9, 0.02), m.black);
    wiper.geometry.translate(0, 0.45, 0); wiper.position.set(0.55, y0 + 0.02, front + 0.04); wiper.rotation.z = 1.25; g.add(wiper);
    // Sun visor.
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.32), new THREE.MeshStandardMaterial({ color: 0x223322, transparent: true, opacity: 0.75 }));
    visor.position.set(-0.45, 3.1, front - 0.2); visor.rotation.x = 0.25; g.add(visor);
    // Side walls with windows.
    for (const sd of [1, -1]) {
      const ss = new THREE.Shape();
      ss.moveTo(back, FLOOR); ss.lineTo(front, FLOOR); ss.lineTo(front, 3.48); ss.lineTo(back, 3.48); ss.closePath();
      const wh = new THREE.Path();
      wh.moveTo(back + 0.5, 2.05); wh.lineTo(front - 0.35, 2.05); wh.lineTo(front - 0.35, 2.95); wh.lineTo(back + 0.5, 2.95); wh.closePath();
      ss.holes.push(wh);
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(ss), m.panel);
      wall.rotation.y = sd > 0 ? -Math.PI / 2 : Math.PI / 2;
      wall.position.x = sd * iw;
      // ShapeGeometry x→ along car z: rotate so local x maps to +z
      wall.rotation.y = -Math.PI / 2; wall.scale.x = 1;
      wall.position.set(sd * iw, 0, 0);
      g.add(wall);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(front - 0.35 - back - 0.5, 0.9), m.glass);
      sg.rotation.y = sd > 0 ? -Math.PI / 2 : Math.PI / 2; sg.position.set(sd * (iw + 0.01), 2.5, (front - 0.35 + back + 0.5) / 2); g.add(sg);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.2), m.metal); rail.rotation.x = Math.PI / 2;
      rail.position.set(sd * (iw - 0.06), 1.95, back + 0.9); g.add(rail);
    }
    // Ceiling, floor, back partition.
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(iw * 2, front - back), m.panel); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.48, (front + back) / 2); g.add(ceil);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), m.ceilLight); cl.rotation.x = Math.PI / 2; cl.position.set(0, 3.47, zf - 1.1); g.add(cl);
    this.ceilPanel = cl;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(iw * 2, front - back), m.floor); fl.rotation.x = -Math.PI / 2; fl.position.set(0, FLOOR, (front + back) / 2); g.add(fl);
    const bw = new THREE.Mesh(new THREE.PlaneGeometry(iw * 2, 2.5), m.panel); bw.position.set(0, FLOOR + 1.25, back); g.add(bw);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.95), new THREE.MeshStandardMaterial({ color: 0x7b7e82, roughness: 0.7 }));
    door.position.set(-0.5, FLOOR + 0.98, back + 0.01); g.add(door);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.04), m.metal); handle.position.set(-0.2, FLOOR + 1.0, back + 0.03); g.add(handle);
    // Seat.
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.5), m.seat); seat.position.set(0, 1.55, zf - 1.8); g.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.1), m.seat); backrest.position.set(0, 2.0, zf - 2.08); backrest.rotation.x = -0.12; g.add(backrest);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5), m.metal); col.position.set(0, 1.25, zf - 1.8); g.add(col);
  }

  buildDesk(W, zf) {
    const g = this.group, m = this.m;
    const iw = W / 2 - 0.08;
    const body = new THREE.Mesh(new THREE.BoxGeometry(iw * 2, 0.85, 0.65), m.desk); body.position.set(0, FLOOR + 0.43, zf - 0.47); g.add(body);
    // Sloped instrument panel facing the driver.
    const alpha = 0.55;
    const panel = this.panel = new THREE.Group();
    panel.position.set(0, 1.98, zf - 0.55);
    panel.rotation.set(-(Math.PI / 2 - alpha), Math.PI, 0, 'YXZ');
    g.add(panel);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(iw * 2, 0.78), m.deskTop); panel.add(top);
    // Upper shelf below the windshield.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(iw * 2, 0.06, 0.3), m.desk); shelf.position.set(0, 1.98, zf - 0.22); g.add(shelf);

    const maxScale = Math.ceil((this.specs.maxSpeed + 20) / 20) * 20;
    this.speedo = new Speedometer(maxScale);
    this.dmi = new DMI();
    this.clock = new Clock();
    const sp = new THREE.Mesh(new THREE.CircleGeometry(0.135, 48), new THREE.MeshBasicMaterial({ map: this.speedo.t }));
    sp.position.set(-0.2, 0.06, 0.004); panel.add(sp);
    const bez = new THREE.Mesh(new THREE.RingGeometry(0.135, 0.15, 48), m.metal); bez.position.copy(sp.position); bez.position.z += 0.002; panel.add(bez);
    const dmi = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.2875), new THREE.MeshBasicMaterial({ map: this.dmi.t }));
    dmi.position.set(0.2, 0.07, 0.006); panel.add(dmi);
    const dmiFrame = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.31, 0.01), m.black); dmiFrame.position.set(0.2, 0.07, 0.0); panel.add(dmiFrame);
    // Network screen (touch screen built into the desk, left of the speedometer): live network map; a click opens
    // the full-size interactive map.
    {
      const c = document.createElement('canvas'); c.width = 720; c.height = 400;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.netScreen = { c, tex: t };
      const w = 0.5, h = w * (400 / 720);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.035, h + 0.035, 0.012), m.black); frame.position.set(-0.68, 0.085, 0.0); panel.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
      face.position.set(-0.68, 0.085, 0.0075); panel.add(face);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.03), new THREE.MeshBasicMaterial({ map: labelTex('RÉSEAU · NETWORK', 320, 48, '#d8d8d8', '#2a2f35', 22), transparent: true }));
      lb.position.set(-0.68, 0.085 - h / 2 - 0.028, 0.004); panel.add(lb);
      this.register(face, 'Network map — click to open', { click: () => this.actions.networkMap?.() });
    }
    // Clock on the shelf.
    const clk = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), new THREE.MeshBasicMaterial({ map: this.clock.t }));
    clk.position.set(-0.62, 2.04, zf - 0.37); clk.rotation.set(-0.35, Math.PI, 0, 'YXZ'); g.add(clk);

    // Indicator lamps.
    const lampDefs = [
      ['DOORS LOCKED', 0x22ff66, (s) => s.doorsLocked],
      ['DEPARTURE', 0xffffff, (s) => s.departure],
      ['TRACTION CUT', 0xffaa00, (s) => s.tractionCut],
      ['HOLD BRAKE', 0xffaa00, (s) => s.holdBrake],
      ['ATP', 0xff2a1a, (s) => s.overspeed !== 'none', true],
      ['EMERG. BRAKE', 0xff2a1a, (s) => s.ebActive],
      ['VIGILANCE', 0xff7a00, (s) => s.vigAlarm, true],
      ['WHEEL SLIP', 0xffdd00, (s) => s.wheelSlip],
      ['HIGH BEAM', 0x3a8bff, (s) => s.headlightsHigh],
    ];
    const lampGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16);
    lampDefs.forEach(([label, color, fn, blink], i) => {
      const x = -0.64 + i * 0.16;
      const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      const lamp = new THREE.Mesh(lampGeo, mat);
      lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 0.3, 0.008); panel.add(lamp);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.035), new THREE.MeshBasicMaterial({ map: labelTex(label, 256, 64, '#d8d8d8', '#2a2f35', 24), transparent: true }));
      lb.position.set(x, 0.26, 0.004); panel.add(lb);
      this.lamps.push({ mat, color: new THREE.Color(color), fn, blink });
    });

    // Push buttons: [label, x, y, color, action, litFn]
    const A = this.actions;
    const btns = [
      ['OPEN LEFT', -0.86, -0.12, 0x2a7bff, () => A.doorsOpen('left'), (s) => s.doorsOpenSide === 'left'],
      ['CLOSE DOORS', -0.66, -0.12, 0xffc400, () => A.doorsClose(), (s) => s.doorsStatus === 'warning' || s.doorsStatus === 'closing'],
      ['OPEN RIGHT', 0.86, -0.12, 0x2a7bff, () => A.doorsOpen('right'), (s) => s.doorsOpenSide === 'right'],
      ['ROUTE', -0.86, -0.24, 0xf2f2f2, () => A.routeSelect(), (s) => !!s.junction?.set],
      ['HORN', -0.46, -0.24, 0x9aa1a8, null, (s) => s.horn, { down: () => A.horn(true), up: () => A.horn(false) }],
      ['ANNOUNCE', -0.26, -0.24, 0x9aa1a8, () => A.announce(), () => false],
      ['VIGILANCE', 0.0, -0.24, 0xff7a00, () => A.vigilance(), (s) => s.vigAlarm],
      ['HEADLIGHTS', 0.26, -0.24, 0x3a8bff, () => A.headlights(), (s) => s.headlightsHigh],
      ['CAB LIGHT', 0.46, -0.24, 0xfff0c0, () => A.cabLight(), (s) => s.cabLight],
    ];
    const bGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.02, 20);
    const ringGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.008, 20);
    for (const [label, x, y, color, act, lit, hold] of btns) {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.4 });
      const b = new THREE.Mesh(bGeo, mat);
      b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.014); panel.add(b);
      const ring = new THREE.Mesh(ringGeo, m.metal); ring.rotation.x = Math.PI / 2; ring.position.set(x, y, 0.004); panel.add(ring);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), new THREE.MeshBasicMaterial({ map: labelTex(label, 256, 56, '#ffffff', '#2a2f35', 24), transparent: true }));
      lb.position.set(x, y - 0.055, 0.004); panel.add(lb);
      const entry = { mesh: b, mat, color: new THREE.Color(color), lit, press: 0, baseZ: 0.014 };
      this.buttons.push(entry);
      this.register(b, label.charAt(0) + label.slice(1).toLowerCase(), {
        click: act ? () => { entry.press = 0.2; this.bus.emit('cab:button'); act(); } : null,
        down: hold ? () => { entry.press = 0.2; hold.down(); } : null,
        up: hold ? () => hold.up() : null,
      });
    }
    // Emergency mushroom.
    const ebMat = new THREE.MeshStandardMaterial({ color: 0xd01010, roughness: 0.35, emissive: 0x200000 });
    const eb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), ebMat);
    eb.rotation.x = Math.PI / 2; eb.position.set(0.66, 0.1, 0.03); panel.add(eb);
    const ebBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0xffd000 }));
    ebBase.rotation.x = Math.PI / 2; ebBase.position.set(0.66, 0.1, 0.012); panel.add(ebBase);
    const ebl = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), new THREE.MeshBasicMaterial({ map: labelTex('EMERGENCY', 256, 56, '#ffffff', '#8a0c0c', 24) }));
    ebl.position.set(0.66, 0.0, 0.004); panel.add(ebl);
    this.ebButton = { mesh: eb, press: 0 };
    this.register(eb, 'Emergency brake', { click: () => { this.ebButton.press = 0.3; A.emergency(); } });
  }

  buildLever(W, zf) {
    const g = this.group, m = this.m;
    // Side console on the driver's left.
    const x = 0.64, cz = zf - 1.2, top = FLOOR + 0.9;
    const con = new THREE.Mesh(new THREE.BoxGeometry(0.26, top - FLOOR, 0.5), m.desk); con.position.set(x, (top + FLOOR) / 2, cz); g.add(con);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.5), new THREE.MeshBasicMaterial({ map: this.notchPlate() }));
    plate.rotation.x = -Math.PI / 2; plate.rotation.z = Math.PI; plate.scale.setScalar(0.9); plate.position.set(x, top + 0.005, cz); g.add(plate);
    const pivot = this.leverPivot = new THREE.Group();
    pivot.position.set(x - 0.03, top, cz); g.add(pivot);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.2), m.metal); shaft.position.y = 0.1; pivot.add(shaft);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.11, 20), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 }));
    knob.rotation.z = Math.PI / 2; knob.position.y = 0.21; pivot.add(knob);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.1), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.14; pivot.add(hit);
    this.register(hit, 'Master controller — drag up/down or scroll', {
      drag: (steps) => { for (let i = 0; i < Math.abs(steps); i++) steps < 0 ? this.actions.tractionUp() : this.actions.tractionDown(); },
      wheel: (d) => (d < 0 ? this.actions.tractionUp() : this.actions.tractionDown()),
      highlight: knob,
    });
    this.leverAngle = 0;
  }

  /** Line diagram panel hung across the top of the windshield (drawn by the game every half second). */
  buildLineMap(W, zf) {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 400;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.lineMap = { c, tex: t };
    const w = Math.min(1.45, W - 0.7), h = w * (400 / 2048);
    const g = new THREE.Group();
    g.position.set(0, 3.06, zf - 0.3);
    g.rotation.set(0.42, Math.PI, 0, 'YXZ');
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.03), this.m.black); frame.position.z = -0.018; g.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: 0xdddddd }));
    g.add(face);
    for (const sx of [-1, 1]) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4), this.m.metal); rod.position.set(sx * (w / 2 - 0.08), h / 2 + 0.18, -0.03); g.add(rod); }
    this.group.add(g);
    this.register(face, 'Line map — click to enlarge (M)', { click: () => this.actions.lineMap() });
  }

  notchPlate() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#22262b'; g.fillRect(0, 0, 256, 512);
    const P = this.specs.tractionNotches, B = this.specs.brakeNotches;
    const total = P + B + 2;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let i = 0; i < total; i++) {
      const pos = P - i; // from P max (top/forward) to EB
      const y = 30 + (i / (total - 1)) * 452;
      const lab = pos > 0 ? `P${pos}` : pos === 0 ? 'N' : pos === -(B + 1) ? 'EB' : `B${-pos}`;
      g.fillStyle = pos > 0 ? '#5ab0ff' : pos === 0 ? '#ffffff' : pos === -(B + 1) ? '#ff4030' : '#ffb300';
      g.font = 'bold 30px Arial'; g.fillText(lab, 150, y);
      g.fillRect(100, y - 2, 40, 4);
    }
    g.fillStyle = '#444a52'; g.fillRect(60, 20, 20, 472);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  register(mesh, label, handlers) { mesh.userData.interact = { label, ...handlers }; this.interactive.push(mesh); }

  /** Called every frame with the simulation snapshot. */
  update(dt, st, time) {
    const blinkOn = Math.floor(time * 2.5) % 2 === 0;
    for (const l of this.lamps) {
      const on = l.fn(st) && (!l.blink || blinkOn);
      l.mat.color.copy(on ? l.color : new THREE.Color(0x202020));
    }
    for (const b of this.buttons) {
      const lit = b.lit(st);
      b.mat.emissive.copy(lit ? b.color : new THREE.Color(0)).multiplyScalar(lit ? 0.9 : 0);
      b.press = Math.max(0, b.press - dt);
      b.mesh.position.z = b.baseZ - (b.press > 0 ? 0.008 : 0);
    }
    this.ebButton.press = Math.max(0, this.ebButton.press - dt);
    this.ebButton.mesh.position.z = 0.03 - (this.ebButton.press > 0 || st.notch === 'EB' ? 0.012 : 0);
    // Lever: forward = traction, back = brake.
    const target = st.notchPos * 0.085;
    this.leverAngle += (target - this.leverAngle) * Math.min(1, dt * 14);
    this.leverPivot.rotation.x = this.leverAngle;
    // Cab light.
    this.light.intensity = st.cabLight ? 2.2 : 0;
    this.ceilPanel.material.color.setHex(st.cabLight ? 0xfff6e0 : 0x3a3a3a);
    // Instruments at ~20 Hz.
    this.acc = (this.acc || 0) + dt;
    if (this.acc > 0.05) { this.speedo.draw(st); this.dmi.draw(st, this.acc); this.acc = 0; }
    this.clock.draw(st.clock);
  }
}

/** Mouse interaction with cab controls (left button). Right button is reserved for looking around. */
export class CabInteraction {
  constructor(dom, getCamera, bus) {
    this.dom = dom; this.getCamera = getCamera; this.bus = bus;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.targets = [];
    this.hover = null;
    this.drag = null;
    this.enabled = true;
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }
  setTargets(list) { this.targets = list; }
  pick(e) {
    if (!this.enabled || !this.targets.length) return null;
    const r = this.dom.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.getCamera());
    this.ray.far = 3;
    const hit = this.ray.intersectObjects(this.targets, false)[0];
    return hit ? hit.object : null;
  }
  onMove(e) {
    if (this.drag) {
      const it = this.drag.obj.userData.interact;
      if (it.dragRaw) { it.dragRaw(e.clientX - this.drag.x, e.clientY - this.drag.y0); this.drag.x = e.clientX; this.drag.y0 = e.clientY; return; }
      const dy = e.clientY - this.drag.y;
      const steps = Math.trunc(dy / 22);
      if (steps !== 0) { this.drag.obj.userData.interact.drag?.(steps); this.drag.y += steps * 22; this.drag.moved = true; }
      return;
    }
    const h = this.pick(e);
    if (h !== this.hover) {
      this.setHighlight(this.hover, false);
      this.hover = h;
      this.setHighlight(h, true);
      this.bus.emit('cab:hover', h ? h.userData.interact.label : null);
      this.dom.style.cursor = h ? 'pointer' : '';
    }
  }
  setHighlight(obj, on) {
    if (!obj) return;
    const target = obj.userData.interact.highlight || obj;
    const mat = target.material;
    if (mat?.emissive) {
      if (on) { target.userData.prevEm = mat.emissive.getHex(); mat.emissive.setHex(Math.max(mat.emissive.getHex(), 0x333333)); }
      else if (target.userData.prevEm != null) mat.emissive.setHex(target.userData.prevEm);
    }
  }
  onDown(e) {
    if (e.button !== 0) return;
    const h = this.pick(e);
    if (!h) return;
    const it = h.userData.interact;
    e.preventDefault();
    if (it.drag || it.dragRaw) { this.drag = { obj: h, y: e.clientY, x: e.clientX, y0: e.clientY, moved: false }; this.dom.setPointerCapture?.(e.pointerId); return; }
    if (it.down) { it.down(); this.holding = it; return; }
    it.click?.();
  }
  onUp(e) {
    if (this.drag) { this.drag.obj.userData.interact.release?.(); this.drag = null; }
    if (this.holding) { this.holding.up?.(); this.holding = null; }
  }
  onWheel(e) {
    const h = this.pick(e);
    if (h?.userData.interact.wheel) { e.preventDefault(); e.stopImmediatePropagation(); h.userData.interact.wheel(Math.sign(e.deltaY)); return true; }
    return false;
  }
}
