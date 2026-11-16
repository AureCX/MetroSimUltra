// Procedurally generated canvas textures (no binary assets needed).
import * as THREE from 'three';
import { seededRandom } from '../core/util.js';

const cache = new Map();
let maxAniso = 4;
export function setMaxAnisotropy(v) { maxAniso = v; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = maxAniso;
  return t;
}
function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

function noise(ctx, w, h, amount, seed, alpha = 0.08) {
  const r = seededRandom(seed);
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

export const Textures = {
  concrete: (tint = '#6d6a64') => cached(`concrete${tint}`, () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = tint; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 5000, 7, 0.12);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke(); // segment ring joint
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(30,25,20,${0.05 + Math.random() * 0.08})`; g.fillRect(Math.random() * 256, 0, 6 + Math.random() * 20, 256); }
    return tex(c);
  }),
  trackbed: () => cached('trackbed', () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#3a3835'; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 9000, 3, 0.2);
    return tex(c);
  }),
  tiles: (color = '#f2efe6', grout = '#bdb8ab', cols = 8, rows = 16, bevel = true) => cached(`tiles${color}${grout}${cols}${rows}`, () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = grout; g.fillRect(0, 0, 256, 256);
    const tw = 256 / cols, th = 256 / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ox = (y % 2) * (tw / 2) * 0;
      const px = x * tw + ox + 1.5, py = y * th + 1.5, w = tw - 3, h = th - 3;
      g.fillStyle = color; g.fillRect(px, py, w, h);
      if (bevel) {
        const grd = g.createLinearGradient(px, py, px, py + h);
        grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(0.5, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.18)');
        g.fillStyle = grd; g.fillRect(px, py, w, h);
      }
    }
    noise(g, 256, 256, 1500, 11, 0.05);
    return tex(c);
  }),
  floor: (base = '#8a8680') => cached(`floor${base}`, () => {
    const [c, g] = canvas(256, 256);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 12000, 5, 0.1);
    g.strokeStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    return tex(c);
  }),
  platformEdge: () => cached('pedge', () => {
    const [c, g] = canvas(128, 64);
    g.fillStyle = '#e8e2d0'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#f2c200'; g.fillRect(0, 22, 128, 20);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 4; x < 128; x += 10) for (let y = 26; y < 40; y += 8) { g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill(); }
    return tex(c);
  }),
  rail: () => cached('rail', () => {
    const [c, g] = canvas(16, 64);
    const grd = g.createLinearGradient(0, 0, 16, 0);
    grd.addColorStop(0, '#5b4a3d'); grd.addColorStop(0.5, '#c9c6c0'); grd.addColorStop(1, '#5b4a3d');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 64);
    return tex(c);
  }),
  label: (text, { w = 512, h = 96, bg = '#0b2a6f', fg = '#ffffff', font = 'bold 56px "Helvetica Neue", Arial, sans-serif', border = null, radius = 10 } = {}) =>
    cached(`label${text}${w}${h}${bg}${fg}${font}${border}`, () => {
      const [c, g] = canvas(w, h);
      g.fillStyle = bg;
      roundRect(g, 0, 0, w, h, radius); g.fill();
      if (border) { g.strokeStyle = border; g.lineWidth = Math.max(4, h * 0.06); roundRect(g, 4, 4, w - 8, h - 8, radius); g.stroke(); }
      g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = parseInt(font.match(/(\d+)px/)?.[1] || 48, 10);
      while (g.measureText(text).width > w * 0.9 && size > 10) { size -= 2; g.font = font.replace(/\d+px/, `${size}px`); }
      g.fillText(text, w / 2, h / 2 + 2);
      return tex(c, false);
    }),
  poster: (seed) => cached(`poster${seed}`, () => {
    const r = seededRandom(seed * 977 + 13);
    const ads = [
      ['CAFÉ LUMIÈRE', 'Roasted at dawn', '#3b2314', '#f3d7a8'],
      ['NORDWIND AIR', 'Fly further for less', '#0d3b66', '#faf0ca'],
      ['OPÉRA NOVA', 'The new season begins', '#5c0f2e', '#f4d35e'],
      ['VÉLO VERT', 'Ride the city', '#1b512d', '#c9f2c7'],
      ['MUSÉE DES MACHINES', 'Steam · Steel · Speed', '#222222', '#ff9f1c'],
      ['PIXELPHONE 9', 'See every detail', '#101820', '#7ee8fa'],
      ['LIBRAIRIE DU QUAI', 'Read on the way', '#6b4226', '#f7ede2'],
      ['SOLEIL EXPRESS', 'Summer trains to the coast', '#ff7b00', '#fff3b0'],
      ['CITY CARD+', 'One pass, every line', '#3a0ca3', '#f1faee'],
      ['BOULANGERIE 1907', 'Fresh every hour', '#9c6644', '#fff8e7'],
    ];
    const [title, sub, bg, fg] = ads[Math.floor(r() * ads.length)];
    const [c, g] = canvas(512, 384);
    const grd = g.createLinearGradient(0, 0, 512, 384);
    grd.addColorStop(0, bg); grd.addColorStop(1, shade(bg, -30));
    g.fillStyle = grd; g.fillRect(0, 0, 512, 384);
    g.globalAlpha = 0.25; g.fillStyle = fg;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(r() * 512, r() * 384, 30 + r() * 120, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    g.fillStyle = fg; g.font = 'bold 54px Georgia, serif'; g.textAlign = 'center';
    let size = 54; while (g.measureText(title).width > 470) { size -= 2; g.font = `bold ${size}px Georgia, serif`; }
    g.fillText(title, 256, 200);
    g.font = 'italic 28px Georgia, serif'; g.fillText(sub, 256, 250);
    g.strokeStyle = '#111'; g.lineWidth = 18; g.strokeRect(0, 0, 512, 384);
    return tex(c, false);
  }),
};

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + amt));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}
