// Interactive bus driver's cab: steering wheel (mouse-draggable), pedals, push-button gear
// selector, parking-brake valve, instrument cluster (speed, rpm / power, fuel or battery,
// coolant, air pressure, warning lamps, indicators), driver information display with route
// and navigation map pages, door / kneeling / hazard / light / wiper / mirror / interior-light
// / emergency controls, interior camera monitor, exterior mirrors and windscreen wipers.
// Built in the bus body frame (forward −z, right +x); every control calls a real action.
import * as THREE from 'three';
import { Textures } from '../world/Textures.js';
import { formatClock, formatDelta, formatDistance } from '../core/util.js';

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}
const lbl = (text, bg = '#23272d', fg = '#e8e8e8') => Textures.label(text, { w: 256, h: 64, bg, fg, font: 'bold 26px Arial', radius: 6 });

export class BusCockpit {
  constructor(model, vehicle, actions) {
    this.model = model; this.v = vehicle; this.A = actions;
    const sp = vehicle.spec, W = sp.width, zf = model.zFront;
    this.group = new THREE.Group(); model.body.add(this.group);
    this.interactive = []; this.lamps = []; this.buttons = [];
    const xd = -W / 2 + 0.75; this.xd = xd;
    const dd = sp.type === 'doubledecker';
    this.eye = new THREE.Vector3(xd, dd ? 1.98 : 2.02, zf + 1.42);
    const M = this.M = {
      dash: new THREE.MeshStandardMaterial({ color: 0x25292e, roughness: 0.8 }), panel: new THREE.MeshStandardMaterial({ color: 0x31363c, roughness: 0.7, side: THREE.DoubleSide }),
      black: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.5 }), metal: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.3 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x1b2533, roughness: 0.9 }), rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }),
    };
    const add = (geo, mat, x, y, z, parent = this.group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    // Driver's cabin structure: dashboard, side consoles, seat, partition.
    add(new THREE.BoxGeometry(W - 0.15, 0.95, 0.55), M.dash, 0, 0.95, zf + 0.42);
    const top = add(new THREE.BoxGeometry(1.3, 0.05, 0.62), M.panel, xd + 0.1, 1.48, zf + 0.62); top.rotation.x = 0.25;
    add(new THREE.BoxGeometry(0.45, 0.85, 0.9), M.dash, xd - 0.55, 0.85, zf + 1.15);       // left console
    add(new THREE.BoxGeometry(0.4, 0.95, 0.75), M.dash, xd + 0.65, 0.9, zf + 1.05);       // right console
    add(new THREE.BoxGeometry(0.5, 0.12, 0.5), M.seat, xd, 1.0, zf + 1.6); add(new THREE.BoxGeometry(0.5, 0.75, 0.1), M.seat, xd, 1.45, zf + 1.86);
    add(new THREE.BoxGeometry(0.05, 1.3, 1.2), new THREE.MeshPhysicalMaterial({ color: 0xbfd6e2, transparent: true, opacity: 0.25, depthWrite: false }), xd + 0.9, 1.75, zf + 1.6); // cab door glass
    // Instrument cluster.
    this.cluster = canvasTex(1024, 384);
    const cl = add(new THREE.PlaneGeometry(0.66, 0.25), new THREE.MeshBasicMaterial({ map: this.cluster.t }), xd, 1.6, zf + 0.722); cl.rotation.x = -0.35;
    add(new THREE.BoxGeometry(0.72, 0.3, 0.02), M.black, xd, 1.597, zf + 0.705).rotation.x = -0.35;
    add(new THREE.BoxGeometry(0.8, 0.2, 0.25), M.dash, xd, 1.48, zf + 0.55);
    // Driver information / navigation display (right of the cluster).
    this.did = canvasTex(768, 512);
    const dg = add(new THREE.PlaneGeometry(0.36, 0.24), new THREE.MeshBasicMaterial({ map: this.did.t }), xd + 0.6, 1.66, zf + 0.66); dg.rotation.set(-0.35, -0.35, 0, 'YXZ');
    this.didPage = 'map';
    this.register(dg, 'Driver display — click to switch Route / Map page', { click: () => { this.didPage = this.didPage === 'map' ? 'route' : 'map'; this.A.click(); } });
    // Steering wheel.
    const col = new THREE.Group(); col.position.set(xd, 1.32, zf + 1.02); col.rotation.x = -1.05; this.group.add(col);
    this.wheel = new THREE.Group(); col.add(this.wheel);
    this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.022, 10, 40), M.rubber));
    for (let i = 0; i < 3; i++) { const sp2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.02), M.black); sp2.position.set(Math.sin((i * 2 * Math.PI) / 3 + Math.PI) * 0.11, Math.cos((i * 2 * Math.PI) / 3 + Math.PI) * 0.11, 0); sp2.rotation.z = -((i * 2 * Math.PI) / 3 + Math.PI); this.wheel.add(sp2); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 20), M.black); hub.rotation.x = Math.PI / 2; this.wheel.add(hub);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 40), new THREE.MeshBasicMaterial({ visible: false })); this.wheel.add(rim);
    this.register(rim, 'Steering wheel — drag left / right', { dragRaw: (dx) => this.A.steerDrag(dx), release: () => this.A.steerRelease() });
    this.register(hub, 'Horn — hold', { down: () => this.A.horn(true), up: () => this.A.horn(false) });
    // Indicator stalk on the column.
    const stalk = new THREE.Group(); stalk.position.set(-0.32, -0.05, 0.05); col.add(stalk);
    this.stalk = stalk;
    stalk.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), M.black));
    for (const [side, dy] of [['left', 0.04], ['right', -0.04]]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3f45 })); pad.position.set(-0.12, dy, 0); stalk.add(pad);
      this.register(pad, side === 'left' ? 'Indicator left' : 'Indicator right', { click: () => this.A.indicator(side) });
    }
    // Pedals.
    this.pedals = {};
    for (const [k, x, w] of [['brake', -0.13, 0.16], ['throttle', 0.1, 0.1]]) {
      const g = new THREE.Group(); g.position.set(xd + x, 0.42, zf + 0.85); this.group.add(g);
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, 0.03), M.rubber); p.position.y = 0.12; g.add(p);
      g.rotation.x = -0.6; this.pedals[k] = g;
    }
    // Interior camera monitor (upper left), exterior mirrors (render targets).
    this.rtInterior = new THREE.WebGLRenderTarget(320, 200);
    const mon = add(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ map: this.rtInterior.texture }), xd - 0.42, 2.55, zf + 0.5); mon.rotation.set(0.15, 0.45, 0, 'YXZ');
    add(new THREE.BoxGeometry(0.25, 0.17, 0.01), M.black, xd - 0.42, 2.55, zf + 0.49).rotation.set(0.15, 0.45, 0, 'YXZ');
    this.mirrors = [-1, 1].map((sx, i) => {
      const rt = new THREE.WebGLRenderTarget(160, 240);
      rt.texture.wrapS = THREE.RepeatWrapping; rt.texture.repeat.x = -1;
      const face = add(new THREE.PlaneGeometry(0.24, 0.42), new THREE.MeshBasicMaterial({ map: rt.texture }), sx * (W / 2 + 0.4), 2.25, zf + 0.38);
      face.rotation.y = sx * 0.25;
      const cam = new THREE.PerspectiveCamera(32, 160 / 240, 0.3, 160);
      cam.position.set(sx * (W / 2 + 0.4), 2.3, zf + 0.4);
      model.body.add(cam);
      return { rt, cam, sx, i };
    });
    this.intCam = new THREE.PerspectiveCamera(80, 1.6, 0.1, 60);
    this.intCam.position.set(W / 2 - 0.3, sp.type === 'doubledecker' ? 2.2 : 2.45, model.zRear - (sp.trailerLength ? sp.length - 2 : 0.6) * 0.0 - 0.8);
    this.intCam.rotation.set(-0.25, -0.12, 0, 'YXZ');
    if (sp.trailerLength) this.intCam.position.z = zf + sp.length - 1.2;
    model.body.add(this.intCam);
    // Wipers and rain on the windscreen.
    this.wipers = [-0.55, 0.5].map((x) => { const g = new THREE.Group(); g.position.set(x, 1.12, zf - 0.03); const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.95, 0.02), M.black); b.position.y = 0.47; g.add(b); this.group.add(g); return g; });
    this.drops = canvasTex(512, 256); this.dropAmt = 0; this.dropSeed = [];
    const dp = add(new THREE.PlaneGeometry(W - 0.2, 1.7), new THREE.MeshBasicMaterial({ map: this.drops.t, transparent: true, depthWrite: false }), 0, 1.95, zf - 0.005); dp.rotation.y = Math.PI; dp.renderOrder = 5;
    // Buttons: right console (sloped) and left console.
    const right = new THREE.Group(); right.position.set(xd + 0.65, 1.385, zf + 1.05); right.rotation.set(-0.5, 0, 0); this.group.add(right);
    const left = new THREE.Group(); left.position.set(xd - 0.55, 1.285, zf + 1.15); left.rotation.set(-0.45, 0, 0); this.group.add(left);
    const v = this.v;
    const doorBtns = v.doors.map((d, i) => [`DOOR ${i + 1}`, 0x2a7bff, () => this.A.door(i), () => d.target === 1]);
    const R = [
      ['ENGINE', 0x2fa84f, () => this.A.engine(), () => v.engineOn || v.cranking > 0],
      ...doorBtns,
      ['CLOSE ALL', 0xffc400, () => this.A.closeAll(), () => false],
      ['KNEEL', 0x9aa1a8, () => this.A.kneel(), () => v.kneel],
      ['HAZARD', 0xd01010, () => this.A.hazards(), () => v.hazards && v.blinkOn],
      ['INT LIGHT', 0xfff0c0, () => this.A.interior(), () => v.interiorLights],
      ['NAV PAGE', 0x5ab0ff, () => { this.didPage = this.didPage === 'map' ? 'route' : 'map'; this.A.click(); }, () => false],
    ];
    const L = [
      ['D', 0x2fa84f, () => this.A.gear('D'), () => v.gearSel === 'D'],
      ['N', 0xffffff, () => this.A.gear('N'), () => v.gearSel === 'N'],
      ['R', 0xff7a1a, () => this.A.gear('R'), () => v.gearSel === 'R'],
      ['PARK BRAKE', 0xd01010, () => this.A.parking(), () => v.parking],
      ['LIGHTS', 0x3a8bff, () => this.A.lights(), () => v.lights > 0],
      ['WIPERS', 0x9aa1a8, () => this.A.wipers(), () => v.wipers > 0],
      ['MIRROR L ◀', 0x9aa1a8, () => this.A.mirror(0, -1), () => false],
      ['MIRROR L ▶', 0x9aa1a8, () => this.A.mirror(0, 1), () => false],
      ['MIRROR R ◀', 0x9aa1a8, () => this.A.mirror(1, -1), () => false],
      ['MIRROR R ▶', 0x9aa1a8, () => this.A.mirror(1, 1), () => false],
    ];
    const bGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 18);
    const place = (parent, list, cols) => list.forEach(([label, color, act, lit], i) => {
      const x = -0.14 + (i % cols) * (0.28 / (cols - 1)), z = -0.3 + Math.floor(i / cols) * 0.11;
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x000000, roughness: 0.4 });
      const b = new THREE.Mesh(bGeo, mat); b.position.set(x, 0.0, z); parent.add(b);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.028), new THREE.MeshBasicMaterial({ map: lbl(label), transparent: true }));
      l.rotation.x = -Math.PI / 2; l.position.set(x, 0.001, z + 0.04); parent.add(l);
      const e = { mesh: b, mat, color: new THREE.Color(color), lit, press: 0 };
      this.buttons.push(e);
      this.register(b, label.charAt(0) + label.slice(1).toLowerCase(), { click: () => { e.press = 0.2; this.A.click(); act(); } });
    });
    place(right, R, 3); place(left, L, 3);
    // Emergency mushroom on the right console.
    const eb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd01010, emissive: 0x200000 }));
    eb.position.set(0.12, 0.0, 0.18); right.add(eb);
    const ebl = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), new THREE.MeshBasicMaterial({ map: lbl('EMERGENCY', '#8a0c0c', '#fff') })); ebl.rotation.x = -Math.PI / 2; ebl.position.set(0.12, 0.001, 0.24); right.add(ebl);
    this.register(eb, 'Emergency stop (hazards + full brake)', { click: () => this.A.emergency() });
    this.ebBtn = eb;
  }

  register(mesh, label, handlers) { mesh.userData.interact = { label, ...handlers }; this.interactive.push(mesh); }

  /** Per-frame: animate controls, redraw displays (~12 Hz). */
  update(dt, st) {
    const v = this.v, ph = v.ph;
    this.wheel.rotation.z = -ph.wheel;
    this.stalk.rotation.z = v.indicator === 'left' ? 0.18 : v.indicator === 'right' ? -0.18 : 0;
    this.pedals.throttle.rotation.x = -0.6 + st.throttle * 0.35;
    this.pedals.brake.rotation.x = -0.6 + st.brake * 0.4;
    for (const b of this.buttons) {
      const on = b.lit();
      b.mat.emissive.copy(on ? b.color : new THREE.Color(0)).multiplyScalar(on ? 0.8 : 0);
      b.press = Math.max(0, b.press - dt); b.mesh.position.y = b.press > 0 ? -0.006 : 0;
    }
    this.ebBtn.position.y = v.emergency ? -0.012 : 0;
    // Wipers sweep; they clear the drops.
    const wiping = v.wipers > 0;
    const ang = wiping ? (Math.sin(v.wiperPhase) * 0.5 + 0.5) * 1.45 : 0;
    this.wipers.forEach((w) => { w.rotation.z = -ang + 0.06; });
    this.dropAmt = Math.min(1, Math.max(0, this.dropAmt + dt * st.rain * 0.25 - (wiping ? dt * [0, 0.35, 0.7, 1.2][v.wipers] : 0)));
    this.acc = (this.acc || 0) + dt;
    if (this.acc > 0.08) { this.acc = 0; this.drawCluster(st); this.drawDid(st); this.drawDrops(); }
    // Mirror cameras look back along the sides, adjustable.
    for (const m of this.mirrors) m.cam.rotation.set(-0.05, Math.PI + m.sx * (0.1 + v.mirrorYaw[m.i]), 0, 'YXZ');
  }

  drawDrops() {
    const g = this.drops.g;
    g.clearRect(0, 0, 512, 256);
    const n = Math.floor(this.dropAmt * 240);
    while (this.dropSeed.length < 240) this.dropSeed.push([Math.random() * 512, Math.random() * 256, 1 + Math.random() * 3]);
    g.fillStyle = 'rgba(210,225,240,0.35)';
    for (let i = 0; i < n; i++) { const [x, y, r] = this.dropSeed[i]; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    if (Math.random() < 0.15) this.dropSeed.splice(Math.floor(Math.random() * this.dropSeed.length), 1);
    this.drops.t.needsUpdate = true;
  }

  drawCluster(st) {
    const g = this.cluster.g, v = this.v, ph = v.ph, W = 1024, H = 384;
    g.fillStyle = '#07090c'; g.fillRect(0, 0, W, H);
    const dial = (cx, cy, R, val, max, label, unit, step, red) => {
      const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, ang = (x) => a0 + (a1 - a0) * Math.max(0, Math.min(1, x / max));
      g.strokeStyle = '#2a3038'; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
      if (red) { g.strokeStyle = '#8a1c14'; g.beginPath(); g.arc(cx, cy, R, ang(red), a1); g.stroke(); }
      g.fillStyle = '#cfd6dd'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let x = 0; x <= max; x += step) { const a = ang(x); g.fillText(String(x), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32)); }
      const a = ang(val); g.strokeStyle = '#ff7a1a'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke();
      g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial'; g.fillText(label, cx, cy + 62); g.fillStyle = '#8fa1b3'; g.font = '18px Arial'; g.fillText(unit, cx, cy + 92);
    };
    dial(170, 175, 140, st.speed, 100, String(Math.round(st.speed)), 'km/h', 20, null);
    if (v.electric) dial(W - 170, 175, 140, Math.max(0, st.powerKw), 300, `${Math.round(st.powerKw)}`, 'kW', 50, null);
    else dial(W - 170, 175, 140, ph.rpm, 2500, `${Math.round(ph.rpm / 10) * 10}`, 'rpm', 500, 2200);
    // Centre column.
    const cx = W / 2;
    g.textAlign = 'center';
    g.fillStyle = '#ffffff'; g.font = 'bold 64px Arial';
    g.fillText(v.gearSel === 'D' && !v.electric ? `D${ph.gear}` : v.gearSel, cx, 70);
    g.font = '20px Arial'; g.fillStyle = '#8fa1b3'; g.fillText(formatClock(st.clock, false), cx, 115);
    const bar = (y, label, val, col) => { g.fillStyle = '#8fa1b3'; g.font = '18px Arial'; g.textAlign = 'left'; g.fillText(label, cx - 140, y); g.fillStyle = '#26313d'; g.fillRect(cx - 140, y + 10, 280, 14); g.fillStyle = col; g.fillRect(cx - 140, y + 10, 280 * Math.max(0, Math.min(1, val)), 14); g.textAlign = 'center'; };
    bar(150, v.electric ? `BATTERY ${Math.round(v.energyPct * 100)} %` : `FUEL ${Math.round(v.energy)} L`, v.energyPct, v.energyPct < 0.15 ? '#ff4030' : v.electric ? '#2fa84f' : '#ffb300');
    bar(195, `COOLANT ${Math.round(v.coolant)} °C`, (v.coolant - 20) / 90, v.coolant > 100 ? '#ff4030' : '#5ab0ff');
    bar(240, `AIR ${v.airPressure.toFixed(1)} bar`, v.airPressure / 10, v.airPressure < 6.5 ? '#ff4030' : '#cfd6dd');
    g.fillStyle = '#8fa1b3'; g.font = '18px Arial'; g.fillText(`${(ph.distance / 1000).toFixed(2)} km`, cx, 290);
    // Warning lamps row.
    const lamps = [
      ['P', '#ff3020', v.parking], ['⇦', '#2fff6a', (v.indicator === 'left' || v.hazards) && v.blinkOn], ['⇨', '#2fff6a', (v.indicator === 'right' || v.hazards) && v.blinkOn],
      ['DOORS', '#ffb300', !v.doorsClosed], ['STOP', '#2fff6a', v.stopRequest], ['KNEEL', '#ffb300', v.kneelT > 0.2], ['AIR', '#ff3020', v.airPressure < 6.5],
      ['ABS', '#ffb300', ph.slipping], ['≣D', '#3a8bff', v.lights === 2], ['SOS', '#ff3020', v.emergency],
    ];
    lamps.forEach(([t, c, on], i) => {
      const x = 60 + i * 92, y = 352;
      g.fillStyle = on ? c : '#1a1f25'; g.font = 'bold 22px Arial'; g.fillText(t, x, y);
    });
    this.cluster.t.needsUpdate = true;
  }

  drawDid(st) {
    const g = this.did.g, W = 768, H = 512;
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
    const r = st.route;
    // Header with route badge & destination.
    g.fillStyle = '#161c24'; g.fillRect(0, 0, W, 64);
    if (r) {
      g.fillStyle = r.color; g.fillRect(12, 10, 96, 44);
      g.fillStyle = r.textColor; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.route, 60, 33);
      g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = 'bold 26px Arial'; g.fillText(`→ ${st.destination || ''}`.slice(0, 40), 124, 33);
    } else { g.fillStyle = '#ffffff'; g.font = 'bold 26px Arial'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('FREE DRIVE', 16, 33); }
    g.textAlign = 'right'; g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText(`${st.passengers}/${st.capacity} pax`, W - 12, 33);
    g.textAlign = 'left';
    if (this.didPage === 'route' && r) {
      st.upcoming.slice(0, 7).forEach((s, i) => {
        const y = 100 + i * 56;
        g.fillStyle = i === 0 ? '#ffd25a' : '#dfe6ee'; g.font = `${i === 0 ? 'bold ' : ''}26px Arial`;
        g.fillText(s.name.length > 34 ? `${s.name.slice(0, 33)}…` : s.name, 24, y);
        g.textAlign = 'right'; g.fillStyle = '#8fa1b3'; g.font = '24px Arial'; g.fillText(s.time ? formatClock(s.time, false) : '', W - 20, y); g.textAlign = 'left';
        g.fillStyle = '#2a3442'; g.fillRect(24, y + 22, W - 48, 2);
      });
      g.fillStyle = Math.abs(st.delay) < 60 ? '#3cff8a' : st.delay > 0 ? '#ffb300' : '#5ab0ff'; g.font = 'bold 26px Arial';
      g.fillText(`Schedule ${formatDelta(st.delay)}`, 24, H - 24);
    } else this.drawMap(g, W, H, st);
    this.did.t.needsUpdate = true;
  }

  drawMap(g, W, H, st) {
    const v = this.v, ph = v.ph, scale = 1.1; // px per metre
    const cx = W / 2, cy = H * 0.66;
    const toS = (x, z) => { const dx = x - ph.x, dz = z - ph.z; const c = Math.cos(-ph.yaw), s = Math.sin(-ph.yaw); return [cx + (dx * c - dz * s) * scale, cy + (dx * s + dz * c) * scale]; };
    g.save(); g.beginPath(); g.rect(0, 64, W, H - 64); g.clip();
    g.strokeStyle = '#3a4554'; g.lineCap = 'round';
    for (const e of st.net.edges) { g.lineWidth = e.half * 2 * scale; const [x0, y0] = toS(e.a.x, e.a.z), [x1, y1] = toS(e.b.x, e.b.z); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    for (const n of st.net.nodes.values()) if (n.roundabout) { const [x, y] = toS(n.x, n.z); g.lineWidth = 7 * scale; g.beginPath(); g.arc(x, y, n.roundabout * scale, 0, Math.PI * 2); g.stroke(); }
    if (st.navPath) {
      g.strokeStyle = st.route?.color || '#5ab0ff'; g.lineWidth = 6;
      g.beginPath(); st.navPath.forEach((p, i) => { const [x, y] = toS(p.x, p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }
    for (const s of st.mapStops || []) { const [x, y] = toS(s.x, s.z); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = st.route?.color || '#ffd000'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    // Bus arrow.
    g.fillStyle = '#ffd25a'; g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 10, cy + 12); g.lineTo(cx, cy + 6); g.lineTo(cx - 10, cy + 12); g.closePath(); g.fill();
    g.restore();
    // Manoeuvre box.
    const m = st.maneuver;
    g.fillStyle = 'rgba(13,17,23,0.85)'; g.fillRect(0, 64, W, 84);
    g.fillStyle = '#ffffff'; g.font = 'bold 30px Arial'; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (m) {
      const arrow = m.kind === 'left' ? '↰' : m.kind === 'right' ? '↱' : m.kind === 'roundabout' ? `⟲${m.exit}` : '↑';
      g.font = 'bold 50px Arial'; g.fillText(arrow, 18, 106);
      g.font = 'bold 30px Arial'; g.fillText(formatDistance(m.dist), 120, 92);
      g.font = '22px Arial'; g.fillStyle = '#aab4bf'; g.fillText(m.kind === 'roundabout' ? `Roundabout, exit ${m.exit} · ${m.name}` : m.name, 120, 128);
    } else if (st.nextStopName) { g.font = '24px Arial'; g.fillText(`Next stop: ${st.nextStopName}`, 18, 106); }
    g.textAlign = 'right'; g.fillStyle = '#ffd25a'; g.font = 'bold 28px Arial'; g.fillText(st.stopDist < Infinity ? formatDistance(st.stopDist) : '', W - 16, 92);
    g.textAlign = 'left';
  }

  /** Render mirror images and the interior camera into their screens. */
  renderViews(renderer, scene, frame) {
    // Only when the driver can see them; mirrors alternate, the interior monitor refreshes slower.
    if (!this.visible) return;
    const prev = renderer.getRenderTarget();
    const m = this.mirrors[frame % 2];
    if (frame % 3 !== 2) { renderer.setRenderTarget(m.rt); renderer.render(scene, m.cam); }
    else if (frame % 6 === 2) { renderer.setRenderTarget(this.rtInterior); renderer.render(scene, this.intCam); }
    renderer.setRenderTarget(prev);
  }
  dispose() { for (const m of this.mirrors) m.rt.dispose(); this.rtInterior.dispose(); }
}
