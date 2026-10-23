// Canvas timeline: phase regions, the fitted bar grid, the intensity curve, one
// lane of events per layer, draggable phase points, clickable Final Cut markers
// and the playhead.

import { LAYERS, LAYER_LABELS, POINT_KEYS } from './generator.js';

const PAD_L = 78;
const PAD_R = 14;
const RULER_H = 20;
const BAND_TOP = 20;
const BAND_H = 24;
const CURVE_TOP = 52;
const CURVE_BOT = 108;
const LANE_TOP = 116;
const LANE_H = 15;
const GRAB_PX = 7;
const MARKER_GRAB_PX = 6;
// Short, repeated events, drawn as ticks rather than bars.
const TICKS = new Set(['pulse', 'harp', 'perc', 'snare']);
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

const PHASES = [
  ['start', 'build', 'Intro', '--phase-intro'],
  ['build', 'hit', 'Build', '--phase-build'],
  ['hit', 'tail', 'Climax', '--phase-climax'],
  ['tail', 'end', 'Tail', '--phase-tail'],
];

export class Timeline {
  constructor(canvas, { onSeek, onMovePoint, onDragEnd, onMarkerClick, formatTime }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = { onSeek, onMovePoint, onDragEnd, onMarkerClick };
    this.formatTime = formatTime;
    this.model = null;
    this.playhead = 0;
    this.drag = null;
    this.w = 0;
    this.h = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
    canvas.addEventListener('pointerdown', e => this.onDown(e));
    canvas.addEventListener('pointermove', e => this.onMove(e));
    canvas.addEventListener('pointerup', () => this.onUp());
    canvas.addEventListener('pointercancel', () => this.onUp());
    // On click, not pointerdown, so a popup it opens isn't light-dismissed by
    // the same press's pointerup.
    canvas.addEventListener('click', e => this.onClick(e));
  }

  // model: { points, tempo, events, markers, mutes, duration, intensity(t) }
  setModel(model) {
    this.model = model;
    this.draw();
  }

  setPlayhead(t) {
    if (t === this.playhead) return;
    this.playhead = t;
    this.draw();
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

  get pxPerSec() {
    return (this.w - PAD_L - PAD_R) / this.model.duration;
  }
  xOf(t) {
    return PAD_L + t * this.pxPerSec;
  }
  tOf(x) {
    return Math.max(0, Math.min(this.model.duration, (x - PAD_L) / this.pxPerSec));
  }
  localX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }
  localY(e) {
    return e.clientY - this.canvas.getBoundingClientRect().top;
  }

  // Markers sit on the ruler, above the phase points' reach.
  markerNear(x, y) {
    if (y >= BAND_TOP) return null;
    let best = null, bestDist = MARKER_GRAB_PX;
    for (const mk of this.model.markers ?? []) {
      const d = Math.abs(this.xOf(mk.t) - x);
      if (d <= bestDist) [best, bestDist] = [mk, d];
    }
    return best;
  }

  pointNear(x) {
    let best = null, bestDist = GRAB_PX;
    for (const k of POINT_KEYS) {
      const d = Math.abs(this.xOf(this.model.points[k]) - x);
      if (d <= bestDist) [best, bestDist] = [k, d];
    }
    return best;
  }

