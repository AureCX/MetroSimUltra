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
    const blob = await AssetStore.getAudio(`${this.line.id}/${key}`);
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
    const text = tpl.replaceAll('{station}', st.name).replaceAll('{line}', this.line.name);
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
  stop() {
    try { this.current?.stop(); } catch { /* already stopped */ }
    this.current = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
