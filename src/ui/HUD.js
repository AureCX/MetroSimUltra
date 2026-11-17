// Discreet driving HUD inspired by modern train control displays.
import { formatClock, formatDelta, formatDistance } from '../core/util.js';

export class HUD {
  constructor(root, bus, settings, input) {
    this.root = root; this.bus = bus; this.settings = settings; this.input = input;
    root.innerHTML = `
      <div class="hud-tl panel">
        <div class="hud-speed"><span id="h-speed">0</span><small>km/h</small></div>
        <div class="hud-limit"><div class="limit-disc" id="h-limit">--</div><div><div class="lbl">permitted</div><div id="h-next" class="sub"></div></div></div>
        <div class="hud-signal" id="h-signal"></div>
      </div>
      <div class="hud-tc panel">
        <div class="line-badge" id="h-badge"></div>
        <div><div class="lbl" id="h-stoplbl">Next stop</div><div class="hud-station" id="h-station"></div>
        <div class="sub"><span id="h-dist"></span> · doors <span id="h-doorside"></span></div>
        <div class="hud-junction" id="h-junction"></div></div>
      </div>
      <div class="hud-tr panel">
        <div class="hud-clock" id="h-clock"></div>
        <div class="sub" id="h-sched"></div>
        <div class="hud-delay" id="h-delay"></div>
      </div>
      <div class="hud-bl panel">
        <div class="notches" id="h-notches"></div>
        <div class="bars"><div class="bar"><span>Traction</span><i id="h-tr"></i></div><div class="bar brake"><span>Brake</span><i id="h-br"></i></div></div>
      </div>
      <div class="hud-br panel">
        <div class="row"><span class="lbl">Doors</span><b id="h-doors"></b></div>
        <div class="row"><span class="lbl">Dwell</span><b id="h-dwell"></b></div>
        <div class="row"><span class="lbl">Score</span><b id="h-score"></b></div>
        <div class="row"><span class="lbl">Camera</span><b id="h-cam"></b></div>
      </div>
      <div class="hud-alarm" id="h-alarm"></div>
      <div class="toasts" id="h-toasts"></div>
      <div class="tooltip" id="h-tip"></div>
      <div class="hud-help" id="h-help"></div>
      <div class="hud-map" id="h-map" hidden><canvas id="h-mapcanvas" width="2400" height="560"></canvas><div class="sub">Click or press <b id="h-mapkey">M</b> to close</div></div>`;
    this.el = Object.fromEntries([...root.querySelectorAll('[id]')].map((e) => [e.id.slice(2), e]));
    this.acc = 1;
    this.el.map.addEventListener('click', () => this.bus.emit('ui:lineMap'));
    bus.on('hud:update', (st) => this.update(st));
    bus.on('hud:toast', (t) => this.toast(t));
    bus.on('cab:hover', (label) => { this.el.tip.textContent = label || ''; this.el.tip.style.opacity = label ? 1 : 0; });
    window.addEventListener('pointermove', (e) => { this.el.tip.style.left = `${e.clientX + 16}px`; this.el.tip.style.top = `${e.clientY + 12}px`; });
    bus.on('settings:changed', () => this.applyVisibility());
    this.applyVisibility();
  }
  setMapOpen(open) { this.el.map.hidden = !open; this.el.mapkey.textContent = this.input.labelFor('lineMap'); }
  get mapOpen() { return !this.el.map.hidden; }
  get mapCanvas() { return this.el.mapcanvas; }

  applyVisibility() { this.root.classList.toggle('hidden-hud', !this.settings.get('gameplay.showHud')); }
  show(v) { this.root.style.display = v ? '' : 'none'; }

  helpText() {
    const L = (a) => this.input.labelFor(a);
    return `${L('tractionUp')} traction · ${L('tractionDown')} brake · ${L('emergencyBrake')} EB · ${L('doorsOpen')} open · ${L('doorsClose')} close · ${L('camera')} camera · right-drag look · ${L('pause')} menu`;
  }

