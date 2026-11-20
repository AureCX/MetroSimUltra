// Bus section of the menu: game modes, route selection with a printed-style route strip,
// vehicle selection (career unlocks, depot status), time / day / weather, depot & departures,
// career progress, custom route builder / import / export, MP3 announcements, bus controls.
import { earningsTable } from './Menu.js';
import { eur } from '../economy/Economy.js';
import { escapeXml as esc } from './NetworkMap.js';
import { BUS_ACTIONS } from '../bus/BusControls.js';
import { CAREER, RouteError } from '../bus/BusRepository.js';
import { AssetStore } from '../core/AssetStore.js';
import { formatClock, slugify } from '../core/util.js';
import { WEATHERS } from '../bus/Weather.js';

const NAVY = '#1f3c88';
const METRO = { A: ['#8B1E8F', '#fff'], B: ['#33E633', '#111'], C: ['#00DDF5', '#16233a'], D: ['#FF8000', '#16233a'] };
const MODES = [
  ['career', 'Career', 'Work shifts from the depot, earn experience, unlock routes and vehicles.'],
  ['timetable', 'Timetable', 'Any route with its schedule: deadhead, every stop on time, return to the depot.'],
  ['aeroval', 'Aéroval Airport', 'Dedicated airport shuttle routes around Grandville International.'],
  ['free', 'Free Roam', 'Drive anywhere around the airport district, no schedule.'],
  ['custom', 'Custom Route', 'Build your own route from the network stops, or import a JSON route.'],
];
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Draws a route strip in the style of the network's printed line plans. */
export function drawRouteStrip(cv, route, net) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = NAVY; g.fillRect(16, 0, W * 0.27, 18);
  const aero = route.operator === 'aeroval';
  g.fillStyle = NAVY; g.fillRect(16, 30, 120, 6); g.fillRect(16, 130, 120, 6);
  g.font = 'bold 56px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', 76, 86);
  g.fillStyle = route.color; const bx = 156, bw = aero ? 230 : 120;
  g.beginPath(); g.roundRect(bx, 34, bw, 100, 18); g.fill();
  g.fillStyle = route.textColor; g.font = `bold ${aero ? 52 : 60}px Arial`; g.fillText(aero ? 'AÉROVAL' : route.route, bx + bw / 2, 86);
  if (aero) { g.fillStyle = NAVY; g.font = 'bold 26px Arial'; g.fillText(route.route, bx + bw / 2, 150); }
  const stops = route.stops, n = stops.length;
  const x0 = 470, x1 = W - 200, y = H * 0.7;
  const dx = (x1 - x0) / Math.max(1, n - 1);
  g.strokeStyle = route.color; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  stops.forEach((s, i) => {
    const x = x0 + i * dx, term = i === 0 || i === n - 1;
    const st = net.stops.find((z) => z.name === s.name) || {};
    const metro = st.metro || [];
    if (term || metro.length) { g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = route.color; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
    else { g.fillStyle = route.color; g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill(); }
    g.save(); g.translate(x - 6, y - 30); g.rotate(-0.42);
    g.font = 'bold 22px "Segoe UI", Arial'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const name = s.name;
    if (term) { const w = g.measureText(name).width; g.fillStyle = NAVY; g.fillRect(-8, -30, w + 16, 40); g.fillStyle = '#fff'; } else g.fillStyle = NAVY;
    g.fillText(name, 0, 0); g.restore();
    if (metro.length) {
      let by = y + 52;
      g.strokeStyle = NAVY; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 18); g.lineTo(x, by - 16); g.stroke();
      let bxx = x;
      g.fillStyle = '#fff'; g.strokeStyle = NAVY; g.beginPath(); g.arc(bxx, by, 16, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = NAVY; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', bxx, by + 1);
      for (const l of metro) { bxx += 36; const [c, t] = METRO[l] || ['#888', '#fff']; g.fillStyle = c; g.beginPath(); g.arc(bxx, by, 16, 0, Math.PI * 2); g.fill(); g.fillStyle = t; g.fillText(l, bxx, by + 1); }
    }
  });
  g.fillStyle = NAVY; g.font = '14px Arial'; g.textAlign = 'left'; g.fillText(`Grandville Transports · ${route.name}`, 16, H - 12);
}

