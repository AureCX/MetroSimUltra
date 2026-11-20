// World builder for main lines (TGV): the line is hundreds of kilometres long, so the scenery is streamed in
// 500 m tiles around the viewer (built ahead, disposed behind) on top of a coarse far-terrain grid that is
// re-centred as the train travels. Tiles carry the railway itself (ballast, rails, sleepers, catenary, fences,
// km posts), the terrain ribbon (embankments and cuttings blended into the country terrain), viaducts over valleys,
// tunnels with portals, forests, villages and road overbridges. Stations and cities are built once.
// Same interface as WorldBuilder for the game: stations, envelope(), update(), outdoor, dispose().
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sweep, tunnelProfile, FLOOR_Y, ARCH_SPRING, ARCH_RISE } from '../world/Sweep.js';
import { Textures } from '../world/Textures.js';
import { StationView } from '../world/StationBuilder.js';
import { RailTerrain, COUNTRY } from './RailTerrain.js';
import { buildGrandeGare, GARE_PADS } from './GrandeGare.js';
import { buildDestinationCity } from './Cities.js';

const TILE = 500, AHEAD = 6500, BEHIND = 2500, GAUGE_HALF = 0.7175;
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const BIOME = [[0.62, 0.6, 0.36], [0.42, 0.56, 0.3], [0.2, 0.34, 0.17], [0.5, 0.48, 0.45], [0.93, 0.94, 0.96], [0.86, 0.8, 0.62], [0.66, 0.55, 0.32]];

