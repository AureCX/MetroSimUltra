// Collision cinematic: in-cab impact (flash, cracked windshield, violent shake, failing lights),
// then a slow-motion exterior replay with telescoping / jack-knifing cars, sparks, debris and dust,
// and a title card before the run summary. Any key or click skips it.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

const SLOW = 0.22;        // replay time scale
const CAB_TIME = 1.5;     // seconds in the cab before the replay

function crackSvg(seed) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cx = 45 + rnd() * 12, cy = 38 + rnd() * 10;
  let d = '';
  for (let i = 0; i < 16; i++) {
    let a = (i / 16) * Math.PI * 2 + rnd() * 0.3, x = cx, y = cy;
    d += `M${x.toFixed(1)},${y.toFixed(1)}`;
    for (let k = 0; k < 6; k++) { a += (rnd() - 0.5) * 0.5; const l = 3 + rnd() * 8; x += Math.cos(a) * l; y += Math.sin(a) * l * 0.7; d += `L${x.toFixed(1)},${y.toFixed(1)}`; }
  }
  for (const rr of [4, 8, 13]) {
    d += `M${cx + rr},${cy}`;
    for (let k = 1; k <= 24; k++) { const a = (k / 24) * Math.PI * 2; d += `L${(cx + Math.cos(a) * rr * (0.85 + rnd() * 0.3)).toFixed(1)},${(cy + Math.sin(a) * rr * 0.7 * (0.85 + rnd() * 0.3)).toFixed(1)}`; }
  }
  return `<svg viewBox="0 0 100 75" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="rgba(235,245,255,0.85)" stroke-width="0.25"/><path d="${d}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/></svg>`;
}

