// Combined traction/brake master controller (single lever), notched:
// EB | B7 … B1 | N | P1 … P4   (notch counts configurable per train)
export class MasterController {
  constructor(specs, bus) {
    this.bus = bus;
    this.pNotches = specs.tractionNotches;
    this.bNotches = specs.brakeNotches;
    this.EB = -(this.bNotches + 1);
    this.position = -this.bNotches; // start fully braked
  }
  get isEB() { return this.position === this.EB; }
  get traction() { return this.position > 0 ? this.position / this.pNotches : 0; }
  get brake() { return this.position < 0 && !this.isEB ? -this.position / this.bNotches : 0; }
  label(pos = this.position) {
    if (pos === this.EB) return 'EB';
    if (pos < 0) return `B${-pos}`;
    if (pos > 0) return `P${pos}`;
    return 'N';
  }
  set(pos) {
    const p = Math.max(this.EB, Math.min(this.pNotches, pos));
    if (p === this.position) return false;
    this.position = p;
    this.bus.emit('controller:notch', { position: p, label: this.label() });
    return true;
  }
  up() { return this.set(this.position + 1); }
  down() { return this.set(Math.max(this.position - 1, -this.bNotches)); } // EB only via dedicated action
  neutral() { return this.set(0); }
  emergency() { return this.set(this.EB); }
  /** All notches from EB to max traction (used for cab labels & HUD). */
  all() { const a = []; for (let p = this.EB; p <= this.pNotches; p++) a.push(p); return a; }
}
