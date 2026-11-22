// The world seen from an aircraft: the whole country of the Grandville network (same terrain as the TGV lines),
// streamed as three nested terrain grids centred on the camera (near 14 km at 70 m, mid 70 km at 450 m, far 360 km at
// 2.4 km; vertices relative to each grid's centre so there is no jitter hundreds of km from the origin), the sea,
// the seven airports (built once, hidden when far), the cities next to them (instanced buildings, lit windows at
// night), and the sky: sun / moon by the clock, sky and fog colours by time and weather.
import * as THREE from 'three';
import { RailTerrain, COUNTRY } from '../rail/RailTerrain.js';
import { AIRPORTS } from './AirData.js';
import { buildAirport } from './AirportBuilder.js';

const BIOME = [[0.62, 0.6, 0.36], [0.42, 0.56, 0.3], [0.2, 0.34, 0.17], [0.5, 0.48, 0.45], [0.93, 0.94, 0.96], [0.86, 0.8, 0.62], [0.66, 0.55, 0.32]];
const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const RINGS = [{ size: 14000, n: 140, drop: 0 }, { size: 70000, n: 120, drop: 6 }, { size: 360000, n: 110, drop: 35 }];
// Layer 1: far-only scenery (skipped by the near-range render pass).
export const FAR_LAYER = 1;

/** Airport elevations and the terrain with the airports flattened (shared by the game and the tests). */
export function airTerrain() {
  const base = new RailTerrain(COUNTRY);
  const elev = {};
  for (const ap of AIRPORTS) elev[ap.id] = Math.max(4, Math.round(base.height(ap.x, ap.z)));
  const pads = AIRPORTS.map((ap) => { const R = Math.max(...ap.runways.map((r) => r.length)) / 2 + 1100; return { x0: ap.x - R, x1: ap.x + R, z0: ap.z - R, z1: ap.z + R, y: elev[ap.id], blend: 3500 }; });
  const cities = AIRPORTS.map((ap) => ({ x: ap.cityPos.x, z: ap.cityPos.z, r: 1500, y: ap.cityPos.y - 0.6 }));
  return { terrain: new RailTerrain({ ...COUNTRY, cities, pads }), elev };
}

