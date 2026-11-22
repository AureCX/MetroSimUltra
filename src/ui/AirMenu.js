// Aviation section of the menu: departure / arrival boards of the seven airports (flight, airline, aircraft,
// destination, time, gate, runway, status), flight selection (scheduled flight, own aircraft or lease, start at the
// stand / lined up / on final, weather, traffic density), the airline fleet (buy, service, repair, sell) and the
// flight summary (score, landing, penalties, earnings).
import { earningsTable } from './Menu.js';
import { eur } from '../economy/Economy.js';
import { AIRPORTS, AIRCRAFT, AIRCRAFT_IDS, airport, airlineOf, distKm } from '../air/AirData.js';
import { FlightSchedule, fmtT, blockTime } from '../air/AirTraffic.js';
import { AIR_WEATHER, AIR_WEATHER_KINDS } from '../air/AirWeather.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class AirMenu {
  constructor(menu, save) {
    this.menu = menu; this.save = save;
    const d = save.data.air ||= { flights: 0, hours: 0, landings: [], best: 0 };
    this.sel = { ap: 'GRV', kind: 'dep', hour: 8, weather: 'auto', start: 'stand', density: 1, uid: '', ...(d.sel || {}) };
    this.tab = 'board';
  }
  get economy() { return this.menu.economy; }
  persist() { this.save.data.air.sel = this.sel; this.save.save(); }
  show(tab = this.tab) {
    this.tab = tab; this.menu.context = 'main';
    const body = this.menu.frame('✈ Aviation — Pilot & Air Traffic', `
      <div class="dir-toggle">${[['board', '🛫 Departures & arrivals'], ['fleet', '🛩 Fleet & purchases'], ['logbook', '📒 Logbook']].map(([k, l]) => `<button class="btn small ${tab === k ? 'primary' : ''}" data-tab="${k}">${l}</button>`).join('')}
      ${this.menu.balanceChip()}</div><div id="air-body"></div>`, { wide: true });
    body.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => this.show(b.dataset.tab)));
    this[`tab_${tab}`](body.querySelector('#air-body'));
  }
  aircraftChoices(type) {
    const own = (this.economy?.owned('aircraft') || []).filter((v) => v.model === type && v.condition > 0.25);
    return own;
  }
  tab_board(el) {
    const s = this.sel, sch = new FlightSchedule(1), clock = s.hour * 3600;
    const list = sch.board(s.ap, s.kind, clock - 20 * 60, 14);
    el.innerHTML = `
      <div class="row-tools">${AIRPORTS.map((a) => `<button class="btn small ${a.id === s.ap ? 'primary' : ''}" data-ap="${a.id}">${a.icao} ${esc(a.city)}</button>`).join('')}</div>
      <div class="row-tools"><button class="btn small ${s.kind === 'dep' ? 'primary' : ''}" data-kind="dep">Départs</button><button class="btn small ${s.kind === 'arr' ? 'primary' : ''}" data-kind="arr">Arrivées</button>
        <label>Time <select id="ab-hour">${Array.from({ length: 17 }, (_, i) => i + 6).map((h) => `<option value="${h}" ${h === s.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <label>Weather <select id="ab-wx">${AIR_WEATHER_KINDS.map((k) => `<option value="${k}" ${k === s.weather ? 'selected' : ''}>${k === 'auto' ? 'Automatic (changes)' : AIR_WEATHER[k].label}</option>`).join('')}</select></label>
        <label>Start <select id="ab-start"><option value="stand" ${s.start === 'stand' ? 'selected' : ''}>At the stand (full flight)</option><option value="runway" ${s.start === 'runway' ? 'selected' : ''}>Lined up on the runway</option><option value="approach" ${s.start === 'approach' ? 'selected' : ''}>On final approach</option></select></label>
        <label>AI traffic <select id="ab-dens">${[[1, 'Full schedule'], [0.6, 'Reduced'], [0.3, 'Light']].map(([v, l]) => `<option value="${v}" ${+s.density === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="fids">
        <div class="fids-h">${s.kind === 'dep' ? 'DÉPARTS · DEPARTURES' : 'ARRIVÉES · ARRIVALS'} — ${esc(airport(s.ap).name)} <span>${fmtT(clock)}</span></div>
        <table><thead><tr><th>Heure</th><th>Vol</th><th>Compagnie</th><th>Avion</th><th>${s.kind === 'dep' ? 'Destination' : 'Provenance'}</th><th>Porte</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map((f) => { const st = sch.status(f, clock), t = s.kind === 'dep' ? f.dep : f.arr; return `<tr>
          <td>${fmtT(t)}${f.delay ? `<br><small class="late">${fmtT(t + f.delay)}</small>` : ''}</td><td><b>${esc(f.no)}</b></td><td><i class="al" style="background:${f.airline.color}"></i>${esc(f.airline.name)}</td><td>${AIRCRAFT[f.type].short}</td>
          <td>${esc(airport(s.kind === 'dep' ? f.to : f.from).city)}</td><td>${f.gate || '—'}</td><td style="color:${st.color}">${esc(st.label)}</td>
          <td>${s.kind === 'dep' && !f.cancelled ? `<button class="btn small primary" data-fly="${f.id}">Fly</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8">No flights.</td></tr>'}
        </tbody></table></div>
      <p class="sub">Pick a departure to fly it: ${esc('the flight number, aircraft type, times and destination come from the timetable')}. You fly your own aircraft of that type if you have one (Fleet tab), otherwise a leased one (fee deducted from the flight's earnings). Revenue is shared with the metro, bus and TGV balance.</p>
      <div id="ab-pick"></div>`;
    el.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => { s.ap = b.dataset.ap; this.persist(); this.show('board'); }));
    el.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { s.kind = b.dataset.kind; this.persist(); this.show('board'); }));
    el.querySelector('#ab-hour').onchange = (e) => { s.hour = +e.target.value; this.persist(); this.show('board'); };
    el.querySelector('#ab-wx').onchange = (e) => { s.weather = e.target.value; this.persist(); };
    el.querySelector('#ab-start').onchange = (e) => { s.start = e.target.value; this.persist(); };
    el.querySelector('#ab-dens').onchange = (e) => { s.density = +e.target.value; this.persist(); };
    el.querySelectorAll('[data-fly]').forEach((b) => (b.onclick = () => this.pick(sch.flights.find((f) => f.id === b.dataset.fly), el.querySelector('#ab-pick'))));
  }
  pick(f, el) {
    const S = AIRCRAFT[f.type], own = this.aircraftChoices(f.type), km = distKm(airport(f.from), airport(f.to));
    el.innerHTML = `<div class="selection-card"><div><b>${esc(f.no)}</b> · ${esc(f.airline.name)} · ${esc(airport(f.from).name)} → ${esc(airport(f.to).name)} · ${km.toFixed(0)} km · dep ${fmtT(f.dep)} · arr ${fmtT(f.arr)} (${Math.round(blockTime(f.type, km) / 60)} min block)<br>
      <span class="sub">${esc(S.name)} · ${S.seats} seats · Vr ${Math.round(S.vr * 1.944)} kt · Vref ${Math.round(S.vref * 1.944)} kt · ${S.engines} × ${S.kind === 'jet' ? `${Math.round(S.thrust / S.engines / 1000)} kN` : `${Math.round(S.power / S.engines / 1000)} kW`}</span><br>
      <label>Aircraft <select id="ap-uid"><option value="">Leased ${S.short} (${eur(S.lease)} per flight)</option>${own.map((v) => `<option value="${v.uid}">${esc(v.uid)} · condition ${Math.round(v.condition * 100)} %</option>`).join('')}</select></label></div>
      <button class="btn primary" id="ap-go">✈ Start flight</button></div>`;
    el.querySelector('#ap-go').onclick = () => {
      const s = this.sel; this.persist();
      this.menu.emit('airPlay', { flight: { no: f.no, airline: f.airline.code, type: f.type, from: f.from, to: f.to, dep: f.dep, arr: f.arr, scheduleId: f.id }, start: s.start, hour: s.start === 'stand' ? (f.dep - 15 * 60) / 3600 : s.start === 'runway' ? f.dep / 3600 : (f.arr - 6 * 60) / 3600, weather: s.weather, density: s.density, aircraftUid: el.querySelector('#ap-uid').value || null, day: 1 });
    };
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  tab_fleet(el) {
    const E = this.economy; if (!E) { el.innerHTML = '<p>Economy unavailable.</p>'; return; }
    const own = E.owned('aircraft');
    el.innerHTML = `<h3>Your aircraft</h3>
      <table class="stations"><thead><tr><th>Aircraft</th><th>Hours / km</th><th>Condition</th><th></th></tr></thead><tbody>
      ${own.map((v) => { const S = AIRCRAFT[v.model]; return `<tr><td>✈ <b>${esc(v.uid)}</b><br><span class="sub">${esc(S.name)} · ${S.seats} seats</span></td><td>${Math.round(v.odometer).toLocaleString('fr-FR')} km${E.serviceDue(v) ? '<br><b class="warn">maintenance due</b>' : ''}</td><td>${Math.round(v.condition * 100)} %</td>
        <td class="row-tools"><button class="btn small" data-svc="${v.uid}">Service ${eur(E.serviceCost(v))}</button>${v.condition < 0.999 ? `<button class="btn small" data-rep="${v.uid}">Repair ${eur(E.repairCost(v))}</button>` : ''}<button class="btn small danger" data-sell="${v.uid}">Sell ${eur(E.sellValue(v))}</button></td></tr>`; }).join('') || '<tr><td colspan="4">No aircraft yet — fly leased aircraft, or buy one below.</td></tr>'}</tbody></table>
      <h3>Buy aircraft</h3>
      <table class="stations"><tbody>${AIRCRAFT_IDS.map((id) => { const S = AIRCRAFT[id], p = E.priceOf('aircraft', id), ok = p <= E.balance; return `<tr><td><b>${esc(S.name)}</b><br><span class="sub">${S.seats} seats · cruise ${Math.round(S.cruise * 1.944)} kt · ${S.fuelBurn} kg/h · lease ${eur(S.lease)} / flight</span></td><td>${eur(p)}</td><td><button class="btn small ${ok ? 'primary' : ''}" data-buy="${id}" ${ok ? '' : 'disabled'}>${ok ? 'Buy' : 'Not enough money'}</button></td></tr>`; }).join('')}</tbody></table>
      <p class="sub">Own aircraft pay no lease; they wear with every flight (more with hard landings and over-stress) and need maintenance every ${E.serviceInterval({ kind: 'aircraft', model: 'a320' })} km.</p>`;
    const act = (fn) => (b) => (b.onclick = () => { const r = fn(b); if (r && !r.ok) this.menu.notice(r.reason); this.show('fleet'); });
    el.querySelectorAll('[data-buy]').forEach(act((b) => E.buy('aircraft', b.dataset.buy)));
    el.querySelectorAll('[data-svc]').forEach(act((b) => E.service(b.dataset.svc)));
    el.querySelectorAll('[data-rep]').forEach(act((b) => E.repair(b.dataset.rep)));
    el.querySelectorAll('[data-sell]').forEach(act((b) => E.sell(b.dataset.sell)));
  }
  tab_logbook(el) {
    const d = this.save.data.air;
    el.innerHTML = `<p>${d.flights} flight(s) · ${d.hours.toFixed(1)} h · best score ${d.best}</p>
      <table class="stations"><thead><tr><th>Flight</th><th>Route</th><th>Aircraft</th><th>Landing</th><th>Score</th></tr></thead><tbody>
      ${(d.landings || []).slice(0, 20).map((l) => `<tr><td>${esc(l.no)}</td><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(l.type)}</td><td>${l.fpm != null ? `${Math.round(l.fpm)} ft/min` : '—'}</td><td>${l.score}</td></tr>`).join('') || '<tr><td colspan="5">No flights yet.</td></tr>'}</tbody></table>`;
  }
  summary(r) {
    const E = this.economy, S = r.type, f = r.flight;
    r.settlement = E?.settleFlight({ completed: r.completed, crashed: r.crashed, flightNo: f.no, from: f.from, to: f.to, km: r.km, seats: S.seats, load: r.load, fuelUsed: r.fuelUsed, mtow: S.mtow / 1000, lease: r.uid ? 0 : S.lease, blockMin: r.blockMin, costPerHour: S.costPerHour, delayMin: r.delayMin, landingFpm: r.landingFpm, penalties: r.penalties, uid: r.uid });
    if (r.uid && E?.vehicle(r.uid)) r.vehicleAfter = E.wear(r.uid, { km: r.km, incidents: r.penalties.reduce((a, p) => a + p.count, 0) + (r.landingFpm > 600 ? 2 : 0), crash: r.crashed });
    const d = this.save.data.air; d.flights++; d.hours += r.blockMin / 60; d.best = Math.max(d.best, r.score);
    (d.landings ||= []).unshift({ no: f.no, from: f.from, to: f.to, type: S.short, fpm: r.landingFpm, score: r.score, t: Date.now() }); d.landings.length = Math.min(d.landings.length, 40);
    this.save.save();
    const grade = r.score >= 900 ? 'S' : r.score >= 780 ? 'A' : r.score >= 620 ? 'B' : r.score >= 450 ? 'C' : 'D';
    const m = this.menu; m.root.style.display = '';
    m.root.innerHTML = `<div class="menu-screen summary"><header><h2>${r.crashed ? `Crash — ${esc(r.crashReason || '')}` : r.completed ? `Flight ${esc(f.no)} complete` : 'Flight ended'}</h2></header><div class="menu-body">
      <div class="grade grade-${grade}">${grade}</div><div class="score">${r.score} <small>/ 1000</small></div>
      <p class="sub">${esc(airport(f.from).city)} → ${esc(airport(f.to).city)} · ${esc(S.name)} · ${r.km.toFixed(0)} km · block ${Math.round(r.blockMin)} min · fuel ${Math.round(r.fuelUsed)} kg · max ${r.maxG.toFixed(2)} g${r.landingFpm != null ? ` · touchdown ${Math.round(r.landingFpm)} ft/min` : ''}${r.completed ? ` · ${r.delayMin <= 0 ? 'on time' : `+${r.delayMin} min`}` : ''}</p>
      ${r.penalties.length ? `<h3>Penalties</h3><ul class="penalties">${r.penalties.map((p) => `<li>${esc(p.text)}${p.count > 1 ? ` ×${p.count}` : ''} <b>−${p.points * p.count}</b></li>`).join('')}</ul>` : '<p>No penalties.</p>'}
      ${earningsTable(r.settlement, r.vehicleAfter)}
      <div class="row-tools"><button class="btn primary" id="as-again">Departures board</button><button class="btn ghost" data-nav="main">Main menu</button></div></div></div>`;
    m.root.querySelector('#as-again').onclick = () => this.show('board');
  }
}
