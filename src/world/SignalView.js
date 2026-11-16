// 3D lineside signal heads driven by the SignalSystem aspects.
import * as THREE from 'three';
import { Textures } from './Textures.js';

const ON = { red: 0xff2a1a, yellow: 0xffb300, green: 0x19ff6a };
const OFF = 0x1a1a1a;

export class SignalView {
  constructor(scene, signalSystem, route, geom) {
    this.group = new THREE.Group();
    this.sys = signalSystem;
    this.items = [];
    scene.add(this.group);
    this.scene = scene;
    const headGeo = new THREE.BoxGeometry(0.34, 0.95, 0.22);
    const lampGeo = new THREE.CircleGeometry(0.085, 16);
    const hoodGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.14, 12, 1, true, 0, Math.PI);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x151515 });
    const postMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const glowTex = glowTexture();
    for (const s of signalSystem.signals) {
      if (s.kind === 'end' && signalSystem.system === 'cbtc') { /* still shown: permanent stop */ }
      const zone = geom.stationZoneAt(route.toTrack(s.r));
      const side = zone && geom.line.stations[zone.index].platformType === 'side' ? -1.55 : 1.75;
      const p = route.point(s.r, side, 2.1);
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = -geom.heading(route.toTrack(s.r)) + (route.sign < 0 ? Math.PI : 0);
      g.add(new THREE.Mesh(headGeo, bodyMat));
      const lamps = {};
      ['green', 'yellow', 'red'].forEach((c, i) => {
        const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: OFF }));
        m.position.set(0, 0.28 - i * 0.28, 0.112);
        g.add(m);
        const hood = new THREE.Mesh(hoodGeo, bodyMat);
        hood.rotation.x = Math.PI / 2; hood.rotation.y = Math.PI; hood.position.set(0, m.position.y + 0.04, 0.18);
        g.add(hood);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: ON[c], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        glow.scale.set(0.9, 0.9, 1);
        glow.position.copy(m.position).z += 0.05;
        g.add(glow);
        lamps[c] = { m, glow };
      });
      const len = 2.1 + 0.45 - 0.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len), postMat);
      post.position.y = -0.48 - len / 2;
      g.add(post);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), new THREE.MeshBasicMaterial({ map: Textures.label(s.number, { w: 128, h: 64, bg: '#ffffff', fg: '#000', font: 'bold 34px Arial', radius: 4 }) }));
      plate.position.set(0, -0.6, 0.112);
      g.add(plate);
      this.group.add(g);
      this.items.push({ s, lamps, aspect: null });
    }
  }
  update(time) {
    for (const it of this.items) {
      if (it.aspect === it.s.aspect) continue;
      it.aspect = it.s.aspect;
      for (const [c, l] of Object.entries(it.lamps)) {
        const on = c === it.aspect;
        l.m.material.color.setHex(on ? ON[c] : OFF);
        l.glow.material.opacity = on ? 0.9 : 0;
      }
    }
  }
  dispose() { this.scene.remove(this.group); }
}

let glowCache;
export function glowTexture() {
  if (glowCache) return glowCache;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  glowCache = new THREE.CanvasTexture(c);
  return glowCache;
}
