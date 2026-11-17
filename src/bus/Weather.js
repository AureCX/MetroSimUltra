// Day/night cycle and weather: sun position and colour, sky, ambient light, fog/visibility,
// rain and snow particles around the camera, wet-road friction, street lights at night.
// Exposes the road friction coefficient and wet/visibility flags used by physics and AI.
import * as THREE from 'three';
import { SURFACE_MU } from './BusPhysics.js';

export const WEATHERS = {
  clear: { label: 'Clear', mu: SURFACE_MU.dry, rain: 0, snow: 0, fog: 0, cloud: 0.1 },
  cloudy: { label: 'Overcast', mu: SURFACE_MU.dry, rain: 0, snow: 0, fog: 0.15, cloud: 0.7 },
  rain: { label: 'Rain', mu: SURFACE_MU.wet, rain: 0.5, snow: 0, fog: 0.3, cloud: 0.85 },
  heavyRain: { label: 'Heavy rain', mu: SURFACE_MU.heavyRain, rain: 1, snow: 0, fog: 0.5, cloud: 1 },
  fog: { label: 'Fog', mu: SURFACE_MU.wet, rain: 0, snow: 0, fog: 1, cloud: 0.8 },
  snow: { label: 'Snow', mu: SURFACE_MU.snow, rain: 0, snow: 1, fog: 0.45, cloud: 0.9 },
};