export class BusMenu {
  constructor(menu, repo, save, input, settings) {
    this.menu = menu; this.repo = repo; this.save = save; this.input = input; this.settings = settings;
    const s = save.data.bus ||= {};
    s.career ||= { xp: 0, shifts: 0, aeroval: false, carried: 0, km: 0 };
    this.sel = { mode: 'career', routeId: repo.routes[0]?.id, dir: 'A', vehicle: 'urbano12', hour: 8, day: 2, weather: 'clear', dynamic: false, ...(s.sel || {}) };
    const eco = menu.economy;
    if (eco && !eco.vehicle(this.sel.busUid)) { const first = eco.owned('bus')[0]; if (first) { this.sel.busUid = first.uid; this.sel.vehicle = first.model; } }
  }
  get career() { return this.save.data.bus.career; }
  get economy() { return this.menu.economy; }
  /** Owned buses (economy fleet) with their specifications. */
  ownedBuses() { return (this.economy?.owned('bus') || []).map((v) => ({ v, spec: this.repo.vehicle(v.model) })).filter((x) => x.spec); }
  persist() { this.save.data.bus.sel = this.sel; this.save.save(); }
  root() { return this.menu.root; }
  frame(title, body) { this.menu.context = 'main'; return this.menu.frame(title, body, { wide: true }); }

  unlockedVehicle(v) { return this.sel.mode !== 'career' || (CAREER.level(this.career.xp) >= (CAREER.vehicleLevel[v.id] ?? 1) && (v.id !== 'aeroshuttle' || this.career.aeroval || CAREER.level(this.career.xp) >= 2)); }
  unlockedRoute(r) { return this.sel.mode !== 'career' || CAREER.level(this.career.xp) >= CAREER.routeLevel(r); }
  routesForMode() {
    const all = this.repo.routes;
    if (this.sel.mode === 'aeroval') return all.filter((r) => r.operator === 'aeroval');
    if (this.sel.mode === 'custom') return all.filter((r) => !r.builtIn);
    return all;
  }