export class CrashCinematic {
  constructor(game, impact) {
    this.g = game; this.impact = impact;
    this.t = 0; this.done = false;
    this.k = clamp(impact.speed * 3.6 / 40, 0.25, 1.6); // severity
    this.cabStart = game.cameraSys.mode === 'cab';
    const scene = game.scene;
    // Overlay.
    const el = this.el = document.createElement('div');
    el.className = 'crash-overlay';
    el.innerHTML = `<div class="crash-flash"></div><div class="crash-cracks">${this.cabStart ? crackSvg(Math.floor(impact.front)) : ''}</div>
      <div class="crash-bar top"></div><div class="crash-bar bottom"></div>
      <div class="crash-title"><h1>COLLISION</h1><p>${impact.description}</p><small>Press any key to continue</small></div>
      <div class="crash-replay">REPLAY ×${SLOW}</div>`;
    document.body.appendChild(el);
    el.addEventListener('pointerdown', () => this.skip());
    game.bus.emit('crash:start', impact);
    game.audio.crash(this.k, false);
    // Particles.
    this.sparks = this.makeSparks(scene);
    this.debris = [];
    this.dust = [];
    this.dustTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(170,160,150,0.55)'); grd.addColorStop(1, 'rgba(170,160,150,0)');
      x.fillStyle = grd; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
    })();
    this.replayDist = clamp(impact.speed * SLOW * 2.4, 2.5, 28);
    this.contactT = null;
    this.tmp = {};
  }

  makeSparks(scene) {
    const n = 700;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, geo, n, v: new Float32Array(n * 3), life: new Float32Array(n), next: 0 };
  }
  emitSparks(origin, count, spread) {
    const s = this.sparks, pos = s.geo.attributes.position.array, col = s.geo.attributes.color.array;
    for (let i = 0; i < count; i++) {
      const j = s.next; s.next = (s.next + 1) % s.n;
      pos[j * 3] = origin.x + (Math.random() - 0.5) * spread; pos[j * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.6; pos[j * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9;
      s.v[j * 3] = Math.cos(a) * sp; s.v[j * 3 + 1] = 1 + Math.random() * 6; s.v[j * 3 + 2] = Math.sin(a) * sp;
      s.life[j] = 0.5 + Math.random() * 1.2;
      col[j * 3] = 1; col[j * 3 + 1] = 0.55 + Math.random() * 0.4; col[j * 3 + 2] = 0.15;
    }
  }
  emitDebris(origin) {
    const mats = [new THREE.MeshLambertMaterial({ color: 0x2a2a2a }), new THREE.MeshLambertMaterial({ color: 0xbfc4c8 }), new THREE.MeshPhysicalMaterial({ color: 0xdfefff, transparent: true, opacity: 0.6 })];
    const n = Math.round(14 + 20 * this.k);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05 + Math.random() * 0.25, 0.03 + Math.random() * 0.12, 0.05 + Math.random() * 0.3), mats[i % 3]);
      m.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2));
      this.g.scene.add(m);
      this.debris.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7), w: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9), floor: origin.y - 1.3 });
    }
    for (let i = 0; i < 26; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex, transparent: true, depthWrite: false, opacity: 0.0 }));
      sp.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 1.5, (Math.random() - 0.5) * 3));
      sp.scale.setScalar(1);
      this.g.scene.add(sp);
      this.dust.push({ sp, v: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.2 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5), age: -Math.random() * 0.4, grow: 2 + Math.random() * 3 });
    }
  }

  skip() { if (!this.done) { this.done = true; this.finish(); } }
  finish() {
    this.el.querySelector('.crash-title').classList.add('show');
    setTimeout(() => this.g.finish(false, this.impact.reason), 400);
  }

  /** Train pose during the replay with progressive deformation after contact. */
  poseTrain(front, deform) {
    const g = this.g, model = g.playerModel, sp = g.specs, k = this.k * deform;
    model.setPose(g.route, front);
    let push = 0;
    model.cars.forEach((car, c) => {
      push += c === 0 ? 0 : Math.min(sp.carGap + 1.6, (sp.carGap + 2.4) * k * Math.pow(0.8, c - 1));
      car.translateZ(push * 0.9);
      const side = c % 2 ? 1 : -1;
      car.translateX(side * 0.35 * k * Math.min(c, 3) * 0.6);
      car.rotateY(side * 0.07 * k * Math.min(c, 3));
      car.rotateZ(side * 0.04 * k * (c > 0 ? 1 : 0.3));
      if (c === 0) { car.rotateX(-0.05 * k); car.scale.z = 1 - 0.12 * k; car.translateY(0.25 * k); }
    });
    const b = g.mainWorld.buffers?.find((x) => x.route === g.route.dir);
    if (b && this.impact.type === 'buffer') {
      b.group.position.copy(b.base).addScaledVector(b.fwd, 1.4 * k);
      b.group.rotation.copy(b.rot); b.group.rotateX(0.5 * k);
    }
    if (this.impact.aiModel) {
      const ai = this.impact.aiModel;
      const last = ai.cars.at(-1);
      last.rotateY(0.05 * k); last.translateZ(0.8 * k);
    }
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    const t = this.t;
    const flash = this.el.querySelector('.crash-flash');
    if (t < CAB_TIME) {
      // Impact as seen from where the player was.
      flash.style.opacity = Math.max(0, 0.9 - t * 2.2);
      if (this.cabStart) this.el.querySelector('.crash-cracks').style.opacity = Math.min(1, t * 20);
      const decay = Math.max(0, 1 - t / CAB_TIME);
      g.cabin.light.intensity = Math.random() < 0.5 ? 2 : 0;
      g.headlight.intensity = Math.random() < 0.4 * decay ? 60 : 0;
      this.poseTrain(this.impact.front, Math.min(1, t * 6));
      g.cameraSys.update({ car0: g.playerModel.cars[0], eye: g.cabin.eye, route: g.route, front: this.impact.front, v: 0, accel: -9 * decay, jerk: 3 * decay, geom: g.geom, world: g.world, dt, time: g.time + t, scene: g.scene, padLook: null, bump: (Math.random() - 0.5) * 0.18 * decay * this.k });
      g.camera.rotation.z += (Math.random() - 0.5) * 0.06 * decay;
      return;
    }
    if (t >= CAB_TIME && !this.replayStarted) {
      this.replayStarted = true;
      this.el.classList.add('replay');
      this.el.querySelector('.crash-cracks').style.opacity = 0;
      if (g.camera.parent !== g.scene) g.scene.add(g.camera);
      g.playerModel.setCabExteriorVisible(true);
      g.playerModel.cars.forEach((c) => c.scale.set(1, 1, 1));
      g.headlight.intensity = 80;
      g.audio.setAlarm(null);
    }
    // Slow-motion replay.
    const rt = (t - CAB_TIME) * SLOW;               // replay seconds
    const approach = this.replayDist / Math.max(0.5, this.impact.speed);
    const front = this.impact.front - Math.max(0, this.replayDist - rt * this.impact.speed);
    const sinceContact = rt - approach;
    if (sinceContact >= 0 && this.contactT == null) {
      this.contactT = t;
      const p = g.route.point(this.impact.front + 0.4, 0, 1.0, {});
      this.origin = new THREE.Vector3(p.x, p.y, p.z);
      g.audio.crash(this.k, true);
      this.emitDebris(this.origin);
      this.fire = new THREE.PointLight(0xffa040, 120 * this.k, 30, 1.6);
      this.fire.position.copy(this.origin);
      g.scene.add(this.fire);
      flash.style.opacity = 0.35;
    }
    const deform = sinceContact < 0 ? 0 : Math.min(1, sinceContact / 0.35);
    this.poseTrain(front, deform);
    if (this.origin) {
      flash.style.opacity = Math.max(0, parseFloat(flash.style.opacity || 0) - dt * 1.5);
      if (sinceContact < 0.6) this.emitSparks(this.origin, Math.round(30 * this.k), 2.4);
      if (sinceContact > 0.3) g.headlight.intensity = Math.random() < 0.15 ? 40 : 0;
    }
    this.stepParticles(dt * SLOW);
    // Camera: across the tracks, dollying along the train towards the impact point.
    const route = g.route, u = clamp((t - CAB_TIME) / 6, 0, 1);
    const along = this.impact.front - 34 + u * 14;
    const tr = route.toTrack(along);
    const env = g.world.envelope(tr);
    const lat0 = route.trackLateral(along);
    const lat = clamp(lat0 - route.sign * 3.6, -env.maxLat, env.maxLat);
    const h = Math.min(1.4 + u * 1.2, env.ceil(lat) - 0.2);
    g.geom.point(tr, lat, h, this.tmp);
    g.camera.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    route.point(this.impact.front - 4 - u * 6, 0, 1.5, this.tmp);
    g.camera.lookAt(this.tmp.x, this.tmp.y, this.tmp.z);
    g.camera.fov = 58; g.camera.updateProjectionMatrix();
    if (this.fire) this.fire.intensity *= Math.exp(-dt * SLOW * 2.2);
    if (t > CAB_TIME + 6.5 && !this.done) { this.done = true; this.finish(); }
  }

  stepParticles(dt) {
    const s = this.sparks, pos = s.geo.attributes.position.array, col = s.geo.attributes.color.array;
    for (let j = 0; j < s.n; j++) {
      if (s.life[j] <= 0) { col[j * 3] = col[j * 3 + 1] = col[j * 3 + 2] = 0; continue; }
      s.life[j] -= dt;
      s.v[j * 3 + 1] -= 9.8 * dt;
      pos[j * 3] += s.v[j * 3] * dt; pos[j * 3 + 1] += s.v[j * 3 + 1] * dt; pos[j * 3 + 2] += s.v[j * 3 + 2] * dt;
      const f = Math.max(0, Math.min(1, s.life[j]));
      col[j * 3 + 1] *= 0.995; col[j * 3 + 2] *= 0.98; col[j * 3] = f;
    }
    s.geo.attributes.position.needsUpdate = true; s.geo.attributes.color.needsUpdate = true;
    for (const d of this.debris) {
      d.v.y -= 9.8 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.m.position.y < d.floor) { d.m.position.y = d.floor; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
    }
    for (const d of this.dust) {
      d.age += dt;
      if (d.age < 0) continue;
      d.sp.position.addScaledVector(d.v, dt);
      d.sp.scale.setScalar(1 + d.age * d.grow);
      d.sp.material.opacity = Math.max(0, Math.min(0.7, d.age * 3) * (1 - d.age / 4));
    }
  }

  dispose() {
    this.el.remove();
    const sc = this.g.scene;
    if (!sc) return;
    sc.remove(this.sparks.pts);
    if (this.fire) sc.remove(this.fire);
    for (const d of this.debris) sc.remove(d.m);
    for (const d of this.dust) sc.remove(d.sp);
  }
}
