// Canvas-rendered cab instruments: speedometer with ATP marks, driver machine interface (DMI), clock.
import * as THREE from 'three';
import { formatClock, formatDelta } from '../core/util.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}

const ASPECT_COL = { red: '#ff3020', yellow: '#ffb300', green: '#20e070' };

export class Speedometer {
  constructor(maxScale) {
    this.max = maxScale;
    Object.assign(this, makeCanvas(512, 512));
  }
  draw(st) {
    const { g } = this, cx = 256, cy = 256, R = 236;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (v) => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / this.max));
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = '#0b0d10'; g.beginPath(); g.arc(cx, cy, 250, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5a6068'; g.lineWidth = 8; g.beginPath(); g.arc(cx, cy, 248, 0, Math.PI * 2); g.stroke();
    // Permitted speed band.
    g.lineWidth = 20;
    g.strokeStyle = '#1e6e3a'; g.beginPath(); g.arc(cx, cy, R - 30, a0, ang(st.permitted)); g.stroke();
    g.strokeStyle = '#8a1c14'; g.beginPath(); g.arc(cx, cy, R - 30, ang(st.permitted), a1); g.stroke();
    if (st.nextLimit && st.nextLimit.distance < 400) {
      g.strokeStyle = '#ffb300'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R - 52, ang(st.nextLimit.limit) - 0.03, ang(st.nextLimit.limit) + 0.03); g.stroke();
    }
    // Ticks.
    g.fillStyle = '#e8ecef'; g.strokeStyle = '#e8ecef'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= this.max; v += 5) {
      const a = ang(v), big = v % 10 === 0;
      g.lineWidth = big ? 5 : 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - (big ? 26 : 16)), cy + Math.sin(a) * (R - (big ? 26 : 16))); g.lineTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2)); g.stroke();
      if (v % 20 === 0) { g.font = 'bold 34px Arial'; g.fillText(String(v), cx + Math.cos(a) * (R - 78), cy + Math.sin(a) * (R - 78)); }
    }
    // Permitted marker triangle.
    const pa = ang(st.permitted);
    g.fillStyle = st.overspeed === 'none' ? '#ffffff' : '#ff3020';
    g.beginPath();
    g.moveTo(cx + Math.cos(pa) * (R + 2), cy + Math.sin(pa) * (R + 2));
    g.lineTo(cx + Math.cos(pa - 0.06) * (R - 40), cy + Math.sin(pa - 0.06) * (R - 40));
    g.lineTo(cx + Math.cos(pa + 0.06) * (R - 40), cy + Math.sin(pa + 0.06) * (R - 40));
    g.fill();
    // Digital readout.
    g.fillStyle = '#000'; g.fillRect(cx - 82, cy + 70, 164, 74);
    g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(cx - 82, cy + 70, 164, 74);
    g.fillStyle = st.overspeed === 'none' ? '#ffffff' : '#ff4030';
    g.font = 'bold 60px "Courier New", monospace'; g.fillText(String(Math.round(st.speed)).padStart(3, ' '), cx, cy + 110);
    g.fillStyle = '#9aa3ab'; g.font = '24px Arial'; g.fillText('km/h', cx, cy + 172);
    // Needle.
    const na = ang(st.speed);
    g.strokeStyle = '#ff7a1a'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - Math.cos(na) * 30, cy - Math.sin(na) * 30); g.lineTo(cx + Math.cos(na) * (R - 40), cy + Math.sin(na) * (R - 40)); g.stroke();
    g.fillStyle = '#2a2e33'; g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();
    this.t.needsUpdate = true;
  }
}

