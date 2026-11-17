// Bus driving HUD: route, destination, next stop & distance, GPS instruction, speed & limit,
// schedule, passengers, doors, vehicle condition, energy, score; full route overlay (M).
import { formatClock, formatDelta, formatDistance } from '../core/util.js';
import { escapeXml as esc } from './NetworkMap.js';
import { WEATHERS } from '../bus/Weather.js';

export class BusHUD {
  constructor(root, bus, settings, input) {
    this.root = root; this.bus = bus; this.settings = settings; this.input = input;
    root.innerHTML = `
      <div class="hud-tl panel"><div class="hud-speed"><span id="b-speed">0</span><small>km/h</small></div>
        <div class="hud-limit"><div class="limit-disc" id="b-limit">50</div><div><div class="lbl">limit</div><div class="sub" id="b-gear"></div></div></div></div>
      <div class="hud-tc panel">
        <div class="route-badge" id="b-badge"></div>
        <div><div class="lbl" id="b-stoplbl">Next stop</div><div class="hud-station" id="b-stop"></div><div class="sub" id="b-dist"></div><div class="hud-junction" id="b-nav" style="display:block"></div></div>
      </div>
      <div class="hud-tr panel"><div class="hud-clock" id="b-clock"></div><div class="sub" id="b-sched"></div><div class="hud-delay" id="b-delay"></div><div class="sub" id="b-weather"></div></div>
      <div class="hud-bl panel">
        <div class="row"><span class="lbl">Passengers</span><b id="b-pax"></b></div>
        <div class="row"><span class="lbl">Doors</span><b id="b-doors"></b></div>
        <div class="bars"><div class="bar"><span>Throttle</span><i id="b-thr"></i></div><div class="bar brake"><span>Brake</span><i id="b-brk"></i></div></div>
      </div>
      <div class="hud-br panel">
        <div class="row"><span class="lbl" id="b-energyl">Fuel</span><b id="b-energy"></b></div>
        <div class="row"><span class="lbl">Condition</span><b id="b-cond"></b></div>
        <div class="row"><span class="lbl">Comfort</span><b id="b-comfort"></b></div>
        <div class="row"><span class="lbl">Score</span><b id="b-score"></b></div>
        <div class="row"><span class="lbl">Camera</span><b id="b-cam"></b></div>
      </div>
      <div class="hud-alarm" id="b-alarm"></div>
      <div class="toasts" id="b-toasts"></div>
      <div class="tooltip" id="b-tip"></div>
      <div class="hud-help" id="b-help"></div>
      <div class="route-overlay" id="b-route" hidden></div>`;
    this.el = Object.fromEntries([...root.querySelectorAll('[id]')].map((e) => [e.id.slice(2), e]));
    this.n = 0;
    bus.on('hud:busUpdate', (st) => this.update(st));
    bus.on('hud:toast', (t) => { if (this.root.style.display !== 'none') this.toast(t); });
    bus.on('cab:hover', (label) => { this.el.tip.textContent = label || ''; this.el.tip.style.opacity = label ? 1 : 0; });
    window.addEventListener('pointermove', (e) => { this.el.tip.style.left = `${e.clientX + 16}px`; this.el.tip.style.top = `${e.clientY + 12}px`; });
    bus.on('bus:routeView', () => { this.el.route.hidden = !this.el.route.hidden; });
    this.el.route.addEventListener('click', () => { this.el.route.hidden = true; });
  }
  show(v) { this.root.style.display = v ? '' : 'none'; if (!v) this.el.route.hidden = true; }

