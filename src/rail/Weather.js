// Weather on the main lines: clear, cloudy, rain or storm. 'auto' follows a deterministic pattern along the line
// (rain belts a few tens of kilometres wide, different for each service and day), the other settings are fixed.
// Drives the rain streaks around the camera, the sky and haze (darker, shorter visibility) and the rain on the
// windscreen. rain is 0..1.
import * as THREE from 'three';

export const WEATHER_KINDS = ['auto', 'clear', 'cloudy', 'rain', 'storm'];
export const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm' };
const smooth = (t) => t * t * (3 - 2 * t);
const hash = (n) => { let h = Math.imul(n | 0, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967295; };

export class Weather {
  constructor(scene, { mode = 'auto', seed = 1 } = {}) {
    this.scene = scene; this.mode = mode; this.seed = seed;
    this.rain = 0; this.cloud = 0; this.kind = 'clear';
    const N = this.N = 2600;
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.drops[i * 3] = (Math.random() - 0.5) * 80; this.drops[i * 3 + 1] = Math.random() * 40; this.drops[i * 3 + 2] = (Math.random() - 0.5) * 80; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c6, transparent: true, opacity: 0, depthWrite: false }));
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }
  setMode(m) { if (WEATHER_KINDS.includes(m)) this.mode = m; }
  cycle() { this.setMode(WEATHER_KINDS[(WEATHER_KINDS.indexOf(this.mode) + 1) % WEATHER_KINDS.length]); return this.mode; }
  /** Target rain / cloud for position s (m along the line). */
  target(s) {
    if (this.mode === 'clear') return { rain: 0, cloud: 0.05 };
    if (this.mode === 'cloudy') return { rain: 0, cloud: 0.7 };
    if (this.mode === 'rain') return { rain: 0.6, cloud: 0.85 };
    if (this.mode === 'storm') return { rain: 1, cloud: 1 };
    // auto: value noise over 30 km cells, seeded per service/day.
    const x = s / 30000, i = Math.floor(x), f = smooth(x - i);
    const a = hash(i * 7 + this.seed * 131), b = hash((i + 1) * 7 + this.seed * 131);
    const w = a + (b - a) * f;                                   // 0..1
    const rain = Math.max(0, (w - 0.55) / 0.45);
    return { rain: Math.min(1, rain * 1.2), cloud: Math.min(1, Math.max(0, (w - 0.25) / 0.5)) };
  }
  get label() { return WEATHER_LABEL[this.kind] + (this.mode === 'auto' ? ' (auto)' : ''); }
  /** s: train position, cam: camera world position, v: train speed (m/s), dir: unit forward vector, outdoor 0..1. */
  update(dt, s, cam, v, dir, outdoor) {
    const t = this.target(s), k = Math.min(1, dt * 0.25);
    this.rain += (t.rain - this.rain) * k; this.cloud += (t.cloud - this.cloud) * k;
    this.kind = this.rain > 0.75 ? 'storm' : this.rain > 0.12 ? 'rain' : this.cloud > 0.45 ? 'cloudy' : 'clear';
    const on = this.rain > 0.03 && outdoor > 0.3;
    this.streaks.material.opacity = on ? Math.min(0.55, this.rain * 0.6) * outdoor : 0;
    if (!on) return;
    const pos = this.streaks.geometry.attributes.position.array, d = this.drops, fall = 9 + this.rain * 4;
    // Relative wind from the train's motion slants the streaks.
    const rx = -dir.x * v * 0.12, rz = -dir.z * v * 0.12, len = 0.06 + Math.min(0.35, v * 0.004);
    const n = Math.round(this.N * Math.min(1, 0.25 + this.rain));
    for (let i = 0; i < this.N; i++) {
      let x = d[i * 3], y = d[i * 3 + 1], z = d[i * 3 + 2];
      y -= fall * dt; x += rx * dt * 8; z += rz * dt * 8;
      if (y < -3 || Math.abs(x) > 40 || Math.abs(z) > 40) { x = (Math.random() - 0.5) * 80; y = 20 + Math.random() * 20; z = (Math.random() - 0.5) * 80; }
      d[i * 3] = x; d[i * 3 + 1] = y; d[i * 3 + 2] = z;
      const o = i * 6, vis = i < n ? 1 : 0;
      pos[o] = cam.x + x; pos[o + 1] = cam.y + y - 10; pos[o + 2] = cam.z + z;
      pos[o + 3] = cam.x + x - rx * len * vis; pos[o + 4] = cam.y + y - 10 + fall * len * vis; pos[o + 5] = cam.z + z - rz * len * vis;
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.streaks); this.streaks.geometry.dispose(); }
}
