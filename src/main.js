// Application bootstrap: creates shared services, the renderer and the menu/game state machine.
import * as THREE from 'three';
import './styles.css';
import { EventBus } from './core/EventBus.js';
import { Settings } from './core/Settings.js';
import { SaveSystem } from './core/SaveSystem.js';
import { Input } from './core/Input.js';
import { LineRepository } from './lines/LineRepository.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { Game } from './game/Game.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { BusGame } from './bus/BusGame.js';
import { BusRepository } from './bus/BusRepository.js';
import { BUS_ACTIONS } from './bus/BusControls.js';
import { BusHUD } from './ui/BusHUD.js';
import { BusMenu } from './ui/BusMenu.js';
import { Economy } from './economy/Economy.js';
import { NetworkOverlay } from './ui/NetworkOverlay.js';

const bus = new EventBus();
const settings = new Settings(bus);
const save = new SaveSystem();
const input = new Input(settings, bus);
const busInput = new Input(settings, bus, { actions: BUS_ACTIONS, key: 'controls.busBindings' });
busInput.enabled = false;
const audio = new AudioSystem(settings, bus);

const container = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const hud = new HUD(document.getElementById('hud'), bus, settings, input);
hud.show(false);
const game = new Game({ renderer, bus, settings, input, audio });
const busHud = new BusHUD(document.getElementById('bushud'), bus, settings, busInput);
busHud.show(false);
const busGame = new BusGame({ renderer, bus, settings, input: busInput, audio, save });
const netOverlay = new NetworkOverlay(document.body);
bus.on('ui:networkMap', () => { if (game.netModel && state === 'playing') netOverlay.toggle(game.netModel, () => game.networkState(false)); });
let active = game; // the session currently running (metro or bus)
window.__metro = { game, busGame, bus, settings }; // debugging handle

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  game.resize(w, h);
  busGame.resize(w, h);
}
window.addEventListener('resize', resize);

const repo = new LineRepository();
const busRepo = new BusRepository();
let busMenu;
let menu;
let economy;
let state = 'menu'; // menu | playing | paused | summary
let lastSession = null;

async function boot() {
  await repo.load();
  await busRepo.load();
  economy = new Economy(save, { train: repo.trains, bus: busRepo.vehicles });
  game.economy = economy; busGame.economy = economy;
  window.__metro.economy = economy;
  menu = new Menu(document.getElementById('menu'), { repo, settings, save, input, bus, audio, busInput, economy, busRepo });
  menu.on('play', startSession);
  menu.on('resume', () => setPaused(false));
  menu.on('restart', () => lastSession && startSession(lastSession));
  menu.on('quit', quitToMenu);
  busMenu = new BusMenu(menu, busRepo, save, busInput, settings);
  menu.on('bus', () => busMenu.show());
  menu.on('busPlay', startBus);
  menu.show('main');
  game.applyGraphics();
  resize();
}

function startBus(cfg) {
  audio.init();
  lastSession = { bus: cfg };
  menu.showLoading(`Building ${cfg.route ? `${cfg.route.route} ${cfg.route.name}` : 'the bus world'}…`);
  setTimeout(() => {
    try {
      if (active === game) game.dispose();
      busGame.start(cfg);
      active = busGame;
      resize(); menu.hide(); hud.show(false); busHud.show(true);
      input.enabled = false; input.queue = [];
      busInput.enabled = true; busInput.queue = []; menu.controlsTab = 'bus';
      state = 'playing';
    } catch (e) {
      console.error(e);
      busMenu.show();
      menu.notice(`Could not start: ${e.message}`);
    }
  }, 30);
}

function startSession(sel) {
  if (sel.bus) { startBus(sel.bus); return; }
  audio.init();
  busGame.dispose(); busHud.show(false); busInput.enabled = false; active = game; input.queue = [];
  lastSession = sel;
  hud.setMapOpen(false); game.mapTarget = null; netOverlay.close();
  menu.showLoading(`Building ${sel.line.name}…`);
  setTimeout(() => {
    try {
      game.start({ ...sel, services: repo.lines.filter((l) => l.sourceId === sel.line.sourceId), network: repo.lines.filter((l) => l.network === sel.line.network) });
      game.applyGraphics();
      resize();
      menu.hide();
      hud.show(true);
      state = 'playing';
      input.enabled = true;
    } catch (e) {
      console.error(e);
      menu.show('main');
      menu.notice(`Could not start: ${e.message}`);
    }
  }, 30);
}

