// Builds all static railway infrastructure for a line: tunnels, track (rails, sleepers,
// conductor rail), lamps, cables, lineside boards and station interiors.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sweep, tunnelProfile, tunnelProfilePartial, FLOOR_Y, ARCH_SPRING, ARCH_RISE, BOX_HEIGHT } from './Sweep.js';
import { Textures } from './Textures.js';
import { StationView } from './StationBuilder.js';

const GAUGE_HALF = 0.7175;
const CHUNK = 100;

export class WorldBuilder {
  /**
   * opts (all optional) — used to add the second branch of a branching line to the same world:
   *  fromS        build only from this chainage on (the shared trunk is built by the main builder)
   *  firstStation build stations from this index on
   *  junction     { divergeS, wallS, inner } — between divergeS and wallS the wall on the `inner`
   *               side (+1 right / −1 left, direction A) is left out so both tunnels form one chamber
   *  lightPool / tunnelPool  pools of the main builder to share
   *  offset       draw the chamber surfaces with a polygon offset (avoids z-fighting with the twin tunnel)
   */
  constructor(scene, line, geom, routes, quality = 'high', opts = {}) {
    this.opts = { fromS: 0, firstStation: 0, junction: null, ...opts };
    this.scene = scene;
    this.line = line;
    this.geom = geom;
    this.routes = routes;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.stations = [];
    this.mat = {
      tunnel: new THREE.MeshLambertMaterial({ map: Textures.concrete(line.tunnelProfile === 'box' ? '#77736c' : '#6b6660'), side: THREE.DoubleSide, emissive: 0x0b0b0b }),
      bed: new THREE.MeshLambertMaterial({ map: Textures.trackbed(), side: THREE.DoubleSide }),
      rail: new THREE.MeshStandardMaterial({ color: 0x8e8a86, metalness: 0.85, roughness: 0.35 }),
      railTop: new THREE.MeshStandardMaterial({ color: 0xd8d6d2, metalness: 1, roughness: 0.18 }),
      conductor: new THREE.MeshLambertMaterial({ color: 0x4a463f }),
      sleeper: new THREE.MeshLambertMaterial({ color: 0x55504a }),
      cable: new THREE.MeshLambertMaterial({ color: 0x1d1c1b, side: THREE.DoubleSide }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff1c9 }),
      lampHousing: new THREE.MeshLambertMaterial({ color: 0x2a2a2a }),
    };
  }

  build() {
    this.buildTunnel();
    this.buildTrack();
    this.buildBoards();
    this.buildBuffers();
    this.line.stations.forEach((st, i) => {
      if (i < this.opts.firstStation) return;
      const sv = new StationView(this.line, this.geom, this.routes, st, i, this.quality);
      this.group.add(sv.group);
      this.stations.push(sv);
    });
    const zones = this.geom.zones.filter((z) => z.index >= this.opts.firstStation);
    if (this.opts.lightPool) { this.opts.lightPool.addSource(this.geom, this.line, zones); }
    else { this.lights = new StationLightPool(this.scene); this.lights.addSource(this.geom, this.line, zones); }
    if (this.opts.tunnelPool) this.opts.tunnelPool.positions.push(...this.lampPositions);
    else this.tunnelLights = new TunnelLightPool(this.scene, this.lampPositions);
    return this;
  }

  /** Is [a, b] inside the junction chamber? Returns the inner side (+1/−1) or 0. */
  innerSide(a, b) {
    const j = this.opts.junction;
    return j && a >= j.divergeS - 0.01 && b <= j.wallS + 0.01 ? j.inner : 0;
  }
  /** Splits [a, b] into chunks no longer than CHUNK, also cutting at the junction boundaries. */
  chunk(a, b) {
    const cuts = [a, b];
    const j = this.opts.junction;
    if (j) for (const c of [j.divergeS, j.wallS]) if (c > a && c < b) cuts.push(c);
    cuts.sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) for (let s = cuts[i]; s < cuts[i + 1] - 0.5; s += CHUNK) out.push([s, Math.min(cuts[i + 1], s + CHUNK)]);
    return out;
  }

  /** Ranges of track chainage that are tunnel (not station boxes). */
  tunnelRanges() {
    const out = [];
    let cur = 0;
    for (const z of this.geom.zones) { if (z.start > cur) out.push([cur, z.start]); cur = z.end; }
    if (cur < this.geom.length) out.push([cur, this.geom.length]);
    const from = this.opts.fromS;
    return out.filter(([, b]) => b > from).flatMap(([a, b]) => this.chunk(Math.max(a, from), b));
  }

  origin(s) { const p = this.geom.point(s); return new THREE.Vector3(p.x, p.y, p.z); }

  buildTunnel() {
    const g = this.geom, type = this.line.tunnelProfile;
    const lampMatrices = [];
    if (this.opts.offset) {
      for (const k of ['tunnel', 'bed']) { this.mat[k] = this.mat[k].clone(); Object.assign(this.mat[k], { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); }
    }
    for (const [a, b] of this.tunnelRanges()) {
      const o = this.origin(a);
      const inner = this.innerSide(a, b);
      const lining = sweep(g, a, b, 3, (s) => (inner ? tunnelProfilePartial(g.tunnelHalfWidthAt(s), type, inner) : tunnelProfile(g.tunnelHalfWidthAt(s), type)), { origin: o, uScale: 0.22, vScale: 0.25 });
      this.add(new THREE.Mesh(lining, this.mat.tunnel), o);
      const F = FLOOR_Y + 0.03;
      const bed = sweep(g, a, b, 3, (s) => {
        const hw = g.tunnelHalfWidthAt(s);
        if (inner > 0) return [[-hw, 0.2], [-hw + 0.75, 0.2], [-hw + 0.75, F], [hw + 0.6, F]];
        if (inner < 0) return [[-hw - 0.6, F], [hw - 0.75, F], [hw - 0.75, 0.2], [hw, 0.2]];
        return [[-hw, 0.2], [-hw + 0.75, 0.2], [-hw + 0.75, F], [hw - 0.75, F], [hw - 0.75, 0.2], [hw, 0.2]];
      }, { origin: o, uScale: 0.3, vScale: 0.3 });
      this.add(new THREE.Mesh(bed, this.mat.bed), o);
      const cables = [-1, 1].filter((sd) => sd !== inner).map((side) => sweep(g, a, b, 3, (s) => {
        const hw = g.tunnelHalfWidthAt(s) * side;
        const i = -0.12 * side;
        return [[hw, 1.2], [hw + i, 1.2], [hw + i, 1.5], [hw, 1.5]];
      }, { origin: o }));
      this.add(new THREE.Mesh(mergeGeometries(cables), this.mat.cable), o);
      for (let s = Math.ceil(a / 24) * 24; s < b; s += 24) {
        for (const side of [-1, 1]) {
          if (side === inner) continue;
          const hw = g.tunnelHalfWidthAt(s) - 0.08;
          const p = g.point(s, hw * side, 2.55);
          const m = new THREE.Matrix4().makeRotationY(-g.heading(s));
          m.setPosition(p.x, p.y, p.z);
          lampMatrices.push(m);
        }
      }
    }
    this.lampPositions = lampMatrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    const lampGeo = new THREE.BoxGeometry(0.14, 0.1, 0.7);
    const lamps = new THREE.InstancedMesh(lampGeo, this.mat.lamp, lampMatrices.length);
    lampMatrices.forEach((m, i) => lamps.setMatrixAt(i, m));
    lamps.computeBoundingSphere();
    this.group.add(lamps);
  }

  buildTrack() {
    const g = this.geom;
    const sleeperGeo = new THREE.BoxGeometry(2.5, 0.14, 0.24);
    for (const [a, b] of this.chunk(this.opts.fromS, g.length)) {
      const o = this.origin(a);
      const railGeos = [], topGeos = [], cond = [];
      const inner = this.innerSide(a, b);
      for (const route of Object.values(this.routes)) {
        const sg = route.sign;
        for (const r of [-GAUGE_HALF, GAUGE_HALF]) {
          railGeos.push(sweep(g, a, b, 3, (s) => {
            const c = sg * g.halfSpacingAt(s) + r;
            return [[c - 0.065, -0.17], [c - 0.065, -0.15], [c - 0.012, -0.13], [c - 0.012, -0.03], [c - 0.036, -0.025], [c - 0.036, 0]];
          }, { origin: o }));
          railGeos.push(sweep(g, a, b, 3, (s) => {
            const c = sg * g.halfSpacingAt(s) + r;
            return [[c + 0.036, 0], [c + 0.036, -0.025], [c + 0.012, -0.03], [c + 0.012, -0.13], [c + 0.065, -0.15], [c + 0.065, -0.17]];
          }, { origin: o }));
          topGeos.push(sweep(g, a, b, 3, (s) => { const c = sg * g.halfSpacingAt(s) + r; return [[c - 0.036, 0.001], [c + 0.036, 0.001]]; }, { origin: o }));
        }
        if (sg !== inner) cond.push(sweep(g, a, b, 3, (s) => {
          const c = sg * (g.halfSpacingAt(s) + GAUGE_HALF + 0.62);
          return [[c - 0.05, -0.12], [c - 0.05, 0.04], [c + 0.05, 0.04], [c + 0.05, -0.12]];
        }, { origin: o }));
      }
      this.add(new THREE.Mesh(mergeGeometries(railGeos), this.mat.rail), o);
      this.add(new THREE.Mesh(mergeGeometries(topGeos), this.mat.railTop), o);
      if (cond.length) this.add(new THREE.Mesh(mergeGeometries(cond), this.mat.conductor), o);
      const count = Math.floor((b - a) / 0.75) * 2;
      const sl = new THREE.InstancedMesh(sleeperGeo, this.mat.sleeper, count);
      const m = new THREE.Matrix4();
      let i = 0;
      for (let s = a; s < b - 0.01 && i < count; s += 0.75) {
        for (const sg of [-1, 1]) {
          if (i >= count) break;
          const p = g.point(s, sg * g.halfSpacingAt(s), -0.24);
          m.makeRotationY(-g.heading(s));
          m.setPosition(p.x - o.x, p.y - o.y, p.z - o.z);
          sl.setMatrixAt(i++, m);
        }
      }
      sl.count = i;
      sl.position.copy(o);
      sl.computeBoundingSphere();
      this.group.add(sl);
    }
  }

  /** Lineside speed boards at every limit change and stop markers at each platform. */
  buildBoards() {
    const postMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const route of Object.values(this.routes)) {
      const L = route.limits;
      for (let r = 1; r < L.length - 1; r++) {
        if (L[r] === L[r - 1] || r < route.stops[0].stopR + 5) continue;
        const dec = L[r] < L[r - 1];
        const tex = Textures.label(String(Math.round(L[r])), {
          w: 128, h: 128, bg: dec ? '#ffd23f' : '#ffffff', fg: '#111111', font: 'bold 64px Arial', border: dec ? '#111111' : '#d00000', radius: 64,
        });
        const at = dec ? r - 120 : r; // warning board ahead of a reduction, execution board at increase
        if (at < 10) continue;
        this.addBoard(route, at, this.boardSide(route, at), 1.9, 0.62, 0.62, tex, postMat);
        if (dec) this.addBoard(route, r, this.boardSide(route, r), 1.9, 0.62, 0.62, Textures.label(String(Math.round(L[r])), { w: 128, h: 128, bg: '#ffffff', fg: '#111', font: 'bold 64px Arial', border: '#d00000', radius: 64 }), postMat);
      }
      for (const stp of route.stops) {
        const side = stp.doorSide === 'right' ? -1.55 : 1.75;
        this.addBoard(route, stp.stopR, side, 2.1, 0.55, 0.75, Textures.label('STOP', { w: 128, h: 176, bg: '#ffffff', fg: '#c00000', font: 'bold 44px Arial', border: '#c00000', radius: 8 }), postMat);
      }
    }
  }

  /** Boards go on the driver's right, unless a side platform is there (then between the tracks). */
  boardSide(route, r) {
    const z = this.geom.stationZoneAt(route.toTrack(r));
    if (z && this.line.stations[z.index].platformType === 'side') return -1.55;
    return 1.75;
  }

  addBoard(route, r, side, height, w, h, tex, postMat) {
    if (route.toTrack(r) < this.opts.fromS + 5) return;
    const p = route.point(r, side, height);
    const heading = this.geom.heading(route.toTrack(r));
    const phi = -heading + (route.sign < 0 ? Math.PI : 0);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    board.position.set(p.x, p.y, p.z);
    board.rotation.y = phi;
    this.group.add(board);
    const len = height - h / 2 + 0.45;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len), postMat);
    post.position.set(p.x, p.y - h / 2 - len / 2, p.z);
    this.group.add(post);
  }

  buildBuffers() {
    const mat = new THREE.MeshLambertMaterial({ map: Textures.label(' ', { w: 64, h: 64, bg: '#c62828', fg: '#fff' }) });
    const stripe = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const wall = new THREE.MeshLambertMaterial({ map: Textures.concrete('#55524d'), side: THREE.DoubleSide });
    for (const route of Object.values(this.routes)) {
      const r = route.length - 8;
      if (route.toTrack(r) < this.opts.fromS) continue;
      const p = route.point(r, 0, 0.6);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.5), mat);
      beam.position.set(p.x, p.y, p.z);
      beam.rotation.y = -this.geom.heading(route.toTrack(r));
      this.group.add(beam);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.52), stripe);
      st.position.copy(beam.position); st.rotation.copy(beam.rotation);
      this.group.add(st);
    }
    for (const s of [0.05, this.geom.length - 0.05]) {
      if (s < this.opts.fromS) continue;
      const hw = this.geom.tunnelHalfWidthAt(s);
      const p = this.geom.point(s, 0, 2.4);
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 6), wall);
      cap.position.set(p.x, p.y, p.z);
      cap.rotation.y = -this.geom.heading(s);
      this.group.add(cap);
    }
  }

  /** Free space at a chainage (used to keep exterior cameras inside tunnels and stations). */
  envelope(trackS) {
    const z = this.geom.stationZoneAt(trackS);
    const sv = z && this.stations.find((x) => x.index === z.index);
    if (z && !sv && this.opts.fallback) return this.opts.fallback.envelope(trackS);
    if (sv) {
      return { maxLat: sv.W - 0.4, ceil: (lat) => (sv.style === 'vault' ? sv.H + sv.vaultRise * Math.sqrt(Math.max(0, 1 - (lat / sv.W) ** 2)) : sv.H) - 0.35 };
    }
    const hw = this.geom.tunnelHalfWidthAt(trackS);
    const box = this.line.tunnelProfile === 'box';
    return { maxLat: hw - 0.4, ceil: (lat) => (box ? BOX_HEIGHT : ARCH_SPRING + ARCH_RISE * Math.sqrt(Math.max(0, 1 - (lat / hw) ** 2))) - 0.4 };
  }

  add(mesh, origin) { mesh.position.copy(origin); this.group.add(mesh); return mesh; }

  update(trackS, clock, etaProvider, viewPos) {
    if (viewPos) this.lights?.update(viewPos);
    if (viewPos) this.tunnelLights?.update(viewPos);
    for (const sv of this.stations) if (Math.abs(sv.centerS - trackS) < 500) sv.updatePIDs(clock, etaProvider);
  }

  dispose() {
    this.scene.remove(this.group);
    this.lights?.dispose();
    this.tunnelLights?.dispose();
    this.group.traverse((o) => { o.geometry?.dispose(); });
  }
}

