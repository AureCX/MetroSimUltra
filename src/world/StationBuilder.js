// Station interiors. Three architectural styles (vault / pillars / modern), side or island
// platforms, themed colours, name signs, adverts, exits, benches and live passenger information displays.
import * as THREE from 'three';
import { extrude, tunnelProfile, tunnelCrown, FLOOR_Y } from './Sweep.js';
import { Textures, shade } from './Textures.js';
import { hashString, seededRandom, formatClock } from '../core/util.js';

const PLATFORM_Y = 0.95;
const EDGE_GAP = 1.45; // track centre to platform edge

export class StationView {
  constructor(line, geom, routes, st, index, quality) {
    this.line = line; this.st = st; this.index = index; this.geom = geom; this.routes = routes;
    this.centerS = geom.stationS[index];
    this.group = new THREE.Group();
    this.group.name = `station:${st.name}`;
    const p = geom.point(this.centerS);
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = Math.PI - geom.heading(this.centerS);
    this.rand = seededRandom(hashString(st.name));
    this.pids = [];
    this.lastPid = -1;
    this.hs = geom.halfSpacingAt(this.centerS);
    const island = st.platformType === 'island';
    this.island = island;
    this.e = island ? this.hs - EDGE_GAP : this.hs + EDGE_GAP;
    this.W = island ? this.hs + 3.1 : this.e + st.platformWidth;
    this.Lp = st.platformLength;
    this.Lz = st.platformLength + 12;
    const crown = tunnelCrown(line.tunnelProfile);
    this.style = st.style;
    this.H = st.style === 'vault' ? 3.1 : st.style === 'grand' ? 4.6 : st.style === 'pillars' ? Math.max(4.3, crown + 0.5) : Math.max(5.2, crown + 0.7);
    this.vaultRise = st.style === 'grand' ? Math.max(5.4, crown + 0.6 - this.H) : Math.max(2.9, crown + 0.6 - this.H);
    this.vaulted = st.style === 'vault' || st.style === 'grand';
    this.outdoor = geom.outdoorAt(this.centerS);
    if (this.outdoor) { this.H = PLATFORM_Y + 3.3; this.vaulted = false; }
    this.mats();
    this.buildShell();
    this.buildPlatforms();
    this.buildSigns();
    this.buildFurniture();
    this.buildPIDs();
    if (this.outdoor) this.buildCanopy();
    else this.buildPortals();
    if (this.style === 'grand' && !this.outdoor) this.buildGrand();
  }

  /** Height of the ceiling above local x. */
  ceilAt(x) { return this.vaulted ? this.H + this.vaultRise * Math.sqrt(Math.max(0, 1 - (x / this.W) ** 2)) : this.H; }