export class Weather {
  constructor(scene, renderer, { hour = 8, weather = 'clear', dynamic = false } = {}) {
    this.scene = scene; this.renderer = renderer;
    this.clock = hour * 3600;
    this.kind = weather; this.dynamic = dynamic; this.nextChange = 600;
    this.w = { ...WEATHERS[weather] };
    this.target = WEATHERS[weather];
    this.wetness = this.target.rain > 0 || this.target.snow > 0 ? 1 : 0;
    this.snowCover = this.target.snow > 0.3 ? 1 : 0;
    scene.fog = new THREE.Fog(0xbfd0e0, 50, 1600);
    scene.background = new THREE.Color(0x9ec2e6);
    this.hemi = new THREE.HemisphereLight(0xcfe0f2, 0x4a4a3a, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2);
    scene.add(this.hemi, this.sun, this.sun.target);
    // Sky dome.
    this.skyCanvas = document.createElement('canvas'); this.skyCanvas.width = 4; this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas); this.skyTex.colorSpace = THREE.SRGBColorSpace;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; scene.add(this.sky);
    // Precipitation: streaks (rain) and flakes (snow) recycled in a box around the camera.
    const N = 3500;
    const rg = new THREE.BufferGeometry(); this.rainPos = new Float32Array(N * 6); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; scene.add(this.rain);
    const sg = new THREE.BufferGeometry(); this.snowPos = new Float32Array(N * 3); sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snowPts = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9 }));
    this.snowPts.frustumCulled = false; scene.add(this.snowPts);
    this.N = N; this.seeded = false;
  }

  get hour() { return (this.clock / 3600) % 24; }
  get mu() { return this.w.mu * (1 - 0.0) ; }
  get raining() { return this.w.rain > 0.05; }
  get wet() { return this.wetness > 0.3; }
  /** 0 (night) .. 1 (day) */
  get daylight() { const h = this.hour; return Math.max(0, Math.min(1, (Math.sin(((h - 6) / 12) * Math.PI) + 0.15) * 1.6)); }

  set(kind) { this.kind = kind; this.target = WEATHERS[kind]; }

  update(dt, camPos, extraRoadMats = []) {
    this.clock += dt;
    if (this.dynamic && (this.nextChange -= dt) < 0) {
      this.nextChange = 480 + Math.random() * 600;
      const order = ['clear', 'cloudy', 'rain', 'heavyRain', 'rain', 'cloudy', 'fog', 'clear', 'snow'];
      this.set(order[(order.indexOf(this.kind) + 1 + Math.floor(Math.random() * 2)) % order.length]);
    }
    // Ease weather parameters.
    for (const k of ['mu', 'rain', 'snow', 'fog', 'cloud']) this.w[k] += (this.target[k] - this.w[k]) * Math.min(1, dt * 0.08);
    this.wetness += ((this.w.rain > 0.05 || this.w.snow > 0.05 ? 1 : 0) - this.wetness) * dt * (this.w.rain > 0.05 ? 0.05 : 0.01);
    // Sun.
    const h = this.hour, day = this.daylight;
    const az = ((h - 6) / 12) * Math.PI, el = Math.sin(((h - 6) / 12) * Math.PI);
    const dir = new THREE.Vector3(Math.cos(az), Math.max(-0.3, el), -0.35).normalize();
    this.sun.position.copy(camPos).addScaledVector(dir, 300); this.sun.target.position.copy(camPos);
    const dusk = Math.max(0, 1 - Math.abs(el) * 3);
    this.sun.color.setRGB(1, 0.92 - dusk * 0.3, 0.82 - dusk * 0.45);
    const overcast = this.w.cloud;
    this.sun.intensity = Math.max(0, el) * 2.3 * (1 - overcast * 0.75);
    this.hemi.intensity = 0.12 + day * (0.75 - overcast * 0.2);
    // Sky & fog colours.
    const top = new THREE.Color().setRGB(0.18 + 0.2 * overcast, 0.4 + 0.12 * overcast, 0.78 - 0.18 * overcast).lerp(new THREE.Color(0x070b16), 1 - day);
    const hor = new THREE.Color().setRGB(0.72 + 0.1 * overcast, 0.8 + 0.05 * overcast, 0.88).lerp(new THREE.Color(0x141a26), 1 - day);
    if (dusk > 0 && day > 0.05) hor.lerp(new THREE.Color(0xf0a060), dusk * 0.5 * (1 - overcast));
    const g = this.skyCanvas.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `#${top.getHexString()}`); grd.addColorStop(0.48, `#${hor.getHexString()}`); grd.addColorStop(1, `#${hor.clone().multiplyScalar(0.7).getHexString()}`);
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256); this.skyTex.needsUpdate = true;
    this.sky.position.copy(camPos); this.sky.scale.setScalar(1800);
    this.scene.fog.color.copy(hor);
    this.scene.background.copy(hor);
    const vis = 1600 * (1 - this.w.fog * 0.88) * (1 - this.w.rain * 0.3) * (0.55 + 0.45 * day + 0.0);
    this.scene.fog.near = Math.max(8, vis * 0.08); this.scene.fog.far = Math.max(60, vis);
    this.visibility = vis;
    // Wet roads darken; snow settles on roads, grass and roofs.
    this.snowCover += ((this.w.snow > 0.3 ? 1 : 0) - (this.snowCover ||= 0)) * dt * 0.02;
    for (const m of extraRoadMats) { m.color.setScalar(1 - this.wetness * 0.35 * (1 - this.snowCover)).lerp(new THREE.Color(0xe8ecf0), this.snowCover * 0.55); }
    for (const m of this.snowMats || []) m.color.copy(m.userData.base).lerp(new THREE.Color(0xf2f4f7), this.snowCover * 0.85);
    this.updatePrecip(dt, camPos);
  }

  updatePrecip(dt, c) {
    const N = this.N, R = 40;
    const nRain = Math.floor(N * this.w.rain), nSnow = Math.floor(N * this.w.snow);
    if (!this.seeded) { for (let i = 0; i < N; i++) { this.rainPos.set([c.x + (Math.random() - 0.5) * 2 * R, c.y + Math.random() * 25, c.z + (Math.random() - 0.5) * 2 * R], i * 6); this.snowPos.set([c.x + (Math.random() - 0.5) * 2 * R, c.y + Math.random() * 25, c.z + (Math.random() - 0.5) * 2 * R], i * 3); } this.seeded = true; }
    const rp = this.rainPos;
    for (let i = 0; i < nRain; i++) {
      const o = i * 6;
      rp[o + 1] -= 18 * dt; 
      if (rp[o + 1] < c.y - 6 || Math.abs(rp[o] - c.x) > R || Math.abs(rp[o + 2] - c.z) > R) { rp[o] = c.x + (Math.random() - 0.5) * 2 * R; rp[o + 1] = c.y + 8 + Math.random() * 18; rp[o + 2] = c.z + (Math.random() - 0.5) * 2 * R; }
      rp[o + 3] = rp[o] + 0.05; rp[o + 4] = rp[o + 1] + 0.7; rp[o + 5] = rp[o + 2];
    }
    this.rain.geometry.setDrawRange(0, nRain * 2); this.rain.geometry.attributes.position.needsUpdate = true;
    const sp = this.snowPos;
    for (let i = 0; i < nSnow; i++) {
      const o = i * 3;
      sp[o + 1] -= 1.4 * dt; sp[o] += Math.sin(this.clock + i) * 0.3 * dt;
      if (sp[o + 1] < c.y - 6 || Math.abs(sp[o] - c.x) > R || Math.abs(sp[o + 2] - c.z) > R) { sp[o] = c.x + (Math.random() - 0.5) * 2 * R; sp[o + 1] = c.y + 8 + Math.random() * 18; sp[o + 2] = c.z + (Math.random() - 0.5) * 2 * R; }
    }
    this.snowPts.geometry.setDrawRange(0, nSnow); this.snowPts.geometry.attributes.position.needsUpdate = true;
  }
}