export class DMI {
  constructor() { Object.assign(this, makeCanvas(1024, 640)); this.blink = 0; }
  draw(st, dt) {
    this.blink = (this.blink + dt) % 1;
    const g = this.g, W = 1024, H = 640, on = this.blink < 0.6;
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
    // Header.
    g.fillStyle = '#161c24'; g.fillRect(0, 0, W, 70);
    g.fillStyle = st.line.color; g.beginPath(); g.arc(46, 35, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = st.line.textColor; g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(st.line.number, 46, 37);
    g.textAlign = 'left'; g.fillStyle = '#dfe6ee'; g.font = 'bold 28px Arial';
    g.fillText(st.directionName, 86, 36);
    g.textAlign = 'right'; g.fillStyle = '#8fa1b3'; g.font = '24px Arial';
    g.fillText(`${st.signalSystem === 'cbtc' ? 'CBTC' : 'BLOCK'} · ATP ${st.atpEnabled ? 'ON' : 'OFF'}`, W - 20, 36);

    // Left column: speed supervision.
    g.textAlign = 'left';
    this.box(16, 86, 300, 250, '#121820');
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText('PERMITTED', 34, 116);
    g.fillStyle = st.overspeed === 'none' ? '#ffffff' : (on ? '#ff4030' : '#ffffff');
    g.font = 'bold 84px Arial'; g.fillText(String(Math.round(st.permitted)), 34, 190);
    const pw = g.measureText(String(Math.round(st.permitted))).width;
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText('km/h', 44 + pw, 190);
    if (st.nextLimit) {
      g.fillStyle = '#ffb300'; g.font = 'bold 28px Arial';
      g.fillText(`▼ ${Math.round(st.nextLimit.limit)} km/h in ${Math.round(st.nextLimit.distance)} m`, 34, 246);
    }
    if (st.authority) {
      g.fillStyle = '#ff6a50'; g.font = 'bold 28px Arial';
      g.fillText(`■ STOP in ${Math.round(st.authority.distance)} m`, 34, 290);
    } else {
      g.fillStyle = '#3cc070'; g.font = '24px Arial'; g.fillText('Authority clear', 34, 290);
    }

    // Signal.
    this.box(16, 350, 300, 130, '#121820');
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText(st.signalSystem === 'cbtc' ? 'MOVING BLOCK' : 'NEXT SIGNAL', 34, 380);
    if (st.signal) {
      g.fillStyle = ASPECT_COL[st.signal.aspect]; g.beginPath(); g.arc(70, 435, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#dfe6ee'; g.font = 'bold 30px Arial'; g.fillText(st.signal.number, 120, 425);
      g.font = '24px Arial'; g.fillStyle = '#8fa1b3'; g.fillText(`${Math.round(st.signal.distance)} m`, 120, 458);
    }

    // Right column: station.
    this.box(332, 86, 676, 250, '#121820');
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText(st.standing ? 'AT PLATFORM' : 'NEXT STOP', 352, 116);
    g.fillStyle = '#ffffff'; g.font = 'bold 44px Arial';
    let name = st.stationName; while (g.measureText(name).width > 520 && name.length > 4) name = name.slice(0, -2);
    g.fillText(name === st.stationName ? name : `${name}…`, 352, 170);
    g.fillStyle = '#dfe6ee'; g.font = 'bold 40px Arial';
    g.textAlign = 'right'; g.fillText(st.doorSide === 'left' ? '◀ doors' : 'doors ▶', 992, 170); g.textAlign = 'left';
    const d = st.stopDistance;
    g.font = 'bold 36px "Courier New", monospace'; g.fillStyle = '#ffd25a';
    g.fillText(d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(d < 30 ? 1 : 0)} m`, 352, 226);
    if (Math.abs(d) < 160) {
      // Precision stopping bar.
      const x0 = 560, w = 420, y = 205, c = x0 + w * 0.75, scale = w * 0.75 / 160;
      g.fillStyle = '#26313d'; g.fillRect(x0, y, w, 26);
      const tol = st.stopTolerance * scale * 2;
      g.fillStyle = '#1e6e3a'; g.fillRect(c - tol, y, tol * 2, 26);
      g.fillStyle = '#ffffff'; g.fillRect(c - 2, y - 6, 4, 38);
      const px = Math.max(x0, Math.min(x0 + w, c - d * scale * (Math.abs(d) < 10 ? 2 : 1)));
      g.fillStyle = Math.abs(d) <= st.stopTolerance ? '#3cff8a' : '#ffb300';
      g.beginPath(); g.moveTo(px, y - 4); g.lineTo(px - 12, y - 20); g.lineTo(px + 12, y - 20); g.fill();
    }
    g.font = '26px Arial'; g.fillStyle = '#8fa1b3';
    const sched = st.standing ? (st.schedDep != null ? `Dep ${formatClock(st.schedDep)}` : 'Terminus') : `Arr ${st.schedArr != null ? formatClock(st.schedArr) : '--'}`;
    g.fillText(sched, 352, 280);
    g.fillStyle = Math.abs(st.delay) < 30 ? '#3cff8a' : st.delay > 0 ? (st.delay > 90 ? '#ff4030' : '#ffb300') : '#5ab0ff';
    g.font = 'bold 30px Arial'; g.fillText(`${formatDelta(st.delay)}`, 640, 280);
    if (st.standing) {
      g.fillStyle = st.departure ? (on ? '#ffffff' : '#9fb0c0') : '#8fa1b3';
      g.font = 'bold 28px Arial';
      const txt = st.departure ? 'DEPARTURE AUTHORISED' : st.dwellOpened ? `Dwell ${Math.max(0, Math.ceil(st.dwellRemaining))} s${st.boardingDone ? '' : ' · boarding'}` : 'Open doors';
      g.fillText(txt, 352, 322);
    } else {
      if (st.junction && st.junction.distance < 2500) {
        const j = st.junction;
        g.fillStyle = !j.set ? (on ? '#ffb300' : '#7a5a00') : j.ok ? '#3cff8a' : '#ff4030';
        g.font = 'bold 26px Arial';
        g.fillText(`JUNCTION ${Math.round(j.distance)} m · ROUTE ${j.set ? `${j.side === 'left' ? '◀' : '▶'} ${j.set}` : 'NOT SET'}`, 352, 322);
      } else { g.fillStyle = '#8fa1b3'; g.font = '24px Arial'; g.fillText(`${st.stopsRemaining} stop(s) to ${st.terminus}`, 352, 322); }
    }

    // Train status.
    this.box(332, 350, 676, 130, '#121820');
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText('CONTROLLER', 352, 380);
    g.fillStyle = st.notch.startsWith('P') ? '#5ab0ff' : st.notch === 'N' ? '#dfe6ee' : '#ffb300';
    if (st.notch === 'EB') g.fillStyle = '#ff4030';
    g.font = 'bold 54px Arial'; g.fillText(st.notch, 352, 444);
    this.bar(500, 380, 220, 'TRACTION', st.traction, '#5ab0ff');
    this.bar(500, 430, 220, 'BRAKE', Math.max(st.brake, st.eb), st.eb > 0.05 ? '#ff4030' : '#ffb300');
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText('DOORS', 760, 380);
    const dc = st.doorsLocked ? '#3cff8a' : st.doorsStatus === 'warning' || st.doorsStatus === 'closing' ? (on ? '#ffb300' : '#7a5a00') : '#ff4030';
    g.fillStyle = dc; g.font = 'bold 32px Arial'; g.fillText(st.doorsLocked ? 'LOCKED' : st.doorsStatus.toUpperCase(), 760, 420);
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText(`Load ${st.loadPct}%  ·  ${st.gradient >= 0 ? '+' : ''}${st.gradient.toFixed(0)}‰`, 760, 458);

    // Alarm banner.
    const alarm = st.alarm;
    if (alarm) {
      g.fillStyle = on ? alarm.color : '#1a1a1a'; g.fillRect(16, 494, 992, 60);
      g.fillStyle = on ? '#000' : alarm.color; g.font = 'bold 32px Arial'; g.textAlign = 'center'; g.fillText(alarm.text, 512, 525); g.textAlign = 'left';
    } else {
      g.fillStyle = '#121820'; g.fillRect(16, 494, 992, 60);
      g.fillStyle = '#5c6b7a'; g.font = '24px Arial'; g.fillText('No active alarms', 34, 525);
    }
    g.fillStyle = '#dfe6ee'; g.font = 'bold 34px "Courier New", monospace'; g.textAlign = 'right';
    g.fillText(formatClock(st.clock), W - 24, 600); g.textAlign = 'left';
    g.fillStyle = '#8fa1b3'; g.font = '22px Arial'; g.fillText(`${st.trainName}  ·  ${st.odometerKm.toFixed(2)} km`, 24, 600);
    this.t.needsUpdate = true;
  }
  box(x, y, w, h, col) { this.g.fillStyle = col; this.g.fillRect(x, y, w, h); }
  bar(x, y, w, label, v, col) {
    const g = this.g;
    g.fillStyle = '#8fa1b3'; g.font = '18px Arial'; g.fillText(label, x, y);
    g.fillStyle = '#26313d'; g.fillRect(x, y + 10, w, 18);
    g.fillStyle = col; g.fillRect(x, y + 10, w * Math.min(1, Math.max(0, v)), 18);
  }
}

export class Clock {
  constructor() { Object.assign(this, makeCanvas(256, 80)); this.last = -1; }
  draw(clock) {
    const s = Math.floor(clock);
    if (s === this.last) return;
    this.last = s;
    const g = this.g;
    g.fillStyle = '#050505'; g.fillRect(0, 0, 256, 80);
    g.fillStyle = '#ff5a2a'; g.font = 'bold 54px "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(formatClock(clock), 128, 42);
    this.t.needsUpdate = true;
  }
}
