// Automatic train operation (automated lines such as Line D): regulates speed to the static profile and the
// movement authority, stops precisely at the marker, opens the doors on the platform side, closes them
// once departure is authorised, then departs. Acts only through the master controller and door commands,
// so ATP, door interlocks and scoring work exactly as for a human driver.
import { autoDriveAccel } from '../traffic/AutoDriver.js';

export class ATO {
  constructor({ player, stations, route, specs, openDoors }) {
    Object.assign(this, { player, stations, route, specs, openDoors });
    this.closing = false;
  }

  step(authority) {
    const p = this.player, c = p.controller, sm = this.stations, sp = this.specs;
    if (c.isEB || p.safety.latched || sm.finished) return;
    p.safety.acknowledgeVigilance();
    if (sm.atStop != null) {
      const d = sm.dwell, stp = this.route.stops[sm.atStop];
      if (!d.opened) { c.set(-c.bNotches); if (p.doors.locked && Math.abs(p.speed) < 0.05) this.openDoors(stp.doorSide); return; }
      if (!d.authorized) { c.set(-c.bNotches); return; }
      if (!p.doors.locked) { c.set(-c.bNotches); if (p.doors.anyOpen && !this.closing) { this.closing = true; p.doors.close(); } return; }
      this.closing = false;
    }
    const k = sm.atStop != null ? sm.atStop + 1 : sm.nextStop;
    const target = this.route.stops[k];
    if (!target) { c.set(-c.bNotches); return; }
    const a = autoDriveAccel(this.route, p.front, p.speed, target.stopR, sp.length, { accel: 0.85, decel: 0.7, margin: 0.95, authority });
    const maxA = Math.max(0.5, sp.maxAccel || 1);
    let notch = 0;
    if (a > 0.04) notch = Math.min(c.pNotches, Math.ceil((a / maxA) * c.pNotches));
    else if (a < -0.03) notch = -Math.min(c.bNotches, Math.ceil((-a / sp.serviceDecel) * c.bNotches));
    if (Math.abs(p.speed) < 0.05 && target.stopR - p.front < 0.6) notch = -c.bNotches;
    c.set(notch);
  }
}
