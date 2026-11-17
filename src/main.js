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

const bus = new EventBus();
const settings = new Settings(bus);
const save = new SaveSystem();
const input = new Input(settings, bus);
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
window.__metro = { game, bus, settings }; // debugging handle

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  game.resize(w, h);
}
window.addEventListener('resize', resize);

const repo = new LineRepository();
let menu;
let state = 'menu'; // menu | playing | paused | summary
let lastSession = null;

async function boot() {
  await repo.load();
  menu = new Menu(document.getElementById('menu'), { repo, settings, save, input, bus, audio });
  menu.on('play', startSession);
  menu.on('resume', () => setPaused(false));
  menu.on('restart', () => lastSession && startSession(lastSession));
  menu.on('quit', quitToMenu);
  menu.show('main');
  game.applyGraphics();
  resize();
}

function startSession(sel) {
  audio.init();
  lastSession = sel;
  menu.showLoading(`Building ${sel.line.name}…`);
  setTimeout(() => {
    try {
      game.start({ ...sel, services: repo.lines.filter((l) => l.sourceId === sel.line.sourceId) });
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
  game.setPaused(p);
  if (p) menu.show('pause'); else menu.hide();
  input.enabled = !p;
}

function quitToMenu() {
  game.setPaused(false);
  game.dispose();
  hud.show(false);
  state = 'menu';
  input.enabled = true;
  menu.show('main');
}

bus.on('game:pauseToggle', () => {
  if (state === 'playing') setPaused(true);
  else if (state === 'paused') {
    if (menu.context === 'pause' && document.querySelector('.menu-pause')) setPaused(false);
    else menu.show('pause');
  }
});
bus.on('game:finished', (r) => {
  const newBest = save.submitRun({ lineId: r.line.id, direction: r.direction, score: r.score, grade: r.grade, distanceKm: r.distanceKm, stations: r.stationsServed, seconds: r.seconds, finalDelay: r.finalDelay });
  setTimeout(() => {
    state = 'summary';
    game.dispose();
    hud.show(false);
    menu.showSummary(r, newBest);
  }, 1500);
});
bus.on('settings:changed', ({ path }) => { if (path.startsWith('graphics') || path === '*') game.applyGraphics(); });

// Escape while in a menu submenu during pause returns to the pause screen; in main menu nothing.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'menu' && !input.capture && !document.querySelector('.menu-main')) menu.show('main');
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'playing' || state === 'paused') game.update(dt);
  else input.poll(dt);
  requestAnimationFrame(frame);
}
boot().then(() => requestAnimationFrame(frame)).catch((e) => {
  console.error(e);
  document.getElementById('menu').innerHTML = `<div class="menu-loading"><p>Failed to start: ${e.message}</p></div>`;
});
