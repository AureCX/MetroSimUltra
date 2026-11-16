// A Route is one direction of travel over a TrackGeometry. It exposes everything in
// "route chainage" r (metres, always increasing in the direction of travel), so all
// driving systems are direction-agnostic.
export class Route {
  constructor(line, geom, dir) {
    this.line = line;
    this.geom = geom;
    this.dir = dir;
    this.sign = dir === 'A' ? 1 : -1;
    this.length = geom.length;
    this.terminus = line.directions[dir].terminus;
    this.directionName = line.directions[dir].name;

    const order = dir === 'A' ? line.stations : [...line.stations].reverse();
    this.stops = order.map((st, k) => {
      const centerR = this.toRoute(geom.stationS[st.index]);
      const half = st.platformLength / 2;
      return {
        k,
        station: st,
        name: st.name,
        centerR,
        platformStartR: centerR - half,
        platformEndR: centerR + half,
        stopR: centerR + half - st.stopMarkerOffset,
        doorSide: st.platformType === 'island' ? 'left' : 'right',
        dwell: st.stopDuration,
        isTerminus: k === order.length - 1,
      };
    });
    this.buildLimits();
  }

  toTrack(r) { return this.sign > 0 ? r : this.length - r; }
  toRoute(t) { return this.sign > 0 ? t : this.length - t; }

  /** Lateral offset (track A frame: + = right of centreline) of this route's track centre. */
  trackLateral(r) { return this.sign * this.geom.halfSpacingAt(this.toTrack(r)); }

  /** World point at route chainage r; `side` metres to the right of the driver, `height` above rail. */
  point(r, side = 0, height = 0, out) {
    const t = this.toTrack(r);
    return this.geom.point(t, this.trackLateral(r) + this.sign * side, height, out);
  }

  /** Gradient in ‰, positive = uphill for a train on this route. */
  gradientAt(r) { return this.sign * this.geom.gradientAt(this.toTrack(r)); }
  radiusAt(r) { const c = Math.abs(this.geom.curvatureAt(this.toTrack(r))); return c > 1e-5 ? 1 / c : Infinity; }

  buildLimits() {
    const { line, geom } = this;
    const n = Math.ceil(this.length) + 2;
    const lim = new Float32Array(n).fill(line.maxSpeed);
    const S = geom.stationS;
    for (let r = 0; r < n; r++) {
      const t = this.toTrack(r);
      let sec = -1;
      for (let i = 0; i < S.length - 1; i++) if (t >= S[i] && t < S[i + 1]) { sec = i; break; }
      if (sec >= 0) lim[r] = Math.min(lim[r], line.stations[sec].speedLimit);
    }
    this.reasons = new Uint8Array(n); // 0 line, 1 approach, 2 restriction, 3 depot
    const apply = (a, b, v, reason) => {
      for (let r = Math.max(0, Math.floor(a)); r < Math.min(n, Math.ceil(b)); r++) if (v < lim[r]) { lim[r] = v; this.reasons[r] = reason; }
    };
    for (const stp of this.stops) {
      if (stp.k > 0) apply(stp.platformStartR - stp.station.approachDistance, stp.platformStartR + 20, stp.station.approachSpeedLimit, 1);
    }
    apply(0, this.stops[0].platformStartR, 30, 3);
    const last = this.stops.at(-1);
    apply(last.stopR + 1, n, 15, 3);
    for (const rs of line.speedRestrictions) {
      if (rs.direction && rs.direction !== this.dir) continue;
      const base = S[rs.fromStationIndex ?? 0];
      const a = this.toRoute(base + rs.start), b = this.toRoute(base + rs.end);
      apply(Math.min(a, b), Math.max(a, b), rs.limit, 2);
    }
    this.limits = lim;
  }

  /** Static line speed limit (km/h) at a single point. */
  limitAt(r) { return this.limits[Math.min(this.limits.length - 1, Math.max(0, Math.floor(r)))]; }

  /** Permitted static speed for a train occupying [front - length, front]: limit rises only once the tail clears. */
  permittedFor(front, length) {
    let m = Infinity;
    const a = Math.max(0, Math.floor(front - length)), b = Math.min(this.limits.length - 1, Math.floor(front));
    for (let r = a; r <= b; r++) if (this.limits[r] < m) m = this.limits[r];
    return m === Infinity ? this.limitAt(front) : m;
  }

  /** Next point ahead where the limit drops below `current`. */
  nextLimitChange(front, current, lookahead = 900) {
    const end = Math.min(this.limits.length - 1, Math.floor(front + lookahead));
    for (let r = Math.floor(front) + 1; r <= end; r++) {
      if (this.limits[r] < current - 0.1) return { distance: r - front, limit: this.limits[r], reason: this.reasons[r] };
    }
    return null;
  }

  nextStopIndex(front, served = -1) {
    for (const s of this.stops) if (s.k > served && s.stopR > front - 30) return s.k;
    return this.stops.length - 1;
  }
}
