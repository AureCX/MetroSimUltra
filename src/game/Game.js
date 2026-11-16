// A driving session: wires all decoupled systems together for one line / train / direction.
import * as THREE from 'three';
import { TrackGeometry } from '../lines/TrackGeometry.js';
import { Route } from '../lines/Route.js';
import { Timetable } from '../stations/Timetable.js';
import { StationManager } from '../stations/StationManager.js';
import { PlayerTrain } from '../driving/PlayerTrain.js';
import { SignalSystem } from '../signaling/SignalSystem.js';
import { TrafficManager } from '../traffic/TrafficManager.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { SignalView } from '../world/SignalView.js';
import { TrainModel } from '../world/TrainModel.js';
import { PassengerSystem } from '../world/Passengers.js';
import { Cabin, CabInteraction } from '../cabin/Cabin.js';
import { CameraSystem } from '../camera/CameraSystem.js';
import { Announcer } from '../audio/Announcer.js';
import { Scoring } from './Scoring.js';
import { setMaxAnisotropy } from '../world/Textures.js';

const STEP = 1 / 120;

export class Game {
  constructor({ renderer, bus, settings, input, audio }) {
    this.renderer = renderer; this.bus = bus; this.settings = settings; this.input = input; this.audio = audio;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
    this.paused = false;
    this.running = false;
    this.subs = [];
    this.messages = [];
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.interaction = new CabInteraction(renderer.domElement, () => this.camera, bus);
    this.cameraSys = new CameraSystem(this.camera, renderer.domElement, settings, bus);
  }

  /** Builds the whole session. */
  start({ line, train, direction }) {
    this.dispose();
    const bus = this.bus;
    this.line = line; this.specs = train; this.direction = direction;
    const scene = this.scene = new THREE.Scene();
    const draw = this.settings.get('graphics.drawDistance');
    scene.background = new THREE.Color(0x040507);
    scene.fog = new THREE.Fog(0x050608, 25, draw);
    this.camera.far = draw + 50;
    scene.add(new THREE.HemisphereLight(0x8a8f99, 0x2a241c, 0.55));
    scene.add(new THREE.AmbientLight(0x404248, 0.35));

    this.geom = new TrackGeometry(line);
    this.routes = { A: new Route(line, this.geom, 'A'), B: new Route(line, this.geom, 'B') };
    const route = this.route = this.routes[direction];
    this.timetable = new Timetable(route, train, line.startTime);
    this.clock = this.timetable.start - 50;
    this.time = 0;

    this.player = new PlayerTrain(train, route, bus, this.settings);
    this.player.physics.s = route.stops[0].stopR;
    this.player.physics.payload = 180 * 70;
    this.stations = new StationManager(route, this.timetable, this.player, bus, this.settings);
    this.signals = new SignalSystem(route, line, bus);
    this.traffic = new TrafficManager({ line, routes: this.routes, specs: train, playerRoute: route, playerTimetable: this.timetable, startClock: this.clock, bus });

    this.world = new WorldBuilder(scene, line, this.geom, this.routes, this.settings.get('graphics.quality')).build();
    this.signalView = new SignalView(scene, this.signals, route, this.geom);
    this.playerModel = new TrainModel(train, line, route.terminus, { player: true });
    scene.add(this.playerModel.group);
    this.aiModels = new Map();

    this.cabin = new Cabin(train, this.actions(), bus);
    this.playerModel.cars[0].add(this.cabin.group);
    this.interaction.setTargets(this.cabin.interactive);
    this.headlight = new THREE.SpotLight(0xfff4dc, 60, 140, 0.42, 0.55, 1.2);
    this.headlight.position.set(0, 1.5, train.carLength / 2 + 0.3);
    this.headTarget = new THREE.Object3D(); this.headTarget.position.set(0, 0.8, train.carLength / 2 + 40);
    this.playerModel.cars[0].add(this.headlight, this.headTarget);
    this.headlight.target = this.headTarget;

    this.passengers = new PassengerSystem(scene, line, this.routes, route, bus);
    this.passengers.train = this.player;
    this.passengers.stationManager = this.stations;
    this.stations.boardingPending = (stp) => this.passengers.pending(stp);
    this.player.doors.obstructionCheck = () => this.passengers.isObstructing();

    this.announcer = new Announcer(this.audio, this.settings, line);
    this.scoring = new Scoring(bus, this.settings);
    this.cameraSys.setMode('cab');
    this.cameraSys.resetView();
    this.wireEvents();
    this.running = true;
    this.paused = false;
    this.result = null;
    this.bumpAcc = 0; this.bump = 0;
    this.applyGraphics();
    bus.emit('game:started', { line, train, direction });
    this.toast(`${line.fullName} · ${route.directionName}. Open the doors (${this.input.labelFor('doorsOpen')}) to board passengers.`, 'info', 7);
  }

