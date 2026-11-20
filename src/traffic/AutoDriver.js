// Deterministic "ideal driver" used by AI trains and by the timetable estimator.
// Returns a desired acceleration (m/s²) to run at line speed and stop precisely at stopR.
export function autoDriveAccel(route, front, v, stopR, length, p = {}) {
  const accel = p.accel ?? 0.95, decel = p.decel ?? 0.8, margin = p.margin ?? 0.94;
  const dist = stopR - front;
  let target = Math.sqrt(Math.max(0, 2 * decel * Math.max(0, dist - 0.15)));
  target = Math.min(target, (route.permittedFor(front, length) / 3.6) * margin);
  if (route.length > 50000) {
    // Long main lines: precomputed braking envelope.
    const E = route.envelope(decel, margin);
    target = Math.min(target, E[Math.max(0, Math.min(E.length - 1, Math.floor(front)))]);
  } else {
    const look = (v * v) / (2 * decel) + 40;
    for (let d = 5; d < look; d += 5) {
      const lim = (route.limitAt(front + d) / 3.6) * margin;
      const allowed = Math.sqrt(lim * lim + 2 * decel * Math.max(0, d - 8));
      if (allowed < target) target = allowed;
    }
  }
  if (p.authority != null) {
    const da = p.authority - front;
    target = Math.min(target, Math.sqrt(Math.max(0, 2 * decel * Math.max(0, da - 2))));
  }
  const err = target - v;
  return err > 0 ? Math.min(accel, err * 1.2 + 0.05) : Math.max(-decel * 1.4, err * 1.6);
}

/** Simulates an ideal run between two stops; returns seconds. */
export function estimateRunTime(route, fromR, toR, length, perf) {
  let s = fromR, v = 0, t = 0;
  const dt = 0.25;
  while (t < 4 * 3600) {
    const a = autoDriveAccel(route, s, v, toR, length, perf);
    v = Math.max(0, v + a * dt);
    s += v * dt;
    t += dt;
    if (toR - s < 0.5 && v < 0.2) break;
  }
  return t;
}
