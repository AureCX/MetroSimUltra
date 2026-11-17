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

// ---- "grand" station style ----
Object.assign(Textures, {
  /** Polished marble with soft veins. */
  marble: (base = '#efe6d2', vein = '#b9a27a', scale = 1) => cached(`marble${base}${vein}${scale}`, () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    const r = seededRandom(base.length * 31 + vein.length);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.06})`; g.fillRect(r() * 512, r() * 512, 8 + r() * 30, 8 + r() * 30); }
    g.strokeStyle = vein; g.lineCap = 'round';
    for (let v = 0; v < 14; v++) {
      g.globalAlpha = 0.15 + r() * 0.35; g.lineWidth = 0.6 + r() * 2.2;
      let x = r() * 512, y = r() * 512, a = r() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 40; k++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    // slab joints
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(1, 1, 510, 510); g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    return tex(c);
  }),
  /** Checkerboard marble floor with a border band. */
  marbleFloor: (a = '#e8e0cc', b = '#3d4a3f', accent = '#c9a227') => cached(`mfloor${a}${b}${accent}`, () => {
    const [c, g] = canvas(512, 512);
    const n = 4, t = 512 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * t, y * t, t, t); }
    g.globalAlpha = 0.5; noise(g, 512, 512, 9000, 21, 0.08); g.globalAlpha = 1;
    g.fillStyle = accent; for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) { g.save(); g.translate(x * t, y * t); g.rotate(Math.PI / 4); g.fillRect(-9, -9, 18, 18); g.restore(); }
    return tex(c);
  }),
  /** Deep blue vault with gilded coffers and stars. */
  vaultCoffers: (bg = '#1b2a4a', gold = '#d8b45a') => cached(`coffer${bg}${gold}`, () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
    const r = seededRandom(77);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = x * 128, py = y * 128;
      const grd = g.createLinearGradient(px, py, px + 128, py + 128);
      grd.addColorStop(0, shade(bg, 25)); grd.addColorStop(1, shade(bg, -20));
      g.fillStyle = grd; g.fillRect(px + 10, py + 10, 108, 108);
      g.strokeStyle = gold; g.lineWidth = 4; g.strokeRect(px + 10, py + 10, 108, 108);
      g.lineWidth = 1.5; g.strokeRect(px + 24, py + 24, 80, 80);
      // rosette
      g.fillStyle = gold; g.save(); g.translate(px + 64, py + 64);
      for (let k = 0; k < 8; k++) { g.rotate(Math.PI / 4); g.beginPath(); g.ellipse(0, 12, 4, 12, 0, 0, Math.PI * 2); g.fill(); }
      g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); g.restore();
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,236,180,${0.3 + r() * 0.6})`; g.beginPath(); g.arc(r() * 512, r() * 512, 0.8 + r() * 1.6, 0, Math.PI * 2); g.fill(); }
    return tex(c);
  }),
  /** Glowing stained-glass ribbon for a skylight. */
  stainedGlass: (seed = 1) => cached(`glass${seed}`, () => {
    const [c, g] = canvas(256, 512);
    const r = seededRandom(seed * 101);
    const pal = ['#f6c453', '#e85d3c', '#3e8ed0', '#4bb37a', '#f2efe6', '#9b5fc0', '#f29e4c'];
    g.fillStyle = '#2a1d0c'; g.fillRect(0, 0, 256, 512);
    for (let y = 0; y < 512; y += 64) for (let x = 0; x < 256; x += 64) {
      for (let k = 0; k < 4; k++) {
        g.fillStyle = pal[Math.floor(r() * pal.length)];
        g.beginPath();
        const cx = x + 32, cy = y + 32;
        g.moveTo(cx, cy);
        g.arc(cx, cy, 30, (k * Math.PI) / 2, ((k + 1) * Math.PI) / 2);
        g.closePath(); g.fill();
      }
      g.strokeStyle = '#2a1d0c'; g.lineWidth = 4; g.beginPath(); g.arc(x + 32, y + 32, 30, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x + 2, y + 32); g.lineTo(x + 62, y + 32); g.moveTo(x + 32, y + 2); g.lineTo(x + 32, y + 62); g.stroke();
    }
    return tex(c);
  }),
  /** Mosaic mural: a sunrise over the city, in small square tesserae. */
  mosaic: (title = '', accent = '#33E633') => cached(`mosaic${title}${accent}`, () => {
    const W = 1024, H = 512;
    const [c, g] = canvas(W, H);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#16325c'); sky.addColorStop(0.55, '#e98a4b'); sky.addColorStop(0.75, '#f6d27a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // sun with rays
    g.save(); g.translate(W / 2, H * 0.72);
    for (let k = 0; k < 24; k++) { g.rotate(Math.PI / 12); g.fillStyle = k % 2 ? 'rgba(255,230,150,0.35)' : 'rgba(255,200,90,0.25)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(-40, -H); g.lineTo(40, -H); g.closePath(); g.fill(); }
    g.fillStyle = '#ffd55a'; g.beginPath(); g.arc(0, 0, 110, 0, Math.PI * 2); g.fill(); g.restore();
    // skyline
    const r = seededRandom(9);
    g.fillStyle = '#1d2a3a';
    let x = 0;
    while (x < W) { const w = 30 + r() * 60, h = 60 + r() * 170; g.fillRect(x, H * 0.78 - h, w, h + H); if (r() < 0.3) { g.beginPath(); g.moveTo(x, H * 0.78 - h); g.lineTo(x + w / 2, H * 0.78 - h - 40); g.lineTo(x + w, H * 0.78 - h); g.fill(); } x += w + 4; }
    // cathedral dome in the middle
    g.beginPath(); g.arc(W / 2, H * 0.6, 70, Math.PI, 0); g.fill(); g.fillRect(W / 2 - 80, H * 0.6, 160, H); g.fillRect(W / 2 - 4, H * 0.6 - 120, 8, 60);
    // river band in line colour
    g.fillStyle = accent; g.fillRect(0, H * 0.86, W, 20);
    g.fillStyle = '#0f1f33'; g.fillRect(0, H * 0.86 + 20, W, H);
    // quantise into tesserae
    const img = g.getImageData(0, 0, W, H);
    const out = g.createImageData(W, H);
    const t = 8;
    for (let ty = 0; ty < H; ty += t) for (let tx = 0; tx < W; tx += t) {
      const i = ((ty + 4) * W + tx + 4) * 4;
      const jitter = (r() - 0.5) * 26;
      for (let yy = 0; yy < t; yy++) for (let xx = 0; xx < t; xx++) {
        const o = ((ty + yy) * W + tx + xx) * 4;
        const grout = xx === 0 || yy === 0;
        out.data[o] = grout ? 60 : Math.max(0, Math.min(255, img.data[i] + jitter));
        out.data[o + 1] = grout ? 55 : Math.max(0, Math.min(255, img.data[i + 1] + jitter));
        out.data[o + 2] = grout ? 50 : Math.max(0, Math.min(255, img.data[i + 2] + jitter));
        out.data[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    if (title) {
      g.fillStyle = 'rgba(15,25,40,0.85)'; g.fillRect(W / 2 - 300, 18, 600, 70);
      g.strokeStyle = '#d8b45a'; g.lineWidth = 4; g.strokeRect(W / 2 - 300, 18, 600, 70);
      g.fillStyle = '#f3dc9a'; g.font = 'bold 44px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(title.toUpperCase(), W / 2, 55);
    }
    return tex(c, false);
  }),
});

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + amt));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}
