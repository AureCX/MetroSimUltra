// Daily timetable of the Grandville main-line network, derived from the TGV line files (departure times, train
// numbers, track, journey time): departures from Gare Centrale and the returning trains arriving there. Each
// train gets a deterministic (seeded per day) operating state — on time, delayed by a few minutes, rarely
// cancelled — so every board, screen and menu shows the same thing. Times are seconds since midnight.
const hhmm = (t) => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };
export const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
const rnd = (n) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967295; };

export class TgvTimetable {
  /** lines: normalized main lines (category 'hst'). day: integer seed (e.g. day of the career). */
  constructor(lines, day = 1) {
    this.day = day;
    this.services = [];
    for (const l of lines) {
      const r = l.rail; if (!r?.departures) continue;
      r.departures.forEach((t, j) => {
        const dep = hhmm(t), no = r.trainNumber + 2 * j, seed = no * 31 + day * 977;
        const delay = rnd(seed) < 0.13 ? Math.round(3 + rnd(seed + 1) * 22) * 60 : 0;
        const cancelled = rnd(seed + 2) < 0.025;
        const via = l.stations.slice(1, -1).map((s) => s.name);
        this.services.push({ kind: 'dep', no, lineId: l.id, line: l, destination: r.destination, via, time: dep, duration: r.duration * 60, voie: r.voie, delay, cancelled, train: j % 2 ? 'Duplex' : 'Classique' });
        // The trainset arrives from the destination 50 minutes before it leaves again.
        const arrNo = no + 1, aSeed = arrNo * 31 + day * 977;
        this.services.push({ kind: 'arr', no: arrNo, lineId: l.id, line: l, origin: r.destination, via: [...via].reverse(), time: dep - 50 * 60, duration: r.duration * 60, voie: r.voie, delay: rnd(aSeed) < 0.15 ? Math.round(2 + rnd(aSeed + 1) * 18) * 60 : 0, cancelled: rnd(aSeed + 2) < 0.02 });
      });
    }
    this.services.sort((a, b) => a.time - b.time);
  }

  /** Status of a service at clock (s): { code, label, color }. */
  status(sv, clock) {
    const t = sv.time + sv.delay;
    if (sv.cancelled) return { code: 'cancelled', label: 'Supprimé · Cancelled', color: '#ff5a4a' };
    if (sv.kind === 'dep') {
      if (clock >= t + 60) return { code: 'departed', label: 'Parti · Departed', color: '#8fa1b3' };
      if (clock >= t - 20 * 60) return { code: 'boarding', label: sv.delay ? `Embarquement · +${sv.delay / 60} min` : 'Embarquement · Boarding', color: '#5fe39a' };
      if (sv.delay) return { code: 'delayed', label: `Retard +${sv.delay / 60} min · Delayed`, color: '#ffb000' };
      return { code: 'ontime', label: "À l'heure · On time", color: '#9fc3ff' };
    }
    if (clock >= t) return { code: 'arrived', label: 'Arrivé · Arrived', color: '#8fa1b3' };
    if (clock >= t - 5 * 60) return { code: 'approaching', label: 'En approche · Approaching', color: '#5fe39a' };
    if (sv.delay) return { code: 'delayed', label: `Retard +${sv.delay / 60} min · Delayed`, color: '#ffb000' };
    return { code: 'ontime', label: "À l'heure · On time", color: '#9fc3ff' };
  }

  /** Next departures / arrivals around clock. */
  board(kind, clock, n = 10) {
    return this.services.filter((s) => s.kind === kind && s.time + s.delay > clock - (kind === 'dep' ? 3 : 8) * 60).slice(0, n);
  }
  /** Departure for a line at (or after) a time. */
  departure(lineId, time) { return this.services.find((s) => s.kind === 'dep' && s.lineId === lineId && s.time >= time - 60) || this.services.find((s) => s.kind === 'dep' && s.lineId === lineId); }
  departuresOf(lineId) { return this.services.filter((s) => s.kind === 'dep' && s.lineId === lineId); }
}
