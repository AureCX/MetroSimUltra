// "Grandes Lignes" screen: the day's departure board of Gare Centrale (train number, destination, calling points,
// track, journey time, live status), assignment of the player's TGV trainsets to services, driving a departure
// (own trainset or a hired one), company-driver runs that earn money without driving, and the TGV fleet.
import { TgvTimetable, fmt } from '../rail/TgvTimetable.js';
import { eur } from '../economy/Economy.js';
import { RailMapModel, drawRailMap, railStationInfo, ROUTE_COLORS } from './RailMap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const LEASE = { 'tgv-duplex': 2400, 'tgv-classic': 1800 };
const nowClock = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
const dayNo = () => Math.floor(Date.now() / 86400000);

export function installTgvMenu(Menu) {
  Object.assign(Menu.prototype, {
    tgvLines() { return this.repo.lines.filter((l) => l.category === 'hst'); },
    tgvTrains() { return this.repo.trains.filter((t) => t.category === 'hst'); },
    tgvAssignments() { const e = this.save.data.economy; return (e.assign ??= {}); },

    screen_tgv() {
      const E = this.economy, lines = this.tgvLines(), tt = new TgvTimetable(lines, dayNo()), clock = nowClock();
      const A = this.tgvAssignments();
      const mine = E.owned('train').filter((v) => this.repo.train(v.model)?.category === 'hst');
      const deps = tt.services.filter((s) => s.kind === 'dep');
      const key = (sv) => `${sv.no}`;
      const opts = (sv) => {
        const cur = A[key(sv)] || '';
        return `<select data-assign="${key(sv)}"><option value="">— hire a trainset —</option>${mine.map((v) => `<option value="${v.uid}" ${cur === v.uid ? 'selected' : ''}>${esc(v.uid)} · ${Math.round(v.condition * 100)} %</option>`).join('')}</select>`;
      };
      const row = (sv) => {
        const st = tt.status(sv, clock), dur = `${Math.floor(sv.duration / 3600)}h${String(Math.round((sv.duration % 3600) / 60)).padStart(2, '0')}`;
        const done = this.save.data.economy.railDone?.[`${dayNo()}:${sv.no}`];
        return `<tr class="${st.code}">
          <td class="mono">${fmt(sv.time)}${sv.delay && !sv.cancelled ? `<br><span class="warn">+${sv.delay / 60}′</span>` : ''}</td><td class="mono">TGV ${sv.no}</td>
          <td><i class="route-dot" style="background:${ROUTE_COLORS[sv.lineId] || '#888'}"></i><b>${esc(sv.destination)}</b>${sv.via.length ? `<br><span class="sub">via ${sv.via.map(esc).join(', ')}</span>` : ''}</td>
          <td class="mono">${sv.cancelled ? '—' : sv.voie}</td><td>${dur}</td>
          <td><span class="tgv-status" style="color:${st.color}">${esc(st.label)}</span></td>
          <td>${sv.cancelled ? '<span class="sub">cancelled</span>' : opts(sv)}</td>
          <td class="row-tools">${sv.cancelled ? '' : `<button class="btn small primary" data-drive="${key(sv)}">Drive ▶</button>${A[key(sv)] ? `<button class="btn small" data-company="${key(sv)}" ${done ? 'disabled' : ''}>${done ? 'Operated ✓' : 'Company driver'}</button>` : ''}`}</td></tr>`;
      };
      const strip = (t) => `<div class="train-strip" style="background:linear-gradient(90deg, ${t.livery?.body || '#ddd'} 70%, ${t.livery?.front || '#333'})"><i style="background:${t.livery?.stripe || '#ffcc00'}"></i></div>`;
      const body = this.frame(`🚄 Grandes Lignes — Gare Centrale <span class="balance-chip">💶 ${eur(E.balance)}</span>`, `
        <p class="sub">Six TGV destinations from Gare Centrale (metro A · B · C). Assign your trainsets to departures, drive a service yourself
        from the platform to its destination, or let a company driver operate it. Statuses follow the current time (${fmt(clock)}). Without a
        trainset of your own, a TGV inOui Duplex is hired for the journey (${eur(LEASE['tgv-duplex'])}).</p>
        <div class="row-tools"><button class="btn" id="tgv-map">🗺 Network map — choose a destination</button></div>
        <div class="table-wrap"><table class="stations tgv-board">
          <thead><tr><th>Heure</th><th>Train</th><th>Destination</th><th>Voie</th><th>Durée</th><th>État</th><th>Trainset</th><th></th></tr></thead>
          <tbody>${deps.map(row).join('')}</tbody></table></div>
        <h3>💾 Saved stations</h3>
        ${this.savesHtml(true)}
        <h3>Your TGV fleet</h3>
        <div class="train-grid">${mine.length ? mine.map((v) => { const t = this.repo.train(v.model), n = Object.values(A).filter((u) => u === v.uid).length; return `
          <div class="train-card">${strip(t)}<h3>${esc(v.uid)} <span class="sub">${esc(t.name)}</span></h3>
          <div class="gauge"><i style="width:${Math.round(v.condition * 100)}%"></i></div>
          <p class="sub">Condition ${Math.round(v.condition * 100)} % · ${Math.round(v.odometer).toLocaleString('fr-FR')} km · ${E.serviceDue(v) ? '<b class="warn">maintenance due</b>' : `service in ${Math.max(0, Math.round(E.serviceInterval(v) - v.sinceService))} km`} · ${n} service(s) assigned</p>
          <div class="row-tools"><button class="btn small" data-nav="depot">Depot…</button></div></div>`; }).join('') : '<p class="sub">You do not own a TGV yet.</p>'}</div>
        <h3>Buy TGV trainsets</h3>
        <div class="train-grid">${this.tgvTrains().map((t) => { const price = E.priceOf('train', t.id), ok = price <= E.balance; return `
          <div class="train-card">${strip(t)}<h3>${esc(t.name)} <span class="price">${eur(price)}</span></h3><p class="sub">${esc(t.description || '')}</p>
          <p class="sub">${t.cars} cars · ${t.length.toFixed(0)} m · ${t.capacity} seats (${t.classes?.first ?? 2} first-class cars) · ${t.maxSpeed} km/h · ${t.maxPower} kW</p>
          ${t.model3d ? '<p class="sub">3D model: “tgv inoui” by <a href="https://sketchfab.com/yuimpou" target="_blank" rel="noopener">yuimpou</a> (CC BY 4.0)</p>' : ''}
          <div class="row-tools"><button class="btn small ${ok ? 'primary' : ''}" data-buytgv="${t.id}" ${ok ? '' : 'disabled'}>${ok ? 'Buy' : `Need ${eur(price - E.balance)} more`}</button></div></div>`; }).join('')}</div>
        <p class="sub model-credit">TGV Duplex 3D model: <a href="https://sketchfab.com/3d-models/tgv-inoui-69e3e860593f4907a00b63801e3a5c83" target="_blank" rel="noopener">“tgv inoui”</a> by <a href="https://sketchfab.com/yuimpou" target="_blank" rel="noopener">yuimpou</a>, licensed under <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>`, { wide: true });
      this.wireSaves(body, () => this.screen_tgv());
      body.querySelector('#tgv-map').onclick = () => {
        this.railModel ??= new RailMapModel(lines);
        const M = this.railModel;
        this.netOverlay?.show(M, () => ({}), {
          draw: drawRailMap, pick: (...a) => M.pick(...a),
          info: (st) => railStationInfo(M, st, { tt, clock, canDrive: true }),
          wire: (el) => el.querySelectorAll('[data-drive-dep]').forEach((b) => (b.onclick = () => { this.netOverlay.close(); body.querySelector(`[data-drive="${b.dataset.driveDep}"]`)?.click(); })),
        });
      };
      const svOf = (k) => deps.find((s) => key(s) === k);
      body.querySelectorAll('[data-assign]').forEach((sel) => (sel.onchange = () => { if (sel.value) A[sel.dataset.assign] = sel.value; else delete A[sel.dataset.assign]; this.save.save(); this.screen_tgv(); }));
      body.querySelectorAll('[data-buytgv]').forEach((b) => (b.onclick = () => { const r = E.buy('train', b.dataset.buytgv); if (!r.ok) return this.notice(r.reason); this.notice(`${r.vehicle.uid} delivered to the Grandes Lignes depot.`); this.screen_tgv(); }));
      body.querySelectorAll('[data-company]').forEach((b) => (b.onclick = () => {
        const sv = svOf(b.dataset.company), uid = A[b.dataset.company], v = E.vehicle(uid); if (!sv || !v) return;
        const t = this.repo.train(v.model), km = this.routeKm(sv.line);
        const r = E.operateRail(uid, sv, { km, capacity: t.capacity, seed: dayNo() * 100003 + sv.no });
        if (!r.ok) return this.notice(r.reason);
        (this.save.data.economy.railDone ??= {})[`${dayNo()}:${sv.no}`] = true; this.save.save();
        this.notice(`TGV ${sv.no} → ${sv.destination} operated by a company driver with ${uid}: ${r.failure ? 'technical incident, ' : ''}arrival ${r.delay < 300 ? 'on time' : `+${Math.round(r.delay / 60)} min`}.\n${r.items.map((i) => `${i.label}: ${eur(i.amount)}`).join('\n')}\nTotal ${eur(r.total)}`);
        this.screen_tgv();
      }));
      body.querySelectorAll('[data-drive]').forEach((b) => (b.onclick = () => {
        const sv = svOf(b.dataset.drive); if (!sv) return;
        const uid = A[b.dataset.drive], v = uid && E.vehicle(uid);
        let model = v?.model, lease = 0;
        if (!v) {
          model = this.tgvTrains().find((t) => t.model3d)?.id || this.tgvTrains()[0]?.id;   // default: the inOui Duplex (3D model)
          lease = LEASE[model] ?? 2000;
          if (lease > E.balance) return this.notice(`Hiring a trainset costs ${eur(lease)} (settled after the journey); your balance is ${eur(E.balance)}.`);
        } else if (v.condition < 0.25) return this.notice(`${uid} is unfit for service. Repair it in the depot or hire a trainset.`);
        const train = this.repo.train(model);
        const h = Math.floor(sv.time / 3600), m = Math.floor(sv.time / 60) % 60;
        const line = { ...sv.line, startTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00` };
        this.emit('play', { line, train, direction: 'A', vehicleUid: v ? v.uid : null, tgv: { service: sv.no, destination: sv.destination, lease, capacity: train.capacity } });
      }));
    },
    /** Station checkpoints: list (newest first) with resume / delete. hstOnly: main-line stations only. */
    savesHtml(hstOnly) {
      const list = this.save.listStations().filter((r) => !hstOnly || r.checkpoint.hst);
      if (!list.length) return '<p class="sub">No station saves yet — the game saves automatically at every station you stop at (or press P / use the pause menu at a platform).</p>';
      const t = (c) => fmt(c);
      return `<div class="table-wrap"><table class="stations"><thead><tr><th>Station</th><th>Service</th><th>Train</th><th>Time</th><th>Progress</th><th>Saved</th><th></th></tr></thead><tbody>${list.map((r) => {
        const c = r.checkpoint, p = r.progress, line = this.repo.line(c.lineId);
        const ok = line && this.repo.train(c.trainModel) && !c.final && (!c.trainUid || this.economy.vehicle(c.trainUid));
        return `<tr><td><b>${esc(c.stationName)}</b><br><span class="sub">${esc(c.network)}</span></td>
          <td><span class="line-badge" style="background:${c.color};color:#fff">${esc(c.number)}</span> ${c.tgv ? `TGV ${c.tgv.service} → ${esc(c.tgv.destination)}` : `→ ${esc(c.destination)}`}</td>
          <td>${esc(c.trainUid || `${c.trainName} (hired)`)}${c.condition != null ? `<br><span class="sub">${Math.round(c.condition * 100)} %</span>` : ''}</td>
          <td class="mono">${t(c.clock)}</td>
          <td class="sub">${p.visits} save(s) · ${p.arrivals} arrival(s)${p.bestStopError != null ? ` · best stop ${p.bestStopError >= 0 ? '+' : ''}${p.bestStopError.toFixed(2)} m` : ''}</td>
          <td class="sub">${new Date(c.savedAt).toLocaleString().slice(0, 17)}</td>
          <td class="row-tools">${ok ? `<button class="btn small primary" data-resume="${esc(r.id)}">Resume ▶</button>` : `<span class="sub">${c.final ? 'journey completed' : 'train / line no longer available'}</span>`}<button class="btn small ghost" data-delsave="${esc(r.id)}">Delete</button></td></tr>`;
      }).join('')}</tbody></table></div>`;
    },
    wireSaves(root, back) {
      root.querySelectorAll('[data-resume]').forEach((b) => (b.onclick = () => this.resumeStation(b.dataset.resume)));
      root.querySelectorAll('[data-delsave]').forEach((b) => this.confirmButton(b, () => { const r = this.save.deleteStation(b.dataset.delsave); if (!r.ok) this.notice(r.error); back(); }));
    },
    resumeStation(id) {
      const rec = this.save.loadStation(id);
      if (!rec) return this.notice('This station save is damaged and could not be restored.');
      const c = rec.checkpoint, base = this.repo.line(c.lineId), train = this.repo.train(c.trainModel);
      if (!base || !train) return this.notice('The line or train of this save is no longer available.');
      if (c.trainUid && !this.economy.vehicle(c.trainUid)) return this.notice(`${c.trainUid} is no longer in your fleet.`);
      const line = c.hst ? { ...base, startTime: c.startTime } : base;
      this.emit('play', { line, train, direction: c.direction, vehicleUid: c.trainUid || null, tgv: c.tgv || null, resume: c });
    },
    screen_saves() {
      const body = this.frame('💾 Station saves', `<p class="sub">Each station keeps its own checkpoint (train, service, position, time, passengers) and progress. Saving at one station never overwrites another. Saves are checksummed with a backup copy.</p>
        ${this.savesHtml(false)}
        <h3>Completed journeys (${this.save.data.rail.completed})</h3>
        <ul class="mp-feed">${this.save.data.rail.journeys.slice(0, 12).map((j) => `<li><span class="sub">${new Date(j.at).toLocaleDateString()}</span> ${esc(j.from)} → ${esc(j.to)} · ${j.km} km · ${j.score} pts${j.service ? ` · TGV ${j.service}` : ''}</li>`).join('') || '<li class="sub">None yet.</li>'}</ul>`, { wide: true });
      this.wireSaves(body, () => this.screen_saves());
    },
    routeKm(line) { return line.stations.reduce((a, s) => a + (s.distanceToNext || 0), 0) / 1000; },
  });
}
