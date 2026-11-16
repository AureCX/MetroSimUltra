// Other trains on the line: trains running ahead of the player (which drive the
// signalling) and trains in the opposite direction. Each follows its own timetable.
import { autoDriveAccel } from './AutoDriver.js';
import { Timetable } from '../stations/Timetable.js';

class AITrain {
  constructor(route, specs, timetable, id) {
    this.id = id;
    this.route = route;
    this.specs = specs;
    this.tt = timetable;
    this.k = 0;
    this.s = route.stops[0].stopR;
    this.v = 0;
    this.mode = 'waiting';    // waiting (before first dep) | run | dwell | done
    this.dwellUntil = timetable.start;
    this.doorOpen = 0;
    this.braking = 0;
    this.accel = 0;
  }
  get front() { return this.s; }
  get rear() { return this.s - this.specs.length; }

  step(dt, clock, authority) {
    const stops = this.route.stops;
    if (this.mode === 'done') return;
    if (this.mode === 'waiting' || this.mode === 'dwell') {
      const open = this.mode === 'dwell' && clock < this.dwellUntil - 4;
      this.doorOpen += ((open ? 1 : 0) - this.doorOpen) * Math.min(1, dt * 1.5);
      if (clock >= this.dwellUntil) {
        if (stops[this.k].isTerminus) { this.mode = 'done'; return; }
        this.mode = 'run'; this.k++;
      }
      this.accel = 0;
      return;
    }
    const stp = stops[this.k];
    const a = autoDriveAccel(this.route, this.s, this.v, stp.stopR, this.specs.length, { accel: 0.9, decel: 0.8, authority });
    this.accel = a;
    this.braking = a < -0.05 ? Math.min(1, -a / 0.8) : 0;
    this.v = Math.max(0, this.v + a * dt);
    this.s += this.v * dt;
    if (stp.stopR - this.s < 0.6 && this.v < 0.15) {
      this.v = 0;
      this.mode = 'dwell';
      const e = this.tt.entry(this.k);
      this.dwellUntil = Math.max(clock + Math.max(10, stp.dwell * 0.8), e.dep ?? clock + 20);
    }
  }
}

export class TrafficManager {
  constructor({ line, routes, specs, playerRoute, playerTimetable, startClock, bus }) {
    this.bus = bus;
    this.routes = routes;
    this.playerRoute = playerRoute;
    this.trains = [];
    this.specs = specs;
    this.line = line;
    const h = line.headway;
    const startT = playerTimetable.start;
    const runTime = playerTimetable.end - playerTimetable.start;
    let id = 0;
    // Same direction: two trains ahead of the player.
    for (let n = 1; n <= 2; n++) {
      const tt = this._shifted(playerTimetable, -n * h, playerRoute);
      this.trains.push(new AITrain(playerRoute, specs, tt, id++));
    }
    // Opposite direction: enough departures to fill the whole run.
    const other = routes[playerRoute.dir === 'A' ? 'B' : 'A'];
    const base = new Timetable(other, specs, line.startTime);
    const otherRun = base.end - base.start;
    const first = startT - otherRun - 60, last = startT + runTime + 600;
    const phase = h * 0.37;
    for (let t = first; t <= last; t += h) {
      const tt = this._shifted(base, t + phase - base.start, other);
      this.trains.push(new AITrain(other, specs, tt, id++));
    }
    this.pending = this.trains;
    // Pre-simulate to the session start so traffic is already flowing.
    this.clock = Math.min(...this.trains.map((t) => t.tt.start)) - 1;
    this.advanceTo(startClock);
  }

  _shifted(tt, offset, route) {
    const copy = Object.create(Timetable.prototype);
    copy.route = route;
    copy.entries = tt.entries.map((e) => ({ ...e, arr: e.arr == null ? null : e.arr + offset, dep: e.dep == null ? null : e.dep + offset }));
    return copy;
  }

  advanceTo(clock) {
    const dt = 0.25;
    while (this.clock < clock) { this.step(Math.min(dt, clock - this.clock), this.clock); this.clock += dt; }
    this.clock = clock;
  }

  /** Trains on a given route that are currently on the line. */
  activeOn(route) { return this.trains.filter((t) => t.route === route && t.mode !== 'done' && (t.mode !== 'waiting' || t.tt.start - this.clock < 90)); }

  step(dt, clock) {
    this.clock = clock;
    for (const route of Object.values(this.routes)) {
      const list = this.trains.filter((t) => t.route === route && t.mode !== 'done').sort((a, b) => b.s - a.s);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (t.mode === 'waiting' && clock < t.tt.start - 90) continue;
        const ahead = list[i - 1];
        const authority = ahead && ahead.s > t.s ? ahead.rear - 60 : null;
        t.step(dt, clock, authority);
      }
    }
  }
}
