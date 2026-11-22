// Glass-cockpit displays drawn on 2D canvases (used as textures in the 3D cockpit and copied into the HUD):
// PFD (attitude, speed and altitude tapes, vertical speed, heading, flight-mode annunciator, ILS deviation),
// ND (heading arc, route, airports, traffic, wind, range rings) and ECAM / EICAS (engines, fuel, flaps, gear,
// warnings). `s` is the flight snapshot built by the game every frame.
const D2R = Math.PI / 180;
const C = { bg: '#05080c', sky: '#2a74c8', ground: '#7a4a22', white: '#f2f5f8', green: '#38e86a', amber: '#ffb000', cyan: '#3fd7ff', magenta: '#ff4fe0', red: '#ff3a2a', grey: '#7d8a96', tape: '#3a4552' };

function txt(g, s, x, y, col = C.white, size = 18, align = 'center', font = 'bold') { g.fillStyle = col; g.font = `${font} ${size}px "Consolas","DejaVu Sans Mono",monospace`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }

/** Primary flight display (512 × 512). */
export function drawPFD(g, s) {
  const W = 512, H = 512; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const cx = 250, cy = 250, R = 150;
  // Attitude: horizon rotated by bank, shifted by pitch (5 px / deg).
  g.save(); g.beginPath(); g.rect(cx - R, cy - R + 10, R * 2, R * 2 - 20); g.clip();
  g.translate(cx, cy); g.rotate(-s.bank * D2R); const py = s.pitch * 5;
  g.fillStyle = C.sky; g.fillRect(-400, -800 + py, 800, 800); g.fillStyle = C.ground; g.fillRect(-400, py, 800, 800);
  g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(-400, py); g.lineTo(400, py); g.stroke();
  for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const y = py - p * 5, w = p % 10 === 0 ? 60 : p % 5 === 0 ? 34 : 16; g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke(); if (p % 10 === 0) { txt(g, String(Math.abs(p)), -w / 2 - 16, y, C.white, 14); txt(g, String(Math.abs(p)), w / 2 + 16, y, C.white, 14); } }
  g.restore();
  // Bank scale and pointer.
  g.strokeStyle = C.white; g.lineWidth = 2;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const r1 = R - 6, r2 = a % 30 === 0 ? R + 10 : R + 4, t = (a - 90) * D2R; g.beginPath(); g.moveTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2); g.stroke(); }
  g.save(); g.translate(cx, cy); g.rotate(-s.bank * D2R); g.fillStyle = Math.abs(s.bank) > 35 ? C.amber : C.white; g.beginPath(); g.moveTo(0, -R + 8); g.lineTo(-9, -R + 22); g.lineTo(9, -R + 22); g.fill();
  // Sideslip index.
  g.fillRect(-10 + (s.beta || 0) * 60, -R + 24, 20, 5); g.restore();
  // Aircraft symbol.
  g.fillStyle = C.amber; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  for (const sx of [-1, 1]) { g.beginPath(); g.rect(cx + sx * 40 - (sx > 0 ? 0 : 50), cy - 4, 50, 8); g.fill(); g.stroke(); }
  g.fillRect(cx - 5, cy - 5, 10, 10);
  // Flight director (when the autopilot is engaged).
  if (s.ap?.on) { g.strokeStyle = C.green; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 70, cy + (s.fdPitch || 0) * 5); g.lineTo(cx + 70, cy + (s.fdPitch || 0) * 5); g.moveTo(cx + (s.fdRoll || 0) * 3, cy - 70); g.lineTo(cx + (s.fdRoll || 0) * 3, cy + 70); g.stroke(); }
  // ILS deviation scales.
  if (s.ils) {
    g.strokeStyle = C.white; g.fillStyle = C.magenta;
    for (let k = -2; k <= 2; k++) { if (!k) continue; g.beginPath(); g.arc(cx + k * 30, cy + R + 2, 3, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + R + 12, cy + k * 30, 3, 0, 7); g.stroke(); }
    const loc = Math.max(-2.3, Math.min(2.3, s.ils.loc)), gs = Math.max(-2.3, Math.min(2.3, s.ils.gs));
    g.beginPath(); g.moveTo(cx + loc * 30, cy + R - 6); g.lineTo(cx + loc * 30 + 8, cy + R + 2); g.lineTo(cx + loc * 30, cy + R + 10); g.lineTo(cx + loc * 30 - 8, cy + R + 2); g.fill();
    g.beginPath(); g.moveTo(cx + R + 4, cy - gs * 30); g.lineTo(cx + R + 12, cy - gs * 30 - 8); g.lineTo(cx + R + 20, cy - gs * 30); g.lineTo(cx + R + 12, cy - gs * 30 + 8); g.fill();
    txt(g, s.ils.ident || 'ILS', 40, 470, C.magenta, 15, 'left');
  }
  // Speed tape (left).
  const tape = (x, w, val, step, px, label, colLimits) => {
    g.fillStyle = C.tape; g.fillRect(x, 90, w, 320); g.save(); g.beginPath(); g.rect(x, 90, w, 320); g.clip();
    const base = Math.floor(val / step) * step;
    for (let v = base - step * 8; v <= base + step * 8; v += step) { const y = cy - (v - val) * px; g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(label === 'spd' ? x + w - 12 : x, y); g.lineTo(label === 'spd' ? x + w : x + 12, y); g.stroke(); if (v % (step * 2) === 0 && v >= 0) txt(g, String(v), label === 'spd' ? x + w / 2 - 6 : x + w / 2 + 6, y, C.white, 16); }
    colLimits?.(base); g.restore();
  };
  const ias = s.ias || 0, spx = 4;
  tape(18, 72, Math.round(ias), 10, spx, 'spd', () => {
    // Stall band (red/black) below the stall speed, overspeed above VMO, target speed bug.
    g.fillStyle = C.red; const ys = cy - (s.vstall - ias) * spx; g.fillRect(84, ys, 6, 400);
    const yo = cy - (s.vmo - ias) * spx; g.fillRect(84, yo - 400, 6, 400);
    if (s.ap?.spd) { const yb = cy - (s.ap.spd - ias) * spx; g.fillStyle = C.magenta; g.beginPath(); g.moveTo(90, yb); g.lineTo(78, yb - 8); g.lineTo(78, yb + 8); g.fill(); }
    if (s.vr && s.onGround) { const yr = cy - (s.vr - ias) * spx; txt(g, 'R', 74, yr, C.cyan, 14); }
  });
  // Speed trend arrow.
  if (Math.abs(s.accel || 0) > 0.3) { g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath(); g.moveTo(96, cy); g.lineTo(96, cy - s.accel * 10 * spx); g.stroke(); }
  g.fillStyle = '#000'; g.strokeStyle = C.white; g.fillRect(14, cy - 16, 80, 32); g.strokeRect(14, cy - 16, 80, 32); txt(g, String(Math.round(ias)), 54, cy, ias < s.vstall + 5 && !s.onGround ? C.red : C.white, 22);
  txt(g, s.mach > 0.4 ? `M.${String(Math.round(s.mach * 1000)).padStart(3, '0').slice(0, 3)}` : `GS ${Math.round(s.gs)}`, 54, 430, C.green, 15);
  // Altitude tape (right) and the selected altitude.
  const alt = s.altFt || 0;
  tape(410, 74, Math.round(alt / 20) * 20, 100, 0.4, 'alt', () => { if (s.ap?.alt != null) { const yb = cy - (s.ap.altFt - alt) * 0.4; g.fillStyle = C.cyan; g.fillRect(410, yb - 3, 10, 6); } });
  g.fillStyle = '#000'; g.fillRect(406, cy - 16, 84, 32); g.strokeRect(406, cy - 16, 84, 32); txt(g, String(Math.round(alt / 10) * 10), 448, cy, C.green, 20);
  txt(g, s.ap?.altFt != null ? String(Math.round(s.ap.altFt / 100) * 100) : '', 448, 76, C.cyan, 17);
  txt(g, `${Math.round(s.baro || 1013)} hPa`, 448, 428, C.cyan, 13);
  // Vertical speed (far right).
  g.fillStyle = C.tape; g.fillRect(490, 140, 20, 220); const vs = s.vsFpm || 0, vy = cy - Math.sign(vs) * Math.min(105, Math.sqrt(Math.abs(vs)) * 2.3);
  g.strokeStyle = Math.abs(vs) > 6000 ? C.amber : C.green; g.lineWidth = 3; g.beginPath(); g.moveTo(510, cy); g.lineTo(492, vy); g.stroke();
  if (Math.abs(vs) > 200) txt(g, String(Math.round(Math.abs(vs) / 100)), 500, vs > 0 ? 130 : 370, C.green, 13);
  // Radio altitude.
  if (s.aglFt < 2500 && !s.onGround) txt(g, String(Math.max(0, Math.round(s.aglFt / (s.aglFt > 50 ? 10 : 1)) * (s.aglFt > 50 ? 10 : 1))), cx, cy + 118, s.aglFt < (s.dh || 200) ? C.amber : C.green, 22);
  // Heading tape (bottom).
  g.fillStyle = C.tape; g.fillRect(100, 430, 300, 40); g.save(); g.beginPath(); g.rect(100, 430, 300, 40); g.clip();
  const hdg = s.hdg || 0;
  for (let h = Math.floor(hdg / 5) * 5 - 40; h <= hdg + 40; h += 5) { const x = cx - (((hdg - h) % 360 + 540) % 360 - 180) * 4; const hh = (h + 360) % 360; g.strokeStyle = C.white; g.beginPath(); g.moveTo(x, 430); g.lineTo(x, h % 10 === 0 ? 442 : 436); g.stroke(); if (hh % 10 === 0) txt(g, String(hh / 10).padStart(2, '0'), x, 456, C.white, 15); }
  if (s.ap?.hdg != null) { const x = cx - (((hdg - s.ap.hdg) % 360 + 540) % 360 - 180) * 4; g.fillStyle = C.cyan; g.fillRect(x - 3, 430, 6, 10); }
  g.restore(); g.fillStyle = C.amber; g.fillRect(cx - 1, 426, 2, 22);
  // FMA (top row): A/THR mode, vertical, lateral, approach, AP state.
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 60); g.strokeStyle = C.grey; g.lineWidth = 1;
  for (const x of [100, 200, 310, 410]) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 56); g.stroke(); }
  const ap = s.ap || {};
  txt(g, ap.at ? 'SPEED' : s.throttle > 0.9 && s.onGround ? 'TOGA' : 'MAN', 50, 18, ap.at ? C.green : C.white, 15);
  txt(g, ap.on ? (ap.vert === 'GS' ? 'G/S' : ap.vert === 'FLARE' ? 'FLARE' : ap.vert === 'VS' ? `V/S${ap.vsFpm >= 0 ? '+' : ''}${ap.vsFpm}` : 'ALT') : '', 150, 18, C.green, 15);
  txt(g, ap.on ? (ap.lat === 'LOC' ? 'LOC' : ap.lat === 'LNAV' ? 'NAV' : 'HDG') : '', 255, 18, C.green, 15);
  txt(g, ap.appArmed && ap.lat !== 'LOC' ? 'LOC  G/S' : '', 255, 40, C.cyan, 13);
  txt(g, ap.autoland ? 'LAND' : ap.appArmed ? 'CAT 3' : '', 360, 18, C.white, 15);
  txt(g, `${ap.on ? 'AP1' : ''}`, 460, 16, C.white, 15); txt(g, ap.at ? 'A/THR' : '', 460, 40, C.white, 13);
  // Warnings over the attitude.
  if (s.stall && !s.onGround) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(cx - 80, cy - 70, 160, 34); txt(g, 'STALL', cx, cy - 53, C.red, 26); }
  else if (s.warn) txt(g, s.warn, cx, cy - 60, C.red, 20);
}

