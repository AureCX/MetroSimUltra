// 3D airliner built from its type's dimensions (nose towards +Z, left wing +X, y up, origin on the centreline at
// the height of the wing root; the main gear wheels touch y = −gearHeight). Every moving part is its own pivot:
// ailerons, elevators, rudder, flaps (slide aft and droop), spoilers, nose and main gear (retract into the body),
// engine fans / propellers (spin with N1), passenger door L1; lights: navigation (red left, green right, white
// tail), red anti-collision beacons, white strobes (double flash), landing / taxi lights. Livery from the airline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const glowTex = (() => { let t = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); t = new THREE.CanvasTexture(c); return t; }; })();

/** Fuselage: rings along z with radius r(t) and centre-height yc(t) (t 0 = tail cone tip .. 1 = nose). */
function fuselageGeometry(L, R, colors) {
  const NZ = 48, NA = 20, pos = [], col = [], idx = [];
  const prof = (t) => {
    // nose: ogive over the front 12 %, tail cone over the rear 22 % (rising to the APU), constant section between.
    if (t > 0.88) { const k = (t - 0.88) / 0.12; return { r: R * Math.sqrt(Math.max(0, 1 - k * k)) * (1 - 0.05 * k), y: -R * 0.12 * k }; }
    if (t < 0.22) { const k = 1 - t / 0.22; return { r: R * (1 - 0.82 * k), y: R * 0.55 * k }; }
    return { r: R, y: 0 };
  };
  const cBody = new THREE.Color(colors.body), cBelly = new THREE.Color(colors.belly), cStripe = new THREE.Color(colors.stripe), cWin = new THREE.Color(0x1a2430);
  for (let i = 0; i <= NZ; i++) {
    const t = i / NZ, z = -L / 2 + t * L, p = prof(t);
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2, x = Math.sin(a) * p.r, y = p.y + Math.cos(a) * p.r * 1.04;
      pos.push(x, y, z);
      const yn = Math.cos(a);
      // cockpit windows band at the nose, cheat-line stripe, belly
      let c = yn < -0.25 ? cBelly : cBody;
      if (Math.abs(yn + 0.05) < 0.07 && t > 0.2 && t < 0.86) c = cStripe;
      if (t > 0.885 && t < 0.925 && yn > 0.2 && yn < 0.62) c = cWin;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, prof };
}
/** A tapered, swept lifting surface (one side) from root (x0) to tip, as a thin wedge box. */
function surface(root, tip, span, sweep, thick, dihedral = 0, vertical = false) {
  // Corners: root LE (0,0,0), root TE (0,0,-root), tip LE (span, dz, -sweep), tip TE (span, dz, -sweep-tip)
  const dy = Math.tan(dihedral) * span;
  const P = vertical
    ? [[0, 0, 0], [0, 0, -root], [0, span, -sweep], [0, span, -sweep - tip]]
    : [[0, 0, 0], [0, 0, -root], [span, dy, -sweep], [span, dy, -sweep - tip]];
  const t = thick, off = vertical ? [t, 0, 0] : [0, t, 0];
  const v = [];
  const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  const up = P.map((p) => [p[0] + off[0] / 2, p[1] + off[1] / 2, p[2]]), dn = P.map((p) => [p[0] - off[0] / 2, p[1] - off[1] / 2, p[2]]);
  quad(up[0], up[2], up[3], up[1]); quad(dn[0], dn[1], dn[3], dn[2]);
  quad(up[0], dn[0], dn[2], up[2]); quad(up[1], up[3], dn[3], dn[1]); quad(up[2], dn[2], dn[3], up[3]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  return g;
}

export class AircraftModel {
  constructor(spec, airline = { color: '#1b2a4a', accent: '#b48a3c' }, { player = false, lod = 'high' } = {}) {
    this.spec = spec; this.group = new THREE.Group(); this.group.name = `aircraft-${spec.id}`;
    const S = spec, L = S.length, R = S.fuselageR, span = S.span;
    const std = (o) => new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.45, ...o });
    const M = {
      body: std({ vertexColors: true }), white: std({ color: 0xeef1f4 }), grey: std({ color: 0x9aa2aa, metalness: 0.5 }), dark: std({ color: 0x2a2e33 }),
      tail: std({ color: airline.color }), accent: std({ color: airline.accent }), metal: std({ color: 0xb8bec5, metalness: 0.85, roughness: 0.3 }),
      tyre: new THREE.MeshLambertMaterial({ color: 0x18191b }), fan: std({ color: 0x3a3f46, metalness: 0.7 }), prop: std({ color: 0x1e2226 }),
    };
    this.mats = M;
    const g = this.group;
    // Fuselage.
    const fus = fuselageGeometry(L, R, { body: '#f2f4f6', belly: '#c8ccd2', stripe: airline.color });
    g.add(new THREE.Mesh(fus.geo, M.body));
    // Cabin windows (dark dots along both sides).
    {
      const n = Math.floor(L * 0.62 / 0.53), geo = new THREE.BoxGeometry(0.03, 0.24, 0.18), parts = [];
      for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const z = -L * 0.3 + i * 0.53; if (Math.abs(z - (L * 0.36)) < 0.6) continue; const b = geo.clone(); b.translate(sd * R * 0.985, R * 0.28, z); parts.push(b); }
      if (parts.length) g.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ color: 0x1a2430 })));
    }
    // Wings (both sides), with dihedral; position.
    const high = !!S.highWing, wy = high ? R * 0.92 : -R * 0.55, wz = high ? -L * 0.02 : L * 0.06;
    const rootC = high ? 2.6 : span * 0.2, tipC = rootC * (high ? 0.62 : 0.28), sweepD = high ? 0.3 : span * 0.5 * Math.tan(0.44), half = span / 2 - R * 0.8, dih = high ? -0.02 : 0.09;
    this.wing = { y: wy, z: wz, root: rootC, tip: tipC, sweep: sweepD, half, dih };
    this.flaps = []; this.ailerons = []; this.spoilers = [];
    for (const sd of [1, -1]) {   // +1 = left wing (+X)
      const wg = surface(rootC, tipC, half, sweepD, high ? 0.35 : 0.5, dih);
      const wm = new THREE.Mesh(wg, M.white); wm.scale.x = sd; wm.position.set(sd * R * 0.8, wy, wz + rootC * 0.5); g.add(wm);
      const W = (u) => ({ x: sd * (R * 0.8 + u * half), y: wy + Math.tan(dih) * u * half, zLE: wz + rootC * 0.5 - u * sweepD, chord: rootC + (tipC - rootC) * u });
      // Flaps: inner 0.05–0.62 span, trailing 28 % chord; slide aft and droop.
      const mkTE = (u0, u1, frac, mat) => {
        const a = W(u0), b = W(u1);
        const piv = new THREE.Group(); piv.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.zLE - a.chord * (1 - frac) + b.zLE - b.chord * (1 - frac)) / 2);
        const w = Math.abs(b.x - a.x), c = (a.chord + b.chord) / 2 * frac;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, c), mat); m.position.z = -c / 2; piv.add(m);
        piv.rotation.y = -sd * Math.atan2(a.zLE - b.zLE, Math.abs(b.x - a.x)) * 0.6;
        g.add(piv); return piv;
      };
      this.flaps.push(mkTE(0.04, 0.6, 0.28, M.grey));
      this.ailerons.push({ piv: mkTE(0.66, 0.93, 0.22, M.grey), side: sd });
      for (const [u0, u1] of [[0.25, 0.4], [0.4, 0.55]]) { const sp = mkTE(u0, u1, 0.18, M.white); sp.position.y += 0.08; sp.position.z += (W(u0).chord * 0.25); this.spoilers.push(sp); }
      // Winglets / sharklets on the narrow-bodies.
      if (!high && span < 40) { const tip = W(1); const wl = surface(tipC * 0.9, tipC * 0.35, 2.2, 1.2, 0.12, 0, true); const m = new THREE.Mesh(wl, M.tail); m.position.set(tip.x, tip.y, tip.zLE); m.rotation.z = -sd * 0.12; g.add(m); }
      this.wingTip = this.wingTip || {}; this.wingTip[sd] = W(1.0);
    }
    // Engines.
    this.fans = [];
    const engSpan = S.engines === 2 ? [0.34] : [0.3, 0.62];
    for (const sd of [1, -1]) for (const u of engSpan) {
      const W = { x: sd * (R * 0.8 + u * half), y: wy + Math.tan(dih) * u * half, z: wz + rootC * 0.5 - u * sweepD };
      if (S.kind === 'jet') {
        const er = S.span > 50 ? 1.7 : 1.0, el = S.span > 50 ? 7 : 4.4;
        const nac = new THREE.Mesh(new THREE.CylinderGeometry(er, er * 0.82, el, 24, 1, true), M.white); nac.rotation.x = Math.PI / 2; nac.position.set(W.x, W.y - er * 1.15, W.z + el * 0.35); g.add(nac);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(er * 0.55, er * 0.3, el * 0.5, 16), M.grey); core.rotation.x = Math.PI / 2; core.position.set(W.x, W.y - er * 1.15, W.z + el * 0.35 - el * 0.55); g.add(core);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(er * 0.97, er * 0.08, 8, 24), M.metal); lip.position.set(W.x, W.y - er * 1.15, W.z + el * 0.85); g.add(lip);
        const fan = new THREE.Group(); fan.position.set(W.x, W.y - er * 1.15, W.z + el * 0.78);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(er * 0.93, 24), M.fan); fan.add(disc);
        for (let k = 0; k < 18; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.1, er * 0.86, 0.04), M.metal); bl.position.y = er * 0.45; const h = new THREE.Group(); h.rotation.z = (k / 18) * Math.PI * 2; h.add(bl); bl.rotation.y = 0.5; fan.add(h); }
        const spin = new THREE.Mesh(new THREE.ConeGeometry(er * 0.25, er * 0.5, 16), M.metal); spin.rotation.x = Math.PI / 2; spin.position.z = 0.2; fan.add(spin);
        g.add(fan); this.fans.push(fan);
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, er * 0.9, el * 0.7), M.white); pylon.position.set(W.x, W.y - er * 0.45, W.z + el * 0.15); g.add(pylon);
      } else {
        const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 5.2, 16), M.white); nac.rotation.x = Math.PI / 2; nac.position.set(W.x, W.y - 0.45, W.z + 1.2); g.add(nac);
        const prop = new THREE.Group(); prop.position.set(W.x, W.y - 0.45, W.z + 3.95);
        const spin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 16), M.white); spin.rotation.x = Math.PI / 2; prop.add(spin);
        for (let k = 0; k < 6; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.95, 0.05), M.prop); bl.position.y = 1.0; const h = new THREE.Group(); h.rotation.z = (k / 6) * Math.PI * 2; bl.rotation.y = 0.35; h.add(bl); prop.add(h); }
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1.98, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false })); prop.add(disc); prop.userData.disc = disc;
        g.add(prop); this.fans.push(prop);
      }
    }
    // Tail: horizontal stabiliser + elevators, fin + rudder (airline colours).
    const tz = -L / 2 + L * 0.06, hs = span * (high ? 0.27 : 0.2), hr = high ? 2.3 : span * 0.11, fh = S.height - (high ? 3.5 : R * 2 + 0.6);
    this.elevators = [];
    for (const sd of [1, -1]) {
      const yH = high ? fh * 0.92 + R : R * 0.35;
      const hg = surface(hr, hr * 0.45, hs / 2, hr * 0.7, 0.25, high ? 0 : 0.1);
      const m = new THREE.Mesh(hg, M.white); m.scale.x = sd; m.position.set(sd * (high ? 0.1 : R * 0.4), yH, tz + hr * 0.95); g.add(m);
      const piv = new THREE.Group(); piv.position.set(sd * (hs / 4 + 0.3), yH, tz + hr * 0.95 - hr * 0.88 - hs * 0.12);
      const el = new THREE.Mesh(new THREE.BoxGeometry(hs / 2 * 0.85, 0.1, hr * 0.32), M.grey); el.position.z = -hr * 0.16; piv.add(el); g.add(piv);
      this.elevators.push(piv);
    }
    {
      const fg = surface(hr * 1.4, hr * 0.7, fh, hr * 1.25, 0.32, 0, true);
      const fin = new THREE.Mesh(fg, M.tail); fin.position.set(0, R * 0.7, tz + hr * 1.55); g.add(fin);
      this.rudder = new THREE.Group(); this.rudder.position.set(0, R * 0.7 + fh * 0.5, tz + hr * 1.55 - hr * 1.4 - hr * 0.6);
      const rd = new THREE.Mesh(new THREE.BoxGeometry(0.22, fh * 0.9, hr * 0.42), M.accent); rd.position.z = -hr * 0.21; this.rudder.add(rd); g.add(this.rudder);
    }
    // Landing gear: nose + mains (bogies for the 777), retract by rotation.
    this.gear = [];
    const gh = S.gearHeight, wheel = new THREE.CylinderGeometry(S.span > 50 ? 0.62 : 0.5, S.span > 50 ? 0.62 : 0.5, 0.35, 16); wheel.rotateZ(Math.PI / 2);
    const leg = (x, z, wheels, axles, retractDir) => {
      const piv = new THREE.Group(); piv.position.set(x, -R * 0.6, z);
      const len = gh - R * 0.6 - 0.5;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 8), M.metal); strut.position.y = -len / 2; piv.add(strut);
      for (let a = 0; a < axles; a++) for (let w = 0; w < wheels; w++) { const wm = new THREE.Mesh(wheel, M.tyre); wm.position.set((w - (wheels - 1) / 2) * 0.55, -len - 0.0, (a - (axles - 1) / 2) * 1.45); piv.add(wm); }
      piv.userData.dir = retractDir; g.add(piv); this.gear.push(piv);
    };
    leg(0, L / 2 - L * 0.13, 2, 1, 1);
    const mz = wz + rootC * 0.5 - sweepD * 0.15 - rootC * 0.6;
    for (const sd of [1, -1]) leg(sd * S.mainGearX, mz, 2, S.span > 50 ? 3 : 1, sd);
    // Door L1 (front left, +X side): hinged at its front edge, swings outwards.
    this.door = new THREE.Group(); this.door.position.set(R * 0.99, R * 0.05, L / 2 - L * 0.16);
    const dm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 0.85), M.white); dm.position.z = -0.42; this.door.add(dm);
    const outline = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.9, 0.9), M.dark); outline.position.set(-0.03, 0, -0.42); this.door.add(outline);
    g.add(this.door);
    // Lights.
    const sprite = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); return s; };
    const tipL = this.wingTip[1], tipR = this.wingTip[-1];
    this.navL = sprite(0xff2020, 1.6); this.navL.position.set(tipL.x, tipL.y, tipL.zLE - 0.3); g.add(this.navL);
    this.navR = sprite(0x20ff40, 1.6); this.navR.position.set(tipR.x, tipR.y, tipR.zLE - 0.3); g.add(this.navR);
    this.navT = sprite(0xffffff, 1.2); this.navT.position.set(0, R * 0.5, -L / 2 + 0.2); g.add(this.navT);
    this.beacons = [sprite(0xff2a10, 2.2), sprite(0xff2a10, 2.2)]; this.beacons[0].position.set(0, R * 1.05, 0); this.beacons[1].position.set(0, -R * 1.05, L * 0.05); g.add(...this.beacons);
    this.strobes = [sprite(0xffffff, 4), sprite(0xffffff, 4), sprite(0xffffff, 3)];
    this.strobes[0].position.set(tipL.x, tipL.y, tipL.zLE - 0.6); this.strobes[1].position.set(tipR.x, tipR.y, tipR.zLE - 0.6); this.strobes[2].position.set(0, R * 0.5, -L / 2 + 0.1); g.add(...this.strobes);
    this.landing = [sprite(0xfff4dc, 3.5), sprite(0xfff4dc, 3.5), sprite(0xfff4dc, 2.4)];
    this.landing[0].position.set(R * 1.4, wy - 0.2, wz + rootC * 0.5 + 0.2); this.landing[1].position.set(-R * 1.4, wy - 0.2, wz + rootC * 0.5 + 0.2); this.landing[2].position.set(0, -R * 0.6 - 0.8, L / 2 - L * 0.13);
    g.add(...this.landing);
    if (player) {
      this.spot = new THREE.SpotLight(0xfff4dc, 0, 900, 0.32, 0.5, 1.2); this.spot.position.set(0, -R * 0.5, L / 2 - L * 0.1);
      this.spotTarget = new THREE.Object3D(); this.spotTarget.position.set(0, -12, L / 2 + 140); g.add(this.spot, this.spotTarget); this.spot.target = this.spotTarget;
    }
    this.state = { gear: 1, flaps: 0, spoilers: 0, ail: 0, elev: 0, rud: 0, n1: [0, 0], lights: { nav: true, beacon: false, strobe: false, landing: false }, door: 0 };
    this.fanAngle = 0;
  }

  /** st: { gear 0..1, flaps 0..1, spoilers 0..1, ail, elev, rud (-1..1), n1: [], lights, door 0..1 }, t (s), dt. */
  update(st, t, dt) {
    Object.assign(this.state, st);
    const s = this.state, S = this.spec;
    for (const piv of this.gear) { const k = 1 - s.gear; piv.rotation.x = piv === this.gear[0] ? -k * 1.55 : 0; piv.rotation.z = piv === this.gear[0] ? 0 : piv.userData.dir * k * 1.5; piv.visible = s.gear > 0.02; }
    for (const f of this.flaps) { f.rotation.x = s.flaps * 0.6; f.children[0].position.z = -this.wing.root * 0.14 - s.flaps * 0.9; }
    for (const a of this.ailerons) a.piv.rotation.x = -a.side * s.ail * 0.35;
    for (const sp of this.spoilers) sp.rotation.x = -s.spoilers * 0.9;
    for (const e of this.elevators) e.rotation.x = -s.elev * 0.35;
    this.rudder.rotation.y = -s.rud * 0.4;
    // Fans / propellers spin with N1.
    const n1 = s.n1?.length ? s.n1.reduce((a, b) => a + b, 0) / s.n1.length : 0;
    this.fanAngle += n1 * dt * (S.kind === 'jet' ? 60 : 110);
    for (const f of this.fans) { f.rotation.z = this.fanAngle; if (f.userData.disc) f.userData.disc.material.opacity = Math.min(0.35, n1 * 0.5); }
    this.door.rotation.y = s.door * 1.4;
    // Lights.
    const L = s.lights;
    this.navL.visible = this.navR.visible = this.navT.visible = !!L.nav;
    const bOn = L.beacon && (t % 1.0) < 0.12;
    for (const b of this.beacons) b.visible = bOn;
    const st2 = t % 1.2, sOn = L.strobe && (st2 < 0.05 || (st2 > 0.12 && st2 < 0.17));
    for (const b of this.strobes) b.visible = sOn;
    for (const l of this.landing) l.visible = !!L.landing;
    if (this.spot) this.spot.intensity = L.landing ? 900 : 0;
  }
  dispose() { this.group.parent?.remove(this.group); this.group.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); }); }
}
