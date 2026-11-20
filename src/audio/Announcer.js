// Station announcements. Priority: imported MP3 (IndexedDB) → MP3 referenced by the line file → speech synthesis.
import { AssetStore } from '../core/AssetStore.js';

export class Announcer {
  constructor(audio, settings, line) {
    this.audio = audio; this.settings = settings; this.line = line;
    this.cache = new Map();
    this.current = null;
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

  /** type: 'next' | 'arrival' | 'terminus' */
  async announce(stop, type = 'next') {
    if (!this.audio.started) return;
    const st = stop.station;
    const key = type === 'next' ? st.id : `${st.id}:${type}`;
    const url = type === 'next' ? st.announcement : null;
    this.stop();
    const buf = await this.loadBuffer(key, url);
    this.audio.jingle();
    if (buf) { this.current = this.audio.playBuffer(buf, 1.1); return 'mp3'; }
    if (!this.settings.get('audio.voiceFallback') || !('speechSynthesis' in window)) return 'none';
    const tpl = st.announcementText && type === 'next' ? st.announcementText
      : type === 'terminus' ? this.line.announcements.terminus
        : type === 'arrival' ? this.line.announcements.arrival : this.line.announcements.nextStation;
    const text = tpl.replaceAll('{station}', st.name).replaceAll('{line}', this.line.name)
      .replaceAll('{connections}', this.connectionsText(st)).replaceAll('{doors}', this.doorsText(stop.doorSide)).replace(/\s+/g, ' ').trim();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.line.language;
      const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith(this.line.language.slice(0, 2).toLowerCase()));
      if (v) u.voice = v;
      u.rate = 0.95;
      u.volume = Math.min(1, this.settings.get('audio.master') * this.settings.get('audio.announcements'));
      speechSynthesis.speak(u);
    }, 1100);
    return 'speech';
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
    this.current = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
