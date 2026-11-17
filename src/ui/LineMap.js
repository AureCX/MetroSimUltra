// Strip line diagram in the style of station/train line maps: thick line in the line colour,
// rotated station names, termini in boxes, interchange badges, branches drawn as a fork.
// Used for the cab line-map panel and the full-size map overlay; shows the train's live position.

const NAVY = '#1f3c88';

/** Builds the static layout for a line (all its services) in the driver's direction of travel. */
export function buildLineMapModel(line, services, network, direction) {
  const svcs = services && services.length > 1 ? services : [line];
  const T = svcs.length > 1 ? line.trunkLength : line.stations.length;
  const nodes = new Map();
  const add = (st, col, row) => { const key = `${row}:${st.name}`; if (!nodes.has(key)) nodes.set(key, { key, st, name: st.name, col, row }); return key; };
  const rowsFor = svcs.length === 1 ? [0] : svcs.map((_, i) => (svcs.length === 2 ? (i === 0 ? -1 : 1) : i - (svcs.length - 1) / 2));
  const paths = new Map();
  if (line.loop && svcs.length === 1) {
    // Terminal loop: trunk on the middle row, the loop drawn as a ring (outbound side below, return side above);
    // the return run reuses the trunk nodes.
    // Outbound side of the ring below (first half of the loop stations), return side above; the far end of
    // the ring is drawn as a half circle beyond the last column.
    const iJ = line.loop.junctionIndex, m = line.loop.returnIndex - iJ - 1, low = Math.floor(m / 2);
    const keys = line.stations.map((st, k) => {
      if (st.mirrorOf != null) return `0:${line.stations[st.mirrorOf].name}`;
      if (k <= iJ) return add(st, k, 0);
      const j = k - iJ - 1;
      return j < low ? add(st, iJ + 1 + j, 1) : add(st, iJ + 1 + (m - 1 - j), -1);
    });
    paths.set(line.id, keys);
  } else svcs.forEach((s, i) => {
    const keys = s.stations.map((st, k) => (k < T ? add(st, k, 0) : add(st, k, rowsFor[i])));
    paths.set(s.id, direction === 'A' ? keys : keys.reverse());
  });
  const maxCol = Math.max(...[...nodes.values()].map((n) => n.col));
  if (direction === 'B') for (const n of nodes.values()) n.col = maxCol - n.col;
  // Interchanges (same name on another line) and walking connections.
  const others = (network || []).filter((l) => l.number !== line.number);
  const lineOf = (name) => others.find((l) => l.stations.some((s) => s.name.toLowerCase() === name.toLowerCase()));
  const seen = new Set();
  for (const n of nodes.values()) {
    n.badges = [];
    for (const l of others) {
      if (seen.has(`${n.key}${l.number}`)) continue;
      if (l.stations.some((s) => s.name.toLowerCase() === n.name.toLowerCase())) { n.badges.push({ number: l.number, color: l.color, text: l.textColor }); seen.add(`${n.key}${l.number}`); }
    }
    n.walk = (n.st.connections || []).map(lineOf).filter(Boolean).map((l) => ({ number: l.number, color: l.color, text: l.textColor }));
  }
  const ends = new Set();
  for (const p of paths.values()) { ends.add(p[0]); ends.add(p.at(-1)); }
  for (const n of nodes.values()) n.terminus = ends.has(n.key);
  if (line.loop) for (const n of nodes.values()) n.terminus = n.key === paths.get(line.id)[0];
  return { line, nodes, paths, maxCol, branched: svcs.length > 1 || !!line.loop, loop: line.loop && svcs.length === 1 ? line.loop : null, rows: [...new Set(rowsFor)], direction, termini: svcs.map((s) => (direction === 'A' ? s.stations.at(-1).name : s.stations[0].name)) };
}

/**
 * state: { activeId, plannedId, k (stop index on the active path the train is at/after), t (0..1 towards k+1),
 *          standing (bool), nextK, directionName }
 */
