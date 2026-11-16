// Door control: opening only on the platform side when stopped and aligned, audible
// warning before closing, obstruction detection, and a traction interlock
// ("doors closed & locked") consumed by the driving logic.
const OPEN_TIME = 2.2, WARN_TIME = 2.4, CLOSE_TIME = 2.6;

export class DoorSystem {
  constructor(bus) {
    this.bus = bus;
    this.sides = { left: this._side(), right: this._side() };
    this.obstructionCheck = null; // () => boolean, injected (passengers still boarding?)
  }
  _side() { return { state: 'closed', t: 0, amount: 0, retries: 0 }; }
  get locked() { return this.sides.left.state === 'closed' && this.sides.right.state === 'closed'; }
  get anyOpen() { return !this.locked; }
  get status() {
    const l = this.sides.left.state, r = this.sides.right.state;
    if (l === 'closed' && r === 'closed') return 'locked';
    for (const st of ['closing', 'warning', 'opening', 'open']) if (l === st || r === st) return st;
    return 'open';
  }
  openSide() { return this.sides.left.state !== 'closed' ? 'left' : this.sides.right.state !== 'closed' ? 'right' : null; }

  /** @param ctx { speed, alignment: { ok, side, reason } } */
  open(side, ctx) {
    if (Math.abs(ctx.speed) > 0.05) return this._refuse('Doors cannot open while moving.');
    if (!ctx.alignment.ok) return this._refuse(ctx.alignment.reason || 'Not stopped at a platform.');
    if (side !== ctx.alignment.side) return this._refuse(`No platform on the ${side} side — door release refused.`, true);
    const d = this.sides[side];
    if (d.state === 'open' || d.state === 'opening') return { ok: true };
    d.state = 'opening'; d.t = 0; d.retries = 0;
    this.bus.emit('doors:opening', { side });
    return { ok: true };
  }
  _refuse(reason, wrongSide = false) { this.bus.emit('doors:refused', { reason, wrongSide }); return { ok: false, reason }; }

  close() {
    let any = false;
    for (const [side, d] of Object.entries(this.sides)) {
      if (d.state === 'open' || d.state === 'opening') { d.state = 'warning'; d.t = 0; any = true; this.bus.emit('doors:warning', { side }); }
    }
    return any;
  }

  update(dt) {
    for (const [side, d] of Object.entries(this.sides)) {
      d.t += dt;
      switch (d.state) {
        case 'opening':
          d.amount = Math.min(1, d.amount + dt / OPEN_TIME);
          if (d.amount >= 1) {
            if (d.autoReclose) { d.autoReclose = false; d.state = 'warning'; d.t = 0; this.bus.emit('doors:warning', { side }); }
            else { d.state = 'open'; this.bus.emit('doors:open', { side }); }
          }
          break;
        case 'warning':
          if (d.t >= WARN_TIME) { d.state = 'closing'; d.t = 0; this.bus.emit('doors:closing', { side }); }
          break;
        case 'closing':
          d.amount = Math.max(0, d.amount - dt / CLOSE_TIME);
          if (d.amount < 0.35 && d.retries < 2 && this.obstructionCheck?.(side)) {
            d.retries++; d.state = 'opening'; d.autoReclose = true;
            this.bus.emit('doors:obstructed', { side });
            break;
          }
          if (d.amount <= 0) { d.state = 'closed'; this.bus.emit('doors:closed', { side }); if (this.locked) this.bus.emit('doors:locked'); }
          break;
        default: break;
      }
    }
  }
}
