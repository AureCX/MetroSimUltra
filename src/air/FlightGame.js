// A flight session: the player flies one scheduled flight from a stand at the departure airport to a stand at the
// destination, among the day's AI traffic, under ATC. Wires the flight model, the 3D aircraft and flight deck,
// the world (terrain, airports, cities, sky), weather, AI traffic, controllers, sounds, cameras and HUD.
//
// ATC flow for the player (requests in the ATC panel, or Enter for the next one): start-up & push-back clearance →
// push-back (tug) → taxi clearance to the holding point (route drawn on the ground) → ready for departure (queue,
// line-up / take-off clearance when the runway is free and the spacing allows) → handed to Departure → approach
// clearance (ILS, sequencing / holding) → landing clearance (or go-around when the runway is occupied) → taxi to the
// assigned stand → parking. Penalties: runway incursion, landing without clearance, overspeed below FL100, hard
// landing, tail strike, over-stress; crash ends the flight.
import * as THREE from 'three';
import { AIRCRAFT, AIRPORTS, airport, airlineOf, hdgVec, distKm } from './AirData.js';
import { FlightModel, qFromHPB, KT, FT } from './FlightModel.js';
import { AircraftModel } from './AircraftModel.js';
import { FlightWorld, FAR_LAYER } from './FlightWorld.js';
import { AirWeather } from './AirWeather.js';
import { ATC, ROLES } from './ATC.js';
import { FlightSchedule, AirTraffic, fmtT, blockTime } from './AirTraffic.js';
import { Cockpit } from './Cockpit.js';
import { AirAudio } from './AirAudio.js';
import { clamp } from '../core/util.js';

