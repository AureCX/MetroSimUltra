// Normalises and validates a line definition coming from JSON.
// Accepts the minimal format ({ line, color, stations:[{name, distanceToNext, speedLimit, stopDuration}] })
// as well as the full format documented in docs/LINE_FORMAT.md.
import { slugify } from '../core/util.js';

export const LINE_DEFAULTS = {
  maxSpeed: 80,              // km/h, absolute line maximum
  startTime: '06:30:00',
  headway: 180,              // s between trains in each direction
  trackSpacing: 3.8,         // m between the two track centres
  platformLength: 110,
  platformWidth: 4.5,
  platformType: 'side',      // side | island
  approachSpeedLimit: 50,    // km/h when entering a platform
  approachDistance: 120,     // m before the platform where approach limit starts
  stopDuration: 20,
  stopMarkerOffset: 4,       // m from the far platform end to the stop marker
  style: 'vault',            // vault | pillars | modern
  tunnelProfile: 'arch',     // arch | box
  language: 'en-GB',
  signaling: { system: 'fixed-block', blockLength: 320, overlap: 40, atpBrakeRate: 0.85 },
};

const STYLES = ['vault', 'pillars', 'modern'];

export class LineValidationError extends Error {}

function num(v, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeLine(raw, { id, builtIn = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new LineValidationError('Line file must contain a JSON object.');
  const stationsRaw = raw.stations;
  if (!Array.isArray(stationsRaw) || stationsRaw.length < 2) throw new LineValidationError('A line needs at least two stations ("stations" array).');

  const name = String(raw.line ?? raw.name ?? 'Unnamed line');
  const number = String(raw.number ?? (name.match(/\d+[A-Za-z]?/)?.[0] ?? name.slice(0, 2)));
  const d = { ...LINE_DEFAULTS, ...(raw.defaults || {}) };
  const sig = { ...LINE_DEFAULTS.signaling, ...(raw.signaling || {}) };
  if (!['fixed-block', 'cbtc'].includes(sig.system)) sig.system = 'fixed-block';

  const errors = [];
  const stations = stationsRaw.map((s, i) => {
    if (!s || typeof s !== 'object') { errors.push(`Station #${i + 1} is not an object.`); return null; }
    if (!s.name) errors.push(`Station #${i + 1} has no "name".`);
    const last = i === stationsRaw.length - 1;
    const dist = num(s.distanceToNext, last ? 0 : NaN, { min: 0 });
    if (!last && !(dist >= 150)) errors.push(`Station "${s.name}": "distanceToNext" must be ≥ 150 m (got ${s.distanceToNext}).`);
    const platformLength = num(s.platformLength, num(d.platformLength, 110), { min: 40, max: 400 });
    const st = {
      index: i,
      id: s.id ? String(s.id) : slugify(s.name || `station-${i}`),
      name: String(s.name || `Station ${i + 1}`),
      distanceToNext: last ? 0 : dist,
      speedLimit: num(s.speedLimit, d.maxSpeed, { min: 10, max: 160 }),
      approachSpeedLimit: num(s.approachSpeedLimit, d.approachSpeedLimit, { min: 10, max: 160 }),
      approachDistance: num(s.approachDistance, d.approachDistance, { min: 0, max: 1000 }),
      stopDuration: num(s.stopDuration, d.stopDuration, { min: 5, max: 600 }),
      runTime: s.runTime != null ? num(s.runTime, null, { min: 10 }) : null,
      platformLength,
      platformWidth: num(s.platformWidth, d.platformWidth, { min: 2.5, max: 10 }),
      platformType: (s.platformType || d.platformType) === 'island' ? 'island' : 'side',
      style: STYLES.includes(s.style) ? s.style : (STYLES.includes(d.style) ? d.style : 'vault'),
      theme: { wall: s.theme?.wall || null, accent: s.theme?.accent || raw.color || '#ffcc00', sign: s.theme?.sign || null },
      passengers: num(s.passengers, 18, { min: 0, max: 60 }),
      announcement: s.announcement || null,        // path/URL or imported key
      announcementText: s.announcementText || null,
      exitSide: s.exitSide || 'both',
      track: Array.isArray(s.track) ? s.track.map((seg, k) => normalizeSegment(seg, k, s.name, errors)) : [],
      stopMarkerOffset: num(s.stopMarkerOffset, d.stopMarkerOffset, { min: 0, max: 50 }),
    };
    if (st.track.reduce((a, t) => a + (t?.length || 0), 0) > Math.max(0, st.distanceToNext - (st.platformLength / 2) - 60)) {
      // Not fatal: excess layout is clipped by TrackGeometry. Warn only.
      st.trackClipped = true;
    }
    return st;
  });
  if (errors.length) throw new LineValidationError(errors.join('\n'));

  const restrictions = (raw.speedRestrictions || []).map((r) => {
    const base = r.fromStation != null ? stations.find((s) => s.name === r.fromStation || s.id === r.fromStation) : null;
    return {
      fromStationIndex: base ? base.index : null,
      start: num(r.start ?? r.from, 0),
      end: r.length != null ? num(r.start ?? r.from, 0) + num(r.length, 0) : num(r.end ?? r.to, 0),
      limit: num(r.limit, d.maxSpeed, { min: 5 }),
      direction: r.direction === 'A' || r.direction === 'B' ? r.direction : null,
      reason: r.reason || 'Speed restriction',
    };
  });

  const lineId = id || raw.id || slugify(`${raw.network || 'custom'}-${name}`);
  const term = (dir) => (dir === 'A' ? stations.at(-1).name : stations[0].name);
  return {
    id: lineId,
    builtIn,
    name,
    number,
    network: String(raw.network || 'Custom lines'),
    color: raw.color || '#ffcc00',
    textColor: raw.textColor || pickTextColor(raw.color || '#ffcc00'),
    language: raw.language || d.language,
    maxSpeed: num(raw.maxSpeed, d.maxSpeed, { min: 20, max: 160 }),
    startTime: raw.startTime || d.startTime,
    headway: num(raw.headway, d.headway, { min: 60, max: 1800 }),
    trackSpacing: num(raw.trackSpacing, d.trackSpacing, { min: 3.2, max: 6 }),
    tunnelProfile: (raw.tunnel?.profile || raw.tunnelProfile || d.tunnelProfile) === 'box' ? 'box' : 'arch',
    initialHeading: num(raw.map?.heading ?? raw.initialHeading, 0),
    mapOrigin: Array.isArray(raw.map?.origin) ? raw.map.origin.map(Number) : [0, 0],
    signaling: sig,
    speedRestrictions: restrictions,
    directions: {
      A: { name: raw.directions?.A?.name || `Direction ${term('A')}`, terminus: term('A') },
      B: { name: raw.directions?.B?.name || `Direction ${term('B')}`, terminus: term('B') },
    },
    announcements: {
      nextStation: raw.announcements?.nextStation || 'Next station: {station}.',
      terminus: raw.announcements?.terminus || '{station}. This train terminates here. All change please.',
      arrival: raw.announcements?.arrival || '{station}.',
      doorsClosing: raw.announcements?.doorsClosing || null,
    },
    stations,
    raw,
  };
}

function normalizeSegment(seg, k, stationName, errors) {
  if (!seg || typeof seg !== 'object') { errors.push(`Track segment #${k + 1} after "${stationName}" is invalid.`); return null; }
  const length = num(seg.length, NaN, { min: 1 });
  if (!(length > 0)) errors.push(`Track segment #${k + 1} after "${stationName}" needs a positive "length".`);
  const radius = seg.radius ? num(seg.radius, 0, { min: 60 }) : 0;
  const turn = seg.turn === 'left' ? -1 : 1;
  return { length, curvature: radius ? turn / radius : 0, radius, gradient: num(seg.gradient, 0, { min: -60, max: 60 }) };
}

function pickTextColor(hex) {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff';
}