  applyGraphics() {
    const q = this.settings.get('graphics.quality');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'low' ? 0.75 : q === 'medium' ? 1 : 1.5));
    const draw = this.settings.get('graphics.drawDistance');
    if (this.scene) { this.scene.fog.far = draw; this.camera.far = draw + 50; this.camera.updateProjectionMatrix(); }
  }

  actions() {
    const p = () => this.player;
    return {
      tractionUp: () => this.notch(+1),
      tractionDown: () => this.notch(-1),
      neutral: () => { if (!p().controller.isEB) p().controller.neutral(); },
      emergency: () => this.driverEmergency(),
      doorsOpen: (side) => this.openDoors(side),
      doorsClose: () => { if (p().doors.close()) this.toast('Doors closing — stand clear', 'info', 2); },
      horn: (on) => { p().horn = on; this.audio.horn(on); },
      announce: () => this.announceNext(true),
      vigilance: () => p().safety.acknowledgeVigilance(),
      headlights: () => { p().headlightsHigh = !p().headlightsHigh; this.audio.click(); },
      cabLight: () => { p().cabLight = !p().cabLight; this.audio.click(); },
    };
  }

  notch(dir) {
    const c = this.player.controller;
    this.player.safety.acknowledgeVigilance();
    if (dir > 0) {
      if (c.isEB) { c.set(-c.bNotches); return; }
      c.up();
    } else c.down();
  }
  driverEmergency() {
    if (this.player.controller.isEB) return;
    this.scoring.driverEmergency(Math.abs(this.player.speed) * 3.6);
    this.player.emergency('driver');
  }
  openDoors(side) {
    const al = this.stations.alignment();
    const s = side || (al.ok ? al.side : al.stop?.doorSide || 'right');
    const r = this.player.doors.open(s, { speed: this.player.speed, alignment: al });
    if (r.ok) this.audio.click();
  }

  announceNext(manual = false) {
    const k = this.stations.atStop ?? this.stations.nextStop;
    const stp = this.route.stops[k];
    if (!stp) return;
    if (manual && this.stations.atStop != null && !stp.isTerminus) {
      const nxt = this.route.stops[k + 1];
      this.announcer.announce(nxt, 'next');
      return;
    }
    this.announcer.announce(stp, stp.isTerminus && this.stations.atStop === k ? 'terminus' : 'next');
  }

  wireEvents() {
    const bus = this.bus, a = this.audio;
    const on = (t, f) => this.subs.push(bus.on(t, f));
    on('controller:notch', ({ position }) => {
      a.notch(position < 0);
      if (position >= 0 && this.lastNotch < -2) a.brakeRelease();
      this.lastNotch = position;
    });
    on('doors:opening', () => a.doorOpen());
    on('doors:warning', () => { a.doorChime(); if (this.line.announcements.doorsClosing && 'speechSynthesis' in window) { /* optional text handled by Announcer users */ } });
    on('doors:closing', () => a.doorClose());
    on('doors:locked', () => this.toast('Doors closed and locked', 'ok', 2));
    on('doors:obstructed', () => this.toast('Door obstructed — re-opening', 'warn', 2.5));
    on('doors:refused', ({ reason }) => { a.refuse(); this.toast(reason, 'warn', 3); });
    on('safety:emergency', ({ reason }) => { a.emergency(); this.toast(`${reason}. Stop, then move the controller to a brake notch to reset.`, 'alarm', 5); });
    on('safety:reset', () => this.toast('Emergency brake reset', 'ok', 2));
    on('safety:overspeed', ({ level }) => { if (level === 'warning') this.toast('Overspeed! Reduce speed.', 'warn', 2); });
    on('safety:vigilance', () => this.toast(`Vigilance — press ${this.input.labelFor('vigilance')}`, 'warn', 4));
    on('signal:passed', ({ signal, aspect }) => {
      if (aspect === 'red') {
        this.scoring.spad(signal);
        this.player.safety.trip(`SPAD — signal ${signal.number} passed at danger`);
      }
    });
    on('station:arrived', ({ stop, error, delay, tolerance }) => {
      if (stop.k === 0) return;
      const acc = Math.abs(error) <= tolerance ? 'Precise stop' : 'Stop';
      this.toast(`${stop.name} — ${acc} ${error >= 0 ? '+' : ''}${error.toFixed(2)} m · ${delay >= 0 ? '+' : ''}${Math.round(delay)} s`, Math.abs(error) <= tolerance ? 'ok' : 'info', 4);
      this.announcer.announce(stop, stop.isTerminus ? 'terminus' : 'arrival');
    });
    on('station:missed', ({ stop }) => this.toast(`Missed stop: ${stop.name}`, 'alarm', 4));
    on('station:departureAuthorized', () => { a.ding(); this.toast('Departure authorised — close the doors', 'ok', 3); });
    on('station:departed', ({ stop }) => {
      clearTimeout(this.annTimer);
      this.annTimer = setTimeout(() => { if (this.running) this.announcer.announce(this.route.stops[stop.k + 1], 'next'); }, 7000);
    });
    on('run:complete', () => setTimeout(() => this.finish(true), 2500));
  }

  toast(text, kind = 'info', dur = 3) { this.bus.emit('hud:toast', { text, kind, dur }); }

  finish(completed, reason) {
    if (this.result) return;
    const res = this.scoring.result(completed);
    this.result = {
      ...res, completed, reason,
      line: this.line, direction: this.direction, train: this.specs,
      distanceKm: this.player.physics.odometer / 1000,
      seconds: this.time,
      stationsServed: this.stations.served.filter((s) => !s.missed).length,
      finalDelay: this.stations.lastDelay,
    };
    this.bus.emit('game:finished', this.result);
  }

  /** Per-frame update. */
  update(dt) {
    if (!this.running) return;
    const actions = this.input.poll(dt);
    for (const a of actions) this.handleAction(a);
    if (this.paused || this.result) { this.render(); return; }
    dt = Math.min(dt, 0.1);
    this.acc = (this.acc || 0) + dt;
    while (this.acc >= STEP) { this.simStep(STEP); this.acc -= STEP; }
    this.updateVisuals(dt);
    this.render();
  }

  handleAction(a) {
    const A = this.actions();
    switch (a) {
      case 'pause': this.bus.emit('game:pauseToggle'); break;
      case 'tractionUp': A.tractionUp(); break;
      case 'tractionDown': A.tractionDown(); break;
      case 'neutral': A.neutral(); break;
      case 'emergencyBrake': A.emergency(); break;
      case 'doorsOpen': A.doorsOpen(); break;
      case 'doorsClose': A.doorsClose(); break;
      case 'camera': this.cameraSys.cycle(); break;
      case 'horn': A.horn(true); break;
      case 'vigilance': A.vigilance(); break;
      case 'announce': A.announce(); break;
      case 'headlights': A.headlights(); break;
      case 'cabLight': A.cabLight(); break;
      case 'toggleHud': this.settings.set('gameplay.showHud', !this.settings.get('gameplay.showHud')); break;
      case 'lookBack': this.cameraSys.resetView(); break;
      default: break;
    }
    if (a === 'horn') {
      const off = this.bus.on('input:release', (x) => { if (x === 'horn') { A.horn(false); off(); } });
    }
  }

  simStep(dt) {
    const p = this.player, sp = this.specs, route = this.route;
    const staticLimit = Math.min(route.permittedFor(p.front, sp.length), sp.maxSpeed);
    const atp = this.settings.get('gameplay.atp') || this.signals.system === 'cbtc';
    const auth = this.signals.authority;
    const authorityDist = atp && auth != null ? auth - p.front : null;
    p.update(dt, { staticLimit, authorityDist, brakeRate: this.line.signaling.atpBrakeRate });
    this.stations.update(dt, this.clock);
    this.traffic.step(dt, this.clock);
    const others = this.traffic.activeOn(route).map((t) => ({ front: t.front, rear: t.rear }));
    this.signals.update(others, { front: p.front, rear: p.rear });
    this.scoring.sample(dt, { jerk: p.physics.jerk, accel: p.physics.a, overspeed: p.safety.overspeed });
    this.clock += dt;
    this.time += dt;
    // Collisions: buffer stop or train ahead.
    const ahead = others.filter((o) => o.rear > p.front - 1).sort((x, y) => x.rear - y.rear)[0];
    if (p.front > route.length - 9 || (ahead && ahead.rear - p.front < 0.5)) {
      p.physics.v = 0;
      this.toast('COLLISION — the run is over.', 'alarm', 6);
      this.finish(false, p.front > route.length - 9 ? 'Collision with the buffer stop' : 'Collision with the train ahead');
    }
    // Camera bump at rail joints.
    this.bumpAcc += Math.abs(p.speed) * dt;
    if (this.bumpAcc > 18) { this.bumpAcc -= 18; this.bump = Math.min(0.012, Math.abs(p.speed) * 0.0007); }
    this.bump *= Math.exp(-dt * 25);
  }

  updateVisuals(dt) {
    const p = this.player, route = this.route;
    this.playerModel.setPose(route, p.front);
    this.playerModel.setDoors('left', p.doors.sides.left.amount);
    this.playerModel.setDoors('right', p.doors.sides.right.amount);
    this.playerModel.setLights('forward', p.headlightsHigh);
    this.headlight.intensity = p.headlightsHigh ? 80 : 30;
    this.playerModel.setCabExteriorVisible(this.cameraSys.mode !== 'cab');

    // AI train models.
    const seen = new Set();
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const draw = this.settings.get('graphics.drawDistance') + 100;
    for (const t of this.traffic.trains) {
      const active = t.mode !== 'done' && (t.mode !== 'waiting' || t.tt.start - this.clock < 90);
      if (!active) continue;
      const mid = t.route.point(t.front - t.specs.length / 2, 0, 0, {});
      if (Math.hypot(mid.x - camPos.x, mid.z - camPos.z) > draw + t.specs.length) continue;
      seen.add(t.id);
      let m = this.aiModels.get(t.id);
      if (!m) { m = new TrainModel(this.specs, this.line, t.route.terminus); this.scene.add(m.group); this.aiModels.set(t.id, m); }
      m.setPose(t.route, t.front);
      const side = t.route.stops[t.k]?.doorSide || 'right';
      m.setDoors(side, t.doorOpen);
    }
    for (const [id, m] of this.aiModels) if (!seen.has(id)) { m.dispose(this.scene); this.aiModels.delete(id); }

    this.signalView.update(this.time);
    this.world.update(route.toTrack(p.front - this.specs.length / 2), this.clock, (i, d) => this.etas(i, d), camPos);
    this.passengers.update(dt, p.front);
    const st = this.snapshot();
    this.state = st;
    this.cabin.update(dt, st, this.time);
    this.cameraSys.update({
      car0: this.playerModel.cars[0], eye: this.cabin.eye, route, front: p.front, v: p.speed, accel: p.physics.a,
      jerk: p.physics.jerk, geom: this.geom, world: this.world, dt, time: this.time, scene: this.scene, padLook: this.input.look, bump: this.bump,
    });
    const tr = route.toTrack(p.front);
    this.audio.update(dt, {
      v: p.speed, traction: p.physics.traction, brake: Math.max(p.physics.brake, p.physics.eb), radius: route.radiusAt(p.front),
      inStation: !!this.geom.stationZoneAt(tr), exterior: this.cameraSys.mode !== 'cab', carLength: this.specs.carLength,
      doorsOpen: p.doors.anyOpen, motorPitch: this.specs.sound?.motorPitch, inverter: this.specs.sound?.inverter,
    });
    this.audio.setAlarm(p.safety.overspeed !== 'none' ? 'atp' : p.safety.vigAlarm ? 'vigilance' : null);
    this.bus.emit('hud:update', st);
  }

  /** Estimated seconds until the next trains reach station `index` in direction `dir` (passenger displays). */
  etas(index, dir) {
    const route = this.routes[dir];
    const k = dir === 'A' ? index : this.line.stations.length - 1 - index;
    const out = [];
    for (const t of this.traffic.trains) {
      if (t.route !== route || t.mode === 'done' || t.k > k) continue;
      if (t.k === k && t.mode === 'dwell') { out.push(0); continue; }
      if (t.k === k && t.mode !== 'run' && t.mode !== 'waiting') continue;
      const e = t.tt.entry(k);
      if (e.arr != null) out.push(Math.max(t.k === k ? 5 : 30, e.arr - this.clock));
    }
    if (route === this.route) {
      const sm = this.stations;
      if (sm.atStop === k) out.push(0);
      else if (sm.atStop == null ? sm.nextStop <= k : sm.atStop < k) {
        const e = this.timetable.entry(k);
        out.push(Math.max(sm.nextStop === k ? Math.max(0, (this.route.stops[k].stopR - this.player.front) / Math.max(5, this.player.speed)) : 60, (e.arr ?? 0) + sm.lastDelay - this.clock));
      }
    }
    return out.sort((x, y) => x - y);
  }

  snapshot() {
    const p = this.player, s = p.safety, sm = this.stations, info = sm.info(this.clock);
    const ns = this.signals.nextSignal(p.front);
    const vk = Math.abs(p.speed) * 3.6;
    const nextLimit = this.route.nextLimitChange(p.front, s.staticLimit);
    let alarm = null;
    if (s.latched) alarm = { text: `EMERGENCY BRAKE · ${s.latchReason}`, color: '#ff4030' };
    else if (p.controller.isEB) alarm = { text: 'EMERGENCY BRAKE APPLIED', color: '#ff4030' };
    else if (s.overspeed !== 'none') alarm = { text: `OVERSPEED · permitted ${Math.round(s.permitted)} km/h`, color: '#ffb300' };
    else if (s.vigAlarm) alarm = { text: 'VIGILANCE · acknowledge now', color: '#ff7a00' };
    else if (info.standing && !p.doors.locked && info.dwell.authorized) alarm = { text: 'DEPARTURE AUTHORISED · close doors', color: '#3cff8a' };
    const doorsOpenSide = p.doors.openSide();
    return {
      line: this.line, directionName: this.route.directionName, terminus: this.route.terminus, trainName: this.specs.name,
      signalSystem: this.signals.system, atpEnabled: this.settings.get('gameplay.atp'),
      speed: vk, permitted: s.permitted, staticLimit: s.staticLimit, nextLimit, authority: s.authority,
      overspeed: s.overspeed,
      signal: ns && this.signals.system === 'fixed-block' ? { aspect: ns.signal.aspect === 'red' ? 'red' : ns.signal.aspectOthers, number: ns.signal.number, distance: ns.distance } : ns ? { aspect: ns.signal.aspectOthers, number: 'EOA', distance: s.authority?.distance ?? ns.distance } : null,
      stationName: info.stop.name, standing: info.standing, stopDistance: info.distance, doorSide: info.stop.doorSide,
      schedArr: info.schedArr, schedDep: info.schedDep, delay: info.delay,
      departure: info.standing && info.dwell.authorized, dwellOpened: info.dwell.opened,
      dwellRemaining: info.stop.dwell - info.dwell.elapsed, boardingDone: info.dwell.boardingDone,
      stopsRemaining: sm.atStop != null ? this.route.stops.length - 1 - sm.atStop : this.route.stops.length - sm.nextStop,
      stopTolerance: this.settings.get('gameplay.stopTolerance'),
      notch: p.controller.label(), notchPos: p.controller.position, notches: p.controller.all(),
      traction: p.physics.traction, brake: p.physics.brake, eb: p.physics.eb,
      ebActive: p.ebActive, holdBrake: p.holdBrake && Math.abs(p.speed) < 0.1, tractionCut: p.tractionCut,
      wheelSlip: p.physics.wheelSlip, vigAlarm: s.vigAlarm, vigEnabled: this.settings.get('gameplay.vigilance'),
      doorsLocked: p.doors.locked, doorsStatus: p.doors.status, doorsOpenSide,
      horn: p.horn, headlightsHigh: p.headlightsHigh, cabLight: p.cabLight,
      clock: this.clock, odometerKm: p.physics.odometer / 1000,
      loadPct: Math.round(Math.min(100, (this.passengers.onboard / this.specs.capacity) * 100)),
      gradient: this.route.gradientAt(p.front - this.specs.length / 2),
      accel: p.physics.a, alarm, cameraMode: this.cameraSys.mode,
      score: this.scoring.result(true).score,
    };
  }

  render() { if (this.scene) this.renderer.render(this.scene, this.camera); }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  setPaused(p) { this.paused = p; if (p) this.audio.suspend(); else this.audio.resume(); this.input.enabled = !p; }

  dispose() {
    if (!this.scene) return;
    clearTimeout(this.annTimer);
    this.running = false;
    this.subs.forEach((f) => f()); this.subs = [];
    this.scoring?.dispose();
    this.announcer?.stop();
    this.audio.setAlarm(null); this.audio.horn(false);
    if (this.camera.parent) this.camera.parent.remove(this.camera);
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.interaction.setTargets([]);
    this.scene = null;
  }
}