export class HighSpeedWorld {
  constructor(scene, line, geom, routes, quality = 'high', opts = {}) {
    this.scene = scene; this.line = line; this.geom = geom; this.routes = routes; this.quality = quality; this.opts = opts;
    this.group = new THREE.Group(); this.group.name = 'mainline'; scene.add(this.group);
    // Station towns sit on flat ground at platform level (the line profile was designed against the same field).
    this.terrain = new RailTerrain({ ...COUNTRY, cities: line.stations.map((_, i) => { const p = geom.point(geom.stationS[i]); return { x: p.x, z: p.z, r: 800, y: p.y - 0.6 }; }), pads: GARE_PADS });
    this.tiles = new Map();
    this.stations = [];
    this.lampPositions = [];
    const lam = (o) => new THREE.MeshLambertMaterial(o);
    this.mat = {
      ground: lam({ vertexColors: true }),
      ballast: lam({ map: Textures.trackbed() }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8e8a86, metalness: 0.85, roughness: 0.35 }),
      railTop: new THREE.MeshStandardMaterial({ color: 0xd8d6d2, metalness: 1, roughness: 0.18 }),
      sleeper: lam({ color: 0x8a8580 }),
      mast: new THREE.MeshStandardMaterial({ color: 0x8b9298, metalness: 0.6, roughness: 0.5 }),
      wire: new THREE.LineBasicMaterial({ color: 0x2a2c2e }),
      concrete: lam({ map: Textures.concrete('#b3ada2') }),
      tunnel: lam({ map: Textures.concrete('#6b6660'), side: THREE.DoubleSide }),
      portal: lam({ map: Textures.concrete('#a39d92') }),
      fence: new THREE.MeshLambertMaterial({ color: 0x6f7a72, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      trunk: lam({ color: 0x5a4030 }), leaves: lam({ color: 0x3f6a2c }), conifer: lam({ color: 0x2c4a2a }),
      wall: lam({ color: 0xe6dccb }), roof: lam({ color: 0x9b4a35 }), road: lam({ color: 0x3d3f43 }),
      kmPost: new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }),
      sea: new THREE.MeshStandardMaterial({ color: 0x1f5f8a, metalness: 0.3, roughness: 0.18, transparent: true, opacity: 0.92 }),
    };
  }

  build() {
    const g = this.geom, line = this.line;
    // Stations: the grand station at Gare Centrale, standard main-line stations elsewhere, with their cities.
    this.outdoorParts = [];
    this.landmarks = [];
    line.stations.forEach((st, i) => {
      if (i === 0) {
        this.gare = buildGrandeGare(this.group, { line, geom: g, routes: this.routes, index: 0, slot: line.rail?.slot ?? 2, renderer: this.opts.renderer, trainSpecs: this.opts.trainSpecs, terrain: this.terrain, allLines: this.opts.allLines, makeTrain: this.opts.makeTrain });
        this.stations.push(this.gare.pidStation);
        return;
      }
      const sv = new StationView(line, g, this.routes, st, i, this.quality);
      this.group.add(sv.group); this.stations.push(sv);
      this.landmarks.push({ index: i, built: null });
    });
    this.outdoor = { update: (dt, t, clock, cam) => this.updateScenery(dt, t, clock, cam), sites: [] };
    // Far terrain and sea.
    this.far = new THREE.Mesh(new THREE.BufferGeometry(), this.mat.ground); this.far.frustumCulled = false; this.group.add(this.far);
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), this.mat.sea); this.sea.position.y = -0.4; this.group.add(this.sea);
    this.farCenter = null;
    // Track samples for distance queries (far-terrain holes along the corridor).
    this.samples = [];
    for (let s = 0; s < g.length; s += 200) { const p = g.point(s); this.samples.push([p.x, p.z, s]); }
    this.update(g.stationS[0], 0, null, null);
    return this;
  }

  // ---------------- streaming ----------------
  update(trackS, clock, etaProvider, viewPos) {
    const g = this.geom;
    // Which tiles: around the viewer's track position (both ways along the line).
    const s0 = Math.max(0, Math.floor((trackS - BEHIND) / TILE)), s1 = Math.min(Math.floor(g.length / TILE), Math.floor((trackS + AHEAD) / TILE));
    const want = new Set(); for (let k = s0; k <= s1; k++) want.add(k);
    for (const [k, t] of this.tiles) if (!want.has(k) && (k < s0 - 2 || k > s1 + 2)) { this.group.remove(t); t.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this.tiles.delete(k); }
    // Build the nearest missing tiles first, a couple per frame (no hitch).
    const missing = [...want].filter((k) => !this.tiles.has(k)).sort((a, b) => Math.abs(a * TILE - trackS) - Math.abs(b * TILE - trackS));
    const budget = this.tiles.size === 0 ? missing.length : 2;
    for (const k of missing.slice(0, budget)) { const t = this.buildTile(k); this.tiles.set(k, t); this.group.add(t); }
    // Far terrain around the viewer.
    const p = viewPos || g.point(trackS);
    if (!this.farCenter || Math.hypot(p.x - this.farCenter.x, p.z - this.farCenter.z) > 2500) this.buildFar(p.x, p.z);
    this.sea.position.x = p.x; this.sea.position.z = p.z;
    // Cities near the train.
    for (const lm of this.landmarks) {
      const near = Math.abs(g.stationS[lm.index] - trackS) < 9000;
      if (near && !lm.built) lm.built = buildDestinationCity(this.group, { line: this.line, geom: g, index: lm.index, terrain: this.terrain, identity: this.line.rail?.identityOf?.(lm.index) || identityOf(this.line, lm.index) });
      if (!near && lm.built && Math.abs(g.stationS[lm.index] - trackS) > 14000) { lm.built.dispose(); lm.built = null; }
    }
    for (const sv of this.stations) if (Math.abs(sv.centerS - trackS) < 900) sv.updatePIDs(clock, etaProvider);
  }

  updateScenery(dt, t, clock, cam) {
    this.gare?.update(dt, t, clock, cam);
    for (const lm of this.landmarks) lm.built?.update?.(dt, t, clock, cam);
  }

  /** Track elevation above the natural ground at s. */
  heightAbove(s) { const p = this.geom.point(s); return p.y - this.terrain.height(p.x, p.z); }
  inTunnel(s) { return !this.geom.outdoorAt(s); }
  nearStation(s, pad = 400) { return this.geom.stationS.some((c) => Math.abs(c - s) < 135 + pad); }

  buildTile(k) {
    const g = this.geom, T = this.terrain, grp = new THREE.Group();
    const a = k * TILE, b = Math.min(g.length, a + TILE);
    if (b - a < 1) return grp;
    const o0 = g.point(a), origin = new THREE.Vector3(o0.x, o0.y, o0.z);
    grp.position.copy(origin);
    const rand = (i) => hash(k * 977 + i, 31);
    const hs = (s) => g.halfSpacingAt(s);
    // --- terrain ribbon with formation (embankment / cutting) ---
    const LAT = [-420, -220, -110, -55, -30, -17, -10, -6.5, 6.5, 10, 17, 30, 55, 110, 220, 420];
    const step = 25, ns = Math.ceil((b - a) / step) + 1;
    const pos = new Float32Array(ns * LAT.length * 3), col = new Float32Array(ns * LAT.length * 3);
    const tmp = {};
    let pi = 0;
    for (let i = 0; i < ns; i++) {
      const s = Math.min(b, a + i * step), c = g.point(s), yf = c.y - 0.75;
      const viaduct = c.y - T.height(c.x, c.z) > 9 && !this.nearStation(s, 100), tunnel = this.inTunnel(s);
      for (const lat of LAT) {
        g.point(s, lat, 0, tmp);
        const H = T.height(tmp.x, tmp.z);
        let y = H;
        const al = Math.abs(lat);
        if (!viaduct && !tunnel) {
          const dh = H - yf, reach = 10 + Math.min(60, Math.abs(dh) * 1.6);   // slopes 1:1.6
          const w = al <= 10 ? 1 : Math.max(0, 1 - (al - 10) / reach);
          y = yf + dh * (1 - w * w * (3 - 2 * w));
          if (al <= 10) y = yf - (al > 6.5 ? 0.2 : 0);
        }
        pos[pi] = tmp.x - origin.x; pos[pi + 1] = y - origin.y; pos[pi + 2] = tmp.z - origin.z;
        const bio = al < 10 && !viaduct && !tunnel ? 0 : T.biome(tmp.x, tmp.z, y);
        const cc = al < 10 && !viaduct && !tunnel ? [0.55, 0.53, 0.5] : BIOME[bio];
        const n = 0.9 + hash(Math.round(tmp.x / 7), Math.round(tmp.z / 7)) * 0.2;
        col[pi] = cc[0] * n; col[pi + 1] = cc[1] * n; col[pi + 2] = cc[2] * n;
        pi += 3;
      }
    }
    const idx = [];
    const m = LAT.length;
    for (let i = 0; i < ns - 1; i++) for (let j = 0; j < m - 1; j++) { const p0 = i * m + j, p1 = p0 + m; idx.push(p0, p1, p0 + 1, p1, p1 + 1, p0 + 1); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tg.setIndex(idx); tg.computeVertexNormals();
    // Normals face up regardless of winding.
    if (tg.attributes.normal.getY(0) < 0) { tg.setIndex(idx.map((_, i2) => idx[i2 - (i2 % 3) + [0, 2, 1][i2 % 3]])); tg.computeVertexNormals(); }
    grp.add(new THREE.Mesh(tg, this.mat.ground));

    // --- runs of tunnel / viaduct inside the tile ---
    const kinds = [];
    for (let s = a; s <= b; s += 10) kinds.push({ s, tunnel: this.inTunnel(s), viaduct: !this.inTunnel(s) && this.heightAbove(s) > 9 && !this.nearStation(s, 100) });
    const at = (s) => { const p = g.point(s); return new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z); };
    const loc = (gg) => { gg.translate(0, 0, 0); return gg; };
    const sw = (fn, s0x = a, s1x = b, st = 4) => sweep(g, s0x, s1x, st, fn, { origin });
    // Ballast / formation (not on viaducts: deck instead), rails, sleepers.
    if (!this.nearStation((a + b) / 2, -20) || true) {
      grp.add(new THREE.Mesh(sw((s) => { const h = hs(s) + 2.5; return [[-h - 0.8, -0.75], [-h, -0.2], [h, -0.2], [h + 0.8, -0.75]]; }), this.mat.ballast));
      const rails = [], tops = [];
      for (const sg of [-1, 1]) for (const r of [-GAUGE_HALF, GAUGE_HALF]) {
        rails.push(sw((s) => { const c = sg * hs(s) + r; return [[c - 0.065, -0.17], [c - 0.065, -0.15], [c - 0.012, -0.13], [c - 0.012, -0.03], [c - 0.036, -0.025], [c - 0.036, 0], [c + 0.036, 0], [c + 0.036, -0.025], [c + 0.012, -0.03], [c + 0.012, -0.13], [c + 0.065, -0.15], [c + 0.065, -0.17]]; }, a, b, 6));
        tops.push(sw((s) => { const c = sg * hs(s) + r; return [[c - 0.036, 0.001], [c + 0.036, 0.001]]; }, a, b, 6));
      }
      grp.add(new THREE.Mesh(mergeGeometries(rails), this.mat.rail), new THREE.Mesh(mergeGeometries(tops), this.mat.railTop));
      const n = Math.floor((b - a) / 0.6) * 2;
      const sl = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.16, 0.3), this.mat.sleeper, n);
      const M = new THREE.Matrix4(); let i = 0;
      for (let s = a; s < b && i < n; s += 0.6) for (const sg of [-1, 1]) { const p = g.point(s, sg * hs(s), -0.24); M.makeRotationY(-g.heading(s)); M.setPosition(p.x - origin.x, p.y - origin.y, p.z - origin.z); sl.setMatrixAt(i++, M); }
      sl.count = i; sl.computeBoundingSphere(); grp.add(sl);
    }
    // Viaducts: deck with parapets on slender piers.
    let va = null;
    const flush = (s0x, s1x) => {
      if (s1x - s0x < 15) return;
      grp.add(new THREE.Mesh(sw((s) => { const h = hs(s) + 3.2; return [[-h, -0.8], [-h, 0.3], [-h + 0.25, 0.3], [-h + 0.25, -0.5], [h - 0.25, -0.5], [h - 0.25, 0.3], [h, 0.3], [h, -0.8], [-h, -0.8]]; }, s0x, s1x, 6), this.mat.concrete));
      grp.add(new THREE.Mesh(sw((s) => { const h = hs(s) + 2.2; return [[-h, -0.8], [-h * 0.6, -2.6], [h * 0.6, -2.6], [h, -0.8]]; }, s0x, s1x, 6), this.mat.concrete));
      for (let s = Math.ceil(s0x / 45) * 45; s < s1x; s += 45) {
        const p = g.point(s), H = this.terrain.height(p.x, p.z), hgt = p.y - 2.6 - H;
        if (hgt < 1) continue;
        const pier = new THREE.Mesh(new THREE.BoxGeometry(3.2, hgt, 2.2), this.mat.concrete);
        pier.position.set(p.x - origin.x, H + hgt / 2 - origin.y, p.z - origin.z); pier.rotation.y = -g.heading(s); grp.add(pier);
      }
    };
    for (const kk of kinds) { if (kk.viaduct && va == null) va = kk.s; if (!kk.viaduct && va != null) { flush(va, kk.s); va = null; } }
    if (va != null) flush(va, b);
    // Tunnels: double-track tube and portals.
    let ta = null;
    const tube = (s0x, s1x) => {
      if (s1x - s0x < 5) return;
      grp.add(new THREE.Mesh(sw((s) => tunnelProfile(hs(s) + 2.6, 'arch').map(([x, y]) => [x, y * 1.25]), s0x, s1x, 6), this.mat.tunnel));
    };
    for (const kk of kinds) { if (kk.tunnel && ta == null) ta = kk.s; if (!kk.tunnel && ta != null) { tube(ta, kk.s); ta = null; } }
    if (ta != null) tube(ta, b);
    for (const pt of this.geom.portals) if (pt.s >= a && pt.s < b) {
      const q = at(pt.s), hw = hs(pt.s) + 2.6, top = 14;
      const shape = new THREE.Shape([new THREE.Vector2(-hw - 9, -1), new THREE.Vector2(hw + 9, -1), new THREE.Vector2(hw + 9, top), new THREE.Vector2(-hw - 9, top)]);
      shape.holes.push(new THREE.Path(tunnelProfile(hw, 'arch').map(([x, y]) => new THREE.Vector2(x, Math.max(y * 1.25, FLOOR_Y))).reverse()));
      const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false }), this.mat.portal);
      wall.position.copy(q); wall.rotation.y = Math.PI - g.heading(pt.s); grp.add(wall);
    }
    // Catenary: masts with cantilevers every 63 m, contact and messenger wires.
    if (!this.inTunnel((a + b) / 2)) {
      const masts = [], wires = [];
      for (let s = Math.ceil(a / 63) * 63; s < b; s += 63) {
        if (this.inTunnel(s)) continue;
        for (const sd of [-1, 1]) {
          const base = g.point(s, sd * (hs(s) + 3.4), -0.2), top = g.point(s, sd * (hs(s) + 3.4), 7.6), arm = g.point(s, sd * (hs(s) - 1.2), 7.2);
          masts.push([base, top, arm]);
        }
      }
      const mg = [];
      for (const [b0, t0, a0] of masts) {
        const h = t0.y - b0.y;
        const pole = new THREE.CylinderGeometry(0.12, 0.16, h, 6); pole.translate(b0.x - origin.x, b0.y + h / 2 - origin.y, b0.z - origin.z); mg.push(pole.toNonIndexed());
        const len = Math.hypot(a0.x - t0.x, a0.z - t0.z), ar = new THREE.BoxGeometry(0.08, 0.08, len);
        ar.rotateY(Math.atan2(a0.x - t0.x, a0.z - t0.z)); ar.translate((t0.x + a0.x) / 2 - origin.x, a0.y - origin.y, (t0.z + a0.z) / 2 - origin.z); mg.push(ar.toNonIndexed());
      }
      if (mg.length) grp.add(new THREE.Mesh(mergeGeometries(mg), this.mat.mast));
      const wpos = [];
      for (const sg of [-1, 1]) for (const hgt of [5.6, 6.9]) {
        let prev = null;
        for (let s = a; s <= b; s += 21) { const p = g.point(s, sg * hs(s), hgt - (hgt > 6 ? Math.sin(((s % 63) / 63) * Math.PI) * 0.6 : 0)); if (prev) wpos.push(prev.x - origin.x, prev.y - origin.y, prev.z - origin.z, p.x - origin.x, p.y - origin.y, p.z - origin.z); prev = { ...p }; }
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      grp.add(new THREE.LineSegments(wg, this.mat.wire));
    }
    // Fences along the line (not on viaducts / in tunnels / in stations), km posts.
    if (!this.nearStation((a + b) / 2, 300)) {
      const fg = [];
      for (const sd of [-1, 1]) {
        let s0x = null;
        for (const kk of kinds) {
          const ok = !kk.tunnel && !kk.viaduct;
          if (ok && s0x == null) s0x = kk.s;
          if ((!ok || kk === kinds.at(-1)) && s0x != null) { if (kk.s - s0x > 20) fg.push(sw((s) => [[sd * 13, -0.6], [sd * 13, 1.4]], s0x, kk.s, 10)); s0x = null; }
        }
      }
      if (fg.length) grp.add(new THREE.Mesh(mergeGeometries(fg), this.mat.fence));
    }
    for (let s = Math.ceil(a / 1000) * 1000; s < b; s += 1000) {
      if (this.inTunnel(s)) continue;
      const p = g.point(s, hs(s) + 3.0, 0.6);
      const post = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.55), new THREE.MeshBasicMaterial({ map: Textures.label(String(Math.round(s / 1000)), { w: 64, h: 88, bg: '#f2f2f2', fg: '#111', font: 'bold 40px Arial' }), side: THREE.DoubleSide }));
      post.position.set(p.x - origin.x, p.y - origin.y, p.z - origin.z); post.rotation.y = -g.heading(s) + Math.PI / 2; grp.add(post);
    }
    // Forests, villages and overbridges.
    if (!this.nearStation((a + b) / 2, 2500)) this.scatter(grp, k, a, b, origin, rand);
    return grp;
  }

  scatter(grp, k, a, b, origin, rand) {
    const g = this.geom, T = this.terrain, tmp = {};
    const trees = [], houses = [];
    for (let i = 0; i < 140; i++) {
      const s = a + rand(i) * (b - a), side = rand(i + 500) < 0.5 ? -1 : 1, lat = side * (24 + rand(i + 900) * 380);
      g.point(s, lat, 0, tmp);
      const H = T.height(tmp.x, tmp.z);
      if (H < 1) continue;
      const f = T.forest(tmp.x, tmp.z);
      if (f > 0.6 || (f > 0.45 && rand(i + 77) < 0.25) || H > 650) trees.push([tmp.x, H, tmp.z, 0.8 + rand(i + 33) * 0.8, H > 500 || f > 0.75]);
    }
    // A village every few kilometres (seeded by the tile index).
    if (rand(4000) < 0.22) {
      const s = (a + b) / 2, side = rand(4001) < 0.5 ? -1 : 1, lat0 = side * (120 + rand(4002) * 180);
      for (let i = 0; i < 14; i++) {
        g.point(s + (rand(i + 4100) - 0.5) * 300, lat0 + (rand(i + 4200) - 0.5) * 140, 0, tmp);
        const H = T.height(tmp.x, tmp.z); if (H < 1) continue;
        houses.push([tmp.x, H, tmp.z, rand(i + 4300) * Math.PI, 7 + rand(i + 4400) * 6, 8 + rand(i + 4500) * 5]);
      }
    }
    if (trees.length) {
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 3, 5), this.mat.trunk, trees.length);
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), this.mat.leaves, trees.length);
      const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 8, 6), this.mat.conifer, trees.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
      let nc = 0, nk = 0;
      trees.forEach(([x, y, z, sc, conifer], i) => {
        M.compose(P.set(x - origin.x, y + 1.5 * sc - origin.y, z - origin.z), Q, S.setScalar(sc)); trunk.setMatrixAt(i, M);
        if (conifer) { M.compose(P.set(x - origin.x, y + 5.5 * sc - origin.y, z - origin.z), Q, S.setScalar(sc)); cone.setMatrixAt(nk++, M); }
        else { M.compose(P.set(x - origin.x, y + 4.2 * sc - origin.y, z - origin.z), Q, S.set(sc, sc * 1.1, sc)); crown.setMatrixAt(nc++, M); }
      });
      crown.count = nc; cone.count = nk;
      for (const im of [trunk, crown, cone]) { im.computeBoundingSphere(); grp.add(im); }
    }
    if (houses.length) {
      const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat.wall, houses.length);
      const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 1, 4), this.mat.roof, houses.length);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      houses.forEach(([x, y, z, r, w, d], i) => {
        Q.setFromAxisAngle(up, r);
        M.compose(P.set(x - origin.x, y + 2.8 - origin.y, z - origin.z), Q, S.set(w, 5.6, d)); wall.setMatrixAt(i, M);
        Q.setFromAxisAngle(up, r + Math.PI / 4);
        M.compose(P.set(x - origin.x, y + 7 - origin.y, z - origin.z), Q, S.set(w * 1.45, 2.8, d * 1.45)); roof.setMatrixAt(i, M);
      });
      wall.computeBoundingSphere(); roof.computeBoundingSphere(); grp.add(wall, roof);
    }
    // Road overbridge every ~4 km (seeded), where the line is near the ground.
    if (k % 8 === 3 && !this.inTunnel((a + b) / 2) && Math.abs(this.heightAbove((a + b) / 2)) < 4) {
      const s = (a + b) / 2, p = g.point(s), h = g.heading(s);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 60), this.mat.concrete);
      deck.position.set(p.x - origin.x, p.y + 7.8 - origin.y, p.z - origin.z); deck.rotation.y = -h + Math.PI / 2; grp.add(deck);
      const road = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.05, 60), this.mat.road); road.position.copy(deck.position); road.position.y += 0.62; road.rotation.y = deck.rotation.y; grp.add(road);
      for (const sd of [-1, 1]) { const q = g.point(s, sd * 16, 0); const pier = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7.6, 8), this.mat.concrete); pier.position.set(q.x - origin.x, q.y + 3.4 - origin.y, q.z - origin.z); pier.rotation.y = -h; grp.add(pier); }
    }
  }

  /** Coarse terrain grid around (cx, cz), with the corridor lowered under the detailed ribbon. */
  buildFar(cx, cz) {
    const T = this.terrain, N = 110, SIZE = 26000, step = SIZE / N;
    const x0 = Math.round(cx / 1000) * 1000 - SIZE / 2, z0 = Math.round(cz / 1000) * 1000 - SIZE / 2;
    this.farCenter = { x: x0 + SIZE / 2, z: z0 + SIZE / 2 };
    const near = this.samples.filter(([x, z]) => Math.abs(x - this.farCenter.x) < SIZE * 0.6 && Math.abs(z - this.farCenter.z) < SIZE * 0.6);
    const pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3), idx = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + j * step, z = z0 + i * step, k = (i * (N + 1) + j) * 3;
      let h = T.height(x, z);
      let dmin = Infinity; for (const [sx, sz] of near) { const d = (sx - x) ** 2 + (sz - z) ** 2; if (d < dmin) dmin = d; }
      if (Math.sqrt(dmin) < 470) h = h > 0.5 ? Math.max(h - 15, 0.2) : h - 15;   // under the detailed ribbon (never into the sea)
      pos[k] = x; pos[k + 1] = Math.max(h, -30); pos[k + 2] = z;
      const c = BIOME[T.biome(x, z, h)]; const n = 0.92 + hash(i, j) * 0.12;
      col[k] = c[0] * n; col[k + 1] = c[1] * n; col[k + 2] = c[2] * n;
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + N + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.far.geometry.dispose(); this.far.geometry = geo;
  }

  /** Free space around the track (exterior cameras). */
  envelope(trackS) {
    if (this.inTunnel(trackS)) { const hw = this.geom.halfSpacingAt(trackS) + 2.6; return { maxLat: hw - 0.4, ceil: (lat) => (ARCH_SPRING + ARCH_RISE * Math.sqrt(Math.max(0, 1 - (lat / hw) ** 2))) * 1.2 - 0.4 }; }
    const z = this.geom.stationZoneAt(trackS);
    if (z && z.index === 0 && this.gare) return this.gare.envelope;
    return { maxLat: 60, ceil: () => 60 };
  }

  dispose() {
    this.gare?.dispose?.();
    for (const lm of this.landmarks) lm.built?.dispose();
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose());
  }
}

export function identityOf(line, index) {
  const name = line.stations[index]?.name;
  return { Montreval: 'regional', Valdor: 'coastal', Clairmont: 'industrial', 'Saint-Roch-les-Alpes': 'alpine', 'Belle-Rive': 'western', 'Port-Azur': 'southern' }[name] || 'regional';
}
