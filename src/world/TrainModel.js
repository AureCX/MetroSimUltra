// Visual train: articulated cars placed on the track by bogie positions, sliding doors,
// head/tail lights and destination displays. Shared by the player train and AI traffic.
import * as THREE from 'three';
import { Textures, shade } from './Textures.js';
import { glowTexture } from './SignalView.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FLOOR = 1.0;
const geoCache = new Map();

// Car body built as a real shell (no longer a solid block): hollow roof, floor slab, end caps and side
// panels with door openings and glazed window bands, so open doors and windows show the saloon behind.
const WIN_Y0 = 1.925, WIN_Y1 = 2.775, SIDE_TOP = 2.95;
function outline(W) {
  const s = new THREE.Shape(), h = W / 2;
  s.moveTo(-h + 0.08, 0.82); s.lineTo(h - 0.08, 0.82); s.lineTo(h, 1.0);
  s.lineTo(h, 2.95); s.quadraticCurveTo(h, 3.55, h - 0.5, 3.58);
  s.lineTo(-h + 0.5, 3.58); s.quadraticCurveTo(-h, 3.55, -h, 2.95); s.lineTo(-h, 1.0); s.closePath();
  return s;
}
function shellGeometry(specs) {
  const W = specs.width, L = specs.carLength, dps = specs.doorsPerSide, dw = specs.doorWidth;
  const key = `shell|${W}|${L}|${dps}|${dw}|${specs.doorZ}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const h = W / 2;
  // Hollow roof: outer arc, inner arc 8 cm inside.
  const r = new THREE.Shape();
  r.moveTo(h, SIDE_TOP); r.quadraticCurveTo(h, 3.55, h - 0.5, 3.58); r.lineTo(-h + 0.5, 3.58); r.quadraticCurveTo(-h, 3.55, -h, SIDE_TOP);
  r.lineTo(-h + 0.08, SIDE_TOP); r.quadraticCurveTo(-h + 0.08, 3.47, -h + 0.5, 3.5); r.lineTo(h - 0.5, 3.5); r.quadraticCurveTo(h - 0.08, 3.47, h - 0.08, SIDE_TOP); r.closePath();
  const roof = new THREE.ExtrudeGeometry(r, { depth: L, bevelEnabled: false, steps: 1 }); roof.translate(0, 0, -L / 2);
  // Floor slab with the sloped skirt.
  const f = new THREE.Shape();
  f.moveTo(-h + 0.08, 0.82); f.lineTo(h - 0.08, 0.82); f.lineTo(h, 1.0); f.lineTo(-h, 1.0); f.closePath();
  const floor = new THREE.ExtrudeGeometry(f, { depth: L, bevelEnabled: false, steps: 1 }); floor.translate(0, 0, -L / 2);
  // End caps (the gangway / cab front sits in front of them).
  const [endF, endB] = [L / 2, -L / 2].map((z) => { const g = new THREE.ShapeGeometry(outline(W)); g.translate(0, 0, z); return g; });
  // Side panels.
  const doorZ = specs.doorZ;
  const spans = []; let cur = -L / 2;
  for (const z of [...doorZ].sort((x, y) => x - y)) { if (z - dw / 2 > cur) spans.push([cur, z - dw / 2]); cur = z + dw / 2; }
  if (cur < L / 2) spans.push([cur, L / 2]);
  const panels = [], glass = [], stripe = [];
  const rect = (list, side, z0, z1, y0, y1, out = 0) => {
    if (z1 - z0 < 0.01 || y1 - y0 < 0.01) return;
    const g = new THREE.PlaneGeometry(z1 - z0, y1 - y0); g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(side * (h + out), (y0 + y1) / 2, (z0 + z1) / 2); list.push(g);
  };
  for (const side of [1, -1]) for (const [a, b] of spans) {
    rect(panels, side, a, b, 1.0, WIN_Y0); rect(panels, side, a, b, WIN_Y1, SIDE_TOP);
    const p = 0.35;
    if (b - a > 2 * p + 0.3) { rect(panels, side, a, a + p, WIN_Y0, WIN_Y1); rect(panels, side, b - p, b, WIN_Y0, WIN_Y1); rect(glass, side, a + p, b - p, WIN_Y0, WIN_Y1, 0.002); }
    else rect(panels, side, a, b, WIN_Y0, WIN_Y1);
    rect(stripe, side, a, b, 1.17, 1.33, 0.004);
  }
  const res = { roof, floor, endF, endB, panels: mergeGeometries(panels), glass: mergeGeometries(glass), stripe: mergeGeometries(stripe), doorZ };
  geoCache.set(key, res);
  return res;
}

/** Interior geometry of one car, merged per material: { parts: {material: geometry}, displays: [...] }. */
function interiorGeometry(sp, cabFront, cabBack, seating = null) {
  const key = `int|${sp.width}|${sp.carLength}|${sp.doorsPerSide}|${sp.doorWidth}|${sp.doorZ}|${cabFront}|${cabBack}|${seating}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const W = sp.width, L = sp.carLength, dps = sp.doorsPerSide, dw = sp.doorWidth;
  const parts = { floor: [], wall: [], ceiling: [], light: [], seat: [], pole: [], dark: [], first: [], second: [], carpet: [] }, displays = [];
  const plane = (k, w, h, x, y, z, rx, ry) => { const g = new THREE.PlaneGeometry(w, h); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); parts[k].push(g); };
  const box = (k, w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts[k].push(g.toNonIndexed()); };
  const y0 = FLOOR + 0.02, yc = 3.22, xi = W / 2 - 0.07;
  const doorZ = sp.doorZ;
  // Behind the drivers' cabs (the cab interior is 2.35 m deep), but never across the first doorway.
  const cabDepth = Math.min(2.4, L / 2 - (Math.max(...doorZ) + dw / 2) - 0.05);
  const zFront = cabFront ? L / 2 - cabDepth : L / 2 - 0.08, zBack = cabBack ? -L / 2 + cabDepth : -L / 2 + 0.08;
  const len = zFront - zBack, zm = (zFront + zBack) / 2;
  plane('floor', W - 0.14, len, 0, y0, zm, -Math.PI / 2, 0);
  plane('ceiling', W - 0.14, len, 0, yc, zm, Math.PI / 2, 0);
  for (const sx of [-0.45, 0.45]) plane('light', 0.16, len - 0.4, sx, yc - 0.01, zm, Math.PI / 2, 0);
  const spans = []; let cur = zBack;
  for (const z of [...doorZ].sort((a, b) => a - b)) { if (z - dw / 2 > cur) spans.push([cur, Math.min(zFront, z - dw / 2)]); cur = Math.max(cur, z + dw / 2); }
  if (cur < zFront) spans.push([cur, zFront]);
  for (const side of [-1, 1]) for (const [a, b] of spans) {
    if (b - a < 0.05) continue;
    const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    plane('wall', b - a, WIN_Y0 - 0.005 - y0, side * xi, (WIN_Y0 - 0.005 + y0) / 2, (a + b) / 2, 0, ry);
    plane('wall', b - a, yc - (WIN_Y1 + 0.005), side * xi, (yc + WIN_Y1 + 0.005) / 2, (a + b) / 2, 0, ry);
    if (b - a > 1.2 && !seating) { box('seat', 0.48, 0.1, b - a - 0.4, side * (W / 2 - 0.34), FLOOR + 0.46, (a + b) / 2); box('seat', 0.08, 0.45, b - a - 0.4, side * (W / 2 - 0.12), FLOOR + 0.72, (a + b) / 2); }
  }
  for (const z of doorZ) {
    if (z > zFront || z < zBack) continue;
    for (const side of [-1, 1]) {
      const ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      plane('wall', dw, yc - (FLOOR + 1.98), side * xi, (yc + FLOOR + 1.98) / 2, z, 0, ry);
      displays.push({ w: dw - 0.1, h: ((dw - 0.1) * 160) / 768, x: side * (xi - 0.02), y: yc - 0.2, z, ry });
    }
    for (const dz of [-0.55, 0.55]) { const g = new THREE.CylinderGeometry(0.02, 0.02, yc - y0, 8); g.translate(0, (yc + y0) / 2, z + dz); parts.pole.push(g.toNonIndexed()); }
  }
  for (const [z, dir, cab] of [[zFront, -1, cabFront], [zBack, 1, cabBack]]) {
    const open = cab ? 0 : 1.2, sideW = (W - 0.14 - open) / 2;
    for (const sx of [-1, 1]) plane(cab ? 'dark' : 'wall', sideW, yc - y0, sx * (open / 2 + sideW / 2), (yc + y0) / 2, z, 0, dir > 0 ? 0 : Math.PI);
    if (!cab) plane('wall', open, yc - (FLOOR + 2.2), 0, (yc + FLOOR + 2.2) / 2, z, 0, dir > 0 ? 0 : Math.PI);
  }
  // Main-line saloons: rows of reclining seats, 2+1 in first class, 2+2 in second, with a carpeted aisle.
  if (seating) {
    const first = seating === 'first', pitch = first ? 1.2 : 0.95, k = first ? 'first' : 'second';
    const cols = first ? [-0.95, -0.45, 0.85] : [-1.0, -0.5, 0.5, 1.0].map((x) => x * (W / 2.9));
    plane('carpet', 0.62, len - 0.2, first ? 0.2 : 0, y0 + 0.005, zm, -Math.PI / 2, 0);
    for (let z = zBack + 0.9; z < zFront - 0.6; z += pitch) {
      if (doorZ.some((d) => Math.abs(d - z) < dw / 2 + 0.55)) continue;
      for (const x of cols) {
        box(k, 0.46, 0.14, 0.48, x, FLOOR + 0.46, z);                     // cushion
        box(k, 0.46, 0.68, 0.12, x, FLOOR + 0.84, z - 0.26);              // backrest
        box('dark', 0.46, 0.42, 0.06, x, FLOOR + 0.22, z + 0.12);         // base
        box('dark', 0.05, 0.2, 0.42, x + (x < 0 ? -0.25 : 0.25), FLOOR + 0.62, z);   // armrest
      }
    }
  }
  const merged = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) merged[k] = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  const res = { parts: merged, displays };
  geoCache.set(key, res);
  return res;
}

