// Working timetable for one run. Run times come from the line file ("runTime") when
// provided, otherwise from an ideal-driver simulation of the chosen train plus a recovery margin.
import { estimateRunTime } from '../traffic/AutoDriver.js';
import { parseClock } from '../core/util.js';

export class Timetable {
  constructor(route, train, startClock, offset = 0) {
    this.route = route;
    const perf = { accel: Math.min(0.95, train.maxAccel * 0.85), decel: Math.min(0.8, train.serviceDecel * 0.75) };
    let clock = parseClock(startClock) + offset;
    this.entries = [];
    route.stops.forEach((stp, k) => {
      if (k === 0) { this.entries.push({ k, name: stp.name, arr: null, dep: clock, dwell: stp.dwell }); return; }
      const prev = route.stops[k - 1];
      const given = route.dir === 'A' ? prev.station.runTime : stp.station.runTime;
      const run = given ?? Math.ceil((estimateRunTime(route, prev.stopR, stp.stopR, train.length, perf) * 1.06 + 4) / 5) * 5;
      clock += run;
      const arr = clock;
      clock += stp.dwell;
      this.entries.push({ k, name: stp.name, arr, dep: stp.isTerminus ? null : clock, dwell: stp.dwell, run });
    });
  }
  entry(k) { return this.entries[k]; }
  get start() { return this.entries[0].dep; }
  get end() { return this.entries.at(-1).arr; }
}