export function drawLineMap(g, W, H, model, state) {
  const { line } = model;
  g.save();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  // Header badges: metro logo + line.
  const R = Math.min(56, H * 0.16);
  g.lineWidth = R * 0.14; g.strokeStyle = NAVY; g.fillStyle = '#fff';
  g.beginPath(); g.arc(24 + R, 18 + R, R, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = NAVY; g.font = `bold ${R * 1.25}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('M', 24 + R, 20 + R);
  g.fillStyle = line.color; g.beginPath(); g.arc(24 + R * 3.3, 18 + R, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = line.textColor; g.fillText(line.number, 24 + R * 3.3, 21 + R);
  g.fillStyle = NAVY; g.fillRect(16, 4, R * 4.6, 10);
  g.textAlign = 'left'; g.font = `bold ${Math.round(R * 0.42)}px Arial`; g.fillStyle = '#5a6475';
  if (state.directionName) g.fillText(state.directionName, 20, 36 + R * 2.25);

  const x0 = 24 + R * 4.9, x1 = W - Math.max(180, W * 0.13) - (model.loop ? H * 0.2 : 0);
  const dx = (x1 - x0) / Math.max(1, model.maxCol);
  const yTrunk = model.loop ? H * 0.58 : model.branched ? H * 0.64 : H * 0.7;
  const rowGap = model.loop ? H * 0.16 : H * 0.2;
  const pos = (n) => ({ x: x0 + n.col * dx, y: yTrunk + n.row * rowGap });
  const nodeAt = (key) => model.nodes.get(key);
  const lw = Math.max(8, H * 0.035);

  // Point at u ∈ [0, 1] along the drawn section between nodes a and b.
  const segFn = (a, b) => {
    const p = pos(a), q = pos(b);
    if (p.y === q.y) return (u) => ({ x: p.x + (q.x - p.x) * u, y: p.y });
    if (model.loop && a.row === 1 && b.row === -1) {
      // Far end of the loop: on along the bottom, half circle round, back along the top.
      const R = (p.y - q.y) / 2, xe = Math.max(p.x, q.x) + dx * 0.35, cy = (p.y + q.y) / 2;
      const L1 = xe - p.x, L2 = Math.PI * R, L3 = xe - q.x, L = L1 + L2 + L3;
      return (u) => {
        let d = u * L;
        if (d <= L1) return { x: p.x + d, y: p.y };
        d -= L1;
        if (d <= L2) { const th = Math.PI / 2 - d / R; return { x: xe + R * Math.cos(th), y: cy + R * Math.sin(th) }; }
        return { x: xe - (d - L2), y: q.y };
      };
    }
    const mx = (p.x + q.x) / 2;
    return (u) => ({ x: (1 - u) ** 3 * p.x + 3 * (1 - u) ** 2 * u * mx + 3 * (1 - u) * u * u * mx + u ** 3 * q.x, y: (1 - u) ** 3 * p.y + 3 * (1 - u) ** 2 * u * p.y + 3 * (1 - u) * u * u * q.y + u ** 3 * q.y });
  };
  const traceSeg = (f, upto) => { for (let u = 0.025; u < upto; u += 0.025) { const b = f(u); g.lineTo(b.x, b.y); } const b = f(upto); g.lineTo(b.x, b.y); return b; };
  const drawPath = (keys, color, alpha) => {
    g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    keys.forEach((k, i) => {
      const p = pos(nodeAt(k));
      if (i === 0) { g.moveTo(p.x, p.y); return; }
      traceSeg(segFn(nodeAt(keys[i - 1]), nodeAt(k)), 1);
    });
    g.stroke(); g.globalAlpha = 1;
  };
  const activePath = model.paths.get(state.activeId) || [...model.paths.values()][0];
  for (const [id, keys] of model.paths) if (keys !== activePath) drawPath(keys, line.color, 0.4);
  drawPath(activePath, line.color, 1);
  if (model.loop) {
    // One-way arrows on each section of the loop.
    const { junctionIndex: a, returnIndex: b } = model.loop;
    for (let i = a; i < b; i++) {
      const f = segFn(nodeAt(activePath[i]), nodeAt(activePath[i + 1]));
      const m0 = f(0.48), m1 = f(0.52), mx = (m0.x + m1.x) / 2, my = (m0.y + m1.y) / 2;
      const ang = Math.atan2(m1.y - m0.y, m1.x - m0.x);
      const L = lw * 0.9;
      g.save(); g.translate(mx, my); g.rotate(ang);
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, lw * 0.28); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-L * 0.45, -L * 0.6); g.lineTo(L * 0.35, 0); g.lineTo(-L * 0.45, L * 0.6); g.stroke();
      g.restore();
    }
  }

  // Passed part of the journey in grey.
  const k = Math.max(0, Math.min(activePath.length - 1, state.k ?? 0));
  const t = state.t ?? 0;
  // On a loop line the trunk is served twice: on the way back only the current lap is greyed out.
  const lapStart = model.loop && k >= model.loop.returnIndex ? model.loop.junctionIndex : 0;
  const passed = activePath.slice(lapStart, k + 1);
  if (passed.length > 1) drawPath(passed, '#b9bec7', 1);
  const pa = pos(nodeAt(activePath[k])), pb = pos(nodeAt(activePath[Math.min(k + 1, activePath.length - 1)]));
  const train = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
  if (t > 0.01 && !state.standing) {
    g.strokeStyle = '#b9bec7'; g.lineWidth = lw; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pa.x, pa.y);
    const b = traceSeg(segFn(nodeAt(activePath[k]), nodeAt(activePath[Math.min(k + 1, activePath.length - 1)])), t);
    train.x = b.x; train.y = b.y;
    g.stroke();
  }

  // Stations.
  const upto = k + (state.standing ? 0 : 1);
  const passedSet = new Set(activePath.filter((key, i) => i < upto && activePath.lastIndexOf(key) < upto));
  const nextKey = activePath[state.nextK ?? k + 1];
  const curKey = state.standing ? activePath[k] : null;
  const fs = Math.max(13, Math.round(H * 0.058));
  const r = lw * 0.95;
  for (const n of model.nodes.values()) {
    const p = pos(n);
    const onActive = activePath.includes(n.key);
    const special = n.terminus || n.badges.length || n.walk.length;
    g.globalAlpha = onActive ? 1 : 0.45;
    if (n.key === nextKey || n.key === curKey) {
      g.fillStyle = n.key === curKey ? 'rgba(255,196,0,0.55)' : 'rgba(255,196,0,0.35)';
      g.beginPath(); g.arc(p.x, p.y, r * 2.3, 0, Math.PI * 2); g.fill();
    }
    if (special) {
      g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = Math.max(2, r * 0.3);
      g.beginPath(); g.arc(p.x, p.y, r * 1.15, 0, Math.PI * 2); g.fill(); g.stroke();
      if (n.terminus) { g.fillStyle = passedSet.has(n.key) && onActive ? '#b9bec7' : line.color; g.beginPath(); g.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2); g.fill(); }
    } else {
      g.fillStyle = passedSet.has(n.key) && onActive ? '#b9bec7' : line.color;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    }
    // Name, rotated like printed line maps.
    g.save();
    g.translate(p.x + r * 0.2, p.y - r * 1.9);
    g.rotate(-0.6);
    g.font = `bold ${fs}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (n.terminus) {
      const w = g.measureText(n.name).width;
      g.fillStyle = NAVY; g.fillRect(-6, -fs * 1.05, w + 12, fs * 1.4);
      g.fillStyle = '#fff'; g.fillText(n.name, 0, 0);
    } else {
      g.fillStyle = passedSet.has(n.key) && onActive ? '#8c94a3' : NAVY;
      g.fillText(n.name, 0, 0);
    }
    g.restore();
    // Interchange badges.
    const bs = [...n.badges.map((b) => ({ ...b, walk: false })), ...n.walk.map((b) => ({ ...b, walk: true }))];
    if (bs.length) {
      const br = Math.max(8, fs * 0.55);
      let by = p.y + r * 1.15 + br + 6;
      g.strokeStyle = '#555'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p.x, p.y + r * 1.15); g.lineTo(p.x, by - br); g.stroke();
      for (const b of bs) {
        let bx = p.x - br * 1.15;
        if (b.walk) {
          g.setLineDash([3, 3]); g.strokeStyle = '#555'; g.beginPath(); g.moveTo(bx - br * 1.6, by); g.lineTo(bx - br * 0.2, by); g.stroke(); g.setLineDash([]);
          g.fillStyle = '#555'; g.font = `bold ${br * 1.2}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('↔', bx - br * 2.3, by);
        }
        g.fillStyle = '#fff'; g.strokeStyle = NAVY; g.lineWidth = 2; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = NAVY; g.font = `bold ${br * 1.3}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', bx, by + 1);
        bx += br * 2.3;
        g.fillStyle = b.color; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
        g.fillStyle = b.text; g.fillText(b.number, bx, by + 1);
        by += br * 2.4;
      }
    }
  }
  g.globalAlpha = 1;

  // Train marker.
  const tw = Math.max(22, H * 0.09), th = tw * 0.55;
  g.save();
  g.translate(train.x, train.y + lw * 2.1);
  if (pb.x < pa.x || (pb.x === pa.x && pb.y < pa.y)) g.scale(-1, 1); // heading left on the map (return side of a loop)
  g.fillStyle = '#d0021b'; g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-tw / 2, -th / 2); g.lineTo(tw / 2 - th / 2, -th / 2); g.lineTo(tw / 2, 0); g.lineTo(tw / 2 - th / 2, th / 2); g.lineTo(-tw / 2, th / 2); g.closePath();
  g.fill(); g.stroke();
  g.restore();
  g.restore();
}

/** Works out where the train is along the active route, in stop indices. */
export function trainMapState(route, front, stations) {
  const stops = route.stops;
  let k = 0;
  for (let i = 0; i < stops.length; i++) if (stops[i].stopR <= front + 2) k = i;
  const nx = stops[Math.min(k + 1, stops.length - 1)];
  const t = k >= stops.length - 1 ? 0 : Math.max(0, Math.min(1, (front - stops[k].stopR) / (nx.stopR - stops[k].stopR)));
  const standing = stations.atStop != null;
  return { k: standing ? stations.atStop : k, t: standing ? 0 : t, standing, nextK: standing ? stations.atStop + 1 : stations.nextStop };
}
