// Main menu, line selection (network map, import/export, MP3 announcements), train selection,
// settings, controls (rebinding), credits, pause menu, loading screen and run summary.
import { renderNetworkMap, escapeXml as esc } from './NetworkMap.js';
import { ACTIONS, PAD_LABELS } from '../core/Input.js';
import { BUS_ACTIONS } from '../bus/BusControls.js';
import { AssetStore } from '../core/AssetStore.js';
import { formatClock, formatDelta, slugify } from '../core/util.js';
import { eur } from '../economy/Economy.js';
import { Timetable } from '../stations/Timetable.js';
import { TrackGeometry } from '../lines/TrackGeometry.js';
import { Route } from '../lines/Route.js';
import { EXAMPLE_LINE } from '../lines/LineRepository.js';

/** Earnings breakdown of a run / shift (shared with the bus summary). */
export function earningsTable(st, v) {
  if (!st) return '';
  return `<h3>Earnings</h3><table class="stations earnings"><tbody>${st.items.map((i) => `<tr><td>${esc(i.label)}</td><td class="${i.amount < 0 ? 'neg' : 'pos'}">${eur(i.amount)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td class="${st.total < 0 ? 'neg' : 'pos'}">${eur(st.total)}</td></tr></tbody></table>
    <p class="sub">Balance ${eur(st.balance)}${v ? ` · ${esc(v.uid)} condition ${Math.round(v.condition * 100)} %${v.condition < 0.6 ? ' — repair recommended (Depot & fleet)' : ''}` : ''}</p>`;
}

export class Menu {
  constructor(root, { repo, settings, save, input, bus, audio, busInput, economy, busRepo }) {
    Object.assign(this, { root, repo, settings, save, input, bus, audio, busInput, economy, busRepo });
    this.handlers = {};
    this.context = 'main'; // main | pause
    const sel = save.selection;
    this.sel = {
      lineId: repo.line(sel.lineId) ? sel.lineId : repo.lines[0]?.id,
      trainId: repo.train(sel.trainId) ? sel.trainId : repo.trains[0]?.id,
      direction: sel.direction === 'B' ? 'B' : 'A',
      trainUid: sel.trainUid,
    };
    this.ensureOwnedTrain();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (b) { this.audio.started && this.audio.click(); this.show(b.dataset.nav); }
    });
  }
  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, ...a) { this.handlers[evt]?.(...a); }
  get line() { return this.repo.line(this.sel.lineId); }
  /** The selected train is one the player owns (vehicle record); its model gives the specifications. */
  get vehicle() { return this.economy?.vehicle(this.sel.trainUid) || null; }
  get train() { return this.repo.train(this.vehicle?.model || this.sel.trainId); }
  ensureOwnedTrain() {
    if (!this.economy) return;
    const v = this.economy.vehicle(this.sel.trainUid);
    if (v && v.kind === 'train' && this.repo.train(v.model)) { this.sel.trainId = v.model; return; }
    const first = this.economy.owned('train').find((x) => this.repo.train(x.model));
    if (first) { this.sel.trainUid = first.uid; this.sel.trainId = first.model; }
  }
  selectVehicle(uid) { const v = this.economy.vehicle(uid); if (!v) return; this.sel.trainUid = uid; this.sel.trainId = v.model; this.persist(); }
  play(line) {
    this.ensureOwnedTrain();
    if (!line || !this.train || !this.vehicle) { this.notice('Choose a line and one of your trains first.'); return; }
    this.persist();
    this.emit('play', { line, train: this.train, direction: this.sel.direction, vehicleUid: this.vehicle.uid });
  }
  balanceChip() { return this.economy ? `<span class="balance-chip" title="Balance">💶 ${eur(this.economy.balance)}</span>` : ''; }
  persist() { this.save.setSelection(this.sel); }

  hide() { this.root.innerHTML = ''; this.root.style.display = 'none'; }
  show(screen) {
    this.root.style.display = '';
    const fn = this[`screen_${screen}`];
    if (fn) fn.call(this);
  }
  frame(title, body, { back = true, wide = false } = {}) {
    const backTo = this.context === 'pause' ? 'pause' : 'main';
    this.root.innerHTML = `<div class="menu-screen ${wide ? 'wide' : ''}">
      <header><h2>${title}</h2>${back ? `<button class="btn ghost" data-nav="${backTo}">← Back</button>` : ''}</header>
      <div class="menu-body">${body}</div></div>`;
    return this.root.querySelector('.menu-body');
  }

  // ---------------- Main ----------------
  screen_main() {
    this.context = 'main';
    const l = this.line, t = this.train;
    const rec = l ? this.save.record(l.id, l.loop ? 'A' : this.sel.direction) : null;
    this.root.innerHTML = `<div class="menu-main">
      <div class="brand"><div class="logo">M</div><div><h1>Metro Driver</h1><p>Underground railway simulator</p></div>${this.balanceChip()}</div>
      <nav>
        <button class="btn primary" id="m-play">▶ Play metro</button>
        <button class="btn primary bus-btn" id="m-bus">🚌 Bus — Grandville & Aéroval</button>
        <button class="btn" data-nav="lines">Select Line</button>
        <button class="btn" data-nav="trains">Trains & purchases</button>
        <button class="btn" data-nav="depot">Depot & fleet</button>
        <button class="btn" id="m-mp">🌐 Multiplayer</button>
        <button class="btn" data-nav="settings">Settings</button>
        <button class="btn" data-nav="controls">Controls</button>
        <button class="btn" data-nav="credits">Credits</button>
      </nav>
      <div class="selection-card">
        ${l ? `<div class="line-badge big" style="background:${l.color};color:${l.textColor}">${esc(l.number)}</div>
        <div><b>${esc(l.fullName)}</b> · ${esc(l.network)}<br><span class="sub">${esc(l.directions[this.sel.direction].name)} · ${l.stations.filter((x) => x.mirrorOf == null).length} stations</span><br>
        <span class="sub">Train: ${esc(t?.name || '-')}${this.vehicle ? ` · ${esc(this.vehicle.uid)} · condition ${Math.round(this.vehicle.condition * 100)} %${this.economy.serviceDue(this.vehicle) ? ' · <b class="warn">maintenance due</b>' : ''}` : ''}</span>
        ${rec ? `<br><span class="sub">Best: ${rec.bestScore} pts (grade ${rec.bestGrade}) · ${rec.runs} run(s)</span>` : ''}</div>` : '<div>No line available. Import one in “Select Line”.</div>'}
      </div>
      <div class="totals sub">Career: ${this.save.data.totals.runs} runs · ${this.save.data.totals.distanceKm.toFixed(1)} km · ${this.save.data.totals.stations} stations served</div>
      ${this.repo.errors.length ? `<div class="errors">${this.repo.errors.map(esc).join('<br>')}</div>` : ''}
    </div>`;
    this.root.querySelector('#m-bus').onclick = () => this.emit('bus');
    this.root.querySelector('#m-play').onclick = () => this.play(this.line);
    this.root.querySelector('#m-mp').onclick = () => this.emit('multiplayer');
  }

  // ---------------- Lines ----------------
  screen_lines() {
    const nets = this.repo.networks();
    const cur = this.line?.network || nets[0];
    this.network = this.network && nets.includes(this.network) ? this.network : cur;
    const body = this.frame('Select Line', `
      <div class="lines-layout">
        <div class="map-col">
          <div class="row-tools">
            <select id="l-net">${nets.map((n) => `<option ${n === this.network ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
            <label class="btn small">Import line JSON<input type="file" id="l-import" accept=".json,application/json" multiple hidden></label>
            <button class="btn small ghost" id="l-example">Example file</button>
          </div>
          <svg id="l-map" class="network-map" preserveAspectRatio="xMidYMid meet"></svg>
          <div id="l-list" class="line-list"></div>
        </div>
        <div class="detail-col" id="l-detail"></div>
      </div>`, { wide: true });
    body.querySelector('#l-example').onclick = () => this.showJson('Example line file', EXAMPLE_LINE);
    body.querySelector('#l-net').onchange = (e) => { this.network = e.target.value; const first = this.repo.lines.find((l) => l.network === this.network); if (first) this.sel.lineId = first.id; this.screen_lines(); };
    body.querySelector('#l-import').onchange = async (e) => {
      const msgs = [];
      for (const f of e.target.files) {
        try { const l = await this.repo.importLine(await f.text()); this.sel.lineId = l.id; this.network = l.network; msgs.push(`✓ ${l.name} imported`); }
        catch (err) { msgs.push(`✗ ${f.name}: ${err.message}`); }
      }
      this.persist();
      this.screen_lines();
      this.notice(msgs.join('\n'));
    };
    this.renderLines();
  }

  renderLines() {
    const lines = this.repo.lines.filter((l) => l.network === this.network);
    const select = (id) => {
      this.sel.lineId = id;
      const pref = this.repo.line(id)?.raw?.train; // a line may name its own rolling stock (Line D: Aéroval APM)
      const own = pref && this.economy?.owned('train').find((v) => v.model === pref);
      if (own) this.selectVehicle(own.uid);
      this.persist(); this.renderLines();
    };
    renderNetworkMap(this.root.querySelector('#l-map'), lines, this.sel.lineId, select);
    const list = this.root.querySelector('#l-list');
    // One entry per line; a branching line's services are chosen in the detail panel.
    const groups = [...new Map(lines.map((l) => [l.sourceId, this.repo.services(l)])).values()];
    const cur = this.line;
    list.innerHTML = groups.map((svcs) => {
      const l = svcs.find((x) => x.id === cur?.id) || svcs[0];
      const sel = svcs.some((x) => x.id === cur?.id);
      const ends = svcs.length > 1 ? `${esc(l.stations[0].name)} ↔ ${svcs.map((x) => esc(x.stations.at(-1).name)).join(' / ')}` : l.loop ? `${esc(l.stations[0].name)} → ${esc(l.loop.junction)} ⟲ ${l.loop.stations.map(esc).join(' · ')} (one-way loop)` : `${esc(l.stations[0].name)} ↔ ${esc(l.stations.at(-1).name)}`;
      return `<button class="line-item ${sel ? 'sel' : ''}" data-id="${l.id}">
      <span class="line-badge" style="background:${l.color};color:${l.textColor}">${esc(l.number)}</span>
      <span><b>${esc(l.name)}</b>${svcs.length > 1 ? ` <span class="sub">· ${svcs.length} branches</span>` : ''}<br><span class="sub">${ends}</span></span>
      ${l.builtIn ? '' : '<span class="tag">custom</span>'}</button>`;
    }).join('');
    list.querySelectorAll('.line-item').forEach((b) => (b.onclick = () => select(b.dataset.id)));
    this.renderLineDetail();
  }

  async renderLineDetail() {
    const l = this.line, el = this.root.querySelector('#l-detail');
    if (!l) { el.innerHTML = ''; return; }
    if (l.network !== this.network) { el.innerHTML = '<p class="sub">Select a line on the map.</p>'; return; }
    const audioKeys = new Set((await AssetStore.listAudioKeys(`${l.sourceId}/`)).map((k) => k.slice(l.sourceId.length + 1)));
    const geom = new TrackGeometry(l);
    const dirSel = l.loop ? 'A' : this.sel.direction;
    const route = new Route(l, geom, dirSel);
    const tt = new Timetable(route, this.train, l.startTime);
    const total = l.stations.reduce((a, s) => a + s.distanceToNext, 0);
    const svcs = this.repo.services(l);
    const dirLabel = (d) => (svcs.length > 1 && d === 'A' ? `Direction ${svcs.map((x) => x.service).join(' / ')}` : l.directions[d].name);
    const branchRow = svcs.length > 1 ? `<div class="branch-toggle"><span class="sub">${this.sel.direction === 'A' ? 'Destination:' : 'Starting from:'}</span>${svcs.map((x) => `<button class="btn small ${x.id === l.id ? 'primary' : ''}" data-svc="${x.id}">${esc(x.service)}</button>`).join('')}
      <span class="sub">${this.sel.direction === 'A' ? `Set the route at ${esc(l.stations[l.trunkLength - 1].name)} junction while driving.` : ''}</span></div>` : '';
    el.innerHTML = `
      <div class="detail-head"><span class="line-badge big" style="background:${l.color};color:${l.textColor}">${esc(l.number)}</span>
      <div><h3>${esc(l.name)}</h3><span class="sub">${esc(l.network)} · ${(total / 1000).toFixed(2)} km${l.loop ? ' circuit' : ''} · ${l.stations.filter((x) => x.mirrorOf == null).length} stations · ${l.signaling.system === 'cbtc' ? 'CBTC moving block' : 'Fixed-block signalling'} · ${l.tunnelProfile} tunnel</span></div></div>
      <div class="dir-toggle">${l.loop ? `<button class="btn small primary" data-dir="A">${esc(l.directions.A.name)}</button><span class="sub">One-way terminal loop at ${esc(l.loop.junction)}: ${l.loop.stations.map(esc).join(' → ')} → ${esc(l.loop.junction)}</span>` : ['A', 'B'].map((d) => `<button class="btn small ${d === this.sel.direction ? 'primary' : ''}" data-dir="${d}">${esc(dirLabel(d))}</button>`).join('')}</div>
      ${branchRow}
      <div class="table-wrap"><table class="stations">
        <thead><tr><th>#</th><th>Station</th><th>Next</th><th>Limit</th><th>Dwell</th><th>Arr</th><th>Platform</th><th title="Next-station announcement">🔊</th></tr></thead>
        <tbody>${route.stops.map((s, k) => {
          const st = s.station, e = tt.entry(k);
          const dist = dirSel === 'A' ? st.distanceToNext : (k < route.stops.length - 1 ? route.stops[k + 1].station.distanceToNext : 0);
          const has = audioKeys.has(st.id);
          return `<tr><td>${k + 1}</td><td>${esc(st.name)}${st.connections.length ? ` <span class="tag" title="Connections">${st.connections.map(esc).join(', ')}</span>` : ''}<span class="sub"> · ${st.style}</span></td><td>${dist ? `${dist} m` : '—'}</td><td>${st.speedLimit}</td><td>${st.stopDuration}s</td>
          <td>${formatClock(e.arr ?? e.dep, false)}</td><td>${st.platformType} · ${s.doorSide}</td>
          <td class="audio-cell">${has ? `<button class="icon" data-play="${st.id}" title="Play imported MP3">▶</button><button class="icon" data-del="${st.id}" title="Remove MP3">✕</button>` : st.announcement ? '<span class="sub" title="Announcement file referenced by the line">file</span>' : '<span class="sub" title="Speech synthesis">tts</span>'}
          <label class="icon" title="Import MP3 for ${esc(st.name)}">＋<input type="file" accept="audio/mpeg,.mp3" data-up="${st.id}" hidden></label></td></tr>`;
        }).join('')}</tbody></table></div>
      <div class="row-tools">
        <label class="btn small">Import MP3 announcements<input type="file" id="l-mp3" accept="audio/mpeg,.mp3" multiple hidden></label>
        <button class="btn small ghost" id="l-export">Export JSON</button>
        ${l.builtIn ? '' : '<button class="btn small danger" id="l-delete">Delete line</button>'}
        <button class="btn primary" id="l-use">Drive this line ▶</button>
      </div>
      <p class="sub">MP3 files are matched to stations by file name (e.g. <code>${esc(l.stations[1].id)}.mp3</code>, or <code>${esc(l.stations[1].id)}-arrival.mp3</code> for the arrival message).</p>`;
    el.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = () => { this.sel.lineId = b.dataset.svc; this.persist(); this.renderLines(); }));
    el.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => { this.sel.direction = b.dataset.dir; this.persist(); this.renderLineDetail(); }));
    el.querySelector('#l-use').onclick = () => this.play(l);
    el.querySelector('#l-export').onclick = () => this.showJson(`${l.name} — line file`, l.raw.branches || !l.service ? l.raw : l.raw);
    this.confirmButton(el.querySelector('#l-delete'), async () => {
      await this.repo.deleteLine(l.id);
      this.sel.lineId = this.repo.lines[0]?.id; this.persist(); this.screen_lines();
    });
    el.querySelector('#l-mp3').onchange = async (e) => {
      const msgs = [];
      for (const f of e.target.files) {
        const base = slugify(f.name.replace(/\.mp3$/i, ''));
        const m = base.match(/^(.*?)(?:-(arrival|terminus))?$/);
        const st = l.stations.find((s) => s.id === m[1] || slugify(s.name) === m[1]);
        if (!st) { msgs.push(`✗ ${f.name}: no station named “${m[1]}”`); continue; }
        await AssetStore.putAudio(`${l.sourceId}/${st.id}${m[2] ? `:${m[2]}` : ''}`, f);
        msgs.push(`✓ ${f.name} → ${st.name}${m[2] ? ` (${m[2]})` : ''}`);
      }
      this.notice(msgs.join('\n'));
      this.renderLineDetail();
    };
    el.querySelectorAll('[data-up]').forEach((inp) => (inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      await AssetStore.putAudio(`${l.sourceId}/${inp.dataset.up}`, f);
      this.renderLineDetail();
    }));
    el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await AssetStore.deleteAudio(`${l.sourceId}/${b.dataset.del}`); this.renderLineDetail(); }));
    el.querySelectorAll('[data-play]').forEach((b) => (b.onclick = async () => {
      const blob = await AssetStore.getAudio(`${l.sourceId}/${b.dataset.play}`);
      if (!blob) return;
      const a = new Audio(URL.createObjectURL(blob)); a.volume = this.settings.get('audio.master'); a.play();
    }));
  }

  /** Two-step confirmation inside the page (native confirm() dialogs are not available everywhere). */
  confirmButton(btn, action) {
    if (!btn) return;
    const label = btn.textContent;
    btn.onclick = () => {
      if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; action(); return; }
      btn.dataset.armed = '1'; btn.textContent = 'Click again to confirm';
      setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; } }, 4000);
    };
  }

  /** Shows a JSON document with a copy button (file downloads are not available everywhere). */
  showJson(title, obj) {
    const text = JSON.stringify(obj, null, 2);
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="modal-box"><header><h3>${esc(title)}</h3><button class="btn small ghost" data-close>Close</button></header>
      <p class="sub">Copy this into a <code>.json</code> file, edit it, then use “Import line JSON”.</p>
      <textarea id="json-view" readonly spellcheck="false"></textarea>
      <div class="row-tools"><button class="btn small primary" data-copy>Copy to clipboard</button><span class="sub" data-status></span></div></div>`;
    m.querySelector('textarea').value = text;
    m.querySelector('[data-close]').onclick = () => m.remove();
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.querySelector('[data-copy]').onclick = async () => {
      const ta = m.querySelector('textarea'), st = m.querySelector('[data-status]');
      try { await navigator.clipboard.writeText(text); st.textContent = 'Copied.'; }
      catch { ta.focus(); ta.select(); st.textContent = 'Selected — press Ctrl+C / ⌘C to copy.'; }
    };
    this.root.appendChild(m);
  }

  notice(text) {
    const n = document.createElement('div');
    n.className = 'notice'; n.textContent = text;
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 6000);
    n.onclick = () => n.remove();
  }

  // ---------------- Trains ----------------
  screen_trains() {
    const E = this.economy;
    const spec = (t) => `<dl>
          <dt>Formation</dt><dd>${t.cars} cars · ${t.length.toFixed(1)} m · ${t.capacity} passengers</dd>
          <dt>Mass (empty)</dt><dd>${t.massEmpty} t</dd>
          <dt>Power</dt><dd>${t.maxPower} kW · ${t.maxTractiveForce} kN</dd>
          <dt>Max speed</dt><dd>${t.maxSpeed} km/h</dd>
          <dt>Start accel.</dt><dd>${t.maxAccel.toFixed(2)} m/s²</dd>
          <dt>Service / EB</dt><dd>${t.serviceDecel} / ${t.emergencyDecel} m/s²</dd>
          <dt>Controller</dt><dd>P${t.tractionNotches} · B${t.brakeNotches} · EB</dd>
          <dt>Doors</dt><dd>${t.doorsPerSide} per side per car</dd>
          <dt>Maintenance</dt><dd>every ${t.serviceIntervalKm ?? 400} km · ${eur(E.serviceCost({ kind: 'train', model: t.id }))}</dd>
        </dl>`;
    const strip = (t) => `<div class="train-strip" style="background:linear-gradient(90deg, ${t.livery?.body || '#ddd'} 70%, ${t.livery?.front || '#333'})"><i style="background:${t.livery?.stripe || '#ffcc00'}"></i></div>`;
    const mine = E.owned('train').filter((v) => this.repo.train(v.model));
    const body = this.frame(`Trains <span class="balance-chip">💶 ${eur(E.balance)}</span>`, `
      <h3>Your trains</h3>
      <div class="train-grid">${mine.map((v) => { const t = this.repo.train(v.model); return `
        <div class="train-card ${v.uid === this.sel.trainUid ? 'sel' : ''}">${strip(t)}
          <h3>${esc(v.uid)} <span class="sub">${esc(t.name)}</span></h3>
          <div class="gauge"><i style="width:${Math.round(v.condition * 100)}%"></i></div>
          <p class="sub">Condition ${Math.round(v.condition * 100)} % · ${Math.round(v.odometer)} km · ${E.serviceDue(v) ? '<b class="warn">maintenance due</b>' : `service in ${Math.max(0, Math.round(E.serviceInterval(v) - v.sinceService))} km`}${v.condition < 0.6 ? ' · <b class="warn">reduced performance</b>' : ''}</p>
          <div class="row-tools">${v.uid === this.sel.trainUid ? '<span class="tag">selected</span>' : `<button class="btn small primary" data-pick="${v.uid}">Use this train</button>`}<button class="btn small" data-nav="depot">Depot…</button></div>
        </div>`; }).join('')}</div>
      <h3>Buy trains</h3>
      <div class="train-grid">${this.repo.trains.map((t) => { const price = E.priceOf('train', t.id), afford = price <= E.balance; return `
        <div class="train-card">${strip(t)}
          <h3>${esc(t.name)} <span class="price">${eur(price)}</span></h3><p class="sub">${esc(t.description || '')}</p>${spec(t)}
          <div class="row-tools"><button class="btn small ${afford ? 'primary' : ''}" data-buy="${t.id}" ${afford ? '' : 'disabled'}>${afford ? 'Buy' : `Need ${eur(price - E.balance)} more`}</button>
          <span class="sub">${E.owned('train').filter((v) => v.model === t.id).length} owned</span></div>
        </div>`; }).join('')}</div>`, { wide: true });
    body.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { this.selectVehicle(b.dataset.pick); this.screen_trains(); }));
    body.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
      const r = E.buy('train', b.dataset.buy);
      if (!r.ok) { this.notice(r.reason); return; }
      this.audio.started && this.audio.click();
      this.selectVehicle(r.vehicle.uid);
      this.notice(`${r.vehicle.uid} delivered to the depot. Balance ${eur(E.balance)}.`);
      this.screen_trains();
    }));
  }

  // ---------------- Depot & fleet ----------------
  screen_depot() {
    const E = this.economy, buses = this.busRepo?.vehicles || [];
    const name = (v) => (v.kind === 'train' ? this.repo.train(v.model)?.name : buses.find((b) => b.id === v.model)?.name) || v.model;
    const row = (v) => {
      const rc = E.repairCost(v), sc = E.serviceCost(v), due = E.serviceDue(v);
      const dmg = v.damage ? Object.entries(v.damage.zones || {}).filter(([, x]) => x > 0.05).map(([k]) => k).join(', ') : '';
      return `<tr><td>${v.kind === 'bus' ? '🚌' : '🚇'} <b>${esc(v.uid)}</b><br><span class="sub">${esc(name(v))}</span></td>
        <td><div class="gauge"><i style="width:${Math.round(v.condition * 100)}%"></i></div>${Math.round(v.condition * 100)} %${dmg ? `<br><span class="sub warn">body damage: ${esc(dmg)}</span>` : ''}</td>
        <td>${Math.round(v.odometer)} km<br><span class="sub">${due ? '<b class="warn">maintenance due</b>' : `next service in ${Math.max(0, Math.round(E.serviceInterval(v) - v.sinceService))} km`}</span></td>
        <td class="actions"><button class="btn small" data-svc="${v.uid}">Service ${eur(sc)}</button>
          <button class="btn small ${rc > 0 ? 'primary' : ''}" data-rep="${v.uid}" ${rc > 0 ? '' : 'disabled'}>Repair ${eur(rc)}</button>
          <button class="btn small danger" data-sell="${v.uid}">Sell ${eur(E.sellValue(v))}</button></td></tr>`;
    };
    const body = this.frame(`Depot & fleet <span class="balance-chip">💶 ${eur(E.balance)}</span>`, `
      <div class="bus-layout"><div>
        <h3>Fleet (${E.fleet.length})</h3>
        <table class="stations fleet"><thead><tr><th>Vehicle</th><th>Condition</th><th>Odometer</th><th></th></tr></thead><tbody>${E.fleet.map(row).join('')}</tbody></table>
        <p class="sub">Condition falls with distance (faster when maintenance is overdue) and with incidents. Below 60 % a vehicle loses performance. Repairs restore it to 100 %; servicing resets the maintenance interval.</p>
        <h3>Buy buses</h3>
        <table class="stations"><tbody>${buses.map((b) => { const p = E.priceOf('bus', b.id), ok = p <= E.balance; return `<tr><td><b>${esc(b.name)}</b><br><span class="sub">${b.capacity} pax · ${b.power} kW ${b.powertrain}</span></td><td>${eur(p)}</td><td><button class="btn small ${ok ? 'primary' : ''}" data-buybus="${b.id}" ${ok ? '' : 'disabled'}>${ok ? 'Buy' : 'Not enough money'}</button></td></tr>`; }).join('')}</tbody></table>
        <p class="sub">Trains are bought in <a href="#" data-nav="trains">Trains & purchases</a>.</p>
      </div><div>
        <h3>Account</h3>
        <p>Balance <b>${eur(E.balance)}</b> · earned ${eur(E.d.earned)} · spent ${eur(E.d.spent)}</p>
        <table class="stations"><thead><tr><th>Operation</th><th>Amount</th></tr></thead><tbody>
        ${E.ledger.map((l) => `<tr><td>${esc(l.text)}<br><span class="sub">${new Date(l.t).toLocaleString()}</span></td><td class="${l.amount < 0 ? 'neg' : 'pos'}">${eur(l.amount)}</td></tr>`).join('') || '<tr><td colspan="2">No operations yet.</td></tr>'}</tbody></table>
      </div></div>`, { wide: true });
    const act = (fn) => (b) => (b.onclick = () => { const r = fn(b); if (r && !r.ok) this.notice(r.reason); else this.screen_depot(); });
    body.querySelectorAll('[data-svc]').forEach(act((b) => E.service(b.dataset.svc)));
    body.querySelectorAll('[data-rep]').forEach(act((b) => E.repair(b.dataset.rep)));
    body.querySelectorAll('[data-sell]').forEach((b) => this.confirmButton(b, () => { const r = E.sell(b.dataset.sell); if (!r.ok) this.notice(r.reason); else { this.ensureOwnedTrain(); this.persist(); this.screen_depot(); } }));
    body.querySelectorAll('[data-buybus]').forEach(act((b) => E.buy('bus', b.dataset.buybus)));
  }
  // ---------------- Settings ----------------
  screen_settings() {
    const s = this.settings;
    const fmts = {};
    const range = (path, label, min, max, step, fmt = (v) => v) => (fmts[path] = fmt) && `<label class="field"><span>${label}</span><input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${s.get(path)}"><output>${fmt(s.get(path))}</output></label>`;
    const check = (path, label, hint = '') => `<label class="field check"><input type="checkbox" data-path="${path}" ${s.get(path) ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    const body = this.frame('Settings', `<div class="settings-grid">
      <section><h3>Audio</h3>
        ${range('audio.master', 'Master volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        ${range('audio.effects', 'Train sounds', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        ${range('audio.ambient', 'Ambience', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        ${range('audio.announcements', 'Announcements', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
        ${check('audio.voiceFallback', 'Speech synthesis when no MP3 is available')}
      </section>
      <section><h3>Graphics</h3>
        <label class="field"><span>Quality</span><select data-path="graphics.quality">${['low', 'medium', 'high'].map((q) => `<option ${s.get('graphics.quality') === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        ${range('graphics.fov', 'Field of view', 50, 100, 1, (v) => `${v}°`)}
        ${range('graphics.drawDistance', 'Draw distance', 200, 900, 50, (v) => `${v} m`)}
        ${range('graphics.cameraShake', 'Cab vibration', 0, 2, 0.1, (v) => `${Math.round(v * 100)}%`)}
      </section>
      <section><h3>Driving</h3>
        ${check('gameplay.atp', 'Automatic train protection (ATP)', 'Emergency brake on overspeed and before red signals. CBTC lines always supervise.')}
        ${check('gameplay.vigilance', 'Vigilance device (dead-man)', 'Acknowledge every 25 s while moving.')}
        ${range('gameplay.stopTolerance', 'Precise-stop tolerance', 0.5, 5, 0.25, (v) => `±${v} m`)}
        ${check('gameplay.showHud', 'Show HUD')}
      </section>
      <section><h3>Mouse</h3>
        ${range('gameplay.mouseSensitivity', 'Look sensitivity', 0.2, 3, 0.1, (v) => `${Number(v).toFixed(1)}×`)}
        ${check('gameplay.invertY', 'Invert vertical look')}
        <button class="btn small danger" id="s-reset">Reset all settings</button>
        <button class="btn small danger" id="s-wipe">Reset career records</button>
      </section></div>`, { wide: true });
    body.querySelectorAll('[data-path]').forEach((inp) => {
      const apply = () => {
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value;
        s.set(inp.dataset.path, v);
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = fmts[inp.dataset.path](v);
      };
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', apply);
    });
    body.querySelector('#s-reset').onclick = () => { s.reset(); this.input.loadBindings(); this.screen_settings(); };
    this.confirmButton(body.querySelector('#s-wipe'), () => { this.save.resetAll(); this.notice('Career data cleared.'); });
  }

  // ---------------- Controls ----------------
  screen_controls(tab = this.controlsTab || 'metro') {
    this.controlsTab = tab;
    const bus = tab === 'bus' && this.busInput;
    const I = bus ? this.busInput : this.input;
    const table = bus ? BUS_ACTIONS : ACTIONS;
    const padCell = (a, def) => (bus ? (def.pad || []).map((b) => PAD_LABELS[b]).join(' / ') || '—'
      : `${(def.pad || []).map((b) => PAD_LABELS[b]).join(' / ') || '—'}${a === 'tractionUp' ? ' / D-pad ↑' : a === 'tractionDown' ? ' / D-pad ↓' : ''}`);
    const body = this.frame('Controls', `
      <div class="dir-toggle"><button class="btn small ${bus ? '' : 'primary'}" data-tab="metro">🚇 Metro</button>${this.busInput ? `<button class="btn small ${bus ? 'primary' : ''}" data-tab="bus">🚌 Bus</button>` : ''}</div>
      <p class="sub">Click a key to rebind it, then press the new key (Esc cancels). Keys follow your keyboard layout. Metro and bus bindings are separate.</p>
      <table class="controls"><thead><tr><th>Action</th><th>Primary</th><th>Secondary</th><th>Gamepad</th></tr></thead><tbody>
      ${Object.entries(table).map(([a, def]) => `<tr><td>${esc(def.label)}</td>
        ${[0, 1].map((slot) => `<td><button class="key" data-a="${a}" data-slot="${slot}">${esc(I.keyLabel(I.bindings[a][slot]))}</button></td>`).join('')}
        <td class="sub">${padCell(a, def)}</td></tr>`).join('')}
      </tbody></table>
      <p class="sub">${bus ? 'Mouse in the bus cab: click any switch, drag the steering wheel, click the indicator stalk, hold the wheel hub for the horn; hold the right button to look around. Gamepad: RT/LT analog accelerator & brake, left stick steering.'
        : 'Mouse: left-click cab buttons, drag or scroll on the master controller; hold right button to look around; scroll to zoom. Gamepad right stick looks around.'}</p>
      <button class="btn small danger" id="c-reset">Restore defaults</button>`);
    body.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => this.screen_controls(b.dataset.tab)));
    body.querySelectorAll('.key').forEach((b) => (b.onclick = () => {
      b.textContent = '…press a key'; b.classList.add('listening');
      I.rebind(b.dataset.a, Number(b.dataset.slot), () => this.screen_controls(tab));
    }));
    body.querySelector('#c-reset').onclick = () => { I.resetBindings(); this.screen_controls(tab); };
  }

  screen_credits() {
    this.frame('Credits', `<div class="credits">
      <p><b>Metro Driver</b> — an underground railway driving simulator.</p>
      <p>Design & code: built with <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> and the Web Audio API. All textures, sounds and models are generated procedurally at runtime.</p>
      <p>Stations, adverts and brands shown in built-in lines are fictional or used purely as geographic references; built-in line data is illustrative and not an official operator timetable.</p>
      <p>Add your own networks with JSON line files — see <code>docs/LINE_FORMAT.md</code>.</p></div>`);
  }

  // ---------------- In-game overlays ----------------
  screen_pause() {
    this.context = 'pause';
    this.root.innerHTML = `<div class="menu-pause"><h2>Paused</h2>
      <button class="btn primary" id="p-resume">Resume</button>
      <button class="btn" id="p-restart">Restart run</button>
      <button class="btn" data-nav="settings">Settings</button>
      <button class="btn" data-nav="controls">Controls</button>
      <button class="btn ghost" id="p-quit">Quit to main menu</button></div>`;
    this.root.querySelector('#p-resume').onclick = () => this.emit('resume');
    this.root.querySelector('#p-restart').onclick = () => this.emit('restart');
    this.root.querySelector('#p-quit').onclick = () => this.emit('quit');
  }

  showLoading(text) {
    this.root.style.display = '';
    this.root.innerHTML = `<div class="menu-loading"><div class="spinner"></div><p>${esc(text)}</p></div>`;
  }

  showSummary(r, newBest) {
    this.context = 'main';
    this.root.style.display = '';
    const other = r.line.loop ? 'A' : r.direction === 'A' ? 'B' : 'A';
    this.root.innerHTML = `<div class="menu-screen summary"><header><h2>${r.completed ? 'Run complete' : 'Run aborted'}</h2></header>
      <div class="menu-body">
        <div class="grade grade-${r.grade}">${r.grade}</div>
        <div class="score">${r.score} <small>/ 1000</small>${newBest ? ' <span class="tag">new record</span>' : ''}</div>
        ${r.reason ? `<p class="errors">${esc(r.reason)}</p>` : ''}
        <p class="sub">${esc(r.line.fullName)} · ${esc(r.line.directions[r.direction].name)} · ${esc(r.train.name)} · ${r.distanceKm.toFixed(2)} km in ${Math.floor(r.seconds / 60)} min ${Math.round(r.seconds % 60)} s · final delay ${formatDelta(r.finalDelay)}</p>
        <div class="table-wrap"><table class="stations"><thead><tr><th>Station</th><th>Stop error</th><th>Delay</th><th>Accuracy</th><th>Punctuality</th></tr></thead>
        <tbody>${r.stops.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.error >= 0 ? '+' : ''}${s.error.toFixed(2)} m</td><td>${formatDelta(s.delay)}</td><td>${s.acc}</td><td>${s.punct}</td></tr>`).join('') || '<tr><td colspan="5">No stops served</td></tr>'}</tbody></table></div>
        ${r.penalties.length ? `<h3>Penalties (−${r.penaltyTotal})</h3><ul class="penalties">${r.penalties.map((p) => `<li>${esc(p.text)}${p.count > 1 ? ` ×${p.count}` : ''} <b>−${p.points}</b></li>`).join('')}</ul>` : '<p>No penalties — exemplary driving.</p>'}
        ${earningsTable(r.settlement, r.vehicleAfter)}
        <div class="row-tools">
          <button class="btn primary" id="r-back">${r.line.loop ? 'Next circuit' : `Drive back (${esc(r.line.directions[other].name)})`}</button>
          <button class="btn" id="r-again">Retry</button>
          <button class="btn ghost" data-nav="main">Main menu</button>
        </div></div></div>`;
    this.root.querySelector('#r-back').onclick = () => { this.sel.direction = other; this.persist(); this.emit('play', { line: r.line, train: r.train, direction: other, vehicleUid: r.vehicleUid }); };
    this.root.querySelector('#r-again').onclick = () => this.emit('play', { line: r.line, train: r.train, direction: r.direction, vehicleUid: r.vehicleUid });
  }
}