/**
 * Power car body: the car cross-section lofted along the car; over the front `NL` metres it narrows and drops
 * into a long rounded nose. Vertex colours paint the livery (body colour, darker nose cap, accent line).
 */
export const NOSE = 8.0;
export function loftPoint(W, L, H, t, u, out) {
  // u in [0, 1] around the section (0 = bottom left, 0.5 = roof centre, 1 = bottom right); t in [0, 1] along the nose.
  // Section: a rounded box (near-vertical sides, curved roof) above a short inward skirt — the TGV power-car body.
  const h = W / 2, a = u * Math.PI, c = Math.cos(a), s = Math.sin(a);
  let x = -Math.sign(c) * Math.pow(Math.abs(c), 0.42) * h, y = 0.95 + Math.pow(s, 0.62) * (H - 0.95);
  if (u < 0.06 || u > 0.94) { const k = u < 0.5 ? u / 0.06 : (1 - u) / 0.06, a6 = 0.06 * Math.PI; x = (u < 0.5 ? -1 : 1) * (h - 0.06 * (1 - k)); y = 0.82 + k * (0.95 + Math.pow(Math.sin(a6), 0.62) * (H - 0.95) - 0.82); }
  // Nose: keeps nearly its full width, then rounds off at the tip; the roof line slopes down to a blunt nose
  // whose top is about 2.2 m above the rail.
  const tip = t > 0.72 ? (t - 0.72) / 0.28 : 0;
  const wf = (1 - 0.14 * t * t) * Math.sqrt(Math.max(0.12, 1 - 0.88 * tip * tip));
  const hf = 1 - 0.6 * Math.pow(t, 1.2);
  out.x = x * wf; out.y = 0.82 + (y - 0.82) * hf - 0.1 * t * t; out.z = L / 2 - NOSE + t * (NOSE + 0.9);
  return out;
}
/** Windscreen and cab side-window openings, in loft parameters (t along the nose, u around the section). */
export const WS = { t0: 9 / 22, t1: 16 / 22, u0: 0.2, u1: 0.8 };      // u0..u1: UV span of the glass (rain, wipers)
const LU = 28, LT = 22;
// Trapezoid windscreen (narrower at the top, like the real nose): u range per loft row.
const wsRange = (t) => { const k = (t - WS.t0) / (WS.t1 - WS.t0); return [0.33 - 0.13 * k, 0.67 + 0.13 * k]; };
const SIDE_WIN = { t0: 5 / 22, t1: 8 / 22, ranges: [[2 / 28, 4 / 28], [24 / 28, 26 / 28]] };
/** Is loft quad (row r between rings r and r+1, column i) part of the windscreen opening? */
function wsQuad(r, i) {
  if (r < 1) return false;
  const t0 = (r - 1) / LT, t1 = r / LT, u0 = i / LU, u1 = (i + 1) / LU, e = 1e-6;
  if (t0 < WS.t0 - e || t1 > WS.t1 + e) return false;
  const [a0, b0] = wsRange(t0), [a1, b1] = wsRange(t1);
  return u0 >= Math.max(a0, a1) - 0.02 && u1 <= Math.min(b0, b1) + 0.02;
}
function sideQuad(r, i) {
  if (r < 1) return false;
  const t0 = (r - 1) / LT, t1 = r / LT, u0 = i / LU, u1 = (i + 1) / LU, e = 1e-6;
  return t0 >= SIDE_WIN.t0 - e && t1 <= SIDE_WIN.t1 + e && SIDE_WIN.ranges.some(([a, b]) => u0 >= a - e && u1 <= b + e);
}
export function powerCarHeight(sp) { return sp.decks === 2 ? 4.2 : 4.05; }
function powerCarGeometry(W, L, H, livery) {
  const key = `pc3|${W}|${L}|${H}|${livery.body}|${livery.front}|${livery.stripe}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const U = LU, T = LT, pos = [], col = [], idx = [];
  const cb = new THREE.Color(livery.body || '#b9bec5'), cf = new THREE.Color(livery.lower || livery.front || '#2346a0'), cs = new THREE.Color(livery.stripe || '#f4f5f7'), cd = new THREE.Color(0x24272c);
  const P = {};
  // Livery after the real trainsets: silver upper body, blue lower band topped by a white stripe that sweeps down
  // the nose to its tip, dark skirt, dark ventilation grille under the windscreen and between the headlights.
  const paint = (t, u, y) => {
    if (y < 0.98) return cd;
    if (t > 0.745 && t < 0.785 && u > 0.24 && u < 0.76) return cd;                      // grille under the windscreen
    const yb = t < 0.2 ? 2.0 : 2.0 - ((t - 0.2) / 0.8) * 0.95;
    if (y < yb) return cf;
    if (y < yb + 0.14) return cs;
    return cb;
  };
  const ring = (z0, t) => { for (let i = 0; i <= U; i++) { loftPoint(W, L, H, t, i / U, P); pos.push(P.x, P.y, t > 0 ? P.z : z0); const c = paint(t, i / U, P.y); col.push(c.r, c.g, c.b); } };
  ring(-L / 2, 0);
  for (let j = 0; j <= T; j++) ring(0, j / T);
  const rows = T + 2;
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < U; i++) { if (wsQuad(r, i) || sideQuad(r, i)) continue; const a = r * (U + 1) + i, b = a + U + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  // Underside (flat floor between the skirts) and the closed nose tip.
  for (let r = 0; r < rows - 1; r++) { const a = r * (U + 1), b = a + U, a2 = a + U + 1, b2 = a2 + U; idx.push(a, b, a2, b, b2, a2); }
  {
    // Nose cap: concentric rings shrinking to the tip (each painted at its own height, so the livery stays clean).
    const last = (rows - 1) * (U + 1); let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i <= U; i++) { cx += pos[(last + i) * 3]; cy += pos[(last + i) * 3 + 1]; cz += pos[(last + i) * 3 + 2]; }
    cx /= U + 1; cy /= U + 1; cz /= U + 1;
    let prev = last;
    for (const k of [0.78, 0.55, 0.32, 0.12]) {
      const start = pos.length / 3;
      for (let i = 0; i <= U; i++) {
        const x = cx + (pos[(last + i) * 3] - cx) * k, y = cy + (pos[(last + i) * 3 + 1] - cy) * k, z = cz + (pos[(last + i) * 3 + 2] - cz) * k + 0.06 * (1 - k * k);
        pos.push(x, y, z); const c = paint(1, i / U, Math.max(y, 1.0)); col.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < U; i++) { const a = prev + i, b = start + i; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      prev = start;
    }
    const tip = pos.length / 3; pos.push(cx, cy, cz + 0.07); { const c = paint(1, 0.5, cy); col.push(c.r, c.g, c.b); }
    for (let i = 0; i < U; i++) idx.push(prev + i, prev + i + 1, tip);
  }
  // Rear cap.
  const c0 = pos.length / 3; pos.push(0, 0.82 + (H - 0.82) * 0.5, -L / 2); col.push(cb.r, cb.g, cb.b);
  for (let i = 0; i < U; i++) idx.push(c0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const nrm = g.attributes.normal; if (nrm.getY(Math.floor(U / 2) + (U + 1) * 3) < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t2 = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t2; } g.computeVertexNormals(); }
  geoCache.set(key, g);
  return g;
}
/** Glass exactly filling the windscreen opening (same loft quads), UV u across 0.2..0.8, v up the glass. */
export function windscreenGeometry(W, L, H) {
  const key = `ws3|${W}|${L}|${H}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const pos = [], uv = [], P = {}, out = 1.004;
  const vert = (t, u) => { loftPoint(W, L, H, t, u, P); pos.push(P.x * out, 0.82 + (P.y - 0.82) * out + 0.004, P.z); uv.push((u - WS.u0) / (WS.u1 - WS.u0), (WS.t1 - t) / (WS.t1 - WS.t0)); };
  for (let r = 1; r <= LT; r++) for (let i = 0; i < LU; i++) {
    if (!wsQuad(r, i)) continue;
    const t0 = (r - 1) / LT, t1 = r / LT, u0 = i / LU, u1 = (i + 1) / LU;
    vert(t0, u0); vert(t0, u1); vert(t1, u0); vert(t1, u0); vert(t0, u1); vert(t1, u1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}
/** Glass filling a loft opening (slightly proud of the body), with UVs u → across, v → up the glass. */
function loftPanel(W, L, H, t0, t1, u0, u1, key, out = 1.004) {
  if (geoCache.has(key)) return geoCache.get(key);
  const U = 16, T = 10, pos = [], uv = [], idx = [], P = {};
  for (let j = 0; j <= T; j++) {
    const t = t0 + ((t1 - t0) * j) / T;
    for (let i = 0; i <= U; i++) { const u = u0 + ((u1 - u0) * i) / U; loftPoint(W, L, H, t, u, P); pos.push(P.x * out, 0.82 + (P.y - 0.82) * out + 0.004, P.z); uv.push(i / U, 1 - j / T); }
  }
  for (let j = 0; j < T; j++) for (let i = 0; i < U; i++) { const a = j * (U + 1) + i, b = a + U + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}
function sideWindowGeometries(W, L, H) { return SIDE_WIN.ranges.map(([a, b], k) => loftPanel(W, L, H, SIDE_WIN.t0, SIDE_WIN.t1, a, b, `sw|${W}|${L}|${H}|${k}`)); }
/** Car-side lettering (operator name, train number) and the first-class marker. */
function liveryTexture(text, sub, fg = '#1b2a4a', accent = '#b48a3c') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 160);
  g.fillStyle = fg; g.font = 'italic bold 92px Arial'; g.textBaseline = 'middle'; g.fillText(text, 10, 70);
  const w = g.measureText(text).width;
  g.fillStyle = accent; g.fillRect(10, 128, w, 8);
  if (sub) { g.fillStyle = fg; g.font = 'bold 40px Arial'; g.fillText(sub, w + 40, 82); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function destinationTexture(line, terminus) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#070707'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = line.color; g.beginPath(); g.arc(50, 48, 36, 0, Math.PI * 2); g.fill();
  g.fillStyle = line.textColor; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(line.number, 50, 50);
  g.fillStyle = '#ffb300'; g.font = 'bold 40px "Courier New", monospace'; g.textAlign = 'left';
  g.fillText(terminus.length > 18 ? terminus.slice(0, 17) + '…' : terminus, 100, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TrainModel {
  constructor(specs, line, terminus, { player = false } = {}) {
    this.specs = specs;
    this.group = new THREE.Group();
    this.cars = [];
    this.doors = { left: [], right: [] };
    const W = specs.width, L = specs.carLength;
    const livery = specs.livery || {};
    const body = new THREE.MeshStandardMaterial({ color: livery.body || '#d9dde2', metalness: 0.45, roughness: 0.45 });
    const roof = new THREE.MeshStandardMaterial({ color: livery.roof || '#8b9096', metalness: 0.4, roughness: 0.6 });
    const stripeMat = new THREE.MeshLambertMaterial({ color: livery.stripe || line.color });
    const doorMat = new THREE.MeshStandardMaterial({ color: livery.doors || shade(livery.body || '#d9dde2', -25), metalness: 0.4, roughness: 0.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb8c6, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const bodySides = body.clone(); bodySides.side = THREE.DoubleSide;
    const sg = shellGeometry(specs);
    const darkGlass = new THREE.MeshStandardMaterial({ color: 0x0c1116, metalness: 0.9, roughness: 0.1 });
    const under = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
    const frontMat = new THREE.MeshStandardMaterial({ color: livery.front || livery.body || '#d9dde2', metalness: 0.4, roughness: 0.5 });
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const destTex = destinationTexture(line, terminus);
    const destMat = this.destMat = new THREE.MeshBasicMaterial({ map: destTex });
    const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16);
    const glow = glowTexture();
    this.glows = [];

    for (let c = 0; c < specs.cars; c++) {
      const car = new THREE.Group();
      const shell = new THREE.Group();
      shell.add(new THREE.Mesh(sg.roof, body));
      const rf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.9, 0.12, L - 0.4), roof);
      rf.position.y = 3.6; shell.add(rf);
      shell.add(new THREE.Mesh(sg.floor, body), new THREE.Mesh(sg.panels, bodySides), new THREE.Mesh(sg.stripe, stripeMat));
      // End walls between cars (the cab ends are closed by the cab front).
      if (c > 0) shell.add(new THREE.Mesh(sg.endF, bodySides));
      if (c < specs.cars - 1) shell.add(new THREE.Mesh(sg.endB, bodySides));
      const glazing = new THREE.Mesh(sg.glass, glassMat); glazing.renderOrder = 2; shell.add(glazing);
      // Under-frame & bogies.
      const uf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.35, L - 3), under); uf.position.y = 0.62; shell.add(uf);
      for (const bz of [L / 2 - 2.4, -L / 2 + 2.4]) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 2.6), under); bogie.position.set(0, 0.5, bz); shell.add(bogie);
        for (const wz of [-1, 1]) for (const wx of [-0.72, 0.72]) {
          const w = new THREE.Mesh(wheel, under); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, bz + wz * 1.0); shell.add(w);
        }
      }
      // Sides: stripe, windows, doors.
      const dps = specs.doorsPerSide, dw = specs.doorWidth;
      for (const side of [1, -1]) { // +1 = left (+x), -1 = right
        const x = side * (W / 2 + 0.006);
        const ry = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        const doorZ = sg.doorZ;
        for (const z of doorZ) {
          for (const leaf of [-1, 1]) {
            const g = new THREE.Group();
            // Leaf: lower panel, top rail, stiles and a glazed window (see-through into the car).
            const lw = dw / 2, part = (hh, yc, zw = lw, zc = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, hh, zw), doorMat); m.position.set(0, yc, zc); g.add(m); };
            part(1.025, -0.4625); part(0.125, 0.9125);
            for (const e of [-1, 1]) part(0.8, 0.45, 0.08, e * (lw / 2 - 0.04));
            const dwin = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.16, 0.8), glassMat);
            dwin.position.set(0, 0.45, 0); dwin.rotation.y = ry; g.add(dwin);
            g.position.set(x + side * 0.03, FLOOR + 0.98, z + leaf * dw / 4);
            g.userData = { baseZ: z + leaf * dw / 4, dir: leaf, travel: dw / 2 - 0.02 };
            shell.add(g);
            this.doors[side > 0 ? 'left' : 'right'].push(g);
          }
        }
      }
      car.add(shell);
      // Ends: cab fronts on first & last car, gangways elsewhere.
      for (const end of [1, -1]) {
        const isCab = (c === 0 && end === 1) || (c === specs.cars - 1 && end === -1);
        const z = end * (L / 2 + 0.01);
        const g = new THREE.Group(); g.position.z = z; if (end < 0) g.rotation.y = Math.PI;
        if (isCab) {
          const nose = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 2.75, 0.18), frontMat); nose.position.set(0, 2.2, 0.06); g.add(nose);
          const ws = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, 1.15), darkGlass); ws.position.set(0, 2.55, 0.16); g.add(ws);
          const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), destMat); dest.position.set(0, 3.3, 0.16); g.add(dest);
          for (const hx of [-W / 2 + 0.35, W / 2 - 0.35]) {
            const hl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), end === 1 ? this.headMat : this.headMat);
            hl.position.set(hx, 1.45, 0.16); g.add(hl);
            const tl = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), this.tailMat);
            tl.position.set(hx * 0.82, 1.45, 0.16); g.add(tl);
            const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff4d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            gl.scale.set(1.2, 1.2, 1); gl.position.set(hx, 1.45, 0.25); g.add(gl);
            gl.userData.end = end;
            this.glows.push(gl);
            const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff1a00, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
            tg.scale.set(0.6, 0.6, 1); tg.position.set(hx * 0.82, 1.45, 0.25); g.add(tg);
            tg.userData.end = end; tg.userData.tail = true;
            this.glows.push(tg);
          }
          const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.5), under); coupler.position.set(0, 0.95, 0.3); g.add(coupler);
          if (c === 0 && end === 1) this.cabFront = g;
        } else {
          const gw = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, specs.carGap + 0.1), under); gw.position.set(0, 2.1, (specs.carGap) / 2); g.add(gw);
        }
        car.add(g);
      }
      car.userData.shell = shell;
      this.group.add(car);
      this.cars.push(car);
    }
    if (specs.style === 'hst') this.buildHst(livery, glow, destMat);
    this.setLights('forward');
    this.buildInterior(line, player);
  }

  /**
   * High-speed trainset: two aerodynamic power cars (lofted body with a long nose, wrap-around windscreen and cab
   * side windows as real openings, light clusters, roof equipment, pantograph, bogies, livery and lettering) and
   * articulated trailers (bi-level for the Duplex: taller body, two window bands) joined by rubber gangway bellows
   * over shared bogies. Proportions follow the real vehicles: power car 4.05–4.2 m high, 2.9 m wide.
   */
  buildHst(livery, glow, destMat) {
    const sp = this.specs, W = sp.width, L = sp.carLength, n = sp.cars;
    const deck = sp.decks === 2 ? sp.height / 3.58 : 1.0;
    const H = powerCarHeight(sp);
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const body = std({ vertexColors: true, metalness: 0.3, roughness: 0.3 });
    const lining = std({ color: 0x8a9098, roughness: 0.85, side: THREE.BackSide });   // inside of the nose = cab lining
    // Windscreen: dark and reflective from outside; nearly clear from the cab (setCabExteriorVisible switches it).
    this.wsMat = std({ color: 0x14202a, metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false });
    const sideGlass = std({ color: 0x0f171e, metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const band = std({ color: livery.stripe || '#b48a3c', metalness: 0.6, roughness: 0.3 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d2024 });
    const steel = std({ color: 0x8a9096, metalness: 0.8, roughness: 0.35 });
    const ceramic = std({ color: 0x9a6a42, roughness: 0.4 });
    const rubber = new THREE.MeshLambertMaterial({ color: 0x2a2c2f });
    const wheelMat = std({ color: 0x3a3c40, metalness: 0.7, roughness: 0.45 });
    const nose = powerCarGeometry(W, L, H, livery);
    const shield = windscreenGeometry(W, L, H);
    const sideWins = sideWindowGeometries(W, L, H);
    const letters = new THREE.MeshBasicMaterial({ map: liveryTexture('Grande Vitesse', sp.decks === 2 ? 'DUPLEX' : '', livery.front || '#1b2a4a', livery.stripe || '#b48a3c'), transparent: true, depthWrite: false });
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.13, 20); wheelGeo.rotateZ(Math.PI / 2);
    const bogie = (z, motor) => {
      const g = new THREE.Group(); g.position.set(0, 0, z);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.32, 3.0), dark); fr.position.y = 0.62; g.add(fr);
      for (const wz of [-1.5, 1.5]) for (const wx of [-0.7175, 0.7175]) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(wx, 0.46, wz); g.add(w); }
      for (const wx of [-1.08, 1.08]) { const axleBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 3.4), dark); axleBox.position.set(wx, 0.5, 0); g.add(axleBox); }
      if (motor) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 1.2), dark); m.position.y = 0.55; g.add(m); }
      return g;
    };
    this.cabGlass = [];
    for (let c = 0; c < n; c++) {
      const car = this.cars[c], shell = car.userData.shell;
      if (c === 0 || c === n - 1) {
        shell.visible = false;
        for (const ch of car.children) if (ch !== shell) ch.visible = false;   // generic cab / gangway ends
        const pc = new THREE.Group(); pc.name = 'power-car'; if (c === n - 1) pc.rotation.y = Math.PI;
        const bodyMesh = new THREE.Mesh(nose, body), ws = new THREE.Mesh(shield, this.wsMat); ws.renderOrder = 3;
        pc.add(bodyMesh, ws, new THREE.Mesh(nose, lining));
        const sides = sideWins.map((g) => { const m = new THREE.Mesh(g, sideGlass); m.renderOrder = 3; pc.add(m); return m; });
        if (c === 0) { this.windscreen = ws; this.cabGlass.push(ws, ...sides); }
        // Livery band and lettering, ventilation grilles, roof equipment.
        for (const sd of [-1, 1]) {
          const b = new THREE.Mesh(new THREE.PlaneGeometry(L - 9, 0.2), band); b.position.set(sd * (W / 2 + 0.012), 1.42, -4.4); b.rotation.y = sd * Math.PI / 2; pc.add(b);
          const lt = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.72), letters); lt.position.set(sd * (W / 2 + 0.014), 2.35, -3.2); lt.rotation.y = sd * Math.PI / 2; if (sd < 0) lt.scale.x = 1; pc.add(lt);
          for (let k = 0; k < 4; k++) { const gr = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), dark); gr.position.set(sd * (W / 2 + 0.012), 2.85, -L / 2 + 1.8 + k * 1.9); gr.rotation.y = sd * Math.PI / 2; pc.add(gr); }
          const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, L - 3), dark); skirt.position.set(sd * (W / 2 - 0.05), 0.82, -1.0); pc.add(skirt);
        }
        const roofBox = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 6.5), dark); roofBox.position.set(0, H - 0.02, -L / 2 + 4.6); pc.add(roofBox);
        for (const iz of [-1.2, 1.2]) { const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.38, 10), ceramic); ins.position.set(0, H + 0.3, -L / 2 + 5 + iz); pc.add(ins); }
        // Pantograph: base frame on insulators, lower arm, upper arm, collector head (raised on the trailing power car).
        const raised = c === n - 1;
        const pant = new THREE.Group(); pant.position.set(0, H + 0.48, -L / 2 + 5);
        for (const sx of [-0.55, 0.55]) for (const sz of [-0.8, 0.8]) { const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), ceramic); ins.position.set(sx, -0.12, sz); pant.add(ins); }
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.9), steel); pant.add(frame);
        const lower = new THREE.Group(); lower.position.set(0, 0.05, 0.8); pant.add(lower);
        const la = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 1.9), steel); la.position.z = -0.95; lower.add(la);
        lower.rotation.x = raised ? -0.62 : -0.06;
        const upper = new THREE.Group(); upper.position.set(0, 0, -1.9); lower.add(upper);
        const ua = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 1.8), steel); ua.position.z = 0.9; upper.add(ua);
        upper.rotation.x = raised ? 1.3 : 0.12;
        const head = new THREE.Group(); head.position.z = 1.8; upper.add(head);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.18), steel); head.add(bar);
        for (const hx of [-1.0, 1.0]) { const horn = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.12), steel); horn.position.set(hx, -0.05, 0); horn.rotation.z = hx * 0.5; head.add(horn); }
        head.rotation.x = -(lower.rotation.x + upper.rotation.x);
        pc.add(pant);
        // Under-frame, bogies (motor bogies), coupler cover.
        const uf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.6, 0.4, L - 4), dark); uf.position.set(0, 0.68, -1.5); pc.add(uf);
        pc.add(bogie(L / 2 - 6.4, true), bogie(-L / 2 + 3.2, true));
        // Light clusters: two white head lamps and red tail lamps set in the nose cap, with glows.
        const end = c === 0 ? 1 : -1;
        const P = {};
        // Front face details: headlight clusters (oval lens in a dark housing) at ~1.5 m with the grille between them.
        const findU = (t, y, right) => { let best = 0.1, bd = 9; for (let k = 0; k <= 50; k++) { const u = right ? 1 - k / 100 : k / 100; loftPoint(W, L, H, t, u, P); const d = Math.abs(P.y - y); if (d < bd) { bd = d; best = u; } } return best; };
        const housingMat = std({ color: 0x15171b, metalness: 0.5, roughness: 0.3 });
        {
          const tg = 0.93; loftPoint(W, L, H, tg, 0.5, P);
          const gu = findU(tg, 1.42, false); const Q = {}; loftPoint(W, L, H, tg, gu, Q);
          const grille = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(Q.x) * 0.7, 0.16), housingMat); grille.position.set(0, 1.42, Q.z + 0.03); pc.add(grille);
        }
        for (const sd of [-1, 1]) {
          const uu = findU(0.9, 1.45, sd > 0); loftPoint(W, L, H, 0.9, uu, P);
          const hous = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20).scale(1.7, 0.7, 1), housingMat); hous.position.set(P.x * 0.97, P.y, P.z + 0.01); hous.lookAt(P.x * 2.2, P.y, P.z + 4); pc.add(hous);
          const hl = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20).scale(1.8, 0.75, 1), this.headMat); hl.position.set(P.x * 1.01, P.y, P.z + 0.02); hl.lookAt(P.x * 3, P.y, P.z + 4); pc.add(hl);
          const tl = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12).scale(1.6, 0.8, 1), this.tailMat); tl.position.set(P.x * 1.01 * 0.8, P.y + 0.18, P.z); tl.lookAt(P.x * 3, P.y + 0.2, P.z + 4); pc.add(tl);
          const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff4d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          gl.scale.set(1.3, 1.3, 1); gl.position.set(P.x, P.y, P.z + 0.2); gl.userData.end = end; pc.add(gl); this.glows.push(gl);
          const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff1a00, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
          tg.scale.set(0.6, 0.6, 1); tg.position.set(P.x * 0.8, P.y + 0.18, P.z + 0.15); tg.userData.end = end; tg.userData.tail = true; pc.add(tg); this.glows.push(tg);
        }
        // Rear gangway bellows towards the first trailer.
        const bel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, sp.carGap + 0.3), rubber); bel.position.set(0, 2.1, -L / 2 - sp.carGap / 2); pc.add(bel);
        car.add(pc);
        if (c === 0) this.noseFront = pc;
        continue;
      }
      // Trailers: bi-level body, upper window band, bellows, lettering, first-class marker, side destination displays.
      shell.scale.y = deck;
      // Livery: blue lower band with a white stripe above it (silver upper body), as on the power cars.
      {
        const lowerMat = std({ color: livery.lower || livery.front || '#2346a0', metalness: 0.3, roughness: 0.35 });
        const whiteMat = std({ color: livery.stripe || '#f4f5f7', metalness: 0.2, roughness: 0.4 });
        for (const sd of [-1, 1]) {
          const spans = []; let cur = -L / 2;
          for (const z of [...sp.doorZ].sort((a, b) => a - b)) { spans.push([cur, z - sp.doorWidth / 2]); cur = z + sp.doorWidth / 2; }
          spans.push([cur, L / 2]);
          for (const [a, b] of spans) {
            if (b - a < 0.05) continue;
            const bl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.88), lowerMat); bl.position.set(sd * (W / 2 + 0.008), 1.46, (a + b) / 2); bl.rotation.y = sd * Math.PI / 2; shell.add(bl);
            const wh = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.09), whiteMat); wh.position.set(sd * (W / 2 + 0.009), 1.91 + 0.045, (a + b) / 2); wh.rotation.y = sd * Math.PI / 2; shell.add(wh);
          }
        }
      }
      for (const ch of car.children) if (ch !== shell && !ch.userData?.keep) ch.visible = false;  // replace the metro gangway blocks
      const bel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6 * deck, sp.carGap + 0.3), rubber); bel.position.set(0, 2.1 * deck, L / 2 + sp.carGap / 2); car.add(bel);
      for (const sd of [-1, 1]) {
        if (sp.decks === 2) { const up = new THREE.Mesh(new THREE.PlaneGeometry(L - 1.6, 0.34), sideGlass); up.position.set(sd * (W / 2 + 0.02), 3.13, 0); up.rotation.y = sd * Math.PI / 2; shell.add(up); }
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.24), destMat); d.position.set(sd * (W / 2 + 0.03), (sp.decks === 2 ? 3.6 : 2.85), sp.doorZ[0] + (sd > 0 ? 1.2 : -1.2)); d.rotation.y = sd * Math.PI / 2; car.add(d);
        if (c <= (sp.classes?.first ?? 2)) { const fc = new THREE.Mesh(new THREE.PlaneGeometry(L - 3, 0.12), band); fc.position.set(sd * (W / 2 + 0.025), (sp.decks === 2 ? 4.12 : 3.0), 0); fc.rotation.y = sd * Math.PI / 2; car.add(fc); }
      }
    }
  }

  /**
   * Passenger saloons (every train, so open doors and windows show a real interior): floor, ceiling, wall
   * linings leaving the windows clear, benches, grab poles, light strips, end walls, cab partitions. Geometry is
   * merged per material and cached per train type. The driven train also gets next-station displays.
   */
  buildInterior(line, player) {
    const sp = this.specs, n = sp.cars;
    const lam = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
    const M = {
      floor: lam({ color: 0x5b6068, emissive: 0x15171a }), wall: lam({ color: 0xe9ebee, emissive: 0x3a3c40 }), ceiling: lam({ color: 0xf2f3f5, emissive: 0x4a4b4e }),
      seat: lam({ color: new THREE.Color(line.color).lerp(new THREE.Color(0x24324a), 0.45), emissive: 0x111111 }), pole: new THREE.MeshStandardMaterial({ color: line.color, metalness: 0.5, roughness: 0.35 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfffaf0 }), dark: lam({ color: 0x2b2f35 }),
      first: lam({ color: 0x6a1f2b, emissive: 0x1a0508 }), second: lam({ color: 0x24406a, emissive: 0x070d18 }), carpet: lam({ color: 0x3a3330, emissive: 0x0a0808 }),
    };
    const hst = sp.style === 'hst', nFirst = sp.classes?.first ?? 2;
    let infoMat = null;
    if (player) {
      const c = document.createElement('canvas'); c.width = 768; c.height = 160;
      this.infoCanvas = c; this.infoCtx = c.getContext('2d');
      this.infoTex = new THREE.CanvasTexture(c); this.infoTex.colorSpace = THREE.SRGBColorSpace;
      infoMat = new THREE.MeshBasicMaterial({ map: this.infoTex });
    }
    this.cars.forEach((car, ci) => {
      const geo = interiorGeometry(sp, ci === 0, ci === n - 1, hst ? (ci >= 1 && ci <= nFirst ? 'first' : 'second') : null);
      const g = new THREE.Group(); g.name = 'interior'; car.add(g);
      if (hst && (ci === 0 || ci === n - 1)) g.visible = false;            // power cars: machinery, no saloon
      for (const [k, gg] of Object.entries(geo.parts)) g.add(new THREE.Mesh(gg, M[k]));
      if (infoMat) for (const d of geo.displays) { const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), infoMat); m.position.set(d.x, d.y, d.z); m.rotation.y = d.ry; g.add(m); }
    });
    if (player) this.setInfo({ line, next: '', terminus: '' });
  }

  /** Next-station displays inside the train. */
  setInfo({ line, next, terminus, clock, side, atStation }) {
    if (!this.infoCanvas) return;
    const key = `${next}|${terminus}|${side}|${atStation}|${Math.floor((clock || 0) / 60)}`;
    if (key === this.infoKey) return;
    this.infoKey = key;
    const g = this.infoCtx, W = 768, H = 160;
    if (!g) return;
    g.fillStyle = '#0c0f14'; g.fillRect(0, 0, W, H);
    g.fillStyle = line.color; g.beginPath(); g.arc(70, 80, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = line.textColor; g.font = 'bold 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(line.number, 70, 84);
    g.textAlign = 'left'; g.fillStyle = '#8fa1b3'; g.font = '26px Arial';
    g.fillText(atStation ? 'Station · Stop' : 'Prochaine station · Next stop', 140, 40);
    g.fillStyle = '#ffffff'; let size = 48; g.font = `bold ${size}px Arial`;
    while (g.measureText(next).width > W - 160 && size > 22) { size -= 2; g.font = `bold ${size}px Arial`; }
    g.fillText(next, 140, 90);
    g.fillStyle = '#ffb000'; g.font = '24px Arial';
    g.fillText(`${terminus ? `Direction ${terminus}` : ''}${side ? `   ·   Descente ${side === 'left' ? 'à gauche ◀' : 'à droite ▶'}` : ''}`, 140, 138);
    if (clock != null) { g.textAlign = 'right'; g.fillStyle = '#8fa1b3'; g.font = 'bold 26px Arial'; const h = Math.floor(clock / 3600) % 24, m = Math.floor(clock / 60) % 60; g.fillText(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, W - 18, 40); }
    this.infoTex.needsUpdate = true;
  }

  setDestination(line, terminus) {
    this.destMat.map?.dispose();
    this.destMat.map = destinationTexture(line, terminus);
    this.destMat.needsUpdate = true;
  }

  /** Front of train at route chainage `front` (m). */
  setPose(route, front) {
    const sp = this.specs, L = sp.carLength;
    const a = this._a || (this._a = {}), b = this._b || (this._b = {});
    for (let c = 0; c < sp.cars; c++) {
      const cf = front - c * (L + sp.carGap);
      route.point(cf - 2.4, 0, 0, a);
      route.point(cf - L + 2.4, 0, 0, b);
      const car = this.cars[c];
      car.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      car.lookAt(a.x, (a.y + b.y) / 2 + (a.y - b.y) / 2, a.z);
    }
  }

  /** side: 'left' | 'right', amount 0..1 */
  setDoors(side, amount) {
    for (const g of this.doors[side]) g.position.z = g.userData.baseZ + g.userData.dir * g.userData.travel * amount;
  }

  setLights(mode, high = true) {
    for (const gl of this.glows) {
      const front = gl.userData.end === 1;
      if (gl.userData.tail) gl.material.opacity = front ? 0 : 0.95;
      else gl.material.opacity = front ? (high ? 0.9 : 0.5) : 0;
    }
    this.tailMat.color.setHex(0xff2200);
  }

  /** Hide the leading cab exterior when the camera is inside it. */
  setCabExteriorVisible(v) {
    // TGV: the driver sits inside the nose — the body stays (it frames the view), the glass turns clear.
    if (this.noseFront) { for (const ch of this.noseFront.children) if (ch.isSprite) ch.visible = v; if (this.wsMat) { this.wsMat.opacity = v ? 0.88 : 0.06; this.wsMat.metalness = v ? 0.85 : 0; } for (const m of this.cabGlass || []) if (m !== this.windscreen) m.material.opacity = v ? 0.85 : 0.15; return; }
    if (this.cabFront) this.cabFront.visible = v; this.cars[0].userData.shell.children[0].visible = v; this.cars[0].userData.shell.children[1].visible = v; }

  dispose(scene) { scene.remove(this.group); }
}
export const TRAIN_FLOOR = FLOOR;
