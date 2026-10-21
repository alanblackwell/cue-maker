// The compositional rules. generate(doc) is a pure function from the project
// document to a list of timed musical events; both the sketch player and the
// final offline render play the same list, so the two only differ in sound
// quality, never in what is played.
//
// The cue is scored backwards from the hit: the tempo is fitted so that the
// Climax/Hit lands exactly on a downbeat counted from the cue start.

import { makeRng, pick } from './rng.js';

export const POINT_KEYS = ['start', 'build', 'hit', 'tail', 'end'];
export const LAYERS = ['pad', 'bass', 'pulse', 'perc', 'riser', 'impact', 'tail'];
export const LAYER_LABELS = {
  pad: 'Pad', bass: 'Bass', pulse: 'Pulse', perc: 'Percussion', riser: 'Riser', impact: 'Impact', tail: 'Tail',
};
// Independently re-rollable sources of variation.
export const SEED_KEYS = ['harmony', 'pad', 'pulse', 'perc', 'riser'];
// Event types that keep sounding, so playback starting mid-way should pick them up.
export const SUSTAINED = new Set(['pad', 'bass', 'riser', 'swell', 'tail']);

const BEATS_PER_BAR = 4;
const MIN_STEP = 0.075; // fastest pulse/percussion subdivision, in seconds

// Scale degrees are 0-based. `pre` is the chord in the bar before the hit;
// `raisePre` makes its third major (e.g. the major V in a minor key).
export const MOODS = {
  dark: { label: 'Dark', key: 'D minor', root: 50, scale: [0, 2, 3, 5, 7, 8, 10],
    progs: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 5, 3, 4]], pre: 4, raisePre: true, hit: 0 },
  tense: { label: 'Tense', key: 'E Phrygian', root: 52, scale: [0, 1, 3, 5, 7, 8, 10],
    progs: [[0, 1, 0, 6], [0, 1, 5, 1], [0, 5, 1, 0]], pre: 1, raisePre: false, hit: 0 },
  heroic: { label: 'Heroic', key: 'D major', root: 50, scale: [0, 2, 4, 5, 7, 9, 11],
    progs: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 4]], pre: 4, raisePre: false, hit: 0 },
  wonder: { label: 'Wonder', key: 'F Lydian', root: 53, scale: [0, 2, 4, 6, 7, 9, 11],
    progs: [[0, 1, 0, 1], [0, 1, 4, 1], [0, 5, 1, 0]], pre: 1, raisePre: false, hit: 0 },
  melancholy: { label: 'Melancholy', key: 'A Dorian', root: 45, scale: [0, 2, 3, 5, 7, 9, 10],
    progs: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 3, 3]], pre: 3, raisePre: false, hit: 0 },
};

// Chord-tone indices for the pulse ostinato (3 = root an octave up).
const PULSE_PATTERNS = [
  [0, 1, 2, 1, 0, 1, 2, 1],
  [0, 0, 2, 0, 1, 0, 2, 0],
  [0, 2, 3, 2, 0, 2, 3, 2],
  [0, 1, 0, 2, 0, 1, 0, 3],
  [0, 0, 0, 1, 0, 0, 2, 1],
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, f) => a + (b - a) * f;

export function fitTempo(start, hit, targetBpm) {
  const span = Math.max(hit - start, 0.1);
  const targetBar = (BEATS_PER_BAR * 60) / targetBpm;
  const bars = Math.max(1, Math.round(span / targetBar));
  const barDur = span / bars;
  const beatDur = barDur / BEATS_PER_BAR;
  return { bars, barDur, beatDur, bpm: 60 / beatDur, beatsPerBar: BEATS_PER_BAR };
}

// 0..1 dramatic intensity over time. Drawn on the timeline and used to scale
// loudness, brightness and rhythmic density.
export function intensityAt(t, points, music) {
  const { start, build, hit, tail, end } = points;
  if (t < start || t >= end) return 0;
  if (t < build) return lerp(0.12, 0.22, (t - start) / (build - start || 1));
  if (t < hit) return lerp(0.22, 1, Math.pow((t - build) / (hit - build || 1), music.buildCurve));
  if (t < tail) return 1;
  return lerp(0.6, 0, (t - tail) / (end - tail || 1));
}

