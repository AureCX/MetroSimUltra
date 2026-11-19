// Cameras: first-person cab (free look, inertial head motion & vibration), exterior chase
// (orbit, constrained to the tunnel) and trackside fly-by.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

export const CAMERA_MODES = ['cab', 'interior', 'chase', 'trackside'];

export class CameraSystem {
  constructor(camera, dom, settings, bus) {
    this.camera = camera; this.dom = dom; this.settings = settings; this.bus = bus;
    this.mode = 'cab';
    this.yaw = 0; this.pitch = -0.12;
    this.orbit = { yaw: 0.2, pitch: 0.12, dist: 16 };
    this.zoom = 1;
    this.shake = new THREE.Vector3();
    this.lean = 0;
    this.dragging = false;
    this.trackside = null;
    this.rig = new THREE.Object3D();
    this.tmp = {};
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => { if (e.button === 2 || e.button === 1) { this.dragging = true; this.last = [e.clientX, e.clientY]; } });
    window.addEventListener('pointerup', (e) => { if (e.button === 2 || e.button === 1) this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const s = 0.0042 * this.settings.get('gameplay.mouseSensitivity');
      const inv = this.settings.get('gameplay.invertY') ? -1 : 1;
      const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1];
      this.last = [e.clientX, e.clientY];
      this.look(-dx * s, -dy * s * inv);
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === 'cab') this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 1.08 : 0.93), 0.45, 1.25);
      else this.orbit.dist = clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 6, 60);
    }, { passive: false });
  }

  look(dYaw, dPitch) {
    if (this.mode === 'cab') {
      this.yaw = clamp(this.yaw + dYaw, -2.6, 2.6);
      this.pitch = clamp(this.pitch + dPitch, -1.1, 0.8);
    } else {
      this.orbit.yaw += dYaw;
      this.orbit.pitch = clamp(this.orbit.pitch + dPitch, -0.3, 1.2);
    }
  }
  resetView() { this.yaw = 0; this.pitch = -0.12; this.zoom = 1; this.orbit = { yaw: 0.2, pitch: 0.12, dist: 16 }; }

  cycle() {
    const i = (CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length;
    this.setMode(CAMERA_MODES[i]);
  }
  setMode(m) {
    this.mode = m;
    this.trackside = null;
    this.bus.emit('camera:mode', m);
  }

  /** ctx: { car0, eye (local Vector3), route, front, v, accel, jerk, geom, dt, time, padLook } */
  update(ctx) {
    const cam = this.camera, dt = ctx.dt;
    const base = this.settings.get('graphics.fov');
    if (ctx.padLook) this.look(-ctx.padLook.x * dt * 2.2, -ctx.padLook.y * dt * 1.6);
    if (this.mode === 'cab') {
      cam.fov = base * this.zoom;
      cam.updateProjectionMatrix();
      if (cam.parent !== ctx.car0) ctx.car0.add(cam);
      // Head inertia: lean against acceleration, plus speed & track induced vibration.
      const k = this.settings.get('graphics.cameraShake');
      this.lean += (clamp(-ctx.accel * 0.035, -0.06, 0.06) - this.lean) * Math.min(1, dt * 3);
      const v = Math.abs(ctx.v);
      const amp = k * (0.0015 + Math.min(v, 22) * 0.00018 + Math.min(Math.abs(ctx.jerk), 3) * 0.0012);
      const t = ctx.time;
      this.shake.set(
        Math.sin(t * 13.1) * amp * 0.6 + Math.sin(t * 27.3) * amp * 0.3,
        Math.sin(t * 17.7) * amp + Math.sin(t * 41.9) * amp * 0.4 + (ctx.bump || 0) * k,
        0,
      );
      cam.position.copy(ctx.eye).add(this.shake);
      cam.position.z += this.lean;
      cam.rotation.set(this.pitch - this.lean * 0.4, Math.PI + this.yaw, Math.sin(t * 9.3) * amp * 0.5, 'YXZ');
      return;
    }
    if (this.mode === 'interior' && ctx.carInterior) {
      // Passenger's view: standing near the rear of the saloon, looking along the car.
      cam.fov = base * 1.05; cam.updateProjectionMatrix();
      if (cam.parent !== ctx.carInterior) ctx.carInterior.add(cam);
      cam.position.set(0.55, (ctx.floor ?? 1) + 1.62, -ctx.carLength / 2 + 1.6);
      cam.rotation.set(this.pitch * 0.6, Math.PI + this.yaw, 0, 'YXZ');
      return;
    }
    if (cam.parent !== null && cam.parent !== ctx.scene) ctx.scene.add(cam);
    cam.fov = base; cam.updateProjectionMatrix();
    const { route, front, geom } = ctx;
    if (this.mode === 'chase') {
      const o = this.orbit;
      const along = front - 6 + Math.cos(o.yaw) * o.dist * Math.cos(o.pitch);
      const tr = route.toTrack(along);
      const env = ctx.world.envelope(tr);
      const lat0 = route.trackLateral(along);
      let lat = Math.sin(o.yaw) * o.dist * Math.cos(o.pitch) * route.sign + lat0;
      lat = clamp(lat, -env.maxLat, env.maxLat);
      const h = clamp(1.8 + Math.sin(o.pitch) * o.dist, 0.8, Math.max(1.2, env.ceil(lat)));
      geom.point(tr, lat, h, this.tmp);
      cam.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      route.point(front - 6, 0, 1.9, this.tmp);
      cam.lookAt(this.tmp.x, this.tmp.y, this.tmp.z);
    } else {
      if (!this.trackside || front > this.trackside.r + 25) {
        const r = Math.min(route.length - 20, front + 90 + Math.random() * 60);
        const tr = route.toTrack(r);
        const z = geom.stationZoneAt(tr);
        const side = z ? (geom.line.stations[z.index].platformType === 'side' ? 3.6 : -1.9) : 1.9;
        this.trackside = { r, side };
      }
      route.point(this.trackside.r, this.trackside.side, 1.6, this.tmp);
      cam.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
      route.point(front - 10, 0, 1.8, this.tmp);
      cam.lookAt(this.tmp.x, this.tmp.y, this.tmp.z);
    }
  }
}
