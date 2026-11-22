// Flight HUD: flight strip (number, route, stand, runways, status, distance, ETA), clock / weather / METAR,
// compact PFD + ND in the outside views, aircraft state strip (thrust, flaps, gear, spoilers, brakes, trim,
// engines), clickable autopilot panel (FCU), ATC panel (available requests + radio transcript), key help, toasts
// and the full-screen aviation map (airports, runways, routes, all traffic with altitude / speed, taxi route).
import { drawPFD, drawND } from '../air/FlightDisplays.js';
import { AIRPORTS } from '../air/AirData.js';
import { fmtT } from '../air/AirTraffic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST_LABEL = { stand: 'At the stand', cleared: 'Start-up cleared', pushback: 'Push-back', ready: 'Ready to taxi', taxiOut: 'Taxi to the holding point', holding: 'Holding point', lineup: 'Cleared for take-off', enroute: 'En route', approach: 'Approach', final: 'Cleared to land', goAround: 'Go-around', landed: 'Landed', taxiIn: 'Taxi to the stand', arrived: 'Arrived' };

export class FlightHUD {
  constructor(root, bus, input, getGame) {
    this.root = root; this.bus = bus; this.input = input; this.game = getGame;
    root.innerHTML = `
      <div class="air-strip panel" id="a-strip"></div>
      <div class="hud-tr panel air-tr"><div class="hud-clock" id="a-clock"></div><div class="sub" id="a-wx"></div><div class="air-metar" id="a-metar"></div></div>
      <div class="air-inst" id="a-inst"><canvas id="a-pfd" width="512" height="512"></canvas><canvas id="a-nd" width="512" height="512"></canvas></div>
      <div class="air-sys panel" id="a-sys"></div>
      <div class="air-fcu panel" id="a-fcu">
        <button data-a="ap">AP</button><button data-a="athr">A/THR</button><button data-a="appr">APPR</button><button data-a="lnav">NAV</button>
        <span class="sep"></span><button data-a="spdDown">SPD−</button><b id="a-spd"></b><button data-a="spdUp">SPD+</button>
        <button data-a="hdgL">HDG−</button><b id="a-hdg"></b><button data-a="hdgR">HDG+</button>
        <button data-a="altDown">ALT−</button><b id="a-alt"></b><button data-a="altUp">ALT+</button>
      </div>
      <div class="air-atc panel" id="a-atc"><div class="air-atc-h">ATC <small id="a-freq"></small><button id="a-atcx" title="Close">×</button></div><div id="a-opts"></div><div class="air-radio" id="a-radio"></div></div>
      <div class="hud-alarm" id="a-alarm"></div>
      <div class="toasts" id="a-toasts"></div>
      <div class="hud-help" id="a-help"></div>
      <div class="air-map" id="a-map" hidden><canvas id="a-mapc"></canvas><div class="air-map-info" id="a-mapi"></div><button class="air-map-x" id="a-mapx">Close map (M)</button></div>`;
    this.el = Object.fromEntries([...root.querySelectorAll('[id]')].map((e) => [e.id.slice(2), e]));
    this.n = 0; this.atcOpen = true; this.map = { open: false, scale: 1 / 900, cx: null, cz: null, follow: true };
    bus.on('hud:airUpdate', (s) => this.update(s));
    bus.on('hud:toast', (t) => { if (this.root.style.display !== 'none') this.toast(t); });
    bus.on('air:atcMenu', () => { this.atcOpen = !this.atcOpen; this.el.atc.hidden = !this.atcOpen; });
    bus.on('air:map', () => this.toggleMap());
    this.el.atcx.onclick = () => { this.atcOpen = false; this.el.atc.hidden = true; };
    this.el.mapx.onclick = () => this.toggleMap(false);
    this.el.fcu.addEventListener('click', (e) => { const a = e.target.dataset?.a; if (a) this.input.trigger(a); });
    this.el.opts.addEventListener('click', (e) => { const id = e.target.closest('[data-req]')?.dataset.req; if (id) this.game()?.atcRequest(id); });
    window.addEventListener('keydown', (e) => {
      if (this.root.style.display === 'none' || !this.atcOpen) return;
      const m = /^Digit([1-6])$/.exec(e.code); if (!m || e.target?.tagName === 'INPUT') return;
      const o = this.lastOpts?.[Number(m[1]) - 1]; if (o) { e.preventDefault(); this.game()?.atcRequest(o.id); }
    });
    // Map interaction: drag to pan, wheel to zoom, click an aircraft / airport for details.
    const c = this.el.mapc; let drag = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener('pointerup', (e) => { if (drag && !drag.moved && this.map.open) this.pick(e); drag = null; });
    c.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; this.map.cx -= dx / this.map.scale; this.map.cz -= dy / this.map.scale; this.map.follow = false; drag.x = e.clientX; drag.y = e.clientY; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.map.scale = Math.min(1 / 4, Math.max(1 / 3000, this.map.scale * (e.deltaY > 0 ? 0.85 : 1.18))); }, { passive: false });
  }
  show(v) { this.root.style.display = v ? '' : 'none'; if (!v) this.toggleMap(false); else { this.el.atc.hidden = !this.atcOpen; } }
  toggleMap(open = !this.map.open) { this.map.open = open; this.el.map.hidden = !open; if (open) { this.map.follow = true; this.drawMap(); } }
  toast({ text, kind = 'info', dur = 3 }) {
    const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = text; this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur * 1000);
  }
  update(s) {
    const h = s.hud, e = this.el, L = (a) => this.input.labelFor(a), F = h.flight;
    const exterior = !/Pilot|Instrument/.test(h.cam);
    e.inst.style.display = exterior ? '' : 'none';
    if (exterior) { drawPFD(e.pfd.getContext('2d'), s); drawND(e.nd.getContext('2d'), s); }
    if (this.map.open && this.n % 2 === 0) this.drawMap();
    if (++this.n % 3) return;
    e.strip.innerHTML = `<span class="air-badge" style="background:${F.airline.color};color:${F.airline.accent}">${esc(F.no)}</span>
      <div><div class="air-route">${esc(F.from)} → ${esc(F.to)} <small>${esc(F.type.toUpperCase())} · stand ${esc(h.gate || '—')} · dep RWY ${esc(h.dep)} · arr RWY ${esc(h.arr)}</small></div>
      <div class="sub">${esc(ST_LABEL[h.st] || h.st)} · ${h.distKm.toFixed(0)} km to ${esc(F.to)} · sched. arr ${fmtT(F.arr)}${s.next?.eta ? ` · ETA ${s.next.eta}` : ''}</div></div>`;
    e.clock.textContent = `${fmtT(h.clock)}${h.warp > 1 ? ` ×${h.warp}` : ''}`;
    e.wx.textContent = `${h.weather.label} · vis ${h.weather.vis >= 10000 ? '10 km+' : `${Math.round(h.weather.vis)} m`} · ${h.cam}`;
    e.metar.textContent = h.weather.metar;
    const pct = (v) => `${Math.round(v * 100)}%`;
    e.sys.innerHTML = `<div class="row"><span class="lbl">Thrust</span><b>${h.reverse ? 'REV ' : ''}${pct(h.throttle)}</b><i class="air-bar"><i style="width:${pct(h.throttle)}"></i></i></div>
      <div class="row"><span class="lbl">IAS / ALT</span><b>${Math.round(s.ias)} kt · ${Math.round(s.altFt / 10) * 10} ft · ${s.vsFpm >= 0 ? '+' : ''}${Math.round(s.vsFpm / 50) * 50} fpm</b></div>
      <div class="row"><span class="lbl">Flaps / gear</span><b>${esc(s.flapLabel)} · ${s.gear > 0.98 ? 'DOWN' : s.gear < 0.02 ? 'UP' : 'TRANSIT'}${s.spoilers > 0.05 ? ' · SPD BRK' : s.spoilersArmed ? ' · SPLR ARM' : ''}</b></div>
      <div class="row"><span class="lbl">Brakes</span><b>${s.parking ? 'PARKING' : s.brake ? 'ON' : 'off'} · trim ${h.trim >= 0 ? '+' : ''}${h.trim.toFixed(2)}</b></div>
      <div class="row"><span class="lbl">Engines</span><b>${h.engines.map((x, i) => `${i + 1}:${x === 'run' ? Math.round((s.n1[i] || 0) * 100) + '%' : x === 'start' ? 'START' : 'OFF'}`).join(' ')}</b></div>
      <div class="row"><span class="lbl">Fuel</span><b>${Math.round(h.fuel).toLocaleString('fr-FR')} kg</b></div>
      ${h.penalties.length ? `<div class="row warn"><span class="lbl">Penalties</span><b>${h.penalties.map((p) => esc(p.text) + (p.count > 1 ? ` ×${p.count}` : '')).join(', ')}</b></div>` : ''}`;
    e.spd.textContent = Math.round(s.ap.spdKt); e.hdg.textContent = String(Math.round(s.ap.hdg)).padStart(3, '0'); e.alt.textContent = Math.round(s.ap.altFt / 100) * 100;
    for (const b of e.fcu.querySelectorAll('button')) { const a = b.dataset.a; b.classList.toggle('on', (a === 'ap' && s.ap.on) || (a === 'athr' && s.ap.at) || (a === 'appr' && s.ap.appArmed) || (a === 'lnav' && s.ap.lat === 'LNAV')); }
    // ATC.
    this.lastOpts = h.options;
    const sig = h.options.map((o) => o.id).join();
    if (sig !== this.optSig) { this.optSig = sig; e.opts.innerHTML = h.options.map((o, i) => `<button data-req="${o.id}"><kbd>${i + 1}</kbd> ${esc(o.label)}</button>`).join(''); }
    e.freq.textContent = `${L('atc')} = next request · ${L('atcMenu')} panel`;
    e.radio.innerHTML = h.radio.map((r) => `<div class="${r.pilot ? 'me' : r.mine ? 'mine' : ''}"><b>${esc(r.who)}</b> ${esc(r.text)}</div>`).join('');
    e.alarm.textContent = s.warn || ''; e.alarm.style.display = s.warn ? '' : 'none';
    e.help.innerHTML = `${L('pitchUp')}/${L('pitchDown')} pitch · ${L('rollLeft')}/${L('rollRight')} roll · ${L('yawLeft')}/${L('yawRight')} rudder/steer · ${L('throttleUp')}/${L('throttleDown')} thrust · ${L('flapsDown')}/${L('flapsUp')} flaps · ${L('gear')} gear · ${L('brakes')} brakes · ${L('parking')} park brake · ${L('spoilers')} spoilers · ${L('engines')} engines · ${L('ap')} AP · ${L('athr')} A/THR · ${L('appr')} APPR · ${L('camera')} camera · ${L('map')} map · ${L('mouseYoke')} mouse flight${h.mouseYoke ? ' (ON)' : ''}`;
  }
  // ---------------- map ----------------
  pick(e) {
    const g = this.game(); if (!g) return; const st = g.mapState(), M = this.map, c = this.el.mapc, r = c.getBoundingClientRect();
    const x = M.cx + (e.clientX - r.left - c.width / 2) / M.scale, z = M.cz + (e.clientY - r.top - c.height / 2) / M.scale, tol = 14 / M.scale;
    const ac = st.aircraft.find((a) => Math.hypot(a.x - x, a.z - z) < tol), ap = AIRPORTS.find((a) => Math.hypot(a.x - x, a.z - z) < Math.max(tol, 2500));
    const i = this.el.mapi;
    if (ac) i.innerHTML = `<b>${esc(ac.no)}</b> ${esc(ac.type)}${ac.from ? ` · ${ac.from} → ${ac.to}` : ''}<br>${ac.ground ? 'On the ground' : `${Math.round(ac.alt * 3.28 / 100) * 100} ft · ${Math.round(ac.v * 1.94)} kt · hdg ${Math.round(ac.hdg)}°`}${ac.phase ? ` · ${esc(ac.phase)}` : ''}`;
    else if (ap) { const b = g.schedule.board(ap.id, 'dep', g.clock, 5); i.innerHTML = `<b>${esc(ap.name)}</b> (${ap.icao}) · RWY ${esc(g.atc.of(ap.id).active().name)}<br>${b.map((f) => `${fmtT(f.dep)} ${esc(f.no)} → ${f.to} ${esc(g.schedule.status(f, g.clock).label)}`).join('<br>')}`; }
    else i.innerHTML = '';
  }
  drawMap() {
    const g = this.game(); if (!g) return; const st = g.mapState(), c = this.el.mapc, M = this.map;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) { c.width = c.clientWidth || 800; c.height = c.clientHeight || 600; }
    if (M.follow || M.cx == null) { M.cx = st.me.x; M.cz = st.me.z; }
    const W = c.width, H = c.height, x2 = (x) => W / 2 + (x - M.cx) * M.scale, y2 = (z) => H / 2 + (z - M.cz) * M.scale, k = c.getContext('2d');
    k.fillStyle = '#0c1620'; k.fillRect(0, 0, W, H);
    // Grid every 50 km, coasts suggested by the sea tint at the screen corners is skipped; routes between airports.
    k.strokeStyle = 'rgba(120,150,180,0.12)'; k.lineWidth = 1; const step = 50000;
    for (let x = Math.floor((M.cx - W / 2 / M.scale) / step) * step; x < M.cx + W / 2 / M.scale; x += step) { k.beginPath(); k.moveTo(x2(x), 0); k.lineTo(x2(x), H); k.stroke(); }
    for (let z = Math.floor((M.cz - H / 2 / M.scale) / step) * step; z < M.cz + H / 2 / M.scale; z += step) { k.beginPath(); k.moveTo(0, y2(z)); k.lineTo(W, y2(z)); k.stroke(); }
    k.strokeStyle = 'rgba(160,190,220,0.25)'; k.setLineDash([6, 8]);
    for (const [a, b] of [['GRV', 'MTV'], ['GRV', 'VLD'], ['GRV', 'CLM'], ['GRV', 'SRA'], ['GRV', 'BLR'], ['GRV', 'PAZ'], ['PAZ', 'VLD'], ['PAZ', 'BLR'], ['MTV', 'CLM'], ['BLR', 'VLD']]) { const A = AIRPORTS.find((p) => p.id === a), B = AIRPORTS.find((p) => p.id === b); k.beginPath(); k.moveTo(x2(A.x), y2(A.z)); k.lineTo(x2(B.x), y2(B.z)); k.stroke(); }
    k.setLineDash([]);
    // Player route.
    if (st.route) { k.strokeStyle = '#ff4fe0'; k.lineWidth = 2; k.beginPath(); k.moveTo(x2(st.me.x), y2(st.me.z)); for (const w of st.route) k.lineTo(x2(w.x), y2(w.z)); k.stroke(); for (const w of st.route) { k.fillStyle = '#ff4fe0'; k.fillRect(x2(w.x) - 3, y2(w.z) - 3, 6, 6); k.font = '11px sans-serif'; k.fillText(w.name, x2(w.x) + 6, y2(w.z) - 6); } }
    if (st.taxi && M.scale > 1 / 30) { k.strokeStyle = '#3cff6a'; k.lineWidth = 3; k.beginPath(); st.taxi.forEach((n, i) => (i ? k.lineTo(x2(n.x), y2(n.z)) : k.moveTo(x2(n.x), y2(n.z)))); k.stroke(); }
    // Airports with runways to scale.
    for (const ap of AIRPORTS) {
      const L = g.world.layout(ap.id);
      k.strokeStyle = '#e8eef4'; k.lineWidth = Math.max(2, 45 * M.scale);
      for (const r of L.runways) { const d = r.dirs[0]; k.beginPath(); k.moveTo(x2(d.thr.x), y2(d.thr.z)); k.lineTo(x2(d.stop.x), y2(d.stop.z)); k.stroke(); }
      if (M.scale > 1 / 40) { k.strokeStyle = 'rgba(200,200,120,0.5)'; k.lineWidth = Math.max(1, 23 * M.scale); for (let i = 0; i < L.graph.nodes.length; i++) for (const e of L.graph.adj[i]) { if (e.to < i || e.runway) continue; const a = L.graph.nodes[i], b = L.graph.nodes[e.to]; k.beginPath(); k.moveTo(x2(a.x), y2(a.z)); k.lineTo(x2(b.x), y2(b.z)); k.stroke(); } }
      k.fillStyle = ap.id === st.to ? '#ff4fe0' : ap.id === st.from ? '#3fd7ff' : '#9fc3ff'; k.font = 'bold 13px sans-serif'; k.fillText(`${ap.icao} ${ap.city}`, x2(ap.x) + 10, y2(ap.z) - 10);
    }
    // Traffic.
    const plane = (x, y, hdg, col, s = 7) => { k.save(); k.translate(x, y); k.rotate(hdg * Math.PI / 180); k.fillStyle = col; k.beginPath(); k.moveTo(0, -s); k.lineTo(s * 0.7, s * 0.6); k.lineTo(0, s * 0.25); k.lineTo(-s * 0.7, s * 0.6); k.fill(); k.restore(); };
    for (const a of st.aircraft) {
      const x = x2(a.x), y = y2(a.z); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      plane(x, y, a.hdg, a.remote ? '#ffb000' : a.ground ? '#8fa1b3' : '#e8eef4', a.ground ? 5 : 7);
      if (!a.ground || M.scale > 1 / 15) { k.fillStyle = a.remote ? '#ffb000' : '#b8c6d4'; k.font = '10px monospace'; k.fillText(`${a.no}${a.ground ? '' : ` ${String(Math.round(a.alt * 3.28 / 100)).padStart(3, '0')} ${Math.round(a.v * 1.94)}`}`, x + 8, y + 3); }
    }
    plane(x2(st.me.x), y2(st.me.z), st.me.hdg, '#3cff6a', 10);
    k.fillStyle = '#3cff6a'; k.font = 'bold 12px monospace'; k.fillText(`${st.me.no} ${Math.round(st.me.alt * 3.28 / 100)}`, x2(st.me.x) + 12, y2(st.me.z) + 4);
    k.fillStyle = '#9fb3c8'; k.font = '12px sans-serif'; k.fillText(`Scale: ${(100 / M.scale / 1000).toFixed(1)} km / 100 px · drag to pan, wheel to zoom, click for details`, 14, H - 14);
  }
}
