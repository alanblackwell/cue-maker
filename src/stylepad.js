// The style pad: a round space with the three reference composers marked inside
// it and one draggable point. Nearer a name sounds more like that composer;
// past a name, towards the rim, exaggerates them.

import { COMPOSERS, STYLE_RADIUS } from './generator.js';

const DOT_R = 7;
const KEY_STEP = 0.04;

export class StylePad {
  constructor(canvas, { onChange, onDragEnd }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.onDragEnd = onDragEnd;
    this.point = [0, 0];
    this.dragging = false;
    new ResizeObserver(() => this.resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.moveTo(this.fromEvent(e));
    });
    canvas.addEventListener('pointermove', e => this.dragging && this.moveTo(this.fromEvent(e)));
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.onDragEnd?.(this.point);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      this.moveTo([this.point[0] + d[0] * KEY_STEP, this.point[1] + d[1] * KEY_STEP]);
      this.onDragEnd?.(this.point);
    });
  }

  set(point) {
    this.point = point;
    this.draw();
  }

  moveTo([x, y]) {
    const r = Math.hypot(x, y);
    if (r > STYLE_RADIUS) [x, y] = [(x / r) * STYLE_RADIUS, (y / r) * STYLE_RADIUS];
    this.point = [x, y];
    this.draw();
    this.onChange(this.point);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  get scale() {
    return (Math.min(this.w, this.h) / 2 - DOT_R - 1) / STYLE_RADIUS;
  }
  toPx([x, y]) {
    return [this.w / 2 + x * this.scale, this.h / 2 + y * this.scale];
  }
  fromEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.w / 2) / this.scale, (e.clientY - r.top - this.h / 2) / this.scale];
  }

  draw() {
    if (!this.w) return;
    const c = this.ctx;
    const css = getComputedStyle(this.canvas);
    const v = name => css.getPropertyValue(name).trim();
    c.clearRect(0, 0, this.w, this.h);

    // The space.
    const [cx, cy] = this.toPx([0, 0]);
    const R = STYLE_RADIUS * this.scale;
    c.fillStyle = v('--surface-2');
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = v('--border');
    c.lineWidth = 1;
    c.stroke();

    // Reference points and names.
    c.font = '12px ' + v('--font-ui');
    c.textAlign = 'center';
    for (const k of COMPOSERS) {
      const [x, y] = this.toPx(k.at);
      c.fillStyle = v('--muted');
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = v('--text');
      c.textBaseline = k.at[1] < 0 ? 'bottom' : 'top';
      c.fillText(k.label, x, y + (k.at[1] < 0 ? -6 : 6));
    }

    // The point.
    const [px, py] = this.toPx(this.point);
    c.fillStyle = v('--accent');
    c.strokeStyle = v('--surface');
    c.lineWidth = 2;
    c.beginPath();
    c.arc(px, py, DOT_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
}
