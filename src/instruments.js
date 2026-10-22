// Synthesis shared by the sketch player (AudioContext, real time) and the final
// render (OfflineAudioContext). Each instrument turns one generator event into
// Web Audio nodes; QUALITY decides how much CPU is spent doing it.
//
// Level and send values are first guesses, to be tuned by ear.

import { LAYERS } from './generator.js';
import { makeRng } from './rng.js';

export const QUALITY = {
  sketch: { unison: 2, detune: 9, irSeconds: 3.5, oversample: 'none', limiter: true },
  final: { unison: 5, detune: 11, irSeconds: 6.5, oversample: '4x', limiter: false },
};

const LEVEL = { piano: 0.6, tune: 0.55, strings: 0.45, bass: 0.55, pulse: 0.35, perc: 0.7, electronics: 0.45, impact: 0.9, tail: 0.5 };
const SEND = { piano: 0.35, tune: 0.4, strings: 0.45, bass: 0.08, pulse: 0.25, perc: 0.3, electronics: 0.35, impact: 0.5, tail: 0.85 };
const OUT_LEVEL = 0.6;
const MIN = 0.0001; // exponential ramps cannot reach zero

const mtof = n => 440 * 2 ** ((n - 69) / 12);

// Synthetic stereo reverb impulse: decorrelated noise with an exponential decay
// that darkens over time, plus a few early reflections. Seeded, so renders repeat.
function makeImpulse(ctx, seconds, seed = 7) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(seconds * sr);
  const buffer = ctx.createBuffer(2, len, sr);
  const rng = makeRng(seed);
  const preDelay = Math.floor(0.018 * sr);
  const rt60 = seconds * 0.85;
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let lp = 0, energy = 0;
    for (let i = preDelay; i < len; i++) {
      const t = i / sr;
      lp += (0.12 + 0.8 * Math.exp(-t * 1.4)) * (rng() * 2 - 1 - lp);
      d[i] = lp * Math.exp((-6.9 * t) / rt60);
    }
    for (let k = 0; k < 12; k++) d[preDelay + Math.floor(rng() * 0.08 * sr)] += (rng() - 0.5) * 0.5;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const norm = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return buffer;
}

const noiseCache = new WeakMap();
function noiseSource(ctx) {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    const rng = makeRng(0x5eed);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

const curveCache = new Map();
function saturator(ctx, drive, q) {
  let curve = curveCache.get(drive);
  if (!curve) {
    curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    curveCache.set(drive, curve);
  }
  const ws = ctx.createWaveShaper();
  ws.curve = curve;
  ws.oversample = q.oversample;
  return ws;
}

// Start a source at t0, which in the sketch player may already be in the past
// (a long note that began before the playhead): oscillators then start now, and
// buffers start part-way through.
function run(ctx, node, t0, t1, track) {
  const now = ctx.currentTime;
  const at = Math.max(t0, now);
  if (node.buffer && t0 < now) node.start(at, (now - t0) % node.buffer.duration);
  else node.start(at);
  node.stop(Math.max(t1, at + 0.01));
  track(node);
}

function unison(ctx, freq, type, t0, t1, dest, q, track, voices = q.unison) {
  const mix = ctx.createGain();
  mix.gain.value = 1 / Math.sqrt(voices);
  mix.connect(dest);
  const oscs = [];
  for (let i = 0; i < voices; i++) {
    const spread = voices === 1 ? 0 : (i / (voices - 1)) * 2 - 1;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = spread * q.detune;
    const pan = ctx.createStereoPanner();
    pan.pan.value = spread * 0.7;
    o.connect(pan).connect(mix);
    run(ctx, o, t0, t1, track);
    oscs.push(o);
  }
  return oscs;
}

function sustainEnv(ctx, t0, t1, peak, attack, release) {
  const g = ctx.createGain();
  const held = Math.max(t0 + attack, t1);
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setValueAtTime(peak, held);
  g.gain.linearRampToValueAtTime(0, held + release);
  return g;
}

function strings(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const attack = ev.attack ?? Math.min(1.6, ev.dur * 0.4);
  const release = Math.min(2.2, Math.max(0.4, ev.dur * 0.5));
  const cutoff = 450 + 2600 * ev.vel;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = 0.6;
  filt.frequency.setValueAtTime(cutoff * 0.5, t0);
  filt.frequency.linearRampToValueAtTime(cutoff, t0 + attack);
  const amp = sustainEnv(ctx, t0, t1, ev.vel / Math.sqrt(ev.notes.length), attack, release);
  filt.connect(amp).connect(out);
  for (const n of ev.notes) unison(ctx, mtof(n), 'sawtooth', t0, t1 + release, filt, q, track);
}

function bass(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const attack = ev.dur > 4 ? Math.min(2.5, ev.dur * 0.3) : 0.03;
  const release = 0.5;
  const f = mtof(ev.note);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 220 + 500 * ev.vel;
  const amp = sustainEnv(ctx, t0, t1 - release * 0.5, ev.vel, attack, release);
  filt.connect(amp).connect(out);
  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f;
  tri.connect(filt);
  run(ctx, tri, t0, t1 + release, track);
  const sub = ctx.createOscillator();
  sub.frequency.value = f / 2;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.7;
  sub.connect(subGain).connect(filt);
  run(ctx, sub, t0, t1 + release, track);
}

function pulse(ctx, ev, t0, out, q, track) {
  const t1 = t0 + Math.max(ev.dur, 0.08) + 0.25;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = 5;
  filt.frequency.setValueAtTime(300 + 3800 * ev.vel, t0);
  filt.frequency.exponentialRampToValueAtTime(220, t0 + 0.2);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel * 0.8, t0 + 0.004);
  amp.gain.exponentialRampToValueAtTime(MIN, t1);
  filt.connect(amp).connect(out);
  unison(ctx, mtof(ev.note), 'sawtooth', t0, t1, filt, q, track, Math.min(2, q.unison));
}

