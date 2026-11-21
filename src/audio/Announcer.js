// Station announcements. Priority: imported MP3 (IndexedDB) → MP3 referenced by the line file → speech synthesis.
import { AssetStore } from '../core/AssetStore.js';
import { VOICE_PROFILES, pickVoice } from './Voices.js';

export class Announcer {
  /**
   * Announcements go through one queue: never two at once, each triggered message plays once (keyed), the queue
   * dies with the gameplay session. Each message: chime of its voice → MP3 if one was imported for it (per
   * station, or per event: depart, doors, safety, delay, slowdown, final) → else speech in the chosen voice.
   */
  constructor(audio, settings, line) {
    this.audio = audio; this.settings = settings; this.line = line;
    this.cache = new Map();
    this.current = null;
    this.queue = []; this.busy = false; this.played = new Set();
    this.voice = 'female';
  }

  async loadBuffer(key, url) {
    if (this.cache.has(key)) return this.cache.get(key);
    let data = null;
    const blob = await AssetStore.getAudio(`${this.line.sourceId || this.line.id}/${key}`);
    if (blob) data = await blob.arrayBuffer();
    else if (url) {
      try { const r = await fetch(url); if (r.ok) data = await r.arrayBuffer(); } catch { /* fall back to speech */ }
    }
    let buf = null;
    if (data && this.audio.ctx) { try { buf = await this.audio.ctx.decodeAudioData(data); } catch { buf = null; } }
    this.cache.set(key, buf);
    return buf;
  }

  /** Voice profile used for a message: explicit, else the setting / per-service choice. */
  profile(p) { return p || this.voice; }

  /**
   * Queues a message. key: dedup key (a key already played is ignored unless force); text: what to say;
   * mp3: storage key of an optional imported file; url: file referenced by the line; voice: profile.
   */
  say(key, text, { mp3 = null, url = null, voice = null, force = false, chime = true } = {}) {
    if (!this.audio.started || !this.audio.inSession) return false;
    if (!force && (this.played.has(key) || this.queue.some((q) => q.key === key))) return false;
    this.played.add(key);
    this.queue.push({ key, text, mp3, url, voice: this.profile(voice), chime, sid: this.audio.sessionId });
    this.pump();
    return true;
  }
  async pump() {
    if (this.busy) return;
    const m = this.queue.shift(); if (!m) return;
    this.busy = true;
    try {
      if (!this.audio.alive(m.sid)) return;
      // Custom MP3 if any (never wait more than 2.5 s for storage: the message then falls back to speech).
      const buf = m.mp3 || m.url ? await Promise.race([this.loadBuffer(m.mp3, m.url), new Promise((r) => setTimeout(() => r(null), 2500))]) : null;
      if (!this.audio.alive(m.sid)) return;
      const P = VOICE_PROFILES[m.voice] || VOICE_PROFILES.female;
      if (m.chime) P.chime.forEach((f, i) => this.audio.tone(f, 0.36, { at: i * P.gap, gain: 0.07, dest: this.audio.voice, attack: 0.02 }));
      const lead = m.chime ? P.gap * 3 + 0.35 : 0.1;
      if (buf) {
        this.current = this.audio.playBuffer(buf, lead);
        await new Promise((r) => this.audio.later(r, (lead + buf.duration + 0.5) * 1000));
      } else if (m.text && this.settings.get('audio.voiceFallback') && 'speechSynthesis' in window) {
        await new Promise((r) => this.audio.later(r, lead * 1000));
        if (!this.audio.alive(m.sid)) return;
        await new Promise((resolve) => {
          const u = new SpeechSynthesisUtterance(m.text);
          u.lang = this.line.language || 'fr-FR';
          const v = pickVoice(m.voice, u.lang); if (v) { try { u.voice = v; } catch { /* not a system voice */ } }
          u.pitch = P.pitch; u.rate = P.rate;
          u.volume = Math.min(1, this.settings.get('audio.master') * this.settings.get('audio.announcements'));
          let done = false; const end = () => { if (!done) { done = true; resolve(); } };
          u.onend = end; u.onerror = end;
          this.audio.later(end, 2000 + m.text.length * 110);       // never stall the queue
          speechSynthesis.speak(u);
        });
      }
    } finally {
      this.busy = false;
      if (this.audio.inSession) this.audio.later(() => this.pump(), 400); else this.queue.length = 0;
    }
  }

  /** Metro / generic station announcements. type: 'next' | 'arrival' | 'terminus'. force: the driver's button. */
  async announce(stop, type = 'next', force = false) {
    if (!this.audio.started || !stop) return 'none';
    const st = stop.station;
    const key = type === 'next' ? st.id : `${st.id}:${type}`;
    const tpl = st.announcementText && type === 'next' ? st.announcementText
      : type === 'terminus' ? this.line.announcements.terminus
        : type === 'arrival' ? this.line.announcements.arrival : this.line.announcements.nextStation;
    const text = tpl.replaceAll('{station}', st.name).replaceAll('{line}', this.line.name)
      .replaceAll('{connections}', this.connectionsText(st)).replaceAll('{doors}', this.doorsText(stop.doorSide)).replace(/\s+/g, ' ').trim();
    this.say(`${type}:${stop.k}:${st.id}`, text, { mp3: key, url: type === 'next' ? st.announcement : null, force });
    return 'queued';
  }
  /** "Correspondance : lignes A et B, bus Aéroval, accès aux terminaux." (or English), '' without connections. */
  connectionsText(st) {
    const fr = this.line.language.startsWith('fr');
    const ic = st.interchange || { metro: [], bus: [] };
    const and = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} ${fr ? 'et' : 'and'} ${a.at(-1)}`);
    const parts = [];
    if (ic.metro?.length) parts.push(fr ? `${ic.metro.length > 1 ? 'lignes' : 'ligne'} ${and(ic.metro)}` : `${ic.metro.length > 1 ? 'lines' : 'line'} ${and(ic.metro)}`);
    if (ic.bus?.length) parts.push(fr ? `bus ${and(ic.bus)}` : `${and(ic.bus)} buses`);
    if (ic.airport) parts.push(fr ? "accès aux terminaux de l'aéroport" : 'airport terminals');
    if (ic.rail) parts.push(fr ? 'les TGV Grandes Lignes' : 'TGV main-line services');
    if (!parts.length) return '';
    const tpl = this.line.announcements.connections || (fr ? 'Correspondance : {list}.' : 'Change here for {list}.');
    return tpl.replaceAll('{list}', and(parts));
  }
  doorsText(side) {
    const fr = this.line.language.startsWith('fr');
    if (side === 'left') return fr ? 'Descente à gauche.' : 'Doors will open on the left.';
    return fr ? 'Descente à droite.' : 'Doors will open on the right.';
  }

  stop() {
    try { this.current?.stop(); } catch { /* already stopped */ }
    this.current = null; this.queue.length = 0;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
