// In-game economy: balance in euros, an owned fleet of trains and buses (each with a unique vehicle ID,
// condition, odometer and maintenance interval), purchases, repairs and servicing, and the settlement of
// every metro run and bus shift (revenue from service quality, distance and passengers, penalties for
// incidents). Pure data over the save file: the UI and the games call into it, nothing else stores money.
export const START_BALANCE = 80000;
export const STARTER_FLEET = [{ kind: 'train', model: 'mx80' }, { kind: 'bus', model: 'urbano12' }];
const LEDGER_MAX = 40;

export const eur = (v) => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} €`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class Economy {
  /** save: SaveSystem; catalog: { train: [specs], bus: [specs] } (each spec with id, name, price). */
  constructor(save, catalog = { train: [], bus: [] }) {
    this.save = save; this.catalog = catalog;
    const d = save.data;
    const fresh = !d.economy;
    if (fresh) d.economy = { balance: START_BALANCE, fleet: [], seq: {}, ledger: [], earned: 0, spent: 0 };
    this.d = d.economy;
    if (fresh) { for (const s of STARTER_FLEET) this._add(s.kind, s.model, 0, 'Starter vehicle'); this.persist(); }
  }
  persist() { this.save.save(); }

  get balance() { return this.d.balance; }
  get fleet() { return this.d.fleet; }
  get ledger() { return this.d.ledger; }
  spec(kind, model) { return (this.catalog[kind] || []).find((s) => s.id === model) || null; }
  priceOf(kind, model) { const s = this.spec(kind, model); return s ? (s.price ?? Math.round((s.capacity || 500) * 250)) : 0; }
  owned(kind) { return this.d.fleet.filter((v) => v.kind === kind); }
  vehicle(uid) { return this.d.fleet.find((v) => v.uid === uid) || null; }
  ownsModel(kind, model) { return this.d.fleet.some((v) => v.kind === kind && v.model === model); }

  _uid(kind, model) {
    const s = this.spec(kind, model);
    const prefix = (s?.fleetPrefix || model).toUpperCase().replace(/[^A-Z0-9]+/g, '');
    const seq = (this.d.seq[prefix] = (this.d.seq[prefix] || 0) + 1);
    return `${kind === 'bus' ? 'BUS-' : kind === 'aircraft' ? 'F-' : ''}${prefix}-${String(seq).padStart(3, '0')}`;
  }
  _add(kind, model, price, note) {
    const e = this.d;
    const v = { uid: this._uid(kind, model), kind, model, bought: Date.now(), price, odometer: 0, sinceService: 0, condition: 1, incidents: 0 };
    e.fleet.push(v);
    this.log(note || `Purchase ${v.uid}`, -price, v.uid);
    return v;
  }
  log(text, amount, uid = null) {
    const e = this.d;
    e.ledger.unshift({ t: Date.now(), text, amount: Math.round(amount), uid });
    if (e.ledger.length > LEDGER_MAX) e.ledger.length = LEDGER_MAX;
    if (amount > 0) e.earned += amount; else e.spent -= amount;
  }
  _pay(amount, text, uid) {
    if (amount > this.d.balance + 1e-6) return { ok: false, reason: `Not enough money: ${eur(amount)} needed, balance ${eur(this.d.balance)}.` };
    this.d.balance -= amount; this.log(text, -amount, uid); this.persist();
    return { ok: true };
  }

  buy(kind, model) {
    const s = this.spec(kind, model);
    if (!s) return { ok: false, reason: 'Unknown vehicle.' };
    const price = this.priceOf(kind, model);
    if (price > this.d.balance) return { ok: false, reason: `Not enough money to buy ${s.name}: ${eur(price)} needed, balance ${eur(this.d.balance)}.` };
    this.d.balance -= price;
    const v = this._add(kind, model, price, `Purchase ${s.name}`);
    this.persist();
    return { ok: true, vehicle: v };
  }
  /** Resale: 60 % of the price, reduced by wear. The last vehicle of a kind cannot be sold. */
  sellValue(v) { return Math.round(this.priceOf(v.kind, v.model) * 0.6 * (0.4 + 0.6 * v.condition)); }
  sell(uid) {
    const v = this.vehicle(uid); if (!v) return { ok: false, reason: 'Unknown vehicle.' };
    if (v.kind !== 'aircraft' && this.owned(v.kind).length <= 1) return { ok: false, reason: `You need at least one ${v.kind === 'bus' ? 'bus' : 'train'}.` };
    const value = this.sellValue(v);
    this.d.fleet = this.d.fleet.filter((x) => x !== v);
    this.d.balance += value; this.log(`Sale ${v.uid}`, value, v.uid); this.persist();
    return { ok: true, value };
  }

  // ---- maintenance ----
  serviceInterval(v) { return this.spec(v.kind, v.model)?.serviceIntervalKm ?? 400; }
  serviceDue(v) { return v.sinceService >= this.serviceInterval(v); }
  serviceCost(v) { return Math.round(this.priceOf(v.kind, v.model) * 0.012); }
  repairCost(v) { return Math.round(this.priceOf(v.kind, v.model) * 0.3 * (1 - v.condition)); }
  /** Scheduled maintenance: resets the interval and recovers some wear. */
  service(uid) {
    const v = this.vehicle(uid); if (!v) return { ok: false, reason: 'Unknown vehicle.' };
    const r = this._pay(this.serviceCost(v), `Maintenance ${v.uid}`, uid); if (!r.ok) return r;
    v.sinceService = 0; v.condition = Math.min(1, v.condition + 0.08); this.persist(); return r;
  }
  /** Full repair to 100 % (also clears bus body damage). */
  repair(uid) {
    const v = this.vehicle(uid); if (!v) return { ok: false, reason: 'Unknown vehicle.' };
    const cost = this.repairCost(v);
    if (cost <= 0) return { ok: false, reason: 'Nothing to repair.' };
    const r = this._pay(cost, `Repair ${v.uid}`, uid); if (!r.ok) return r;
    v.condition = 1; delete v.damage; v.incidents = 0; this.persist(); return r;
  }
  /** Pay for part of a repair done gradually (bus depot maintenance hall). Returns the condition bought. */
  payPartialRepair(uid, dCondition) {
    const v = this.vehicle(uid); if (!v) return 0;
    const cost = this.priceOf(v.kind, v.model) * 0.3 * dCondition;
    if (cost > this.d.balance) return 0;
    this.d.balance -= cost; this.d.spent += cost;
    const last = this.d.ledger[0];
    if (last && last.uid === uid && last.text === `Repair ${uid} (depot hall)` && Date.now() - last.t < 600000) last.amount -= cost;
    else this.log(`Repair ${uid} (depot hall)`, -cost, uid);
    return dCondition;
  }
  /** Performance factor of a worn vehicle (1 = as new). */
  performance(v) { return v ? 0.7 + 0.3 * clamp01(v.condition / 0.6) : 1; }

  /** Wear after a service: distance, incidents and overdue maintenance. */
  wear(uid, { km = 0, incidents = 0, crash = false, condition = null } = {}) {
    const v = this.vehicle(uid); if (!v) return null;
    v.odometer += km; v.sinceService += km;
    const overdue = this.serviceDue(v) ? 2 : 1;
    if (condition != null) v.condition = clamp01(condition);
    else v.condition = clamp01(v.condition - km * 0.0012 * (400 / this.serviceInterval(v)) * overdue - incidents * 0.01 - (crash ? 0.35 : 0));
    if (incidents || crash) v.incidents += incidents + (crash ? 1 : 0);
    this.persist();
    return v;
  }

  // ---- settlement ----
  /**
   * Metro run. r: { completed, score, distanceKm, stationsServed, missed, carried, punctuality (0..1), penalties [{text, points}],
   * crashed, uid }
   */
  settleMetro(r) {
    const items = [];
    const quality = 0.5 + (r.score / 1000) * 0.7; // 0.5 .. 1.2
    if (r.completed) {
      items.push({ label: `Service operated · ${r.distanceKm.toFixed(1)} km`, amount: r.distanceKm * 140 });
      items.push({ label: `${r.stationsServed} station stops`, amount: r.stationsServed * 45 });
      items.push({ label: `${r.carried} passengers carried`, amount: r.carried * 1.9 });
      const base = items.reduce((a, i) => a + i.amount, 0);
      items.push({ label: `Service quality (score ${r.score}/1000)`, amount: base * (quality - 1) });
      if (r.punctuality != null) items.push({ label: `Regularity bonus (${Math.round(r.punctuality * 100)} % on time)`, amount: base * 0.25 * r.punctuality });
    } else items.push({ label: 'Service not completed — no revenue', amount: 0 });
    this.penaltyItems(r, items, { skipped: 250, perPoint: 3 });
    return this.post(items, `Metro ${r.label || ''}`.trim(), r.uid);
  }
  /** Bus shift. r: { completed, score, distanceKm, stopsServed, stopsSkipped, carried, penalties, energyCost, uid } */
  settleBus(r) {
    const items = [];
    const quality = 0.5 + (r.score / 1000) * 0.7;
    if (r.completed) {
      items.push({ label: `Route operated · ${r.distanceKm.toFixed(1)} km`, amount: r.distanceKm * 110 });
      items.push({ label: `${r.stopsServed} stops served`, amount: r.stopsServed * 30 });
      items.push({ label: `${r.carried} passengers carried`, amount: r.carried * 1.7 });
      const base = items.reduce((a, i) => a + i.amount, 0);
      items.push({ label: `Service quality (score ${r.score}/1000)`, amount: base * (quality - 1) });
    } else items.push({ label: 'Shift not completed — no revenue', amount: 0 });
    if (r.energyCost) items.push({ label: 'Fuel / electricity used', amount: -r.energyCost });
    this.penaltyItems(r, items, { skipped: 150, perPoint: 3 });
    return this.post(items, `Bus ${r.label || ''}`.trim(), r.uid);
  }
  /**
   * Main-line (TGV) journey. r: { completed, score, distanceKm, carried, capacity, finalDelay (s, at the
   * destination), penalties, missed, lease (€ hire fee when driving a leased trainset), service, uid }.
   * Revenue = tickets (distance-based fares, first class dearer) — track access charges and traction energy;
   * a punctuality bonus when arriving within 5 minutes, passenger compensation beyond 30 minutes late.
   */
  settleRail(r) {
    const items = [], km = r.distanceKm;
    if (r.completed) {
      const pax = Math.max(r.carried || 0, Math.round((r.capacity || 400) * 0.35));
      const fare = 0.16 * km + 6, firstShare = 0.22;
      const tickets = pax * fare * (1 + firstShare * 0.6);
      items.push({ label: `${pax} travellers · ${km.toFixed(0)} km (1st & 2nd class tickets)`, amount: tickets });
      const quality = 0.5 + (r.score / 1000) * 0.7;
      items.push({ label: `Service quality (score ${r.score}/1000)`, amount: tickets * 0.25 * (quality - 1) });
      const late = Math.max(0, r.finalDelay ?? 0) / 60;
      if (late <= 5) items.push({ label: `Punctuality bonus (arrived ${late < 1 ? 'on time' : `+${Math.round(late)} min`})`, amount: tickets * 0.12 });
      else if (late > 30) items.push({ label: `Passenger compensation (+${Math.round(late)} min late)`, amount: -tickets * (late > 60 ? 0.5 : 0.25) });
    } else items.push({ label: 'Journey not completed — tickets refunded', amount: 0 });
    items.push({ label: `Track access charges · ${km.toFixed(0)} km`, amount: -km * 8 });
    items.push({ label: 'Traction energy', amount: -km * 11 });
    if (r.lease) items.push({ label: 'Trainset hire (leased)', amount: -r.lease });
    this.penaltyItems(r, items, { skipped: 1500, perPoint: 6 });
    return this.post(items, `TGV ${r.service || ''}`.trim(), r.uid);
  }
  /**
   * A service operated by a company driver with one of the player's trainsets (assigned in the Grandes Lignes
   * screen): the journey is simulated from the vehicle's condition and the service's own delay, then settled.
   */
  operateRail(uid, sv, { km, capacity, seed = Date.now() }) {
    const v = this.vehicle(uid); if (!v) return { ok: false, reason: 'Unknown trainset.' };
    if (v.condition < 0.25) return { ok: false, reason: `${uid} is unfit for service (condition ${Math.round(v.condition * 100)} %). Repair it first.` };
    const rnd = (k) => { let h = Math.imul((seed + k) | 0, 2654435761) >>> 0; h ^= h >>> 15; return (h >>> 0) / 4294967295; };
    const failure = rnd(1) < (1 - v.condition) * 0.25 + (this.serviceDue(v) ? 0.08 : 0);
    const delay = (sv.delay || 0) + (failure ? 1200 + rnd(2) * 2400 : rnd(3) * 240);
    const load = 0.55 + rnd(4) * 0.4;
    const res = this.settleRail({ completed: true, score: failure ? 600 : 860, distanceKm: km, carried: Math.round(capacity * load), capacity, finalDelay: delay, service: `${sv.no} · ${sv.destination} (company driver)`, uid });
    res.items.push({ label: 'Driver & on-board crew', amount: -Math.round(km * 3.5) });
    const crew = res.items.at(-1).amount; this.d.balance += crew; this.d.ledger[0].amount += crew; res.total += crew; res.balance = this.d.balance; this.persist();
    this.wear(uid, { km });
    return { ok: true, ...res, delay, failure };
  }
  /**
   * Airline flight. r: { completed, flightNo, from, to, km, seats, load (0..1), fuelUsed (kg), mtow (t), lease (€, 0 when
   * own aircraft), blockMin, costPerHour, delayMin (arrival vs schedule), landingFpm, penalties, crashed, diverted, uid }.
   * Tickets by distance, fuel at 0.92 €/kg, landing / navigation / handling fees by airport and weight, maintenance
   * reserve by block hours, punctuality bonus (≤ 5 min) or compensation (> 30 min), smooth-landing bonus.
   */
  settleFlight(r) {
    const items = [], km = r.km;
    if (r.completed) {
      const pax = Math.round(r.seats * r.load), fare = 0.17 * km + 38;
      const tickets = pax * fare; items.push({ label: `${pax} passengers · ${r.from} → ${r.to} · ${km.toFixed(0)} km`, amount: tickets });
      const late = Math.max(0, r.delayMin || 0);
      if (late <= 5) items.push({ label: `Punctuality bonus (${late < 1 ? 'on time' : `+${Math.round(late)} min`})`, amount: tickets * 0.1 });
      else if (late > 30) items.push({ label: `Passenger compensation (+${Math.round(late)} min late)`, amount: -tickets * (late > 120 ? 0.6 : 0.2) });
      if (r.landingFpm != null && r.landingFpm < 240) items.push({ label: `Smooth landing (${Math.round(r.landingFpm)} ft/min)`, amount: 250 });
    } else items.push({ label: r.crashed ? 'Flight lost — tickets refunded, insurance excess' : 'Flight not completed — tickets refunded', amount: r.crashed ? -50000 : 0 });
    items.push({ label: `Fuel · ${Math.round(r.fuelUsed)} kg`, amount: -r.fuelUsed * 0.92 });
    items.push({ label: 'Landing, navigation & handling fees', amount: -(r.mtow * 9 + 380 + km * 1.6) });
    items.push({ label: `Maintenance reserve · ${(r.blockMin / 60).toFixed(1)} h`, amount: -(r.costPerHour * 0.35) * (r.blockMin / 60) });
    if (r.lease) items.push({ label: 'Aircraft lease (per flight)', amount: -r.lease });
    this.penaltyItems(r, items, { skipped: 0, perPoint: 8 });
    return this.post(items, `Flight ${r.flightNo || ''}`.trim(), r.uid);
  }
  penaltyItems(r, items, { skipped, perPoint }) {
    if (r.missed) items.push({ label: `${r.missed} station(s) / stop(s) skipped`, amount: -r.missed * skipped });
    for (const p of r.penalties || []) items.push({ label: `${p.text}${p.count > 1 ? ` ×${p.count}` : ''}`, amount: -p.points * perPoint });
  }
  post(items, text, uid) {
    for (const i of items) i.amount = Math.round(i.amount);
    const total = items.reduce((a, i) => a + i.amount, 0);
    this.d.balance += total; this.log(text, total, uid); this.persist();
    return { items, total, balance: this.d.balance };
  }
}
