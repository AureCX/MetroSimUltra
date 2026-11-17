// Procedural city around the open-air sections of a line: a street grid (asphalt, sidewalks,
// crossings) laid as ground tiles that leave the railway corridor open, perimeter blocks of
// buildings (merged per material for few draw calls), towers, parks, street trees and lamps,
// parked cars and moving traffic, fields beyond the city edge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, hashString } from '../core/util.js';

export const BLOCK = 104;      // grid period: 14 m street + 90 m block
const STREET = 14, WALK = 3;
const TILE = 26;

function tex(w, h, draw, aniso = 8) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  return t;
}

let T;
export function cityTextures() {
  if (T) return T;
  const r = seededRandom(1234);
  const px = 1024 / BLOCK; // pixels per metre
  const ground = tex(1024, 1024, (g) => {
    // block interior: light paving
    g.fillStyle = '#b7b2a8'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 * r()})`; g.fillRect(r() * 1024, r() * 1024, 2, 2); }
    // sidewalks
    g.fillStyle = '#cfcac0';
    g.fillRect(0, 0, 1024, (STREET + WALK) * px); g.fillRect(0, 0, (STREET + WALK) * px, 1024);
    g.fillRect(0, 1024 - WALK * px, 1024, WALK * px); g.fillRect(1024 - WALK * px, 0, WALK * px, 1024);
    // streets
    g.fillStyle = '#3c3d40';
    g.fillRect(0, 0, 1024, STREET * px); g.fillRect(0, 0, STREET * px, 1024);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${0.04 * r()})`; const x = r() * 1024; g.fillRect(x < STREET * px ? x : r() * 1024, r() * STREET * px, 1, 1); }
    // kerbs
    g.fillStyle = '#e7e3da'; g.fillRect(0, STREET * px, 1024, 3); g.fillRect(STREET * px, 0, 3, 1024);
    // lane markings (dashed centre lines)
    g.fillStyle = '#f0ede2';
    for (let x = STREET * px + 40; x < 1024; x += 60) g.fillRect(x, (STREET / 2) * px - 2, 30, 4);
    for (let y = STREET * px + 40; y < 1024; y += 60) g.fillRect((STREET / 2) * px - 2, y, 4, 30);
    // zebra crossings next to the intersection
    for (let k = 0; k < 7; k++) {
      g.fillRect(STREET * px + 10, 8 + k * 19, 34, 10);
      g.fillRect(8 + k * 19, STREET * px + 10, 10, 34);
    }
    // intersection box
    g.fillStyle = '#3c3d40'; g.fillRect(0, 0, STREET * px, STREET * px);
  });
  const fields = tex(256, 256, (g) => {
    g.fillStyle = '#6f8a48'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6; i++) { g.fillStyle = ['#7f9a52', '#8c9a5a', '#5f7a3c', '#a59a5c'][i % 4]; g.fillRect(0, i * 43, 256, 40); }
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${0.05 * r()})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  });
  const facade = (wall, glass, opts = {}) => tex(256, 256, (g) => {
    g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${0.04 * r()})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
    const cols = opts.cols || 4, rows = opts.rows || 4;
    const cw = 256 / cols, rh = 256 / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const lit = r() < (opts.lit ?? 0.12);
      const wx = x * cw + cw * (opts.inset ?? 0.22), wy = y * rh + rh * 0.2, ww = cw * (1 - 2 * (opts.inset ?? 0.22)), wh = rh * (opts.tall ?? 0.6);
      g.fillStyle = lit ? '#f1d58f' : glass;
      if (opts.arched) { g.beginPath(); g.moveTo(wx, wy + wh); g.lineTo(wx, wy + ww / 2); g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); g.lineTo(wx + ww, wy + wh); g.closePath(); g.fill(); }
      else g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(wx, wy, ww, 3);
      if (opts.balcony && y % 2 === 0) { g.fillStyle = '#2b2b2b'; g.fillRect(wx - 3, wy + wh, ww + 6, 4); }
      if (opts.sill) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(wx - 2, wy + wh, ww + 4, 3); }
    }
    if (opts.bands) { g.fillStyle = opts.bands; for (let y = 0; y < rows; y++) g.fillRect(0, y * rh + rh - 6, 256, 6); }
  });
  const curtain = (tint) => tex(256, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 256, 256); grd.addColorStop(0, tint); grd.addColorStop(1, '#9fb8cc');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(30,40,50,0.8)'; g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
    for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    for (let i = 0; i < 20; i++) { g.fillStyle = `rgba(255,255,255,${0.15 * r()})`; g.fillRect(Math.floor(r() * 8) * 32, Math.floor(r() * 4) * 64, 32, 64); }
  });
  T = {
    ground, fields, curtain: curtain('#4f6d86'),
    facades: [
      facade('#e2d6bf', '#3b4654', { arched: false, balcony: true, sill: true, tall: 0.62 }),   // Haussmann-like stone
      facade('#d9c9a8', '#34404c', { arched: true, sill: true }),
      facade('#a65a45', '#2a3038', { inset: 0.25, sill: true }),                               // brick
      facade('#c8ccd0', '#27323d', { cols: 3, inset: 0.12, tall: 0.7, bands: '#a8adb3' }),     // concrete offices
      facade('#efece6', '#3f5568', { cols: 5, inset: 0.15, tall: 0.55 }),                      // white render
      facade('#9aa29c', '#202a30', { cols: 4, inset: 0.1, tall: 0.75, lit: 0.2 }),             // modern grey
    ],
  };
  return T;
}

