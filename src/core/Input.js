// Action-based input layer: keyboard (rebindable, layout-aware labels) + gamepad.
// Game systems only ever ask about *actions*, never about physical keys.

export const ACTIONS = {
  tractionUp:     { label: 'Increase traction / release brake', keys: ['KeyW', 'ArrowUp'], repeat: true, pad: [7] },
  tractionDown:   { label: 'Reduce traction / apply brake',     keys: ['KeyS', 'ArrowDown'], repeat: true, pad: [6] },
  neutral:        { label: 'Controller to neutral (coast)',     keys: ['KeyN'], pad: [] },
  emergencyBrake: { label: 'Emergency brake',                   keys: ['Space'], pad: [2] },
  doorsOpen:      { label: 'Open doors (platform side)',        keys: ['KeyE'], pad: [0] },
  doorsClose:     { label: 'Close doors',                       keys: ['KeyF'], pad: [1] },
  camera:         { label: 'Change camera',                     keys: ['KeyC'], pad: [3] },
  pause:          { label: 'Pause menu',                        keys: ['Escape'], pad: [9] },
  horn:           { label: 'Horn',                              keys: ['KeyQ'], pad: [4], hold: true },
  vigilance:      { label: 'Acknowledge vigilance',             keys: ['KeyV'], pad: [5] },
  announce:       { label: 'Play next-station announcement',    keys: ['KeyR'], pad: [8] },
  headlights:     { label: 'Headlights high / low',             keys: ['KeyL'], pad: [] },
  cabLight:       { label: 'Cab light',                         keys: ['KeyK'], pad: [] },
  routeSelect:    { label: 'Set route at junction',             keys: ['KeyJ'], pad: [14, 15] },
  lineMap:        { label: 'Show / hide the line map',          keys: ['KeyM'], pad: [] },
  toggleHud:      { label: 'Show / hide HUD',                   keys: ['KeyH'], pad: [] },
  lookBack:       { label: 'Reset view',                        keys: ['KeyX'], pad: [10] },
};

export const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];

const REPEAT_DELAY = 0.32, REPEAT_RATE = 0.16;

export class Input {
  constructor(settings, bus) {
    this.settings = settings;
    this.bus = bus;
    this.down = new Set();         // physical codes held
    this.queue = [];               // actions triggered since last poll
    this.held = {};                // action -> seconds held (for repeat)
    this.padPrev = [];
    this.look = { x: 0, y: 0 };    // right stick
    this.enabled = true;
    this.capture = null;           // rebinding callback
    this.layoutMap = null;
    this.loadBindings();
    navigator.keyboard?.getLayoutMap?.().then((m) => { this.layoutMap = m; }).catch(() => {});

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.down.clear(); this.held = {}; });
  }

  loadBindings() {
    const saved = this.settings.get('controls.bindings') || {};
    this.bindings = {};
    for (const [a, def] of Object.entries(ACTIONS)) this.bindings[a] = saved[a] ? [...saved[a]] : [...def.keys];
  }
  saveBindings() { this.settings.set('controls.bindings', this.bindings); }
  resetBindings() { this.settings.set('controls.bindings', null); this.loadBindings(); }

  /** Wait for the next key press and bind it to `action` (slot 0 = primary, 1 = secondary). */
  rebind(action, slot, done) {
    this.capture = (code) => {
      if (code !== 'Escape') {
        for (const a of Object.keys(this.bindings)) this.bindings[a] = this.bindings[a].filter((c) => c !== code);
        this.bindings[action][slot] = code;
        this.bindings[action] = this.bindings[action].filter(Boolean);
        this.saveBindings();
      }
      this.capture = null;
      done?.();
    };
  }

  keyLabel(code) {
    if (!code) return '—';
    const mapped = this.layoutMap?.get(code);
    if (mapped && mapped.length === 1) return mapped.toUpperCase();
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '↑ ').replace('↑ Down', '↓').replace('↑ Left', '←').replace('↑ Right', '→').replace('↑ Up', '↑');
  }
  labelFor(action) { return (this.bindings[action] || []).map((c) => this.keyLabel(c)).join(' / '); }

  actionsForCode(code) {
    const out = [];
    for (const [a, codes] of Object.entries(this.bindings)) if (codes.includes(code)) out.push(a);
    return out;
  }

  onKey(e, isDown) {
    if (this.capture && isDown) { e.preventDefault(); this.capture(e.code); return; }
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const actions = this.actionsForCode(e.code);
    if (actions.length && this.enabled) e.preventDefault();
    if (isDown) {
      if (this.down.has(e.code)) return; // OS auto-repeat ignored, we do our own
      this.down.add(e.code);
      for (const a of actions) { this.trigger(a); this.held[a] = 0; }
    } else {
      this.down.delete(e.code);
      for (const a of actions) if (!this.isKeyHeld(a)) { delete this.held[a]; this.bus?.emit('input:release', a); }
    }
  }

  isKeyHeld(action) { return (this.bindings[action] || []).some((c) => this.down.has(c)); }
  isHeld(action) { return this.isKeyHeld(action) || this.padHeld?.has(action); }

  trigger(action) { if (this.enabled || action === 'pause') this.queue.push(action); }

  /** Call once per frame. Returns the list of actions triggered this frame. */
  poll(dt) {
    this.pollGamepad();
    for (const a of Object.keys(this.held)) {
      if (!ACTIONS[a]?.repeat || !this.isHeld(a)) continue;
      const t0 = this.held[a];
      const t1 = t0 + dt;
      this.held[a] = t1;
      if (t1 > REPEAT_DELAY) {
        const n0 = Math.floor((t0 - REPEAT_DELAY) / REPEAT_RATE), n1 = Math.floor((t1 - REPEAT_DELAY) / REPEAT_RATE);
        if (t0 <= REPEAT_DELAY || n1 > n0) this.trigger(a);
      }
    }
    const q = this.queue;
    this.queue = [];
    return q;
  }

  pollGamepad() {
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() || [] : []; } catch { pads = []; } // blocked in some embedded frames
    const gp = [...pads].find((p) => p && p.connected);
    this.padHeld = new Set();
    if (!gp) { this.look.x = this.look.y = 0; return; }
    const pressed = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    for (const [a, def] of Object.entries(ACTIONS)) {
      for (const b of def.pad || []) {
        if (pressed[b]) {
          this.padHeld.add(a);
          if (!this.padPrev[b]) { this.trigger(a); this.held[a] = 0; }
        } else if (this.padPrev[b] && !this.isHeld(a)) { delete this.held[a]; this.bus?.emit('input:release', a); }
      }
    }
    // D-pad up/down mirror the triggers for controller notching.
    if (pressed[12] && !this.padPrev[12]) { this.trigger('tractionUp'); this.held.tractionUp = 0; }
    if (pressed[13] && !this.padPrev[13]) { this.trigger('tractionDown'); this.held.tractionDown = 0; }
    if (pressed[12]) this.padHeld.add('tractionUp');
    if (pressed[13]) this.padHeld.add('tractionDown');
    this.padPrev = pressed;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    this.look.x = dz(gp.axes[2] || 0);
    this.look.y = dz(gp.axes[3] || 0);
  }
}
