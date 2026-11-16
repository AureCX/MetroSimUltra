// Train protection: speed supervision (ATP), end-of-authority braking curve,
// signal-passed-at-danger trips, vigilance (dead-man) device and emergency brake latch.
const WARN_MARGIN = 3, TRIP_MARGIN = 7;          // km/h above permitted speed
const VIG_PERIOD = 25, VIG_GRACE = 5;           // s

export class SafetySystem {
  constructor(bus, settings) {
    this.bus = bus;
    this.settings = settings;
    this.latched = false;
    this.latchReason = null;
    this.overspeed = 'none';      // none | warning | trip
    this.overspeedTime = 0;
    this.vigTimer = 0;
    this.vigAlarm = false;
    this.permitted = 0;           // km/h, supervised speed
    this.staticLimit = 0;
    this.authority = null;        // { distance, target }
  }
  get atpOn() { return this.settings.get('gameplay.atp'); }

  trip(reason) {
    if (this.latched) return;
    this.latched = true; this.latchReason = reason;
    this.bus.emit('safety:emergency', { reason });
  }
  acknowledgeVigilance() {
    const was = this.vigAlarm;
    this.vigTimer = 0; this.vigAlarm = false;
    if (was) this.bus.emit('safety:vigilanceAck');
  }

  /** ctx: { v (m/s), staticLimit (km/h), authorityDist (m|null), brakeRate, controller } */
  update(dt, ctx) {
    const vk = Math.abs(ctx.v) * 3.6;
    this.staticLimit = ctx.staticLimit;
    let permitted = ctx.staticLimit;
    this.authority = null;
    if (ctx.authorityDist != null) {
      const d = Math.max(0, ctx.authorityDist);
      const curve = Math.sqrt(2 * ctx.brakeRate * d) * 3.6;
      this.authority = { distance: d, target: 0 };
      // Release speed lets the driver creep up to a red signal.
      permitted = Math.min(permitted, Math.max(curve, d > 3 ? 12 : 0));
    }
    this.permitted = permitted;

    const prev = this.overspeed;
    if (vk > permitted + TRIP_MARGIN && vk > 3) this.overspeed = 'trip';
    else if (vk > permitted + WARN_MARGIN && vk > 3) this.overspeed = 'warning';
    else this.overspeed = 'none';
    if (this.overspeed !== 'none') this.overspeedTime += dt;
    if (this.overspeed !== prev) this.bus.emit('safety:overspeed', { level: this.overspeed, speed: vk, permitted });
    if (this.overspeed === 'trip' && this.atpOn) this.trip('ATP overspeed intervention');

    // Vigilance device.
    if (this.settings.get('gameplay.vigilance') && vk > 2) {
      this.vigTimer += dt;
      if (!this.vigAlarm && this.vigTimer > VIG_PERIOD) { this.vigAlarm = true; this.bus.emit('safety:vigilance'); }
      if (this.vigAlarm && this.vigTimer > VIG_PERIOD + VIG_GRACE) { this.vigAlarm = false; this.vigTimer = 0; this.trip('Vigilance not acknowledged'); }
    } else if (this.vigAlarm && !this.settings.get('gameplay.vigilance')) { this.vigAlarm = false; this.vigTimer = 0; }

    // Latch release: train at stand and controller in a braking position.
    if (this.latched && Math.abs(ctx.v) < 0.01 && ctx.controller.position < 0 && !ctx.controller.isEB) {
      this.latched = false; this.latchReason = null;
      this.bus.emit('safety:reset');
    }
  }
}
