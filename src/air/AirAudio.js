// Aircraft sounds on the shared session audio graph: jet engines (fan whine and roar with N1, louder outside) or
// turboprops (propeller blade-pass buzz and turbine whine), airflow / wind noise with airspeed, runway rumble,
// gear and flap hydraulics with lock thumps, touchdown thump and tyre chirp, warnings (stall cricket, overspeed
// clacker, autopilot disconnect, master caution, terrain), synthetic altitude callouts, and the ATC radio: each
// controller speaks French with its own voice profile, framed by squelch clicks and radio hiss; messages queue so
// they never overlap. Everything belongs to the gameplay audio session and stops when the player leaves.
import { pickVoice, VOICE_PROFILES } from '../audio/Voices.js';
import { ROLES } from './ATC.js';

export class AirAudio {
  constructor(audio, settings) { this.a = audio; this.settings = settings; this.on = false; this.radioQ = []; this.speaking = false; this.callouts = new Set(); }
  start(spec) {
    const a = this.a; if (!a.started) return;
    const ctx = a.ctx, c = this.c = {}; this.spec = spec; this.nodes = [];
    const gain = (v, dest = a.fx) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };
    const filt = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const osc = (type, dest, f = 100) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(); this.nodes.push(o); return o; };
    const noise = (brown, dest) => { const s = a.noiseSource(brown); s.connect(dest); this.nodes.push(s); return s; };
    // Engines.
    c.whineG = gain(0); c.whineBP = filt('bandpass', 3000, 6); c.whineBP.connect(c.whineG); c.w1 = osc('sawtooth', c.whineBP); c.w2 = osc('triangle', c.whineG);
    c.roarG = gain(0); c.roarLP = filt('lowpass', 400, 0.7); c.roarLP.connect(c.roarG); noise(true, c.roarLP);
    c.hissG = gain(0); const hbp = filt('bandpass', 1800, 0.8); hbp.connect(c.hissG); noise(false, hbp);
    c.propG = gain(0); c.propLP = filt('lowpass', 600, 1.2); c.propLP.connect(c.propG); c.p1 = osc('sawtooth', c.propLP, 102); c.p2 = osc('square', c.propLP, 204);
    // Airflow, rumble, hydraulics.
    c.windG = gain(0, a.amb); c.windBP = filt('bandpass', 600, 0.5); c.windBP.connect(c.windG); noise(false, c.windBP);
    c.rumbleG = gain(0); c.rumbleLP = filt('lowpass', 120, 0.8); c.rumbleLP.connect(c.rumbleG); noise(true, c.rumbleLP);
    c.hydG = gain(0); const hyd = filt('bandpass', 420, 4); hyd.connect(c.hydG); osc('sawtooth', hyd, 210);
    c.rainG = gain(0, a.amb); const rbp = filt('bandpass', 3500, 0.5); rbp.connect(c.rainG); noise(false, rbp);
    // Radio hiss (open while a controller talks).
    c.radioG = gain(0, a.voice); const rad = filt('bandpass', 2200, 1.4); rad.connect(c.radioG); noise(false, rad);
    // Stall cricket / overspeed clacker gates.
    c.warnG = gain(0); c.warnOsc = osc('square', c.warnG, 2600);
    this.on = true; this.flapPrev = 0; this.gearPrev = 1;
  }
  set(p, v, tc = 0.1) { p.setTargetAtTime(v, this.a.ctx.currentTime, tc); }
  /** s: { n1[], running, ias, gs, onGround, exterior, gearPos, flapPos, rain, stall, overspeed, aglFt, vs, reverse }. */
  update(dt, s) {
    if (!this.on) return;
    const c = this.c, n1 = s.n1.length ? s.n1.reduce((x, y) => x + y, 0) / s.n1.length : 0, ext = s.exterior ? 1 : 0.45, jet = this.spec.kind === 'jet';
    if (jet) {
      this.set(c.w1.frequency, 900 + n1 * 5200); this.set(c.w2.frequency, 450 + n1 * 2600); this.set(c.whineBP.frequency, 1200 + n1 * 4200);
      this.set(c.whineG.gain, n1 > 0.02 ? (0.012 + n1 * 0.03) * (s.exterior ? 1.2 : 0.6) : 0);
      this.set(c.roarLP.frequency, 180 + n1 * 900 + (s.reverse ? 400 : 0)); this.set(c.roarG.gain, Math.pow(n1, 2.2) * 0.35 * ext + (s.reverse ? 0.08 : 0));
      this.set(c.hissG.gain, n1 * 0.03 * ext); this.set(c.propG.gain, 0);
    } else {
      const rpm = n1 > 0.05 ? 0.75 + n1 * 0.25 : n1 * 10;
      this.set(c.p1.frequency, 102 * rpm); this.set(c.p2.frequency, 204 * rpm); this.set(c.propLP.frequency, 300 + n1 * 900);
      this.set(c.propG.gain, n1 > 0.02 ? (0.03 + n1 * 0.07) * ext : 0);
      this.set(c.w1.frequency, 2000 + n1 * 4000); this.set(c.w2.frequency, 1000 + n1 * 2000); this.set(c.whineBP.frequency, 3000 + n1 * 3000); this.set(c.whineG.gain, n1 > 0.02 ? 0.01 + n1 * 0.015 : 0);
      this.set(c.roarLP.frequency, 220 + n1 * 500); this.set(c.roarG.gain, n1 * n1 * 0.12 * ext); this.set(c.hissG.gain, n1 * 0.015 * ext);
    }
    const v = s.ias || 0;
    this.set(c.windBP.frequency, 300 + v * 6); this.set(c.windG.gain, Math.min(0.22, Math.pow(v / 160, 2) * 0.16) * (s.exterior ? 1.4 : 1));
    this.set(c.rumbleLP.frequency, 60 + s.gs * 2.5); this.set(c.rumbleG.gain, s.onGround ? Math.min(0.25, s.gs / 80 * 0.25) : 0, 0.05);
    const moving = Math.abs(s.gearPos - this.gearPrev) > 1e-4 || Math.abs(s.flapPos - this.flapPrev) > 1e-4;
    this.set(c.hydG.gain, moving ? 0.035 : 0, 0.2);
    if (this.gearPrev < 0.99 && s.gearPos >= 0.99) this.a.thunk(0, 0.35); if (this.gearPrev > 0.01 && s.gearPos <= 0.01) this.a.thunk(0, 0.25);
    this.gearPrev = s.gearPos; this.flapPrev = s.flapPos;
    this.set(c.rainG.gain, s.rain * 0.05, 0.5);
    // Warnings: stall cricket (bursts) and overspeed clacker.
    const t = this.a.ctx.currentTime;
    if (s.stall) { this.set(c.warnOsc.frequency, 2600); this.set(c.warnG.gain, (t * 6) % 1 < 0.5 ? 0.06 : 0, 0.005); }
    else if (s.overspeed) { this.set(c.warnOsc.frequency, 700); this.set(c.warnG.gain, (t * 10) % 1 < 0.3 ? 0.05 : 0, 0.005); }
    else this.set(c.warnG.gain, 0, 0.02);
    // Altitude callouts on the approach (descending, gear down).
    if (!s.onGround && s.vs < -1 && s.gearPos > 0.9) {
      for (const h of [1000, 500, 100, 50, 40, 30, 20, 10]) if (s.aglFt < h && s.aglFt > h - 60 && !this.callouts.has(h)) { this.callouts.add(h); this.speak(h === 1000 ? 'one thousand' : h === 500 ? 'five hundred' : h === 100 ? 'one hundred' : String(h), 'en-US', 1.0, 1.15); if (h === 20 && this.spec.sidestick) this.a.later(() => this.speak('retard', 'en-US', 1, 1.15), 700); }
    }
    if (s.aglFt > 1200) this.callouts.clear();
  }
  speak(text, lang = 'en-US', pitch = 1, rate = 1) {
    if (!('speechSynthesis' in globalThis) || !this.a.inSession) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.pitch = pitch; u.rate = rate; u.volume = Math.min(1, (this.settings?.get('audio.announcements') ?? 0.9) * 1.1); speechSynthesis.speak(u); } catch { /* */ }
  }
  touchdown(fpm) { this.a.thunk(0, Math.min(0.9, 0.25 + fpm / 600)); this.a.hiss(0.25, { gain: 0.08, freq: 3500 }); }
  apDisconnect() { for (let i = 0; i < 3; i++) { this.a.tone(1300, 0.12, { at: i * 0.38, gain: 0.05, type: 'sine' }); this.a.tone(1050, 0.12, { at: i * 0.38 + 0.15, gain: 0.05, type: 'sine' }); } }
  caution() { this.a.tone(1400, 0.35, { gain: 0.05, type: 'triangle' }); }
  chime() { this.a.tone(880, 0.6, { gain: 0.04, type: 'sine' }); this.a.tone(660, 0.8, { at: 0.5, gain: 0.04, type: 'sine' }); }
  click() { this.a.tone(2400, 0.015, { type: 'square', gain: 0.03 }); }
  thunder(k) { this.a.later(() => { this.a.thunk(0, 0.4 * k); this.a.hiss(2.5, { gain: 0.05 * k, freq: 160, type: 'lowpass' }); }, 400 + Math.random() * 2500); }
  crash() { this.a.crash(1.2, true); }

  /** ATC radio: queue a controller (or the player's read-back) transmission. */
  radio(text, role, { pilot = false } = {}) {
    this.radioQ.push({ text, role, pilot }); if (this.radioQ.length > 6) this.radioQ.splice(0, this.radioQ.length - 6);
    if (!this.speaking) this.pump();
  }
  pump() {
    const m = this.radioQ.shift(); if (!m || !this.on || !this.a.inSession) { this.speaking = false; return; }
    this.speaking = true;
    const sid = this.a.sessionId, done = () => { if (!this.a.alive(sid)) return; this.squelch(false); this.a.later(() => this.pump(), 450); };
    this.squelch(true);
    if (!('speechSynthesis' in globalThis)) { this.a.later(done, 1500 + m.text.length * 40); return; }
    try {
      const prof = m.pilot ? 'male' : ROLES[m.role]?.voice || 'female', P = VOICE_PROFILES[prof];
      const u = new SpeechSynthesisUtterance(m.text.replace(/\bFL(\d+)/g, 'niveau $1')); u.lang = 'fr-FR'; const v = pickVoice(prof); if (v) u.voice = v;
      u.pitch = P.pitch * (m.pilot ? 0.95 : 1); u.rate = Math.min(1.3, P.rate * 1.12); u.volume = Math.min(1, this.settings?.get('audio.announcements') ?? 0.9);
      let ended = false; const fin = () => { if (ended) return; ended = true; done(); };
      u.onend = fin; u.onerror = fin; this.a.later(fin, 3000 + m.text.length * 90);
      this.a.later(() => { try { speechSynthesis.speak(u); } catch { fin(); } }, 160);
    } catch { this.a.later(done, 1500); }
  }
  squelch(open) { if (!this.on) return; this.set(this.c.radioG.gain, open ? 0.012 : 0, 0.02); this.a.tone(open ? 1800 : 1200, 0.03, { type: 'square', gain: 0.025 }); if (!open) this.a.hiss(0.12, { gain: 0.05, freq: 2500 }); }
  stop() { if (!this.on) return; for (const n of this.nodes) { try { n.stop(); } catch { /* */ } } this.on = false; for (const g of Object.values(this.c)) g.disconnect?.(); this.radioQ = []; this.speaking = false; }
}