/** Navigation display (512 × 512): heading-up arc with route, airports and traffic. */
export function drawND(g, s) {
  const W = 512, H = 512; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const cx = 256, cy = 400, R = 330, range = s.ndRange || 40;   // NM shown to the arc
  const pxPerM = R / (range * 1852), hdg = s.hdg || 0, tr = s.track ?? hdg;
  const toScreen = (x, z) => { const dx = x - s.x, dz = z - s.z, a = -hdg * D2R; const e = dx * Math.cos(a) - (-dz) * Math.sin(a), n = dx * Math.sin(a) + (-dz) * Math.cos(a); return [cx + e * pxPerM, cy - n * pxPerM]; };
  // Compass arc.
  g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85); g.stroke();
  for (let h = 0; h < 360; h += 5) { const a = (h - hdg) * D2R; if (Math.abs(((h - hdg + 540) % 360) - 180) > 50) continue; const x1 = cx + Math.sin(a) * R, y1 = cy - Math.cos(a) * R, l = h % 10 === 0 ? 14 : 7; g.beginPath(); g.moveTo(x1, y1); g.lineTo(cx + Math.sin(a) * (R - l), cy - Math.cos(a) * (R - l)); g.stroke(); if (h % 30 === 0) txt(g, String(h / 10), cx + Math.sin(a) * (R - 28), cy - Math.cos(a) * (R - 28), C.white, 16); }
  g.setLineDash([4, 6]); g.strokeStyle = C.grey; g.beginPath(); g.arc(cx, cy, R / 2, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9); g.stroke(); g.setLineDash([]);
  txt(g, String(range / 2), cx - R / 2 * 0.7 - 14, cy - R / 2 * 0.72, C.cyan, 13);
  // Track line and selected heading bug.
  { const a = (tr - hdg) * D2R; g.strokeStyle = C.green; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); g.stroke(); }
  if (s.ap?.hdg != null) { const a = (s.ap.hdg - hdg) * D2R; g.fillStyle = C.cyan; g.save(); g.translate(cx + Math.sin(a) * R, cy - Math.cos(a) * R); g.rotate(a); g.fillRect(-6, -10, 12, 10); g.restore(); }
  g.save(); g.beginPath(); g.rect(0, 40, W, cy + 40); g.clip();
  // Airports (runways drawn at scale), route in green / magenta for the active leg.
  for (const a of s.airports || []) { const [x, y] = toScreen(a.x, a.z); if (y < 30 || y > H) continue; g.strokeStyle = a.dest ? C.magenta : C.cyan; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, 7); g.stroke(); txt(g, a.icao, x + 14, y - 12, a.dest ? C.magenta : C.cyan, 14, 'left'); for (const r of a.runways || []) { const [ax, ay] = toScreen(r.ax, r.az), [bx, by] = toScreen(r.bx, r.bz); g.strokeStyle = C.white; g.lineWidth = 3; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); } }
  if (s.route?.length) {
    g.lineWidth = 2.5; let prev = [cx, cy];
    s.route.forEach((w, i) => { const p = toScreen(w.x, w.z); g.strokeStyle = i === (s.wpt || 0) ? C.magenta : C.green; g.beginPath(); g.moveTo(...prev); g.lineTo(...p); g.stroke(); prev = p; g.save(); g.translate(...p); g.rotate(Math.PI / 4); g.strokeRect(-5, -5, 10, 10); g.restore(); if (w.name) txt(g, w.name, p[0] + 10, p[1] + 12, i === (s.wpt || 0) ? C.magenta : C.green, 12, 'left'); });
  }
  // ILS course line.
  if (s.ilsLine) { const [ax, ay] = toScreen(s.ilsLine.x, s.ilsLine.z), [bx, by] = toScreen(s.ilsLine.x - s.ilsLine.dx * 18000, s.ilsLine.z - s.ilsLine.dz * 18000); g.strokeStyle = C.magenta; g.setLineDash([10, 6]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]); }
  // Traffic (TCAS): diamonds with relative altitude in hundreds of feet.
  for (const t of s.traffic || []) {
    const [x, y] = toScreen(t.x, t.z); if (y < 40 || y > H || x < 0 || x > W) continue;
    const rel = Math.round((t.alt - s.alt) * 3.28 / 100), d = Math.hypot(t.x - s.x, t.z - s.z), close = d < 6000 && Math.abs(rel) < 9;
    g.fillStyle = close ? C.amber : C.white; g.save(); g.translate(x, y); g.rotate(Math.PI / 4); close ? g.fillRect(-5, -5, 10, 10) : g.strokeRect(-4, -4, 8, 8); g.restore(); g.strokeStyle = C.white;
    txt(g, `${rel >= 0 ? '+' : '−'}${String(Math.abs(rel)).padStart(2, '0')}${t.vs > 2 ? '↑' : t.vs < -2 ? '↓' : ''}`, x, y + (rel >= 0 ? -14 : 14), close ? C.amber : C.white, 12);
  }
  g.restore();
  // Own aircraft.
  g.strokeStyle = C.amber; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx, cy + 22); g.moveTo(cx - 18, cy); g.lineTo(cx + 18, cy); g.moveTo(cx - 7, cy + 18); g.lineTo(cx + 7, cy + 18); g.stroke();
  // Header: GS / TAS, wind, next waypoint.
  txt(g, `GS ${Math.round(s.gs * 1.94)}  TAS ${Math.round(s.tas * 1.94)}`, 12, 20, C.white, 15, 'left');
  if (s.wind) { txt(g, `${String(Math.round(s.wind.dir)).padStart(3, '0')}°/${Math.round(s.wind.speed * 1.94)}`, 12, 42, C.white, 15, 'left'); const a = ((s.wind.dir + 180) - hdg) * D2R; g.save(); g.translate(40, 72); g.rotate(a); g.strokeStyle = C.green; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 14); g.lineTo(-5, 7); g.moveTo(0, 14); g.lineTo(5, 7); g.stroke(); g.restore(); }
  if (s.next) { txt(g, s.next.name, 500, 20, C.magenta, 16, 'right'); txt(g, `${s.next.dist.toFixed(1)} NM`, 500, 42, C.white, 15, 'right'); txt(g, s.next.eta || '', 500, 62, C.green, 14, 'right'); }
  txt(g, s.weatherRadar ? 'WXR' : '', 20, 490, C.green, 13, 'left'); txt(g, `ARC ${range}`, 492, 490, C.cyan, 13, 'right');
}

