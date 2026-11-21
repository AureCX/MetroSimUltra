// Main-line network map (TGV). Built from the real track geometry of every service: each route has its own
// colour, services sharing a corridor are drawn side by side like a transit map, every station with its name and
// identity, Gare Centrale with its metro interchanges. Live trains — the player's, other players', the AI services
// on the line — come from the same positions the 3D trains use. A side panel shows the current service: direction,
// next stop, distance and ETA, progress along the route. Stations can be picked (info panel; from the departures
// board, "drive the next departure there").
import { TrackGeometry } from '../lines/TrackGeometry.js';

export const ROUTE_COLORS = {
  'tgv-montreval': '#e4002b', 'tgv-saint-roch-les-alpes': '#0072ce', 'tgv-port-azur': '#00a3a1',
  'tgv-valdor': '#f39200', 'tgv-belle-rive': '#8e44ad', 'tgv-clairmont': '#2e9e4f',
};
const DESC = {
  'Gare Centrale': 'Grandville — the main-line station, metro A · B · C',
  Montreval: 'Major regional city — cathedral, old town, river',
  Valdor: 'Coastal city — harbour and lighthouse',
  Clairmont: 'Industrial and cultural city — factories, opera house',
  'Saint-Roch-les-Alpes': 'Mountain city — cable car, alpine tunnels',
  'Belle-Rive': 'Large western city — river, bridges, observation wheel',
  'Port-Azur': 'Southern coastal metropolis — marina, seafront',
};

