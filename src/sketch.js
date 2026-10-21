// Real-time sketch playback, slaved to the transport (normally the video).
// A look-ahead scheduler queues events slightly ahead of the audio clock; if the
// audio clock and the video drift apart, it simply re-anchors.

import { createMixGraph, playEvent, QUALITY } from './instruments.js';
import { SUSTAINED } from './generator.js';

const LOOKAHEAD = 0.35; // seconds of audio queued ahead
const TICK_MS = 40;
const DRIFT_LIMIT = 0.12; // seconds of audio/video disagreement before re-anchoring

function lowerBound(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class SketchPlayer {
  constructor(transport) {
    this.transport = transport;
    this.ctx = null;
    this.graph = null;
    this.events = [];
    this.mutes = {};
    this.session = null;
    transport.addEventListener('play', () => this.start());
    transport.addEventListener('pause', () => this.stop());
    transport.addEventListener('seek', () => {
      if (transport.playing) this.start();
    });
  }

  // Browsers only allow audio to start from a user gesture, so call this from one.
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = createMixGraph(this.ctx, QUALITY.sketch, { mutes: this.mutes });
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  // New events take effect from the end of what is already queued, so editing
  // while playing doesn't interrupt the sound.
  setEvents(events, mutes) {
    this.events = events;
    this.mutes = mutes;
    this.graph?.applyMutes(mutes);
    if (this.session) this.session.next = lowerBound(events, this.session.until);
  }

  start() {
    this.stop();
    this.unlock();
    const ctx = this.ctx;
    const s = {
      v0: this.transport.time,
      c0: ctx.currentTime,
      latency: ctx.outputLatency || ctx.baseLatency || 0,
      sources: new Set(),
      next: 0,
      until: 0,
      timer: 0,
    };
    s.next = lowerBound(this.events, s.v0);
    s.until = s.v0;
    this.session = s;
    for (let i = 0; i < s.next; i++) {
      const ev = this.events[i];
      if (SUSTAINED.has(ev.type) && ev.t + ev.dur > s.v0) this.schedule(ev, s);
    }
    this.tick();
    s.timer = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const s = this.session;
    if (!s) return;
    const now = s.v0 + (this.ctx.currentTime - s.c0);
    if (Math.abs(this.transport.time - now) > DRIFT_LIMIT) {
      this.start();
      return;
    }
    s.until = now + LOOKAHEAD;
    while (s.next < this.events.length && this.events[s.next].t < s.until) this.schedule(this.events[s.next++], s);
  }

  schedule(ev, s) {
    // Play early by the output latency so sound and picture arrive together.
    let when = s.c0 + (ev.t - s.v0) - s.latency;
    if (when < 0) {
      // Web Audio rejects negative times, which happen when a long note began
      // before the playhead just after the context was created: shorten it instead.
      if (ev.dur + when <= 0.05) return;
      ev = { ...ev, dur: ev.dur + when };
      when = 0;
    }
    playEvent(this.ctx, this.graph, ev, when, QUALITY.sketch, node => {
      s.sources.add(node);
      node.onended = () => s.sources.delete(node);
    });
  }

  stop() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    clearInterval(s.timer);
    const t = this.ctx.currentTime;
    this.graph.duck(t);
    for (const node of s.sources) {
      try {
        node.stop(t + 0.04);
      } catch {
        // already stopped
      }
    }
  }

  get info() {
    const c = this.ctx;
    return c && { state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency };
  }
}