  mats() {
    const st = this.st, accent = st.theme.accent || this.line.color;
    const emissive = (m, k = 0.28) => { m.emissive = new THREE.Color(k, k, k); m.emissiveMap = m.map; return m; };
    let wallTex, ceilTex;
    if (this.style === 'vault') { wallTex = Textures.tiles(st.theme.wall || '#f4f1e8', '#b8b2a4', 8, 16); ceilTex = wallTex; }
    else if (this.style === 'pillars') { wallTex = Textures.tiles(st.theme.wall || '#8fbf9f', shade(st.theme.wall || '#8fbf9f', -40), 6, 12); ceilTex = Textures.floor('#e9e6df'); }
    else if (this.style === 'grand') { wallTex = Textures.marble(st.theme.wall || '#efe6d2', '#b9a27a'); ceilTex = Textures.vaultCoffers(st.theme.vault || '#1b2a4a', '#d8b45a'); }
    else { wallTex = Textures.tiles(st.theme.wall || '#3b4149', '#1f2329', 2, 2, false); ceilTex = Textures.tiles('#2a2e34', '#16181c', 1, 12, false); }
    this.m = {
      wall: emissive(new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide })),
      ceil: emissive(new THREE.MeshLambertMaterial({ map: ceilTex, side: THREE.DoubleSide }), this.style === 'modern' ? 0.15 : 0.3),
      floor: emissive(new THREE.MeshLambertMaterial({ map: this.style === 'grand' ? Textures.marbleFloor('#e8e0cc', '#2f4a3c', '#c9a227') : Textures.floor(this.style === 'modern' ? '#b9b6b0' : '#9b968c') }), 0.25),
      edge: emissive(new THREE.MeshLambertMaterial({ map: Textures.platformEdge() }), 0.3),
      face: new THREE.MeshLambertMaterial({ map: Textures.concrete('#57534c') }),
      pit: new THREE.MeshLambertMaterial({ map: Textures.trackbed() }),
      accent: emissive(new THREE.MeshLambertMaterial({ color: accent }), 0.25),
      metal: new THREE.MeshStandardMaterial({ color: 0x7d858d, metalness: 0.7, roughness: 0.4 }),
      dark: new THREE.MeshLambertMaterial({ color: 0x0b0c0e }),
      light: new THREE.MeshBasicMaterial({ color: this.style === 'modern' ? 0xeaf3ff : 0xfff3d6 }),
      wood: emissive(new THREE.MeshLambertMaterial({ color: 0x8a5a33 }), 0.2),
      portal: new THREE.MeshLambertMaterial({ map: Textures.concrete('#5e5a53'), side: THREE.DoubleSide }),
    };
    this.m.wall.map.repeat?.set(1, 1);
  }

  box(w, h, d, mat, x, y, z, parent = this.group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); parent.add(m); return m;
  }
  plane(w, h, mat, x, y, z, ry = 0, parent = this.group) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
  }

  /** Outline of the station cross-section: walls + roof (local x, left = +). */
  shellProfile() {
    const W = this.W, base = this.island ? FLOOR_Y : PLATFORM_Y;
    const pts = [[-W, base], [-W, this.H]];
    if (this.vaulted) {
      const n = this.style === 'grand' ? 30 : 18;
      for (let k = 1; k < n; k++) { const a = Math.PI - (k / n) * Math.PI; pts.push([W * Math.cos(a), this.H + this.vaultRise * Math.sin(a)]); }
    }
    pts.push([W, this.H], [W, base]);
    return pts;
  }

  buildShell() {
    if (this.outdoor) return; // open air: the landscape builder provides the track bed
    const z0 = -this.Lz / 2, z1 = this.Lz / 2;
    const prof = this.shellProfile();
    const wallUv = this.style === 'modern' ? 0.25 : 0.5;
    if (this.style === 'vault') {
      this.group.add(new THREE.Mesh(extrude(prof, z0, z1, { uScale: wallUv, vScale: wallUv }), this.m.wall));
    } else if (this.style === 'grand') {
      // marble walls, gilded coffered vault
      for (const w of [prof.slice(0, 2), prof.slice(-2)]) this.group.add(new THREE.Mesh(extrude(w, z0, z1, { uScale: 0.3, vScale: 0.3 }), this.m.wall));
      this.group.add(new THREE.Mesh(extrude(prof.slice(1, -1), z0, z1, { uScale: 0.22, vScale: 0.22 }), this.m.ceil));
    } else {
      const walls = [prof.slice(0, 2), prof.slice(-2)];
      for (const w of walls) this.group.add(new THREE.Mesh(extrude(w, z0, z1, { uScale: wallUv, vScale: wallUv }), this.m.wall));
      this.group.add(new THREE.Mesh(extrude([[-this.W, this.H], [this.W, this.H]], z0, z1, { uScale: 0.25, vScale: 0.25 }), this.m.ceil));
    }
    // Track pit floor.
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 2, this.Lz), this.m.pit);
    pit.rotation.x = -Math.PI / 2; pit.position.y = FLOOR_Y + 0.02;
    this.group.add(pit);
  }

  /** Platform extents in local x: [inner, outer] pairs. */
  platformSpans() {
    if (this.island) return [[-this.e, this.e]];
    return [[-this.W, -this.e], [this.e, this.W]];
  }

  buildPlatforms() {
    const Lp = this.Lp, h = PLATFORM_Y - FLOOR_Y;
    for (const [a, b] of this.platformSpans()) {
      const w = b - a, cx = (a + b) / 2;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(w, Lp), this.m.floor);
      top.rotation.x = -Math.PI / 2; top.position.set(cx, PLATFORM_Y, 0);
      top.material.map.repeat.set(1, 1);
      this.group.add(top);
      this.box(w, h - 0.02, Lp, this.m.face, cx, FLOOR_Y + h / 2 - 0.01, 0);
      // Yellow safety edges along track sides.
      const edges = this.island ? [a + 0.3, b - 0.3] : [a < 0 ? b - 0.3 : a + 0.3];
      for (const ex of edges) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(0.6, Lp), this.m.edge);
        e.rotation.x = -Math.PI / 2; e.position.set(ex, PLATFORM_Y + 0.004, 0);
        this.group.add(e);
      }
      // Platform end ramps / barriers.
      for (const z of [-Lp / 2, Lp / 2]) {
        const gate = this.box(0.05, 1.0, 0.05, this.m.metal, cx, PLATFORM_Y + 0.5, z);
        gate.scale.set(1, 1, 1);
        this.box(w * 0.8, 0.05, 0.05, this.m.metal, cx, PLATFORM_Y + 1.0, z);
      }
    }
  }

  buildSigns() {
    if (this.outdoor) { this.buildOutdoorSigns(); return; }
    const st = this.st, accent = st.theme.accent || this.line.color;
    const signOpts = this.style === 'grand'
      ? { w: 768, h: 128, bg: '#123524', fg: '#f3dc9a', font: 'bold 60px Georgia, "Times New Roman", serif', border: '#d8b45a' }
      : this.style === 'vault'
      ? { w: 768, h: 128, bg: '#11316e', fg: '#ffffff', font: 'bold 62px "Helvetica Neue", Arial, sans-serif', border: '#ffffff' }
      : this.style === 'pillars'
        ? { w: 768, h: 128, bg: '#ffffff', fg: '#111111', font: 'bold 64px "DIN Alternate", Arial, sans-serif', border: accent }
        : { w: 768, h: 128, bg: '#15181c', fg: '#ffffff', font: '600 62px "Segoe UI", Arial, sans-serif', border: accent };
    const signMat = new THREE.MeshLambertMaterial({ map: Textures.label(st.name, signOpts), emissive: 0x888888 });
    signMat.emissiveMap = signMat.map;
    const y = this.island ? 2.3 : PLATFORM_Y + 1.45;
    const walls = [[-this.W + 0.03, Math.PI / 2], [this.W - 0.03, -Math.PI / 2]];
    const step = 21;
    let n = 0;
    for (let z = -this.Lp / 2 + 9; z < this.Lp / 2 - 6; z += step / 2, n++) {
      for (const [x, ry] of walls) {
        if (n % 2 === 0) {
          this.plane(3.8, 0.64, signMat, x, y, z, ry);
        } else {
          const frame = this.box(0.06, 2.05, 2.75, this.style === 'vault' || this.style === 'grand' ? new THREE.MeshLambertMaterial({ color: 0x9c7b3c }) : this.m.metal, x + (x < 0 ? 0.0 : 0.0), y + 0.2, z);
          frame.position.x = x;
          const pm = new THREE.MeshLambertMaterial({ map: Textures.poster(Math.floor(this.rand() * 1000)), emissive: 0xaaaaaa });
          pm.emissiveMap = pm.map;
          this.plane(2.6, 1.9, pm, x + (x < 0 ? 0.04 : -0.04), y + 0.2, z, ry);
        }
      }
    }
    // Accent stripe along the walls.
    for (const [x, ry] of walls) {
      const s = this.plane(this.Lz, 0.18, this.m.accent, x + (x < 0 ? 0.01 : -0.01), y + 1.35, 0, ry);
      s.scale.x = 1;
    }
    // Direction & exit signs hanging over platforms.
    const termA = this.line.directions.A.terminus, termB = this.line.directions.B.terminus;
    const spans = this.platformSpans();
    const hangY = this.island ? Math.min(this.H - 0.6, 3.6) : Math.min(this.H - 0.3, PLATFORM_Y + 2.55);
    this.exits = [];
    spans.forEach(([a, b]) => {
      const cx = (a + b) / 2;
      for (const z of [-this.Lp / 2 + 14, this.Lp / 2 - 14]) {
        const exitMat = new THREE.MeshBasicMaterial({ map: Textures.label('SORTIE  ·  EXIT  ➜', { w: 512, h: 96, bg: '#0f6b3a', fg: '#ffffff', font: 'bold 44px Arial' }) });
        const g = new THREE.Group();
        g.position.set(cx, hangY, z);
        this.plane(2.2, 0.42, exitMat, 0, 0, 0.02, 0, g);
        this.plane(2.2, 0.42, exitMat, 0, 0, -0.02, Math.PI, g);
        const top = this.ceilAt(cx) - hangY;
        this.box(0.02, Math.max(0.1, top), 0.02, this.m.metal, -0.9, top / 2, 0, g);
        this.box(0.02, Math.max(0.1, top), 0.02, this.m.metal, 0.9, top / 2, 0, g);
        this.group.add(g);
        this.exits.push({ x: this.island ? cx : (a < 0 ? a + 0.6 : b - 0.6), z });
      }
    });
    // Exit openings in the walls (side platforms) or stairwells (island).
    for (const ex of this.exits) {
      if (this.island) {
        const well = this.box(2.2, 0.02, 6, this.m.dark, 0, PLATFORM_Y + 0.01, ex.z + (ex.z > 0 ? -3 : 3));
        well.scale.y = 1;
        for (const sx of [-1.15, 1.15]) this.box(0.05, 1.0, 6, this.m.metal, sx, PLATFORM_Y + 0.5, well.position.z);
      } else {
        const x = ex.x < 0 ? -this.W + 0.02 : this.W - 0.02;
        this.plane(2.4, 2.3, this.m.dark, x, PLATFORM_Y + 1.15, ex.z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    // Direction boards on the walls (side) or pillars (island).
    const dirs = this.island ? [[0, `⬅ ${termB}   |   ${termA} ➜`]] : [[-1, `Direction ${termA}`], [1, `Direction ${termB}`]];
    for (const [side, text] of dirs) {
      const mat = new THREE.MeshBasicMaterial({ map: Textures.label(text, { w: 1024, h: 96, bg: '#f5f5f0', fg: '#1a1a1a', font: 'bold 46px Arial', border: accent }) });
      const g = new THREE.Group();
      g.position.set(side === 0 ? 0 : (side < 0 ? -(this.e + this.W) / 2 : (this.e + this.W) / 2), hangY - 0.6, 0);
      this.plane(3.6, 0.34, mat, 0, 0, 0.02, 0, g);
      this.plane(3.6, 0.34, mat, 0, 0, -0.02, Math.PI, g);
      this.group.add(g);
    }
  }

  buildFurniture() {
    const Lp = this.Lp;
    // Lighting fixtures.
    if (this.outdoor) { /* canopy lights are built with the canopy */ } else if (this.style === 'vault') {
      for (const [a, b] of this.platformSpans()) {
        const cx = (a + b) / 2;
        for (let z = -Lp / 2 + 4; z < Lp / 2 - 2; z += 8) this.box(0.25, 0.08, 5.5, this.m.light, cx, this.H + 0.55, z);
      }
    } else if (this.style === 'pillars') {
      for (const x of [-this.W * 0.55, 0, this.W * 0.55]) for (let z = -Lp / 2 + 3; z < Lp / 2; z += 6) this.box(0.3, 0.05, 3.4, this.m.light, x, this.H - 0.04, z);
      const pillarMat = new THREE.MeshLambertMaterial({ color: this.st.theme.accent || '#2d5a8a', emissive: 0x111111 });
      const xs = this.island ? [0] : [-(this.e + this.W) / 2, (this.e + this.W) / 2];
      const name = new THREE.MeshBasicMaterial({ map: Textures.label(this.st.name, { w: 512, h: 96, bg: '#ffffff', fg: '#111', font: 'bold 50px Arial' }) });
      for (const x of xs) for (let z = -Lp / 2 + 10; z < Lp / 2 - 6; z += 9) {
        const ph = this.H - PLATFORM_Y;
        this.box(0.45, ph, 0.45, pillarMat, x, PLATFORM_Y + ph / 2, z);
        if (Math.round(z) % 2 === 0) for (const sx of [-0.23, 0.23]) this.plane(1.4, 0.26, name, x + sx, 2.4, z, sx < 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    } else if (this.style === 'modern') {
      for (const x of [-this.W + 1, -this.e - 0.3, this.e + 0.3, this.W - 1]) this.box(0.08, 0.04, this.Lz, this.m.light, x, this.H - 0.05, 0);
      for (let z = -this.Lz / 2; z < this.Lz / 2; z += 1.2) this.box(this.W * 2, 0.08, 0.12, this.m.dark, 0, this.H - 0.15, z);
    }
    // Benches & bins against the walls (or along island centre).
    const wood = this.m.wood;
    const benchX = this.island ? [-0.9, 0.9] : [-this.W + 0.45, this.W - 0.45];
    for (const x of benchX) for (let z = -Lp / 2 + 18; z < Lp / 2 - 18; z += 17) {
      this.box(0.45, 0.06, 2.2, wood, x, PLATFORM_Y + 0.45, z);
      this.box(0.06, 0.45, 2.2, wood, x + (x < 0 ? -0.2 : 0.2) * (this.island ? -1 : 1), PLATFORM_Y + 0.7, z);
      for (const dz of [-0.9, 0.9]) this.box(0.4, 0.42, 0.06, this.m.metal, x, PLATFORM_Y + 0.21, z + dz);
      this.box(0.35, 0.8, 0.35, this.m.metal, x, PLATFORM_Y + 0.4, z + 2.0);
    }
  }

  buildPIDs() {
    const spans = this.platformSpans();
    const routes = this.island ? [['A', -1], ['B', 1]] : [['A', -1], ['B', 1]];
    for (const [dir, side] of routes) {
      const span = this.island ? spans[0] : spans[side < 0 ? 0 : 1];
      const x = this.island ? side * 0.6 : (span[0] + span[1]) / 2;
      const y = this.island ? Math.min(this.H - 0.9, 3.3) : Math.min(this.H - 0.6, PLATFORM_Y + 2.45);
      for (const z of [-this.Lp / 4, this.Lp / 4]) {
        const c = document.createElement('canvas'); c.width = 512; c.height = 128;
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex });
        const g = new THREE.Group(); g.position.set(x, y, z);
        this.box(1.95, 0.55, 0.12, this.m.dark, 0, 0, 0, g);
        this.plane(1.85, 0.46, mat, 0, 0, 0.065, 0, g);
        this.plane(1.85, 0.46, mat, 0, 0, -0.065, Math.PI, g);
        this.box(0.03, this.ceilAt(x) - y, 0.03, this.m.metal, 0, (this.ceilAt(x) - y) / 2, 0, g);
        this.group.add(g);
        this.pids.push({ dir, c, ctx: c.getContext('2d'), tex });
      }
    }
  }

  updatePIDs(clock, etaProvider) {
    const sec = Math.floor(clock);
    if (sec === this.lastPid) return;
    this.lastPid = sec;
    for (const p of this.pids) {
      const g = p.ctx, etas = etaProvider ? etaProvider(this.index, p.dir) : [];
      const term = this.line.directions[p.dir].terminus;
      g.fillStyle = '#050505'; g.fillRect(0, 0, 512, 128);
      g.fillStyle = this.line.color; g.fillRect(10, 12, 56, 46);
      g.fillStyle = this.line.textColor; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText(this.line.number, 38, 46);
      g.textAlign = 'left'; g.fillStyle = '#ffb000'; g.font = 'bold 30px "Courier New", monospace';
      g.fillText(term.length > 20 ? `${term.slice(0, 19)}…` : term, 78, 46);
      g.font = 'bold 26px "Courier New", monospace';
      g.textAlign = 'right'; g.fillText(formatClock(clock, false), 500, 46);
      g.textAlign = 'left';
      const txt = etas.slice(0, 2).map((s) => (s < 20 ? 'À quai / Arriving' : `${Math.max(1, Math.round(s / 60))} min`));
      g.fillStyle = '#ffd25a'; g.font = 'bold 34px "Courier New", monospace';
      g.fillText(txt[0] || '--', 20, 104);
      if (txt[1]) { g.textAlign = 'right'; g.fillText(txt[1], 492, 104); }
      p.tex.needsUpdate = true;
    }
    this.drawClock?.(clock);
  }

  /** End walls with tunnel mouths. */
  buildPortals() {
    const outline = this.shellProfile().map(([x, y]) => [x, y]);
    outline[0][1] = FLOOR_Y - 0.1; outline[outline.length - 1][1] = FLOOR_Y - 0.1;
    for (const sz of [-1, 1]) {
      const s = this.centerS + sz * this.Lz / 2;
      const hw = this.geom.tunnelHalfWidthAt(s);
      const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
      const hole = tunnelProfile(Math.min(hw, this.W - 0.15), this.line.tunnelProfile).map(([x, y]) => new THREE.Vector2(x, Math.max(y, FLOOR_Y)));
      shape.holes.push(new THREE.Path(hole.reverse()));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), this.m.portal);
      mesh.position.z = sz * this.Lz / 2;
      this.group.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// "grand" style: a cathedral-like hall — ribbed coffered vault with a stained-glass skylight,
// chandeliers, marble pilasters, a mezzanine balustrade, lantern posts, mosaic murals and a clock.
StationView.prototype.buildGrand = function buildGrand() {
  const W = this.W, H = this.H, rise = this.vaultRise, Lz = this.Lz, Lp = this.Lp;
  const base = this.island ? FLOOR_Y : PLATFORM_Y;
  const accent = this.st.theme.accent || this.line.color;
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b45a, metalness: 0.85, roughness: 0.3, emissive: 0x2a1e06 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1d2420, metalness: 0.6, roughness: 0.5 });
  const darkMarble = new THREE.MeshLambertMaterial({ map: Textures.marble('#4d7a63', '#cfe3d5'), emissive: 0x555555 });
  darkMarble.emissiveMap = darkMarble.map;
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
  const crown = H + rise;

  // Dark marble dado along the walls.
  for (const sx of [-1, 1]) {
    const d = this.box(0.04, 1.3, Lz, darkMarble, sx * (W - 0.03), base + 0.65, 0);
    d.material.map.repeat.set(Lz / 6, 1);
  }
  // Transverse ribs with pilasters beneath.
  const arc = [];
  for (let k = 0; k <= 40; k++) { const a = Math.PI - (k / 40) * Math.PI; arc.push(new THREE.Vector3((W - 0.1) * Math.cos(a), H + (rise - 0.1) * Math.sin(a), 0)); }
  const ribGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arc), 60, 0.13, 8, false);
  const step = 7.5;
  for (let z = -Lz / 2 + 3.75; z < Lz / 2 - 1; z += step) {
    const rib = new THREE.Mesh(ribGeo, gold); rib.position.z = z; this.group.add(rib);
    for (const sx of [-1, 1]) {
      this.box(0.36, H - base, 0.6, darkMarble, sx * (W - 0.18), (H + base) / 2, z);
      this.box(0.5, 0.25, 0.8, gold, sx * (W - 0.24), H - 0.1, z);
      this.box(0.46, 0.18, 0.74, gold, sx * (W - 0.22), base + 0.09, z);
    }
  }
  // Mezzanine galleries with balustrades.
  const balGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.8, 8);
  const balusters = [];
  for (const sx of [-1, 1]) {
    const x = sx * (W - 0.55);
    this.box(1.1, 0.22, Lz, gold, sx * (W - 0.55), H + 0.11, 0);
    this.box(0.08, 0.08, Lz, gold, sx * (W - 1.08), H + 1.1, 0);
    this.box(0.12, 0.06, Lz, gold, sx * (W - 1.08), H + 0.25, 0);
    for (let z = -Lz / 2 + 0.2; z < Lz / 2; z += 0.32) balusters.push([sx * (W - 1.08), H + 0.66, z]);
    void x;
  }
  const bal = new THREE.InstancedMesh(balGeo, gold, balusters.length);
  const m4 = new THREE.Matrix4();
  balusters.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); bal.setMatrixAt(i, m4); });
  bal.computeBoundingSphere();
  this.group.add(bal);

  // Stained-glass skylight along the crown, with soft light shafts.
  const glassMat = new THREE.MeshBasicMaterial({ map: Textures.stainedGlass(this.index + 3), side: THREE.DoubleSide });
  glassMat.map.wrapT = THREE.RepeatWrapping; glassMat.map.repeat.set(1, Lz / 12);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.6, Lz - 2), glassMat);
  sky.rotation.x = Math.PI / 2; sky.position.y = crown - 0.06;
  this.group.add(sky);
  this.box(3.0, 0.1, Lz - 1.6, gold, 0, crown - 0.02, 0);
  const shaftTex = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(255,225,160,0.55)'); grd.addColorStop(1, 'rgba(255,225,160,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
    return new THREE.CanvasTexture(c);
  })();
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (let z = -Lp / 2 + 12; z < Lp / 2 - 6; z += 14) {
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4, crown - base - 0.2), shaftMat);
    shaft.position.set(0, (crown + base) / 2, z); shaft.rotation.z = 0.12; this.group.add(shaft);
    const s2 = shaft.clone(); s2.rotation.y = Math.PI / 2; this.group.add(s2);
  }

  // Chandeliers hanging from the vault.
  const sphere = new THREE.SphereGeometry(0.11, 12, 8);
  const ringGeo = new THREE.TorusGeometry(0.95, 0.04, 8, 32);
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,200,1)'); grd.addColorStop(0.3, 'rgba(255,220,150,0.45)'); grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const xs = this.island ? [-(this.e + 1.45), this.e + 1.45] : [-(this.e + W) / 2, (this.e + W) / 2];
  for (let z = -Lp / 2 + 8; z < Lp / 2 - 4; z += 15) for (const cx of xs) {
    const top = this.ceilAt(cx);
    const y = Math.max(base + 3.4, top - 3.2);
    const g = new THREE.Group(); g.position.set(cx, y, z);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, top - y), gold); rod.position.y = (top - y) / 2; g.add(rod);
    for (const [r, dy] of [[0.95, 0], [0.6, 0.45]]) {
      const ring = new THREE.Mesh(ringGeo, gold); ring.rotation.x = Math.PI / 2; ring.scale.setScalar(r / 0.95); ring.position.y = dy; g.add(ring);
      const n = r > 0.8 ? 10 : 6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const b = new THREE.Mesh(sphere, glow); b.position.set(Math.cos(a) * r, dy + 0.12, Math.sin(a) * r); g.add(b);
      }
    }
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), glow); core.position.y = -0.15; g.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    halo.scale.set(3.6, 3.6, 1); halo.position.y = 0.1; g.add(halo);
    this.group.add(g);
  }

  // Lantern posts along the platform centre line.
  const posts = this.island ? [0] : [-(this.e + W) / 2 + 1.2, (this.e + W) / 2 - 1.2];
  for (const px of posts) for (let z = -Lp / 2 + 10; z < Lp / 2 - 8; z += 12) {
    if (Math.abs(z) < 3) continue;
    this.box(0.4, 0.3, 0.4, iron, px, PLATFORM_Y + 0.15, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.0, 10), iron); pole.position.set(px, PLATFORM_Y + 1.6, z); this.group.add(pole);
    for (const [dx, dz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) {
      const arm = this.box(Math.abs(dx) + 0.02, 0.03, Math.abs(dz) + 0.02, iron, px + dx / 2, PLATFORM_Y + 2.9, z + dz / 2);
      void arm;
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), glow); globe.position.set(px + dx, PLATFORM_Y + 2.98, z + dz); this.group.add(globe);
    }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), glow); top.position.set(px, PLATFORM_Y + 3.25, z); this.group.add(top);
  }

  // Planters at the platform ends.
  const leaf = new THREE.MeshLambertMaterial({ color: 0x2f6b35, emissive: 0x0c1f0e });
  for (const px of posts) for (const z of [-Lp / 2 + 4, Lp / 2 - 4]) {
    this.box(0.9, 0.6, 0.9, darkMarble, px, PLATFORM_Y + 0.3, z);
    for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.28 + k * 0.03, 10, 8), leaf); b.position.set(px + Math.cos(k * 1.3) * 0.2, PLATFORM_Y + 0.8 + k * 0.12, z + Math.sin(k * 1.3) * 0.2); this.group.add(b); }
  }

  // Mosaic murals above both tunnel mouths, framed in gold.
  const mural = new THREE.MeshBasicMaterial({ map: Textures.mosaic(this.st.name, accent) });
  const mw = Math.min(2 * W * 0.62, 11), mh = mw / 2;
  const my = Math.min(crown - mh / 2 - 0.6, 5.2 + mh / 2);
  for (const sz of [-1, 1]) {
    const z = sz * (Lz / 2 - 0.06);
    this.plane(mw, mh, mural, 0, my, z, sz < 0 ? 0 : Math.PI);
    this.box(mw + 0.3, 0.16, 0.12, gold, 0, my + mh / 2 + 0.08, z);
    this.box(mw + 0.3, 0.16, 0.12, gold, 0, my - mh / 2 - 0.08, z);
    this.box(0.16, mh + 0.3, 0.12, gold, mw / 2 + 0.08, my, z);
    this.box(0.16, mh + 0.3, 0.12, gold, -mw / 2 - 0.08, my, z);
  }

  // Double-faced station clock at the centre of the hall (shows the real game time).
  const c = document.createElement('canvas'); c.width = c.height = 256;
  this.clockFace = { c, tex: new THREE.CanvasTexture(c) };
  this.clockFace.tex.colorSpace = THREE.SRGBColorSpace;
  const cm = new THREE.MeshBasicMaterial({ map: this.clockFace.tex });
  const cy = PLATFORM_Y + 3.6, cx = posts[0];
  const cg = new THREE.Group(); cg.position.set(cx, cy, 0);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 32), gold); disc.rotation.x = Math.PI / 2; cg.add(disc);
  for (const sz of [1, -1]) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), cm); f.position.z = sz * 0.085; if (sz < 0) f.rotation.y = Math.PI; cg.add(f); }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, cy - 0.6 - PLATFORM_Y, 10), iron); pole.position.y = -(cy - PLATFORM_Y) / 2 - 0.3; cg.add(pole);
  this.group.add(cg);
  this.drawClock(0);
};