export class RailMapModel {
  constructor(lines) {
    this.kind = 'rail';
    this.routes = [];
    const corridors = new Map();
    for (const l of lines) {
      const g = new TrackGeometry(l), pts = [];
      for (let s = g.stationS[0]; s <= g.stationS.at(-1); s += 400) { const p = g.point(s); pts.push([p.x, p.z, s]); }
      const pe = g.point(g.stationS.at(-1)); pts.push([pe.x, pe.z, g.stationS.at(-1)]);
      const stations = l.stations.map((st, i) => { const q = g.point(g.stationS[i]); return { name: st.name, x: q.x, z: q.z, s: g.stationS[i], i }; });
      const c = l.rail?.corridor || l.id;
      if (!corridors.has(c)) corridors.set(c, []);
      const r = { id: l.id, line: l, color: ROUTE_COLORS[l.id] || l.color, dest: l.stations.at(-1).name, pts, stations, geom: g, corridor: c, length: g.stationS.at(-1) - g.stationS[0] };
      corridors.get(c).push(r); this.routes.push(r);
    }
    // Offsets of services sharing a corridor (longest in the middle).
    for (const list of corridors.values()) { list.sort((a, b) => a.length - b.length); list.forEach((r, k) => { r.slot = k - (list.length - 1) / 2; }); }
    // Stations (merged by name).
    this.stations = new Map();
    for (const r of this.routes) for (const s of r.stations) {
      const e = this.stations.get(s.name) || { name: s.name, x: s.x, z: s.z, routes: [], desc: DESC[s.name] || '' };
      e.routes.push({ id: r.id, color: r.color, dest: r.dest, km: (s.s - r.stations[0].s) / 1000 });
      this.stations.set(s.name, e);
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of this.routes) for (const [x, z] of r.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    this.bounds = { x0, z0, x1, z1 };
  }
  fit(w, h, pad = 70) {
    pad = Math.max(pad, 70);
    const b = this.bounds, sc = Math.min((w - 2 * pad - 300) / (b.x1 - b.x0), (h - 2 * pad) / (b.z1 - b.z0));
    return { cx: (b.x0 + b.x1) / 2 + 150 / Math.max(sc, 1e-6), cz: (b.z0 + b.z1) / 2, scale: Math.max(sc, 1e-5) };
  }
  /** Station under screen point (px, py) for a view, or null. */
  pick(px, py, W, H, view) {
    let best = null, bd = 18;
    for (const s of this.stations.values()) {
      const x = W / 2 + (s.x - view.cx) * view.scale, y = H / 2 + (s.z - view.cz) * view.scale, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
}

const fmtT = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;

/**
 * state: { lineId, train: { x, z, heading }, next, nextDistance, eta, progress (0..1), destination, direction,
 * service, others: [{ x, z, heading, color, label }], compact, selected }
 */
export function drawRailMap(g, W, H, model, view, state = {}) {
  const P = (x, z) => [W / 2 + (x - view.cx) * view.scale, H / 2 + (z - view.cz) * view.scale];
  const compact = !!state.compact;
  g.save();
  // Background: deep navy with a fine grid every 50 km.
  g.fillStyle = '#0b1424'; g.fillRect(0, 0, W, H);
  const step = 50000 * view.scale;
  if (step > 30) {
    g.strokeStyle = 'rgba(120,150,200,0.08)'; g.lineWidth = 1;
    const ox = ((W / 2 - view.cx * view.scale) % step + step) % step, oz = ((H / 2 - view.cz * view.scale) % step + step) % step;
    for (let x = ox; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = oz; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  const lw = compact ? 4 : Math.max(4, Math.min(9, 5 + view.scale * 4000));
  // Routes (current one last, brighter), offset side by side where they share a corridor.
  const order = [...model.routes].sort((a, b) => (a.id === state.lineId) - (b.id === state.lineId));
  for (const r of order) {
    const cur = !state.lineId || r.id === state.lineId;
    g.globalAlpha = cur ? 1 : 0.55;
    g.strokeStyle = r.color; g.lineWidth = r.id === state.lineId ? lw * 1.25 : lw; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    const pts = r.pts.map(([x, z]) => P(x, z));
    pts.forEach(([x, y], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const n = Math.hypot(nx, ny) || 1; nx /= n; ny /= n;
      const o = r.slot * lw * 1.15, px = x + nx * o, py = y + ny * o;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.stroke();
  }
  g.globalAlpha = 1;
  // Progress of the current service (travelled part highlighted).
  if (state.lineId && state.progressS != null) {
    const r = model.routes.find((x) => x.id === state.lineId);
    if (r) {
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(2, lw * 0.35); g.beginPath();
      let first = true;
      for (const [x, z, s] of r.pts) { if (s > state.progressS) break; const [px, py] = P(x, z); first ? g.moveTo(px, py) : g.lineTo(px, py); first = false; }
      g.stroke();
    }
  }
  // Stations.
  const fs = compact ? 12 : 15;
  for (const s of model.stations.values()) {
    const [x, y] = P(s.x, s.z), big = s.name === 'Gare Centrale', sel = state.selected === s.name, nxt = state.next === s.name;
    const R = (big ? 9 : 7) * (compact ? 0.8 : 1);
    g.fillStyle = '#ffffff'; g.strokeStyle = sel ? '#f2c200' : nxt ? '#5fe39a' : '#0b1424'; g.lineWidth = sel || nxt ? 4 : 3;
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill(); g.stroke();
    if (s.routes.length > 1) { g.strokeStyle = '#0b1424'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, R - 3.5, 0, Math.PI * 2); g.stroke(); }
    g.font = `${big ? 'bold ' : ''}${big ? fs + 2 : fs}px Arial`; g.textBaseline = 'middle'; g.textAlign = 'left';
    const lx = x + R + 6, ly = y - (big ? 2 : 0);
    g.lineWidth = 4; g.strokeStyle = '#0b1424'; g.strokeText(s.name, lx, ly); g.fillStyle = sel ? '#f2c200' : '#ffffff'; g.fillText(s.name, lx, ly);
    if (big && !compact) {
      // Metro interchange badges.
      [['A', '#8B1E8F', '#fff'], ['B', '#33E633', '#111'], ['C', '#00DDF5', '#16233a']].forEach(([n, bg, fg], i) => {
        const bx = lx + 8 + i * 22, by = ly + 20;
        g.fillStyle = bg; g.beginPath(); g.arc(bx, by, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = fg; g.font = 'bold 11px Arial'; g.textAlign = 'center'; g.fillText(n, bx, by + 1);
      });
      g.textAlign = 'left'; g.fillStyle = '#9fb3d6'; g.font = '11px Arial'; g.fillText('Ⓜ', lx - 8, ly + 21);
    }
  }
  // Trains.
  const marker = (t, color, label, me) => {
    const [x, y] = P(t.x, t.z), a = t.heading || 0;
    if (me) { g.strokeStyle = 'rgba(242,194,0,0.55)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 14 + 4 * Math.sin(performance.now() / 250), 0, Math.PI * 2); g.stroke(); }
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = color; g.strokeStyle = '#0b1424'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    if (label) { g.font = 'bold 12px Arial'; g.textAlign = 'left'; g.lineWidth = 4; g.strokeStyle = '#0b1424'; g.strokeText(label, x + 12, y - 12); g.fillStyle = color; g.fillText(label, x + 12, y - 12); }
  };
  for (const o of state.others || []) marker(o, o.color || '#9fb3d6', compact ? '' : o.label, false);
  if (state.train) marker(state.train, '#f2c200', compact ? '' : state.service || 'You', true);
  // Side panel: the current service.
  if (state.train && !compact) {
    const x0 = W - 300, y0 = 16;
    g.fillStyle = 'rgba(14,22,38,0.92)'; g.fillRect(x0, y0, 284, 210); g.strokeStyle = '#2a3a58'; g.strokeRect(x0, y0, 284, 210);
    g.textAlign = 'left'; g.fillStyle = '#f2c200'; g.font = 'bold 18px Arial'; g.fillText(`${state.service || ''}  ▲ ${state.direction || ''}`, x0 + 14, y0 + 24);
    g.fillStyle = '#ffffff'; g.font = 'bold 16px Arial'; g.fillText(`→ ${state.destination || ''}`, x0 + 14, y0 + 50);
    g.fillStyle = '#9fb3d6'; g.font = '13px Arial'; g.fillText('Next stop', x0 + 14, y0 + 80);
    g.fillStyle = '#5fe39a'; g.font = 'bold 20px Arial'; g.fillText(state.next || '—', x0 + 14, y0 + 104);
    g.fillStyle = '#ffffff'; g.font = '15px Arial';
    g.fillText(`${state.nextDistance != null ? `${(state.nextDistance / 1000).toFixed(1)} km` : ''}${state.eta != null ? ` · ETA ${fmtT(state.eta)}` : ''}`, x0 + 14, y0 + 130);
    // Progress bar.
    const p = Math.max(0, Math.min(1, state.progress ?? 0));
    g.fillStyle = '#1f2c44'; g.fillRect(x0 + 14, y0 + 152, 256, 12); g.fillStyle = '#f2c200'; g.fillRect(x0 + 14, y0 + 152, 256 * p, 12);
    g.fillStyle = '#9fb3d6'; g.font = '12px Arial'; g.fillText(`Route progress ${Math.round(p * 100)} %`, x0 + 14, y0 + 184);
    g.fillText(state.speed != null ? `${Math.round(state.speed)} km/h` : '', x0 + 200, y0 + 184);
  }
  // Legend.
  if (!compact) {
    let ly = H - 24 - model.routes.length * 20;
    g.fillStyle = 'rgba(14,22,38,0.85)'; g.fillRect(12, ly - 12, 250, model.routes.length * 20 + 18);
    for (const r of model.routes) { g.fillStyle = r.color; g.fillRect(22, ly - 3, 26, 6); g.fillStyle = '#e8eef4'; g.font = '13px Arial'; g.textAlign = 'left'; g.fillText(`Gare Centrale → ${r.dest}`, 56, ly); ly += 20; }
  }
  g.restore();
}

/** HTML of the station information panel. tt: TgvTimetable (optional), clock (s). */
export function railStationInfo(model, s, { tt = null, clock = 0, canDrive = false } = {}) {
  if (!s) return '';
  const deps = tt ? tt.services.filter((sv) => sv.kind === 'dep' && !sv.cancelled && sv.time + sv.delay > clock - 60 && (sv.destination === s.name || sv.via.includes(s.name) || s.name === 'Gare Centrale')).slice(0, 4) : [];
  return `<h3>${s.name}</h3><p class="sub">${s.desc}</p>
    <ul class="mp-feed">${s.routes.map((r) => `<li><i style="display:inline-block;width:18px;height:6px;background:${r.color};margin-right:6px;vertical-align:middle"></i>→ ${r.dest}${r.km ? ` · ${r.km.toFixed(0)} km from Gare Centrale` : ''}</li>`).join('')}</ul>
    ${deps.length ? `<p class="sub">Next departures from Gare Centrale${s.name === 'Gare Centrale' ? '' : ` serving ${s.name}`}:</p><ul class="mp-feed">${deps.map((sv) => `<li><b>${fmtT(sv.time)}</b> TGV ${sv.no} → ${sv.destination} · voie ${sv.voie}${canDrive ? ` <button class="btn small primary" data-drive-dep="${sv.no}">Drive ▶</button>` : ''}</li>`).join('')}</ul>` : ''}`;
}
