// 3D flight deck of the player's aircraft (two-crew airliner layout): windscreen frame with pillars, glare shield
// with the flight control unit (selected speed / heading / altitude / vertical speed), main panel with the
// captain's and first officer's PFD + ND and the engine / warning display in the centre, pedestal with thrust
// levers, flap lever and speed-brake lever, gear lever, parking-brake handle, overhead panel, side consoles, seats,
// sidestick (Airbus types) or control column with yoke (Boeing / ATR). The levers move with the controls; the
// displays are canvases redrawn ~15 times a second. Coordinates: aircraft body frame (+X left, +Y up, +Z forward).
import * as THREE from 'three';
import { drawPFD, drawND, drawECAM } from './FlightDisplays.js';

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function canvasTex(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return { c, g: c.getContext('2d'), t }; }

export class Cockpit {
  constructor(spec) {
    this.spec = spec;
    const L = spec.length, R = spec.fuselageR;
    const g = this.group = new THREE.Group(); g.name = 'cockpit';
    // Origin of the deck: just behind the windscreen, at the pilots' eye height.
    const z0 = L * 0.385 - 0.4, y0 = R * 0.3; this.origin = new THREE.Vector3(0, y0, z0);
    const deck = this.deck = new THREE.Group(); deck.position.copy(this.origin); g.add(deck);
    const W = Math.min(1.25, R * 0.66);                      // half width of the deck
    this.eyeL = new THREE.Vector3(0.52, 0.2, -0.05).add(this.origin);   // captain (left seat, +X)
    const M = { panel: lam(0x56636f), dark: lam(0x2c343c), frame: lam(0x2a2f35), seat: lam(0x2c3440), floor: lam(0x23272c), knob: lam(0xd8dde2), red: lam(0xc0281e), black: lam(0x111316), light: new THREE.MeshBasicMaterial({ color: 0x8fd0ff }) };
    const box = (m, w, h, d, x, y, z, rx = 0, parent = deck) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; parent.add(b); return b; };
    // Shell: floor, side walls below the windows, rear bulkhead, ceiling with the overhead panel.
    box(M.floor, W * 2, 0.04, 2.6, 0, -1.02, -0.3);
    for (const s of [-1, 1]) { box(M.panel, 0.05, 0.95, 2.4, s * W, -0.55, -0.3); box(M.panel, 0.05, 0.25, 2.4, s * W * 0.92, 0.66, -0.3, 0); }
    box(M.panel, W * 2, 1.8, 0.05, 0, -0.1, -1.55);
    box(M.panel, W * 2, 0.05, 1.8, 0, 0.74, -0.5);
    const ovh = box(M.dark, W * 1.3, 0.05, 1.0, 0, 0.66, 0.15, -0.35);
    // Overhead switches and annunciators.
    for (let i = 0; i < 60; i++) { const k = box(i % 7 === 0 ? M.light : M.knob, 0.025, 0.02, 0.025, -W * 0.55 + (i % 12) * (W * 1.1 / 11), -0.035, -0.4 + Math.floor(i / 12) * 0.18, 0, ovh); void k; }
    // Windscreen frame: sill, centre post, A-pillars, side window posts, top frame (the glass itself is clear).
    const fz = 0.95;
    box(M.frame, W * 2, 0.04, 0.12, 0, 0.04, fz - 0.02);
    box(M.frame, 0.07, 0.55, 0.06, 0, 0.33, fz + 0.05, -0.5);
    for (const s of [-1, 1]) { const p = box(M.frame, 0.12, 0.6, 0.08, s * W * 0.62, 0.33, fz - 0.05, -0.5); p.rotation.z = s * 0.25; box(M.frame, 0.1, 0.55, 0.06, s * W * 0.97, 0.36, fz - 0.45, -0.2); box(M.frame, 0.1, 0.55, 0.06, s * W * 0.97, 0.36, fz - 1.0, 0); }
    box(M.frame, W * 2, 0.08, 0.4, 0, 0.64, fz - 0.15, 0.4);
    // Glare shield and FCU.
    box(M.dark, W * 1.9, 0.07, 0.2, 0, 0.0, 0.8);
    this.fcu = canvasTex(1024, 96);
    const fcu = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.056), new THREE.MeshBasicMaterial({ map: this.fcu.t, toneMapped: false })); fcu.position.set(0, -0.003, 0.697); fcu.rotation.y = Math.PI; deck.add(fcu);
    // Main panel (tilted back), displays.
    const panel = box(M.panel, W * 1.95, 0.5, 0.06, 0, -0.27, 0.86, -0.22);
    this.pfd = canvasTex(512, 512); this.nd = canvasTex(512, 512); this.ecam = canvasTex(512, 512);
    const screen = (tex, x, y, size = 0.2) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex.t, toneMapped: false })); m.position.set(x, y, -0.035); m.rotation.y = Math.PI; panel.add(m); const bz = new THREE.Mesh(new THREE.PlaneGeometry(size + 0.03, size + 0.03), M.black); bz.position.set(x, y, -0.032); bz.rotation.y = Math.PI; panel.add(bz); return m; };
    screen(this.pfd, 0.86, 0.04); screen(this.nd, 0.58, 0.04); screen(this.ecam, 0, 0.06, 0.22);
    screen(this.nd, -0.58, 0.04); screen(this.pfd, -0.86, 0.04);
    // Standby instruments, gear lever, autobrake.
    { const sb = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), M.black); sb.position.set(0.27, 0.1, -0.035); sb.rotation.y = Math.PI; panel.add(sb); }
    this.gearLever = new THREE.Group(); this.gearLever.position.set(-0.27, -0.03, -0.04); panel.add(this.gearLever);
    { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), M.knob); arm.position.y = 0.04; arm.rotation.x = 0.0; const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), M.knob); wh.rotation.x = Math.PI / 2; wh.position.y = 0.09; this.gearLever.add(arm, wh); this.gearLight = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x00ff55 })); this.gearLight.position.set(0.05, 0.1, 0.0); this.gearLight.rotation.y = Math.PI; this.gearLever.add(this.gearLight); }
    // Pedestal with thrust levers, speed brake, flaps, parking brake.
    const ped = box(M.dark, 0.5, 0.42, 0.8, 0, -0.78, 0.35);
    this.thrust = [];
    for (let i = 0; i < spec.engines; i++) { const piv = new THREE.Group(); piv.position.set(0.06 - i * 0.12 + (spec.engines > 2 ? 0.06 : 0), 0.22, 0.05); ped.add(piv); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), M.knob); arm.position.y = 0.09; const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.04), M.black); h.position.y = 0.18; piv.add(arm, h); this.thrust.push(piv); }
    this.spdBrk = new THREE.Group(); this.spdBrk.position.set(0.19, 0.22, 0.0); ped.add(this.spdBrk); { const a = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.015), M.knob); a.position.y = 0.06; this.spdBrk.add(a); }
    this.flapLev = new THREE.Group(); this.flapLev.position.set(-0.19, 0.22, 0.0); ped.add(this.flapLev); { const a = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.12, 0.015), M.knob); a.position.y = 0.06; const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.03), M.knob); h.position.y = 0.12; this.flapLev.add(a, h); }
    this.parkBrake = box(M.red, 0.04, 0.02, 0.04, -0.12, 0.22, -0.3, 0, ped);
    // Seats.
    for (const s of [-1, 1]) { box(M.seat, 0.5, 0.1, 0.5, s * 0.52, -0.62, -0.25); box(M.seat, 0.5, 0.8, 0.1, s * 0.52, -0.2, -0.52, 0.12); }
    // Sidestick or yoke.
    this.stick = new THREE.Group();
    if (spec.sidestick) { this.stick.position.set(W * 0.86, -0.55, 0.15); const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.45), M.panel); deck.add(c); c.position.set(W * 0.86, -0.67, 0.12); const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.13, 10), M.black); grip.position.y = 0.065; this.stick.add(grip); }
    else { this.stick.position.set(0.52, -0.62, 0.48); const col = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), M.dark); col.position.y = 0.21; this.yoke = new THREE.Group(); this.yoke.position.y = 0.42; const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), M.dark); const hl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), M.dark); hl.position.set(0.16, 0.05, 0); const hr = hl.clone(); hr.position.x = -0.16; this.yoke.add(bar, hl, hr); this.stick.add(col, this.yoke); }
    deck.add(this.stick);
    // Rudder pedals.
    this.pedals = [-1, 1].map((s) => box(M.dark, 0.08, 0.16, 0.03, 0.52 + s * 0.12, -0.92, 0.62));
    // Deck light (instrument flood) for night.
    this.flood = new THREE.PointLight(0xbcd2ff, 0.0, 3, 1.5); this.flood.position.set(0, 0.4, 0.2); deck.add(this.flood);
    this.acc = 0;
  }
  /** Move the levers / stick with the controls and redraw the displays (throttled). */
  update(dt, s, fm, night) {
    const c = fm.ctl;
    this.thrust.forEach((t) => { t.rotation.x = -0.35 + (c.reverse ? -0.25 : c.throttle * 0.8); });
    this.flapLev.rotation.x = -(fm.flapIdx / Math.max(1, fm.spec.flaps.length - 1)) * 0.8 + 0.3;
    this.spdBrk.rotation.x = -fm.spoilerCmd * 0.7 + (fm.spoilersArmed ? 0.1 : 0);
    this.gearLever.rotation.x = fm.gearCmd ? 0.4 : -0.4;
    this.gearLight.material.color.setHex(fm.gearPos > 0.98 ? 0x00ff55 : fm.gearPos < 0.02 ? 0x222222 : 0xff2a10);
    this.parkBrake.position.y = c.parking ? 0.24 : 0.22;
    const elev = c.elev, ail = c.ail;
    if (this.yoke) { this.stick.rotation.x = -elev * 0.25; this.yoke.rotation.z = -ail * 0.8; } else { this.stick.rotation.x = -elev * 0.35; this.stick.rotation.z = ail * 0.35; }
    this.pedals[0].position.z = 0.62 + c.rud * 0.05; this.pedals[1].position.z = 0.62 - c.rud * 0.05;
    this.flood.intensity = night * 0.8;
    this.acc += dt;
    if (this.acc > 1 / 15) { this.acc = 0; this.draw(s); }
  }
  draw(s) {
    drawPFD(this.pfd.g, s); this.pfd.t.needsUpdate = true;
    drawND(this.nd.g, s); this.nd.t.needsUpdate = true;
    drawECAM(this.ecam.g, s); this.ecam.t.needsUpdate = true;
    const g = this.fcu.g, ap = s.ap || {}; g.fillStyle = '#15191e'; g.fillRect(0, 0, 1024, 96);
    const box = (x, label, val, on) => { g.fillStyle = '#05080a'; g.fillRect(x, 26, 180, 52); g.fillStyle = '#ffb347'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(val, x + 90, 54); g.fillStyle = '#d8dde2'; g.font = 'bold 18px sans-serif'; g.fillText(label, x + 90, 13); if (on) { g.fillStyle = '#3cff6a'; g.fillRect(x + 160, 6, 14, 10); } };
    box(20, 'SPD', String(Math.round(ap.spdKt || 0)), ap.at); box(220, 'HDG', String(Math.round(ap.hdg ?? 0)).padStart(3, '0'), ap.on && ap.lat === 'HDG');
    box(560, 'ALT', String(Math.round((ap.altFt || 0) / 100) * 100), ap.on && ap.vert === 'ALT'); box(780, 'V/S', ap.vert === 'VS' ? `${ap.vsFpm >= 0 ? '+' : ''}${ap.vsFpm}` : '-----', ap.vert === 'VS');
    g.fillStyle = ap.on ? '#3cff6a' : '#555'; g.fillRect(420, 30, 50, 22); g.fillStyle = ap.appArmed ? '#3cff6a' : '#555'; g.fillRect(480, 30, 50, 22);
    g.fillStyle = '#d8dde2'; g.font = 'bold 16px sans-serif'; g.fillText('AP1', 445, 68); g.fillText('APPR', 505, 68);
    this.fcu.t.needsUpdate = true;
  }
  dispose() { this.group.parent?.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose(); if (o.material?.map) o.material.map.dispose(); }); }
}
