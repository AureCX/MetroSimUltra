// Driving evaluation for bus shifts: stop accuracy, punctuality, passenger comfort and
// penalties for speeding, harsh braking / acceleration, red lights, collisions, kerb strikes,
// missed stops, early departures, doors operated while moving and missing indicators.
export class BusScoring {
  constructor(bus) {
    this.bus = bus;
    this.penalties = []; this.stops = []; this.cool = {};
    this.comfort = 100;
    this.offs = [
      bus.on('bus:arrived', (e) => { this.current = e; }),
      bus.on('bus:departed', (e) => this.onDepart(e)),
      bus.on('bus:missedStop', (e) => this.add(150, `Missed stop: ${e.stop.stop.name}`)),
      bus.on('bus:doorWhileMoving', () => this.add(60, 'Door operated while moving', 'door')),
      bus.on('bus:passengersStagger', () => { this.comfort -= 4; this.add(15, 'Standing passengers thrown off balance', 'stagger'); }),
    ];
  }
  add(points, text, cooldownKey, cooldown = 3, now = performance.now() / 1000) {
    if (cooldownKey) { if ((this.cool[cooldownKey] ?? -99) > now - cooldown) return false; this.cool[cooldownKey] = now; }
    this.penalties.push({ points, text });
    this.bus.emit('bus:penalty', { points, text });
    return true;
  }
  onDepart(e) {
    const a = this.current;
    if (!a || a.k !== e.k) return;
    if (!e.served) return;
    const err = Math.abs(a.error);
    const acc = err <= 1.0 ? 100 : Math.max(0, Math.round(100 - ((err - 1) / 5) * 100));
    const d = Math.abs(e.delay);
    const punct = d <= 60 ? 100 : Math.max(0, Math.round(100 - ((d - 60) / 240) * 100));
    this.stops.push({ name: e.stop.stop.name, error: a.error, delay: e.delay, acc, punct });
    if (err > 3) this.add(20, `Poor stopping position at ${e.stop.stop.name} (${a.error.toFixed(1)} m)`);
    if (e.early) this.add(80, `Left ${e.stop.stop.name} ahead of schedule`);
  }
  /** Called every frame with the vehicle state. */
  sample(dt, s) {
    if (s.v * 3.6 > s.limit + 6) { this.overT = (this.overT || 0) + dt; if (this.overT > 2) { this.overT = 0; this.add(10, `Speeding (${Math.round(s.v * 3.6)} in a ${s.limit} zone)`, 'speed', 4); } } else this.overT = 0;
    if (s.ax < -3.4 && !s.emergency && s.v > 2) { if (this.add(15, 'Harsh braking', 'brake', 3)) this.comfort -= 3; }
    if (s.ax > 1.7) { if (this.add(10, 'Dangerous acceleration', 'accel', 4)) this.comfort -= 2; }
    if (Math.abs(s.ay) > 2.7 && s.v > 3) { if (this.add(10, 'Cornering too fast for passengers', 'lat', 4)) this.comfort -= 3; }
  }
  result(completed) {
    const pts = this.stops.reduce((a, s) => a + s.acc + s.punct, 0);
    const max = Math.max(1, this.stops.length * 200);
    const pen = this.penalties.reduce((a, p) => a + p.points, 0);
    const score = Math.max(0, Math.round(((pts - pen) / max) * 1000));
    const pct = score / 10;
    const grade = !completed ? 'F' : pct >= 95 ? 'S' : pct >= 85 ? 'A' : pct >= 70 ? 'B' : pct >= 55 ? 'C' : pct >= 40 ? 'D' : 'E';
    const grouped = {};
    for (const p of this.penalties) { const k = p.text.replace(/\(.*\)/, '').trim(); grouped[k] ||= { text: k, points: 0, count: 0 }; grouped[k].points += p.points; grouped[k].count++; }
    return { score, grade, stops: this.stops, penalties: Object.values(grouped), penaltyTotal: pen, comfort: Math.max(0, Math.round(this.comfort)) };
  }
  dispose() { this.offs.forEach((f) => f()); }
}
