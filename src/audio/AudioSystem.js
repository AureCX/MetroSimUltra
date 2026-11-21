// Procedural, speed-reactive sound design with the Web Audio API (no sample files needed):
// traction motors & inverter whine, rolling noise, rail joints, tunnel wind, flange & brake squeal,
// cab equipment, door chimes, alarms, horn and platform ambience.
export class AudioSystem {
  constructor(settings, bus) {
    this.settings = settings;
    this.bus = bus;
    this.ctx = null;
    this.started = false;
    this.jointAcc = 0;
    this.compTimer = 30;
    this.alarm = null;
    this.exterior = false;
    bus.on('settings:changed', ({ path }) => { if (path.startsWith('audio') || path === '*') this.applyVolumes(); });
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // Every gameplay sound goes through the session bus (muted between sessions); menu sounds use the UI bus.
    this.sessionBus = ctx.createGain(); this.sessionBus.gain.value = 0; this.sessionBus.connect(this.master);
    this.ui = ctx.createGain(); this.ui.connect(this.master);
    this.fx = ctx.createGain(); this.fx.connect(this.sessionBus);
    this.amb = ctx.createGain(); this.amb.connect(this.sessionBus);
    this.voice = ctx.createGain(); this.voice.connect(this.sessionBus);
    this.applyVolumes();
    this.noise = this.makeNoise(3);
    this.brown = this.makeNoise(3, true);
    this.buildContinuous();
    // From here on, every source created belongs to the current session and is stopped when it ends.
    this.live = new Set();
    for (const fn of ['createOscillator', 'createBufferSource']) {
      const orig = ctx[fn].bind(ctx);
      ctx[fn] = () => { const n = orig(); this.live.add(n); n.addEventListener('ended', () => this.live.delete(n)); return n; };
    }
    this.started = true;
    if (this.inSession) this.sessionBus.gain.value = 1;
  }

