// The imported TGV Duplex model ("tgv inoui" by yuimpou, Sketchfab, CC-BY-4.0): decoded once from the compact
// data written by tools/import-tgv-model.mjs into one merged geometry per material for each car type, then shared
// by every train (instances only add meshes).
import * as THREE from 'three';
import { HEADER, DATA } from '../data/models/tgv-duplex-model.js';

let cache = null;
/**
 * The model's windscreen (power-car frame, metres): bottom edge at 2.86 m, 8.46 m forward on the centreline, top edge
 * at 3.41 m, 7.76 m; it curves back 0.35 m towards its sides (half-width 1.04 m at the bottom, 1.0 m at the top).
 * point(s, v): s across −1..1, v 0 (bottom) .. 1 (top), pushed `out` metres outwards along the glass normal.
 */
export const MODEL_WINDSCREEN = {
  point(s, v, out = 0, P = {}) {
    const hw = 1.04 - 0.04 * v, x = s * hw, y = 2.86 + 0.55 * v, zc = 8.46 - 0.7 * v, z = zc - 0.35 * s * s;
    // Normal of the inclined glass (≈ 52° from vertical), pointing forward/up.
    P.x = x; P.y = y + out * 0.62; P.z = z + out * 0.79;
    return P;
  },
};
export const TGV_MODEL_CREDIT = '"tgv inoui" by yuimpou (sketchfab.com/yuimpou), CC-BY-4.0';

function decode() {
  const bin = Uint8Array.from(atob(DATA), (c) => c.charCodeAt(0)).buffer;
  const types = {}, mats = new Map();
  const material = (g) => {
    const key = `${g.name}|${g.color.join(',')}|${g.alpha}`;
    if (mats.has(key)) return mats.get(key);
    const [r, gg, b, a] = g.color, glass = g.alpha === 'BLEND';
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, gg, b), roughness: glass ? 0.08 : 0.42, metalness: glass ? 0.3 : 0.12,
      transparent: glass, opacity: glass ? Math.min(0.75, a) : 1, depthWrite: !glass, side: THREE.DoubleSide,
    });
    m.userData.opacity = m.opacity; m.userData.glass = glass;
    mats.set(key, m); return m;
  };
  let front = 0, lampY = 1.93, lampX = 0.7;   // head-lamp lenses on the nose (measured on the model)
  for (const g of HEADER.groups) {
    const q = new Int16Array(bin, g.pos, g.n * 3), nq = new Int8Array(bin, g.nrm, g.n * 3);
    const pos = new Float32Array(g.n * 3), nrm = new Float32Array(g.n * 3);
    for (let i = 0; i < g.n * 3; i++) { pos[i] = (q[i] / 32767) * (i % 3 === 2 ? 16 : 8); nrm[i] = nq[i] / 127; }
    const idx = g.i32 ? new Uint32Array(bin, g.idx, g.tris * 3) : new Uint16Array(bin, g.idx, g.tris * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.computeBoundingSphere();
    (types[g.type] ||= []).push({ geo, mat: material(g), name: g.name });
    if (g.type === 'power') for (let i = 0; i < g.n; i++) front = Math.max(front, pos[i * 3 + 2]);
  }
  return { types, front, lamps: { x: lampX, y: lampY, z: 10.35 }, windscreen: MODEL_WINDSCREEN };
}

export function tgvModel() {
  if (!cache) {
    cache = decode();
    cache.instance = (type) => {
      const grp = new THREE.Group(); grp.name = `tgv-${type}`;
      grp.userData.glass = [];
      for (const part of cache.types[type]) {
        // Glass gets its own material per instance (the cab's windscreen turns clear from the inside).
        const mat = part.mat.userData.glass ? part.mat.clone() : part.mat;
        if (mat !== part.mat) mat.userData = { ...part.mat.userData };
        const m = new THREE.Mesh(part.geo, mat); m.castShadow = false;
        if (mat.userData.glass) { m.renderOrder = 3; grp.userData.glass.push(m); }
        grp.add(m);
      }
      return grp;
    };
  }
  return cache;
}
