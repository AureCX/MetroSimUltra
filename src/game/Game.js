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
import { CrashCinematic } from './CrashCinematic.js';
import { setMaxAnisotropy } from '../world/Textures.js';
import { buildLineMapModel, drawLineMap, trainMapState } from '../ui/LineMap.js';

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
  start({ line, train, direction, services, network }) {
    this.dispose();
    const bus = this.bus;
    this.line = line; this.specs = train; this.direction = direction;
    this.planned = line; // destination chosen in the menu
    const scene = this.scene = new THREE.Scene();
    const draw = this.settings.get('graphics.drawDistance');
    scene.background = new THREE.Color(0x040507);
    scene.fog = new THREE.Fog(0x050608, 25, draw);
    this.camera.far = draw + 50;
    this.hemi = new THREE.HemisphereLight(0x8a8f99, 0x2a241c, 0.55);
    this.ambient = new THREE.AmbientLight(0x404248, 0.35);
    scene.add(this.hemi, this.ambient);

    // Every service of the line (several for a branching line) is part of the same world.
    this.svc = new Map();
    for (const l of services && services.length > 1 ? services : [line]) {
      const g = new TrackGeometry(l);
      this.svc.set(l.id, { line: l, geom: g, routes: { A: new Route(l, g, 'A'), B: new Route(l, g, 'B') }, tt: {} });
    }
    const main = this.svc.get(line.id);
    this.geom = main.geom;
    this.routes = main.routes;
    this.junction = this.svc.size > 1 ? this.findJunction(main) : null;
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

    const q = this.settings.get('graphics.quality');
    const J = this.junction;
    this.world = new WorldBuilder(scene, line, this.geom, this.routes, q, { junction: J && { divergeS: J.divergeS, wallS: J.wallS, inner: J.innerMain } }).build();
    this.worlds = new Map([[line.id, this.world]]);
    for (const [id, d] of this.svc) {
      if (id === line.id) continue;
      this.worlds.set(id, new WorldBuilder(scene, d.line, d.geom, d.routes, q, {
        fromS: J.divergeS, firstStation: J.index + 1, junction: { divergeS: J.divergeS, wallS: J.wallS, inner: -J.innerMain },
        lightPool: this.world.lights, tunnelPool: this.world.tunnelLights, offset: true, fallback: this.world,
      }).build());
    }
    this.mainWorld = this.world;
    this.buildDaylight();
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
    if (J && direction === 'A') this.buildRouteIndicator();
    this.mapModel = buildLineMapModel(line, [...this.svc.values()].map((d) => d.line), network || [], direction);
    this.mapAcc = 1;
    this.toast(`${line.fullName} · ${route.directionName}. Open the doors (${this.input.labelFor('doorsOpen')}) to board passengers.`, 'info', 7);
  }

  /** Sky dome, sun and haze for lines with open-air sections. */
  buildDaylight() {
    this.daylight = null;
    if (![...this.svc.values()].some((d) => d.geom.portals.length)) return;
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#2f6bc4'); grd.addColorStop(0.3, '#5f97de'); grd.addColorStop(0.46, '#a9c8ea'); grd.addColorStop(0.5, '#c6d8ea'); grd.addColorStop(0.52, '#8f9a80'); grd.addColorStop(1, '#6f7d64');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.frustumCulled = false;
    const sunTex = (() => {
      const cc = document.createElement('canvas'); cc.width = cc.height = 128;
      const gg = cc.getContext('2d'); const r = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.12, 'rgba(255,250,220,1)'); r.addColorStop(0.3, 'rgba(255,230,170,0.35)'); r.addColorStop(1, 'rgba(255,230,170,0)');
      gg.fillStyle = r; gg.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(cc);
    })();
    const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    sunDisc.renderOrder = -9; sunDisc.frustumCulled = false;
    const sun = new THREE.DirectionalLight(0xfff1dc, 0);
    this.scene.add(sky, sunDisc, sun, sun.target);
    this.daylight = { sky, sun, sunDisc, dir: new THREE.Vector3(0.45, 0.62, -0.64).normalize(), o: this.geom.outdoorAt(this.route.toTrack(this.player.front)) ? 1 : 0 };
  }

  updateDaylight(dt, camPos) {
    const d = this.daylight; if (!d) return;
    const front = this.player.front;
    const tr = this.route.toTrack(this.cameraSys.mode === 'cab' ? front : front - 10);
    const target = this.geom.outdoorAt(tr) ? 1 : 0;
    d.o += (target - d.o) * Math.min(1, dt * 1.3); // eyes adapting to daylight / tunnel darkness
    const o = d.o;
    this.scene.fog.color.setRGB(0.02 + 0.76 * o, 0.024 + 0.83 * o, 0.03 + 0.9 * o);
    this.scene.background.copy(this.scene.fog.color);
    const draw = this.settings.get('graphics.drawDistance');
    this.scene.fog.near = 25 + o * 600;
    this.scene.fog.far = draw * (1 - o) + o * 2400;
    this.hemi.intensity = 0.55 + 0.6 * o;
    this.hemi.color.setRGB(0.54 + 0.3 * o, 0.56 + 0.32 * o, 0.6 + 0.35 * o);
    this.ambient.intensity = 0.35 + 0.25 * o;
    d.sun.intensity = 2.1 * o;
    const far = Math.round((draw + 50) * (1 - o) + o * 2600);
    if (Math.abs(this.camera.far - far) > 5) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    d.sun.position.copy(camPos).addScaledVector(d.dir, 200);
    d.sun.target.position.copy(camPos);
    const R = this.camera.far * 0.85;
    d.sky.visible = d.sunDisc.visible = o > 0.01;
    d.sky.position.copy(camPos); d.sky.scale.setScalar(R);
    d.sunDisc.position.copy(camPos).addScaledVector(d.dir, R * 0.8); d.sunDisc.scale.setScalar(R * 0.16);
  }

  /** Locates where the branches part (first chainage where the alignments differ) and where their tunnels separate. */
  findJunction(main) {
    const others = [...this.svc.values()].filter((d) => d !== main);
    const o = others[0];
    const index = main.line.trunkLength - 1;
    const pm = {}, po = {};
    let divergeS = null, wallS = null;
    for (let s = main.geom.stationS[index]; s < Math.min(main.geom.length, o.geom.length); s += 0.5) {
      main.geom.point(s, 0, 0, pm); o.geom.point(s, 0, 0, po);
      const sep = Math.hypot(pm.x - po.x, pm.z - po.z);
      if (divergeS == null && sep > 0.03) divergeS = s;
      if (divergeS != null && sep >= main.geom.tunnelHalfWidthAt(s) + o.geom.tunnelHalfWidthAt(s)) { wallS = s; break; }
    }
    if (divergeS == null) return null;
    wallS ??= divergeS + 150;
    const s = divergeS + 40, h = main.geom.heading(s);
    main.geom.point(s, 0, 0, pm); o.geom.point(s, 0, 0, po);
    const innerMain = Math.sign((po.x - pm.x) * Math.cos(h) + (po.z - pm.z) * Math.sin(h)) || 1;
    const sideOf = (d) => (d === main ? (innerMain > 0 ? 'left' : 'right') : innerMain > 0 ? 'right' : 'left');
    const options = [...this.svc.values()].map((d) => ({ id: d.line.id, name: d.line.service, side: sideOf(d) }))
      .sort((a, b) => (a.side === 'left' ? -1 : 1) - (b.side === 'left' ? -1 : 1));
    const diverging = this.direction === 'A';
    return { index, divergeS, wallS, innerMain, options, set: diverging ? null : main.line.id, passed: !diverging, warned: false };
  }

  /** Lineside route indicator at the junction, showing the branch the points are set for. */
  buildRouteIndicator() {
    const J = this.junction, route = this.routes.A;
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    this.routeIndicator = { c, tex: new THREE.CanvasTexture(c) };
    this.routeIndicator.tex.colorSpace = THREE.SRGBColorSpace;
    const r = J.divergeS - 35;
    const p = route.point(r, 1.75, 3.0);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = -this.geom.heading(r);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.56, 0.12), new THREE.MeshLambertMaterial({ color: 0x111111 })));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.46), new THREE.MeshBasicMaterial({ map: this.routeIndicator.tex }));
    face.position.z = 0.065;
    g.add(face);
    this.scene.add(g);
    this.drawRouteIndicator();
  }
  drawRouteIndicator() {
    const ri = this.routeIndicator; if (!ri) return;
    const g = ri.c.getContext('2d'), J = this.junction;
    g.fillStyle = '#050505'; g.fillRect(0, 0, 256, 128);
    const opt = J.options.find((o) => o.id === J.set);
    if (opt && !(this.direction === 'B')) {
      g.fillStyle = '#ffffff'; g.font = 'bold 72px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(opt.side === 'left' ? '◀' : '▶', 52, 66);
      g.font = 'bold 30px Arial';
      const words = opt.name.split(/\s+/);
      g.fillText(words[0].toUpperCase().slice(0, 9), 160, words.length > 1 ? 46 : 66);
      if (words.length > 1) g.fillText(words.slice(1).join(' ').replace(/^[–-]\s*/, '').toUpperCase().slice(0, 9), 160, 88);
    }
    ri.tex.needsUpdate = true;
  }

  selectRoute() {
    const J = this.junction;
    if (!J || this.direction !== 'A') { this.toast('No junction to set on this route.', 'info', 2); return; }
    if (J.passed) { this.toast('The junction is already behind the train.', 'info', 2); return; }
    if (J.divergeS - this.player.front < 60) { this.toast('Points locked: the train is too close to the junction.', 'warn', 2.5); this.audio.refuse(); return; }
    const i = J.options.findIndex((o) => o.id === J.set);
    J.set = J.options[(i + 1) % J.options.length].id;
    const opt = J.options.find((o) => o.id === J.set);
    this.audio.click();
    this.drawRouteIndicator();
    const ok = J.set === this.planned.id;
    this.toast(`Route set: ${opt.side === 'left' ? '◀' : '▶'} ${opt.name}${ok ? '' : ` — this train is for ${this.planned.service}!`}`, ok ? 'ok' : 'warn', 3);
  }

  /** Called when the train runs over the points. */
  passJunction() {
    const J = this.junction;
    J.passed = true;
    const taken = J.set ?? J.options[0].id;
    this.signals.hold = null;
    if (taken === this.line.id) { this.toast(`Junction: correct route towards ${this.line.service}.`, 'ok', 3); return; }
    const to = this.svc.get(taken).line;
    this.scoring.penalty(250, `Wrong route at the junction: train diverted towards ${to.service}`);
    this.toast(`Wrong route! The train is diverted towards ${to.service}.`, 'alarm', 6);
    this.divert(taken);
  }

  /** Re-attaches every route-dependent system to another service (same chainage on the shared trunk). */
  divert(id) {
    const d = this.svc.get(id), p = this.player, old = this.stations;
    this.line = d.line; this.geom = d.geom; this.routes = d.routes;
    const route = this.route = d.routes[this.direction];
    p.route = route; p.physics.route = route;
    this.timetable = new Timetable(route, this.specs, d.line.startTime);
    this.stations = new StationManager(route, this.timetable, p, this.bus, this.settings);
    Object.assign(this.stations, { atStop: null, nextStop: old.nextStop, lastDelay: old.lastDelay, served: old.served, boardingPending: old.boardingPending });
    this.passengers.route = route; this.passengers.routes = d.routes; this.passengers.line = d.line; this.passengers.stationManager = this.stations;
    for (const k of [...this.passengers.crowds.keys()]) this.passengers.removeCrowd(k);
    this.signalView.dispose();
    this.signals = new SignalSystem(route, d.line, this.bus);
    this.signals.lastFront = p.front;
    this.signalView = new SignalView(this.scene, this.signals, route, this.geom);
    for (const m of this.aiModels.values()) m.dispose(this.scene);
    this.aiModels.clear();
    this.traffic = new TrafficManager({ line: d.line, routes: d.routes, specs: this.specs, playerRoute: route, playerTimetable: this.timetable, startClock: this.clock, bus: this.bus });
    this.world = this.worlds.get(id);
    this.playerModel.setDestination(d.line, route.terminus);
    this.announcer.line = d.line;
  }

  /** Scheduled arrivals for a station of a service the player is not on (passenger displays). */
  etasScheduled(d, index, dir) {
    const route = d.routes[dir];
    const tt = d.tt[dir] ??= new Timetable(route, this.specs, d.line.startTime);
    const k = dir === 'A' ? index : d.line.stations.length - 1 - index;
    const e = tt.entry(k);
    const base = e.arr ?? e.dep, h = d.line.headway;
    const n = Math.ceil((this.clock - base) / h);
    return [0, 1].map((i) => base + (n + i) * h - this.clock).filter((x) => x >= 0);
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
      routeSelect: () => this.selectRoute(),
      lineMap: () => this.bus.emit('ui:lineMap'),
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
    if (!completed) this.player.physics.v = 0;
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

  /** Shows/hides surface sites built above underground stations (e.g. the airport). */
  showSurfaceSites(on = true) {
    for (const w of this.worlds.values()) for (const s of w.outdoor?.sites || []) s.group.visible = on;
  }

  startCrash(impact) {
    if (this.crash) return;
    this.crash = new CrashCinematic(this, impact);
    document.body.classList.add('cinematic');
  }

  /** Per-frame update. */
  update(dt) {
    if (!this.running) return;
    if (this.crash) {
      const acts = this.input.poll(dt);
      if (acts.length && this.crash.t > 0.6) this.crash.skip();
      this.crash.update(Math.min(dt, 0.05));
      this.render();
      return;
    }
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
      case 'routeSelect': A.routeSelect(); break;
      case 'lineMap': A.lineMap(); break;
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
    const J = this.junction;
    if (J && !J.passed) {
      this.signals.hold = J.set ? null : J.divergeS - 20;
      if (!J.warned && J.divergeS - p.front < 900) {
        J.warned = true;
        this.toast(`Junction ahead: set the route for ${this.planned.service} (${this.input.labelFor('routeSelect')} or the ROUTE button).`, J.set ? 'info' : 'warn', 6);
      }
      if (p.front >= J.divergeS) this.passJunction();
    }
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
    const aheadT = this.traffic.activeOn(route).filter((o) => o.rear > p.front - 1).sort((x, y) => x.rear - y.rear)[0];
    const hitBuffer = p.front > route.length - 9;
    const hitTrain = aheadT && aheadT.rear - p.front < 0.5;
    if (hitBuffer || hitTrain) {
      const v = Math.abs(p.speed);
      p.physics.s = hitBuffer ? route.length - 9 : aheadT.rear - 0.5;
      p.physics.v = 0;
      if (v < 1.7) {
        // A gentle contact is absorbed by the buffers/couplers: penalised, but the run continues.
        if (!this.bumped) { this.bumped = true; this.scoring.penalty(120, hitBuffer ? 'Buffer stop struck at low speed' : 'Train ahead struck at low speed'); this.toast(`Impact at ${Math.round(v * 3.6)} km/h — ${hitBuffer ? 'buffer stop' : 'train ahead'} struck.`, 'alarm', 4); this.audio.thunk(0, 0.5); }
      } else this.startCrash({
        speed: v, front: p.physics.s, type: hitBuffer ? 'buffer' : 'train',
        aiModel: hitTrain ? this.aiModels.get(aheadT.id) : null,
        aiTrain: hitTrain ? aheadT : null,
        reason: hitBuffer ? `Collision with the buffer stop at ${Math.round(v * 3.6)} km/h` : `Collision with the train ahead at ${Math.round(v * 3.6)} km/h`,
        description: hitBuffer ? `${Math.round(v * 3.6)} km/h into the buffer stop beyond ${route.terminus}` : `${Math.round(v * 3.6)} km/h into the rear of the train ahead`,
      });
    } else this.bumped = false;
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
    this.updateDaylight(dt, camPos);
    for (const w of this.worlds.values()) w.outdoor?.update(dt, this.time, this.clock, camPos);
    const trackS = route.toTrack(p.front - this.specs.length / 2);
    for (const [id, w] of this.worlds) {
      const d = this.svc.get(id);
      w.update(trackS, this.clock, (i, dir) => (d.line === this.line ? this.etas(i, dir) : this.etasScheduled(d, i, dir)), camPos);
    }
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
      doorsOpen: p.doors.anyOpen, outdoor: (this.daylight?.o ?? 0) > 0.5, motorPitch: this.specs.sound?.motorPitch, inverter: this.specs.sound?.inverter,
    });
    this.audio.setAlarm(p.safety.overspeed !== 'none' ? 'atp' : p.safety.vigAlarm ? 'vigilance' : null);
    this.bus.emit('hud:update', st);
    // Line map: cab panel and (if open) the full-size overlay, twice per second.
    this.mapAcc += dt;
    if (this.mapAcc > 0.5) {
      this.mapAcc = 0;
      const ms = { ...trainMapState(route, p.front, this.stations), activeId: this.line.id, plannedId: this.planned.id, directionName: route.directionName };
      const lm = this.cabin.lineMap;
      drawLineMap(lm.c.getContext('2d'), lm.c.width, lm.c.height, this.mapModel, ms);
      lm.tex.needsUpdate = true;
      if (this.mapTarget) drawLineMap(this.mapTarget.getContext('2d'), this.mapTarget.width, this.mapTarget.height, this.mapModel, ms);
    }
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
    const J = this.junction;
    if (s.latched) alarm = { text: `EMERGENCY BRAKE · ${s.latchReason}`, color: '#ff4030' };
    else if (p.controller.isEB) alarm = { text: 'EMERGENCY BRAKE APPLIED', color: '#ff4030' };
    else if (s.overspeed !== 'none') alarm = { text: `OVERSPEED · permitted ${Math.round(s.permitted)} km/h`, color: '#ffb300' };
    else if (s.vigAlarm) alarm = { text: 'VIGILANCE · acknowledge now', color: '#ff7a00' };
    else if (J && !J.passed && !J.set && J.divergeS - p.front < 500) alarm = { text: `SET ROUTE FOR ${this.planned.service.toUpperCase()} · press ${this.input.labelFor('routeSelect')}`, color: '#ffb300' };
    else if (info.standing && !p.doors.locked && info.dwell.authorized) alarm = { text: 'DEPARTURE AUTHORISED · close doors', color: '#3cff8a' };
    const doorsOpenSide = p.doors.openSide();
    const jo = J && J.options.find((o) => o.id === J.set);
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
      junction: J && !J.passed ? { distance: J.divergeS - p.front, set: jo ? jo.name : null, side: jo?.side, ok: J.set === this.planned.id, destination: this.planned.service } : null,
      destination: this.route.terminus,
    };
  }

  render() { if (this.scene) this.renderer.render(this.scene, this.camera); }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  setPaused(p) { this.paused = p; if (p) this.audio.suspend(); else this.audio.resume(); this.input.enabled = !p; }

  dispose() {
    if (!this.scene) return;
    clearTimeout(this.annTimer);
    this.running = false;
    this.crash?.dispose(); this.crash = null;
    document.body.classList.remove('cinematic');
    this.subs.forEach((f) => f()); this.subs = [];
    this.scoring?.dispose();
    this.announcer?.stop();
    this.audio.setAlarm(null); this.audio.horn(false);
    if (this.camera.parent) this.camera.parent.remove(this.camera);
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.routeIndicator = null;
    this.interaction.setTargets([]);
    this.scene = null;
  }
}