function scaleNote(mood, step) {
  const octave = Math.floor(step / 7);
  return mood.root + mood.scale[((step % 7) + 7) % 7] + 12 * octave;
}

function chordTones(mood, degree, raise = false) {
  const tones = [0, 2, 4].map(k => scaleNote(mood, degree + k));
  if (raise && tones[1] - tones[0] === 3) tones[1] += 1;
  return tones;
}

export function generate(doc) {
  const p = doc.points;
  const music = doc.music;
  const mood = MOODS[music.mood] ?? MOODS.dark;
  const tempo = fitTempo(p.start, p.hit, music.tempo);
  const { bars, barDur, beatDur } = tempo;

  const beatT = beat => p.start + beat * beatDur;
  const hitBeat = bars * BEATS_PER_BAR;
  // Musical section changes happen on the beat grid nearest each marker.
  const buildBar = clamp(Math.round((p.build - p.start) / barDur), 0, bars - 1);
  const buildBeat = buildBar * BEATS_PER_BAR;
  const tailBeat = Math.max(hitBeat, Math.round((p.tail - p.start) / beatDur));
  const tailT = Math.min(beatT(tailBeat), p.end);

  const intensity = t => intensityAt(t, p, music);
  const energyGain = 0.55 + 0.45 * music.energy;
  const vel = t => (0.35 + 0.65 * intensity(t)) * energyGain;
  const rngFor = key => makeRng(doc.seeds[key]);

  const events = [];
  const add = (layer, type, t, dur, extra = {}) => events.push({ layer, type, t, dur, ...extra });

  // Harmony: one chord per span of beats.
  const hr = rngFor('harmony');
  const prog = pick(hr, mood.progs);
  const spans = [];
  for (let bar = 0; bar * BEATS_PER_BAR < tailBeat; bar++) {
    let degree, raise = false;
    if (bar === bars - 1 && bars > 1) {
      degree = mood.pre;
      raise = mood.raisePre;
    } else if (bar < buildBar) degree = prog[Math.floor(bar / 2) % prog.length]; // slow in the intro
    else if (bar < bars) degree = prog[(Math.floor(buildBar / 2) + bar - buildBar) % prog.length];
    else degree = prog[(bar - bars) % prog.length]; // climax restarts on the tonic
    const b0 = bar * BEATS_PER_BAR;
    const b1 = Math.min(b0 + BEATS_PER_BAR, tailBeat);
    const last = spans[spans.length - 1];
    if (last && last.degree === degree && last.raise === raise && b0 !== hitBeat) last.b1 = b1;
    else spans.push({ b0, b1, degree, raise, tones: chordTones(mood, degree, raise) });
  }
  const chordAt = beat => spans.find(s => beat >= s.b0 && beat < s.b1) ?? spans[spans.length - 1];

  // Pad: sustained chords from the cue start up to the tail.
  const pr = rngFor('pad');
  const openVoicing = pr() < 0.5;
  const addNinth = pr() < 0.5;
  for (const s of spans) {
    const notes = s.tones.map(n => n + 12);
    if (openVoicing) notes[1] += 12;
    if (addNinth) notes.push(scaleNote(mood, s.degree + 8) + 12);
    const t = beatT(s.b0), dur = (s.b1 - s.b0) * beatDur;
    add('pad', 'pad', t, dur, { notes, vel: vel(t + dur / 2) * 0.8 });
  }

  // Bass: a drone through the intro, then chord roots bar by bar.
  if (buildBeat > 0) add('bass', 'bass', p.start, beatT(buildBeat) - p.start, { note: mood.root - 12, vel: vel(p.start) });
  for (let b = buildBeat; b < tailBeat; b += BEATS_PER_BAR) {
    const t = beatT(b);
    add('bass', 'bass', t, Math.min(BEATS_PER_BAR, tailBeat - b) * beatDur, { note: chordAt(b).tones[0] - 12, vel: vel(t) });
  }

  // Pulse: an ostinato that gets denser and louder as intensity rises.
  const pu = rngFor('pulse');
  const pattern = pick(pu, PULSE_PATTERNS);
  const octaveFlick = pu() < 0.4;
  const pulseStart = music.energy > 0.7 && buildBar >= 2 ? Math.floor(buildBar / 2) * BEATS_PER_BAR : buildBeat;
  let step = 0;
  for (let b = pulseStart; b < tailBeat; b++) {
    const level = intensity(beatT(b));
    let sub = level < 0.5 ? 2 : 4;
    if (beatDur / sub < MIN_STEP) sub = 2;
    for (let s = 0; s < sub; s++, step++) {
      const t = beatT(b + s / sub);
      if (s > 0 && pu() < (1 - level) * 0.5) continue;
      const tones = chordAt(b).tones;
      const idx = pattern[step % pattern.length];
      let note = idx === 3 ? tones[0] + 12 : tones[idx];
      if (octaveFlick && step % 8 === 7) note += 12;
      const quiet = b < buildBeat ? 0.6 : 1;
      add('pulse', 'pulse', t, (beatDur / sub) * 0.9, { note, vel: vel(t) * quiet * (s === 0 ? 1 : 0.72) });
    }
  }

  // Percussion: enters halfway through the build, accelerates into a fill.
  const pc = rngFor('perc');
  const roll = pc() < 0.5;
  const buildBars = bars - buildBar;
  if (buildBars >= 2) {
    for (let bar = buildBar + Math.floor(buildBars / 2); bar < bars; bar++) {
      const barsLeft = bars - bar;
      const b0 = bar * BEATS_PER_BAR;
      let times = [];
      if (barsLeft === 1) {
        const fine = roll && beatDur / 4 >= MIN_STEP;
        for (let x = 0; x < 2; x += 0.5) times.push(x);
        for (let x = 2; x < 4; x += fine ? 0.25 : 0.5) times.push(x);
      } else if (barsLeft <= 4) times = [0, 1, 2, 3];
      else times = [0];
      for (const x of times) {
        const t = beatT(b0 + x);
        const pitch = barsLeft === 1 ? lerp(1.3, 0.85, x / 4) : 1;
        add('perc', 'perc', t, 0.5, { pitch, vel: vel(t) * (Number.isInteger(x) ? 1 : 0.8) });
      }
    }
  }
  for (let b = hitBeat; b < tailBeat; b++) {
    if (b % BEATS_PER_BAR === 0 || b % BEATS_PER_BAR === 2) add('perc', 'perc', beatT(b), 0.5, { pitch: 0.9, vel: vel(beatT(b)) });
  }

  // Riser into the hit, plus a reverse-style swell that ends exactly on it.
  const rr = rngFor('riser');
  const riseBars = Math.min(bars - buildBar, rr() < 0.5 ? 4 : 8);
  const color = 0.3 + 0.5 * rr();
  if (riseBars >= 1) {
    const t = beatT((bars - riseBars) * BEATS_PER_BAR);
    add('riser', 'riser', t, p.hit - t, { note: mood.root, vel: energyGain, color });
  }
  const swellDur = Math.min(barDur, 2.5);
  add('riser', 'swell', p.hit - swellDur, swellDur, { vel: energyGain });

  // The hit.
  const [h0, h1, h2] = chordTones(mood, mood.hit);
  add('impact', 'impact', p.hit, 3.5, { vel: energyGain });
  add('impact', 'stab', p.hit, Math.min(beatDur * 3, 2), { notes: [h0 - 12, h0, h2, h0 + 12, h1 + 12, h2 + 12], vel: energyGain });

  // Tail: a held tonic chord that fades early enough for the reverb to ring out.
  if (p.end - tailT > 0.3) {
    add('tail', 'tail', tailT, p.end - tailT, { notes: [h0 - 12, h0 + 12, h1 + 12, h2 + 12], vel: energyGain * 0.7 });
  }

  events.sort((a, b) => a.t - b.t);
  return { events, tempo, buildBar, hitBeat, tailBeat, tailT, mood, spans };
}
