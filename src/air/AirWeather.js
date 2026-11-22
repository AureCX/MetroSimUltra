// Aviation weather: clear, cloudy, rain, fog, storm (or 'auto': changes through the day), with wind direction and
// speed, gusts, turbulence, visibility and cloud base. It drives the flight model (wind, gusts, turbulence, wet
// runway braking), ATC (low-visibility spacing, storm suspensions) and the scene (fog, cloud layer, rain streaks,
// lightning). Night is handled by the world's sky from the clock.
import * as THREE from 'three';

export const AIR_WEATHER = {
  clear: { label: 'Clear', vis: 40000, wind: 4, gust: 0, turb: 0.08, cover: 0.12, base: 1600, rain: 0 },
  cloudy: { label: 'Cloudy', vis: 20000, wind: 7, gust: 3, turb: 0.35, cover: 0.65, base: 900, rain: 0 },
  rain: { label: 'Rain', vis: 5000, wind: 9, gust: 5, turb: 0.6, cover: 0.92, base: 450, rain: 0.7 },
  fog: { label: 'Fog', vis: 450, wind: 2, gust: 0, turb: 0.02, cover: 1, base: 70, rain: 0 },
  storm: { label: 'Storm', vis: 2500, wind: 15, gust: 10, turb: 1.5, cover: 1, base: 350, rain: 1 },
};
export const AIR_WEATHER_KINDS = ['auto', ...Object.keys(AIR_WEATHER)];
const rnd = (n) => { let h = Math.imul((n | 0) ^ 0x2545f491, 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; return ((h ^ (h >>> 13)) >>> 0) / 4294967295; };

export class AirWeather {
  /** opts: { kind: 'auto' | clear | cloudy | rain | fog | storm, windDir, windSpeed, seed }. */
  constructor(scene, opts = {}) {
    this.scene = scene; this.mode = opts.kind || 'auto'; this.seed = opts.seed ?? 3;
    this.windDir = opts.windDir ?? 260 + Math.round(rnd(this.seed) * 60); this.windOverride = opts.windSpeed;
    this.kind = this.mode === 'auto' ? 'clear' : this.mode;
    this.p = { ...AIR_WEATHER[this.kind] }; this.target = this.p; this.flash = 0; this.nextFlash = 8; this.t = 0;
    if (scene) this.buildFx();
  }
  /** For 'auto': weather of a 40-minute slot of the day (mostly fair, some cloud / rain, morning fog, rare storms). */
  autoKind(clock) {
    const slot = Math.floor(clock / 2400), r = rnd(slot * 7 + this.seed * 131), h = (clock / 3600) % 24;
    if (h < 8.5 && h > 5 && r < 0.25) return 'fog';
    return r < 0.45 ? 'clear' : r < 0.75 ? 'cloudy' : r < 0.93 ? 'rain' : 'storm';
  }
  setKind(k) { this.mode = k; if (k !== 'auto') { this.kind = k; this.target = { ...AIR_WEATHER[k] }; } }
  update(dt, clock, cam) {
    this.t += dt;
    if (this.mode === 'auto') { const k = this.autoKind(clock); if (k !== this.kind) { this.kind = k; this.target = { ...AIR_WEATHER[k] }; } }
    if (!this.started) { this.started = true; this.p = { ...this.target }; }
    // Smooth transition (about a minute).
    const a = Math.min(1, dt / 40);
    for (const key of ['vis', 'wind', 'gust', 'turb', 'cover', 'base', 'rain']) this.p[key] += (this.target[key] - this.p[key]) * (key === 'vis' ? Math.min(1, dt / 25) : a);
    this.windDir = (this.windDir + Math.sin(this.t / 900 + this.seed) * dt * 0.01 + 360) % 360;
    if (this.kind === 'storm') { this.nextFlash -= dt; if (this.nextFlash < 0) { this.flash = 1; this.nextFlash = 6 + Math.random() * 14; this.onThunder?.(0.6 + Math.random() * 0.4); } }
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.fx && cam) this.updateFx(dt, cam);
  }
  // ---- queries used by the physics and ATC ----
  wind() { const sp = this.windOverride ?? this.p.wind; return { dir: this.windDir, speed: sp, gust: this.p.gust, turb: this.p.turb }; }
  visibility() { return this.p.vis; }
  storm() { return this.kind === 'storm'; }
  stormHere() { return this.kind === 'storm' && this.p.rain > 0.8; }
  wet() { return this.p.rain > 0.2; }
  /** Crosswind / headwind components (m/s) for a runway heading. */
  components(hdg) { const w = this.wind(), a = ((w.dir - hdg) * Math.PI) / 180; return { head: w.speed * Math.cos(a), cross: w.speed * Math.sin(a) }; }
  metar(icao, clock) {
    const w = this.wind(), v = this.p.vis, base = Math.round(this.p.base * 3.28 / 100);
    const cov = this.p.cover > 0.9 ? 'OVC' : this.p.cover > 0.55 ? 'BKN' : this.p.cover > 0.25 ? 'SCT' : 'FEW';
    const wx = this.kind === 'storm' ? ' +TSRA' : this.kind === 'rain' ? ' RA' : this.kind === 'fog' ? ' FG' : '';
    const hh = String(Math.floor(clock / 3600) % 24).padStart(2, '0'), mm = String(Math.floor(clock / 60) % 60).padStart(2, '0');
    return `${icao} ${hh}${mm}Z ${String(Math.round(w.dir / 10) * 10 % 360).padStart(3, '0')}${String(Math.round(w.speed * 1.94)).padStart(2, '0')}${w.gust > 1 ? `G${Math.round((w.speed + w.gust) * 1.94)}` : ''}KT ${v >= 10000 ? '9999' : String(Math.round(v / 50) * 50).padStart(4, '0')}${wx} ${cov}${String(base).padStart(3, '0')}${this.kind === 'storm' ? 'CB' : ''}`;
  }

  // ---- scene effects ----
  buildFx() {
    const fx = this.fx = new THREE.Group(); fx.name = 'air-weather'; this.scene.add(fx);
    // Cloud layer: billboard puffs at the cloud base, wrapped around the camera.
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    for (let i = 0; i < 26; i++) { const x = 30 + Math.random() * 68, y = 40 + Math.random() * 48, r = 18 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.cloudMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, color: 0xffffff });
    this.clouds = [];
    for (let i = 0; i < 160; i++) { const s = new THREE.Sprite(this.cloudMat); s.userData = { ox: (rnd(i * 3 + 1) - 0.5) * 40000, oz: (rnd(i * 3 + 2) - 0.5) * 40000, k: rnd(i * 3 + 3), sz: 1400 + rnd(i * 5) * 2200 }; s.scale.set(s.userData.sz, s.userData.sz * 0.45, 1); fx.add(s); this.clouds.push(s); }
    // Rain streaks in a box around the camera.
    const N = 2400, pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 80, y = Math.random() * 60 - 20, z = (Math.random() - 0.5) * 80; pos.set([x, y, z, x, y - 1.2, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.35, depthWrite: false })); this.rain.frustumCulled = false; fx.add(this.rain);
  }
  updateFx(dt, cam) {
    const p = this.p, cx = cam.position.x, cz = cam.position.z;
    // Clouds: count by cover, wrap within ±20 km of the camera; a thicker deck in storms / overcast.
    const n = Math.round(this.clouds.length * Math.min(1, p.cover));
    const dark = this.kind === 'storm' ? 0.45 : this.kind === 'rain' ? 0.65 : 1;
    this.cloudMat.color.setScalar(dark * this.daylight + 0.06 + this.flash * 0.6);
    this.clouds.forEach((s, i) => {
      s.visible = i < n; if (!s.visible) return;
      const u = s.userData, W = 40000, w = this.windDir * Math.PI / 180, drift = this.t * (this.p.wind * 0.6);
      let x = u.ox - Math.sin(w) * drift, z = u.oz + Math.cos(w) * drift;
      x = ((((x - cx) % W) + W * 1.5) % W) - W / 2 + cx; z = ((((z - cz) % W) + W * 1.5) % W) - W / 2 + cz;
      s.position.set(x, this.groundY + p.base + u.k * (p.cover > 0.9 ? 500 : 250), z);
    });
    // Rain follows the camera; streaks fall and wrap.
    const on = p.rain > 0.05; this.rain.visible = on;
    if (on) {
      this.rain.position.set(cx, cam.position.y, cz); this.rain.material.opacity = 0.18 + p.rain * 0.3;
      const a = this.rain.geometry.attributes.position, arr = a.array, fall = (9 + p.rain * 4) * dt;
      for (let i = 0; i < arr.length; i += 6) { arr[i + 1] -= fall; arr[i + 4] -= fall; if (arr[i + 1] < -20) { arr[i + 1] += 60; arr[i + 4] += 60; } }
      a.needsUpdate = true;
    }
  }
  daylight = 1; groundY = 0;
  dispose() { if (this.fx) { this.scene.remove(this.fx); this.rain.geometry.dispose(); } }
}