  onDown(e) {
    if (!this.model) return;
    const x = this.localX(e);
    const marker = this.markerNear(x, this.localY(e));
    if (marker) {
      this.handlers.onSeek(marker.t);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const key = this.pointNear(x);
    this.drag = key ? { kind: 'point', key } : { kind: 'scrub' };
    if (!key) this.handlers.onSeek(this.tOf(x));
  }

  onMove(e) {
    if (!this.model) return;
    const x = this.localX(e);
    if (!this.drag) {
      const marker = this.markerNear(x, this.localY(e));
      this.canvas.title = marker ? `${marker.name || 'Marker'}: click to make it a phase point` : '';
      this.canvas.style.cursor = !marker && this.pointNear(x) ? 'ew-resize' : 'pointer';
      return;
    }
    if (this.drag.kind === 'point') this.handlers.onMovePoint(this.drag.key, this.tOf(x));
    else this.handlers.onSeek(this.tOf(x));
  }

  onClick(e) {
    if (!this.model) return;
    const marker = this.markerNear(this.localX(e), this.localY(e));
    if (marker) this.handlers.onMarkerClick?.(marker, e.clientX, e.clientY);
  }

  onUp() {
    if (this.drag?.kind === 'point') this.handlers.onDragEnd?.();
    this.drag = null;
  }

  draw() {
    const { ctx: c, model: m, w, h } = this;
    if (!m || !w) return;
    const css = getComputedStyle(this.canvas);
    const v = name => css.getPropertyValue(name).trim();
    const p = m.points;
    const pps = this.pxPerSec;

    c.clearRect(0, 0, w, h);
    c.font = `11px ${v('--font-ui')}`;
    c.textBaseline = 'middle';

    // Phase regions
    for (const [a, b, label, color] of PHASES) {
      const x0 = this.xOf(p[a]), x1 = this.xOf(p[b]);
      c.fillStyle = v(color);
      c.globalAlpha = 0.1;
      c.fillRect(x0, BAND_TOP, x1 - x0, h - BAND_TOP);
      c.globalAlpha = 0.9;
      c.fillRect(x0, BAND_TOP, x1 - x0, BAND_H);
      c.globalAlpha = 1;
      if (x1 - x0 > 34) {
        c.save();
        c.beginPath();
        c.rect(x0, BAND_TOP, x1 - x0, BAND_H);
        c.clip();
        c.fillStyle = v('--phase-text');
        c.fillText(label, x0 + 6, BAND_TOP + BAND_H / 2);
        c.restore();
      }
    }

    // Bar lines of the fitted tempo, counted from the cue start
    const { barDur } = m.tempo;
    if (barDur * pps >= 4) {
      c.strokeStyle = v('--grid');
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; p.start + i * barDur <= p.end + 1e-6; i++) {
        const x = Math.round(this.xOf(p.start + i * barDur)) + 0.5;
        c.moveTo(x, CURVE_TOP);
        c.lineTo(x, h);
      }
      c.stroke();
    }

    // Ruler
    const step = RULER_STEPS.find(s => s * pps >= 95) ?? RULER_STEPS[RULER_STEPS.length - 1];
    c.fillStyle = v('--muted');
    c.strokeStyle = v('--border');
    c.beginPath();
    for (let t = 0; t <= m.duration + 1e-6; t += step) {
      const x = Math.round(this.xOf(t)) + 0.5;
      c.moveTo(x, RULER_H - 6);
      c.lineTo(x, RULER_H);
      if (x + 80 < w) c.fillText(this.formatTime(t), x + 3, RULER_H / 2 - 1);
    }
    c.stroke();

    // Markers imported from Final Cut
    c.fillStyle = v('--marker');
    for (const mk of m.markers ?? []) {
      const x = this.xOf(mk.t);
      c.beginPath();
      c.moveTo(x - 4, RULER_H - 7);
      c.lineTo(x + 4, RULER_H - 7);
      c.lineTo(x, RULER_H);
      c.fill();
    }

    // Left-hand labels
    c.fillStyle = v('--muted');
    c.fillText('Intensity', 8, (CURVE_TOP + CURVE_BOT) / 2);
    LAYERS.forEach((layer, i) => {
      c.globalAlpha = m.mutes[layer] ? 0.4 : 1;
      c.fillText(LAYER_LABELS[layer], 8, LANE_TOP + i * LANE_H + LANE_H / 2);
    });
    c.globalAlpha = 1;

    // Intensity curve
    c.strokeStyle = v('--curve');
    c.lineWidth = 1.5;
    c.beginPath();
    const samples = Math.max(2, Math.floor(w - PAD_L - PAD_R));
    for (let i = 0; i <= samples; i++) {
      const t = (i / samples) * m.duration;
      const y = CURVE_BOT - m.intensity(t) * (CURVE_BOT - CURVE_TOP);
      if (i === 0) c.moveTo(this.xOf(t), y);
      else c.lineTo(this.xOf(t), y);
    }
    c.stroke();

    // Event lanes
    c.fillStyle = v('--event');
    for (const ev of m.events) {
      const lane = LAYERS.indexOf(ev.layer);
      const y = LANE_TOP + lane * LANE_H;
      const x = this.xOf(ev.t);
      const width = ev.dur * pps;
      c.globalAlpha = m.mutes[ev.layer] ? 0.2 : 0.6;
      if (width > 3 && !TICKS.has(ev.type)) c.fillRect(x, y + 3, width, LANE_H - 6);
      else c.fillRect(x, y + 2, 1.5, LANE_H - 4);
    }
    c.globalAlpha = 1;

    // Phase points
    for (const k of POINT_KEYS) {
      const x = Math.round(this.xOf(p[k])) + 0.5;
      c.strokeStyle = k === 'hit' ? v('--accent') : v('--text');
      c.lineWidth = k === 'hit' ? 2.5 : 1.5;
      c.beginPath();
      c.moveTo(x, BAND_TOP);
      c.lineTo(x, h);
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.fillRect(x - 3, BAND_TOP + BAND_H - 3, 6, 6);
    }

    // Playhead
    const x = Math.round(this.xOf(this.playhead)) + 0.5;
    c.strokeStyle = v('--playhead');
    c.fillStyle = v('--playhead');
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
    c.beginPath();
    c.moveTo(x - 5, 0);
    c.lineTo(x + 5, 0);
    c.lineTo(x, 7);
    c.fill();
  }
}