function perc(ctx, ev, t0, out, q, track) {
  const p = ev.pitch ?? 1;
  const t1 = t0 + 0.8;
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(150 * p, t0);
  body.frequency.exponentialRampToValueAtTime(45 * p, t0 + 0.3);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel, t0 + 0.002);
  amp.gain.exponentialRampToValueAtTime(MIN, t1);
  body.connect(saturator(ctx, 2.5, q)).connect(amp).connect(out);
  run(ctx, body, t0, t1, track);

  const click = noiseSource(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2000;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(ev.vel * 0.35, t0);
  cg.gain.exponentialRampToValueAtTime(MIN, t0 + 0.06);
  click.connect(bp).connect(cg).connect(out);
  run(ctx, click, t0, t0 + 0.08, track);
}

function riser(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const noise = noiseSource(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.5;
  bp.frequency.setValueAtTime(250, t0);
  bp.frequency.exponentialRampToValueAtTime(3000 + 5000 * ev.color, t1);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(MIN, t0);
  ng.gain.exponentialRampToValueAtTime(ev.vel * 0.35, t1);
  ng.gain.linearRampToValueAtTime(0, t1 + 0.012); // choke exactly on the hit
  noise.connect(bp).connect(ng).connect(out);
  run(ctx, noise, t0, t1 + 0.02, track);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(250, t0);
  lp.frequency.exponentialRampToValueAtTime(5000, t1);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(MIN, t0);
  tg.gain.exponentialRampToValueAtTime(ev.vel * 0.18, t1);
  tg.gain.linearRampToValueAtTime(0, t1 + 0.012);
  lp.connect(tg).connect(out);
  for (const interval of [0, 7]) {
    const f0 = mtof(ev.note + interval);
    for (const o of unison(ctx, f0, 'sawtooth', t0, t1 + 0.02, lp, q, track)) {
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 2, t1); // up an octave into the hit
    }
  }
}

function swell(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const noise = noiseSource(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(MIN, t0);
  g.gain.exponentialRampToValueAtTime(ev.vel * 0.5, t1);
  g.gain.linearRampToValueAtTime(0, t1 + 0.015);
  noise.connect(hp).connect(g).connect(out);
  run(ctx, noise, t0, t1 + 0.02, track);
}

function impact(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const sub = ctx.createOscillator();
  sub.frequency.setValueAtTime(62, t0);
  sub.frequency.exponentialRampToValueAtTime(28, t0 + 2.2);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel, t0 + 0.004);
  amp.gain.exponentialRampToValueAtTime(MIN, t1);
  sub.connect(saturator(ctx, 3, q)).connect(amp).connect(out);
  run(ctx, sub, t0, t1, track);

  const noise = noiseSource(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(7000, t0);
  lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.9);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t0);
  ng.gain.linearRampToValueAtTime(ev.vel * 0.6, t0 + 0.002);
  ng.gain.exponentialRampToValueAtTime(MIN, t0 + 1.4);
  noise.connect(lp).connect(ng).connect(out);
  run(ctx, noise, t0, t0 + 1.5, track);
}