export class FlightWorld {
  constructor(scene, renderer, { quality = 'high' } = {}) {
    this.scene = scene; this.renderer = renderer; this.quality = quality;
    const { terrain, elev } = airTerrain(); this.terrain = terrain; this.elev = elev;
    this.group = new THREE.Group(); this.group.name = 'flight-world'; scene.add(this.group);
    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  build() {
    const s = this.scene;
    // Lights and sky.
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.9); s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2); s.add(this.sun, this.sun.target);
    s.background = new THREE.Color(0x8fb8e6); s.fog = new THREE.Fog(0x8fb8e6, 2000, 60000);
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(400000, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true, fog: false, depthWrite: false }));
    { const g = this.skyDome.geometry, p = g.attributes.position, col = new Float32Array(p.count * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    this.skyDome.renderOrder = -10; this.skyDome.frustumCulled = false; this.skyDome.layers.set(FAR_LAYER); s.add(this.skyDome);
    this.stars = (() => { const N = 1500, pos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const a = hash(i, 1) * Math.PI * 2, b = Math.acos(hash(i, 2) * 0.95); pos.set([Math.sin(b) * Math.cos(a) * 350000, Math.cos(b) * 350000, Math.sin(b) * Math.sin(a) * 350000], i * 3); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true })); })();
    this.stars.frustumCulled = false; this.stars.layers.set(FAR_LAYER); s.add(this.stars);
    // Terrain rings and the sea.
    this.rings = RINGS.map((r) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), this.groundMat); m.frustumCulled = false; m.renderOrder = -1; if (r.size > 20000) m.layers.set(FAR_LAYER); this.group.add(m); return { ...r, mesh: m, cx: null, cz: null }; });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(800000, 800000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d5a85, metalness: 0.2, roughness: 0.25 }));
    this.sea.position.y = -0.6; this.group.add(this.sea);
    // Airports.
    this.airports = AIRPORTS.map((ap) => buildAirport(this.group, ap, this.elev[ap.id]));
    // Cities.
    this.cityLights = [];
    for (const ap of AIRPORTS) this.buildCity(ap);
    return this;
  }
  layout(id) { return this.airports.find((a) => a.ap.id === id); }
  /** Ground height (m): the terrain (flat on the airports), never below the sea surface for aircraft purposes. */
  ground(x, z) { return Math.max(-0.6, this.terrain.height(x, z)); }
  buildCity(ap) {
    const C = ap.cityPos, big = ap.id === 'GRV' || ap.id === 'PAZ', N = big ? 2600 : 1300, R = big ? 6500 : 3800;
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, N); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const lights = [];
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const a = hash(i, ap.x) * Math.PI * 2, r = Math.pow(hash(i, ap.z), 0.7) * R;
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      // Stay off the runways.
      if (Math.hypot(x - ap.x, z - ap.z) < 3200) continue;
      const h = this.terrain.height(x, z); if (h < 1) continue;
      const centre = 1 - r / R, tall = centre * centre * (big ? 70 : 35);
      const w = 14 + hash(i, 7) * 26, d = 14 + hash(i, 8) * 26, H = 6 + hash(i, 9) * 10 + tall * hash(i, 10);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(hash(i, 11) * 4) * Math.PI / 2 + (ap.id === 'GRV' ? 0.2 : 0));
      m.compose(new THREE.Vector3(x - C.x, h - 0.5 - C.y, z - C.z), q, new THREE.Vector3(w, H, d));
      inst.setMatrixAt(k, m);
      const t = hash(i, 12); col.setRGB(0.75 + t * 0.2, 0.72 + t * 0.18, 0.66 + t * 0.15); if (H < 14 && hash(i, 13) < 0.5) col.setRGB(0.68, 0.38, 0.3);
      inst.setColorAt(k, col);
      if (hash(i, 14) < 0.7) lights.push(x - C.x, h + H + 1 - C.y, z - C.z);
      k++;
    }
    inst.count = k; inst.position.set(C.x, C.y, C.z); this.group.add(inst);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
    const pts = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xffd28a, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    pts.position.copy(inst.position); this.group.add(pts); this.cityLights.push(pts);
  }
  /** Rebuild the terrain rings that the camera has moved away from (at most one per frame). */
  // Rebuilds are time-sliced (a few ms per frame) and swapped in when complete, so flying never stutters.
  updateTerrain(cx, cz, force = false) {
    if (this.job && !force) { const t0 = performance.now(); while (performance.now() - t0 < 5) if (this.job.next().done) { this.job = null; break; } return; }
    for (const R of this.rings) {
      const step = R.size / R.n, snap = step * 4;
      const nx = Math.round(cx / snap) * snap, nz = Math.round(cz / snap) * snap;
      // Rebuild when the camera has moved 12 % of the ring size (sooner for the near ring when it is about to run out).
      if (!force && R.cx != null && Math.abs(cx - R.cx) < R.size * 0.12 && Math.abs(cz - R.cz) < R.size * 0.12) continue;
      if (force) { const g = this.buildRing(R, nx, nz); while (!g.next().done); continue; }
      this.job = this.buildRing(R, nx, nz); return;
    }
  }
  *buildRing(R, cx, cz) {
    const T = this.terrain, N = R.n, step = R.size / N, half = R.size / 2;
    const inner = this.rings[this.rings.indexOf(R) - 1];
    const pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3);
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = cx - half + j * step, z = cz - half + i * step, k = (i * (N + 1) + j) * 3;
      let h = T.height(x, z);
      const sea = h < 0;
      // Under the finer ring: pushed down so it never shows through.
      if (inner && inner.cx != null && Math.abs(x - inner.cx) < inner.size / 2 - step && Math.abs(z - inner.cz) < inner.size / 2 - step) h -= R.drop + Math.max(0, h) * 0.02;
      pos[k] = x - cx; pos[k + 1] = Math.max(h, -60); pos[k + 2] = z - cz;
      const c = sea ? [0.6, 0.6, 0.5] : BIOME[T.biome(x, z, h)], n = 0.9 + hash(Math.round(x / 97), Math.round(z / 97)) * 0.16;
      col[k] = c[0] * n; col[k + 1] = c[1] * n; col[k + 2] = c[2] * n;
      if (j === N && i % 8 === 7) yield;
    }
    const idx = new (N > 250 ? Uint32Array : Uint32Array)(N * N * 6); let p = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + N + 1; idx[p++] = a; idx[p++] = b; idx[p++] = a + 1; idx[p++] = b; idx[p++] = b + 1; idx[p++] = a + 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    yield;
    R.cx = cx; R.cz = cz;
    R.mesh.geometry.dispose(); R.mesh.geometry = g; R.mesh.position.set(cx, 0, cz);
    // Lowered to keep the airport strips (which sit exactly at their elevation) above the coarse grids.
    R.mesh.position.y = this.rings.indexOf(R) === 0 ? -0.15 : -1.5;
  }
  /** Sun elevation (deg) from the clock (sunrise ≈ 06:30, sunset ≈ 20:30). */
  sunElevation(clock) { const h = (clock / 3600) % 24; return Math.sin(((h - 6.6) / 14.2) * Math.PI) * 60 - (h < 6.6 || h > 20.8 ? 10 : 0); }
  update(dt, clock, cam, weather) {
    const cp = cam.position;
    this.updateTerrain(cp.x, cp.z);
    // Sky by sun height and cloud cover.
    const el = this.sunElevation(clock), day = Math.max(0, Math.min(1, (el + 6) / 18)), dusk = Math.max(0, 1 - Math.abs(el - 1) / 7);
    const cover = weather?.p.cover ?? 0.2, vis = weather?.visibility() ?? 30000, flash = weather?.flash || 0;
    const grey = Math.max(0, cover - 0.6) * 2.2;
    const top = new THREE.Color().setRGB(0.18 + 0.2 * day, 0.36 * day + 0.04, 0.75 * day + 0.08).lerp(new THREE.Color(0.55, 0.58, 0.62).multiplyScalar(0.25 + 0.6 * day), grey * 0.8);
    const hor = new THREE.Color().setRGB(0.62 * day + 0.05, 0.74 * day + 0.06, 0.9 * day + 0.1).lerp(new THREE.Color(1, 0.55, 0.3), dusk * 0.55 * (1 - grey)).lerp(new THREE.Color(0.65, 0.67, 0.7).multiplyScalar(0.2 + 0.7 * day), grey * 0.85);
    if (flash) { top.lerp(new THREE.Color(1, 1, 1), flash * 0.5); hor.lerp(new THREE.Color(1, 1, 1), flash * 0.5); }
    const g = this.skyDome.geometry, P = g.attributes.position, C = g.attributes.color;
    for (let i = 0; i < P.count; i++) { const t = Math.max(0, P.getY(i) / 400000); const c = hor.clone().lerp(top, Math.pow(t, 0.6)); C.setXYZ(i, c.r, c.g, c.b); }
    C.needsUpdate = true;
    this.skyDome.position.copy(cp); this.stars.position.copy(cp); this.stars.material.opacity = Math.max(0, 1 - day * 3) * (1 - cover);
    this.scene.background.copy(hor);
    // Fog: visibility (and haze with altitude).
    const fogFar = Math.min(vis * 1.4, 160000 + cp.y * 20); this.scene.fog.color.copy(hor); this.scene.fog.near = Math.min(fogFar * 0.05, 3000); this.scene.fog.far = fogFar;
    // Sun / ambient.
    const az = ((clock / 3600 - 6) / 15) * Math.PI;
    this.sun.position.set(cp.x + Math.cos(az) * 50000, cp.y + Math.max(2000, Math.sin(el * Math.PI / 180) * 80000), cp.z + Math.sin(az) * 30000); this.sun.target.position.copy(cp);
    this.sun.intensity = (0.2 + 2.2 * day) * (1 - grey * 0.55) + flash * 2; this.sun.color.setRGB(1, 0.85 + 0.15 * (1 - dusk), 0.7 + 0.3 * (1 - dusk));
    this.hemi.intensity = 0.15 + 0.85 * day + flash; this.night = 1 - day;
    for (const L of this.cityLights) L.material.opacity = Math.max(0, 1 - day * 2.5);
    // Airports: lights by night, PAPI and windsock; far airports hidden.
    const w = weather?.wind();
    for (const A of this.airports) {
      const d = Math.hypot(A.ap.x - cp.x, A.ap.z - cp.z); A.group.visible = d < 90000;
      if (A.group.visible) A.update(clock, 1 - day, cp, w);
    }
    this.sea.position.x = cp.x; this.sea.position.z = cp.z;
    if (weather) { weather.daylight = 0.25 + 0.75 * day; weather.groundY = Math.max(0, this.ground(cp.x, cp.z)); }
  }
  dispose() {
    this.scene.remove(this.group, this.hemi, this.sun, this.sun.target, this.skyDome, this.stars);
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
  }
}
