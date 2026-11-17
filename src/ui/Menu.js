// Main menu, line selection (network map, import/export, MP3 announcements), train selection,
// settings, controls (rebinding), credits, pause menu, loading screen and run summary.
import { renderNetworkMap, escapeXml as esc } from './NetworkMap.js';
import { ACTIONS, PAD_LABELS } from '../core/Input.js';
import { AssetStore } from '../core/AssetStore.js';
import { formatClock, formatDelta, slugify } from '../core/util.js';
import { Timetable } from '../stations/Timetable.js';
import { TrackGeometry } from '../lines/TrackGeometry.js';
import { Route } from '../lines/Route.js';
import { EXAMPLE_LINE } from '../lines/LineRepository.js';

export class Menu {
  constructor(root, { repo, settings, save, input, bus, audio }) {
    Object.assign(this, { root, repo, settings, save, input, bus, audio });
    this.handlers = {};
    this.context = 'main'; // main | pause
    const sel = save.selection;
    this.sel = {
      lineId: repo.line(sel.lineId) ? sel.lineId : repo.lines[0]?.id,
      trainId: repo.train(sel.trainId) ? sel.trainId : repo.trains[0]?.id,
      direction: sel.direction === 'B' ? 'B' : 'A',
    };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (b) { this.audio.started && this.audio.click(); this.show(b.dataset.nav); }
    });
  }
  on(evt, fn) { this.handlers[evt] = fn; }
  emit(evt, ...a) { this.handlers[evt]?.(...a); }
  get line() { return this.repo.line(this.sel.lineId); }
  get train() { return this.repo.train(this.sel.trainId); }
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
    const rec = l ? this.save.record(l.id, this.sel.direction) : null;
    this.root.innerHTML = `<div class="menu-main">
      <div class="brand"><div class="logo">M</div><div><h1>Metro Driver</h1><p>Underground railway simulator</p></div></div>
      <nav>
        <button class="btn primary" id="m-play">▶ Play metro</button>
        <button class="btn primary bus-btn" id="m-bus">🚌 Bus — Grandville & Aéroval</button>
        <button class="btn" data-nav="lines">Select Line</button>
        <button class="btn" data-nav="trains">Select Train</button>
        <button class="btn" data-nav="settings">Settings</button>
        <button class="btn" data-nav="controls">Controls</button>
        <button class="btn" data-nav="credits">Credits</button>
      </nav>
      <div class="selection-card">
        ${l ? `<div class="line-badge big" style="background:${l.color};color:${l.textColor}">${esc(l.number)}</div>
        <div><b>${esc(l.fullName)}</b> · ${esc(l.network)}<br><span class="sub">${esc(l.directions[this.sel.direction].name)} · ${l.stations.length} stations</span><br>
        <span class="sub">Train: ${esc(t?.name || '-')}</span>
        ${rec ? `<br><span class="sub">Best: ${rec.bestScore} pts (grade ${rec.bestGrade}) · ${rec.runs} run(s)</span>` : ''}</div>` : '<div>No line available. Import one in “Select Line”.</div>'}
      </div>
      <div class="totals sub">Career: ${this.save.data.totals.runs} runs · ${this.save.data.totals.distanceKm.toFixed(1)} km · ${this.save.data.totals.stations} stations served</div>
      ${this.repo.errors.length ? `<div class="errors">${this.repo.errors.map(esc).join('<br>')}</div>` : ''}
    </div>`;
    this.root.querySelector('#m-bus').onclick = () => this.emit('bus');
    this.root.querySelector('#m-play').onclick = () => { if (this.line && this.train) { this.persist(); this.emit('play', { line: this.line, train: this.train, direction: this.sel.direction }); } };
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
    const select = (id) => { this.sel.lineId = id; this.persist(); this.renderLines(); };
    renderNetworkMap(this.root.querySelector('#l-map'), lines, this.sel.lineId, select);
    const list = this.root.querySelector('#l-list');
    // One entry per line; a branching line's services are chosen in the detail panel.
    const groups = [...new Map(lines.map((l) => [l.sourceId, this.repo.services(l)])).values()];
    const cur = this.line;
    list.innerHTML = groups.map((svcs) => {
      const l = svcs.find((x) => x.id === cur?.id) || svcs[0];
      const sel = svcs.some((x) => x.id === cur?.id);
      const ends = svcs.length > 1 ? `${esc(l.stations[0].name)} ↔ ${svcs.map((x) => esc(x.stations.at(-1).name)).join(' / ')}` : `${esc(l.stations[0].name)} ↔ ${esc(l.stations.at(-1).name)}`;
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
    const route = new Route(l, geom, this.sel.direction);
    const tt = new Timetable(route, this.train, l.startTime);
    const total = l.stations.reduce((a, s) => a + s.distanceToNext, 0);
    const svcs = this.repo.services(l);
    const dirLabel = (d) => (svcs.length > 1 && d === 'A' ? `Direction ${svcs.map((x) => x.service).join(' / ')}` : l.directions[d].name);
    const branchRow = svcs.length > 1 ? `<div class="branch-toggle"><span class="sub">${this.sel.direction === 'A' ? 'Destination:' : 'Starting from:'}</span>${svcs.map((x) => `<button class="btn small ${x.id === l.id ? 'primary' : ''}" data-svc="${x.id}">${esc(x.service)}</button>`).join('')}
      <span class="sub">${this.sel.direction === 'A' ? `Set the route at ${esc(l.stations[l.trunkLength - 1].name)} junction while driving.` : ''}</span></div>` : '';
    el.innerHTML = `
      <div class="detail-head"><span class="line-badge big" style="background:${l.color};color:${l.textColor}">${esc(l.number)}</span>
      <div><h3>${esc(l.name)}</h3><span class="sub">${esc(l.network)} · ${(total / 1000).toFixed(2)} km · ${l.stations.length} stations · ${l.signaling.system === 'cbtc' ? 'CBTC moving block' : 'Fixed-block signalling'} · ${l.tunnelProfile} tunnel</span></div></div>
      <div class="dir-toggle">${['A', 'B'].map((d) => `<button class="btn small ${d === this.sel.direction ? 'primary' : ''}" data-dir="${d}">${esc(dirLabel(d))}</button>`).join('')}</div>
      ${branchRow}
      <div class="table-wrap"><table class="stations">
        <thead><tr><th>#</th><th>Station</th><th>Next</th><th>Limit</th><th>Dwell</th><th>Arr</th><th>Platform</th><th title="Next-station announcement">🔊</th></tr></thead>
        <tbody>${route.stops.map((s, k) => {
          const st = s.station, e = tt.entry(k);
          const dist = this.sel.direction === 'A' ? st.distanceToNext : (k < route.stops.length - 1 ? route.stops[k + 1].station.distanceToNext : 0);
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
    el.querySelector('#l-use').onclick = () => { this.persist(); this.emit('play', { line: l, train: this.train, direction: this.sel.direction }); };
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
    const body = this.frame('Select Train', `<div class="train-grid">${this.repo.trains.map((t) => `
      <button class="train-card ${t.id === this.sel.trainId ? 'sel' : ''}" data-id="${t.id}">
        <div class="train-strip" style="background:linear-gradient(90deg, ${t.livery?.body || '#ddd'} 70%, ${t.livery?.front || '#333'})"><i style="background:${t.livery?.stripe || '#ffcc00'}"></i></div>
        <h3>${esc(t.name)}</h3><p class="sub">${esc(t.description || '')}</p>
        <dl>
          <dt>Formation</dt><dd>${t.cars} cars · ${t.length.toFixed(1)} m</dd>
          <dt>Mass (empty)</dt><dd>${t.massEmpty} t</dd>
          <dt>Power</dt><dd>${t.maxPower} kW · ${t.maxTractiveForce} kN</dd>
          <dt>Max speed</dt><dd>${t.maxSpeed} km/h</dd>
          <dt>Start accel.</dt><dd>${t.maxAccel.toFixed(2)} m/s²</dd>
          <dt>Service / EB</dt><dd>${t.serviceDecel} / ${t.emergencyDecel} m/s²</dd>
          <dt>Controller</dt><dd>P${t.tractionNotches} · B${t.brakeNotches} · EB</dd>
          <dt>Doors</dt><dd>${t.doorsPerSide} per side per car</dd>
        </dl></button>`).join('')}</div>`);
    body.querySelectorAll('.train-card').forEach((c) => (c.onclick = () => { this.sel.trainId = c.dataset.id; this.persist(); this.screen_trains(); }));
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
  screen_controls() {
    const body = this.frame('Controls', `
      <p class="sub">Click a key to rebind it, then press the new key (Esc cancels). Keys follow your keyboard layout.</p>
      <table class="controls"><thead><tr><th>Action</th><th>Primary</th><th>Secondary</th><th>Gamepad</th></tr></thead><tbody>
      ${Object.entries(ACTIONS).map(([a, def]) => `<tr><td>${esc(def.label)}</td>
        ${[0, 1].map((slot) => `<td><button class="key" data-a="${a}" data-slot="${slot}">${esc(this.input.keyLabel(this.input.bindings[a][slot]))}</button></td>`).join('')}
        <td class="sub">${(def.pad || []).map((b) => PAD_LABELS[b]).join(' / ') || '—'}${a === 'tractionUp' ? ' / D-pad ↑' : a === 'tractionDown' ? ' / D-pad ↓' : ''}</td></tr>`).join('')}
      </tbody></table>
      <p class="sub">Mouse: left-click cab buttons, drag or scroll on the master controller; hold right button to look around; scroll to zoom. Gamepad right stick looks around.</p>
      <button class="btn small danger" id="c-reset">Restore defaults</button>`);
    body.querySelectorAll('.key').forEach((b) => (b.onclick = () => {
      b.textContent = '…press a key'; b.classList.add('listening');
      this.input.rebind(b.dataset.a, Number(b.dataset.slot), () => this.screen_controls());
    }));
    body.querySelector('#c-reset').onclick = () => { this.input.resetBindings(); this.screen_controls(); };
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
    const other = r.direction === 'A' ? 'B' : 'A';
    this.root.innerHTML = `<div class="menu-screen summary"><header><h2>${r.completed ? 'Run complete' : 'Run aborted'}</h2></header>
      <div class="menu-body">
        <div class="grade grade-${r.grade}">${r.grade}</div>
        <div class="score">${r.score} <small>/ 1000</small>${newBest ? ' <span class="tag">new record</span>' : ''}</div>
        ${r.reason ? `<p class="errors">${esc(r.reason)}</p>` : ''}
        <p class="sub">${esc(r.line.fullName)} · ${esc(r.line.directions[r.direction].name)} · ${esc(r.train.name)} · ${r.distanceKm.toFixed(2)} km in ${Math.floor(r.seconds / 60)} min ${Math.round(r.seconds % 60)} s · final delay ${formatDelta(r.finalDelay)}</p>
        <div class="table-wrap"><table class="stations"><thead><tr><th>Station</th><th>Stop error</th><th>Delay</th><th>Accuracy</th><th>Punctuality</th></tr></thead>
        <tbody>${r.stops.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.error >= 0 ? '+' : ''}${s.error.toFixed(2)} m</td><td>${formatDelta(s.delay)}</td><td>${s.acc}</td><td>${s.punct}</td></tr>`).join('') || '<tr><td colspan="5">No stops served</td></tr>'}</tbody></table></div>
        ${r.penalties.length ? `<h3>Penalties (−${r.penaltyTotal})</h3><ul class="penalties">${r.penalties.map((p) => `<li>${esc(p.text)}${p.count > 1 ? ` ×${p.count}` : ''} <b>−${p.points}</b></li>`).join('')}</ul>` : '<p>No penalties — exemplary driving.</p>'}
        <div class="row-tools">
          <button class="btn primary" id="r-back">Drive back (${esc(r.line.directions[other].name)})</button>
          <button class="btn" id="r-again">Retry</button>
          <button class="btn ghost" data-nav="main">Main menu</button>
        </div></div></div>`;
    this.root.querySelector('#r-back').onclick = () => { this.sel.direction = other; this.persist(); this.emit('play', { line: r.line, train: r.train, direction: other }); };
    this.root.querySelector('#r-again').onclick = () => this.emit('play', { line: r.line, train: r.train, direction: r.direction });
  }
}
