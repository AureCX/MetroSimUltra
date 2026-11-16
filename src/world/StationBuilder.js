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
    this.H = st.style === 'vault' ? 3.1 : st.style === 'pillars' ? Math.max(4.3, crown + 0.5) : Math.max(5.2, crown + 0.7);
    this.vaultRise = Math.max(2.9, crown + 0.6 - this.H);
    this.mats();
    this.buildShell();
    this.buildPlatforms();
    this.buildSigns();
    this.buildFurniture();
    this.buildPIDs();
    this.buildPortals();
  }

  mats() {
    const st = this.st, accent = st.theme.accent || this.line.color;
    const emissive = (m, k = 0.28) => { m.emissive = new THREE.Color(k, k, k); m.emissiveMap = m.map; return m; };
    let wallTex, ceilTex;
    if (this.style === 'vault') { wallTex = Textures.tiles(st.theme.wall || '#f4f1e8', '#b8b2a4', 8, 16); ceilTex = wallTex; }
    else if (this.style === 'pillars') { wallTex = Textures.tiles(st.theme.wall || '#8fbf9f', shade(st.theme.wall || '#8fbf9f', -40), 6, 12); ceilTex = Textures.floor('#e9e6df'); }
    else { wallTex = Textures.tiles(st.theme.wall || '#3b4149', '#1f2329', 2, 2, false); ceilTex = Textures.tiles('#2a2e34', '#16181c', 1, 12, false); }
    this.m = {
      wall: emissive(new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide })),
      ceil: emissive(new THREE.MeshLambertMaterial({ map: ceilTex, side: THREE.DoubleSide }), this.style === 'modern' ? 0.15 : 0.3),
      floor: emissive(new THREE.MeshLambertMaterial({ map: Textures.floor(this.style === 'modern' ? '#b9b6b0' : '#9b968c') }), 0.25),
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
    if (this.style === 'vault') {
      for (let k = 1; k < 18; k++) { const a = Math.PI - (k / 18) * Math.PI; pts.push([W * Math.cos(a), this.H + this.vaultRise * Math.sin(a)]); }
    }
    pts.push([W, this.H], [W, base]);
    return pts;
  }

  buildShell() {
    const z0 = -this.Lz / 2, z1 = this.Lz / 2;
    const prof = this.shellProfile();
    const wallUv = this.style === 'modern' ? 0.25 : 0.5;
    if (this.style === 'vault') {
      this.group.add(new THREE.Mesh(extrude(prof, z0, z1, { uScale: wallUv, vScale: wallUv }), this.m.wall));
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
    const st = this.st, accent = st.theme.accent || this.line.color;
    const signOpts = this.style === 'vault'
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
          const frame = this.box(0.06, 2.05, 2.75, this.style === 'vault' ? new THREE.MeshLambertMaterial({ color: 0x9c7b3c }) : this.m.metal, x + (x < 0 ? 0.0 : 0.0), y + 0.2, z);
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
        this.box(0.02, Math.max(0.1, this.H - hangY), 0.02, this.m.metal, -0.9, (this.H - hangY) / 2, 0, g);
        this.box(0.02, Math.max(0.1, this.H - hangY), 0.02, this.m.metal, 0.9, (this.H - hangY) / 2, 0, g);
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
    if (this.style === 'vault') {
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
    } else {
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
        this.box(0.03, this.H - y, 0.03, this.m.metal, 0, (this.H - y) / 2, 0, g);
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

export { PLATFORM_Y, EDGE_GAP };