/** A fixed pool of point lights moved to the station nearest to the viewer (constant light count = no shader recompiles). */
class StationLightPool {
  constructor(scene) {
    this.scene = scene;
    this.sources = [];
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xfff2dd, 0, 38, 1.4);
      scene.add(l);
      this.lights.push(l);
    }
    this.current = null;
    this.t = 0;
  }
  addSource(geom, line, zones) {
    for (const z of zones) { const p = geom.point(z.center); this.sources.push({ geom, line, z, p: new THREE.Vector3(p.x, p.y, p.z) }); }
  }
  update(viewPos) {
    if (++this.t % 10 !== 1) return;
    let best = null, bd = Infinity;
    for (const src of this.sources) { const d = src.p.distanceToSquared(viewPos); if (d < bd) { bd = d; best = src; } }
    if (!best || best === this.current) return;
    this.current = best;
    const { geom, line, z } = best;
    const st = line.stations[z.index];
    const hs = geom.halfSpacingAt(z.center);
    const lat = st.platformType === 'island' ? [0, 0] : [hs + 1.45 + st.platformWidth / 2, -(hs + 1.45 + st.platformWidth / 2)];
    const color = st.style === 'modern' ? 0xe8f0ff : st.style === 'pillars' ? 0xfff6e6 : 0xffe9c4;
    const zs = [-st.platformLength / 3, 0, st.platformLength / 3];
    let i = 0;
    for (const side of lat) for (const dz of zs) {
      const p = geom.point(z.center + dz, side, 3.6);
      const l = this.lights[i++];
      l.position.set(p.x, p.y, p.z);
      l.color.setHex(color);
      l.intensity = st.platformType === 'island' ? 26 : 22;
    }
  }
  dispose() { for (const l of this.lights) this.scene.remove(l); }
}

/** Small pool of warm point lights following the tunnel lamps closest to the viewer. */
class TunnelLightPool {
  constructor(scene, positions) {
    this.scene = scene; this.positions = positions;
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffe2b0, 5, 16, 1.6); scene.add(l); this.lights.push(l); }
    this.t = 0;
  }
  update(p) {
    if (++this.t % 6) return;
    const best = [];
    for (const q of this.positions) {
      const d = q.distanceToSquared(p);
      if (best.length < 4 || d < best[best.length - 1].d) {
        best.push({ q, d }); best.sort((a, b) => a.d - b.d); if (best.length > 4) best.pop();
      }
    }
    this.lights.forEach((l, i) => { if (best[i]) { l.position.copy(best[i].q); l.position.y -= 0.25; l.intensity = 5; } else l.intensity = 0; });
  }
  dispose() { for (const l of this.lights) this.scene.remove(l); }
}
