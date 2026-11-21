// Persistent career data (selections, records, totals, economy) and per-station checkpoints.
// Every record is written as an envelope { v, savedAt, sum, data } with a checksum; the previous good copy is
// kept as a backup. On load a damaged or truncated record falls back to its backup (then to the legacy save, then
// to defaults) instead of crashing or silently wiping the career. Station checkpoints live under their own keys,
// so saving at one station never touches another station's save.
const KEY = 'metrosim.save.v2';
const LEGACY_KEY = 'metrosim.save.v1';
const STATION_PREFIX = 'metrosim.station.';

const EMPTY = {
  selection: { lineId: null, trainId: null, direction: 'A' },
  records: {},      // lineId:direction -> { bestScore, bestGrade, runs, bestDelay }
  totals: { distanceKm: 0, stations: 0, runs: 0, drivingSeconds: 0 },
  rail: { journeys: [], completed: 0, stations: [], last: null },  // completed journeys, checkpoint index
};

/** FNV-1a 32-bit checksum of a string. */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
const wrap = (data) => { const json = JSON.stringify(data); return JSON.stringify({ v: 2, savedAt: Date.now(), sum: checksum(json), data: json }); };
/** Parses an envelope; returns the data or null when missing / corrupted. */
export function unwrap(raw) {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw);
    if (!env || env.v !== 2 || typeof env.data !== 'string' || checksum(env.data) !== env.sum) return null;
    const d = JSON.parse(env.data);
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
}

/** localStorage when the page may use it; touching it can throw (sandboxed frames, blocked site data). */
function defaultStorage() {
  try { const s = globalThis.localStorage; s?.getItem('metrosim.probe'); return s || null; } catch { return null; }
}
/** In-memory fallback so the game still runs (without persistence) where storage is unavailable. */
function memoryStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }

export class SaveSystem {
  constructor(storage = defaultStorage()) {
    this.persistent = !!storage;
    if (!storage) { storage = memoryStorage(); this.warning = 'Saving is not available in this browser context (storage blocked) — progress will not be kept after closing.'; }
    this.store = storage;
    this.data = structuredClone(EMPTY);
    this.status = 'new';        // new | loaded | recovered | legacy | reset
    this.lastError = null;
    const ok = (d) => { this.data = this.merge(d); };
    const main = unwrap(this.get(KEY)), bak = unwrap(this.get(`${KEY}.bak`));
    if (main) { ok(main); this.status = 'loaded'; }
    else if (bak) { ok(bak); this.status = 'recovered'; this.warning = 'The save file was damaged; the previous copy was restored.'; }
    else {
      try { const legacy = this.get(LEGACY_KEY); if (legacy) { ok(JSON.parse(legacy)); this.status = 'legacy'; } } catch { /* unreadable legacy save */ }
      if (this.get(KEY) && this.status !== 'legacy') { this.status = 'reset'; this.warning = 'The save file was damaged and no backup was usable; a new career was started.'; }
    }
  }
  merge(d) {
    return { ...structuredClone(EMPTY), ...d, selection: { ...EMPTY.selection, ...d.selection }, totals: { ...EMPTY.totals, ...d.totals }, rail: { ...structuredClone(EMPTY.rail), ...d.rail } };
  }
  get(k) { try { return this.store?.getItem(k) ?? null; } catch { return null; } }
  /** Writes `value` under `key` after moving the current good copy to `key.bak`. Returns { ok, error }. */
  write(key, data) {
    try {
      const cur = this.get(key);
      if (cur && unwrap(cur)) this.store.setItem(`${key}.bak`, cur);
      this.store.setItem(key, wrap(data));
      if (!unwrap(this.get(key))) throw new Error('verification failed after writing');
      this.lastError = null;
      return { ok: true };
    } catch (e) {
      this.lastError = /quota/i.test(String(e?.name) + String(e?.message)) ? 'Storage is full — free some browser storage and save again.' : `Could not save: ${e?.message || e}`;
      return { ok: false, error: this.lastError };
    }
  }
  save() { return this.write(KEY, this.data); }
  get selection() { return this.data.selection; }
  setSelection(patch) { Object.assign(this.data.selection, patch); this.save(); }
  record(lineId, direction) { return this.data.records[`${lineId}:${direction}`]; }
  submitRun({ lineId, direction, score, grade, distanceKm, stations, seconds, finalDelay }) {
    const key = `${lineId}:${direction}`;
    const r = this.data.records[key] || { bestScore: 0, bestGrade: '-', runs: 0, bestDelay: null };
    r.runs++;
    let newBest = false;
    if (score > r.bestScore) { r.bestScore = score; r.bestGrade = grade; newBest = true; }
    if (finalDelay != null && (r.bestDelay == null || Math.abs(finalDelay) < Math.abs(r.bestDelay))) r.bestDelay = finalDelay;
    this.data.records[key] = r;
    const t = this.data.totals;
    t.distanceKm += distanceKm; t.stations += stations; t.runs++; t.drivingSeconds += seconds;
    this.save();
    return newBest;
  }
  /** A completed main-line / metro journey (kept for the career page; the last 40). */
  addJourney(j) {
    const r = this.data.rail;
    r.completed++;
    r.journeys.unshift({ at: Date.now(), ...j });
    r.journeys.length = Math.min(r.journeys.length, 40);
    return this.save();
  }
  resetAll() { this.data = structuredClone(EMPTY); this.save(); }

  // ---- station checkpoints ----
  static stationId(network, name) { return `${network}|${name}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9|]+/g, '-'); }
  /**
   * Saves a checkpoint at a station (its own storage key): the train, service and position there, plus the
   * station's progress (visits, arrivals, best stop). Other stations' saves are never touched.
   */
  saveStation(cp) {
    const id = SaveSystem.stationId(cp.network, cp.stationName);
    const prev = this.loadStation(id);
    const progress = { visits: 0, arrivals: 0, bestStopError: null, ...(prev?.progress || {}) };
    progress.visits++;
    if (cp.arrival) { progress.arrivals++; if (cp.stopError != null && (progress.bestStopError == null || Math.abs(cp.stopError) < Math.abs(progress.bestStopError))) progress.bestStopError = cp.stopError; }
    progress.lastVisit = Date.now();
    const rec = { id, checkpoint: { ...cp, savedAt: Date.now() }, progress };
    const res = this.write(STATION_PREFIX + id, rec);
    if (!res.ok) return res;
    const r = this.data.rail;
    if (!r.stations.includes(id)) r.stations.push(id);
    r.last = id;
    const s2 = this.save();
    return s2.ok ? { ok: true, id, record: rec } : s2;
  }
  /** A station's record, or null; a damaged record falls back to its backup. */
  loadStation(id) {
    return unwrap(this.get(STATION_PREFIX + id)) || unwrap(this.get(`${STATION_PREFIX + id}.bak`));
  }
  listStations() { return this.data.rail.stations.map((id) => this.loadStation(id)).filter(Boolean).sort((a, b) => b.checkpoint.savedAt - a.checkpoint.savedAt); }
  deleteStation(id) {
    try { this.store.removeItem(STATION_PREFIX + id); this.store.removeItem(`${STATION_PREFIX + id}.bak`); } catch { /* */ }
    const r = this.data.rail; r.stations = r.stations.filter((x) => x !== id); if (r.last === id) r.last = r.stations.at(-1) || null;
    return this.save();
  }
}
