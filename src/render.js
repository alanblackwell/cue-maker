// Final-quality render: the same events and instruments as the sketch, played
// into an OfflineAudioContext at 48 kHz with the heavier QUALITY.final settings.
// Offline rendering is not limited by real-time CPU, which is where most of the
// quality difference comes from.

import { createMixGraph, playEvent, QUALITY } from './instruments.js';
import { LAYERS } from './generator.js';

export const RENDER_RATE = 48000;
const END_FADE = 0.3; // seconds; guards against anything still ringing at the cue's end

export async function renderCue(doc, events, { layers = LAYERS, onProgress = () => {} } = {}) {
  const { start, end } = doc.points;
  const duration = end - start;
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(duration * RENDER_RATE),
    sampleRate: RENDER_RATE,
  });
  const silent = layer => doc.mutes[layer] || !layers.includes(layer);
  const mutes = Object.fromEntries(LAYERS.map(l => [l, silent(l)]));
  const graph = createMixGraph(ctx, QUALITY.final, { mutes });
  for (const ev of events) {
    if (!silent(ev.layer)) playEvent(ctx, graph, ev, Math.max(0, ev.t - start), QUALITY.final);
  }
  for (let s = 1; s < duration; s++) {
    ctx.suspend(s).then(() => {
      onProgress(s / duration);
      ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  fadeOut(buffer, END_FADE);
  onProgress(1);
  return buffer;
}

function fadeOut(buffer, seconds) {
  const n = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) d[d.length - n + i] *= 1 - i / n;
  }
}

export function peakOf(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  return peak;
}
