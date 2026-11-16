// Sweeps a 2D cross-section profile along the track alignment to build tunnels, rails, cables…
import * as THREE from 'three';

const tmp = { x: 0, y: 0, z: 0 };

/**
 * @param geom TrackGeometry
 * @param profileFn (s) => [[lateral, height], ...]   lateral + = right in direction A
 * @returns BufferGeometry positioned relative to `origin`
 */
export function sweep(geom, s0, s1, step, profileFn, { vScale = 0.25, uScale = 0.25, origin }) {
  const ss = [];
  for (let s = s0; s < s1 - 0.01; s += step) ss.push(s);
  ss.push(s1);
  const m = profileFn(s0).length;
  const pos = new Float32Array(ss.length * m * 3);
  const uv = new Float32Array(ss.length * m * 2);
  let p = 0, q = 0;
  for (const s of ss) {
    const prof = profileFn(s);
    let u = 0;
    for (let j = 0; j < m; j++) {
      if (j > 0) u += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
      geom.point(s, prof[j][0], prof[j][1], tmp);
      pos[p++] = tmp.x - origin.x; pos[p++] = tmp.y - origin.y; pos[p++] = tmp.z - origin.z;
      uv[q++] = u * uScale; uv[q++] = s * vScale;
    }
  }
  const idx = [];
  for (let i = 0; i < ss.length - 1; i++) for (let j = 0; j < m - 1; j++) {
    const a = i * m + j, b = a + m, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Straight extrusion of a profile in local XY along local Z (station interiors). */
export function extrude(profile, z0, z1, { uScale = 0.25, vScale = 0.25 } = {}) {
  const m = profile.length;
  const pos = new Float32Array(m * 2 * 3), uv = new Float32Array(m * 2 * 2);
  let u = 0;
  for (let j = 0; j < m; j++) {
    if (j > 0) u += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    pos.set([profile[j][0], profile[j][1], z0], j * 3);
    pos.set([profile[j][0], profile[j][1], z1], (m + j) * 3);
    uv.set([u * uScale, z0 * vScale], j * 2);
    uv.set([u * uScale, z1 * vScale], (m + j) * 2);
  }
  const idx = [];
  for (let j = 0; j < m - 1; j++) { const a = j, b = j + m, c = b + 1, d = a + 1; idx.push(a, d, b, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const ARCH_SPRING = 2.8, ARCH_RISE = 2.4, BOX_HEIGHT = 4.5, FLOOR_Y = -0.45;

/** Tunnel lining cross-section (walls + roof), lateral + = right. */
export function tunnelProfile(hw, type) {
  const pts = [[-hw, FLOOR_Y], [-hw, 1.0], [-hw, ARCH_SPRING]];
  if (type === 'box') {
    pts.push([-hw, BOX_HEIGHT - 0.3], [-hw + 0.3, BOX_HEIGHT], [hw - 0.3, BOX_HEIGHT], [hw, BOX_HEIGHT - 0.3]);
  } else {
    for (let k = 1; k < 14; k++) { const a = Math.PI - (k / 14) * Math.PI; pts.push([hw * Math.cos(a), ARCH_SPRING + ARCH_RISE * Math.sin(a)]); }
  }
  pts.push([hw, ARCH_SPRING], [hw, 1.0], [hw, FLOOR_Y]);
  return pts;
}
export const tunnelCrown = (type) => (type === 'box' ? BOX_HEIGHT : ARCH_SPRING + ARCH_RISE);
