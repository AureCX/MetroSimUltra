// Bus sounds on the shared Web Audio graph: diesel engine (rpm & load), electric motor whine,
// tyre/road noise (wet hiss), wind, air brakes, doors, door warning, indicator relay, horn,
// rain on the windscreen, passenger chatter, city traffic ambience, validator / stop-request chimes.
export class BusAudio {
  constructor(audio) {
    this.a = audio;
    this.on = false;
  }
  start(electric) {
    const a = this.a; if (!a.started) return;
    const ctx = a.ctx, c = this.c = {};
    const gain = (v, dest = a.fx) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };
    const filt = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.nodes = [];
    const osc = (type, dest) => { const o = ctx.createOscillator(); o.type = type; o.connect(dest); o.start(); this.nodes.push(o); return o; };
    const noise = (brown, dest) => { const s = a.noiseSource(brown); s.connect(dest); this.nodes.push(s); return s; };
    // Diesel: firing frequency harmonics + combustion noise.
    c.engG = gain(0); c.engLP = filt('lowpass', 500, 0.9); c.engLP.connect(c.engG);
    c.e1 = osc('sawtooth', c.engLP); c.e2 = osc('square', c.engLP); c.e3 = osc('sawtooth', c.engLP);
    c.combG = gain(0); const cbp = filt('bandpass', 180, 1.2); cbp.connect(c.combG); noise(true, cbp);
    // Electric motor whine.
    c.motG = gain(0); c.mot = osc('sine', c.motG); c.mot2 = osc('triangle', c.motG);
    // Tyres / road.
    c.roadG = gain(0); c.roadLP = filt('lowpass', 300, 0.7); c.roadLP.connect(c.roadG); noise(true, c.roadLP);
    c.wetG = gain(0); const whp = filt('highpass', 1500, 0.7); whp.connect(c.wetG); noise(false, whp);
    // Wind, rain on the windscreen, passengers, traffic ambience.
    c.windG = gain(0, a.amb); const wbp = filt('bandpass', 500, 0.6); wbp.connect(c.windG); noise(false, wbp);
    c.rainG = gain(0, a.amb); const rbp = filt('bandpass', 3000, 0.5); rbp.connect(c.rainG); noise(false, rbp);
    c.chatG = gain(0, a.amb); const chp = filt('bandpass', 700, 1.4); chp.connect(c.chatG); noise(true, chp);
    c.chatLfo = osc('sine', ctx.createGain()); c.chatLfo.frequency.value = 0.7;
    c.trafG = gain(0, a.amb); const tlp = filt('lowpass', 250, 0.6); tlp.connect(c.trafG); noise(true, tlp);
    // Horn.
    c.hornG = gain(0); const hl = filt('lowpass', 1800, 0.8); hl.connect(c.hornG); osc('sawtooth', hl).frequency.value = 311; osc('sawtooth', hl).frequency.value = 415;
    this.electric = electric; this.on = true;
  }
  set(p, v, tc = 0.08) { p.setTargetAtTime(v, this.a.ctx.currentTime, tc); }

  update(dt, s) {
    if (!this.on) return;
    const c = this.c, vk = Math.abs(s.v) * 3.6, cab = s.cab ? 1 : 0.6;
    if (this.electric) {
      this.set(c.engG.gain, 0); this.set(c.combG.gain, 0);
      this.set(c.mot.frequency, 200 + vk * 38); this.set(c.mot2.frequency, 420 + vk * 76);
      this.set(c.motG.gain, s.engineOn ? (0.004 + Math.abs(s.load) * 0.03) * Math.min(1, vk / 6 + 0.15) : 0);
    } else {
      const f = (s.rpm / 60) * 3; // 6-cylinder four-stroke firing frequency
      this.set(c.e1.frequency, f); this.set(c.e2.frequency, f * 0.5); this.set(c.e3.frequency, f * 2.01);
      this.set(c.engLP.frequency, 220 + s.rpm * 0.25 + s.throttle * 400);
      this.set(c.engG.gain, s.engineOn ? (0.03 + s.throttle * 0.05) * cab : 0);
      this.set(c.combG.gain, s.engineOn ? (0.04 + s.throttle * 0.08) * (s.rpm / 2000) : 0);
      this.set(c.motG.gain, s.hybridAssist ? 0.015 : 0); this.set(c.mot.frequency, 300 + vk * 30);
    }
    this.set(c.roadLP.frequency, 120 + vk * 18);
    this.set(c.roadG.gain, Math.min(1, vk / 25) * (0.08 + vk / 500));
    this.set(c.wetG.gain, s.wet ? Math.min(1, vk / 30) * 0.05 : 0, 0.3);
    this.set(c.windG.gain, Math.pow(vk / 80, 2) * 0.12);
    this.set(c.rainG.gain, s.rain * 0.06 * (s.cab ? 1 : 0.5), 0.5);
    this.set(c.chatG.gain, Math.min(0.05, s.passengers * 0.0012) * (s.cab ? 1 : 0.2), 0.8);
    this.set(c.trafG.gain, 0.02 + s.traffic * 0.05, 1.0);
    this.set(c.hornG.gain, s.horn ? 0.1 : 0, 0.02);
    // Air brake release "pssht" when the pedal comes up after a stop.
    if (this.prevBrake > 0.3 && s.brake < 0.05 && vk < 5) this.a.hiss(0.9, { gain: 0.09, freq: 2200 });
    this.prevBrake = s.brake;
  }
  // One-shot effects.
  crank(electric) { if (electric) { this.a.tone(880, 0.12, { gain: 0.05 }); this.a.tone(1320, 0.18, { gain: 0.05, at: 0.15 }); } else { for (let i = 0; i < 6; i++) this.a.thunk(i * 0.18, 0.25); this.a.hiss(1.2, { gain: 0.04, freq: 300, type: 'lowpass' }); } }
  door(open) { this.a.hiss(1.1, { gain: 0.1, freq: 1400 }); this.a.thunk(open ? 1.4 : 1.6, open ? 0.12 : 0.3); }
  doorWarning() { for (let i = 0; i < 3; i++) this.a.tone(1200, 0.12, { at: i * 0.3, gain: 0.06, type: 'square' }); }
  tick(on) { this.a.tone(on ? 2200 : 1700, 0.012, { type: 'square', gain: 0.05 }); }
  parking(on) { this.a.hiss(on ? 1.4 : 0.6, { gain: on ? 0.16 : 0.08, freq: on ? 900 : 1800 }); }
  kneel() { this.a.hiss(2.2, { gain: 0.1, freq: 700, type: 'lowpass' }); }
  shift() { this.a.thunk(0, 0.08); }
  validate(ok) { this.a.tone(ok ? 1760 : 440, 0.12, { gain: 0.05 }); }
  stopRequest() { this.a.tone(1046, 0.25, { gain: 0.06, type: 'triangle' }); this.a.tone(784, 0.35, { at: 0.25, gain: 0.06, type: 'triangle' }); }
  collision(k) { this.a.crash(k, false); }

  /** Layered impact sound scaled by severity k (0..~1.4): metal impact, glass, bodywork, mechanical, alarm. */
  impact({ k, glass, deform, mechanical }) {
    const a = this.a; if (!a.started) return;
    const ctx = a.ctx, t0 = ctx.currentTime + 0.005;
    const burst = (buf, f, q, type, gain, dur, at = 0, sweepTo = null) => {
      const n = ctx.createBufferSource(); n.buffer = buf;
      const fl = a.filter(type, f, q); const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t0 + at + dur);
      n.connect(fl).connect(g).connect(a.fx); n.start(t0 + at); n.stop(t0 + at + dur + 0.05);
    };
    if (k < 0.25) { a.thunk(0, 0.15 + k); burst(a.noise, 2600, 3, 'bandpass', 0.05 + k * 0.2, 0.25); return; } // scrape / knock
    a.crash(Math.min(1.2, k), false);                                                 // metal impact
    if (deform) for (let i = 0; i < 3; i++) burst(a.brown, 420 - i * 90, 6, 'bandpass', 0.12 * k, 0.5 + i * 0.25, 0.08 + i * 0.12, 160); // panels buckling
    if (glass) for (let i = 0; i < 9; i++) burst(a.noise, 5200 + Math.random() * 3000, 8, 'bandpass', 0.06 + 0.05 * k, 0.05 + Math.random() * 0.12, 0.05 + Math.random() * 0.5); // glass shattering
    if (mechanical) { burst(a.brown, 140, 4, 'bandpass', 0.2, 1.2, 0.3, 70); a.tone(55, 1.0, { at: 0.3, gain: 0.05, type: 'sawtooth' }); }
  }
  /** Passengers' reaction: gasps and cries (formant-filtered noise bursts). */
  passengersReact(k) {
    const a = this.a; if (!a.started) return;
    const ctx = a.ctx;
    for (let i = 0; i < 3 + Math.round(k * 5); i++) {
      const at = ctx.currentTime + 0.15 + Math.random() * 0.6, dur = 0.25 + Math.random() * 0.5;
      const n = ctx.createBufferSource(); n.buffer = a.noise;
      const f1 = a.filter('bandpass', 650 + Math.random() * 500, 7), f2 = a.filter('bandpass', 1500 + Math.random() * 900, 9);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.06 + 0.06 * k, at + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      f1.frequency.exponentialRampToValueAtTime(f1.frequency.value * (1.2 + Math.random() * 0.5), at + dur);
      n.connect(f1).connect(f2).connect(g).connect(a.amb); n.start(at); n.stop(at + dur + 0.05);
    }
  }
  /** Dashboard emergency alarm after a severe collision. */
  alarm() { for (let i = 0; i < 6; i++) { this.a.tone(1480, 0.18, { at: i * 0.4, gain: 0.07, type: 'square' }); this.a.tone(990, 0.18, { at: i * 0.4 + 0.2, gain: 0.07, type: 'square' }); } }
  kerb() { this.a.thunk(0, 0.35); }
  stop() { if (!this.on) return; for (const n of this.nodes) { try { n.stop(); } catch { /* */ } } this.on = false; for (const g of Object.values(this.c)) g.disconnect?.(); }
}
