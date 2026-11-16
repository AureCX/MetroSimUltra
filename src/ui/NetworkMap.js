// SVG network map generated from the real track alignment of every line in a network.
import { TrackGeometry } from '../lines/TrackGeometry.js';

const cache = new Map();
function lineShape(line) {
  if (cache.has(line)) return cache.get(line);
  const g = new TrackGeometry(line);
  const pts = [];
  for (let s = g.stationS[0]; s <= g.stationS.at(-1); s += 25) { const p = g.point(s); pts.push([p.x, p.z]); }
  const p = g.point(g.stationS.at(-1)); pts.push([p.x, p.z]);
  const stations = line.stations.map((st, i) => { const q = g.point(g.stationS[i]); return { st, x: q.x, y: q.z }; });
  const out = { pts, stations };
  cache.set(line, out);
  return out;
}

export function renderNetworkMap(svg, lines, selectedId, onSelect) {
  const shapes = lines.map((l) => ({ l, ...lineShape(l) })).sort((a, b) => (a.l.id === selectedId) - (b.l.id === selectedId));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const [x, y] of s.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pad = 900;
  const w = maxX - minX + pad * 2, h = Math.max(maxY - minY + pad * 2, w * 0.45);
  const cy = (minY + maxY) / 2;
  svg.setAttribute('viewBox', `${minX - pad} ${cy - h / 2} ${w} ${h}`);
  const k = Math.max(w, h * 2.2) / 1000;
  // Interchange = served by more than one line number; also index positions for walking links.
  const names = new Map(), pos = new Map();
  for (const s of shapes) for (const st of s.stations) {
    const key = st.st.name.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(s.l.number);
    pos.set(key, st);
  }
  let html = `<rect x="${minX - pad}" y="${cy - h / 2}" width="${w}" height="${h}" fill="transparent"/>`;
  const drawn = new Set();
  for (const s of shapes) for (const st of s.stations) for (const c of st.st.connections) {
    const o = pos.get(c.toLowerCase()); const key = [st.st.name, c].sort().join('|');
    if (!o || drawn.has(key)) continue; drawn.add(key);
    html += `<line x1="${st.x}" y1="${st.y}" x2="${o.x}" y2="${o.y}" stroke="#aab4bf" stroke-width="${4 * k}" stroke-dasharray="${8 * k} ${6 * k}"/>`;
  }
  for (const s of shapes) {
    const sel = s.l.id === selectedId;
    const d = s.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    html += `<g class="map-line${sel ? ' sel' : ''}" data-id="${s.l.id}">`;
    html += `<path d="${d}" stroke="${s.l.color}" stroke-width="${(sel ? 14 : 10) * k}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${sel ? 1 : 0.55}"/>`;
    html += `<path d="${d}" stroke="transparent" stroke-width="${40 * k}" fill="none"/>`;
    s.stations.forEach((st, i) => {
      const key = st.st.name.toLowerCase();
      const inter = names.get(key).size > 1 || st.st.connections.length > 0;
      const r = (inter ? 9 : 6) * k;
      html += `<circle cx="${st.x}" cy="${st.y}" r="${r}" fill="#fff" stroke="${inter ? '#111' : s.l.color}" stroke-width="${3 * k}"/>`;
      const dy = (i % 2 ? 26 : -18) * k;
      if (sel || inter) html += `<text x="${st.x + 10 * k}" y="${st.y + dy}" font-size="${(sel ? 15 : 13) * k}" fill="${sel ? '#fff' : '#aab4bf'}" font-weight="${sel ? 600 : 400}" paint-order="stroke" stroke="#0f141b" stroke-width="${3 * k}">${escapeXml(st.st.name)}</text>`;
    });
    const a = s.stations[0], b = s.stations.at(-1);
    for (const e of [a, b]) html += `<g><circle cx="${e.x - 22 * k}" cy="${e.y}" r="${14 * k}" fill="${s.l.color}"/><text x="${e.x - 22 * k}" y="${e.y + 5 * k}" font-size="${14 * k}" text-anchor="middle" font-weight="700" fill="${s.l.textColor}">${escapeXml(s.l.number)}</text></g>`;
    html += '</g>';
  }
  svg.innerHTML = html;
  svg.querySelectorAll('.map-line').forEach((g) => g.addEventListener('click', () => onSelect(g.dataset.id)));
}

export function escapeXml(s) { return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); }
