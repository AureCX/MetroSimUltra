// Imports the TGV Duplex (inOui) model — "tgv inoui" by yuimpou (https://sketchfab.com/yuimpou), CC-BY-4.0,
// https://sketchfab.com/3d-models/tgv-inoui-69e3e860593f4907a00b63801e3a5c83 — into the game's compact format.
// The source is the whole 10-car trainset in one piece (SketchUp, inches, z up). It is cut into its real cars at
// the articulations (found from the bogie positions), converted to the car frame (metres, y up, +z towards the
// front, +x to the left), scaled to the real Duplex dimensions, and only the distinct cars are kept (power car,
// end trailer, middle trailer: the others are the same ones turned round). Edges (line primitives) are dropped.
// Output: src/data/models/tgv-duplex-model.js (base64 of a small binary + JSON header).
//   node tools/import-tgv-model.mjs [assets/models/tgv-inoui.glb]
import fs from 'node:fs';

const src = process.argv[2] || new URL('../assets/models/tgv-inoui.glb', import.meta.url).pathname;
const d = fs.readFileSync(src);
const jl = d.readUInt32LE(12), j = JSON.parse(d.subarray(20, 20 + jl).toString());
const bin = 20 + jl + 8;
const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
function acc(i) {
  const a = j.accessors[i], bv = j.bufferViews[a.bufferView], n = TYPES[a.type], T = CT[a.componentType];
  const off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  const out = new T(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = d[`read${T === Float32Array ? 'FloatLE' : T === Uint32Array ? 'UInt32LE' : T === Uint16Array ? 'UInt16LE' : 'UInt8'}`](off + k * stride + c * T.BYTES_PER_ELEMENT);
  return out;
}
// Real Duplex: 2.904 m wide, ~4.3 m high, 200.2 m long. Source (in): 124 wide, 164 high (body), 8133 long.
const SX = 2.9 / 124, SY = 4.2 / 164, SL = 200.2 / 8133, XC = 364;
// Cars, cut at the power-car / end-trailer gangway and at the articulations (inches along the source length).
const CUTS = [0, 895, 1790, 2560, 3310, 4070, 4815, 5575, 6340, 7232, 8133];
const KEEP = { power: 0, end: 1, middle: 3 };                    // car indices of the distinct types
// Gather triangles per kept car and material.
const groups = {};                                               // `${type}|${mat}` → { pos: [], nrm: [], idx: [], map }
let total = 0;
for (const node of j.nodes) {
  if (node.mesh == null) continue;
  for (const p of j.meshes[node.mesh].primitives) {
    if ((p.mode ?? 4) !== 4) continue;                          // edges
    const pos = acc(p.attributes.POSITION), nrm = p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null;
    const idx = p.indices != null ? acc(p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const mat = p.material ?? -1;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
      let car = CUTS.findIndex((v, k) => k < CUTS.length - 1 && cy >= v && cy < CUTS[k + 1]);
      const type = Object.keys(KEEP).find((k) => KEEP[k] === car);
      if (!type) continue;
      const key = `${type}|${mat}`;
      const g = groups[key] || (groups[key] = { pos: [], nrm: [], idx: [], map: new Map() });
      const y0 = CUTS[car], y1 = CUTS[car + 1], mid = (y0 + y1) / 2;
      for (const v of [a, b, c]) {
        let k = g.map.get(v);
        if (k == null) {
          k = g.pos.length / 3; g.map.set(v, k);
          // car frame: x left, y up, z forward (the source front is at y = 0).
          g.pos.push((pos[v * 3] - XC) * SX, pos[v * 3 + 2] * SY, -(pos[v * 3 + 1] - mid) * SL);
          if (nrm) g.nrm.push(nrm[v * 3] * (SY / SX), nrm[v * 3 + 2], -nrm[v * 3 + 1] * (SY / SL));
        }
        g.idx.push(k);
      }
      total++;
    }
  }
}
// Pack: per group, Int16 positions (quantized over ±16 m × 8 m), Int8 normals, Uint16/Uint32 indices.
const header = { source: j.asset.extras, cars: CUTS.slice(0, -1).map((v, k) => +(((CUTS[k + 1] - v) * SL).toFixed(3))), keep: KEEP, groups: [] };
const chunks = []; let off = 0;
const push = (buf) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } chunks.push(buf); const o = off; off += buf.length; return o; };
for (const [key, g] of Object.entries(groups)) {
  const [type, mat] = key.split('|'); const m = j.materials[+mat] || {};
  const n = g.pos.length / 3, q = new Int16Array(n * 3), nq = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) q[i] = Math.round((g.pos[i] / (i % 3 === 2 ? 16 : 8)) * 32767);
  for (let i = 0; i < n; i++) { const x = g.nrm[i * 3] || 0, y = g.nrm[i * 3 + 1] || 1, z = g.nrm[i * 3 + 2] || 0, l = Math.hypot(x, y, z) || 1; nq[i * 3] = Math.round((x / l) * 127); nq[i * 3 + 1] = Math.round((y / l) * 127); nq[i * 3 + 2] = Math.round((z / l) * 127); }
  const I = n > 65535 ? Uint32Array.from(g.idx) : Uint16Array.from(g.idx);
  const pf = m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
  header.groups.push({ type, name: m.name || 'none', color: pf, alpha: m.alphaMode || 'OPAQUE', double: !!m.doubleSided, n, tris: g.idx.length / 3, pos: push(Buffer.from(q.buffer)), nrm: push(Buffer.from(nq.buffer)), idx: push(Buffer.from(I.buffer)), i32: I instanceof Uint32Array });
}
const body = Buffer.concat(chunks);
const out = new URL('../src/data/models/tgv-duplex-model.js', import.meta.url).pathname;
fs.mkdirSync(new URL('../src/data/models/', import.meta.url).pathname, { recursive: true });
fs.writeFileSync(out, `// Generated by tools/import-tgv-model.mjs — "tgv inoui" by yuimpou (Sketchfab), CC-BY-4.0.\nexport const HEADER = ${JSON.stringify(header)};\nexport const DATA = '${body.toString('base64')}';\n`);
console.log('triangles kept', header.groups.reduce((a, g) => a + g.tris, 0), 'of', total, 'groups', header.groups.length, 'binary', (body.length / 1024).toFixed(0), 'KB', 'cars (m)', header.cars.join(' '));
for (const t of Object.keys(KEEP)) console.log(t, header.groups.filter((g) => g.type === t).map((g) => `${g.name}:${g.tris}`).join(' '));
