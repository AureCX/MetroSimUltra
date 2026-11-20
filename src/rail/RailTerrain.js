// Country terrain for the main-line (TGV) network: a deterministic height field in world metres (x east,
// z south), shared by the line generator (which designs gradients, tunnels and viaducts against it) and by the
// game (which streams the landscape around the train). Plains around Grandville, rolling hills, an Alpine
// massif, the sea along two coasts, river valleys and flat platforms for the cities.
const hash = (x, z, s) => { let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
  const u = smooth(xf), v = smooth(zf);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function fbm(x, z, s, oct = 4) { let a = 0, f = 1, amp = 1, n = 0; for (let i = 0; i < oct; i++) { a += vnoise(x * f, z * f, s + i * 17) * amp; n += amp; f *= 2.03; amp *= 0.5; } return a / n; }
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class RailTerrain {
  /**
   * def: { seed, origin: [x, z] (Grandville, flat), mountains: [{x, z, r, h}], coasts: [{x, z, nx, nz, w}] (sea beyond
   * the line through (x, z) in direction (nx, nz)), cities: [{x, z, r, y?}] (flattened), rivers? }
   */
  constructor(def = {}) {
    this.d = { seed: 7, origin: [3570, 220], mountains: [], coasts: [], cities: [], ...def };
  }
  /** Natural ground height (m, sea level 0). */
  height(x, z) {
    const d = this.d, s = d.seed;
    // Rolling country 40–110 m with large-scale undulation and local hills.
    let h = 55 + (fbm(x / 22000, z / 22000, s) - 0.5) * 90 + (fbm(x / 4200, z / 4200, s + 3) - 0.5) * 38 + (fbm(x / 900, z / 900, s + 9) - 0.5) * 7;
    // Mountain massifs: ridged noise scaled by a broad dome.
    for (const m of d.mountains) {
      const r = Math.hypot(x - m.x, z - m.z) / m.r;
      if (r > 1.4) continue;
      const dome = Math.max(0, 1 - r * r / 1.96);
      const ridge = 1 - Math.abs(fbm(x / 9000, z / 9000, s + 31, 5) * 2 - 1);
      h += m.h * dome * (0.35 + 0.65 * ridge * ridge) + dome * (fbm(x / 1500, z / 1500, s + 41) - 0.5) * m.h * 0.12;
    }
    // Coasts: land slopes down below sea level past the shore line (with a wavy shoreline).
    for (const c of d.coasts) {
      const along = (x - c.x) * -c.nz + (z - c.z) * c.nx;
      const off = (x - c.x) * c.nx + (z - c.z) * c.nz + (fbm(along / 6000, 0.5, s + 51) - 0.5) * (c.wobble ?? 5000);
      const reach = c.len ? 1 - sstep(c.len * 0.75, c.len, Math.abs(along)) : 1;   // coasts are finite
      const shore = sstep(-c.w, c.w * 0.4, off) * reach;
      h = h * (1 - shore) + (-18 - off * 0.004) * shore;
    }
    // Grandville and the other cities sit on flat ground.
    const og = d.origin; const ro = Math.hypot(x - og[0], z - og[1]);
    if (ro < 16000) h = 6 + (h - 6) * sstep(5000, 16000, ro);
    for (const c of d.cities) {
      const rc = Math.hypot(x - c.x, z - c.z);
      if (rc < c.r * 3) { const y = c.y ?? Math.max(4, h); h = y + (h - y) * sstep(c.r, c.r * 3, rc); }
    }
    // Flat pads (station forecourts…): rectangles at a fixed level with a short blend.
    for (const p of d.pads || []) {
      const dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1), dd = Math.hypot(dx, dz);
      if (dd < p.blend) h = p.y + (h - p.y) * sstep(0, p.blend, dd);
    }
    return h;
  }
  isSea(x, z) { return this.height(x, z) < 0; }
  /** Ground colour class for a point: 0 field, 1 meadow, 2 forest, 3 rock, 4 snow, 5 sand, 6 vineyard/ochre. */
  biome(x, z, h) {
    if (h < 1.5) return 5;
    if (h > 2150) return 4;
    if (h > 1750) return 3;
    const f = fbm(x / 1600, z / 1600, this.d.seed + 71);
    if (h > 600) return f > 0.55 ? 2 : 1;
    if (f > 0.68) return 2;
    if (this.d.warm && this.d.warm(x, z)) return f > 0.45 ? 6 : 1;
    return f < 0.32 ? 1 : 0;
  }
  forest(x, z) { return fbm(x / 1600, z / 1600, this.d.seed + 71); }
}

/** The country of the Grandville main-line network (shared by tools and game). */
export const COUNTRY = {
  seed: 11,
  origin: [3570, 220],
  mountains: [{ x: 310000, z: 110000, r: 95000, h: 1900 }, { x: -60000, z: -230000, r: 60000, h: 420 }],
  // Atlantic-style coast north of Valdor, Mediterranean-style coast south of Port-Azur (finite stretches).
  coasts: [{ x: -213100, z: -57600, nx: 0, nz: -1, w: 3000, len: 110000, wobble: 1400 }, { x: 313400, z: 271300, nx: 0.15, nz: 0.99, w: 3000, len: 140000, wobble: 1400 }],
  cities: [],
  warm: (x, z) => z > 120000 || x < -300000,     // vineyards and ochre fields in the south and far west
};