StationView.prototype.drawClock = function drawClock(clock) {
  if (!this.clockFace) return;
  const g = this.clockFace.c.getContext('2d');
  g.fillStyle = '#f7f1e1'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1c1c1c'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1c1c1c'; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) { const a = (h / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][h - 1], 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); }
  const s = ((clock % 43200) + 43200) % 43200;
  const hand = (frac, len, w, col) => { const a = frac * Math.PI * 2 - Math.PI / 2; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * len, 128 + Math.sin(a) * len); g.stroke(); };
  hand(s / 43200, 55, 9, '#1c1c1c');
  hand((s % 3600) / 3600, 82, 6, '#1c1c1c');
  hand((s % 60) / 60, 88, 2, '#b3121b');
  g.fillStyle = '#b3121b'; g.beginPath(); g.arc(128, 128, 6, 0, Math.PI * 2); g.fill();
  this.clockFace.tex.needsUpdate = true;
};

// ---------------------------------------------------------------------------------------------
// Open-air stations: platform canopies on steel columns, name totems, railings and glass shelters.
StationView.prototype.buildCanopy = function buildCanopy() {
  const Lp = this.Lp, accent = this.st.theme.accent || this.line.color;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d969e, metalness: 0.6, roughness: 0.45 });
  const roof = new THREE.MeshLambertMaterial({ color: 0xd9dcdf, side: THREE.DoubleSide, emissive: 0x222222 });
  const fascia = new THREE.MeshLambertMaterial({ color: accent, emissive: new THREE.Color(accent).multiplyScalar(0.2) });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfd6e2, transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const len = Lp - 14;
  for (const [a, b] of this.platformSpans()) {
    const cx = (a + b) / 2, w = b - a;
    const y = this.H;
    this.box(w + 1.2, 0.14, len, roof, cx, y, 0);
    for (const ex of [a - 0.55, b + 0.55]) this.box(0.12, 0.42, len, fascia, ex, y - 0.08, 0);
    for (let z = -len / 2 + 4; z <= len / 2 - 3; z += 10) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, y - PLATFORM_Y, 12), steel);
      col.position.set(cx, (y + PLATFORM_Y) / 2, z); this.group.add(col);
      const brace = this.box(w * 0.8, 0.1, 0.1, steel, cx, y - 0.35, z); void brace;
    }
    for (let z = -len / 2 + 3; z < len / 2; z += 6) this.box(0.18, 0.05, 3.6, this.m.light, cx, y - 0.1, z);
    // Railings at the back of side platforms.
    if (!this.island) {
      const back = a < 0 ? a + 0.05 : b - 0.05;
      this.box(0.05, 0.05, Lp, steel, back, PLATFORM_Y + 1.1, 0);
      for (let z = -Lp / 2; z <= Lp / 2; z += 2) this.box(0.04, 1.1, 0.04, steel, back, PLATFORM_Y + 0.55, z);
    }
    // Glass shelters with benches.
    for (const z of [-Lp / 5, Lp / 5]) {
      const sx = this.island ? cx : cx + (a < 0 ? -1 : 1) * (w / 2 - 1.0);
      this.box(1.4, 2.2, 0.04, glass, sx, PLATFORM_Y + 1.1, z - 1.6);
      this.box(1.4, 2.2, 0.04, glass, sx, PLATFORM_Y + 1.1, z + 1.6);
      this.box(0.04, 2.2, 3.2, glass, sx + (this.island ? 0 : (a < 0 ? -0.7 : 0.7)), PLATFORM_Y + 1.1, z);
      this.box(0.5, 0.06, 2.6, this.m.wood, sx, PLATFORM_Y + 0.45, z);
    }
  }
  // Elevated station: glazed stair/lift towers from the street up to the platforms.
  const elev = this.geom.point(this.centerS).y - this.geom.groundAt(this.centerS);
  if (elev > 4) {
    const glassT = new THREE.MeshStandardMaterial({ color: 0x9fbdd0, metalness: 0.4, roughness: 0.15, transparent: true, opacity: 0.55 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const mBadge = new THREE.MeshBasicMaterial({ map: Textures.label('M', { w: 128, h: 128, bg: '#ffffff', fg: '#1f3c88', font: 'bold 96px Arial', border: '#1f3c88', radius: 64 }), transparent: true });
    const gy = -elev; // street level in local coordinates
    const towers = this.island
      ? [-1, 1].map((sz) => [0, sz * (Lp / 2 - 14), FLOOR_Y - 1.9])            // under the island stairwells
      : [-1, 1].map((sx) => [sx * (this.W + 3.2), 0, PLATFORM_Y + 3.0]);       // beside the viaduct, mid-platform
    for (const [x, z, top] of towers) {
      const h = top - gy;
      this.box(4.6, h, 6.6, glassT, x, gy + h / 2, z);
      for (const dx of [-2.3, 2.3]) for (const dz of [-3.3, 3.3]) this.box(0.18, h, 0.18, frame, x + dx, gy + h / 2, z + dz);
      for (let y = gy + 3.5; y < top; y += 3.5) this.box(4.7, 0.15, 6.7, frame, x, y, z);
      this.box(5.2, 0.3, 7.2, frame, x, top + 0.15, z);
      // Street entrance canopy and totem.
      this.box(3.4, 0.18, 2.4, frame, x, gy + 3.0, z + (z >= 0 || !this.island ? 4.4 : -4.4));
      for (const sx of [-1, 1]) {
        const tx = x + sx * 3.2, tz = z + (z >= 0 || !this.island ? 4 : -4);
        this.box(0.14, 3.4, 0.14, frame, tx, gy + 1.7, tz);
        this.plane(0.9, 0.9, mBadge, tx, gy + 3.7, tz + 0.08); this.plane(0.9, 0.9, mBadge, tx, gy + 3.7, tz - 0.08, Math.PI);
      }
      if (!this.island) { // walkway to the platform
        const inner = Math.sign(x) * this.W;
        this.box(Math.abs(x) - this.W - 2.3, 0.25, 3, frame, (x - Math.sign(x) * 2.3 + inner) / 2, PLATFORM_Y - 0.1, z);
      }
    }
  }
  // Platform ramps at both ends (at-grade stations only).
  if (elev <= 4) for (const [a, b] of this.platformSpans()) {
    for (const sz of [-1, 1]) {
      const ramp = this.box(b - a, 0.08, 6, this.m.floor, (a + b) / 2, PLATFORM_Y - 0.65, sz * (Lp / 2 + 2.8));
      ramp.rotation.x = sz * -0.22;
    }
  }
};

StationView.prototype.buildOutdoorSigns = function buildOutdoorSigns() {
  const st = this.st, accent = st.theme.accent || this.line.color;
  const sign = new THREE.MeshBasicMaterial({ map: Textures.label(st.name, { w: 768, h: 128, bg: '#15181c', fg: '#ffffff', font: '600 62px "Segoe UI", Arial, sans-serif', border: accent }) });
  // Name boards hanging under the canopy edges, facing each track.
  const y = this.H - 0.7;
  for (const [a, b] of this.platformSpans()) {
    for (const [x, ry] of [[a - 0.5, -Math.PI / 2], [b + 0.5, Math.PI / 2]]) {
      if (!this.island && ((a < 0 && x < a) || (b > 0 && x > b && a > 0))) continue; // side platform: only the track side
      for (let z = -this.Lp / 2 + 14; z < this.Lp / 2 - 10; z += 24) this.plane(2.6, 0.44, sign, x, y, z, ry);
    }
  }
  // Totems at the platform ends with the line badge.
  const badge = new THREE.MeshBasicMaterial({ map: Textures.label(this.line.number, { w: 128, h: 128, bg: this.line.color, fg: this.line.textColor, font: 'bold 72px Arial', radius: 64 }), transparent: true });
  const pole = new THREE.MeshLambertMaterial({ color: 0x2b2f35 });
  for (const [a, b] of this.platformSpans()) for (const z of [-this.Lp / 2 + 5, this.Lp / 2 - 5]) {
    const cx = (a + b) / 2;
    this.box(0.25, 3.0, 0.25, pole, cx, PLATFORM_Y + 1.5, z);
    for (const sz of [-1, 1]) {
      this.plane(0.6, 0.6, badge, cx, PLATFORM_Y + 2.7, z + sz * 0.13, sz > 0 ? 0 : Math.PI);
      this.plane(1.5, 0.26, sign, cx, PLATFORM_Y + 2.1, z + sz * 0.13, sz > 0 ? 0 : Math.PI);
    }
  }
  this.exits = [];
  const termA = this.line.directions.A.terminus, termB = this.line.directions.B.terminus;
  const mat = new THREE.MeshBasicMaterial({ map: Textures.label(this.island ? `⬅ ${termB}   |   ${termA} ➜` : `Direction ${termA}`, { w: 1024, h: 96, bg: '#f5f5f0', fg: '#1a1a1a', font: 'bold 46px Arial', border: accent }) });
  const g = new THREE.Group(); g.position.set(this.island ? 0 : -(this.e + this.W) / 2, this.H - 0.6, 0);
  this.plane(3.6, 0.34, mat, 0, 0, 0.02, 0, g); this.plane(3.6, 0.34, mat, 0, 0, -0.02, Math.PI, g);
  this.box(0.02, 0.6, 0.02, this.m.metal, -1.5, 0.3, 0, g); this.box(0.02, 0.6, 0.02, this.m.metal, 1.5, 0.3, 0, g);
  this.group.add(g);
};

export { PLATFORM_Y, EDGE_GAP };