  update(st) {
    if (++this.n % 4) return;
    const e = this.el, L = (a) => this.input.labelFor(a);
    e.speed.textContent = Math.round(st.speed);
    e.speed.parentElement.classList.toggle('over', st.speed > st.limit + 5);
    e.limit.textContent = st.limit;
    e.gear.textContent = `${st.engineOn ? st.gear : 'engine off'}${st.parking ? ' · P' : ''}`;
    if (st.route) { e.badge.textContent = st.route.route; e.badge.style.background = st.route.color; e.badge.style.color = st.route.textColor; e.badge.style.display = ''; }
    else e.badge.style.display = 'none';
    const phaseLbl = { deadhead: 'To first stop', service: st.standing ? 'At stop' : 'Next stop', return: 'Return to depot', done: 'Shift complete', free: 'Free drive' }[st.phase];
    e.stoplbl.textContent = st.route ? `${phaseLbl} · → ${st.destination}` : phaseLbl;
    e.stop.textContent = st.phase === 'return' ? 'Dépôt Grandville Est' : st.nextStopName || '—';
    e.dist.textContent = st.stopDist < Infinity ? `${formatDistance(st.stopDist)}${st.waiting ? ` · ${st.waiting} waiting` : ''}${st.stopRequest ? ' · STOP REQUESTED' : ''}` : '';
    const m = st.maneuver;
    e.nav.textContent = m ? `${m.kind === 'left' ? '↰' : m.kind === 'right' ? '↱' : m.kind === 'roundabout' ? `⟲ exit ${m.exit}` : '↑'} ${formatDistance(m.dist)} · ${m.name}` : '';
    e.clock.textContent = formatClock(st.clock);
    e.sched.textContent = st.route && st.schedArr ? `${st.standing && st.schedDep ? 'Dep' : 'Arr'} ${formatClock(st.standing && st.schedDep ? st.schedDep : st.schedArr, false)}` : '';
    const d = st.delay;
    e.delay.textContent = st.route ? (Math.abs(d) < 60 ? `On time ${formatDelta(d)}` : d > 0 ? `Late ${formatDelta(d)}` : `Early ${formatDelta(d)}`) : '';
    e.delay.className = `hud-delay ${Math.abs(d) < 60 ? 'ok' : d > 180 ? 'bad' : d > 0 ? 'warn' : 'early'}`;
    e.weather.textContent = `${WEATHERS[st.weatherLabel]?.label ?? st.weatherLabel} · ${st.weather.mu < 0.4 ? 'icy/snowy road' : st.weather.mu < 0.7 ? 'wet road' : 'dry road'}`;
    e.pax.textContent = `${st.passengers} / ${st.capacity}`;
    e.doors.textContent = st.doorsClosed ? 'Closed' : st.doors.map((a, i) => (a > 0.05 ? i + 1 : '·')).join(' ') + (st.kneel ? ' · kneeling' : '');
    e.doors.className = st.doorsClosed ? 'ok' : 'warn';
    e.thr.style.width = `${st.throttle * 100}%`; e.brk.style.width = `${st.brake * 100}%`;
    e.energyl.textContent = st.electric ? 'Battery' : 'Fuel';
    e.energy.textContent = `${Math.round(st.energyPct * 100)} %`; e.energy.className = st.energyPct < 0.15 ? 'warn' : '';
    e.cond.textContent = `${Math.round(st.condition * 100)} %`; e.cond.className = st.condition < 0.6 ? 'warn' : '';
    e.comfort.textContent = `${Math.max(0, Math.round(st.comfort))} %`;
    e.score.textContent = st.score;
    e.cam.textContent = st.camMode;
    const alarm = st.service ? `${st.service.label} · ${Math.round(st.service.pct * 100)} %` : !st.engineOn && st.speed < 1 ? `Engine off — ${L('engine')} to start` : st.parking && st.throttle > 0.2 ? `Parking brake applied — ${L('parking')}` : '';
    e.alarm.textContent = alarm; e.alarm.style.display = alarm ? 'block' : 'none'; e.alarm.style.borderColor = st.service ? '#3cff8a' : '#ffb300';
    e.help.textContent = `${L('throttle')} accel · ${L('brake')} brake · ${L('steerLeft')}/${L('steerRight')} steer · ${L('doorFront')}/${L('doorRear')} doors · ${L('indLeft')}/${L('indRight')} indicators · ${L('kneel')} kneel · ${L('parking')} park brake · ${L('routeView')} route · ${L('camera')} camera · right-drag look`;
    if (!e.route.hidden) this.drawRoute(st);
  }

  drawRoute(st) {
    if (!st.route) { this.el.route.innerHTML = '<p>No route in free drive.</p>'; return; }
    this.el.route.innerHTML = `<h3><span class="route-badge" style="background:${st.route.color};color:${st.route.textColor}">${esc(st.route.route)}</span> ${esc(st.route.name)} → ${esc(st.destination)}</h3>
      <ol>${st.upcoming.map((s, i) => `<li class="${i === 0 ? 'next' : ''}"><span>${esc(s.name)}</span><b>${s.time ? formatClock(s.time, false) : ''}</b></li>`).join('')}</ol><p class="sub">Click or press ${this.input.labelFor('routeView')} to close</p>`;
  }

  toast({ text, kind, dur }) {
    const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = text;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur * 1000);
  }
}