function setPaused(p) {
  if (state !== 'playing' && state !== 'paused') return;
  state = p ? 'paused' : 'playing';
  active.setPaused(p);
  if (p) menu.show('pause'); else menu.hide();
  if (active === game) input.enabled = !p; else busInput.enabled = !p;
}

function quitToMenu() {
  hud.setMapOpen(false); game.mapTarget = null; netOverlay.close();
  active.setPaused(false);
  active.dispose();
  hud.show(false); busHud.show(false); busInput.enabled = false; active = game;
  state = 'menu';
  input.enabled = true;
  menu.show('main');
}

bus.on('ui:lineMap', () => {
  if (state !== 'playing') return;
  const open = !hud.mapOpen;
  hud.setMapOpen(open);
  game.mapTarget = open ? hud.mapCanvas : null;
  game.mapAcc = 1;
});
bus.on('game:pauseToggle', () => {
  if (state === 'playing') setPaused(true);
  else if (state === 'paused') {
    if (menu.context === 'pause' && document.querySelector('.menu-pause')) setPaused(false);
    else menu.show('pause');
  }
});
bus.on('game:finished', (r) => {
  const newBest = save.submitRun({ lineId: r.line.id, direction: r.direction, score: r.score, grade: r.grade, distanceKm: r.distanceKm, stations: r.stationsServed, seconds: r.seconds, finalDelay: r.finalDelay });
  // Money & vehicle wear.
  if (r.vehicleUid && economy.vehicle(r.vehicleUid)) {
    r.settlement = economy.settleMetro({ ...r, label: `${r.line.number} · ${r.vehicleUid}`, uid: r.vehicleUid });
    r.vehicleAfter = economy.wear(r.vehicleUid, { km: r.distanceKm, incidents: r.incidents || 0, crash: !!r.crashed });
  }
  setTimeout(() => {
    state = 'summary';
    game.dispose();
    hud.show(false);
    menu.showSummary(r, newBest);
  }, 1500);
});
bus.on('bus:finished', (r) => {
  setTimeout(() => {
    state = 'summary';
    busGame.dispose(); busHud.show(false); busInput.enabled = false; active = game;
    busMenu.summary(r);
  }, 1200);
});
bus.on('settings:changed', ({ path }) => { if (path.startsWith('graphics') || path === '*') game.applyGraphics(); });

// Escape while in a menu submenu during pause returns to the pause screen; in main menu nothing.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'menu' && !input.capture && !document.querySelector('.menu-main')) menu.show('main');
});

// Visible error report: a problem in one part of a frame is shown on screen (and in the console) instead of
// silently freezing the game, so it can be reported.
const shownErrors = new Set();
function showError({ where, message, stack }) {
  const key = `${where}:${message}`;
  if (shownErrors.has(key) || shownErrors.size > 4) return;
  shownErrors.add(key);
  const el = document.createElement('div');
  el.className = 'app-error';
  el.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);max-width:min(760px,92vw);background:#3a0f0f;color:#ffd9d4;border:1px solid #ff6a4a;border-radius:8px;padding:10px 14px;font:13px/1.4 system-ui,sans-serif;z-index:9999;cursor:pointer';
  el.textContent = `Error in ${where}: ${message}${stack ? ` — ${stack}` : ''} (click to dismiss)`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 20000);
}
bus.on('app:error', showError);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame); // schedule first: an exception below must not end the loop
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    if (state === 'playing' || state === 'paused') active.update(dt);
    else input.poll(dt);
  } catch (e) {
    console.error(e);
    showError({ where: active === game ? 'metro' : 'bus', message: String(e?.message || e), stack: String(e?.stack || '').split('\n').slice(1, 3).join(' | ') });
  }
}
boot().then(() => requestAnimationFrame(frame)).catch((e) => {
  console.error(e);
  document.getElementById('menu').innerHTML = `<div class="menu-loading"><p>Failed to start: ${e.message}</p></div>`;
});
