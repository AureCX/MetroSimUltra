// Lineside signalling for one route. Supports:
//  - "fixed-block": automatic 3-aspect block signals (red / yellow / green), with
//    starter and home signals at stations, overlaps and SPAD detection.
//  - "cbtc": moving block; no lineside block signals, the cab receives a limit of
//    movement authority computed from the train ahead.
export class SignalSystem {
  constructor(route, line, bus) {
    this.route = route;
    this.bus = bus;
    this.cfg = line.signaling;
    this.system = this.cfg.system;
    this.signals = [];
    this.lastFront = null;
    this.hold = null; // chainage the train must not pass (junction with no route set)
    this.build();
  }

  build() {
    const { stops } = this.route;
    const add = (r, kind, label) => this.signals.push({ id: this.signals.length, r, kind, label, aspect: 'green', aspectOthers: 'green' });
    if (this.system === 'fixed-block') {
      for (let k = 0; k < stops.length - 1; k++) {
        const a = stops[k].stopR + 12;
        const b = stops[k + 1].platformStartR - 25;
        add(a, 'starter', `${stops[k].name} starter`);
        const gap = b - a;
        const n = Math.max(0, Math.ceil(gap / this.cfg.blockLength) - 1);
        for (let i = 1; i <= n; i++) add(a + (gap * i) / (n + 1), 'block', 'Block signal');
        add(b, 'home', `${stops[k + 1].name} home`);
      }
    }
    add(stops.at(-1).stopR + 12, 'end', 'End of line');
    this.signals.sort((x, y) => x.r - y.r);
    this.signals.forEach((s, i) => { s.id = i; s.number = `${this.route.dir}${String(i + 1).padStart(3, '0')}`; });
  }

  _aspects(trains, key) {
    const sig = this.signals, ov = this.cfg.overlap;
    let nextAspect = 'red';
    for (let j = sig.length - 1; j >= 0; j--) {
      const s = sig[j];
      let aspect;
      if (s.kind === 'end') aspect = 'red';
      else {
        const blockEnd = (sig[j + 1]?.r ?? this.route.length) + ov;
        const occupied = trains.some((t) => t.front > s.r && t.rear < blockEnd);
        aspect = occupied ? 'red' : nextAspect === 'red' ? 'yellow' : 'green';
      }
      s[key] = aspect;
      nextAspect = aspect;
    }
  }

  /** others: [{front, rear}] trains ahead on this route; player: {front, rear}. */
  update(others, player) {
    this._aspects(others, 'aspectOthers');
    this._aspects([...others, player], 'aspect');
    if (this.hold != null) {
      // The last signal before the held point protects the junction: force it to danger.
      let k = -1;
      this.signals.forEach((s, i) => { if (s.r <= this.hold) k = i; });
      if (k >= 0) {
        this.signals[k].aspect = this.signals[k].aspectOthers = 'red';
        const prev = this.signals[k - 1];
        if (prev && prev.aspectOthers === 'green') prev.aspectOthers = 'yellow';
        if (prev && prev.aspect === 'green') prev.aspect = 'yellow';
      }
    }
    if (this.lastFront != null) {
      for (const s of this.signals) {
        if (this.lastFront < s.r && player.front >= s.r) this.bus.emit('signal:passed', { signal: s, aspect: s.aspectOthers });
      }
    }
    this.lastFront = player.front;

    // Movement authority.
    if (this.system === 'cbtc') {
      let eoa = this.route.length - 15;
      for (const t of others) if (t.rear > player.front && t.rear - 45 < eoa) eoa = t.rear - 45;
      const end = this.signals.at(-1);
      if (player.front < end.r) eoa = Math.min(eoa, end.r - 3);
      if (this.hold != null && player.front < this.hold) eoa = Math.min(eoa, this.hold);
      this.authority = eoa;
    } else {
      const red = this.signals.find((s) => s.r > player.front - 0.5 && s.aspectOthers === 'red');
      this.authority = red ? red.r - 3 : null;
    }
  }

  nextSignal(front) {
    const s = this.signals.find((x) => x.r > front);
    return s ? { signal: s, distance: s.r - front } : null;
  }
}
