// A bus driving session: builds the world from a network file, places the bus in the depot and
// wires vehicle, cockpit, traffic, passengers, route runner, weather, audio, scoring and
// rule enforcement together. Independent from the metro Game (shares only core services).
import * as THREE from 'three';
import { RoadNetwork, pathAt } from './RoadNetwork.js';
import { BusWorld } from './BusWorld.js';
import { BusVehicle } from './BusVehicle.js';
import { BusModel } from './BusModel.js';
import { BusCockpit } from './BusCockpit.js';
import { Traffic, trafficDensity } from './Traffic.js';
import { BusPassengers } from './BusPassengers.js';
import { RouteRunner } from './RouteRunner.js';
import { BusScoring } from './BusScoring.js';
import { Weather } from './Weather.js';
import { BusAudio } from './BusAudio.js';
import { CabInteraction } from '../cabin/Cabin.js';
import { AssetStore } from '../core/AssetStore.js';
import { resolveImpact, contactPoint, obstacle } from './Crash.js';
import { clamp, formatClock } from '../core/util.js';

const STEP = 1 / 60;
const CAMS = ['cab', 'chase', 'passenger', 'top'];

// ---- 2D collision helpers (separating axis theorem on convex quads) ----
function axes(p) { const out = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; const nx = -(b.z - a.z), nz = b.x - a.x, L = Math.hypot(nx, nz) || 1; out.push({ x: nx / L, z: nz / L }); } return out; }
function proj(p, ax) { let mn = Infinity, mx = -Infinity; for (const q of p) { const d = q.x * ax.x + q.z * ax.z; if (d < mn) mn = d; if (d > mx) mx = d; } return [mn, mx]; }
export function sat(A, B) {
  let best = null;
  for (const ax of [...axes(A), ...axes(B)]) {
    const [a0, a1] = proj(A, ax), [b0, b1] = proj(B, ax);
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return null;
    if (!best || o < best.depth) best = { depth: o, ax };
  }
  const ca = A.reduce((s, q) => ({ x: s.x + q.x / A.length, z: s.z + q.z / A.length }), { x: 0, z: 0 });
  const cb = B.reduce((s, q) => ({ x: s.x + q.x / B.length, z: s.z + q.z / B.length }), { x: 0, z: 0 });
  if ((ca.x - cb.x) * best.ax.x + (ca.z - cb.z) * best.ax.z < 0) best.ax = { x: -best.ax.x, z: -best.ax.z };
  return best; // ax points from B towards A
}
const rectPoly = (c) => [{ x: c.x0, z: c.z0 }, { x: c.x1, z: c.z0 }, { x: c.x1, z: c.z1 }, { x: c.x0, z: c.z1 }];