  // ---- gameplay audio sessions ----
  /**
   * Starts a gameplay session (metro, TGV or bus run): resets the per-run state and opens the session bus.
   * Only the session that is current may play: timers created with later() die with their session.
   */
  beginSession() {
    this.endSession();
    this.sessionId = (this.sessionId || 0) + 1;
    this.inSession = true;
    this.jointAcc = 0; this.compTimer = 30; this.exterior = false;
    if (this.ctx) { const t = this.ctx.currentTime; this.sessionBus.gain.cancelScheduledValues(t); this.sessionBus.gain.setValueAtTime(1, t); }
    return this.sessionId;
  }
  /**
   * Ends the gameplay session: silences every loop (engine, rolling, wind, ambience, horn, compressor…), stops
   * every source started during the session (announcements, chimes, bus engine…), clears the alarm and pending
   * timers, cancels speech, and mutes the session bus. Safe to call several times.
   */
  endSession() {
    this.sessionId = (this.sessionId || 0) + 1;     // invalidates later() callbacks and in-flight announcements
    this.inSession = false;
    clearInterval(this.alarmTimer); this.alarm = null;
    for (const id of this.timers || []) clearTimeout(id);
    this.timers = new Set();
    if ('speechSynthesis' in globalThis) { try { speechSynthesis.cancel(); } catch { /* */ } }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sessionBus.gain.cancelScheduledValues(t); this.sessionBus.gain.setValueAtTime(0, t);
    for (const [k, n] of Object.entries(this.c || {})) if (k.endsWith('Gain')) { n.gain.cancelScheduledValues(t); n.gain.setValueAtTime(k === 'fanGain' ? 0.018 : 0, t); }
    for (const n of this.live || []) { try { n.stop(); } catch { /* not started / already stopped */ } }
    this.live?.clear();
  }
  /** setTimeout bound to the current session (never fires after the player left it). */
  later(fn, ms) {
    const sid = this.sessionId;
    this.timers ??= new Set();
    const id = setTimeout(() => { this.timers.delete(id); if (sid === this.sessionId && this.inSession) fn(); }, ms);
    this.timers.add(id);
    return id;
  }
  /** True while `sid` is still the current session. */
  alive(sid) { return this.inSession && sid === this.sessionId; }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.get('audio');
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master, t, 0.05);
    this.fx.gain.setTargetAtTime(a.effects, t, 0.05);
    this.amb.gain.setTargetAtTime(a.ambient, t, 0.05);
    this.voice.gain.setTargetAtTime(a.announcements, t, 0.05);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  makeNoise(sec, brown = false) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  noiseSource(brown = false) {
    const s = this.ctx.createBufferSource(); s.buffer = brown ? this.brown : this.noise; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 2);
    return s;
  }
  gainNode(v = 0, dest = this.fx) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(dest); return g; }
  filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  buildContinuous() {
    const ctx = this.ctx;
    const c = this.c = {};
    // Traction motors: two detuned saws through a low-pass.
    c.motorGain = this.gainNode(0);
    c.motorLP = this.filter('lowpass', 900, 0.8); c.motorLP.connect(c.motorGain);
    c.motorA = ctx.createOscillator(); c.motorA.type = 'sawtooth'; c.motorA.connect(c.motorLP); c.motorA.start();
    c.motorB = ctx.createOscillator(); c.motorB.type = 'sawtooth'; c.motorB.detune.value = 12; c.motorB.connect(c.motorLP); c.motorB.start();
    // Inverter carrier whine.
    c.invGain = this.gainNode(0);
    c.invBP = this.filter('bandpass', 1200, 6); c.invBP.connect(c.invGain);
    c.inv = ctx.createOscillator(); c.inv.type = 'square'; c.inv.connect(c.invBP); c.inv.start();
    // Rolling noise.
    c.rollGain = this.gainNode(0);
    c.rollLP = this.filter('lowpass', 300, 0.7); c.rollLP.connect(c.rollGain);
    this.noiseSource(true).connect(c.rollLP);
    // Tunnel wind.
    c.windGain = this.gainNode(0, this.amb);
    c.windBP = this.filter('bandpass', 500, 0.6); c.windBP.connect(c.windGain);
    this.noiseSource().connect(c.windBP);
    // Flange squeal in tight curves.
    c.flGain = this.gainNode(0);
    c.flBP = this.filter('bandpass', 3800, 18); c.flBP.connect(c.flGain);
    this.noiseSource().connect(c.flBP);
    // Brake squeal at low speed.
    c.bsGain = this.gainNode(0);
    c.bs = ctx.createOscillator(); c.bs.type = 'triangle'; c.bs.frequency.value = 2900; c.bs.connect(c.bsGain); c.bs.start();
    c.bsLfo = ctx.createOscillator(); c.bsLfo.frequency.value = 6; const lg = ctx.createGain(); lg.gain.value = 40; c.bsLfo.connect(lg).connect(c.bs.frequency); c.bsLfo.start();
    // Cab ventilation hum.
    c.fanGain = this.gainNode(0.018, this.amb);
    const fanLP = this.filter('lowpass', 420, 0.5); fanLP.connect(c.fanGain); this.noiseSource(true).connect(fanLP);
    // Air compressor (cycles on/off).
    c.compGain = this.gainNode(0, this.amb);
    const compLP = this.filter('lowpass', 380, 1); compLP.connect(c.compGain);
    c.comp = ctx.createOscillator(); c.comp.type = 'square'; c.comp.frequency.value = 48; c.comp.connect(compLP); c.comp.start();
    // Platform crowd murmur.
    c.crowdGain = this.gainNode(0, this.amb);
    const crBP = this.filter('bandpass', 650, 0.6); crBP.connect(c.crowdGain); this.noiseSource(true).connect(crBP);
    // Horn.
    c.hornGain = this.gainNode(0);
    const hornLP = this.filter('lowpass', 2200, 0.7); hornLP.connect(c.hornGain);
    for (const f of [370, 466]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hornLP); o.start(); }
  }

  set(param, v, tc = 0.08) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  /** st: { v (m/s), traction, brake, eb, radius, inStation, exterior, compressor, length, carLength } */
  update(dt, st) {
    if (!this.started || !this.inSession) return;
    const c = this.c, v = Math.abs(st.v), vk = v * 3.6;
    const ext = st.exterior ? 1.5 : 1;
    const pitch = st.motorPitch || 1;
    // Motors.
    const effort = Math.max(st.traction, vk > 4 ? st.brake * 0.8 : 0);
    const f0 = (6 + vk * 2.6) * pitch;
    this.set(c.motorA.frequency, f0 * 2); this.set(c.motorB.frequency, f0 * 3.01);
    this.set(c.motorLP.frequency, 300 + vk * 14 + effort * 500);
    this.set(c.motorGain.gain, (0.004 + effort * 0.06 * Math.min(1, 0.25 + vk / 25)) * ext);
    let carrier;
    if (st.inverter === 'igbt') carrier = 1800 + vk * 8;
    else if (vk < 12) carrier = 520;
    else { const steps = [[25, 15], [40, 9], [58, 5], [999, 3]]; const k = steps.find((s) => vk < s[0])[1]; carrier = f0 * 2 * k; }
    this.set(c.inv.frequency, Math.min(4200, carrier) * pitch, 0.03);
    this.set(c.invBP.frequency, Math.min(4200, carrier) * pitch, 0.03);
    this.set(c.invGain.gain, effort > 0.02 && vk > 0.3 ? (0.012 + effort * 0.03) * (vk < 70 ? 1 : 0.5) * ext : 0, 0.05);
    // Rolling, wind, flange.
    this.set(c.rollLP.frequency, 140 + vk * 22);
    this.set(c.rollGain.gain, Math.min(1, vk / 30) * (0.18 + vk / 220) * ext * (st.outdoor ? 0.65 : 1), 0.4);
    this.set(c.windBP.frequency, 300 + vk * 9);
    this.set(c.windGain.gain, Math.pow(vk / 80, 2) * (st.outdoor ? 0.08 : st.inStation ? 0.12 : 0.45) * ext, 0.4);
    const curve = st.radius < 450 && vk > 12 ? (1 - st.radius / 450) * Math.min(1, (vk - 12) / 25) : 0;
    this.set(c.flGain.gain, curve * 0.09 * ext, 0.25);
    const squeal = st.brake > 0.15 && v > 0.05 && v < 4 ? (1 - v / 4) * st.brake : 0;
    this.set(c.bsGain.gain, squeal * 0.022 * ext, 0.1);
    // Cab equipment.
    this.compTimer -= dt;
    if (this.compTimer < -18) this.compTimer = 50 + Math.random() * 40;
    this.set(c.compGain.gain, this.compTimer < 0 && !st.exterior ? 0.035 : 0, 0.6);
    this.set(c.fanGain.gain, st.exterior ? 0.003 : 0.018, 0.3);
    this.set(c.crowdGain.gain, st.inStation ? (st.doorsOpen ? 0.11 : 0.05) : 0, 0.8);
    // Rail joints.
    this.jointAcc += v * dt;
    if (this.jointAcc > 18) {
      this.jointAcc -= 18;
      if (v > 1) this.jointSet(v, st.carLength || 15);
    }
  }

  jointSet(v, carLength) {
    const t0 = this.ctx.currentTime + 0.01;
    const axle = 2.2 / v, bogie = (carLength - 4.8) / v;
    const g = Math.min(1, v / 20) * 0.5;
    for (const [dt, k] of [[0, 1], [axle, 0.9], [bogie, 0.75], [bogie + axle, 0.7], [carLength / v + 0.0, 0.35], [carLength / v + axle, 0.3]]) {
      this.clack(t0 + dt, g * k);
    }
  }
  clack(t, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const bp = this.filter('bandpass', 700 + Math.random() * 300, 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * 0.6, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(bp).connect(g).connect(this.fx); s.start(t, Math.random()); s.stop(t + 0.1);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const og = ctx.createGain(); og.gain.setValueAtTime(gain * 0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.fx); o.start(t); o.stop(t + 0.12);
  }

  tone(freq, dur, { type = 'sine', gain = 0.1, at = 0, dest = this.fx, attack = 0.01, ui = false } = {}) {
    if (!this.started || (!ui && !this.inSession)) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.setValueAtTime(gain, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(dur, { gain = 0.12, freq = 2500, at = 0, type = 'highpass' } = {}) {
    if (!this.started || !this.inSession) return;
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.filter(type, freq, 0.7);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.fx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  thunk(at = 0, gain = 0.3) {
    if (!this.started) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.fx); o.start(t); o.stop(t + 0.25);
  }

  // ---- event sounds ----
  click() { this.tone(2400, 0.02, { type: 'square', gain: 0.05, dest: this.ui, ui: true }); }
  notch(braking) { this.tone(braking ? 900 : 1300, 0.025, { type: 'square', gain: 0.04 }); this.thunk(0, 0.06); }
  brakeRelease() { this.hiss(1.1, { gain: 0.06, freq: 1800 }); }
  doorChime() { for (let i = 0; i < 3; i++) { this.tone(1046, 0.16, { at: i * 0.6, gain: 0.08, type: 'triangle' }); this.tone(784, 0.2, { at: i * 0.6 + 0.2, gain: 0.08, type: 'triangle' }); } }
  doorOpen() { this.hiss(1.4, { gain: 0.1, freq: 1500 }); this.thunk(1.9, 0.12); }
  doorClose() { this.hiss(1.0, { gain: 0.08, freq: 1200 }); this.thunk(2.4, 0.3); }
  emergency() { this.hiss(3.5, { gain: 0.35, freq: 600, type: 'lowpass' }); this.tone(620, 1.2, { gain: 0.07, type: 'square' }); }
  refuse() { this.tone(330, 0.25, { type: 'square', gain: 0.06 }); this.tone(260, 0.3, { type: 'square', gain: 0.06, at: 0.27 }); }
  ding() { this.tone(1568, 0.25, { gain: 0.07 }); }
  jingle() { [659, 784, 988].forEach((f, i) => this.tone(f, 0.38, { at: i * 0.32, gain: 0.07, dest: this.voice, type: 'sine', attack: 0.02 })); }

  /** Collision: impact boom, tearing metal, breaking glass. slow = replay version (lower, longer). */
  crash(k = 1, slow = false) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01, st = slow ? 3.2 : 1, pf = slow ? 0.45 : 1;
    const g = Math.min(1, 0.45 + k * 0.35);
    // Boom.
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90 * pf, t); o.frequency.exponentialRampToValueAtTime(28 * pf, t + 0.9 * st);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9 * g, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 * st);
    o.connect(og).connect(this.fx); o.start(t); o.stop(t + 1.3 * st);
    const boom = ctx.createBufferSource(); boom.buffer = this.brown;
    const bl = this.filter('lowpass', 900 * pf, 0.7); const bg = ctx.createGain();
    bg.gain.setValueAtTime(1.2 * g, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 * st);
    boom.connect(bl).connect(bg).connect(this.fx); boom.start(t); boom.stop(t + 1.7 * st);
    // Tearing metal: resonant noise bands sweeping down.
    for (const [f, d] of [[2400, 1.4], [3300, 1.1], [1700, 1.9], [4600, 0.8]]) {
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = this.filter('bandpass', f * pf, 22);
      bp.frequency.setValueAtTime(f * pf, t + 0.05); bp.frequency.exponentialRampToValueAtTime(f * 0.55 * pf, t + d * st);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.35 * g, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.0001, t + d * st);
      n.connect(bp).connect(ng).connect(this.fx); n.start(t, Math.random()); n.stop(t + d * st + 0.1);
    }
    // Glass.
    for (let i = 0; i < 9; i++) this.hiss(0.08 * st, { gain: 0.25 * g, freq: (5000 + Math.random() * 4000) * pf, at: 0.05 + Math.random() * 0.35 * st });
    this.hiss(2.5 * st, { gain: 0.18, freq: 500, type: 'lowpass', at: 0.3 });
  }

  /** Repeating alarm: 'atp' | 'vigilance' | null */
  setAlarm(kind) {
    if (!this.started || this.alarm === kind || (kind && !this.inSession)) return;
    this.alarm = kind;
    clearInterval(this.alarmTimer);
    if (!kind) return;
    const beep = () => (kind === 'atp' ? this.tone(1900, 0.18, { type: 'square', gain: 0.05 }) : this.tone(880, 0.35, { type: 'square', gain: 0.05 }));
    beep();
    this.alarmTimer = setInterval(beep, kind === 'atp' ? 420 : 900);
  }
  horn(on) { if (this.started && (this.inSession || !on)) this.set(this.c.hornGain.gain, on ? 0.09 : 0, 0.03); }

  /** Plays a decoded AudioBuffer on the announcement bus. */
  playBuffer(buf, delay = 0) {
    if (!this.inSession) return null;
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    s.connect(this.voice); s.start(this.ctx.currentTime + delay);
    return s;
  }
}
