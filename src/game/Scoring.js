// Driver performance evaluation: stopping accuracy, punctuality, safety and comfort.
export class Scoring {
  constructor(bus, settings) {
    this.settings = settings;
    this.stops = [];
    this.penalties = [];
    this.events = [];
    this.comfortAcc = 0;
    this.offs = [
      bus.on('station:arrived', (e) => this.onArrive(e)),
      bus.on('station:departed', (e) => this.onDepart(e)),
      bus.on('station:missed', (e) => this.penalty(250, `Missed stop at ${e.stop.name}`)),
      bus.on('safety:emergency', (e) => { if (!e.driver) this.penalty(e.reason?.startsWith('SPAD') ? 0 : 150, e.reason); }),
      bus.on('doors:refused', (e) => { if (e.wrongSide) this.penalty(25, 'Door release attempted on the wrong side'); }),
    ];
  }
  penalty(points, text) { if (points > 0) this.penalties.push({ points, text }); this.events.push({ type: 'penalty', points, text }); }

  onArrive({ stop, error, delay, tolerance }) {
    if (stop.k === 0) return;
    const e = Math.abs(error);
    const acc = e <= tolerance ? 100 : Math.max(0, Math.round(100 - ((e - tolerance) / (8 - tolerance)) * 100));
    const d = Math.abs(delay);
    const punct = d <= 30 ? 100 : Math.max(0, Math.round(100 - ((d - 30) / 150) * 100));
    this.stops.push({ name: stop.name, error, delay, acc, punct });
  }
  onDepart({ stop, early, doorsNeverOpened, unboarded }) {
    if (doorsNeverOpened) this.penalty(200, `Doors never opened at ${stop.name}`);
    else if (early) this.penalty(60, `Departed ${stop.name} without authorisation`);
    if (unboarded > 0) this.penalty(Math.min(80, unboarded * 3), `${unboarded} passenger(s) left behind at ${stop.name}`);
  }
  spad(signal) { this.penalty(300, `SPAD: signal ${signal.number} passed at danger`); }
  driverEmergency(speedKmh) { if (speedKmh > 5) this.penalty(30, 'Emergency brake used in service'); }

  /** Called each sim step. */
  sample(dt, { jerk, accel, overspeed }) {
    if (overspeed !== 'none') { this.overTime = (this.overTime || 0) + dt; if (this.overTime > 1) { this.overTime -= 1; this.penalty(5, 'Overspeed'); } }
    if (Math.abs(jerk) > 1.6 || accel < -1.35) { this.comfortAcc += dt; if (this.comfortAcc > 1) { this.comfortAcc = 0; this.penalty(4, 'Uncomfortable ride (harsh jerk/braking)'); } }
  }

  result(completed = true) {
    const pts = this.stops.reduce((a, s) => a + s.acc + s.punct, 0);
    const max = Math.max(1, this.stops.length * 200);
    const pen = this.penalties.reduce((a, p) => a + p.points, 0);
    const score = Math.max(0, Math.round(((pts - pen) / max) * 1000));
    const pct = score / 10;
    const grade = !completed ? 'F' : pct >= 95 ? 'S' : pct >= 85 ? 'A' : pct >= 70 ? 'B' : pct >= 55 ? 'C' : pct >= 40 ? 'D' : 'E';
    const grouped = {};
    for (const p of this.penalties) { const k = p.text.replace(/\d+ passenger/, 'N passenger'); grouped[k] = grouped[k] || { text: p.text, points: 0, count: 0 }; grouped[k].points += p.points; grouped[k].count++; }
    return { score, grade, stops: this.stops, penalties: Object.values(grouped), penaltyTotal: pen };
  }
  dispose() { this.offs.forEach((f) => f()); }
}
