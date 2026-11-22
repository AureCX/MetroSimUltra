// Air traffic control. Each airport has ground, tower, departure and approach controllers (each speaks with its
// own voice in the game). The controllers own the runway (active direction into the wind, occupancy), the
// departure queue at the holding point and the arrival sequence on the approach; they enforce separation
// (in-trail spacing on final, departure intervals, wake / low-visibility margins), send arrivals to holding when
// the gap is too short, order go-arounds when the runway is still occupied, and answer the player's requests
// (start-up, taxi, line-up, take-off, landing, parking) with clearances or "hold position".
export const ROLES = {
  ground: { fr: 'Sol', voice: 'formal' }, tower: { fr: 'Tour', voice: 'female' },
  departure: { fr: 'Départ', voice: 'male' }, approach: { fr: 'Approche', voice: 'calm' },
};

export class AirportATC {
  constructor(layout, weather) {
    this.L = layout; this.ap = layout.ap; this.weather = weather;
    this.runway = { occupant: null, since: 0 };
    this.depQueue = []; this.arrivals = []; this.lastDeparture = -999; this.lastLandingClear = -999;
    this.log = [];
  }
  get name() { return this.ap.city === 'Grandville' ? 'Grandville' : this.ap.city.split('-')[0]; }
  call(role) { return `${this.name} ${ROLES[role].fr}`; }
  active() { const w = this.weather?.wind?.() || { dir: 270 }; return this.L.activeDir(w.dir, 0); }
  /** Spacing (m) required between arrivals on final; more in low visibility / storms. */
  spacing() { const v = this.weather?.visibility?.() ?? 10000, st = this.weather?.storm?.() ? 1 : 0; return v < 800 ? 11000 : st ? 9000 : 6500; }
  depInterval() { return this.weather?.visibility?.() < 800 ? 150 : 100; }
  runwayFree(now, id = null) { return !this.runway.occupant || this.runway.occupant === id; }
  occupy(id, now) { if (!this.runway.occupant) { this.runway.occupant = id; this.runway.since = now; return true; } return this.runway.occupant === id; }
  release(id) { if (this.runway.occupant === id) this.runway.occupant = null; }
  /** Closest arrival's distance to the threshold (m), Infinity when none. */
  nextArrivalDist(exclude = null) { let d = Infinity; for (const a of this.arrivals) if (a.id !== exclude && a.distToThr != null) d = Math.min(d, a.distToThr); return d; }

  // ---- arrivals ----
  /** Register / update an arrival (AI or player) with its distance to the threshold. */
  arrival(id, distToThr, kind = 'ai') {
    let a = this.arrivals.find((x) => x.id === id);
    if (!a) { a = { id, kind, distToThr, cleared: false }; this.arrivals.push(a); }
    a.distToThr = distToThr;
    this.arrivals.sort((p, q) => p.distToThr - q.distToThr);
    return a;
  }
  removeArrival(id) { this.arrivals = this.arrivals.filter((a) => a.id !== id); }
  /** May this arrival continue to final (enough gap behind the one ahead)? else → holding. */
  sequenceOk(id) {
    const i = this.arrivals.findIndex((a) => a.id === id); if (i <= 0) return true;
    return this.arrivals[i].distToThr - this.arrivals[i - 1].distToThr >= this.spacing() * 0.9;
  }
  /** Landing clearance: runway free (or the departing aircraft already rolling well ahead), first in sequence. */
  landingClearance(id, now) {
    const i = this.arrivals.findIndex((a) => a.id === id);
    if (i > 0 && this.arrivals[0].distToThr < this.arrivals[i].distToThr - 500) return false;
    if (this.runway.occupant && this.runway.occupant !== id) return false;
    const a = this.arrivals[i]; if (a) a.cleared = true; this.lastLandingClear = now; return true;
  }

  // ---- departures ----
  requestDeparture(id) { if (!this.depQueue.includes(id)) this.depQueue.push(id); return this.depQueue.indexOf(id); }
  /** Line-up and take-off clearance: first in the queue, runway free, interval since the last departure, no arrival
   * inside 6 km (or 4 km in good conditions for short-field operations), not in a storm cell. */
  takeoffClearance(id, now) {
    if (this.depQueue[0] !== id) return { ok: false, reason: `numéro ${this.depQueue.indexOf(id) + 1} au départ` };
    if (this.weather?.storm?.() && this.weather.stormHere?.(this.ap)) return { ok: false, reason: 'orage sur le terrain, départs suspendus' };
    if (!this.runwayFree(now, id)) return { ok: false, reason: 'piste occupée' };
    if (now - this.lastDeparture < this.depInterval()) return { ok: false, reason: 'espacement avec le départ précédent' };
    if (this.nextArrivalDist(id) < 6000) return { ok: false, reason: 'trafic en courte finale' };
    this.depQueue.shift(); this.lastDeparture = now; this.occupy(id, now);
    return { ok: true };
  }
  removeDeparture(id) { this.depQueue = this.depQueue.filter((x) => x !== id); }
}

/** All controllers of the network. */
export class ATC {
  constructor(layouts, weather) { this.weather = weather; this.at = {}; for (const L of layouts) this.at[L.ap.id] = new AirportATC(L, weather); this.feed = []; }
  of(id) { return this.at[id]; }
  say(apId, role, text, to = null) { const e = { apId, role, text, to, at: Date.now() }; this.feed.unshift(e); this.feed.length = Math.min(this.feed.length, 30); this.onSay?.(e); return e; }
}