const STEP = 1 / 120, D2R = Math.PI / 180;
export const AIR_CAMS = ['pilot', 'panel', 'wing', 'chase', 'external', 'tower'];
export const AIR_CAM_LABEL = { pilot: 'Pilot seat', panel: 'Instrument panel', wing: 'Wing view', chase: 'Chase', external: 'External (orbit)', tower: 'Landing / tower camera' };
const TQ = new THREE.Quaternion(), TV = new THREE.Vector3(), TV2 = new THREE.Vector3(), TE = new THREE.Euler();
const toQ = (q, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

export class FlightGame {
  constructor({ renderer, bus, settings, input, audio, save }) {
    Object.assign(this, { renderer, bus, settings, input, audio, save });
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 600000);
    this.running = false; this.paused = false;
    this.look = { yaw: 0, pitch: -0.1, drag: false };
    this.mouse = { x: 0, y: 0 };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { if (this.running && (e.button === 2 || e.button === 1 || (e.button === 0 && this.camMode === 'external'))) { this.look.drag = true; this.look.last = [e.clientX, e.clientY]; } });
    window.addEventListener('pointerup', () => { this.look.drag = false; });
    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1; this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!this.look.drag || !this.running) return;
      const s = 0.004 * (this.settings.get('gameplay.mouseSensitivity') || 1), inv = this.settings.get('gameplay.invertY') ? -1 : 1;
      this.look.yaw = clamp(this.look.yaw - (e.clientX - this.look.last[0]) * s, -Math.PI, Math.PI);
      this.look.pitch = clamp(this.look.pitch - (e.clientY - this.look.last[1]) * s * inv, -1.3, 1.2);
      this.look.last = [e.clientX, e.clientY];
    });
    dom.addEventListener('wheel', (e) => { if (!this.running) return; if (['chase', 'external'].includes(this.camMode)) this.camDist = clamp(this.camDist * (e.deltaY > 0 ? 1.1 : 0.9), 15, 600); else this.camera.fov = clamp(this.camera.fov * (e.deltaY > 0 ? 1.06 : 0.94), 25, 80), this.camera.updateProjectionMatrix(); }, { passive: true });
    dom.addEventListener('contextmenu', (e) => { if (this.running) e.preventDefault(); });
  }

  /**
   * cfg: { flight: { no, airline (code), type, from, to, dep, arr, scheduleId? }, start: 'stand' | 'runway' | 'approach',
   * hour, weather, density (0..1), aircraftUid (own aircraft or null = leased), day }.
   */
  start(cfg) {
    this.dispose();
    this.audio.beginSession();
    this.cfg = cfg;
    const scene = this.scene = new THREE.Scene();
    const spec = this.spec = AIRCRAFT[cfg.flight.type];
    this.clock = cfg.hour * 3600; this.startClock = this.clock; this.time = 0; this.warp = 1;
    // World, weather, controllers, traffic.
    this.weather = new AirWeather(scene, { kind: cfg.weather || 'auto', seed: (cfg.day || 1) * 7 + Math.floor(cfg.hour) });
    this.weather.update(0, this.clock, null);
    this.world = new FlightWorld(scene, this.renderer).build();
    this.atc = new ATC(this.world.airports, this.weather);
    this.schedule = new FlightSchedule(cfg.day || 1);
    const F = cfg.flight;
    const sch = F.scheduleId ? this.schedule.flights.find((f) => f.id === F.scheduleId) : null;
    if (sch) sch.player = true;
    this.flight = { ...F, airline: airlineOf(F.airline), km: distKm(airport(F.from), airport(F.to)), player: true, id: 'player', status: 'scheduled', phase: 'boarding', delay: 0 };
    this.flight.arr = this.flight.arr || this.flight.dep + blockTime(F.type, this.flight.km);
    this.schedule.flights.push(this.flight);
    this.from = this.world.layout(F.from); this.to = this.world.layout(F.to);
    this.traffic = new AirTraffic({ schedule: this.schedule, layouts: this.world.airports, atc: this.atc, weather: this.weather, density: cfg.density ?? 1 });
    // The player as seen by the AI (ground separation) and the controllers.
    this.me = { id: 'player', x: 0, z: 0, y: 0, hdg: 0, v: 0, onGround: true, phase: 'parked', waitT: 0, blocker: null };
    this.traffic.player = this.me;
    // Player aircraft.
    this.owned = this.economy?.vehicle(cfg.aircraftUid) || null;
    this.fm = new FlightModel(spec, { ground: (x, z) => this.world.ground(x, z), wind: () => this.weather.wind(), wet: () => this.weather.wet() });
    this.load = 0.62 + Math.random() * 0.33;
    this.fm.payload = spec.seats * this.load * 95;
    const trip = (blockTime(F.type, this.flight.km) / 3600) * spec.fuelBurn * 1.15 + spec.fuelBurn * 0.9;
    this.fm.fuel = Math.min(spec.fuelMax, Math.round(trip / 100) * 100);
    this.fuel0 = this.fm.fuel;
    this.model = new AircraftModel(spec, this.flight.airline, { player: true }); scene.add(this.model.group);
    this.cockpit = new Cockpit(spec); scene.add(this.cockpit.group);
    this.lights = { nav: true, beacon: false, strobe: false, landing: false };
    this.depDir = this.atc.of(F.from).active(); this.arrDir = this.atc.of(F.to).active();
    this.flight.runway = this.depDir.name;
    // Starting position.
    this.st = 'stand'; this.pen = []; this.events = []; this.maxG = 1; this.touch = null; this.cleared = {};
    const start = cfg.start || 'stand';
    if (start === 'approach') {
      const I = this.arrDir.ils, d = 22000, alt = this.to.elev + Math.tan(3 * D2R) * d + 180;
      this.fm.placeInFlight(I.x - I.dx * d, alt, I.z - I.dz * d, I.hdg, spec.vref + 40);
      this.fm.flapIdx = this.fm.flapPos = 1; this.fm.ctl.throttle = 0.55;
      this.fm.ap.engage(true); this.fm.ap.at = true; this.fm.ap.spd = spec.vref + 30; this.fm.ap.alt = alt; this.fm.ap.hdg = I.hdg;
      this.st = 'enroute'; this.lights = { nav: true, beacon: true, strobe: true, landing: true };
      this.atc.of(F.to).arrival('player', d, 'player');
      this.toast(`Approach start: ${d / 1000} km from ${F.to} runway ${this.arrDir.name}. Request approach / landing with ATC (Enter).`, 'info', 7);
    } else if (start === 'runway') {
      const e = this.from.graph.nodes[this.depDir.entry];
      this.fm.placeOnGround(e.x, e.z, this.depDir.hdg); this.fm.engines.forEach((en) => { en.running = true; en.n1 = 0.21; en.n2 = 0.6; });
      this.fm.flapIdx = this.fm.flapPos = Math.min(2, spec.flaps.length - 1); this.fm.ctl.parking = true;
      this.st = 'holding'; this.atc.of(F.from).requestDeparture('player');
      this.lights = { nav: true, beacon: true, strobe: true, landing: true };
      this.toast(`Lined up on runway ${this.depDir.name}. Wait for take-off clearance, release the parking brake (${this.input.labelFor('parking')}), full thrust (${this.input.labelFor('throttleMax')}), rotate at ${Math.round(spec.vr * KT)} kt.`, 'info', 9);
    } else {
      this.stand = this.from.freeStand(); this.stand.occupied = 'player'; this.flight.gate = this.stand.gate;
      this.fm.placeOnGround(this.stand.x, this.stand.z, this.stand.hdg);
      this.toast(`${this.flight.no} ${F.from} → ${F.to}, stand ${this.stand.gate}. Request start-up and push-back from ATC (${this.input.labelFor('atc')}), start the engines (${this.input.labelFor('engines')}).`, 'info', 9);
    }
    // Populate the sky: run the traffic for the last 40 minutes.
    for (let t = this.clock - 2400; t < this.clock; t += 1) this.traffic.update(1, t);
    this.aiModels = new Map(); this.aiPool = [];
    this.farDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false })); this.farDots.frustumCulled = false; scene.add(this.farDots);
    // Taxi route guidance (green dots on the taxiway centre line).
    this.guide = new THREE.InstancedMesh(new THREE.CircleGeometry(1.1, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3cff6a, transparent: true, opacity: 0.85, depthWrite: false }), 600); this.guide.count = 0; this.guide.frustumCulled = false; scene.add(this.guide);
    this.tug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 5), new THREE.MeshLambertMaterial({ color: 0xf2c200 })); this.tug.visible = false; scene.add(this.tug);
    // Audio, radio, controllers' voices.
    this.airAudio = new AirAudio(this.audio, this.settings); this.airAudio.start(spec);
    this.atc.onSay = (e) => this.onRadio(e);
    this.weather.onThunder = (k) => this.airAudio.thunder(k);
    this.radioLog = [];
    this.mp?.startDriving?.({ kind: 'aircraft', model: spec.id, uid: cfg.aircraftUid || '', route: this.flight.no, length: spec.length, width: spec.span, maxSpeed: 1000 });
    this.remote = new Map(); this.traffic.others = this.remote;
    // Camera.
    this.camMode = 'pilot'; this.camDist = Math.max(40, spec.length * 1.6); this.look.yaw = 0; this.look.pitch = -0.17; this.camera.fov = 62; this.camera.updateProjectionMatrix();
    this.ctl = { elev: 0, ail: 0, rud: 0 }; this.mouseYoke = false;
    this.world.updateTerrain(this.fm.pos.x, this.fm.pos.z, true);
    this.result = null; this.hudN = 0; this.atcCheck = 0;
    this.running = true; this.paused = false;
  }
  toast(text, kind = 'info', dur = 3) { this.bus.emit('hud:toast', { text, kind, dur }); }

  // ---------------- radio ----------------
  onRadio(e) {
    // Only what the player can hear: their own exchanges, and the frequency of the airport they are at / flying to.
    const near = this.nearAirport();
    const mine = e.to === this.flight.no || e.to === 'player';
    if (!mine && (!near || e.apId !== near.ap.id)) return;
    const who = `${this.atc.of(e.apId).call(e.role)}`;
    this.radioLog.unshift({ who, text: e.text, mine, role: e.role, t: this.clock }); this.radioLog.length = Math.min(this.radioLog.length, 14);
    if (mine || Math.random() < 0.35) this.airAudio.radio(e.text, e.role);
    if (mine) this.bus.emit('air:radio', { who, text: e.text });
  }
  say(role, text, apId = this.atcAirport()) { this.atc.say(apId, role, text, 'player'); }
  pilotSays(text) { this.radioLog.unshift({ who: this.flight.no, text, mine: true, pilot: true, t: this.clock }); this.airAudio.radio(text, 'pilot', { pilot: true }); }
  atcAirport() { return ['enroute', 'approach', 'final', 'landed', 'taxiIn', 'arrived', 'goAround'].includes(this.st) ? this.flight.to : this.flight.from; }
  nearAirport() { let best = null, bd = Infinity; for (const A of this.world.airports) { const d = Math.hypot(A.ap.x - this.fm.pos.x, A.ap.z - this.fm.pos.z); if (d < bd) { bd = d; best = A; } } return bd < 60000 ? best : null; }
  callsign() { return `${this.flight.airline.name} ${this.flight.no.split(' ')[1]}`; }
  qnh() { return 1013 + Math.round((this.weather.kind === 'storm' ? -9 : this.weather.kind === 'rain' ? -5 : 2)); }
  windText(apId) { const w = this.weather.wind(); return `vent ${String(Math.round(w.dir / 10) * 10).padStart(3, '0')} degrés ${Math.round(w.speed * 1.94)} nœuds`; }

  /** ATC requests available now: [{ id, label }]. */
  atcOptions() {
    const o = [], st = this.st, gs = this.fm.out.gs || 0;
    const distDest = Math.hypot(this.to.ap.x - this.fm.pos.x, this.to.ap.z - this.fm.pos.z);
    if (st === 'stand') o.push({ id: 'startup', label: 'Demande de mise en route et repoussage' });
    if (st === 'cleared') o.push({ id: 'push', label: 'Prêt pour le repoussage' });
    if (st === 'ready' || (st === 'cleared' && !this.stand)) o.push({ id: 'taxi', label: 'Demande de roulage' });
    if (st === 'taxiOut') o.push({ id: 'departure', label: 'Prêt au départ (point d’attente)' });
    if (st === 'enroute' && distDest < 70000) o.push({ id: 'approach', label: `Demande d’approche ${this.flight.to}` });
    if ((st === 'approach' || st === 'goAround') && this.alongDest() < 16000) o.push({ id: 'landing', label: 'Demande d’atterrissage' });
    if (st === 'landed' && gs < 20) o.push({ id: 'taxiIn', label: 'Demande de roulage vers le poste' });
    if (st === 'taxiIn' || (st === 'landed' && gs < 2)) o.push({ id: 'park', label: 'Au poste, moteurs coupés — fin du vol' });
    o.push({ id: 'atis', label: 'Météo (ATIS)' });
    return o;
  }
  atcRequest(id) {
    const A = this.atc.of(this.flight.from), B = this.atc.of(this.flight.to), cs = this.callsign(), F = this.flight;
    switch (id) {
      case 'startup':
        this.pilotSays(`${A.call('ground')}, ${cs}, poste ${F.gate}, demandons mise en route et repoussage pour ${airport(F.to).city}.`);
        this.say('ground', `${cs}, ${A.call('ground')}, mise en route et repoussage approuvés, piste ${this.depDir.name} en service, QNH ${this.qnh()}, rappelez prêt à rouler.`);
        this.st = 'cleared'; this.lights.beacon = true; this.flight.status = 'boarding'; break;
      case 'push':
        if (this.fm.ctl.parking) { this.toast(`Release the parking brake (${this.input.labelFor('parking')}) for the push-back.`, 'warn', 4); return; }
        this.pilotSays(`${cs}, prêts pour le repoussage.`); this.say('ground', `${cs}, repoussage approuvé.`);
        this.st = 'pushback'; this.pushT = 0; this.pushStart = { x: this.fm.pos.x, z: this.fm.pos.z, hdg: this.stand.hdg }; break;
      case 'taxi': {
        const g = this.from.graph, here = g.nearest(this.fm.pos.x, this.fm.pos.z, (n) => n.kind !== 'rwy' && n.kind !== 'stand');
        const path = g.path(here, this.depDir.entryHold);
        this.showRoute(path);
        this.pilotSays(`${cs}, prêts à rouler.`);
        this.say('ground', `${cs}, roulez point d'attente piste ${this.depDir.name}, suivez le balisage vert, rappelez prêts au départ.`);
        this.st = 'taxiOut'; this.flight.phase = 'taxiOut'; this.lights.nav = true; break;
      }
      case 'departure': {
        const hold = this.from.graph.nodes[this.depDir.entryHold];
        if (Math.hypot(hold.x - this.fm.pos.x, hold.z - this.fm.pos.z) > 120) { this.say('ground', `${cs}, poursuivez jusqu'au point d'attente piste ${this.depDir.name}.`); return; }
        const n = A.requestDeparture('player');
        this.pilotSays(`${A.call('tower')}, ${cs}, point d'attente piste ${this.depDir.name}, prêts au départ.`);
        this.st = 'holding'; this.holdingSaid = false; this.showRoute(null);
        if (n > 0) this.say('tower', `${cs}, maintenez position, numéro ${n + 1} au départ.`);
        break;
      }
      case 'approach': {
        const d = this.alongDest();
        this.pilotSays(`${B.call('approach')}, ${cs}, niveau ${Math.round(this.fm.pos.y * FT / 100)}, demandons l'approche ILS piste ${this.arrDir.name}.`);
        B.arrival('player', Math.max(0, d), 'player');
        if (!B.sequenceOk('player')) { this.say('approach', `${cs}, ${B.call('approach')}, trafic devant, maintenez au point d'attente, attente prévue quelques minutes, ${this.windText()}.`); this.st = 'approach'; this.holdPending = true; }
        else { this.say('approach', `${cs}, ${B.call('approach')}, autorisé approche ILS piste ${this.arrDir.name}, descendez 3000 pieds, QNH ${this.qnh()}.`); this.st = 'approach'; this.holdPending = false; }
        this.fm.ap.ils = this.arrDir.ils; this.flight.phase = 'approach';
        break;
      }
      case 'landing': {
        this.pilotSays(`${B.call('tower')}, ${cs}, établis ILS piste ${this.arrDir.name}.`);
        if (B.landingClearance('player', this.clock)) { this.say('tower', `${cs}, ${this.windText()}, piste ${this.arrDir.name}, autorisé atterrissage.`); this.st = 'final'; this.flight.phase = 'final'; }
        else { this.say('tower', `${cs}, continuez l'approche, trafic sur la piste, rappelez en courte finale.`); this.landPending = true; }
        break;
      }
      case 'taxiIn': {
        const g = this.to.graph; this.stand = this.to.freeStand(); if (this.stand) { this.stand.occupied = 'player'; F.gate = this.stand.gate; }
        const here = g.nearest(this.fm.pos.x, this.fm.pos.z, (n) => n.kind !== 'stand');
        const path = this.stand ? g.path(here, this.stand.node, false) : null; this.showRoute(path);
        this.pilotSays(`${B.call('ground')}, ${cs}, piste dégagée.`);
        this.say('ground', `${cs}, ${B.call('ground')}, roulez vers ${this.stand ? `le poste ${this.stand.gate}` : 'l’aire de trafic'}, suivez le balisage vert.`);
        this.st = 'taxiIn'; this.flight.phase = 'taxiIn'; B.removeArrival('player'); break;
      }
      case 'park': {
        const s = this.stand, d = s ? Math.hypot(s.x - this.fm.pos.x, s.z - this.fm.pos.z) : 999;
        if (d > 25) { this.toast(`Taxi to stand ${s?.gate || ''} first (${Math.round(d)} m).`, 'warn', 4); return; }
        if (this.fm.out.gs > 0.5 || !this.fm.ctl.parking) { this.toast(`Stop and set the parking brake (${this.input.labelFor('parking')}).`, 'warn', 4); return; }
        if (this.fm.engines.some((e) => e.running)) { this.toast(`Shut down the engines (${this.input.labelFor('engines')}).`, 'warn', 4); return; }
        this.say('ground', `${cs}, bien reçu, bienvenue à ${airport(F.to).city}, bonne journée.`);
        this.finish(true); break;
      }
      case 'atis': { const ap = this.nearAirport()?.ap || airport(F.from); this.toast(`ATIS ${ap.icao}: ${this.weather.metar(ap.icao, this.clock)} · RWY ${this.atc.of(ap.id).active().name} · QNH ${this.qnh()}`, 'info', 8); this.say('ground', `Information ${ap.city}, ${this.windText()}, visibilité ${this.weather.visibility() > 9999 ? 'supérieure à dix kilomètres' : `${Math.round(this.weather.visibility())} mètres`}, piste ${this.atc.of(ap.id).active().name} en service, QNH ${this.qnh()}.`, ap.id); break; }
    }
  }
  /** Distance along the arrival ILS course to the aiming point (m). */
  alongDest() { const I = this.arrDir.ils; return -((this.fm.pos.x - I.x) * I.dx + (this.fm.pos.z - I.z) * I.dz); }
  showRoute(path) {
    this.routePath = path; const g = this.guide; let k = 0; const m = new THREE.Matrix4();
    if (path) for (let i = 1; i < path.length && k < 600; i++) {
      const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.floor(L / 14));
      const lay = this.st === 'taxiIn' || this.st === 'landed' ? this.to : this.from;
      for (let j = 0; j < n && k < 600; j++) { const t = j / n; m.makeTranslation(a.x + (b.x - a.x) * t, lay.elev + 0.25, a.z + (b.z - a.z) * t); g.setMatrixAt(k++, m); }
    }
    g.count = k; g.instanceMatrix.needsUpdate = true;
  }

  // ---------------- input ----------------
  handleInput(dt) {
    const I = this.input, fm = this.fm, c = fm.ctl, ap = fm.ap;
    for (const a of I.poll(dt)) {
      switch (a) {
        case 'pause': this.bus.emit('game:pauseToggle'); break;
        case 'flapsDown': fm.flapIdx = Math.min(this.spec.flaps.length - 1, fm.flapIdx + 1); this.airAudio.click(); this.toast(`Flaps ${this.flapLabel(fm.flapIdx)}`, 'info', 1.2); break;
        case 'flapsUp': fm.flapIdx = Math.max(0, fm.flapIdx - 1); this.airAudio.click(); this.toast(`Flaps ${this.flapLabel(fm.flapIdx)}`, 'info', 1.2); break;
        case 'gear': if (fm.onGround && fm.gearCmd) { this.toast('Gear lever locked down on the ground.', 'warn', 2); break; } fm.gearCmd = fm.gearCmd ? 0 : 1; this.airAudio.click(); this.toast(fm.gearCmd ? 'Gear down' : 'Gear up', 'info', 1.2); break;
        case 'parking': c.parking = !c.parking; this.airAudio.click(); this.toast(c.parking ? 'Parking brake set' : 'Parking brake released', 'info', 1.2); break;
        case 'spoilers': if (fm.spoilerCmd > 0) { fm.spoilerCmd = 0; fm.spoilersArmed = false; } else if (!fm.spoilersArmed) fm.spoilersArmed = true; else { fm.spoilersArmed = false; fm.spoilerCmd = 1; } this.toast(fm.spoilerCmd ? 'Speed brake extended' : fm.spoilersArmed ? 'Ground spoilers armed' : 'Speed brake retracted', 'info', 1.5); break;
        case 'reverse': if (fm.onGround) { c.reverse = !c.reverse; this.toast(c.reverse ? 'Reverse thrust' : 'Reverse stowed', 'info', 1.2); } break;
        case 'throttleMax': c.throttle = 1; c.reverse = false; if (ap.at) { ap.at = false; } break;
        case 'throttleIdle': c.throttle = 0; break;
        case 'trimUp': c.trim = clamp(c.trim + 0.03, -0.8, 0.8); break;
        case 'trimDown': c.trim = clamp(c.trim - 0.03, -0.8, 0.8); break;
        case 'engines': if (fm.engines.some((e) => e.running || e.starting > 0)) { fm.stopEngines(); this.toast('Engines shut down', 'info', 2); } else { fm.startEngines(); this.lights.beacon = true; this.toast(`Engine start (${this.spec.kind === 'jet' ? '~30' : '~18'} s)`, 'info', 3); } break;
        case 'ap': if (ap.on) { ap.on = false; this.airAudio.apDisconnect(); this.toast('Autopilot disengaged', 'warn', 1.5); } else if (fm.onGround) this.toast('Autopilot available after take-off.', 'warn', 2); else { ap.engage(true); if (this.route && ap.lat !== 'LNAV') ap.lat = 'LNAV'; this.toast('Autopilot engaged', 'info', 1.5); } break;
        case 'athr': ap.at = !ap.at; if (ap.at) ap.spd = Math.round(fm.out.ias || ap.spd); this.toast(ap.at ? `Autothrust on · ${Math.round(ap.spd * KT)} kt` : 'Autothrust off', 'info', 1.5); break;
        case 'appr': ap.ils = this.arrDir.ils; ap.appArmed = !ap.appArmed; ap.autoland = ap.appArmed; this.toast(ap.appArmed ? `Approach armed: ILS ${this.flight.to} ${this.arrDir.name} (autoland)` : 'Approach disarmed', 'info', 2.5); break;
        case 'lnav': this.buildRoute(); if (ap.lat === 'LNAV') { ap.lat = 'HDG'; ap.hdg = Math.round(fm.out.att.h); } else { ap.route = this.route; ap.lat = 'LNAV'; } this.toast(ap.lat === 'LNAV' ? 'NAV: following the route' : 'HDG mode', 'info', 1.5); break;
        case 'hdgL': ap.hdg = ((ap.hdg - 5) + 360) % 360; if (ap.lat === 'LNAV') ap.lat = 'HDG'; break;
        case 'hdgR': ap.hdg = (ap.hdg + 5) % 360; if (ap.lat === 'LNAV') ap.lat = 'HDG'; break;
        case 'altUp': ap.alt += 500 / FT; ap.vert = 'ALT'; break;
        case 'altDown': ap.alt = Math.max(300 / FT, ap.alt - 500 / FT); ap.vert = 'ALT'; break;
        case 'spdUp': ap.spd += 5 / KT; break;
        case 'spdDown': ap.spd = Math.max(this.spec.vref * 0.95, ap.spd - 5 / KT); break;
        case 'lights': { const on = !this.lights.landing; this.lights.landing = on; this.lights.strobe = on && !fm.onGround ? true : on; this.toast(on ? 'Landing / taxi lights on' : 'Landing lights off', 'info', 1.2); break; }
        case 'atc': { const o = this.atcOptions().filter((x) => x.id !== 'atis'); if (o.length) this.atcRequest(o[0].id); else this.toast('No ATC request available now.', 'info', 2); break; }
        case 'atcMenu': this.bus.emit('air:atcMenu'); break;
        case 'mouseYoke': this.mouseYoke = !this.mouseYoke; this.toast(this.mouseYoke ? 'Mouse flight: the mouse position is the stick (centre = neutral)' : 'Mouse flight off', 'info', 2.5); break;
        case 'camera': this.camMode = AIR_CAMS[(AIR_CAMS.indexOf(this.camMode) + 1) % AIR_CAMS.length]; this.look.yaw = 0; this.look.pitch = this.camMode === 'panel' ? -0.5 : this.camMode === 'pilot' ? -0.17 : 0.15; this.camera.fov = this.camMode === 'panel' ? 48 : 62; this.camera.updateProjectionMatrix(); this.toast(AIR_CAM_LABEL[this.camMode], 'info', 1.2); break;
        case 'map': this.bus.emit('air:map'); break;
        case 'lookBack': this.look.yaw = 0; this.look.pitch = this.camMode === 'panel' ? -0.5 : -0.17; break;
        case 'timeWarp': {
          if (this.mp?.inSession) { this.toast('Time acceleration is disabled online.', 'warn', 2); break; }
          const ok = !fm.onGround && ap.on && fm.pos.y - this.world.ground(fm.pos.x, fm.pos.z) > 1500;
          this.warp = ok ? ({ 1: 2, 2: 4, 4: 8, 8: 1 })[this.warp] : 1; this.toast(ok || this.warp === 1 ? `Time ×${this.warp}` : 'Time acceleration: autopilot on, above 5000 ft AGL', 'info', 1.5); break;
        }
      }
    }
    // Continuous axes: keyboard (smoothed), joystick / gamepad, mouse yoke.
    const ramp = (v, target, rate) => v + clamp(target - v, -rate * dt, rate * dt);
    const kp = (I.isHeld('pitchUp') ? 1 : 0) - (I.isHeld('pitchDown') ? 1 : 0), kr = (I.isHeld('rollRight') ? 1 : 0) - (I.isHeld('rollLeft') ? 1 : 0), ky = (I.isHeld('yawRight') ? 1 : 0) - (I.isHeld('yawLeft') ? 1 : 0);
    this.ctl.elev = ramp(this.ctl.elev, kp * 0.7, kp ? 1.6 : 3); this.ctl.ail = ramp(this.ctl.ail, kr * 0.8, kr ? 2.2 : 4); this.ctl.rud = ramp(this.ctl.rud, ky, ky ? 2 : 4);
    let elev = this.ctl.elev, ail = this.ctl.ail, rud = this.ctl.rud;
    const ax = I.axes || [], dz = (v) => (Math.abs(v || 0) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    if (ax.length >= 2 && (dz(ax[0]) || dz(ax[1]))) { ail = dz(ax[0]); elev = dz(ax[1]); }
    if (ax.length >= 3 && dz(ax[2])) rud = dz(ax[2]);
    if (this.mouseYoke && !this.look.drag) { ail = clamp(this.mouse.x * 1.4, -1, 1); elev = clamp(this.mouse.y * 1.4, -1, 1); }
    // Pilot input overrides the autopilot (disconnect with a firm input).
    if (ap.on && (Math.abs(elev) > 0.35 || Math.abs(ail) > 0.35)) { ap.on = false; this.airAudio.apDisconnect(); this.toast('Autopilot disconnected (pilot input)', 'warn', 2); }
    if (!ap.on) { c.elev = elev; c.ail = ail; }
    c.pilotElev = elev;
    if (!ap.on || fm.onGround) c.rud = rud;
    const tu = I.isHeld('throttleUp') || (I.padButtons?.[7] > 0.3), td = I.isHeld('throttleDown') || (I.padButtons?.[6] > 0.3);
    if (tu || td) { c.throttle = clamp(c.throttle + (tu ? 0.45 : -0.45) * dt, 0, 1); if (ap.at) { ap.at = false; this.toast('Autothrust off (manual thrust)', 'info', 1.5); } }
    c.brake = I.isHeld('brakes') ? 1 : 0;
  }
  flapLabel(i) { const f = this.spec.flaps[i]; return this.spec.flaps.length === 5 ? (i === 0 ? '0 (UP)' : i === 4 ? 'FULL' : String(i)) : String(f); }
  /** Route: departure runway → climb-out fix → destination initial approach fix → final approach fix. */
  buildRoute() {
    const d = this.depDir, a = this.arrDir, I = a.ils, cruise = this.cruiseAlt();
    const out = hdgVec(d.hdg), t = this.from.graph.nodes[d.entry];
    this.route = [
      { x: t.x + out.x * 12000, z: t.z + out.z * 12000, alt: this.from.elev + 1500, name: `${this.flight.from}D` },
      { x: (this.from.ap.x + this.to.ap.x) / 2, z: (this.from.ap.z + this.to.ap.z) / 2, alt: cruise, name: 'MID' },
      { x: I.x - I.dx * 25000, z: I.z - I.dz * 25000, alt: this.to.elev + 1200, name: `${this.flight.to}IAF` },
      { x: I.x - I.dx * 12000, z: I.z - I.dz * 12000, alt: this.to.elev + 700, name: `${this.flight.to}FAF` },
    ];
    if (this.flight.km < 120) this.route.splice(1, 1);
    this.fm.ap.route = this.route; this.fm.ap.wpt = Math.min(this.fm.ap.wpt || 0, this.route.length - 1);
    return this.route;
  }
  cruiseAlt() { return Math.max(this.from.elev, this.to.elev) + Math.max(2500, Math.min(this.spec.ceiling - 1500, 2500 + this.flight.km * 22)); }

  // ---------------- simulation ----------------
  update(dt) {
    if (!this.running) return;
    if (this.paused) { this.render(); return; }
    this.handleInput(dt);
    const fm = this.fm, W = this.warp, sdt = dt * W;
    this.clock += sdt; this.time += sdt;
    this.weather.update(sdt, this.clock, this.camera);
    if (this.st === 'pushback') this.pushback(sdt);
    else { let acc = sdt; while (acc > 1e-6) { const h = Math.min(STEP, acc); fm.step(h); acc -= h; } }
    this.processEvents();
    this.updateMe();
    this.traffic.update(sdt, this.clock);
    this.atcLogic(sdt);
    this.checkRules(sdt);
    this.updateVisuals(dt);
    this.updateCamera(dt);
    this.world.update(dt, this.clock, this.camera, this.weather);
    this.airAudio.update(dt, { n1: fm.out.n1 || [0, 0], ias: fm.out.ias || 0, gs: fm.out.gs || 0, onGround: fm.onGround, exterior: !['pilot', 'panel'].includes(this.camMode), gearPos: fm.gearPos, flapPos: fm.flapPos, rain: this.weather.p.rain, stall: fm.stall, overspeed: (fm.out.ias || 0) > this.spec.vmo, aglFt: (fm.out.agl || 0) * FT, vs: fm.out.vs || 0, reverse: fm.ctl.reverse });
    this.sendNet(dt);
    const snap = this.snapshot();
    this.cockpit.update(dt, snap, fm, this.world.night || 0);
    if (++this.hudN % 3 === 0) this.bus.emit('hud:airUpdate', { ...snap, hud: this.hudState() });
    if (fm.crashed && !this.result) { this.airAudio.crash(); this.finish(false); }
    this.render();
  }
  pushback(dt) {
    // The tug pushes the aircraft back 45 m then turns it through 90° towards the taxi lane.
    const fm = this.fm, P = this.pushStart, hv = hdgVec(P.hdg);
    this.pushT += dt;
    const back = Math.min(45, this.pushT * 1.0), turnK = clamp((this.pushT - 45) / 25, 0, 1);
    const lane = this.from.graph.nodes[this.from.graph.nearest(P.x - hv.x * 60, P.z - hv.z * 60, (n) => n.kind === 'lane')];
    const lanes = this.from.graph.adj[lane.i].map((e) => this.from.graph.nodes[e.to]).filter((n) => n.kind === 'lane');
    const toward = lanes[0] ? ((Math.atan2(lanes[0].x - lane.x, -(lanes[0].z - lane.z)) / D2R) + 360) % 360 : (P.hdg + 90) % 360;
    const hdg = (P.hdg + angDiff(P.hdg, toward) * turnK + 360) % 360;
    const x = P.x - hv.x * back, z = P.z - hv.z * back;
    const eng = fm.engines.map((e) => ({ ...e })); fm.placeOnGround(x, z, hdg); fm.engines.forEach((e, i) => Object.assign(e, eng[i]));
    fm.ctl.parking = false; fm.step(STEP); fm.placeOnGround(x, z, hdg); fm.engines.forEach((e, i) => { e.running = eng[i].running || e.running; });
    const fwd = hdgVec(hdg); this.tug.visible = true; this.tug.position.set(x + fwd.x * (this.spec.length * 0.5 + 3), this.from.elev + 0.8, z + fwd.z * (this.spec.length * 0.5 + 3)); this.tug.rotation.y = -hdg * D2R;
    if (this.pushT > 72) { this.tug.visible = false; if (this.stand) { this.stand.occupied = null; this.stand = null; } this.st = 'ready'; fm.ctl.parking = true; this.toast(`Push-back complete. Parking brake set. Start the engines if not done, then request taxi (${this.input.labelFor('atc')}).`, 'info', 6); this.say('ground', `${this.callsign()}, repoussage terminé, rappelez prêts à rouler.`); }
  }
  processEvents() {
    for (const e of this.fm.takeEvents()) {
      if (e.type === 'liftoff') { this.toast(`Lift-off at ${Math.round(e.ias * KT)} kt`, 'info', 2); this.flight.phase = 'climb'; this.tTakeoff = this.clock; if (this.st !== 'lineup' && !this.cleared.takeoff) this.penalty('Take-off without clearance', 120); }
      if (e.type === 'touchdown') {
        if (e.fpm < 0 || this.clock - (this.tTakeoff ?? -1e9) < 8) continue;   // wheels skimming the runway at rotation
        this.touch = e; this.airAudio.touchdown(e.fpm);
        const atDest = Math.hypot(e.x - this.to.ap.x, e.z - this.to.ap.z) < 5000;
        this.toast(`Touchdown ${Math.round(e.fpm)} ft/min · ${Math.round(e.ias * KT)} kt${e.fpm < 120 ? ' · butter!' : e.fpm < 300 ? ' · smooth' : e.fpm < 600 ? ' · firm' : ' · HARD'}`, e.fpm < 600 ? 'info' : 'warn', 4);
        if (atDest && ['enroute', 'approach', 'final', 'goAround'].includes(this.st)) {
          if (this.st !== 'final') this.penalty('Landing without clearance', 150);
          this.st = 'landed'; this.flight.phase = 'landing'; this.landedAt = this.clock; this.atc.of(this.flight.to).occupy('player', this.clock);
        }
      }
      if (e.type === 'hardLanding') this.penalty(`Hard landing (${Math.round(e.fpm)} ft/min)`, 80);
      if (e.type === 'tailstrike') this.penalty('Tail strike', 120);
      if (e.type === 'overstress') this.penalty(`Over-stress (${e.g.toFixed(1)} g)`, 60);
      if (e.type === 'apDisconnect') { this.airAudio.apDisconnect(); }
      if (e.type === 'crash') this.crashReason = e.reason;
    }
  }
  penalty(text, points) { const p = this.pen.find((x) => x.text === text); if (p) p.count++; else this.pen.push({ text, points, count: 1 }); this.toast(`⚠ ${text}`, 'warn', 4); this.airAudio.caution(); }
  updateMe() {
    const fm = this.fm, o = fm.out, m = this.me;
    m.x = fm.pos.x; m.z = fm.pos.z; m.y = fm.pos.y; m.hdg = o.att?.h ?? 0; m.v = o.gs || 0; m.onGround = fm.onGround; m.phase = this.st;
    // Runway occupancy at the airport the player is on.
    if (fm.onGround) for (const L of [this.from, this.to]) {
      const A = this.atc.of(L.ap.id); let on = false;
      for (const r of L.runways) { const d0 = r.dirs[0], ax = d0.thr.x, az = d0.thr.z, dx = d0.stop.x - ax, dz = d0.stop.z - az, len = Math.hypot(dx, dz), u = ((fm.pos.x - ax) * dx + (fm.pos.z - az) * dz) / len, w = Math.abs((fm.pos.x - ax) * -dz + (fm.pos.z - az) * dx) / len; if (u > -60 && u < len + 60 && w < 40) on = true; }
      this.onRunway = on;
      if (on) { if (!A.occupy('player', this.clock) && !this.incursionSaid && A.runway.occupant !== 'player') { this.incursionSaid = true; this.penalty('Runway incursion', 150); this.say('tower', `${this.callsign()}, stoppez immédiatement, vous êtes sur une piste en service sans autorisation !`, L.ap.id); } }
      else if (A.runway.occupant === 'player') A.release('player');
    }
  }
  atcLogic(dt) {
    const fm = this.fm, A = this.atc.of(this.flight.from), B = this.atc.of(this.flight.to), cs = this.callsign();
    this.atcCheck -= dt; const tick = this.atcCheck <= 0; if (tick) this.atcCheck = 2;
    if (this.st === 'holding' && tick) {
      const c = A.takeoffClearance('player', this.clock);
      if (c.ok) { this.st = 'lineup'; this.cleared.takeoff = true; this.say('tower', `${cs}, ${this.windText()}, piste ${this.depDir.name}, autorisé décollage.`); this.flight.phase = 'lineup'; }
      else if (!this.holdingSaid) { this.holdingSaid = true; this.say('tower', `${cs}, maintenez position, ${c.reason}.`); }
    }
    if (this.st === 'lineup' && !fm.onGround && fm.out.agl > 300) {
      A.release('player'); A.removeDeparture('player'); this.st = 'enroute'; this.flight.phase = 'climb'; this.buildRoute();
      this.say('departure', `${cs}, ${A.call('departure')}, identifié, montez niveau ${Math.round(this.cruiseAlt() * FT / 100)}, direct ${this.flight.to}.`, this.flight.from);
    }
    if (this.st === 'enroute' && tick && !this.approachReminded && Math.hypot(this.to.ap.x - fm.pos.x, this.to.ap.z - fm.pos.z) < 60000) { this.approachReminded = true; this.toast(`${this.flight.to} in 60 km: request the approach (${this.input.labelFor('atc')}).`, 'info', 5); }
    if (['approach', 'final', 'goAround', 'enroute'].includes(this.st) && (this.st !== 'enroute' || B.arrivals.some((a) => a.id === 'player'))) {
      const along = this.alongDest(); B.arrival('player', Math.max(0, along), 'player');
      if (this.st === 'approach' && this.holdPending && tick && B.sequenceOk('player')) { this.holdPending = false; this.say('approach', `${cs}, quittez l'attente, autorisé approche ILS piste ${this.arrDir.name}.`); }
      if (this.landPending && tick && B.landingClearance('player', this.clock)) { this.landPending = false; this.st = 'final'; this.say('tower', `${cs}, ${this.windText()}, piste ${this.arrDir.name}, autorisé atterrissage.`); }
      if ((this.st === 'final' || this.st === 'approach') && along < 900 && along > 0 && !fm.onGround && B.runway.occupant && B.runway.occupant !== 'player') {
        this.st = 'goAround'; this.landPending = false; this.say('tower', `${cs}, remettez les gaz, piste occupée, montez 3000 pieds, rappelez établis.`); this.toast('GO AROUND: TOGA thrust, pitch up, positive climb → gear up', 'warn', 6);
      }
    }
    if (this.st === 'landed' && fm.out.gs < 15 && !this.onRunway) { B.release('player'); }
    if (this.st === 'landed' && !this.vacateSaid && fm.out.gs < 20) { this.vacateSaid = true; this.say('tower', `${cs}, dégagez par la prochaine sortie, contactez le sol.`); }
  }
  checkRules(dt) {
    const fm = this.fm, o = fm.out;
    if (!fm.onGround && fm.pos.y * FT < 10000 && (o.ias || 0) * KT > 260) { this.overT = (this.overT || 0) + dt; if (this.overT > 15) { this.overT = -60; this.penalty('Speed above 250 kt below FL100', 30); } } else this.overT = Math.min(0, this.overT || 0) + dt;
    if (fm.onGround && (o.gs || 0) * KT > 35 && !this.onRunway && !['lineup', 'landed'].includes(this.st)) { this.taxiT = (this.taxiT || 0) + dt; if (this.taxiT > 4) { this.taxiT = -30; this.penalty('Taxi speed above 30 kt', 20); } }
    this.maxG = Math.max(this.maxG, o.g || 1);
    // Fuel / flight status for the boards.
    this.flight.status = this.st;
  }

  // ---------------- visuals ----------------
  updateVisuals(dt) {
    const fm = this.fm, M = this.model;
    M.group.position.set(fm.pos.x, fm.pos.y, fm.pos.z); toQ(fm.q, M.group.quaternion);
    this.cockpit.group.position.copy(M.group.position); this.cockpit.group.quaternion.copy(M.group.quaternion);
    const lights = { ...this.lights, strobe: this.lights.strobe && (!fm.onGround || this.onRunway) };
    M.update({ gear: fm.gearPos, flaps: fm.flapFrac, spoilers: fm.spoilerPos, ail: fm.ctl.ail, elev: fm.ctl.elev, rud: fm.ctl.rud, n1: fm.out.n1 || [0, 0], lights, door: this.st === 'stand' && !fm.engines.some((e) => e.running) ? 1 : 0 }, this.time, dt);
    // AI aircraft: full models near the camera, dots far away.
    const cp = this.camera.position, keep = new Set(), dots = [];
    for (const a of this.traffic.flights.values()) {
      const s = a.state, d = Math.hypot(s.x - cp.x, s.z - cp.z, s.y - cp.y);
      if (d < 22000) {
        keep.add(a.id);
        let m = this.aiModels.get(a.id);
        if (!m) { m = new AircraftModel(a.S, a.f.airline, {}); this.scene.add(m.group); this.aiModels.set(a.id, m); }
        m.group.position.set(s.x, s.y, s.z); toQ(qFromHPB(s.hdg, s.pitch, s.bank), m.group.quaternion);
        m.update(s, this.time, dt);
      } else if (d < 120000) dots.push(s.x - cp.x, s.y - cp.y, s.z - cp.z);
    }
    for (const r of this.remote.values()) {
      const d = Math.hypot(r.x - cp.x, r.z - cp.z, r.y - cp.y), S = AIRCRAFT[r.model] || AIRCRAFT.a320;
      if (d < 22000) { if (!r.model3d) { r.model3d = new AircraftModel(S, this.flight.airline, {}); this.scene.add(r.model3d.group); } r.model3d.group.visible = true; r.model3d.group.position.set(r.x, r.y, r.z); toQ(qFromHPB(r.hdg, r.pitch || 0, r.bank || 0), r.model3d.group.quaternion); r.model3d.update({ gear: r.gear ?? 1, flaps: r.flaps || 0, n1: [0.5, 0.5], lights: { nav: true, beacon: true, strobe: !r.onGround, landing: r.y < 3000 } }, this.time, dt); }
      else { if (r.model3d) r.model3d.group.visible = false; dots.push(r.x - cp.x, r.y - cp.y, r.z - cp.z); }
    }
    for (const [id, m] of this.aiModels) if (!keep.has(id)) { m.dispose(); this.aiModels.delete(id); }
    this.farDots.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3)); this.farDots.geometry = g; this.farDots.position.copy(cp);
    this.farDots.material.color.setScalar(this.world.night > 0.5 ? 1 : 0.85);
  }
  updateCamera(dt) {
    const fm = this.fm, cam = this.camera, M = this.model.group, mode = this.camMode;
    const inside = mode === 'pilot' || mode === 'panel';
    this.cockpit.group.visible = inside; M.visible = !inside;
    const q = M.quaternion;
    if (inside) {
      const eye = this.cockpit.eyeL.clone(); if (mode === 'panel') eye.add(TV2.set(0, -0.12, 0.28));
      cam.position.copy(eye.applyQuaternion(q).add(M.position));
      // Look: yaw / pitch in the aircraft frame (camera looks along body +Z).
      TE.set(this.look.pitch, Math.PI + this.look.yaw, 0, 'YXZ'); TQ.setFromEuler(TE); cam.quaternion.copy(q).multiply(TQ);
    } else if (mode === 'wing') {
      const S = this.spec, side = new THREE.Vector3(S.fuselageR + 0.15, S.fuselageR * 0.25, S.length * 0.02);
      cam.position.copy(side.applyQuaternion(q).add(M.position));
      TE.set(this.look.pitch * 0.5 - 0.15, Math.PI + 1.95 + this.look.yaw, 0, 'YXZ'); TQ.setFromEuler(TE); cam.quaternion.copy(q).multiply(TQ);
    } else if (mode === 'chase') {
      const h = (fm.out.att?.h ?? 0) * D2R; this.chaseH = this.chaseH == null ? h : this.chaseH + angDiff(this.chaseH / D2R, h / D2R) * D2R * Math.min(1, dt * 2.5);
      const back = new THREE.Vector3(-Math.sin(this.chaseH), 0, Math.cos(this.chaseH)).multiplyScalar(this.camDist);
      const want = M.position.clone().add(back).add(TV.set(0, this.camDist * 0.22, 0));
      const g = this.world.ground(want.x, want.z); want.y = Math.max(want.y, g + 3);
      cam.position.lerp(want, Math.min(1, dt * 6)); if (cam.position.distanceTo(want) > this.camDist * 3) cam.position.copy(want);
      cam.lookAt(M.position.x, M.position.y + 2, M.position.z);
    } else if (mode === 'external') {
      const yaw = this.look.yaw + (fm.out.att?.h ?? 0) * -D2R + Math.PI, pitch = clamp(this.look.pitch, -0.2, 1.3);
      cam.position.set(M.position.x + Math.sin(yaw) * Math.cos(pitch) * this.camDist, M.position.y + Math.sin(pitch) * this.camDist, M.position.z - Math.cos(yaw) * Math.cos(pitch) * this.camDist);
      const g = this.world.ground(cam.position.x, cam.position.z); cam.position.y = Math.max(cam.position.y, g + 2);
      cam.lookAt(M.position);
    } else if (mode === 'tower') {
      // Fixed camera beside the runway of the nearest airport (landing / take-off views), zoom with distance.
      const A = this.nearAirport() || this.from, dir = A === this.to ? this.arrDir : A.activeDir(this.weather.wind().dir);
      const t = dir.thr, n = hdgVec(dir.hdg), side = { x: -n.z, z: n.x };
      cam.position.set(t.x + n.x * 600 + side.x * 140, A.elev + 12, t.z + n.z * 600 + side.z * 140);
      cam.lookAt(M.position); const d = cam.position.distanceTo(M.position);
      cam.fov = clamp(2 * Math.atan(this.spec.span * 2.2 / Math.max(1, d)) / D2R, 4, 60); cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
  render() {
    if (!this.scene) return;
    // Two depth ranges (far scenery, then near objects) for precision from 5 cm in the cockpit to 400 km.
    const r = this.renderer, cam = this.camera, auto = r.autoClear;
    r.autoClear = false; r.clear();
    cam.layers.enable(FAR_LAYER); cam.near = 180; cam.far = 600000; cam.updateProjectionMatrix(); r.render(this.scene, cam);
    r.clearDepth();
    // A colour background forces a clear on every render call: none for the near pass.
    const bg = this.scene.background; this.scene.background = null;
    cam.layers.disable(FAR_LAYER); cam.near = this.camMode === 'pilot' || this.camMode === 'panel' ? 0.05 : 0.5; cam.far = 200; cam.updateProjectionMatrix(); r.render(this.scene, cam);
    cam.layers.enable(FAR_LAYER); this.scene.background = bg;
    r.autoClear = auto;
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  setPaused(p) { this.paused = p; if (p) this.audio.suspend(); else this.audio.resume(); this.input.enabled = !p; }

  // ---------------- data for displays / HUD / map ----------------
  snapshot() {
    const fm = this.fm, o = fm.out, att = o.att || { h: 0, p: 0, b: 0 }, ap = fm.ap, S = this.spec;
    const I = this.arrDir.ils, along = this.alongDest(), cross = (fm.pos.x - I.x) * -I.dz + (fm.pos.z - I.z) * I.dx;
    const gsAlt = I.y + Math.tan(3 * D2R) * along + 15;
    const ils = along > 0 && along < 30000 && Math.abs(cross) < 4000 && Math.hypot(this.to.ap.x - fm.pos.x, this.to.ap.z - fm.pos.z) < 32000 ? { loc: -cross / Math.max(150, along * 0.0436) * 2 / 2, gs: (gsAlt - fm.pos.y) / Math.max(20, along * 0.0122) , ident: `I${this.flight.to} ${this.arrDir.name}` } : null;
    const wpt = ap.route?.[ap.wpt], next = wpt ? { name: wpt.name, dist: Math.hypot(wpt.x - fm.pos.x, wpt.z - fm.pos.z) / 1852 } : { name: this.flight.to, dist: Math.hypot(this.to.ap.x - fm.pos.x, this.to.ap.z - fm.pos.z) / 1852 };
    if (o.gs > 20) next.eta = fmtT(this.clock + (next.dist * 1852) / o.gs);
    const traffic = []; for (const a of this.traffic.flights.values()) { if (a.onGround) continue; if (Math.hypot(a.x - fm.pos.x, a.z - fm.pos.z) < 80000) traffic.push({ x: a.x, z: a.z, alt: a.y, vs: a.vs }); }
    const ff = fm.engines.map((e) => (e.running ? (S.fuelBurn / S.engines) * (0.3 + 1.1 * e.n1 * e.n1) : 0));
    const memo = [];
    if (fm.stall && !fm.onGround) memo.push({ text: 'STALL', level: 'warn' });
    if (!fm.onGround && fm.gearPos < 0.5 && (o.agl || 1e9) * FT < 800 && fm.out.vs < -2) memo.push({ text: 'GEAR NOT DOWN', level: 'warn' });
    if (fm.fuel < S.fuelBurn * 0.5) memo.push({ text: 'FUEL LOW', level: 'caution' });
    if (fm.onGround && fm.ctl.parking && fm.ctl.throttle > 0.5) memo.push({ text: 'PARK BRK ON', level: 'caution' });
    if (fm.spoilersArmed) memo.push({ text: 'GND SPLRS ARMED', level: 'memo' });
    if (this.lights.landing) memo.push({ text: 'LDG LT', level: 'memo' });
    const terrain = !fm.onGround && (o.agl || 1e9) < 150 && o.vs < -8 && fm.gearPos < 0.5;
    return {
      ias: (o.ias || 0) * KT, gs: o.gs || 0, tas: o.tas || 0, mach: o.mach || 0, altFt: fm.pos.y * FT, vsFpm: (o.vs || 0) * 60 * FT, aglFt: (o.agl || 0) * FT, alt: fm.pos.y,
      hdg: att.h, pitch: att.p, bank: att.b, beta: o.beta || 0, track: o.gs > 5 ? ((Math.atan2(fm.vel.x, -fm.vel.z) / D2R) + 360) % 360 : att.h,
      vstall: Math.sqrt((2 * fm.mass * 9.81) / (1.225 * S.wingArea * (S.clmax + fm.flapFrac * (S.clmaxFlaps - S.clmax)))) * KT, vmo: S.vmo * KT, vr: S.vr * KT,
      accel: (o.ias - (this.prevIas ?? o.ias)) * KT * 3, onGround: fm.onGround, stall: fm.stall, warn: terrain ? 'PULL UP' : memo.find((m) => m.level === 'warn')?.text,
      ap: { on: ap.on, at: ap.at, lat: ap.lat, vert: ap.vert, hdg: ap.hdg, alt: ap.alt, altFt: ap.alt * FT, spd: ap.spd * KT, spdKt: ap.spd * KT, vsFpm: Math.round(ap.vsTarget * 60 * FT / 100) * 100, appArmed: ap.appArmed, autoland: ap.autoland },
      throttle: fm.ctl.throttle, n1: o.n1 || [], n2: o.n2 || [], egt: fm.engines.map((e) => (e.running ? 380 + e.n1 * 520 : e.starting ? 200 + e.starting * 8 : 20)), ff, engRunning: fm.engines.map((e) => e.running), engStarting: fm.engines.map((e) => e.starting > 0),
      prop: S.kind === 'turboprop', fuel: fm.fuel, flapFrac: fm.flapFrac, flapLabel: this.flapLabel(fm.flapIdx), gear: fm.gearPos, spoilers: fm.spoilerPos, spoilersArmed: fm.spoilersArmed, parking: fm.ctl.parking, brake: fm.ctl.brake, memo,
      ils, ilsLine: { x: I.x, z: I.z, dx: I.dx, dz: I.dz }, x: fm.pos.x, z: fm.pos.z, route: ap.route || this.route, wpt: ap.wpt, next, traffic, wind: this.weather.wind(), baro: this.qnh(),
      airports: AIRPORTS.map((a) => ({ x: a.x, z: a.z, icao: a.icao, dest: a.id === this.flight.to, runways: this.world.layout(a.id).runways.map((r) => ({ ax: r.dirs[0].thr.x, az: r.dirs[0].thr.z, bx: r.dirs[0].stop.x, bz: r.dirs[0].stop.z })) })),
      ndRange: fm.onGround ? 10 : fm.pos.y < 2000 ? 20 : 40,
    };
  }
  hudState() {
    const fm = this.fm; this.prevIas = fm.out.ias;
    return {
      flight: this.flight, st: this.st, clock: this.clock, warp: this.warp, cam: AIR_CAM_LABEL[this.camMode], options: this.atcOptions(), radio: this.radioLog.slice(0, 6),
      weather: { kind: this.weather.kind, label: this.weather.target.label, metar: this.weather.metar((this.nearAirport()?.ap || airport(this.flight.to)).icao, this.clock), vis: this.weather.visibility() },
      distKm: Math.hypot(this.to.ap.x - fm.pos.x, this.to.ap.z - fm.pos.z) / 1000, fuel: fm.fuel, mouseYoke: this.mouseYoke, penalties: this.pen,
      dep: this.depDir.name, arr: this.arrDir.name, gate: this.flight.gate, throttle: fm.ctl.throttle, trim: fm.ctl.trim, reverse: fm.ctl.reverse,
      engines: fm.engines.map((e) => (e.running ? 'run' : e.starting > 0 ? 'start' : 'off')), damage: fm.damage,
    };
  }
  /** Data for the aviation map overlay. */
  mapState() {
    const ac = [...this.traffic.flights.values()].map((a) => ({ x: a.x, z: a.z, alt: a.y, hdg: a.hdg, v: a.v, no: a.f.no, type: a.S.short, from: a.f.from, to: a.f.to, phase: a.phase, ground: a.onGround }));
    for (const r of this.remote.values()) ac.push({ x: r.x, z: r.z, alt: r.y, hdg: r.hdg, v: r.v, no: r.name, type: r.model, remote: true });
    return { me: { x: this.fm.pos.x, z: this.fm.pos.z, alt: this.fm.pos.y, hdg: this.fm.out.att?.h ?? 0, no: this.flight.no }, aircraft: ac, route: this.route || this.buildRoute(), from: this.flight.from, to: this.flight.to, taxi: this.routePath };
  }

  // ---------------- multiplayer ----------------
  sendNet(dt) {
    const mp = this.mp; if (!mp?.inSession) return;
    const fm = this.fm, a = fm.out.att || { h: 0, p: 0, b: 0 };
    mp.sendState({ x: fm.pos.x, y: fm.pos.y, z: fm.pos.z, yaw: a.h * D2R, pitch: a.p, bank: a.b, v: fm.out.gs || 0, gear: fm.gearPos, flaps: fm.flapFrac, st: this.st });
    // Other pilots: drawn as aircraft, part of the ground separation and runway occupancy.
    const seen = new Set();
    for (const r of mp.remotes('aircraft')) {
      const s = r.state; seen.add(r.id);
      let o = this.remote.get(r.id);
      if (!o) { o = { id: `mp-${r.id}`, waitT: 0 }; this.remote.set(r.id, o); }
      Object.assign(o, { x: s.x, y: s.y, z: s.z, hdg: ((s.yaw / D2R) + 360) % 360, pitch: s.pitch, bank: s.bank, v: s.v, gear: s.gear, flaps: s.flaps, name: `${r.name} · ${r.drive.route || ''}`, model: r.drive.model, onGround: s.y - this.world.ground(s.x, s.z) < (AIRCRAFT[r.drive.model]?.gearHeight || 2) + 1.5, phase: s.st });
      // A remote aircraft on a runway occupies it for everyone.
      for (const L of this.world.airports) if (Math.hypot(L.ap.x - o.x, L.ap.z - o.z) < 5000 && o.onGround && o.v > 25) this.atc.of(L.ap.id).occupy(o.id, this.clock);
    }
    for (const [id, o] of this.remote) if (!seen.has(id)) { o.model3d?.dispose(); this.remote.delete(id); }
  }

  // ---------------- end ----------------
  finish(completed) {
    if (this.result) return;
    const fm = this.fm, f = this.flight, sch = f.arr + (f.delay || 0);
    const delayMin = completed ? Math.round((this.clock - sch) / 60) : 0;
    const blockMin = Math.max(10, (this.clock - (this.startClock ?? this.cfg.hour * 3600)) / 60);
    let score = 1000; for (const p of this.pen) score -= p.points * p.count;
    if (this.touch) score -= Math.max(0, (this.touch.fpm - 200) / 4);
    if (delayMin > 5) score -= Math.min(200, (delayMin - 5) * 4);
    score = Math.max(0, Math.round(completed ? score : Math.min(score, 200)));
    this.result = {
      completed, crashed: fm.crashed, crashReason: this.crashReason, flight: f, type: this.spec, score, delayMin, blockMin, landingFpm: this.touch?.fpm ?? null,
      fuelUsed: Math.max(0, this.fuel0 - fm.fuel), penalties: this.pen, maxG: this.maxG, km: f.km, load: this.load, uid: this.cfg.aircraftUid, damage: fm.damage,
    };
    this.running = !fm.crashed;
    this.bus.emit('air:finished', this.result);
  }
  dispose() {
    if (!this.scene) return;
    this.running = false;
    this.airAudio?.stop();
    this.mp?.stopDriving?.();
    for (const m of this.aiModels?.values() || []) m.dispose();
    this.model?.dispose(); this.cockpit?.dispose(); this.weather?.dispose(); this.world?.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.scene = null;
  }
}
