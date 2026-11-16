// Persistent career data: selections, per-line records, cumulative stats.
const KEY = 'metrosim.save.v1';

const EMPTY = {
  selection: { lineId: null, trainId: null, direction: 'A' },
  records: {},      // lineId:direction -> { bestScore, bestGrade, runs, bestDelay }
  totals: { distanceKm: 0, stations: 0, runs: 0, drivingSeconds: 0 },
};

export class SaveSystem {
  constructor() {
    this.data = structuredClone(EMPTY);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { ...this.data, ...d, selection: { ...EMPTY.selection, ...d.selection }, totals: { ...EMPTY.totals, ...d.totals } };
      }
    } catch { /* defaults */ }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }
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
  resetAll() { this.data = structuredClone(EMPTY); this.save(); }
}
