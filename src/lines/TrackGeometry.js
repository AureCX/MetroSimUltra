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
    const loop = line.loop;
    // A loop line ends where it started (the return track at the first station), so its lead-out mirrors the lead-in.
    this.length = this.stationS.at(-1) + (loop ? LEAD_IN : LEAD_OUT);
    const N = Math.ceil(this.length) + 2;
    this.N = N;

    const curvT = new Float32Array(N), gradT = new Float32Array(N);
    this.portals = []; // { s, type: 'exit' | 'enter' } in direction A
    for (let i = 0; i < (loop ? loop.returnIndex : st.length - 1); i++) {
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

    if (loop) this.buildLoop(loop);
    if (line.category === 'hst' && line.rail?.profile) this.applyProfile(line.rail.profile);

    // Surface sections: outdoor between an 'exit' portal and the next 'enter' portal (direction A).
    // Ground level of a surface section = track level at its portal + 5.5 m (tunnel roof + cover).
    this.outdoor = new Uint8Array(N);
    this.ground = new Float32Array(N).fill(NaN);
    const cover = 5.5;
    if (line.category === 'hst') for (const [a, b] of line.rail?.tunnels || []) { this.portals.push({ s: a, type: 'enter' }, { s: b, type: 'exit' }); }
    const ev = [...this.portals].sort((a, b) => a.s - b.s);
    let out = line.category === 'hst', g = NaN, e = 0; // main lines run in the open; 'enter' portals start tunnels
    for (let i = 0; i < N; i++) {
      while (e < ev.length && ev[e].s <= i) {
        out = ev[e].type === 'exit';
        g = this.py[Math.min(N - 1, Math.round(ev[e].s))] + cover;
        e++;
      }
      if (out) { this.outdoor[i] = 1; this.ground[i] = Number.isNaN(g) ? this.py[i] - 0.6 : g; }
    }
    if (line.category === 'hst') for (let i = 0; i < N; i++) this.ground[i] = this.py[i] - 0.6; // ground follows the formation
    // Elevated line: open air throughout, the street lies `height` below the track bed.
    if (line.elevated) {
      const Hs = line.elevated.height;
      for (let i = 0; i < N; i++) { this.outdoor[i] = 1; this.ground[i] = this.py[i] - Hs; }
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
    if (loop) this.taperLoop(base);
  }

  /**
   * Terminal loop: [J, Jr] is the single-track loop (integrated from the track data), J being the
   * end of the junction station's platform pad and Jr the same point reached again in the other
   * direction. Beyond Jr the circuit runs back over the trunk on the other track: those samples
   * are the trunk mirrored (s ↔ M − s), heading reversed.
   */
  buildLoop(loop) {
    const st = this.line.stations, S = this.stationS, N = this.N;
    const jst = st[loop.junctionIndex];
    const J = S[loop.junctionIndex] + jst.platformLength / 2 + PLATFORM_PAD;
    const M = S[loop.junctionIndex] + S[loop.returnIndex];
    const Jr = M - J;
    const smp = (arr, s) => this.sample(arr, s);
    // 1. Close the loop: the integrated alignment must come back to J, heading reversed.
    const tx = smp(this.px, J), ty = smp(this.py, J), tz = smp(this.pz, J);
    const ex = tx - smp(this.px, Jr), ey = ty - smp(this.py, Jr), ez = tz - smp(this.pz, Jr);
    const B = Math.min(700, (Jr - J) / 2);
    const i0 = Math.ceil(J), i1 = Math.min(N - 1, Math.floor(Jr) + 1);
    for (let i = Math.floor(Jr - B); i <= i1; i++) {
      const w = smoothstep(Jr - B, Jr, i);
      this.px[i] += ex * w; this.py[i] += ey * w; this.pz[i] += ez * w;
    }
    // Headings / curvature from the corrected positions.
    for (let i = Math.floor(Jr - B); i <= i1; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      let h = Math.atan2(this.px[b] - this.px[a], -(this.pz[b] - this.pz[a]));
      h += Math.round((this.hd[i - 1] - h) / (2 * Math.PI)) * 2 * Math.PI;
      this.hd[i] = h;
    }
    for (let i = Math.floor(Jr - B); i < i1; i++) this.curv[i] = this.hd[i + 1] - this.hd[i];
    // 2. Mirror the trunk for the return run. Keep the heading continuous (offset = an odd multiple of π).
    let off = smp(this.hd, Jr) - smp(this.hd, J) - Math.PI;
    off = Math.PI + Math.round(off / (2 * Math.PI)) * 2 * Math.PI;
    for (let i = Math.ceil(Jr); i < N; i++) {
      const j = Math.max(0, M - i);
      this.px[i] = smp(this.px, j); this.py[i] = smp(this.py, j); this.pz[i] = smp(this.pz, j);
      this.hd[i] = smp(this.hd, j) + off;
      this.curv[i] = -smp(this.curv, j); this.grad[i] = -smp(this.grad, j);
    }
    // Which side the return branch lies on, seen from the outbound one (+1 right / −1 left): its inner wall.
    const p = this.point(J + 60), q = this.point(Jr - 60), h = this.heading(J + 60);
    const side = Math.sign((q.x - p.x) * Math.cos(h) + (q.z - p.z) * Math.sin(h)) || -1;
    this.loop = { J, Jr, M, inner: side, closure: Math.hypot(ex, ez), junctionIndex: loop.junctionIndex, returnIndex: loop.returnIndex };
  }

  /**
   * Main lines: the vertical profile is designed against the terrain by the line generator ([s, y] every
   * ~100 m); it replaces the integrated gradients (smoothed into vertical curves).
   */
  applyProfile(profile) {
    const N = this.N, y = new Float32Array(N);
    let k = 0;
    for (let i = 0; i < N; i++) {
      while (k < profile.length - 2 && profile[k + 1][0] < i) k++;
      const [s0, y0] = profile[k], [s1, y1] = profile[Math.min(profile.length - 1, k + 1)];
      y[i] = s1 > s0 ? y0 + ((y1 - y0) * Math.max(0, Math.min(1, (i - s0) / (s1 - s0)))) : y0;
    }
    const sm = boxFilter(boxFilter(y, 90), 90);
    for (let i = 0; i < N; i++) this.py[i] = sm[i];
    for (let i = 0; i < N - 1; i++) this.grad[i] = (sm[i + 1] - sm[i]) * 1000;
    this.grad[N - 1] = this.grad[N - 2];
  }

  /** The loop is single track: its centreline moves onto the track (spacing → 0) over the first/last metres. */
  taperLoop(base) {
    const { J, Jr } = this.loop, RAMP = 70;
    for (let i = Math.ceil(J); i <= Math.floor(Jr); i++) {
      const w = smoothstep(0, RAMP, Math.min(i - J, Jr - i));
      const h = this.hd[i], sh = this.hs[i] * w;
      this.px[i] += Math.cos(h) * sh; this.pz[i] += Math.sin(h) * sh;
      this.hs[i] -= sh;
    }
    // Length of the shared chamber where the two branches' tunnels still overlap.
    let d = 0;
    for (; d < Math.min(400, (Jr - J) / 2); d += 1) {
      const a = this.point(J + d), b = this.point(Jr - d);
      if (Math.hypot(a.x - b.x, a.z - b.z) >= this.tunnelHalfWidthAt(J + d) + this.tunnelHalfWidthAt(Jr - d)) break;
    }
    this.loop.chamber = d;
  }

  /** Chainage of the outbound twin of a point on the return run (loop lines). */
  mirrorS(s) { return this.loop && s > this.loop.Jr ? this.loop.M - s : s; }

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
