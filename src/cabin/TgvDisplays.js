// TGV driver's display (DMI) — the central screen of the high-speed cab, every value taken from the simulation:
// large digital speed and speed band with permitted / maximum speed, TVM cab signal (permitted speed and next
// block), next speed restriction and the distance to it, traction and braking effort, controller notch, running
// direction and destination, next station with distance and scheduled time, delay, doors, wipers, weather,
// train condition, clock and the alarm line.
import * as THREE from 'three';

const F = 'Arial, Helvetica, sans-serif';
const fmtT = (t) => (t == null ? '--:--' : `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`);
const km = (m) => (m == null ? '—' : m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m))} m`);

export class TgvDmi {
  constructor(maxSpeed = 320) {
    this.c = document.createElement('canvas'); this.c.width = 1280; this.c.height = 760;
    this.g = this.c.getContext('2d');
    this.t = new THREE.CanvasTexture(this.c); this.t.colorSpace = THREE.SRGBColorSpace; this.t.anisotropy = 8;
    this.vmax = Math.ceil(maxSpeed / 20) * 20 + 20;
    this.blink = 0;
  }
  draw(st, dt = 0.1) {
    const g = this.g, W = 1280, H = 760;
    this.blink += dt;
    g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
    // ---- header: direction, service, destination, clock ----
    g.fillStyle = '#0e1622'; g.fillRect(0, 0, W, 64);
    g.font = `bold 30px ${F}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#5fe39a'; g.fillText('▲ AVANT', 20, 33);
    g.fillStyle = '#ffffff'; g.fillText(`${st.serviceLabel || st.trainName} → ${st.destination}`, 190, 33);
    g.textAlign = 'right'; g.fillStyle = '#f2c200'; g.font = `bold 34px ${F}`; g.fillText(fmtT(st.clock), W - 20, 33);
    // ---- speed (left) ----
    const v = st.speed, perm = st.permitted ?? st.staticLimit, over = st.overspeed !== 'none';
    g.textAlign = 'center';
    g.fillStyle = over ? '#ff5a3a' : '#ffffff'; g.font = `bold 190px ${F}`; g.fillText(String(Math.round(v)), 250, 205);
    g.fillStyle = '#8fa1b3'; g.font = `bold 30px ${F}`; g.fillText('km/h', 250, 305);
    // Speed band 0..vmax with the permitted speed and the train's maximum.
    const bx = 40, by = 345, bw = 420, bh = 34, sx = (x) => bx + (Math.min(x, this.vmax) / this.vmax) * bw;
    g.fillStyle = '#1a2330'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = over ? '#ff5a3a' : '#e8eef4'; g.fillRect(bx, by, sx(v) - bx, bh);
    g.fillStyle = '#f2c200'; g.fillRect(sx(perm) - 3, by - 10, 6, bh + 20);
    g.fillStyle = '#5ab0ff'; g.fillRect(sx(st.maxSpeed || this.vmax) - 2, by - 6, 4, bh + 12);
    g.font = `20px ${F}`; g.fillStyle = '#8fa1b3';
    for (let s = 0; s <= this.vmax; s += 80) { g.fillText(String(s), sx(s), by + bh + 22); }
    // ---- TVM cab signal (centre) ----
    const tx = 520, ty = 90;
    g.textAlign = 'left'; g.fillStyle = '#8fa1b3'; g.font = `bold 22px ${F}`; g.fillText('TVM 430', tx, ty);
    const aspect = st.signal?.aspect || 'green';
    const nextP = st.nextLimit && st.nextLimit.limit < perm - 1 ? st.nextLimit.limit : perm;
    const flashing = nextP < perm - 1 && Math.floor(this.blink * 2) % 2 === 0;
    const box = (x, y, val, kind) => {
      const bg = kind === 'stop' ? '#c8102e' : kind === 'warn' ? (flashing ? '#ffffff' : '#111') : '#0c6b2f';
      const fg = kind === 'stop' ? '#ffffff' : kind === 'warn' ? (flashing ? '#111' : '#ffffff') : '#ffffff';
      g.fillStyle = bg; g.fillRect(x, y, 170, 120); g.strokeStyle = '#3a4656'; g.lineWidth = 3; g.strokeRect(x, y, 170, 120);
      g.fillStyle = fg; g.textAlign = 'center'; g.font = `bold 68px ${F}`; g.fillText(val, x + 85, y + 64);
    };
    box(tx, ty + 20, String(Math.round(perm)), aspect === 'red' ? 'stop' : 'go');
    g.fillStyle = '#8fa1b3'; g.font = `bold 20px ${F}`; g.textAlign = 'center'; g.fillText('PERMIS', tx + 85, ty + 162);
    box(tx + 190, ty + 20, aspect === 'red' ? '000' : String(Math.round(nextP)), aspect === 'red' ? 'stop' : nextP < perm - 1 ? 'warn' : 'go');
    g.fillStyle = '#8fa1b3'; g.font = `bold 20px ${F}`; g.textAlign = 'center'; g.fillText('CANTON SUIVANT', tx + 275, ty + 162);
    // Next restriction.
    g.textAlign = 'left'; g.font = `bold 24px ${F}`; g.fillStyle = '#8fa1b3'; g.fillText('PROCHAINE LIMITE', tx, ty + 210);
    g.font = `bold 44px ${F}`; g.fillStyle = '#f2c200';
    g.fillText(st.nextLimit ? `${Math.round(st.nextLimit.limit)} km/h · ${km(st.nextLimit.distance)}` : '—', tx, ty + 258);
    g.font = `22px ${F}`; g.fillStyle = '#8fa1b3';
    g.fillText(st.signal ? `Fin d'autorisation · ${km(st.signal.distance)}` : '', tx, ty + 296);
    // ---- effort (right of centre) ----
    const ex = 930, ey = 90, eh = 250;
    g.font = `bold 22px ${F}`; g.fillStyle = '#8fa1b3'; g.textAlign = 'center';
    const bar = (x, frac, col, label) => {
      g.fillStyle = '#1a2330'; g.fillRect(x, ey + 20, 70, eh);
      g.fillStyle = col; const h = Math.max(0, Math.min(1, frac)) * eh; g.fillRect(x, ey + 20 + eh - h, 70, h);
      g.fillStyle = '#8fa1b3'; g.fillText(label, x + 35, ey); g.fillStyle = '#fff'; g.font = `bold 26px ${F}`; g.fillText(`${Math.round(frac * 100)}%`, x + 35, ey + eh + 48); g.font = `bold 22px ${F}`;
    };
    bar(ex, st.traction || 0, '#5ab0ff', 'TRACTION');
    bar(ex + 100, Math.max(st.brake || 0, st.eb || 0), st.eb > 0.05 ? '#ff4030' : '#ffb000', 'FREIN');
    g.fillStyle = '#ffffff'; g.font = `bold 54px ${F}`; g.fillText(st.notch, ex + 255, ey + 150);
    g.fillStyle = '#8fa1b3'; g.font = `bold 20px ${F}`; g.fillText('MANIP.', ex + 255, ey + 90);
    // ---- next station strip ----
    const ny = 470;
    g.fillStyle = '#0e1622'; g.fillRect(0, ny, W, 120);
    g.textAlign = 'left'; g.font = `bold 22px ${F}`; g.fillStyle = '#8fa1b3'; g.fillText(st.standing ? 'À QUAI' : 'PROCHAIN ARRÊT', 20, ny + 26);
    g.font = `bold 46px ${F}`; g.fillStyle = '#ffffff'; g.fillText(st.stationName, 20, ny + 75);
    g.font = `bold 40px ${F}`; g.fillStyle = '#f2c200'; g.fillText(st.standing ? `${(st.stopDistance >= 0 ? '+' : '')}${(-st.stopDistance).toFixed(1)} m` : km(st.stopDistance), 640, ny + 75);
    g.font = `26px ${F}`; g.fillStyle = '#b8c6e6';
    g.fillText(`Arr. ${fmtT(st.schedArr)}  ·  Dép. ${fmtT(st.schedDep)}`, 640, ny + 26);
    const late = Math.round(st.delay || 0);
    g.textAlign = 'right'; g.font = `bold 34px ${F}`; g.fillStyle = Math.abs(late) <= 60 ? '#5fe39a' : late > 0 ? '#ffb000' : '#5ab0ff';
    g.fillText(Math.abs(late) <= 30 ? "À l'heure" : `${late > 0 ? '+' : '−'}${Math.floor(Math.abs(late) / 60)}′${String(Math.abs(late) % 60).padStart(2, '0')}`, W - 20, ny + 75);
    // ---- status tiles ----
    const ty2 = 610, tiles = [
      ['PORTES', st.doorsLocked ? 'VERROUILLÉES' : st.doorsStatus.toUpperCase(), st.doorsLocked ? '#5fe39a' : '#ffb000'],
      ['ESSUIE-GLACE', st.wipers || 'OFF', st.wipers && st.wipers !== 'OFF' ? '#5ab0ff' : '#8fa1b3'],
      ['MÉTÉO', st.weather || '—', st.weatherRain > 0.12 ? '#9fc3ff' : '#e8eef4'],
      ['ÉTAT RAME', st.condition != null ? `${Math.round(st.condition * 100)} %` : 'Location', st.condition != null && st.condition < 0.6 ? '#ff8a3a' : '#e8eef4'],
      ['VIGILANCE', st.vigAlarm ? 'APPUYER' : 'OK', st.vigAlarm ? '#ff7a00' : '#5fe39a'],
    ];
    const tw = (W - 40 - 4 * 12) / 5;
    tiles.forEach(([lab, val, col], i) => {
      const x = 20 + i * (tw + 12);
      g.fillStyle = '#0e1622'; g.fillRect(x, ty2, tw, 80);
      g.textAlign = 'left'; g.fillStyle = '#8fa1b3'; g.font = `bold 18px ${F}`; g.fillText(lab, x + 14, ty2 + 22);
      g.fillStyle = col; g.font = `bold 28px ${F}`; g.fillText(val, x + 14, ty2 + 58);
    });
    // ---- alarm line ----
    if (st.alarm) {
      g.fillStyle = st.alarm.color; g.fillRect(0, H - 52, W, 52);
      g.fillStyle = '#05080c'; g.textAlign = 'center'; g.font = `bold 28px ${F}`; g.fillText(st.alarm.text, W / 2, H - 25);
    }
    this.t.needsUpdate = true;
  }
}