function stab(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur + 0.4;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(6500, t0);
  filt.frequency.exponentialRampToValueAtTime(800, t0 + ev.dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel / Math.sqrt(ev.notes.length), t0 + 0.006);
  amp.gain.exponentialRampToValueAtTime(MIN, t1);
  filt.connect(amp).connect(out);
  for (const n of ev.notes) unison(ctx, mtof(n), 'sawtooth', t0, t1, filt, q, track);
}

function tail(ctx, ev, t0, out, q, track) {
  const attack = Math.min(0.4, ev.dur * 0.3);
  // Fade out well before the cue's end so the reverb rings out inside the file.
  const fadeEnd = Math.max(t0 + attack + 0.05, t0 + ev.dur - Math.min(2, ev.dur * 0.35));
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(1800, t0);
  filt.frequency.exponentialRampToValueAtTime(450, fadeEnd);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel / Math.sqrt(ev.notes.length), t0 + attack);
  amp.gain.linearRampToValueAtTime(0, fadeEnd);
  filt.connect(amp).connect(out);
  for (const n of ev.notes) unison(ctx, mtof(n), 'sawtooth', t0, fadeEnd + 0.05, filt, q, track);
}

// A soft electric piano (Rhodes-like FM) standing in for the piano: a sine
// tone modulated by another at the same pitch, with the modulation dying away
// so each note starts bright and mellows, plus a short bell-like "tine" at the
// attack. It doesn't pretend to be a real piano, so it doesn't sound like a bad
// one. A real piano would come from samples or the user's own recordings.
function piano(ctx, ev, t0, out, q, track) {
  const peak = ev.vel / Math.sqrt(ev.notes.length);
  ev.notes.forEach((n, i) => {
    const f = mtof(n);
    const ring = Math.min(4.5, Math.max(0.9, 4.5 - (n - 36) * 0.06)); // lower notes ring longer
    const t1 = t0 + Math.min(ev.dur, ring);
    const end = t1 + 0.4;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(peak, t0 + 0.003);
    amp.gain.setTargetAtTime(0, t0 + 0.003, ring / 6.9);
    amp.gain.setTargetAtTime(0, t1, 0.08); // damper
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.5, Math.min(0.5, (n - 62) / 40)) + (i % 2 ? 0.05 : -0.05);
    amp.connect(pan).connect(out);
    const index = 1.2 + 2.3 * ev.vel; // brightness of the attack
    // [modulator ratio, starting index, index decay time constant, level]
    for (const [ratio, idx, fall, level] of [[1, index, 0.35, 1], [14, 0.5 + ev.vel, 0.025, 0.12]]) {
      const car = ctx.createOscillator();
      car.frequency.value = f;
      car.detune.value = level < 1 ? 0 : 3; // a touch of warmth against the tine
      const mod = ctx.createOscillator();
      mod.frequency.value = f * ratio;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(idx * f * ratio, t0);
      depth.gain.setTargetAtTime(0.15 * f * ratio * (level < 1 ? 0 : 1), t0, fall);
      mod.connect(depth).connect(car.frequency);
      const g = ctx.createGain();
      g.gain.value = level;
      car.connect(g).connect(amp);
      run(ctx, mod, t0, end, track);
      run(ctx, car, t0, end, track);
    }
  });
}