/** Box with metric UVs (one texture tile = `tile` metres) and a darker roof via vertex colours. */
export function boxGeo(w, h, d, x, y, z, rotY = 0, tile = 4, roofShade = 0.45) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const col = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    let su = 1, sv = 1, c = 1;
    if (face === 0 || face === 1) { su = d / tile; sv = h / tile; }
    else if (face === 4 || face === 5) { su = w / tile; sv = h / tile; }
    else { c = roofShade; uv.setXY(i, 0.02, 0.02); col.set([c, c, c], i * 3); continue; }
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    col.set([c, c, c], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (rotY) geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

export class City {
  constructor(outdoor, runs, landmarks) {
    this.o = outdoor; this.geom = outdoor.geom; this.line = outdoor.line;
    this.group = new THREE.Group(); this.group.name = 'city';
    outdoor.group.add(this.group);
    this.landmarks = landmarks;
    const g = this.geom;
    this.G = g.groundAt(runs[0][0] + 1);
    // Outdoor track samples, bucketed for distance queries.
    this.buckets = new Map();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [a, b] of runs) for (let s = a; s <= b; s += 5) {
      const p = g.point(s);
      const k = `${Math.floor(p.x / 40)},${Math.floor(p.z / 40)}`;
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(p.x, p.z);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    for (const lm of landmarks) { minX = Math.min(minX, lm.x); maxX = Math.max(maxX, lm.x); minZ = Math.min(minZ, lm.z); maxZ = Math.max(maxZ, lm.z); }
    const M = 380;
    this.ox = Math.floor((minX - M) / BLOCK) * BLOCK; this.oz = Math.floor((minZ - M) / BLOCK) * BLOCK;
    this.ex = Math.ceil((maxX + M) / BLOCK) * BLOCK; this.ez = Math.ceil((maxZ + M) / BLOCK) * BLOCK;
    this.center = new THREE.Vector2((minX + maxX) / 2, (minZ + maxZ) / 2);
    this.rand = seededRandom(hashString(`city${this.line.id}`));
    this.tex = cityTextures();
    this.mats = {
      ground: new THREE.MeshLambertMaterial({ map: this.tex.ground, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      fields: new THREE.MeshLambertMaterial({ map: this.tex.fields }),
      facades: this.tex.facades.map((t) => new THREE.MeshLambertMaterial({ map: t, vertexColors: true })),
      curtain: new THREE.MeshStandardMaterial({ map: this.tex.curtain, vertexColors: true, metalness: 0.5, roughness: 0.25 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
      leaves: new THREE.MeshLambertMaterial({ color: 0x46702f }),
      pole: new THREE.MeshLambertMaterial({ color: 0x2f3236 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d0 }),
      car: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.4 }),
      carGlass: new THREE.MeshStandardMaterial({ color: 0x1a2028, metalness: 0.8, roughness: 0.15 }),
      lawn: new THREE.MeshLambertMaterial({ color: 0x5e8a3a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    };
    this.build();
  }

  distTrack(x, z, maxR = 80) {
    const bx = Math.floor(x / 40), bz = Math.floor(z / 40), n = Math.ceil(maxR / 40);
    let best = Infinity;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const arr = this.buckets.get(`${bx + i},${bz + j}`); if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) { const d = (arr[k] - x) ** 2 + (arr[k + 1] - z) ** 2; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
  inLandmark(x, z, pad = 0) { return this.landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + pad); }

  build() {
    this.buildGround();
    this.buildBlocks();
    this.buildStreets();
  }

  buildGround() {
    const { ox, oz, ex, ez, G } = this;
    const pos = [], uv = [], idx = [];
    for (let x = ox; x < ex; x += TILE) for (let z = oz; z < ez; z += TILE) {
      if (this.distTrack(x + TILE / 2, z + TILE / 2) < 31) continue;
      const v = pos.length / 3;
      for (const [dx, dz] of [[0, 0], [TILE, 0], [TILE, TILE], [0, TILE]]) {
        pos.push(x + dx, G, z + dz); uv.push((x + dx - ox) / BLOCK, -(z + dz - oz) / BLOCK);
      }
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.group.add(new THREE.Mesh(geo, this.mats.ground));
    // Fields beyond the city edge.
    const F = 5000;
    for (const [x0, z0, x1, z1] of [[ox - F, oz - F, ex + F, oz], [ox - F, ez, ex + F, ez + F], [ox - F, oz, ox, ez], [ex, oz, ex + F, ez]]) {
      const w = x1 - x0, d = z1 - z0;
      const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2);
      const u = pg.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * w / 220, u.getY(i) * d / 220);
      const m = new THREE.Mesh(pg, this.mats.fields); m.position.set(x0 + w / 2, G - 0.05, z0 + d / 2);
      this.group.add(m);
    }
  }

  buildBlocks() {
    const r = this.rand, { ox, oz, ex, ez, G } = this;
    const batches = new Map(); // `${chunk}:${mat}` -> geos
    const add = (mi, geo, x, z) => {
      const key = `${Math.floor(x / 800)},${Math.floor(z / 800)}:${mi}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(geo);
    };
    this.parks = [];
    const clear = (x, z, w, d) => {
      for (const [cx, cz] of [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2], [x, z]]) {
        if (this.distTrack(cx, cz) < 24) return false;
      }
      return !this.inLandmark(x, z, Math.max(w, d) / 2 + 6);
    };
    for (let bx = ox; bx < ex; bx += BLOCK) for (let bz = oz; bz < ez; bz += BLOCK) {
      const x0 = bx + STREET + WALK, z0 = bz + STREET + WALK, S = BLOCK - STREET - 2 * WALK; // 84 m
      const cx = x0 + S / 2, cz = z0 + S / 2;
      const distC = Math.hypot(cx - this.center.x, cz - this.center.y);
      if (this.inLandmark(cx, cz, 30)) continue;
      if (r() < 0.08 && this.distTrack(cx, cz) > 50) { this.parks.push([cx, cz, S]); continue; }
      const business = distC < 700 && r() < 0.22;
      if (business && clear(cx, cz, 34, 34)) {
        const h = 60 + r() * 80;
        add('c', boxGeo(34, h, 34, cx, G + h / 2, cz, 0, 4, 0.5), cx, cz);
        add('c', boxGeo(26, 6, 26, cx, G + h + 3, cz, 0, 4, 0.4), cx, cz);
        // low podium around the tower
        const ph = 8 + r() * 4;
        if (clear(cx, cz, S, S)) add(3, boxGeo(S - 4, ph, S - 4, cx, G + ph / 2, cz, 0, 4), cx, cz);
        continue;
      }
      // Perimeter block: buildings along the four sides, courtyard in the middle.
      const style = Math.floor(r() * this.mats.facades.length);
      const baseH = distC < 900 ? 18 + r() * 10 : 10 + r() * 8;
      for (let side = 0; side < 4; side++) {
        const alongX = side < 2;
        const t0 = alongX ? 0 : 18, t1 = alongX ? S : S - 18;   // side streets skip the corners
        let t = t0;
        while (t < t1 - 6) {
          const w = Math.min(t1 - t, 12 + r() * 16), dep = 12 + r() * 5, h = Math.max(8, baseH + (r() - 0.5) * 8);
          const along = t + w / 2;
          const x = alongX ? x0 + along : side === 2 ? x0 + dep / 2 : x0 + S - dep / 2;
          const z = alongX ? (side === 0 ? z0 + dep / 2 : z0 + S - dep / 2) : z0 + along;
          const bw = alongX ? w : dep, bd = alongX ? dep : w;
          if (clear(x, z, bw, bd)) {
            const mi = r() < 0.7 ? style : Math.floor(r() * this.mats.facades.length);
            add(mi, boxGeo(bw - 0.4, h, bd - 0.4, x, G + h / 2, z, 0, mi === 3 ? 3.5 : 4), x, z);
          }
          t += w;
        }
      }
    }
    for (const [key, geos] of batches) {
      const mi = key.split(':')[1];
      const mat = mi === 'c' ? this.mats.curtain : this.mats.facades[Number(mi)];
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      this.group.add(m);
      geos.forEach((g) => g.dispose());
    }
  }

  buildStreets() {
    const r = this.rand, { ox, oz, ex, ez, G } = this;
    const trees = [], lamps = [], parked = [];
    for (let x = ox; x <= ex; x += BLOCK) for (let z = oz; z < ez; z += BLOCK) {
      for (let k = 0; k < 2; k++) {
        // k = 0: street along z (at x), k = 1: street along x (at z)
        for (let t = STREET + 8; t < BLOCK - 2; t += 26) {
          for (const off of [-1.5, STREET + 1.5]) {
            const px = k === 0 ? x + off : x + t, pz = k === 0 ? z + t : z + off;
            if (this.distTrack(px, pz) < 26 || this.inLandmark(px, pz)) continue;
            if (r() < 0.6) trees.push([px, pz, 0.8 + r() * 0.5]); else if (r() < 0.6) lamps.push([px, pz]);
          }
          for (const lane of [STREET * 0.5 - 4.9, STREET * 0.5 + 4.9]) {
            if (r() > 0.25) continue;
            const px = k === 0 ? x + lane : x + t + 3, pz = k === 0 ? z + t + 3 : z + lane;
            if (this.distTrack(px, pz) < 26 || this.inLandmark(px, pz)) continue;
            parked.push([px, pz, k === 0 ? 0 : Math.PI / 2]);
          }
        }
      }
    }
    for (const [cx, cz, S] of this.parks) {
      const lawn = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.mats.lawn); lawn.rotation.x = -Math.PI / 2; lawn.position.set(cx, G + 0.02, cz); this.group.add(lawn);
      for (let i = 0; i < 14; i++) trees.push([cx + (r() - 0.5) * S * 0.9, cz + (r() - 0.5) * S * 0.9, 0.9 + r() * 0.7]);
    }
    this.instTrees(trees);
    this.instLamps(lamps);
    this.cars(parked);
  }

  instTrees(list) {
    if (!list.length) return;
    const G = this.G;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 3, 5, 1, true), this.mats.trunk, list.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.3, 0), this.mats.leaves, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    list.forEach(([x, z, k], i) => {
      m.compose(p.set(x, G + 1.5 * k, z), q.identity(), s.set(k, k, k)); trunk.setMatrixAt(i, m);
      m.compose(p.set(x, G + 4.2 * k, z), q.setFromEuler(new THREE.Euler(0, x, 0)), s.set(k, k * 1.15, k)); crown.setMatrixAt(i, m);
      crown.setColorAt(i, col.setHSL(0.25 + Math.sin(x * 7 + z) * 0.04, 0.45, 0.28 + Math.cos(z * 3) * 0.05));
    });
    trunk.computeBoundingSphere(); crown.computeBoundingSphere();
    this.group.add(trunk, crown);
  }

  instLamps(list) {
    if (!list.length) return;
    const G = this.G;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 6), this.mats.pole, list.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), this.mats.lamp, list.length);
    const m = new THREE.Matrix4();
    list.forEach(([x, z], i) => { m.makeTranslation(x, G + 3, z); poles.setMatrixAt(i, m); m.makeTranslation(x, G + 6.1, z); heads.setMatrixAt(i, m); });
    poles.computeBoundingSphere(); heads.computeBoundingSphere();
    this.group.add(poles, heads);
  }

  /** Parked cars plus moving traffic on the street grid. */
  cars(parked) {
    const r = this.rand, G = this.G;
    const nMove = 70;
    const n = parked.length + nMove;
    const body = new THREE.BoxGeometry(1.8, 0.75, 4.3); body.translate(0, 0.55, 0);
    const cab = new THREE.BoxGeometry(1.6, 0.6, 2.2); cab.translate(0, 1.2, -0.2);
    this.carBody = new THREE.InstancedMesh(body, this.mats.car, n);
    this.carCab = new THREE.InstancedMesh(cab, this.mats.carGlass, n);
    const colors = [0xb8bec4, 0x1d1f22, 0xf2f2f2, 0x8a1c1c, 0x23406e, 0x5f6b72, 0xc9a227, 0x2e5a3a];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) this.carBody.setColorAt(i, c.setHex(colors[Math.floor(r() * colors.length)]));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    parked.forEach(([x, z, yaw], i) => {
      m.compose(p.set(x, G, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), s); this.carBody.setMatrixAt(i, m); this.carCab.setMatrixAt(i, m);
    });
    // Moving cars: each drives along one street line, wrapping at the city edge; hidden where the
    // street passes the railway (as if through an underpass).
    this.moving = [];
    const nx = Math.round((this.ex - this.ox) / BLOCK), nz = Math.round((this.ez - this.oz) / BLOCK);
    for (let i = 0; i < nMove; i++) {
      const alongX = r() < 0.5, dir = r() < 0.5 ? 1 : -1;
      const line = alongX ? this.oz + Math.floor(r() * nz) * BLOCK + STREET / 2 + dir * 1.8 : this.ox + Math.floor(r() * nx) * BLOCK + STREET / 2 - dir * 1.8;
      const min = alongX ? this.ox : this.oz, max = alongX ? this.ex : this.ez;
      this.moving.push({ idx: parked.length + i, alongX, dir, line, min, max, t: min + r() * (max - min), v: 8 + r() * 6 });
    }
    this.carBody.count = n; this.carCab.count = n;
    this.carBody.frustumCulled = false; this.carCab.frustumCulled = false;
    this.group.add(this.carBody, this.carCab);
    this.updateCars(0);
  }

  updateCars(dt) {
    if (!this.moving) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of this.moving) {
      c.t += c.v * c.dir * dt;
      if (c.t > c.max) c.t = c.min; if (c.t < c.min) c.t = c.max;
      const x = c.alongX ? c.t : c.line, z = c.alongX ? c.line : c.t;
      const hide = this.distTrack(x, z, 40) < 22;
      const yaw = c.alongX ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
      m.compose(p.set(x, this.G, z), q.setFromAxisAngle(up, yaw), s.setScalar(hide ? 0 : 1));
      this.carBody.setMatrixAt(c.idx, m); this.carCab.setMatrixAt(c.idx, m);
    }
    this.carBody.instanceMatrix.needsUpdate = true; this.carCab.instanceMatrix.needsUpdate = true;
  }
}
