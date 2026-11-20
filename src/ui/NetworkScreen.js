// Live metro network map drawn from the real track geometry of every line (all services of branching
// lines, the circuit of loop lines): lines in their colours, every station, interchanges, termini, the
// player's train (position, heading, next and previous station, direction) and other players' trains.
// Used by the screen built into the metro cab desk and by its full-size interactive view (pan / zoom).
import { TrackGeometry } from '../lines/TrackGeometry.js';

const NAVY = '#1f3c88';

export class NetworkModel {
  /** lines: normalized lines of one network (branch services included). */
  constructor(lines) {
    this.lines = [];
    const byNumber = new Map();
    for (const l of lines) {
      const g = new TrackGeometry(l);
      const pts = [];
      for (let s = g.stationS[0]; s <= g.stationS.at(-1); s += 20) { const p = g.point(s); pts.push([p.x, p.z]); }
      const pe = g.point(g.stationS.at(-1)); pts.push([pe.x, pe.z]);
      const stations = l.stations.map((st, i) => ({ st, i, ...(() => { const q = g.point(g.stationS[i]); return { x: q.x, z: q.z }; })() })).filter((x) => x.st.mirrorOf == null);
      const entry = byNumber.get(l.number) || { number: l.number, color: l.color, text: l.textColor, name: l.name, services: [], stations: new Map(), termini: new Set(), loop: !!l.loop };
      entry.services.push({ id: l.id, line: l, geom: g, pts });
      for (const s of stations) if (!entry.stations.has(s.st.name)) entry.stations.set(s.st.name, s);
      entry.termini.add(l.stations[0].name);
      if (!l.loop) entry.termini.add(l.stations.at(-1).name);
      byNumber.set(l.number, entry);
    }
    this.lines = [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
    // Interchanges: same name on several lines, or stations of the same complex declared by a line.
    const lines4 = new Map();
    for (const L of this.lines) for (const s of L.stations.values()) {
      const k = s.st.name.toLowerCase();
      if (!lines4.has(k)) lines4.set(k, new Set());
      lines4.get(k).add(L.number);
      for (const m of s.st.interchange?.metro || []) lines4.get(k).add(m);
      for (const other of s.st.interchange?.stations || []) { const ok = other.toLowerCase(); if (!lines4.has(ok)) lines4.set(ok, new Set()); lines4.get(ok).add(L.number); }
    }
    this.interchange = (name) => (lines4.get(name.toLowerCase())?.size ?? 0) > 1;
    this.linesAt = (name) => [...(lines4.get(name.toLowerCase()) || [])].sort();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const L of this.lines) for (const sv of L.services) for (const [x, z] of sv.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    this.bounds = { x0, z0, x1, z1 };
  }
  colorOf(number) { return this.lines.find((l) => l.number === number)?.color || '#888'; }
  textOf(number) { return this.lines.find((l) => l.number === number)?.text || '#fff'; }
  /** View that fits the whole network into w×h. */
  fit(w, h, pad = 40) {
    const b = this.bounds, sc = Math.min((w - 2 * pad) / (b.x1 - b.x0), (h - 2 * pad) / (b.z1 - b.z0));
    return { cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, scale: sc };
  }
}

/**
 * Draws the network. view: { cx, cz, scale } (pixels per metre). state: { number (current line), train: { x, z, heading },
 * next, prev, direction, others: [{ x, z, heading, color, label }], compact }.
 */
export function drawNetwork(g, W, H, model, view, state = {}) {
  const P = (x, z) => [W / 2 + (x - view.cx) * view.scale, H / 2 + (z - view.cz) * view.scale];
  const compact = !!state.compact, k = compact ? 1 : Math.max(0.7, Math.min(1.6, view.scale * 900));
  g.save();
  g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, H);
  // Light grid for orientation.
  g.strokeStyle = 'rgba(31,60,136,0.06)'; g.lineWidth = 1;
  const step = 1000 * view.scale;
  if (step > 24) {
    const ox = ((W / 2 - view.cx * view.scale) % step + step) % step, oz = ((H / 2 - view.cz * view.scale) % step + step) % step;
    for (let x = ox; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = oz; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  const lw = compact ? 6 : 9 * k;
  // Lines: others first (dimmed when a current line is set), current line on top.
  const order = [...model.lines].sort((a, b) => (a.number === state.number) - (b.number === state.number));
  for (const L of order) {
    const cur = !state.number || L.number === state.number;
    g.globalAlpha = cur ? 1 : 0.45;
    g.strokeStyle = L.color; g.lineWidth = cur && state.number ? lw * 1.35 : lw; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const sv of L.services) {
      g.beginPath();
      sv.pts.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // Stations.
  const fs = compact ? 11 : Math.round(12 * k);
  const drawn = new Set();
  for (const L of order) {
    const cur = !state.number || L.number === state.number;
    for (const s of L.stations.values()) {
      const key = s.st.name.toLowerCase();
      const [px, py] = P(s.x, s.z);
      if (px < -60 || py < -60 || px > W + 60 || py > H + 60) continue;
      const inter = model.interchange(s.st.name), term = L.termini.has(s.st.name);
      const isNext = cur && state.next === s.st.name, isPrev = cur && state.prev === s.st.name;
      if (isNext) { g.fillStyle = 'rgba(255,196,0,0.45)'; g.beginPath(); g.arc(px, py, lw * 1.9, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = cur ? 1 : 0.6;
      if (inter || term) {
        g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = Math.max(2, lw * 0.3);
        g.beginPath(); g.arc(px, py, lw * 0.95, 0, Math.PI * 2); g.fill(); g.stroke();
        if (term) { g.fillStyle = L.color; g.beginPath(); g.arc(px, py, lw * 0.4, 0, Math.PI * 2); g.fill(); }
      } else {
        g.fillStyle = isPrev ? '#9aa0aa' : '#fff'; g.strokeStyle = L.color; g.lineWidth = Math.max(1.5, lw * 0.28);
        g.beginPath(); g.arc(px, py, lw * 0.55, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      if (isPrev) { g.strokeStyle = '#6b7280'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, lw * 1.25, 0, Math.PI * 2); g.stroke(); }
      g.globalAlpha = 1;
      // Labels (once per name; on the compact screen only the current line, interchanges and termini).
      const showLabel = !drawn.has(key) && (!compact || (cur && state.number) || inter || term);
      if (showLabel) {
        drawn.add(key);
        const label = s.st.name;
        g.font = `${term || inter || isNext ? 'bold ' : ''}${fs}px "Segoe UI", Arial, sans-serif`;
        g.textBaseline = 'middle';
        const tx = px + lw * 1.2, ty = py - lw * 1.1;
        if (term) {
          const w = g.measureText(label).width;
          g.fillStyle = NAVY; g.fillRect(tx - 3, ty - fs * 0.7, w + 6, fs * 1.4);
          g.fillStyle = '#fff'; g.fillText(label, tx, ty);
        } else {
          g.lineWidth = 3; g.strokeStyle = 'rgba(247,247,244,0.95)'; g.strokeText(label, tx, ty);
          g.fillStyle = cur ? (isPrev ? '#6b7280' : NAVY) : '#5b6475'; g.fillText(label, tx, ty);
        }
        // Interchange badges under the dot.
        if (inter && !compact) {
          let bx = px - lw * 0.6;
          const by = py + lw * 1.9, br = Math.max(6, fs * 0.5);
          for (const n of model.linesAt(s.st.name)) {
            g.fillStyle = model.colorOf(n); g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
            g.fillStyle = model.textOf(n); g.font = `bold ${br * 1.3}px Arial`; g.textAlign = 'center'; g.fillText(n, bx, by + 1); g.textAlign = 'left';
            bx += br * 2.2;
          }
        }
      }
    }
  }
  // Other players' trains.
  for (const o of state.others || []) {
    const [px, py] = P(o.x, o.z);
    marker(g, px, py, o.heading, compact ? 9 : 12 * k, o.color || '#1f78ff', '#fff');
    if (!compact && o.label) { g.font = `bold ${fs}px Arial`; g.fillStyle = '#1f78ff'; g.fillText(o.label, px + 12 * k, py + 14 * k); }
  }
  // The player's train.
  if (state.train) {
    const [px, py] = P(state.train.x, state.train.z);
    marker(g, px, py, state.train.heading, compact ? 11 : 15 * k, '#d0021b', '#fff');
  }
  g.restore();
  // Information banner.
  if (state.number) {
    const bh = compact ? 30 : 44, pad = 10;
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.fillRect(0, 0, W, bh);
    g.fillStyle = model.colorOf(state.number); g.beginPath(); g.arc(pad + bh / 2 - 4, bh / 2, bh / 2 - 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = model.textOf(state.number); g.font = `bold ${bh * 0.5}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(state.number, pad + bh / 2 - 4, bh / 2 + 1);
    g.textAlign = 'left'; g.fillStyle = NAVY; g.font = `bold ${compact ? 13 : 17}px "Segoe UI", Arial`;
    g.fillText(`${state.direction || ''}${state.next ? `   ·   Prochaine : ${state.next}` : ''}`, pad + bh + 4, bh / 2);
  }
}

function marker(g, x, y, heading, size, fill, stroke) {
  g.save(); g.translate(x, y); g.rotate(heading); // heading 0 = up (north, −z)
  g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.62, size * 0.7); g.lineTo(0, size * 0.35); g.lineTo(-size * 0.62, size * 0.7); g.closePath();
  g.fill(); g.stroke(); g.restore();
}
