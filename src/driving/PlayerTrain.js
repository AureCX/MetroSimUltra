// The driven train: glues the master controller, safety systems, doors and physics,
// applying the interlocks a real train has (traction cut-off with doors open, hold brake…).
import { TrainPhysics } from '../physics/TrainPhysics.js';
import { MasterController } from './MasterController.js';
import { DoorSystem } from './DoorSystem.js';
import { SafetySystem } from './SafetySystem.js';

export class PlayerTrain {
  constructor(specs, route, bus, settings) {
    this.specs = specs;
    this.route = route;
    this.bus = bus;
    this.physics = new TrainPhysics(specs, route);
    this.controller = new MasterController(specs, bus);
    this.doors = new DoorSystem(bus);
    this.safety = new SafetySystem(bus, settings);
    this.holdBrake = true;
    this.tractionCut = true;
    this.horn = false;
    this.headlightsHigh = true;
    this.cabLight = false;
  }
  get front() { return this.physics.s; }
  get rear() { return this.physics.s - this.specs.length; }
  get speed() { return this.physics.v; }
  get ebActive() { return this.controller.isEB || this.safety.latched; }

  /** Door centre positions measured backwards from the train front (m). */
  doorOffsets() {
    const sp = this.specs, out = [];
    for (let c = 0; c < sp.cars; c++) {
      const start = c * (sp.carLength + sp.carGap);
      for (const z of sp.doorZ) out.push(start + sp.carLength / 2 - z);
    }
    return out;
  }

  emergency(source = 'driver') {
    this.controller.emergency();
    this.bus.emit('safety:emergency', { reason: source === 'driver' ? 'Emergency brake applied by driver' : source, driver: source === 'driver' });
  }

  update(dt, ctx) {
    const c = this.controller;
    this.safety.update(dt, { v: this.speed, staticLimit: ctx.staticLimit, authorityDist: ctx.authorityDist, brakeRate: ctx.brakeRate, controller: c });
    // Traction interlock: train doors closed & locked, and any external interlock (platform screen doors).
    this.interlockOk = !this.interlock || this.interlock();
    this.tractionCut = !this.doors.locked || !this.interlockOk || this.ebActive;
    if (c.traction > 0) this.holdBrake = false;
    if (Math.abs(this.speed) < 0.2 && c.position <= 0) this.holdBrake = true;
    let traction = this.tractionCut ? 0 : c.traction;
    let brake = c.brake;
    if (this.holdBrake && c.position >= 0) brake = Math.max(brake, 0.4);
    if (this.doors.anyOpen) brake = Math.max(brake, 0.6);
    this.physics.setCommand(traction, brake, this.ebActive);
    this.physics.step(dt);
    this.doors.update(dt);
  }
}
