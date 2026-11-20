// Procedural textures for the grand station: limestone ashlar, polished marble (with a compass-rose inlay),
// coffered vault, glazing, timber, canvas signs.
import * as THREE from 'three';

const tex = (w, h, draw, repeat = true) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
let rs = 12345; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
let T;
export function stationTextures() {
  if (T) return T;
  T = {
    stone: tex(512, 512, (g) => {
      g.fillStyle = '#e7dcc6'; g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 64) for (let x = (y / 64) % 2 ? -64 : 0; x < 512; x += 128) {
        const v = 222 + rnd() * 20; g.fillStyle = `rgb(${v},${v - 10},${v - 30})`; g.fillRect(x + 2, y + 2, 124, 60);
      }
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,100,70' : '255,250,240'},${0.06 * rnd()})`; g.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
    }),
    marble: tex(1024, 1024, (g) => {
      // Polished cream marble slabs with dark green borders and veins.
      g.fillStyle = '#efe9df'; g.fillRect(0, 0, 1024, 1024);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = `rgba(150,140,125,${0.12 + rnd() * 0.15})`; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath();
        let x = rnd() * 1024, y = rnd() * 1024; g.moveTo(x, y);
        for (let k = 0; k < 10; k++) { x += (rnd() - 0.5) * 140; y += (rnd() - 0.2) * 90; g.lineTo(x, y); }
        g.stroke();
      }
      g.strokeStyle = '#2f4a3f'; g.lineWidth = 10; for (let k = 0; k <= 1024; k += 256) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 1024); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(1024, k); g.stroke(); }
      g.fillStyle = '#c8a24a'; for (let x = 0; x <= 1024; x += 256) for (let y = 0; y <= 1024; y += 256) { g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); }
    }),
    rose: tex(1024, 1024, (g) => {
      // Compass-rose inlay for the centre of the hall.
      g.fillStyle = '#efe9df'; g.fillRect(0, 0, 1024, 1024);
      const cx = 512, cy = 512;
      for (const [r, c] of [[500, '#2f4a3f'], [480, '#efe9df'], [430, '#c8a24a'], [415, '#efe9df'], [180, '#2f4a3f'], [160, '#efe9df']]) { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, L = i % 4 === 0 ? 470 : i % 2 ? 300 : 380;
        g.fillStyle = i % 2 ? '#8c6d3a' : '#1b2a4a';
        g.beginPath(); g.moveTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.lineTo(cx + Math.cos(a + 0.18) * 60, cy + Math.sin(a + 0.18) * 60); g.lineTo(cx + Math.cos(a - 0.18) * 60, cy + Math.sin(a - 0.18) * 60); g.closePath(); g.fill();
      }
      g.fillStyle = '#c8a24a'; g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b2a4a'; g.font = 'bold 60px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [t, a] of [['N', -Math.PI / 2], ['E', 0], ['S', Math.PI / 2], ['O', Math.PI]]) g.fillText(t, cx + Math.cos(a) * 455, cy + Math.sin(a) * 455);
    }, false),
    coffer: tex(512, 512, (g) => {
      g.fillStyle = '#f1e9d8'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const x = i * 128, y = j * 128;
        g.fillStyle = '#d9ccb0'; g.fillRect(x + 12, y + 12, 104, 104);
        g.fillStyle = '#e8dcc0'; g.fillRect(x + 24, y + 24, 80, 80);
        g.fillStyle = '#c8a24a'; g.beginPath(); g.arc(x + 64, y + 64, 12, 0, Math.PI * 2); g.fill();
      }
    }),
    wood: tex(256, 256, (g) => { g.fillStyle = '#6b4128'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(30,15,5,${0.15 + rnd() * 0.2})`; g.beginPath(); const y = rnd() * 256; g.moveTo(0, y); g.bezierCurveTo(80, y + (rnd() - 0.5) * 20, 170, y + (rnd() - 0.5) * 20, 256, y); g.stroke(); } }),
    paving: tex(512, 512, (g) => { g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, 512, 512); for (let y = 0; y < 512; y += 32) for (let x = 0; x < 512; x += 64) { g.fillStyle = `rgb(${190 + rnd() * 25},${182 + rnd() * 22},${165 + rnd() * 20})`; g.fillRect(x + ((y / 32) % 2) * 32 + 1, y + 1, 62, 30); } }),
    lawn: tex(256, 256, (g) => { g.fillStyle = '#4f7d36'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '30,60,20' : '120,160,70'},${0.25 * rnd()})`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); } }),
    water: tex(256, 256, (g) => { g.fillStyle = '#3f86a8'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 300; i++) { g.strokeStyle = `rgba(255,255,255,${0.1 + rnd() * 0.25})`; g.beginPath(); const x = rnd() * 256, y = rnd() * 256; g.arc(x, y, 3 + rnd() * 12, 0, Math.PI * (0.4 + rnd())); g.stroke(); } }),
  };
  return T;
}

/** Sign / board texture with text lines. */
export function signTexture(lines, { w = 1024, h = 256, bg = '#1b2a4a', fg = '#ffffff', font = 'bold 110px Georgia', align = 'center', border = null } = {}) {
  return tex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = Math.max(6, h * 0.05); g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth); }
    g.fillStyle = fg; g.font = font; g.textAlign = align; g.textBaseline = 'middle';
    const L = Array.isArray(lines) ? lines : [lines];
    L.forEach((t, i) => g.fillText(t, align === 'center' ? w / 2 : w * 0.05, (h * (i + 0.5)) / L.length));
  }, false);
}