  show() {
    const lvl = CAREER.level(this.career.xp);
    const body = this.frame('Bus — Grandville & Aéroval', `
      <div class="mode-grid">${MODES.map(([id, t, d]) => `<button class="mode-card ${id === this.sel.mode ? 'sel' : ''} ${id === 'aeroval' ? 'aeroval' : ''}" data-mode="${id}"><h3>${t}</h3><p>${d}</p></button>`).join('')}</div>
      <div class="row-tools"><span class="sub">Career level ${lvl} · ${this.career.xp} XP · ${this.career.shifts} shift(s) · ${this.career.carried} passengers · ${this.career.km.toFixed(1)} km</span>
        <button class="btn small" id="bm-depot">Depot & fleet</button><button class="btn small" id="bm-custom">Custom routes</button><button class="btn small" id="bm-controls">Bus controls</button></div>
      <div id="bm-setup"></div>`);
    body.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { this.sel.mode = b.dataset.mode; const list = this.routesForMode(); if (!list.find((r) => r.id === this.sel.routeId)) this.sel.routeId = list[0]?.id; if (this.sel.mode === 'aeroval') { const a = this.economy?.owned('bus').find((v) => v.model === 'aeroshuttle'); if (a) { this.sel.busUid = a.uid; this.sel.vehicle = a.model; } } this.persist(); this.show(); }));
    body.querySelector('#bm-depot').onclick = () => this.depot();
    body.querySelector('#bm-custom').onclick = () => this.custom();
    body.querySelector('#bm-controls').onclick = () => this.controls();
    this.setup(body.querySelector('#bm-setup'));
  }

  setup(el) {
    const free = this.sel.mode === 'free';
    const routes = this.routesForMode();
    const r = this.repo.route(this.sel.routeId);
    const net = this.repo.network(r?.network);
    const fleet = this.save.data.bus.fleet || {};
    el.innerHTML = `<div class="bus-layout">
      <div>${free ? '<p class="sub">Free roam: no route — start in the depot and explore the district, the airport roads and the motorway.</p>' : `
        <h3>Route</h3>${routes.length ? '' : '<p class="sub">No route for this mode yet. Use “Custom routes” to create one.</p>'}
        <div class="route-list">${routes.map((x) => `<button class="line-item ${x.id === this.sel.routeId ? 'sel' : ''} ${this.unlockedRoute(x) ? '' : 'locked'}" data-route="${x.id}"><span class="route-badge" style="background:${x.color};color:${x.textColor}">${esc(x.route)}</span><span><b>${esc(x.name)}</b><br><span class="sub">${esc(x.stops[0].name)} ↔ ${esc(x.stops.at(-1).name)} · ${x.stops.length} stops</span></span>${x.operator === 'aeroval' ? '<span class="tag">Aéroval</span>' : ''}${this.unlockedRoute(x) ? '' : '<span class="tag">level 2</span>'}</button>`).join('')}</div>
        ${r ? `<div class="dir-toggle"><button class="btn small ${this.sel.dir === 'A' ? 'primary' : ''}" data-dir="A">→ ${esc(r.stops.at(-1).name)}</button><button class="btn small ${this.sel.dir === 'B' ? 'primary' : ''}" data-dir="B">→ ${esc(r.stops[0].name)}</button></div>
        <canvas class="strip-map" id="bm-strip" width="1600" height="420"></canvas>` : ''}`}
      </div>
      <div><h3>Vehicle <span class="balance-chip">💶 ${eur(this.economy.balance)}</span></h3><div class="route-list">${this.ownedBuses().map(({ v: o, spec: v }) => { const ok = this.unlockedVehicle(v); const max = v.powertrain === 'electric' ? v.battery : v.fuelCapacity; const en = o.energy != null ? o.energy / max : 0.9; const dmg = o.damage && Object.values(o.damage.zones || {}).some((x) => x > 0.05); return `<button class="line-item ${o.uid === this.sel.busUid ? 'sel' : ''} ${ok ? '' : 'locked'}" data-veh="${o.uid}" ${ok ? '' : 'disabled'}>
          <span style="width:36px;height:20px;border-radius:4px;background:${v.livery.body};border-bottom:5px solid ${v.livery.stripe}"></span>
          <span><b>${esc(o.uid)}</b> · ${esc(v.name)} <span class="sub">${v.length + (v.trailerLength || 0) > 13 ? `${(v.length + v.trailerLength - 1.5).toFixed(0)} m` : `${v.length} m`} · ${v.capacity} pax · ${v.power} kW ${v.powertrain}</span><br>
          <div class="gauge"><i style="width:${Math.round(o.condition * 100)}%"></i></div><span class="sub">condition ${Math.round(o.condition * 100)} % · ${v.powertrain === 'electric' ? 'battery' : 'fuel'} ${Math.round(en * 100)} % · ${Math.round(o.odometer)} km${this.economy.serviceDue(o) ? ' · <b class="warn">maintenance due</b>' : ''}${dmg ? ' · <b class="warn">body damage</b>' : ''}</span></span>
          ${ok ? '' : `<span class="tag">level ${CAREER.vehicleLevel[v.id]}</span>`}</button>`; }).join('')}</div>
        <p class="sub">Buy more buses and repair them in <a href="#" data-nav="depot">Depot & fleet</a>.</p>
        <h3>Conditions</h3>
        <div class="cond-row"><label>Start <input type="range" id="bm-hour" min="0" max="23.5" step="0.5" value="${this.sel.hour}"><output>${formatClock(this.sel.hour * 3600, false)}</output></label>
          <label>Day <select id="bm-day">${DAYS.slice(1).map((d, i) => `<option value="${i + 1}" ${i + 1 === this.sel.day ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div>
        <div class="cond-row"><label>Weather <select id="bm-weather">${Object.entries(WEATHERS).map(([k, w]) => `<option value="${k}" ${k === this.sel.weather ? 'selected' : ''}>${w.label}</option>`).join('')}</select></label>
          <label><input type="checkbox" id="bm-dyn" ${this.sel.dynamic ? 'checked' : ''}> changing weather</label></div>
        <div class="row-tools"><button class="btn primary" id="bm-start">Start shift from the depot ▶</button>${!free && r ? '<label class="btn small">Import MP3 announcements<input type="file" id="bm-mp3" accept="audio/mpeg,.mp3" multiple hidden></label>' : ''}</div>
        ${!free && r ? `<p class="sub">MP3 names: <code>&lt;stop-id&gt;.mp3</code> (next-stop, inside) or <code>&lt;stop-id&gt;-outside.mp3</code> (line & destination, outside). Stop ids: ${net.stops.filter((s) => r.stops.some((x) => x.name === s.name)).map((s) => `<code>${s.id}</code>`).join(' ')}</p>` : ''}
      </div></div>`;
    el.querySelectorAll('[data-route]').forEach((b) => (b.onclick = () => { if (!this.unlockedRoute(this.repo.route(b.dataset.route))) return; this.sel.routeId = b.dataset.route; this.persist(); this.setup(el); }));
    el.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => { this.sel.dir = b.dataset.dir; this.persist(); this.setup(el); }));
    el.querySelectorAll('[data-veh]').forEach((b) => (b.onclick = () => { this.sel.busUid = b.dataset.veh; this.sel.vehicle = this.economy.vehicle(b.dataset.veh)?.model || this.sel.vehicle; this.persist(); this.setup(el); }));
    const hr = el.querySelector('#bm-hour'); hr.oninput = () => { this.sel.hour = Number(hr.value); hr.nextElementSibling.textContent = formatClock(this.sel.hour * 3600, false); this.persist(); };
    el.querySelector('#bm-day').onchange = (e) => { this.sel.day = Number(e.target.value); this.persist(); };
    el.querySelector('#bm-weather').onchange = (e) => { this.sel.weather = e.target.value; this.persist(); };
    el.querySelector('#bm-dyn').onchange = (e) => { this.sel.dynamic = e.target.checked; this.persist(); };
    const strip = el.querySelector('#bm-strip');
    if (strip && r) drawRouteStrip(strip, this.sel.dir === 'B' ? { ...r, stops: [...r.stops].reverse() } : r, net);
    el.querySelector('#bm-mp3')?.addEventListener('change', async (e) => {
      const msgs = [];
      for (const f of e.target.files) {
        const base = slugify(f.name.replace(/\.mp3$/i, '')), outside = base.endsWith('-outside'), id = base.replace(/-outside$/, '');
        const st = net.stops.find((s) => s.id === id || slugify(s.name) === id);
        if (!st) { msgs.push(`✗ ${f.name}: no stop "${id}"`); continue; }
        await AssetStore.putAudio(`bus-${r.route}/${st.id}${outside ? ':outside' : ''}`, f);
        msgs.push(`✓ ${f.name} → ${st.name}${outside ? ' (outside)' : ''}`);
      }
      this.menu.notice(msgs.join('\n'));
    });
    el.querySelector('#bm-start').onclick = () => {
      const own = this.economy.vehicle(this.sel.busUid);
      if (!own) { this.menu.notice('Choose one of your buses (or buy one in Depot & fleet).'); return; }
      const veh = this.repo.vehicle(own.model);
      if (!this.unlockedVehicle(veh)) { this.menu.notice('This bus is not unlocked in career mode yet.'); return; }
      if (!free && !r) { this.menu.notice('Choose a route first.'); return; }
      this.menu.emit('busPlay', { mode: this.sel.mode, route: free ? null : r, dir: this.sel.dir, spec: veh, vehicleUid: own.uid, netData: this.repo.network(r?.network), hour: this.sel.hour, day: this.sel.day, weather: this.sel.weather, dynamicWeather: this.sel.dynamic });
    };
  }

  depot() {
    this.menu.show('depot');
  }

  depotTimetable() {
    const fleet = this.save.data.bus.fleet || {};
    const now = 6 * 3600;
    const deps = [];
    for (const r of this.repo.routes) for (let t = now; t < now + 3 * 3600; t += r.headway) deps.push({ t, r });
    deps.sort((a, b) => a.t - b.t);
    const body = this.frame('Depot — Grandville Est', `
      <div class="bus-layout"><div><h3>Fleet</h3><table class="stations"><thead><tr><th>Vehicle</th><th>Condition</th><th>Clean</th><th>Energy</th></tr></thead><tbody>
        ${this.repo.vehicles.map((v) => { const f = fleet[v.id] || {}; const max = v.powertrain === 'electric' ? v.battery : v.fuelCapacity; return `<tr><td>${esc(v.name)}</td><td>${Math.round((f.condition ?? 1) * 100)} %</td><td>${Math.round((f.cleanliness ?? 1) * 100)} %</td><td>${Math.round(((f.energy ?? max * 0.9) / max) * 100)} % ${v.powertrain === 'electric' ? '🔋' : '⛽'}</td></tr>`; }).join('')}</tbody></table>
        <p class="sub">Service a bus by parking it in the depot bay with the parking brake on: <b>fuel pumps</b>, <b>chargers</b> (electric, engine off), <b>wash bay</b> and <b>maintenance hall</b>. Condition drops with distance and collisions.</p></div>
      <div><h3>Departures</h3><table class="stations"><thead><tr><th>Time</th><th>Route</th><th>Destination</th></tr></thead><tbody>
        ${deps.slice(0, 14).map((d) => `<tr><td>${formatClock(d.t, false)}</td><td><span class="route-badge" style="background:${d.r.color};color:${d.r.textColor}">${esc(d.r.route)}</span></td><td>${esc(d.r.stops.at(-1).name)}</td></tr>`).join('')}</tbody></table></div></div>`);
    void body;
  }

  custom() {
    const net = this.repo.networks[0];
    const mine = this.repo.routes.filter((r) => !r.builtIn);
    const chosen = [];
    const body = this.frame('Custom bus routes', `
      <div class="bus-layout"><div>
        <h3>Create a route</h3>
        <div class="cond-row"><label>Number <input type="text" id="cr-num" value="X${mine.length + 1}" size="6"></label><label>Name <input type="text" id="cr-name" value="Ma ligne" size="22"></label><label>Colour <input type="color" id="cr-col" value="#2a7bff"></label><label><input type="checkbox" id="cr-aero"> Aéroval</label></div>
        <p class="sub">Tick stops in the order the bus serves them (at least 2):</p>
        <div class="builder-stops">${net.stops.map((s) => `<label><input type="checkbox" data-stop="${esc(s.name)}"> ${esc(s.name)}</label>`).join('')}</div>
        <div class="chosen" id="cr-order"></div>
        <div class="row-tools"><button class="btn primary" id="cr-save">Save route</button><label class="btn small">Import route JSON<input type="file" id="cr-import" accept=".json,application/json" hidden></label><button class="btn small ghost" id="cr-example">Example file</button></div>
      </div><div><h3>Your routes</h3><div class="route-list">${mine.map((r) => `<div class="line-item"><span class="route-badge" style="background:${r.color};color:${r.textColor}">${esc(r.route)}</span><span><b>${esc(r.name)}</b><br><span class="sub">${r.stops.map((s) => esc(s.name)).join(' → ')}</span></span><button class="btn small ghost" data-exp="${r.id}">JSON</button><button class="btn small danger" data-del="${r.id}">Delete</button></div>`).join('') || '<p class="sub">None yet.</p>'}</div>
        <p class="sub">Drive them from <b>Bus → Custom Route</b>.</p></div></div>`);
    const order = body.querySelector('#cr-order');
    body.querySelectorAll('[data-stop]').forEach((c) => (c.onchange = () => { const n = c.dataset.stop; if (c.checked) chosen.push(n); else chosen.splice(chosen.indexOf(n), 1); order.textContent = chosen.map((x, i) => `${i + 1}. ${x}`).join('  →  '); }));
    const rawOf = () => ({ route: body.querySelector('#cr-num').value.trim(), name: body.querySelector('#cr-name').value.trim(), color: body.querySelector('#cr-col').value, network: net.id, operator: body.querySelector('#cr-aero').checked ? 'aeroval' : 'grandville', stops: chosen.map((n) => ({ name: n, dwellTime: 20 })) });
    body.querySelector('#cr-save').onclick = async () => { try { const r = await this.repo.saveRoute(rawOf()); this.sel.routeId = r.id; this.sel.mode = 'custom'; this.persist(); this.menu.notice(`✓ Route ${r.route} saved`); this.custom(); } catch (e) { this.menu.notice(e instanceof RouteError ? e.message : `Could not build that route: ${e.message}`); } };
    body.querySelector('#cr-import').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const r = await this.repo.saveRoute(JSON.parse(await f.text())); this.menu.notice(`✓ ${r.route} imported`); this.custom(); } catch (err) { this.menu.notice(`✗ ${err.message}`); } };
    body.querySelector('#cr-example').onclick = () => this.menu.showJson('Example bus route', { route: 'B12', name: 'Airport Express', color: '#E6B800', network: net.id, stops: [{ name: 'Aéroport International – Terminal 1 (Est)', dwellTime: 30 }, { name: 'Aéroport International – Terminal 2 (Ouest)', dwellTime: 25 }, { name: "Quartier d'Affaires de l'Aéroport", dwellTime: 20 }] });
    body.querySelectorAll('[data-exp]').forEach((b) => (b.onclick = () => this.menu.showJson('Route file', this.repo.route(b.dataset.exp).raw)));
    body.querySelectorAll('[data-del]').forEach((b) => this.menu.confirmButton(b, async () => { await this.repo.deleteRoute(b.dataset.del); this.custom(); }));
  }

  controls() {
    const I = this.input;
    const body = this.frame('Bus controls', `<p class="sub">Click a key to rebind it. Gamepad: RT/LT analog accelerator & brake, left stick steering.</p>
      <table class="controls"><thead><tr><th>Action</th><th>Primary</th><th>Secondary</th></tr></thead><tbody>
      ${Object.entries(BUS_ACTIONS).map(([a, d]) => `<tr><td>${esc(d.label)}</td>${[0, 1].map((s) => `<td><button class="key" data-a="${a}" data-slot="${s}">${esc(I.keyLabel(I.bindings[a][s]))}</button></td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="sub">Mouse in the cab: click any button, drag the steering wheel, click the indicator stalk, hold the wheel hub for the horn; hold the right button to look around.</p>
      <button class="btn small danger" id="bc-reset">Restore defaults</button>`);
    body.querySelectorAll('.key').forEach((b) => (b.onclick = () => { b.textContent = '…press a key'; I.rebind(b.dataset.a, Number(b.dataset.slot), () => this.controls()); }));
    body.querySelector('#bc-reset').onclick = () => { I.resetBindings(); this.controls(); };
  }

  summary(r) {
    if (r.vehicleUid && this.economy?.vehicle(r.vehicleUid)) {
      r.settlement = this.economy.settleBus({ ...r, label: `${r.route?.route || 'free'} · ${r.vehicleUid}`, uid: r.vehicleUid, stopsSkipped: r.missed });
      r.vehicleAfter = this.economy.vehicle(r.vehicleUid);
    }
    const xp = r.completed ? Math.round(r.score * 0.8 + r.carried * 4 + (r.mode === 'career' ? 200 : 0)) : 0;
    const c = this.career;
    const before = CAREER.level(c.xp);
    if (r.completed) { c.xp += xp; c.shifts++; if (r.route?.operator === 'aeroval' && 'SABC'.includes(r.grade)) c.aeroval = true; }
    c.carried += r.carried; c.km += r.distanceKm; this.save.save();
    const up = CAREER.level(c.xp) > before;
    this.menu.root.style.display = '';
    this.menu.root.innerHTML = `<div class="menu-screen summary"><header><h2>${r.completed ? 'Shift complete' : 'Shift ended'}</h2></header><div class="menu-body">
      <div class="grade grade-${r.grade}">${r.grade}</div><div class="score">${r.score} <small>/ 1000</small></div>
      <p class="sub">${r.route ? `${esc(r.route.route)} ${esc(r.route.name)} · ` : 'Free roam · '}${esc(r.spec.name)} · ${r.distanceKm.toFixed(2)} km · ${Math.floor(r.seconds / 60)} min · ${r.carried} passengers (${r.contactless} contactless) · ${r.stopsServed}/${r.stopsTotal} stops served · comfort ${r.comfort} %</p>
      ${r.completed ? `<p>+${xp} XP${up ? ` — <b>level ${CAREER.level(c.xp)} reached!</b> New vehicles/routes unlocked.` : ''}</p>` : ''}
      <div class="table-wrap"><table class="stations"><thead><tr><th>Stop</th><th>Position</th><th>Delay</th><th>Accuracy</th><th>Punctuality</th></tr></thead><tbody>
      ${r.stops.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.error >= 0 ? '+' : ''}${s.error.toFixed(1)} m</td><td>${Math.round(s.delay)} s</td><td>${s.acc}</td><td>${s.punct}</td></tr>`).join('') || '<tr><td colspan="5">No stops served</td></tr>'}</tbody></table></div>
      ${r.penalties.length ? `<h3>Penalties (−${r.penaltyTotal})</h3><ul class="penalties">${r.penalties.map((p) => `<li>${esc(p.text)}${p.count > 1 ? ` ×${p.count}` : ''} <b>−${p.points}</b></li>`).join('')}</ul>` : '<p>No penalties.</p>'}
      ${r.incidents?.length ? `<h3>Incident report</h3><ul class="penalties">${r.incidents.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${earningsTable(r.settlement, r.vehicleAfter)}
      <div class="row-tools"><button class="btn primary" id="bs-again">Another shift</button><button class="btn ghost" data-nav="main">Main menu</button></div></div></div>`;
    this.menu.root.querySelector('#bs-again').onclick = () => this.show();
  }
}