  update(st) {
    this.acc++;
    if (this.acc % 4 !== 0) return; // ~15 Hz
    const e = this.el;
    e.speed.textContent = Math.round(st.speed);
    e.speed.parentElement.classList.toggle('over', st.overspeed !== 'none');
    e.limit.textContent = Math.round(st.permitted);
    e.next.textContent = st.authority ? `stop in ${Math.round(st.authority.distance)} m` : st.nextLimit ? `${Math.round(st.nextLimit.limit)} in ${Math.round(st.nextLimit.distance)} m` : '';
    if (st.signal) e.signal.innerHTML = `<i class="asp ${st.signal.aspect}"></i><span>${st.signal.number}</span><span class="sub">${Math.round(st.signal.distance)} m</span>`;
    e.badge.textContent = st.line.number; e.badge.style.background = st.line.color; e.badge.style.color = st.line.textColor;
    e.stoplbl.textContent = st.standing ? 'At platform' : 'Next stop';
    e.station.textContent = st.stationName;
    e.dist.textContent = st.standing ? `${st.stopDistance >= 0 ? '' : '+'}${Math.abs(st.stopDistance).toFixed(1)} m from marker` : formatDistance(st.stopDistance);
    e.doorside.textContent = st.doorSide === 'left' ? '◀ left' : 'right ▶';
    const j = st.junction;
    if (j && j.distance < 2500) {
      e.junction.style.display = 'block';
      e.junction.className = `hud-junction ${!j.set ? 'warn' : j.ok ? 'ok' : 'bad'}`;
      e.junction.textContent = `Junction ${formatDistance(j.distance)} · route ${j.set ? `${j.side === 'left' ? '◀' : '▶'} ${j.set}` : `not set — ${this.input.labelFor('routeSelect')}`} · train for ${j.destination}`;
    } else e.junction.style.display = 'none';
    e.clock.textContent = formatClock(st.clock);
    e.sched.textContent = st.standing ? (st.schedDep != null ? `Sched. dep ${formatClock(st.schedDep)}` : 'Terminus') : `Sched. arr ${st.schedArr != null ? formatClock(st.schedArr) : '--'}`;
    const d = st.delay;
    e.delay.textContent = Math.abs(d) < 30 ? `On time ${formatDelta(d)}` : d > 0 ? `Late ${formatDelta(d)}` : `Early ${formatDelta(d)}`;
    e.delay.className = `hud-delay ${Math.abs(d) < 30 ? 'ok' : d > 90 ? 'bad' : d > 0 ? 'warn' : 'early'}`;
    if (!this.notchBuilt || this.notchBuilt !== st.notches.length) {
      e.notches.innerHTML = st.notches.slice().reverse().map((p) => `<span data-p="${p}">${p > 0 ? `P${p}` : p === 0 ? 'N' : p === st.notches[0] ? 'EB' : `B${-p}`}</span>`).join('');
      this.notchBuilt = st.notches.length;
    }
    for (const s of e.notches.children) s.classList.toggle('on', Number(s.dataset.p) === st.notchPos);
    e.tr.style.width = `${st.traction * 100}%`;
    e.br.style.width = `${Math.max(st.brake, st.eb) * 100}%`;
    e.doors.textContent = st.doorsLocked ? 'Locked' : st.doorsStatus;
    e.doors.className = st.doorsLocked ? 'ok' : 'warn';
    e.dwell.textContent = st.standing ? (st.departure ? 'Depart ✓' : st.dwellOpened ? `${Math.max(0, Math.ceil(st.dwellRemaining))} s${st.boardingDone ? '' : ' · boarding'}` : 'Open doors') : '—';
    e.dwell.className = st.departure ? 'ok' : '';
    e.score.textContent = st.score;
    e.cam.textContent = st.cameraMode;
    e.alarm.textContent = st.alarm ? st.alarm.text : '';
    e.alarm.style.display = st.alarm ? 'block' : 'none';
    if (st.alarm) e.alarm.style.borderColor = st.alarm.color;
    e.help.textContent = this.helpText();
  }

  toast({ text, kind, dur }) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, dur * 1000);
  }
}
