// Full-size interactive network map opened from the cab's network screen: drag to pan, wheel / buttons to
// zoom, "follow train" keeps the train centred, "whole network" fits the map. Redrawn ~15 times a second from
// live game state while open.
import { drawNetwork } from './NetworkScreen.js';

export class NetworkOverlay {
  constructor(parent) {
    const el = this.el = document.createElement('div');
    el.className = 'net-overlay'; el.hidden = true;
    el.innerHTML = `<canvas></canvas>
      <div class="net-tools">
        <button class="btn small" data-z="1.4" title="Zoom in">＋</button><button class="btn small" data-z="0.714" title="Zoom out">－</button>
        <button class="btn small" data-fit>Whole network</button><button class="btn small" data-follow>Follow train</button>
        <button class="btn small primary" data-close>Close ✕</button></div>
      <div class="net-hint">Drag to move · wheel to zoom · G or Esc to close</div>`;
    parent.appendChild(el);
    this.canvas = el.querySelector('canvas');
    this.follow = true;
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || !this.view) return;
      this.view.cx -= (e.clientX - drag.x) / this.view.scale; this.view.cz -= (e.clientY - drag.y) / this.view.scale;
      drag = { x: e.clientX, y: e.clientY }; this.setFollow(false);
    });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, { passive: false });
    el.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => this.zoom(Number(b.dataset.z))));
    el.querySelector('[data-fit]').onclick = () => { this.setFollow(false); this.view = this.model.fit(this.canvas.width, this.canvas.height, 60); };
    el.querySelector('[data-follow]').onclick = () => this.setFollow(!this.follow);
    el.querySelector('[data-close]').onclick = () => this.close();
    window.addEventListener('keydown', (e) => { if (!el.hidden && e.code === 'Escape') { e.stopPropagation(); this.close(); } }, true);
  }
  get open() { return !this.el.hidden; }
  setFollow(f) { this.follow = f; this.el.querySelector('[data-follow]').classList.toggle('primary', f); }
  zoom(f, ox, oy) {
    if (!this.view) return;
    const W = this.canvas.width, H = this.canvas.height;
    const px = ox ?? W / 2, py = oy ?? H / 2;
    const wx = this.view.cx + (px - W / 2) / this.view.scale, wz = this.view.cz + (py - H / 2) / this.view.scale;
    this.view.scale = Math.max(0.01, Math.min(2.5, this.view.scale * f));
    if (!this.follow || ox != null) { this.view.cx = wx - (px - W / 2) / this.view.scale; this.view.cz = wz - (py - H / 2) / this.view.scale; }
  }
  toggle(model, stateFn) { if (this.open) this.close(); else this.show(model, stateFn); }
  show(model, stateFn) {
    this.model = model; this.stateFn = stateFn;
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.canvas.width = Math.max(320, Math.round(r.width)); this.canvas.height = Math.max(240, Math.round(r.height));
    const fit = model.fit(this.canvas.width, this.canvas.height, 60);
    const st = stateFn();
    this.view = { cx: st.train?.x ?? fit.cx, cz: st.train?.z ?? fit.cz, scale: Math.max(fit.scale * 2.5, 0.12) };
    this.setFollow(true);
    const loop = () => {
      if (this.el.hidden) return;
      this.draw();
      this.timer = setTimeout(() => requestAnimationFrame(loop), 66);
    };
    loop();
  }
  draw() {
    const st = this.stateFn(); const g = this.canvas.getContext('2d'); if (!g) return;
    if (this.follow && st.train) { this.view.cx += (st.train.x - this.view.cx) * 0.3; this.view.cz += (st.train.z - this.view.cz) * 0.3; }
    drawNetwork(g, this.canvas.width, this.canvas.height, this.model, this.view, st);
  }
  close() { this.el.hidden = true; clearTimeout(this.timer); }
}