function harp(ctx, ev, t0, out, q, track) {
  const f = mtof(ev.note);
  const t1 = t0 + 1.8;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(Math.min(12000, f * 6), t0);
  filt.frequency.exponentialRampToValueAtTime(Math.min(12000, f * 1.5), t1);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(ev.vel, t0 + 0.003);
  amp.gain.exponentialRampToValueAtTime(MIN, t1);
  filt.connect(amp).connect(out);
  for (const [ratio, type, level] of [[1, 'triangle', 1], [2, 'sine', 0.3]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(filt);
    run(ctx, o, t0, t1, track);
  }
}

function snare(ctx, ev, t0, out, q, track) {
  const noise = noiseSource(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t0);
  ng.gain.linearRampToValueAtTime(ev.vel * 0.6, t0 + 0.002);
  ng.gain.exponentialRampToValueAtTime(MIN, t0 + 0.16);
  noise.connect(hp).connect(ng).connect(out);
  run(ctx, noise, t0, t0 + 0.18, track);
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(200, t0);
  body.frequency.exponentialRampToValueAtTime(160, t0 + 0.06);
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(ev.vel * 0.5, t0);
  bg.gain.exponentialRampToValueAtTime(MIN, t0 + 0.07);
  body.connect(bg).connect(out);
  run(ctx, body, t0, t0 + 0.08, track);
}

// Low brass; with a high drive it becomes the distorted electronic buzz.
function brass(ctx, ev, t0, out, q, track, drive = 1.5) {
  const t1 = t0 + ev.dur;
  const attack = Math.min(0.25, ev.dur * 0.3);
  const release = 0.6;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.Q.value = 1.2;
  filt.frequency.setValueAtTime(180, t0);
  filt.frequency.exponentialRampToValueAtTime(200 + 1800 * ev.vel * (drive > 3 ? 2 : 1), t0 + attack * 2 + 0.01);
  const amp = sustainEnv(ctx, t0, t1, ev.vel / Math.sqrt(ev.notes.length), attack, release);
  filt.connect(saturator(ctx, drive, q)).connect(amp).connect(out);
  for (const n of ev.notes) unison(ctx, mtof(n), 'sawtooth', t0, t1 + release, filt, q, track);
}

const buzz = (ctx, ev, t0, out, q, track) => brass(ctx, ev, t0, out, q, track, 6);

// A sustained singing line for the tune, with a little vibrato.
function lead(ctx, ev, t0, out, q, track) {
  const t1 = t0 + ev.dur;
  const attack = Math.min(0.12, ev.dur * 0.3);
  const release = 0.35;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1200 + 2000 * ev.vel;
  const amp = sustainEnv(ctx, t0, t1, ev.vel, attack, release);
  filt.connect(amp).connect(out);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.value = 14; // cents
  lfo.connect(depth);
  run(ctx, lfo, t0, t1 + release, track);
  for (const o of unison(ctx, mtof(ev.note), 'sawtooth', t0, t1 + release, filt, q, track, Math.min(3, q.unison))) {
    depth.connect(o.detune);
  }
}

const INSTRUMENTS = { strings, piano, harp, snare, brass, buzz, lead, bass, pulse, perc, riser, swell, impact, stab, tail };

// Per-layer gains feeding a shared reverb and output. `mutes` silences layers;
// for stems, the renderer mutes everything but one layer.
export function createMixGraph(ctx, q, { mutes = {} } = {}) {
  const out = ctx.createGain();
  out.gain.value = OUT_LEVEL;
  if (q.limiter) {
    // Sketch only: protect ears and speakers. The final render is normalised instead.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 3;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    out.connect(comp).connect(ctx.destination);
  } else {
    out.connect(ctx.destination);
  }
  const reverb = ctx.createConvolver();
  reverb.normalize = false;
  reverb.buffer = makeImpulse(ctx, q.irSeconds);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.6;
  reverb.connect(reverbReturn).connect(out);

  const bus = {};
  for (const layer of LAYERS) {
    const g = ctx.createGain();
    g.gain.value = mutes[layer] ? 0 : LEVEL[layer];
    const send = ctx.createGain();
    send.gain.value = SEND[layer];
    g.connect(out);
    g.connect(send).connect(reverb);
    bus[layer] = g;
  }

  return {
    bus,
    applyMutes(next) {
      const now = ctx.currentTime;
      for (const layer of LAYERS) bus[layer].gain.setTargetAtTime(next[layer] ? 0 : LEVEL[layer], now, 0.02);
    },
    // Briefly silence the output so stopped sources don't click.
    duck(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setTargetAtTime(0, at, 0.008);
      out.gain.setTargetAtTime(OUT_LEVEL, at + 0.06, 0.01);
    },
  };
}

export function playEvent(ctx, graph, ev, t0, q, track = () => {}) {
  INSTRUMENTS[ev.type](ctx, ev, t0, graph.bus[ev.layer], q, track);
}