export class BusGame {
  constructor({ renderer, bus, settings, input, audio, save }) {
    Object.assign(this, { renderer, bus, settings, input, audio, save });
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2500);
    this.interaction = new CabInteraction(renderer.domElement, () => this.camera, bus);
    this.interaction.enabled = false;
    this.running = false; this.paused = false;
    this.look = { yaw: 0, pitch: -0.2, drag: false };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { if (this.running && (e.button === 2 || e.button === 1)) { this.look.drag = true; this.look.last = [e.clientX, e.clientY]; } });
    window.addEventListener('pointerup', (e) => { if (e.button === 2 || e.button === 1) this.look.drag = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.look.drag || !this.running) return;
      const s = 0.004 * this.settings.get('gameplay.mouseSensitivity'), inv = this.settings.get('gameplay.invertY') ? -1 : 1;
      this.look.yaw = clamp(this.look.yaw - (e.clientX - this.look.last[0]) * s, -2.8, 2.8);
      this.look.pitch = clamp(this.look.pitch - (e.clientY - this.look.last[1]) * s * inv, -1.2, 0.9);
      this.look.last = [e.clientX, e.clientY];
    });
    dom.addEventListener('wheel', (e) => { if (this.running && this.camMode !== 'cab') this.chaseDist = clamp((this.chaseDist || 22) * (e.deltaY > 0 ? 1.1 : 0.9), 8, 90); }, { passive: true });
  }

  start(cfg) {
    this.dispose();
    const { netData, route, dir, spec, mode, hour, day, weather, dynamicWeather } = cfg;
    this.cfg = cfg; this.mode = mode; this.spec = spec; this.route = route; this.day = day;
    const scene = this.scene = new THREE.Scene();
    this.net = new RoadNetwork(netData);
    this.world = new BusWorld(scene, this.net).build();
    this.weather = new Weather(scene, this.renderer, { hour, weather, dynamic: dynamicWeather });
    this.weather.snowMats = [this.world.mat.grass, this.world.mat.walk, this.world.mat.roofGrey, this.world.mat.roofTile].map((m) => { m.userData.base = m.color.clone(); return m; });
    // Vehicle at the depot.
    // The player's own bus (economy fleet): condition, energy, body damage carry over between shifts.
    this.owned = this.economy?.vehicle(cfg.vehicleUid) || null;
    const fleet = this.owned || this.save.data.bus?.fleet?.[spec.id] || {};
    this.v = new BusVehicle(spec, this.bus, fleet);
    this.energyStart = this.v.energy; this.energyBought = 0;
    const dp = this.net.data.depot;
    this.v.ph.x = dp.start.x; this.v.ph.z = dp.start.z; this.v.ph.yaw = (dp.start.heading * Math.PI) / 180; this.v.ph.trailerYaw = this.v.ph.yaw;
    this.model = new BusModel(spec); scene.add(this.model.group);
    this.cockpit = new BusCockpit(this.model, this.v, this.actions());
    this.interaction.setTargets(this.cockpit.interactive); this.interaction.enabled = true;
    // Headlights.
    this.head = new THREE.SpotLight(0xfff4dc, 0, 90, 0.5, 0.5, 1.2); this.head.position.set(0, 1, this.model.zFront - 0.2);
    this.headT = new THREE.Object3D(); this.headT.position.set(0, 0, this.model.zFront - 30); this.model.body.add(this.head, this.headT); this.head.target = this.headT;
    this.cabLight = new THREE.PointLight(0xfff2dd, 0, 9, 1.6); this.cabLight.position.set(0, 2.4, this.model.zFront + 4); this.model.body.add(this.cabLight);
    // Service.
    const clock = hour * 3600;
    this.runner = new RouteRunner({ net: this.net, world: this.world, route, dir, mode, startClock: clock, bus: this.bus });
    this.runner.start(this.posInfo());
    if (route) this.model.setDestination(route.route, this.runner.destination, route.color);
    else this.model.setDestination('', 'DÉPÔT / HORS SERVICE');
    this.traffic = new Traffic(scene, this.net, this.world, this.bus);
    this.passengers = new BusPassengers(scene, this.v, this.model, this.runner, this.bus);
    // Online: announce the bus; other players' buses are drawn and collide physically.
    this.remoteBuses = new Map();
    // Other players' buses at the depot start: take the next parking bay.
    const near = this.remoteBusBoxes().filter((b) => Math.hypot(b.cx - this.v.ph.x, b.cz - this.v.ph.z) < 12).length;
    if (near) this.v.ph.x -= near * 5.5;
    this.mp?.startDriving({ kind: 'bus', model: spec.id, uid: cfg.vehicleUid || '', route: route?.route || '', length: spec.length + (spec.trailerLength ? spec.trailerLength - 1.5 : 0), width: spec.width, maxSpeed: spec.maxSpeed || 90 });
    this.passengers.heightAt = this.net.heightAt;
    this.model.heightAt = this.net.heightAt;
    this.scoring = new BusScoring(this.bus);
    this.busAudio = new BusAudio(this.audio); this.busAudio.start(this.v.electric);
    this.camMode = 'cab'; this.chaseDist = 22; this.look.yaw = 0; this.look.pitch = -0.2;
    this.controls = { throttle: 0, brake: 0, wheelTarget: 0, steerDrag: false };
    this.time = 0; this.frame = 0; this.result = null; this.service = null;
    this.subs = []; this.prevLine = new Map(); this.junction = null; this.lastInd = { left: -99, right: -99 };
    this.toastQ = [];
    this.wire();
    this.running = true; this.paused = false;
    this.toast(route ? `Shift: ${route.route} ${route.name}. Start the engine (${this.input.labelFor('engine')}), release the parking brake (${this.input.labelFor('parking')}), select D (${this.input.labelFor('gearD')}) and drive to the first stop.` : 'Free drive: start the engine, release the parking brake and select D.', 'info', 9);
  }

  posInfo() { const ph = this.v.ph, h = ph.heading(); return { x: ph.x + h.fx * 4, z: ph.z + h.fz * 4, fx: h.fx, fz: h.fz }; }
  toast(text, kind = 'info', dur = 3) { this.bus.emit('hud:toast', { text, kind, dur }); }

  actions() {
    const v = () => this.v, c = () => this.controls;
    return {
      click: () => this.audio.click(),
      engine: () => v().toggleEngine(),
      gear: (g) => v().setGear(g),
      parking: () => v().toggleParking(),
      door: (i) => v().toggleDoor(i),
      closeAll: () => v().allDoors(false),
      kneel: () => v().toggleKneel(),
      hazards: () => v().toggleHazards(),
      lights: () => v().cycleLights(),
      wipers: () => v().cycleWipers(),
      interior: () => { v().interiorLights = !v().interiorLights; },
      mirror: (i, d) => { v().mirrorYaw[i] = clamp(v().mirrorYaw[i] + d * 0.05, -0.25, 0.35); },
      indicator: (s) => { v().setIndicator(s); },
      emergency: () => v().toggleEmergency(),
      ramp: () => v().toggleRamp(),
      retarder: () => { v().cycleRetarder(); this.toast(`Retarder ${['off', '1', '2', '3'][v().retarder]}`, 'info', 1.5); },
      climate: () => { v().climate = !v().climate; this.toast(v().climate ? 'Climate on' : 'Climate off', 'info', 1.5); },
      stopReset: () => { v().stopRequest = false; },
      ticket: () => {
        const ok = this.passengers?.sellTicket();
        if (ok) { this.audio.click(); this.busAudio.validate?.(true, 'ok'); this.cockpit?.printTicket(); this.toast(`Ticket sold — ${this.passengers.ticketPrice.toFixed(2).replace('.', ',')} €`, 'ok', 2); }
        else this.toast('Nobody is waiting to buy a ticket', 'info', 2);
      },
      announce: () => { const r = this.runner, k = r.atStopIdx ?? r.nextIdx ?? null; const st = r.stops?.[k ?? 0]; if (st) this.announce(st, 'next'); },
      horn: (on) => { v().horn = on; },
      steerDrag: (dx) => { c().steerDrag = true; c().wheelTarget = clamp(c().wheelTarget + dx * 0.035, -16, 16); },
      steerRelease: () => { c().steerDrag = false; },
    };
  }

  wire() {
    const on = (t, f) => this.subs.push(this.bus.on(t, f));
    const A = this.busAudio;
    on('bus:crank', (e) => A.crank(e)); on('bus:engine', (e) => this.toast(e ? 'Engine running' : 'Engine stopped', 'info', 2));
    on('bus:refused', (r) => { this.audio.refuse(); this.toast(r, 'warn', 3); });
    on('bus:doorOpen', () => A.door(true)); on('bus:doorClose', () => { A.doorWarning(); setTimeout(() => A.door(false), 600); });
    on('bus:cashLeftBehind', () => this.scoring.add(30, 'Closed the doors on a passenger buying a ticket'));
    on('bus:cashFare', () => this.toast(`A passenger wants to buy a ticket — press ${this.input.labelFor('ticket')} or the TICKET machine`, 'warn', 5));
    on('bus:ramp', (d) => this.toast(d ? 'Ramp deployed — the bus is immobilised' : 'Ramp stowed', 'info', 2.5));
    on('bus:gear', (g) => { if (g === 'D' || g === 'R') this.toast(`Gear ${g}`, 'info', 1.2); });
    on('bus:tick', (b) => A.tick(b)); on('bus:parking', (p) => A.parking(p)); on('bus:kneel', () => A.kneel()); on('bus:shift', () => A.shift());
    on('bus:validate', (p) => A.validate(true, p)); on('bus:stopRequest', () => { A.stopRequest(); this.toast('Stop requested (ARRÊT DEMANDÉ)', 'info', 3); });
    on('bus:doorWhileMoving', () => { this.audio.refuse(); this.toast('Doors cannot open while moving', 'warn', 3); });
    on('bus:penalty', ({ points, text }) => this.toast(`${text} (−${points})`, 'warn', 3));
    on('bus:indicator', (s) => { if (s === 'left' || s === 'right') this.lastInd[s] = this.time; });
    on('bus:arrived', ({ stop, error }) => { this.toast(`${stop.stop.name} — stopped ${error >= 0 ? '+' : ''}${error.toFixed(1)} m from the pole`, Math.abs(error) < 1.5 ? 'ok' : 'info', 3); });
    on('bus:departed', ({ k, served }) => {
      if (served && this.time - this.lastInd.left > 6 && this.v.indicator !== 'left') this.scoring.add(25, 'No indicator when leaving the stop');
      this.v.stopRequest = false;
      const nxt = this.runner.stops[k + 1];
      if (nxt) setTimeout(() => this.running && this.announce(nxt, 'next'), 2500);
    });
    on('bus:doorOpened', (i) => { if (i === 0 && this.runner.atStopIdx != null) { this.v.stopRequest = false; this.announce(this.runner.stops[this.runner.atStopIdx], 'outside'); } });
    on('bus:missedStop', ({ stop }) => this.toast(`Missed stop: ${stop.stop.name}`, 'alarm', 4));
    on('bus:skippedStop', ({ stop }) => this.toast(`${stop.stop.name}: nobody waiting, no stop request — passed`, 'info', 3));
    on('bus:reroute', () => this.toast('Off route — recalculating', 'warn', 2.5));
    on('bus:routeComplete', () => this.toast(this.mode === 'career' || this.mode === 'timetable' ? 'Route complete — return to the depot and apply the parking brake' : 'Route complete', 'ok', 6));
    on('bus:shiftComplete', () => this.finish(true));
    on('bus:arrived', ({ stop }) => this.mp?.event({ e: 'arrived', where: stop.stop.name }));
    on('bus:departed', ({ k }) => { this.mp?.event({ e: 'departed', where: this.runner.stops[k]?.stop.name || '' }); const n = this.passengers.validations - (this.mpCarried || 0); this.mpCarried = this.passengers.validations; if (n > 0) this.mp?.event({ e: 'passengers', n }); });
    on('bus:collision', ({ what, severity }) => this.mp?.event({ e: 'collision', what: `${what}, ${severity}` }));
    on('bus:finished', (r) => this.mp?.event({ e: 'finished', km: r.distanceKm, grade: r.grade }));
    on('mp:correction', (m) => { if (m.x != null) { Object.assign(this.v.ph, { x: m.x, z: m.z, yaw: m.yaw ?? this.v.ph.yaw }); this.toast(`🌐 ${m.reason}`, 'warn', 3); } });
  }

  /** Interior "next stop" / exterior "line, direction" announcements: imported MP3 or speech. */
  async announce(st, kind) {
    if (!this.route || !st) return;
    const r = this.route;
    const key = `bus-${r.route}/${st.stop.id}${kind === 'outside' ? ':outside' : ''}`;
    const blob = await AssetStore.getAudio(key);
    this.audio.ding?.();
    if (blob && this.audio.ctx) { try { const buf = await this.audio.ctx.decodeAudioData(await blob.arrayBuffer()); this.audio.playBuffer(buf, 0.6); return; } catch { /* fall back */ } }
    if (!('speechSynthesis' in window) || !this.settings.get('audio.voiceFallback')) return;
    const lang = r.language || 'fr-FR', fr = lang.startsWith('fr');
    const t = kind === 'outside' ? (fr ? `Ligne ${r.route}, direction ${this.runner.destination}.` : `Route ${r.route} to ${this.runner.destination}.`) : (fr ? `Prochain arrêt : ${st.stop.name}.` : `Next stop: ${st.stop.name}.`);
    const u = new SpeechSynthesisUtterance(t); u.lang = lang; u.rate = 0.95;
    u.volume = Math.min(1, this.settings.get('audio.master') * this.settings.get('audio.announcements')) * (kind === 'outside' && this.camMode === 'cab' ? 0.6 : 1);
    speechSynthesis.speak(u);
  }

  handle(a) {
    const A = this.actions(), v = this.v;
    switch (a) {
      case 'pause': this.bus.emit('game:pauseToggle'); break;
      case 'engine': A.engine(); break;
      case 'gearD': A.gear('D'); break; case 'gearN': A.gear('N'); break; case 'gearR': A.gear('R'); break;
      case 'parking': A.parking(); break;
      case 'doorFront': A.door(0); break;
      case 'doorRear': { const open = v.doors.slice(1).some((d) => d.target === 0); v.doors.slice(1).forEach((d) => v.door(d.i, open)); break; }
      case 'closeAll': A.closeAll(); break;
      case 'kneel': A.kneel(); break;
      case 'indLeft': A.indicator('left'); break; case 'indRight': A.indicator('right'); break;
      case 'hazards': A.hazards(); break; case 'lights': A.lights(); break; case 'wipers': A.wipers(); break;
      case 'interior': A.interior(); break; case 'emergency': A.emergency(); break;
      case 'ramp': A.ramp(); break; case 'retarder': A.retarder(); break; case 'climate': A.climate(); break;
      case 'stopReset': A.stopReset(); break; case 'ticket': A.ticket(); break; case 'announce': A.announce(); break;
      case 'camera': this.camMode = CAMS[(CAMS.indexOf(this.camMode) + 1) % CAMS.length]; this.look.yaw = 0; this.look.pitch = this.camMode === 'cab' ? -0.2 : 0.25; break;
      case 'routeView': this.bus.emit('bus:routeView'); break;
      case 'navPage': this.cockpit.didPage = this.cockpit.didPage === 'map' ? 'route' : 'map'; break;
      case 'lookBack': this.look.yaw = 0; this.look.pitch = this.camMode === 'cab' ? -0.2 : 0.25; break;
      case 'horn': A.horn(true); { const off = this.bus.on('input:release', (x) => { if (x === 'horn') { A.horn(false); off(); } }); } break;
      default: break;
    }
  }

  readControls(dt) {
    const I = this.input, c = this.controls, v = this.v;
    const pad = I.padButtons || [], axes = I.axes || [];
    const ramp = (cur, held, up, down) => clamp(cur + (held ? up : -down) * dt, 0, 1);
    c.throttle = ramp(c.throttle, I.isHeld('throttle'), 0.9, 3);
    c.brake = ramp(c.brake, I.isHeld('brake'), 1.4, 4);
    if ((pad[7] ?? 0) > 0.05) c.throttle = pad[7];
    if ((pad[6] ?? 0) > 0.05) c.brake = pad[6];
    const speed = Math.abs(v.speed);
    const rate = 9 / (1 + speed / 8); // steering-wheel rad/s from keys — slower at speed
    const L = I.isHeld('steerLeft'), R = I.isHeld('steerRight');
    const stick = Math.abs(axes[0] ?? 0) > 0.12 ? axes[0] : 0;
    if (stick) c.wheelTarget = stick * 16 * (1 / (1 + speed / 15));
    else if (L || R) c.wheelTarget = clamp(c.wheelTarget + (R ? rate : -rate) * dt, -16, 16);
    else if (!c.steerDrag) c.wheelTarget -= Math.sign(c.wheelTarget) * Math.min(Math.abs(c.wheelTarget), (7 + speed * 0.6) * dt); // self-centring (keyboard)
    // Accelerating without a drive gear: tell the driver how to select one.
    if (c.throttle > 0.3 && v.engineOn && v.gearSel === 'N' && this.time - (this.gearHintT ?? -99) > 6) { this.gearHintT = this.time; this.toast(`Gearbox in N — press ${I.labelFor('gearD')} for D (or ${I.labelFor('gearR')} for R)`, 'warn', 4); }
    return { throttle: c.throttle, brake: c.brake, wheelTarget: c.wheelTarget };
  }

  update(dt) {
    if (!this.running) return;
    for (const a of this.input.poll(dt)) this.handle(a);
    if (this.paused || this.result) { this.render(); return; }
    dt = Math.min(dt, 0.1);
    const ctl = this.readControls(dt);
    this.acc = (this.acc || 0) + dt;
    while (this.acc >= STEP) { this.simStep(STEP, ctl); this.acc -= STEP; }
    this.visuals(dt, ctl);
    this.render();
  }

  get clock() { return this.weather.clock; }

  simStep(dt, ctl) {
    const v = this.v, w = this.weather;
    const hd = v.ph.heading();
    v.update(dt, ctl, { mu: w.w.mu, grade: this.net.terrain.gradeAt(v.ph.x, v.ph.z, hd.fx, hd.fz), wet: w.wet });
    this.time += dt;
    this.collisions(dt);
    this.rules(dt);
    const ph = v.ph, h = ph.heading();
    const door = v.doorWorld(0);
    const inDepot = this.inDepot();
    this.runner.update(dt, { pos: this.posInfo(), v: v.speed, door, doorsOpened: v.doors.some((d) => d.amount > 0.9), clock: this.clock, parking: v.parking, inDepot, waiting: (k) => this.passengers.waitingAt(k), stopRequest: v.stopRequest });
    this.depotService(dt, inDepot);
    const lim = this.limitHere();
    this.scoring.sample(dt, { v: Math.abs(v.speed), limit: lim, ax: ph.ax, ay: ph.ay, emergency: v.emergency });
    void h;
  }

  /** Consequences of one impact: damage, failures, passengers, sound, penalties and the incident report. */
  impact(res, ob, cp, kind) {
    const v = this.v, ph = v.ph;
    const speed = res.vn * 3.6;
    const d = v.damage.apply(res.local, res.dv, ob.hard ?? 1);
    const sev = d.severity;
    v.condition = clamp(v.condition - d.k * 0.45, 0, 1);
    this.shake = Math.min(0.25, 0.015 + res.dv * 0.02);
    this.busAudio.impact({ k: Math.min(1.4, res.dv / 8), glass: d.events.some((e) => /Windscreen|windows|light|mirror/i.test(e)), deform: d.k > 0.15, mechanical: d.events.some((e) => /Engine|Steering|Brake|Suspension|Electrical/.test(e)) });
    const hurt = this.passengers.onImpact?.(res, ph) || 0;
    if (hurt) this.busAudio.passengersReact?.(Math.min(1, res.dv / 8));
    const pts = sev === 'scrape' ? 15 : sev === 'minor' ? 50 : sev === 'moderate' ? 150 : sev === 'severe' ? 350 : 600;
    this.scoring.add(pts, `Collision with ${ob.label} (${Math.round(speed)} km/h, ${sev})`);
    for (const e of d.events) this.toast(e, 'alarm', 4);
    if (sev === 'severe' || sev === 'major') {
      // Emergency stop: hazards on, brakes applied; a major impact stalls the engine.
      v.hazards = true; v.emergency = true;
      if (sev === 'major' && v.engineOn) { v.engineOn = false; this.bus.emit('bus:engine', false); }
      this.busAudio.alarm?.();
      this.toast(`${sev === 'major' ? 'MAJOR' : 'SEVERE'} COLLISION — emergency stop. Check on the passengers, then release the emergency stop (${this.input.labelFor('emergency')}).`, 'alarm', 8);
    } else this.toast(`Collision with ${ob.label} — ${sev}`, sev === 'scrape' ? 'warn' : 'alarm', 3);
    const street = this.net.nearestEdge(ph.x, ph.z)?.edge?.name || 'the road';
    this.report(`${sev[0].toUpperCase() + sev.slice(1)} collision with ${ob.label} on ${street} at ${Math.round(speed)} km/h (Δv ${(res.dv * 3.6).toFixed(0)} km/h, ${d.zone || 'body'} damage)${hurt ? ` · ${hurt} passenger(s) fell` : ''}${d.events.length ? ` · ${d.events.join(', ')}` : ''}`);
    this.bus.emit('bus:collision', { impact: res.vn, what: ob.label, severity: sev });
  }
  report(text) { (this.incidents ||= []).push(`${formatClock(this.clock, false)} — ${text}`); }

  limitHere() {
    if (this.inDepot()) return 20;
    const ne = this.net.nearestEdge(this.v.ph.x, this.v.ph.z);
    return ne?.edge?.speed ?? ne?.speed ?? 50;
  }
  inDepot() { const d = this.net.data.depot, p = this.v.ph; return p.x > d.x0 && p.x < d.x1 && p.z > d.z0 && p.z < d.z1; }

  /** Collisions with buildings & street furniture, AI vehicles and pedestrians; kerb strikes. */
  collisions(dt) {
    const v = this.v, ph = v.ph, boxes = ph.footprint();
    this.hitCd ||= new Map();
    for (const [k, t] of this.hitCd) if (this.time - t > 0.35) this.hitCd.delete(k); // secondary impacts on the same object after 0.35 s
    const hit = (b, r, obstPts, kind, key, other = {}) => {
      // Separate the bodies, then exchange momentum at the contact point.
      ph.x += r.ax.x * r.depth; ph.z += r.ax.z * r.depth;
      const cp = contactPoint(b.pts, obstPts, r.ax);
      const ob = { ...obstacle(kind), ...other };
      const res = resolveImpact(ph, r.ax, cp, ob, { mu: this.weather.w.mu });
      if (!res || this.hitCd.has(key)) return res;
      this.hitCd.set(key, this.time);
      if (res.dv > 0.6) this.impact(res, ob, cp, kind);
      return res;
    };
    for (const b of boxes) {
      for (const c of this.world.colliders) {
        if (b.cx < c.x0 - 14 || b.cx > c.x1 + 14 || b.cz < c.z0 - 14 || b.cz > c.z1 + 14) continue; // near the rectangle (any size)
        const poly = rectPoly(c);
        const r = sat(b.pts, poly);
        if (r) hit(b, r, poly, c.kind, c);
      }
      // Other players' buses: moving obstacles with their real mass and velocity.
      for (const rb of this.remoteBusBoxes()) {
        if (Math.hypot(rb.cx - b.cx, rb.cz - b.cz) > 30) continue;
        const r = sat(b.pts, rb.pts);
        if (r) hit(b, r, rb.pts, 'bus', `mp:${rb.id}`, { mass: rb.mass, vx: rb.vx, vz: rb.vz, label: `${rb.name}'s bus` });
      }
      for (const cb of this.traffic.boxes()) {
        if (Math.hypot(cb.car.pos.x - b.cx, cb.car.pos.z - b.cz) > 20) continue;
        const r = sat(b.pts, cb.pts);
        if (!r) continue;
        const car = cb.car, cv = car.crashed ? 0 : car.v;
        const res = hit(b, r, cb.pts, car.type, car, { vx: car.pos.dx * cv, vz: car.pos.dz * cv });
        if (res) {
          // The car takes the opposite impulse: pushed away (clamped), stops, hazards on.
          const push = Math.min(2.5, res.otherDv * 0.25);
          car.pos.x -= r.ax.x * push; car.pos.z -= r.ax.z * push;
          car.crashed = Math.max(car.crashed || 0, 30); car.v = 0;
          const yawKick = Math.max(-0.5, Math.min(0.5, (res.jt || 0) / 30000)); const cs = Math.cos(yawKick), sn = Math.sin(yawKick); const ndx = car.pos.dx * cs - car.pos.dz * sn; car.pos.dz = car.pos.dx * sn + car.pos.dz * cs; car.pos.dx = ndx; // the car is spun round
        }
      }
      for (const p of this.traffic.peds) {
        if (p.hit) continue;
        const pt = [{ x: p.x - 0.25, z: p.z - 0.25 }, { x: p.x + 0.25, z: p.z - 0.25 }, { x: p.x + 0.25, z: p.z + 0.25 }, { x: p.x - 0.25, z: p.z + 0.25 }];
        if (sat(b.pts, pt)) {
          p.hit = true; this.scoring.add(400, 'Pedestrian struck'); this.busAudio.collision(0.4);
          this.toast('A pedestrian has been struck! Stop the bus and switch on the hazard lights.', 'alarm', 6);
          this.report(`Pedestrian struck at ${Math.round(Math.abs(ph.vx) * 3.6)} km/h`);
          v.hazards = true;
        }
      }
    }
    // Kerb strikes: wheels leaving the carriageway.
    const h = ph.heading(), sp = v.spec;
    const wheels = [[ph.lf, -sp.width / 2 + 0.3], [ph.lf, sp.width / 2 - 0.3], [-ph.lr, -sp.width / 2 + 0.3], [-ph.lr, sp.width / 2 - 0.3]];
    let off = 0;
    for (const [f, l] of wheels) if (!this.world.onRoad(ph.x + h.fx * f + h.rx * l, ph.z + h.fz * f + h.rz * l)) off++;
    if (off && Math.abs(ph.vx) > 1) {
      ph.vx *= 1 - 0.6 * dt; this.shake = Math.max(this.shake || 0, 0.02);
      if (this.time - (this.lastKerb || -9) > 4) { this.lastKerb = this.time; this.busAudio.kerb(); this.scoring.add(20, 'Kerb strike / driving on the pavement'); }
    }
  }

  /** Red lights, indicators at junctions, pedestrians on crossings. */
  rules(dt) {
    const ph = this.v.ph, h = ph.heading();
    const fx = ph.x + h.fx * (ph.lf + this.spec.frontOverhang), fz = ph.z + h.fz * (ph.lf + this.spec.frontOverhang);
    for (const n of this.net.nodes.values()) {
      if (Math.abs(n.x - fx) > 60 || Math.abs(n.z - fz) > 60) continue;
      // Junction turn detection (indicator use).
      const inBox = Math.abs(fx - n.x) < n.trim && Math.abs(fz - n.z) < n.trim && !n.roundabout && n.edges.length >= 3;
      if (inBox && this.junction?.node !== n) this.junction = { node: n, yaw0: ph.yaw, t0: this.time };
      if (!inBox && this.junction?.node === n && Math.hypot(fx - n.x, fz - n.z) > n.trim + 8) {
        let dy = ph.yaw - this.junction.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (Math.abs(dy) > 0.6) { const side = dy > 0 ? 'right' : 'left'; if (this.junction.t0 - this.lastInd[side] > 8 && this.v.indicator !== side) this.scoring.add(25, `No indicator when turning ${side}`); }
        this.junction = null;
      }
      if (!n.signal) continue;
      for (const e of n.edges) {
        const d = this.net.dir(e, e.b === n);
        const s = (fx - d.from.x) * d.dx + (fz - d.from.z) * d.dz, lat = (fx - d.from.x) * d.rx + (fz - d.from.z) * d.rz;
        const line = e.len - n.trim - 6.3;
        const key = `${n.id}|${e.i}`;
        const prev = this.prevLine.get(key);
        const aligned = h.fx * d.dx + h.fz * d.dz > 0.6 && lat > -0.5 && lat < e.half + 0.5;
        if (prev != null && aligned && prev < line && s >= line) {
          const st = this.net.signalState(n, d, this.clock);
          if (st === 'red') this.scoring.add(150, 'Ran a red light');
        }
        this.prevLine.set(key, aligned ? s : null);
      }
    }
    // Endangering pedestrians on a crossing.
    if (Math.abs(ph.vx) > 1.5) for (const p of this.traffic.peds) if (p.onCrossing && Math.hypot(p.x - fx, p.z - fz) < 4) { this.scoring.add(80, 'Did not give way to a pedestrian on the crossing', 'ped', 5); break; }
  }

  /** Depot bays: refuel, charge, wash and repair while parked there with the parking brake on. */
  depotService(dt, inDepot) {
    this.serviceState = null;
    if (!inDepot || !this.world.zones || Math.abs(this.v.speed) > 0.1 || !this.v.parking) return;
    const v = this.v, p = v.ph;
    for (const [k, z] of Object.entries(this.world.zones)) {
      if (Math.hypot(p.x - z.x, p.z - z.z) > z.r) continue;
      const E = this.economy, price = v.electric ? 0.22 : 1.65; // € per kWh / per litre
      const canPay = (cost) => !E || E.balance >= cost;
      if (k === 'fuel' && !v.electric) {
        const add = Math.min(v.energyMax - v.energy, 3 * dt);
        if (add > 0 && canPay(add * price)) { v.energy += add; this.energyBought += add; this.serviceState = { label: `Refuelling · ${(this.energyBought * price).toFixed(2).replace('.', ',')} €`, pct: v.energyPct }; }
        else if (add > 0) this.serviceState = { label: 'Not enough money to refuel', pct: v.energyPct };
      }
      if (k === 'charge' && v.electric) {
        if (v.engineOn) { this.serviceState = { label: 'Switch the bus off to charge', pct: v.energyPct }; break; }
        const add = Math.min(v.energyMax - v.energy, (150 * 12 / 3600) * dt);
        if (add > 0 && canPay(add * price)) { v.energy += add; this.energyBought += add; this.serviceState = { label: `Charging 150 kW (×12 time) · ${(this.energyBought * price).toFixed(2).replace('.', ',')} €`, pct: v.energyPct }; }
        else if (add > 0) this.serviceState = { label: 'Not enough money to charge', pct: v.energyPct };
      }
      if (k === 'wash') { v.cleanliness = Math.min(1, v.cleanliness + 0.1 * dt); this.serviceState = { label: 'Washing', pct: v.cleanliness }; }
      if (k === 'maintenance') {
        // Repairs in the hall are paid as they progress (also clear body damage).
        const want = Math.min(1 - v.condition, 0.04 * dt);
        const got = want > 0 ? (this.owned ? E.payPartialRepair(this.owned.uid, want) : want) : 0;
        if (got > 0) { v.condition += got; v.damage.repair(got * 2.5); }
        this.serviceState = { label: want > 0 && !got ? 'Not enough money for repairs' : `Maintenance · ${E ? `balance ${Math.round(E.balance).toLocaleString('fr-FR')} €` : ''}`, pct: v.condition };
      }
    }
  }

  // ---- Online multiplayer ----
  remoteBusBoxes() {
    if (!this.mp?.inSession) return [];
    return this.mp.remotes('bus').map((r) => {
      const st = r.state, L = r.drive.length / 2, W = r.drive.width / 2;
      const fx = Math.sin(st.yaw), fz = -Math.cos(st.yaw), rx = Math.cos(st.yaw), rz = Math.sin(st.yaw);
      const P = (f, l) => ({ x: st.x + fx * f + rx * l, z: st.z + fz * f + rz * l });
      return { id: r.id, name: r.name, pts: [P(L, -W), P(L, W), P(-L, W), P(-L, -W)], cx: st.x, cz: st.z, vx: fx * st.v, vz: fz * st.v, mass: (this.mp.busSpecs?.(r.drive.model)?.mass) || 12000 };
    });
  }
  updateMultiplayer() {
    const mp = this.mp;
    if (!mp?.inSession) { for (const e of this.remoteBuses?.values() || []) e.model.dispose(this.scene); this.remoteBuses?.clear(); return; }
    const v = this.v, ph = v.ph;
    mp.sendState({ x: ph.x, z: ph.z, yaw: ph.yaw, v: ph.vx, doors: v.doors.map((d) => Math.round(d.amount * 100) / 100), trailerYaw: ph.trailerYaw, lights: v.lights > 0, brake: ph.brakeP > 0.05, ind: v.hazards ? 'hazard' : v.indicator || '' });
    const seen = new Set();
    for (const r of mp.remotes('bus')) {
      seen.add(r.id);
      let e = this.remoteBuses.get(r.id);
      const spec = mp.busSpecs?.(r.drive.model);
      if (!spec) continue;
      if (!e || e.model.spec !== spec) {
        if (e) e.model.dispose(this.scene);
        const model = new BusModel(spec); model.heightAt = this.net.heightAt; this.scene.add(model.group);
        model.setDestination(r.drive.route || '', r.name);
        const proxy = { ph: { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, heave: 0, delta: 0, wheelSpin: 0, trailerYaw: 0, brakeP: 0, vx: 0 }, doors: spec.doors.map(() => ({ amount: 0 })), lights: 1, gearSel: 'D', blinkOn: false, indicator: null, hazards: false, interiorLights: true, parking: false, kneelT: 0, rampT: 0, damage: null, stopRequest: false };
        e = { model, proxy }; this.remoteBuses.set(r.id, e);
      }
      const st = r.state, pr = e.proxy;
      pr.ph.wheelSpin += (st.v / 0.5) * 0.016;
      Object.assign(pr.ph, { x: st.x, z: st.z, yaw: st.yaw, trailerYaw: st.trailerYaw ?? st.yaw, vx: st.v, brakeP: st.brake ? 0.5 : 0 });
      st.doors?.forEach((a, i) => { if (pr.doors[i]) pr.doors[i].amount = a; });
      pr.lights = st.lights ? 1 : 0; pr.hazards = st.ind === 'hazard'; pr.indicator = st.ind === 'left' || st.ind === 'right' ? st.ind : null; pr.blinkOn = Math.floor(this.time * 2.5) % 2 === 0;
      e.model.update(pr, this.time);
    }
    for (const [id, e] of this.remoteBuses) if (!seen.has(id)) { e.model.dispose(this.scene); this.remoteBuses.delete(id); }
  }

  visuals(dt, ctl) {
    const v = this.v, w = this.weather;
    this.frame++;
    this.model.update(v, this.time);
    this.head.intensity = v.lights ? (v.lights === 2 ? 120 : 60) : 0;
    this.cabLight.intensity = v.interiorLights ? 1.5 * (1 - w.daylight * 0.8) : 0;
    const cam = this.cameraUpdate(dt);
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    w.update(dt, camPos, this.world.nightMats);
    this.world.lampHeads.material.color.setHex(w.daylight < 0.35 ? 0xfff1c8 : 0x777777);
    this.world.update(this.clock);
    const hour = w.hour;
    const ph = v.ph, sp = this.spec;
    const front = ph.heading();
    const busFoot = ph.footprint().map((b) => ({ cx: b.cx, cz: b.cz, half: sp.length / 2 }));
    this.traffic.weatherWet = w.wet;
    this.traffic.update(dt, this.clock, { player: { x: ph.x, z: ph.z, v: ph.vx }, busFoot, hour, day: this.day, peds: this.traffic.peds, rain: w.raining });
    this.passengers.update(dt, this.time, { hour, day: this.day, rain: w.raining });
    this.updateMultiplayer();
    this.updatePIDs();
    const st = this.snapshot(ctl);
    this.cockpit.update(dt, st);
    this.cockpit.visible = this.camMode === 'cab';
    this.cockpit.renderViews(this.renderer, this.scene, this.frame);
    this.busAudio.update(dt, { v: ph.vx, rpm: ph.rpm, throttle: ctl.throttle, brake: ctl.brake, engineOn: v.engineOn, load: st.powerKw / 250, cab: this.camMode === 'cab' || this.camMode === 'passenger', wet: w.wet, rain: w.w.rain, passengers: st.passengers, traffic: trafficDensity(hour, this.day), horn: v.horn, hybridAssist: sp.powertrain === 'hybrid' && Math.abs(ph.vx) < 9 && ctl.throttle > 0.1 });
    this.bus.emit('hud:busUpdate', st);
    void cam; void front;
  }

  updatePIDs() {
    if (this.frame % 30) return;
    const r = this.route;
    for (const sv of this.world.stopViews) {
      const p = this.camera.position;
      if (Math.abs(sv.polePoint.x - p.x) > 300 || Math.abs(sv.polePoint.z - p.z) > 300) continue;
      const g = sv.pid.c.getContext('2d');
      g.fillStyle = '#050505'; g.fillRect(0, 0, 512, 192);
      g.font = 'bold 30px "Courier New", monospace'; g.textBaseline = 'middle';
      const lines = [];
      if (r && this.runner.stops.some((s) => s.stop === sv.stop && s.fwd === sv.fwd)) {
        const k = this.runner.stops.findIndex((s) => s.stop === sv.stop && s.fwd === sv.fwd);
        const eta = k >= this.runner.nextIdx ? Math.max(0, this.runner.distanceToStop(k) / 7) : r.headway ?? 600;
        lines.push([r.route, this.runner.destination, eta < 40 ? 'À quai' : `${Math.ceil(eta / 60)} min`, r.color]);
      }
      if (sv.stop.aeroval) lines.push(['AV', 'Aéroval – navettes aéroport', `${3 + (Math.floor(this.clock / 60) % 7)} min`, '#FFD000']);
      lines.push(['Info', sv.stop.metro?.length ? `Métro ${sv.stop.metro.join(' ')} — correspondance` : 'Grandville Transports', '', '#1f3c88']);
      lines.slice(0, 3).forEach(([n, d, t, col], i) => {
        const y = 32 + i * 62;
        g.fillStyle = col; g.fillRect(8, y - 22, 70, 44); g.fillStyle = '#111'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText(n, 43, y);
        g.textAlign = 'left'; g.fillStyle = '#ffb000'; g.font = 'bold 24px "Courier New", monospace'; g.fillText(d.length > 22 ? `${d.slice(0, 21)}…` : d, 90, y);
        g.textAlign = 'right'; g.fillText(t, 504, y);
      });
      sv.pid.tex.needsUpdate = true;
    }
  }

  cameraUpdate(dt) {
    const cam = this.camera, ph = this.v.ph, body = this.model.body;
    const fov = this.settings.get('graphics.fov');
    if (this.camMode === 'cab' || this.camMode === 'passenger') {
      if (cam.parent !== body) body.add(cam);
      const eye = this.camMode === 'cab' ? this.cockpit.eye : new THREE.Vector3(0.6, 1.75, this.model.zFront + this.spec.length * 0.45);
      const shake = (this.shake || 0) * Math.sin(this.time * 47);
      const vib = this.v.engineOn ? (this.v.electric ? 0.0004 : 0.0012) * (1 + Math.abs(ph.vx) / 20) : 0;
      cam.position.copy(eye).add(new THREE.Vector3(0, Math.sin(this.time * 31) * vib + shake, -ph.ax * 0.012));
      cam.rotation.set(this.look.pitch - ph.pitch * 0.3, this.look.yaw, -ph.roll * 0.4, 'YXZ');
      cam.fov = fov; cam.updateProjectionMatrix();
      this.shake = Math.max(0, (this.shake || 0) - dt * 0.2);
      this.interaction.enabled = this.camMode === 'cab';
      return cam;
    }
    this.interaction.enabled = false;
    if (cam.parent !== this.scene) this.scene.add(cam);
    const h = ph.heading();
    if (this.camMode === 'chase') {
      const d = this.chaseDist, yaw = this.look.yaw, pitch = clamp(this.look.pitch, 0.05, 1.3);
      const bx = -h.fx * Math.cos(yaw) + h.rx * Math.sin(yaw), bz = -h.fz * Math.cos(yaw) + h.rz * Math.sin(yaw);
      const gy = this.net.heightAt(ph.x, ph.z);
      const target = new THREE.Vector3(ph.x + bx * d * Math.cos(pitch), gy + 2 + Math.sin(pitch) * d, ph.z + bz * d * Math.cos(pitch));
      cam.position.lerp(target, Math.min(1, dt * 4));
      cam.lookAt(ph.x + h.fx * 4, gy + 2, ph.z + h.fz * 4);
    } else {
      cam.position.set(ph.x, 120 + this.chaseDist * 2, ph.z + 0.01);
      cam.lookAt(ph.x, this.net.heightAt(ph.x, ph.z), ph.z);
    }
    cam.fov = fov; cam.updateProjectionMatrix();
    return cam;
  }

  snapshot(ctl) {
    const v = this.v, ph = v.ph, R = this.runner;
    const k = R.atStopIdx ?? R.nextIdx;
    const nextSt = R.stops[k];
    const nav = R.leg ? R.leg.path.points.filter((_, i) => i % 2 === 0 || i === R.leg.path.points.length - 1) : null;
    const upcoming = R.stops.slice(Math.max(0, k)).map((s) => ({ name: s.stop.name, time: s.arr }));
    const power = (ph.lastPower?.drive ?? 0) / 1000 - (ph.lastPower?.regen ?? 0) / 1000;
    return {
      route: this.route, destination: R.destination, net: this.net, clock: this.clock,
      speed: Math.abs(ph.vx) * 3.6, limit: this.limitHere(), throttle: ctl.throttle, brake: ctl.brake, powerKw: power,
      gear: v.gearSel === 'D' && !v.electric ? `D${ph.gear}` : v.gearSel, engineOn: v.engineOn, parking: v.parking,
      nextStopName: nextSt?.stop.name, stopDist: R.phase === 'return' ? Math.max(0, (R.leg?.target ?? 0) - R.progress) : R.distanceToStop(k), standing: R.atStopIdx != null,
      schedArr: nextSt?.arr, schedDep: nextSt?.dep, delay: this.route ? this.clock - (nextSt?.arr ?? this.clock) : 0,
      passengers: this.passengers.count, capacity: this.spec.capacity, waiting: this.passengers.waitingAt(k),
      doors: v.doors.map((d) => d.amount), doorsClosed: v.doorsClosed, kneel: v.kneelT > 0.5,
      energyPct: v.energyPct, electric: v.electric, condition: v.condition, cleanliness: v.cleanliness,
      score: this.scoring.result(true).score, comfort: this.scoring.comfort, phase: R.phase, maneuver: R.nextManeuver(),
      remotes: this.mp?.inSession ? this.mp.remotes('bus').map((r) => ({ x: r.state.x, z: r.state.z, yaw: r.state.yaw, color: r.color, name: r.name })) : [],
      navPath: nav, mapStops: R.stops.slice(k).map((s) => this.runner.viewFor(this.runner.stops.indexOf(s))?.polePoint).filter(Boolean),
      upcoming, weather: this.weather.w, weatherLabel: this.weather.kind, hour: this.weather.hour, service: this.serviceState, camMode: this.camMode,
      stopRequest: v.stopRequest, cashWaiting: this.passengers?.cashWaiting ?? 0, indicator: v.indicator, hazards: v.hazards, blinkOn: v.blinkOn, mode: this.mode,
    };
  }

  render() { if (this.scene) this.renderer.render(this.scene, this.camera); }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  setPaused(p) { this.paused = p; if (p) this.audio.suspend(); else this.audio.resume(); this.input.enabled = !p; }

  finish(completed, reason) {
    if (this.result) return;
    const res = this.scoring.result(completed);
    this.result = { ...res, completed, reason, kind: 'bus', route: this.route, dir: this.cfg.dir, spec: this.spec, mode: this.mode,
      distanceKm: this.v.ph.distance / 1000, seconds: this.time, carried: this.passengers.validations, contactless: this.passengers.contactless,
      stopsServed: this.runner.stops.filter((s) => s.served).length, stopsTotal: this.runner.stops.length,
      missed: this.runner.stops.filter((s) => s.missed).length, vehicleUid: this.owned?.uid || null, incidents: this.incidents || [] };
    this.saveFleet();
    this.bus.emit('bus:finished', this.result);
  }
  /** Fuel and electricity are paid at the depot pumps / chargers (charged when the vehicle state is saved). */
  saveFleet() {
    if (!this.v) return;
    if (this.owned) {
      // Pay for depot refills, then store the vehicle state on the owned bus.
      if (this.energyBought > 0) { const c = this.energyBought * (this.v.electric ? 0.22 : 1.65); this.economy.d.balance -= c; this.economy.log(`${this.v.electric ? 'Charging' : 'Fuel'} ${this.owned.uid}`, -c, this.owned.uid); this.energyStart += this.energyBought; this.energyBought = 0; }
      const km = this.v.ph.distance / 1000 - (this.kmSaved || 0); this.kmSaved = this.v.ph.distance / 1000;
      Object.assign(this.owned, { condition: this.v.condition, cleanliness: this.v.cleanliness, energy: this.v.energy, damage: this.v.damage.state() });
      this.economy.wear(this.owned.uid, { km, condition: Math.max(0, this.v.condition - km * 0.0008) });
      this.v.condition = this.owned.condition;
      return;
    }
    const d = this.save.data; d.bus ||= {}; d.bus.fleet ||= {};
    d.bus.fleet[this.spec.id] = { condition: this.v.condition, cleanliness: this.v.cleanliness, energy: this.v.energy, coolant: 20 };
    this.save.save();
  }

  dispose() {
    if (!this.scene) return;
    this.mp?.stopDriving();
    this.saveFleet?.();
    this.running = false;
    this.subs?.forEach((f) => f());
    this.scoring?.dispose(); this.busAudio?.stop(); this.passengers?.dispose(); this.traffic?.dispose(); this.cockpit?.dispose();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.camera.parent) this.camera.parent.remove(this.camera);
    this.scene.traverse((o) => o.geometry?.dispose?.());
    this.interaction.setTargets([]); this.interaction.enabled = false;
    this.scene = null;
  }
}
