// Small, dependency-free helpers shared by every system.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const toKmh = (ms) => ms * 3.6;
export const toMs = (kmh) => kmh / 3.6;

const pad = (n) => String(Math.floor(n)).padStart(2, '0');

/** Seconds since midnight -> "HH:MM:SS". */
export function formatClock(sec, withSeconds = true) {
  const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(r)}` : `${pad(h)}:${pad(m)}`;
}

/** Signed seconds -> "+1:05" / "-0:12". */
export function formatDelta(sec) {
  const sign = sec >= 0 ? '+' : '-';
  const a = Math.abs(Math.round(sec));
  return `${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
}

/** "06:30" or "06:30:15" -> seconds since midnight. */
export function parseClock(str, fallback = 6 * 3600) {
  if (typeof str === 'number') return str;
  if (typeof str !== 'string') return fallback;
  const p = str.split(':').map(Number);
  if (p.some(Number.isNaN)) return fallback;
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

export function formatDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.max(0, Math.round(m))} m`;
}

/** Deterministic PRNG so the same line always produces the same world. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function slugify(str) {
  return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

export function deepMerge(target, source) {
  for (const k of Object.keys(source || {})) {
    const v = source[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

export const deepClone = (o) => JSON.parse(JSON.stringify(o));