/** Engine / systems display (512 × 512). */
export function drawECAM(g, s) {
  const W = 512, H = 512; g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const gauge = (x, y, v, max, label, col = C.green, val = null) => {
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, a = a0 + (a1 - a0) * Math.max(0, Math.min(1, v / max));
    g.strokeStyle = C.grey; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 46, a0, a1); g.stroke();
    g.strokeStyle = C.red; g.beginPath(); g.arc(x, y, 46, a1 - 0.25, a1); g.stroke();
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 44, y + Math.sin(a) * 44); g.stroke();
    txt(g, val ?? (v / max * 100).toFixed(1), x + 18, y + 30, col, 17); txt(g, label, x, y + 60, C.cyan, 13);
  };
  const n = s.n1?.length || 2;
  for (let i = 0; i < n; i++) {
    const x = n === 2 ? 150 + i * 210 : 110 + i * 100;
    gauge(x, 90, (s.n1[i] || 0) * 100, 104, s.prop ? 'TQ %' : 'N1 %', s.engRunning?.[i] ? C.green : C.grey);
    gauge(x, 230, (s.egt?.[i] || 0), 1000, s.prop ? 'ITT °C' : 'EGT °C', C.green, String(Math.round(s.egt?.[i] || 0)));
    txt(g, `${Math.round((s.ff?.[i] || 0))} KG/H`, x, 330, C.green, 16);
    txt(g, `N2 ${((s.n2?.[i] || 0) * 100).toFixed(1)}`, x, 352, C.green, 14);
    if (s.engStarting?.[i]) txt(g, 'START', x, 20, C.amber, 14);
  }
  txt(g, 'FF', 256, 330, C.cyan, 13); txt(g, `FOB ${Math.round(s.fuel)} KG`, 256, 390, C.green, 18);
  // Flaps / slats indicator and speedbrake.
  g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(300, 430); g.lineTo(440, 430); g.stroke();
  const fx = 300 + (s.flapFrac || 0) * 130; g.fillStyle = C.green; g.beginPath(); g.moveTo(fx, 432); g.lineTo(fx + 14, 442); g.lineTo(fx - 4, 442); g.fill();
  txt(g, `FLAP ${s.flapLabel}`, 370, 460, C.green, 16);
  txt(g, s.spoilers > 0.05 ? 'SPD BRK' : s.spoilersArmed ? 'GND SPLR ARMED' : '', 370, 490, s.spoilers > 0.05 ? C.amber : C.green, 14);
  // Gear.
  for (const [i, x] of [[0, 90], [1, 60], [2, 120]].map(([k, x]) => [k, x])) { const gp = s.gear; g.fillStyle = gp > 0.98 ? C.green : gp < 0.02 ? '#333' : C.red; g.beginPath(); g.moveTo(x, i ? 470 : 440); g.lineTo(x + 12, (i ? 470 : 440) + 18); g.lineTo(x - 12, (i ? 470 : 440) + 18); g.fill(); }
  txt(g, s.gear > 0.98 ? 'GEAR DN' : s.gear < 0.02 ? 'GEAR UP' : 'GEAR TRANSIT', 90, 505, s.gear > 0.98 ? C.green : s.gear < 0.02 ? C.grey : C.amber, 13);
  // Memo / warnings.
  let y = 410; for (const w of (s.memo || []).slice(0, 4)) { txt(g, w.text, 180, y, w.level === 'warn' ? C.red : w.level === 'caution' ? C.amber : C.green, 14, 'left'); y += 20; }
  txt(g, s.parking ? 'PARK BRK' : s.brake > 0.1 ? 'BRAKES' : '', 180, 500, C.amber, 14, 'left');
}
