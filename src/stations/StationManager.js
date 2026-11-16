// Station stopping logic: alignment / door positioning, precise stop measurement,
// dwell management, departure authorisation and schedule performance.
export class StationManager {
  constructor(route, timetable, train, bus, settings) {
    this.route = route;
    this.tt = timetable;
    this.train = train;
    this.bus = bus;
    this.settings = settings;
    this.atStop = 0;          // index of stop the train is standing at, or null when running
    this.nextStop = 1;
    this.dwell = { started: false, elapsed: 0, opened: false, authorized: false, boardingDone: true };
    this.lastDelay = 0;
    this.boardingPending = () => 0; // injected by passenger system
    this.finished = false;
    this.served = [];
  }

  stop(k) { return this.route.stops[k]; }

  /** Door alignment against the platform the train stands at (or would stand at). */
  alignment() {
    const front = this.train.front;
    const k = this.atStop ?? this.nextStop;
    const stp = this.stop(k);
    if (!stp) return { ok: false, reason: 'No platform here.' };
    const offs = this.train.doorOffsets();
    const outside = offs.filter((o) => { const p = front - o; return p < stp.platformStartR + 0.6 || p > stp.platformEndR - 0.6; }).length;
    if (outside === offs.length) return { ok: false, reason: 'Not at a platform.', stop: stp };
    if (outside > 0) return { ok: false, reason: `${outside} door(s) outside the platform — re-position the train.`, stop: stp, outside };
    return { ok: true, side: stp.doorSide, stop: stp, error: front - stp.stopR };
  }

  update(dt, clock) {
    const front = this.train.front, v = this.train.speed;
    if (this.finished) return;
    if (this.atStop == null) {
      const stp = this.stop(this.nextStop);
      if (Math.abs(v) < 0.03) {
        const al = this.alignment();
        if (al.ok) this._arrive(stp, al.error, clock);
      }
      if (this.atStop == null && front > stp.platformEndR + 3 && !stp.isTerminus) {
        this.bus.emit('station:missed', { stop: stp });
        this.served.push({ k: stp.k, missed: true });
        this.nextStop = Math.min(this.nextStop + 1, this.route.stops.length - 1);
      }
      return;
    }
    // Standing at a stop.
    const stp = this.stop(this.atStop);
    const d = this.dwell;
    const doors = this.train.doors;
    if (doors.anyOpen && !d.started) { d.started = true; d.opened = true; this.bus.emit('station:dwellStart', { stop: stp }); }
    if (d.started) d.elapsed += dt;
    d.boardingDone = this.boardingPending(stp) === 0;
    const entry = this.tt.entry(stp.k);
    const late = entry.dep != null && clock > entry.dep;
    const minDwell = late ? Math.max(8, stp.dwell * 0.6) : stp.dwell;
    const wasAuth = d.authorized;
    d.authorized = !stp.isTerminus && d.opened && d.elapsed >= minDwell && d.boardingDone && (entry.dep == null || clock >= entry.dep - 6);
    if (d.authorized && !wasAuth) this.bus.emit('station:departureAuthorized', { stop: stp });
    if (stp.isTerminus && d.opened && d.elapsed > 6 && d.boardingDone) {
      this.finished = true;
      this.bus.emit('run:complete', { stop: stp });
      return;
    }
    // Departure detected once the train moves off.
    if (front > stp.stopR + 2 || (v > 0.4 && front > stp.stopR - 3)) {
      const delay = entry.dep != null ? clock - entry.dep : 0;
      this.lastDelay = delay;
      this.bus.emit('station:departed', { stop: stp, early: !d.authorized, doorsNeverOpened: !d.opened, delay, unboarded: this.boardingPending(stp) });
      this.atStop = null;
      this.nextStop = stp.k + 1;
      this.dwell = { started: false, elapsed: 0, opened: false, authorized: false, boardingDone: true };
    }
  }

  _arrive(stp, error, clock) {
    const entry = this.tt.entry(stp.k);
    const delay = entry.arr != null ? clock - entry.arr : 0;
    this.lastDelay = delay;
    this.atStop = stp.k;
    this.served.push({ k: stp.k, error, delay });
    this.bus.emit('station:arrived', { stop: stp, error, delay, tolerance: this.settings.get('gameplay.stopTolerance') });
  }

  /** Info for HUD / DMI. */
  info(clock) {
    const k = this.atStop ?? this.nextStop;
    const stp = this.stop(k);
    const entry = this.tt.entry(k);
    let delay = this.lastDelay;
    if (this.atStop == null && entry.arr != null && clock > entry.arr) delay = Math.max(delay, clock - entry.arr);
    if (this.atStop != null && entry.dep != null && clock > entry.dep && !this.dwell.authorized) delay = Math.max(delay, clock - entry.dep);
    return {
      stop: stp,
      standing: this.atStop != null,
      distance: stp.stopR - this.train.front,
      schedArr: entry.arr, schedDep: entry.dep,
      delay,
      dwell: this.dwell,
    };
  }
}
