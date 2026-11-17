// Builds the physical railway alignment (plan + profile + track spacing) of a line
// from its data definition. Everything is sampled every metre along the chainage `s`
// (track coordinate, increasing in direction A).
//
// Convention: heading θ = 0 points to world -Z. Tangent T = (sinθ, 0, -cosθ),
// right vector R = (cosθ, 0, sinθ). Positive curvature turns right.
import { smoothstep } from '../core/util.js';

export const LEAD_IN = 220;     // m of tunnel before the first platform centre
export const LEAD_OUT = 260;    // m of tunnel (overrun/sidings) after the last platform centre
const PLATFORM_PAD = 25;        // alignment is kept straight & level this far beyond platforms
const CURVE_SMOOTH = 15;        // half window (m) of the transition-curve filter
const GRADE_SMOOTH = 22;        // half window (m) of the vertical-curve filter

function boxFilter(src, half) {
  const n = src.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

export class TrackGeometry {
  constructor(line) {
    this.line = line;
    const st = line.stations;
    this.stationS = [];
    let acc = LEAD_IN;
    for (let i = 0; i < st.length; i++) { this.stationS.push(acc); acc += st[i].distanceToNext; }
    this.length = this.stationS.at(-1) + LEAD_OUT;
    const N = Math.ceil(this.length) + 2;
    this.N = N;

    const curvT = new Float32Array(N), gradT = new Float32Array(N);
    this.portals = []; // { s, type: 'exit' | 'enter' } in direction A
    for (let i = 0; i < st.length - 1; i++) {
      const begin = this.stationS[i] + st[i].platformLength / 2 + PLATFORM_PAD;
      const end = this.stationS[i + 1] - st[i + 1].platformLength / 2 - PLATFORM_PAD;
      let cur = begin;
      for (const seg of st[i].track) {
        if (!seg || cur >= end) break;
        if (seg.portal) this.portals.push({ s: cur, type: seg.portal });
        const b = Math.min(end, cur + seg.length);
        for (let k = Math.floor(cur); k < Math.floor(b); k++) { curvT[k] = seg.curvature; gradT[k] = seg.gradient; }
        cur = b;
      }
    }
    this.curv = boxFilter(curvT, CURVE_SMOOTH);
    this.grad = boxFilter(gradT, GRADE_SMOOTH);

    // Integrate plan and profile.
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N); this.hd = new Float32Array(N);
    let x = line.mapOrigin[0] || 0, z = line.mapOrigin[1] || 0, y = 0, h = (line.initialHeading || 0) * Math.PI / 180;
    for (let i = 0; i < N; i++) {
      this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.hd[i] = h;
      const hm = h + this.curv[i] * 0.5;
      x += Math.sin(hm); z -= Math.cos(hm);
      y += this.grad[i] / 1000;
      h += this.curv[i];
    }

    // Surface sections: outdoor between an 'exit' portal and the next 'enter' portal (direction A).
    // Ground level of a surface section = track level at its portal + 5.5 m (tunnel roof + cover).
    this.outdoor = new Uint8Array(N);
    this.ground = new Float32Array(N).fill(NaN);
    const cover = 5.5;
    const ev = [...this.portals].sort((a, b) => a.s - b.s);
    let out = false, g = NaN, e = 0;
    for (let i = 0; i < N; i++) {
      while (e < ev.length && ev[e].s <= i) {
        out = ev[e].type === 'exit';
        g = this.py[Math.min(N - 1, Math.round(ev[e].s))] + cover;
        e++;
      }
      if (out) { this.outdoor[i] = 1; this.ground[i] = g; }
    }
    // Ground also extends over the tunnel near each portal (so the landscape has no hole behind it).
    for (const p of ev) {
      const gg = this.py[Math.min(N - 1, Math.round(p.s))] + cover;
      for (let i = Math.max(0, Math.floor(p.s - 260)); i < Math.min(N, p.s + 260); i++) if (Number.isNaN(this.ground[i])) this.ground[i] = gg;
    }

    // Track half-spacing: widened at island platforms.
    const base = line.trackSpacing / 2;
    this.hs = new Float32Array(N).fill(base);
    this.zones = [];
    st.forEach((s, i) => {
      const c = this.stationS[i];
      const half = s.platformLength / 2;
      this.zones.push({ index: i, start: c - half - 6, end: c + half + 6, center: c });
      if (s.platformType !== 'island') return;
      const target = s.platformWidth / 2 + 1.5;
      for (let k = Math.max(0, Math.floor(c - half - 90)); k < Math.min(N, Math.ceil(c + half + 90)); k++) {
        const d = Math.abs(k - c) - (half + 8);
        const w = d <= 0 ? 1 : 1 - smoothstep(0, 75, d);
        this.hs[k] = Math.max(this.hs[k], base + (target - base) * w);
      }
    });
  }

  _idx(s) {
    const c = Math.min(Math.max(s, 0), this.N - 1.001);
    const i = Math.floor(c);
    return [i, c - i];
  }
  /** Interpolated sample of an array at chainage s. */
  sample(arr, s) { const [i, t] = this._idx(s); return arr[i] + (arr[i + 1] - arr[i]) * t; }

  heading(s) { return this.sample(this.hd, s); }
  gradientAt(s) { return this.sample(this.grad, s); }            // ‰ uphill in direction A
  curvatureAt(s) { return this.sample(this.curv, s); }           // 1/m, + = right in direction A
  halfSpacingAt(s) { return this.sample(this.hs, s); }
  tunnelHalfWidthAt(s) { return this.halfSpacingAt(s) + 2.45; }

  /** World position of a point at chainage s, `lateral` metres to the right (dir A), `height` above rail top. */
  point(s, lateral = 0, height = 0, out = { x: 0, y: 0, z: 0 }) {
    const h = this.heading(s);
    out.x = this.sample(this.px, s) + Math.cos(h) * lateral;
    out.y = this.sample(this.py, s) + height;
    out.z = this.sample(this.pz, s) + Math.sin(h) * lateral;
    return out;
  }

  outdoorAt(s) { const i = Math.min(this.N - 1, Math.max(0, Math.round(s))); return this.outdoor[i] === 1; }
  groundAt(s) { const i = Math.min(this.N - 1, Math.max(0, Math.round(s))); return this.ground[i]; }
  /** [start, end] chainage runs that are open-air. */
  outdoorRuns() {
    const runs = []; let a = null;
    for (let i = 0; i < this.N; i++) {
      if (this.outdoor[i] && a == null) a = i;
      if (!this.outdoor[i] && a != null) { runs.push([a, i]); a = null; }
    }
    if (a != null) runs.push([a, this.N - 1]);
    return runs;
  }

  stationZoneAt(s) {
    for (const z of this.zones) if (s >= z.start && s <= z.end) return z;
    return null;
  }
}
