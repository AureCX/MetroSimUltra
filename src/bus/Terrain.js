// Ground elevation of a bus network, from the network file:
//   "terrain": { "axis": "z", "profile": [[620, 0], [920, 9], [1210, 18]] }
// Piecewise-linear height (m) along one axis, constant before the first and after the last point.
// Breakpoints should sit on rows of road nodes, so straight road pieces between nodes follow it exactly.
export class Terrain {
  constructor(def) {
    this.axis = def?.axis === 'x' ? 'x' : 'z';
    this.profile = (def?.profile || []).map(([c, h]) => [Number(c), Number(h)]).sort((a, b) => a[0] - b[0]);
  }
  get flat() { return this.profile.length < 2 || this.profile.every(([, h]) => h === this.profile[0][1]); }
  /** Coordinates along the axis where the slope changes (for splitting large flat pieces). */
  get breaks() { return this.profile.map(([c]) => c); }
  heightAt(x, z) {
    const P = this.profile; if (!P.length) return 0;
    const c = this.axis === 'z' ? z : x;
    if (c <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) if (c <= P[i][0]) { const [c0, h0] = P[i - 1], [c1, h1] = P[i]; return h0 + ((h1 - h0) * (c - c0)) / (c1 - c0); }
    return P.at(-1)[1];
  }
  /** Gradient (‰, positive uphill) when moving in direction (dx, dz) at (x, z). */
  gradeAt(x, z, dx, dz) {
    const e = 2, n = Math.hypot(dx, dz) || 1, ux = dx / n, uz = dz / n;
    return ((this.heightAt(x + ux * e, z + uz * e) - this.heightAt(x - ux * e, z - uz * e)) / (2 * e)) * 1000;
  }
}
