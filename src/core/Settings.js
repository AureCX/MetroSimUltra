import { deepMerge, deepClone } from './util.js';

const KEY = 'metrosim.settings.v1';

export const DEFAULT_SETTINGS = {
  audio: { master: 0.8, effects: 0.85, ambient: 0.7, announcements: 1.0, voiceFallback: true },
  graphics: { quality: 'high', fov: 72, drawDistance: 450, cameraShake: 1.0 },
  gameplay: {
    atp: true,              // automatic train protection (overspeed / end-of-authority supervision)
    vigilance: false,       // dead-man vigilance device
    stopTolerance: 1.5,     // metres either side of the stop marker counted as a precise stop
    showHud: true,
    mouseSensitivity: 1.0,
    invertY: false,
    units: 'kmh',
  },
  controls: { bindings: null }, // null => defaults from Input.ACTIONS
};

export class Settings {
  constructor(bus) {
    this.bus = bus;
    this.data = deepClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) deepMerge(this.data, JSON.parse(raw));
    } catch { /* storage unavailable: defaults */ }
  }
  get(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data); }
  set(path, value) {
    const keys = path.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    o[keys.at(-1)] = value;
    this.save();
    this.bus?.emit('settings:changed', { path, value });
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }
  reset(section) {
    if (section) this.data[section] = deepClone(DEFAULT_SETTINGS[section]);
    else this.data = deepClone(DEFAULT_SETTINGS);
    this.save();
    this.bus?.emit('settings:changed', { path: section || '*' });
  }
}
