// The compositional rules. generate(doc) is a pure function from the project
// document to a list of timed musical events; both the sketch player and the
// final offline render play the same list, so the two only differ in sound
// quality, never in what is played.
//
// The cue is scored backwards from the hit: the tempo is fitted so that the
// Climax/Hit lands exactly on a downbeat counted from the cue start, chords are
// chosen backwards from the hit, and every random choice comes from a stream
// keyed by its bar's position relative to the hit. So moving the start point,
// or dragging a control, changes the music locally instead of re-rolling it.
//
// With music.hit off, nothing hits: the cue swells to its peak at the Hit point
// and recedes. Nearer Jóhannsson it then becomes a slowly evolving soundscape
// in free time, using devices heard in a temp track ("Escape"); see
// docs/style-space.md.
//
// Style comes from a point in a plane holding three reference composers; see
// docs/style-space.md. Theory terms stay in this file: the interface only ever
// shows the composers' names.

import { makeRng, hashSeed, pick } from './rng.js';

export const POINT_KEYS = ['start', 'build', 'hit', 'tail', 'end'];
export const LAYERS = ['piano', 'tune', 'strings', 'bass', 'pulse', 'perc', 'electronics', 'impact', 'tail'];
export const LAYER_LABELS = {
  piano: 'Piano', tune: 'Tune', strings: 'Strings', bass: 'Bass', pulse: 'Pulse', perc: 'Drums',
  electronics: 'Electronic', impact: 'Hit', tail: 'Tail',
};
// Independently re-rollable sources of variation.
export const SEED_KEYS = ['harmony', 'tune', 'pulse', 'perc', 'electronics', 'surprise'];
// Event types that keep sounding, so playback starting mid-way should pick them up.
export const SUSTAINED = new Set(['strings', 'bass', 'brass', 'buzz', 'lead', 'riser', 'swell', 'tail']);

const MIN_STEP = 0.075; // fastest pulse/percussion subdivision, in seconds
const ROOT = 50; // D: the usual key of Gymnopédie No. 1

// ---------------------------------------------------------------- style space

// Reference points, in a plane where y grows downwards as on screen. The space
// carries on past each of them (out to STYLE_RADIUS), and going further out
// exaggerates that composer.
export const COMPOSERS = [
  { id: 'satie', label: 'Satie', at: [-0.45, -0.26] },
  { id: 'ravel', label: 'Ravel', at: [0.45, -0.26] },
  { id: 'johannsson', label: 'Jóhannsson', at: [0, 0.52] },
];
export const STYLE_RADIUS = 1;

// Each setting: [Satie, Ravel, Jóhannsson, min, max]. Layer levels may exceed 1
// a little when a composer is exaggerated.
const SETTINGS = {
  triple: [1, 0.75, 0, 0, 1], // counting in 3 (>= 0.5) or 4
  chordBars: [1, 2, 5, 1, 8], // how long each chord lasts
  hurry: [0, 1, 0.2, 0, 1], // chords change faster into the hit (>= 0.5)
  colour: [0.55, 0.9, 0, 0, 1], // added 7ths, 9ths, 11ths
  bright: [0.55, 0.75, 0.2, 0, 1], // which scale
  rise: [0.15, 1, 0.85, 0, 1.3], // how far intensity climbs through the build
  drone: [0, 0.15, 1, 0, 1], // hold the home note under the intro (>= 0.5)
  piano: [1, 0.05, 0.5, 0, 1.2],
  oompah: [1, 0.3, 0, 0, 1], // Satie's low-note-then-chord (>= 0.5), or one chord a bar
  tune: [1, 0.85, 0.35, 0, 1.2],
  tuneNotes: [1.5, 3, 2, 0.75, 5], // notes per bar
  tuneRepeat: [0.6, 0.3, 0.9, 0, 1], // how literally the tune repeats
  tuneEntry: [0.15, 0.4, 0.6, 0, 0.9], // how far through the cue it comes in
  tunePiano: [1, 0, 0.6, 0, 1], // tune on piano (>= 0.5) or strings
  strings: [0, 0.9, 1, 0, 1.2],
  bass: [0, 0.7, 1, 0, 1.2],
  figure: [0, 0.6, 0.9, 0, 1.2],
  snare: [0, 1, 0.1, 0, 1.2],
  drums: [0, 0.45, 1, 0, 1.2],
  electronics: [0, 0, 1, 0, 1.2],
  boom: [0, 0.3, 1, 0, 1.2],
  tutti: [0.05, 1, 0.4, 0, 1.2],
  brass: [0, 0.5, 1, 0, 1.2],
  scape: [0, 0, 1, 0, 1.2], // free-time soundscape, when there's no hit
};
const AUDIBLE = 0.08; // layer levels below this are left out

// Barycentric weights of a point relative to the three reference points. They
// always sum to 1; outside the triangle some go negative, which is what makes
// dragging further out an exaggeration.
export function styleWeights([x, y]) {
  const [a, b, c] = COMPOSERS.map(k => k.at);
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
  const wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
  return { satie: wa, ravel: wb, johannsson: 1 - wa - wb };
}

export function styleAt(point = [0, 0]) {
  const w = styleWeights(point);
  const style = { weights: w };
  for (const [key, [s, r, j, lo, hi]] of Object.entries(SETTINGS)) {
    style[key] = clamp(w.satie * s + w.ravel * r + w.johannsson * j, lo, hi);
  }
  style.beatsPerBar = style.triple >= 0.5 ? 3 : 4;
  // Non-negative shares, for choosing between the composers' own habits.
  const pos = COMPOSERS.map(k => Math.max(0, w[k.id]));
  const sum = pos.reduce((a, b) => a + b, 0) || 1;
  style.share = Object.fromEntries(COMPOSERS.map((k, i) => [k.id, pos[i] / sum]));
  return style;
}

// A plain-words account of where the style point is, e.g. "Mostly Satie, a
// little Ravel".
export function describeStyle(weights) {
  const ranked = COMPOSERS.map(k => ({ label: k.label, w: weights[k.id] })).sort((a, b) => b.w - a.w);
  const [first, second] = ranked;
  if (first.w > 1.08) return `Exaggerated ${first.label}`;
  if (first.w > 0.85) return first.label;
  if (second.w < 0.12) return `Mostly ${first.label}`;
  if (first.w - second.w < 0.12) return ranked[2].w > 0.25 ? 'An even mix' : `${first.label} and ${second.label}`;
  return `Mostly ${first.label}, a little ${second.label}`;
}

// ---------------------------------------------------------------- musical material

// Scales by the blended brightness: Lydian, major, Dorian, natural minor.
const SCALES = [
  { min: 0.78, steps: [0, 2, 4, 6, 7, 9, 11] },
  { min: 0.45, steps: [0, 2, 4, 5, 7, 9, 11] },
  { min: 0.3, steps: [0, 2, 3, 5, 7, 9, 10] },
  { min: -Infinity, steps: [0, 2, 3, 5, 7, 8, 10] },
];

// The chord each composer tends to put just before the hit (scale degrees,
// 0-based, with weights): Satie IV, as in the Gymnopédies' rocking; Ravel V or
// ii; Jóhannsson VI.
const BEFORE_HIT = { satie: [[3, 1]], ravel: [[4, 2], [1, 1]], johannsson: [[5, 2], [3, 1]] };

// Which chords each composer tends to put before a given chord.
const BEFORE = {
  satie: next => (next === 0 ? [[3, 4], [1, 1]] : [[0, 4], [next + 3, 1]]), // rocking between two
  ravel: next => [[next + 4, 3], [next + 2, 2], [next + 1, 1], [next + 6, 1], [next + 5, 1]],
  johannsson: next => [[next + 2, 2], [next + 5, 1.5], [next, 1], [next + 3, 1]], // slow, falling by thirds
};

// Sour surprises each composer offers; see docs/style-space.md.
const SURPRISES = {
  satie: ['oddChord', 'gap'],
  ravel: ['twoKeys', 'grind'],
  johannsson: ['cluster', 'brassGrind', 'distort'],
};
const HIT_SURPRISES = { satie: 'sideslip', ravel: 'twoKeys', johannsson: 'cluster' };
// Without a hit, Jóhannsson can also leave two high notes rubbing together.
const NO_HIT_SURPRISES = { ...SURPRISES, johannsson: [...SURPRISES.johannsson, 'rub'] };
const SITE_RATE = 0.45; // share of bars that can hold a surprise at full sour

// Chord-tone indices for the repeating figure (3 = root an octave up).
const PULSE_PATTERNS = [
  [0, 1, 2, 1, 0, 1, 2, 1],
  [0, 0, 2, 0, 1, 0, 2, 0],
  [0, 2, 3, 2, 0, 2, 3, 2],
  [0, 1, 0, 2, 0, 1, 0, 3],
  [0, 0, 0, 1, 0, 0, 2, 1],
];

// Ravel's Boléro snare rhythm, two bars of three beats; a fourth beat adds two
// quavers.
const BOLERO = [
  [0, 1 / 2, 2 / 3, 5 / 6, 1, 3 / 2, 5 / 3, 11 / 6, 2, 5 / 2],
  [0, 1 / 2, 2 / 3, 5 / 6, 1, 3 / 2, 5 / 3, 11 / 6, 2, 13 / 6, 7 / 3, 5 / 2, 8 / 3, 17 / 6],
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, f) => a + (b - a) * f;
const mod = (n, m) => ((n % m) + m) % m;

export function fitTempo(start, hit, targetBpm, beatsPerBar = 4) {
  const span = Math.max(hit - start, 0.1);
  const targetBar = (beatsPerBar * 60) / targetBpm;
  const bars = Math.max(1, Math.round(span / targetBar));
  const barDur = span / bars;
  const beatDur = barDur / beatsPerBar;
  return { bars, barDur, beatDur, bpm: 60 / beatDur, beatsPerBar };
}

// 0..1 dramatic intensity over time. Drawn on the timeline and used to scale
// loudness, brightness and rhythmic density. The style's `rise` sets how far it
// climbs: Satie's barely moves, Ravel's is one long crescendo.
export function intensityAt(t, points, music, style = styleAt(music.style)) {
  const { start, build, hit, tail, end } = points;
  const scaled = i => clamp(0.3 + (i - 0.3) * style.rise, 0, 1);
  if (t < start || t >= end) return 0;
  if (t < build) return scaled(lerp(0.12, 0.22, (t - start) / (build - start || 1)));
  if (t < hit) return scaled(lerp(0.22, 1, Math.pow((t - build) / (hit - build || 1), music.buildCurve)));
  if (t < tail) return scaled(1);
  return lerp(scaled(0.6), 0, (t - tail) / (end - tail || 1));
}

function scaleNote(scale, step) {
  return ROOT + scale[mod(step, 7)] + 12 * Math.floor(step / 7);
}

function chordTones(scale, degree, extras) {
  return [0, 2, 4, 6, 8, 10].slice(0, 3 + extras).map(k => scaleNote(scale, degree + k));
}

function weightedPick(rng, options) {
  const total = options.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [value, w] of options) if ((x -= w) < 0) return value;
  return options[options.length - 1][0];
}

// Blend the composers' candidate chords by their shares, avoiding diminished
// triads, which none of the three lean on.
function blendChoices(share, scale, table, ...args) {
  const weights = new Map();
  for (const [id, s] of Object.entries(share)) {
    if (s <= 0) continue;
    const options = typeof table[id] === 'function' ? table[id](...args) : table[id];
    for (const [d, w] of options) {
      const degree = mod(d, 7);
      const fifth = scale[mod(degree + 4, 7)] - scale[degree];
      const ok = mod(fifth, 12) === 7 ? 1 : 0.1;
      weights.set(degree, (weights.get(degree) ?? 0) + s * w * ok);
    }
  }
  return [...weights];
}

// Voice a chord around `centre`, as close as possible to the previous voicing
// so the parts move smoothly instead of jumping in parallel.
function voice(tones, prev, centre) {
  const pcs = tones.map(n => mod(n, 12));
  let best = null, bestCost = Infinity;
  for (let r = 0; r < pcs.length; r++) {
    const notes = [];
    let n = centre - 7 + mod(pcs[r] - (centre - 7), 12);
    for (let k = 0; k < pcs.length; k++) {
      const pc = pcs[(r + k) % pcs.length];
      if (k > 0) n += mod(pc - n, 12) || 12;
      notes.push(n);
    }
    const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
    let cost = Math.abs(mean - centre) * 0.5;
    if (prev) for (const x of notes) cost += Math.min(...prev.map(y => Math.abs(x - y)));
    if (cost < bestCost) [best, bestCost] = [notes, cost];
  }
  return best;
}

// Voice a run of chords outwards from the one at index `pivot` (the hit), so
// that adding bars at the start doesn't change the voicings near the hit.
function voiceFrom(chords, pivot, centre) {
  const out = new Array(chords.length);
  pivot = clamp(pivot, 0, chords.length - 1);
  out[pivot] = voice(chords[pivot], null, centre);
  for (let i = pivot - 1; i >= 0; i--) out[i] = voice(chords[i], out[i + 1], centre);
  for (let i = pivot + 1; i < chords.length; i++) out[i] = voice(chords[i], out[i - 1], centre);
  return out;
}

const lowNote = n => 38 + mod(n - 38, 12); // into the octave D2..C#3

// ---------------------------------------------------------------- generation

export function generate(doc) {
  const p = doc.points;
  const music = doc.music;
  const style = styleAt(music.style);
  const { share } = style;
  const bpb = style.beatsPerBar;
  const tempo = fitTempo(p.start, p.hit, music.tempo, bpb);
  const noHit = music.hit === false;
  // How far the soundscape takes over from the changing chords (strings, bass)
  // and the beat (figure, snare).
  const scape = noHit ? style.scape : 0;
  const chordsLeft = 1 - clamp(scape, 0, 1);
  const { bars, barDur, beatDur } = tempo;
  const scale = SCALES.find(s => style.bright >= s.min).steps;

  const beatT = beat => p.start + beat * beatDur;
  const barT = bar => beatT(bar * bpb);
  const hitBeat = bars * bpb;
  // Musical section changes happen on the beat grid nearest each marker.
  const buildBar = clamp(Math.round((p.build - p.start) / barDur), 0, bars - 1);
  const buildBeat = buildBar * bpb;
  const tailBeat = Math.max(hitBeat, Math.round((p.tail - p.start) / beatDur));
  const tailT = Math.min(beatT(tailBeat), p.end);
  const lastBar = bars + Math.ceil((tailBeat - hitBeat) / bpb); // exclusive; the last may be partial
  const rel = b => b - bars; // bar position counted from the hit

  const intensity = t => intensityAt(t, p, music, style);
  const energyGain = 0.55 + 0.45 * music.energy;
  const vel = t => (0.35 + 0.65 * intensity(t)) * energyGain;
  // One random stream per decision, so choices don't shift when others change.
  const rng = (seed, tag, k = 0) => makeRng(hashSeed(`${doc.seeds[seed]}/${tag}/${k}`));

  const events = [];
  const add = (layer, type, t, dur, extra = {}) => events.push({ layer, type, t, dur, ...extra });

  // Sour: every bar, and the hit, is a site where a surprise may happen. Each
  // site's number is fixed by the surprise seed, so turning Sour up only ever
  // adds surprises, in the same places, and turning it down removes them.
  const sour = music.sour ?? 0;
  const surprises = new Map();
  for (let b = 0; b < lastBar; b++) {
    const r = rng('surprise', 'site', rel(b));
    const u = r();
    const atHit = b === bars;
    if (u >= sour * (atHit ? 0.9 : SITE_RATE)) continue;
    const who = weightedPick(r, Object.entries(share).map(([id, s]) => [id, s]));
    let kind = atHit ? HIT_SURPRISES[who] : pick(r, (noHit ? NO_HIT_SURPRISES : SURPRISES)[who]);
    if (kind === 'grind' && (rel(b) < -4 || rel(b) >= 0)) kind = 'twoKeys';
    surprises.set(b, kind);
  }

  // Harmony, chosen backwards from the hit: each chord leads into the next.
  const baseLen = [1, 2, 4, 8].reduce((a, n) =>
    Math.abs(Math.log(n / style.chordBars)) < Math.abs(Math.log(a / style.chordBars)) ? n : a);
  const hurryFrom = style.hurry >= 0.5 ? bars - Math.min(4, bars - buildBar) : bars;
  const extras = style.colour < 0.25 ? 0 : style.colour < 0.7 ? 1 : style.colour < 0.95 ? 2 : 3;
  const barDegree = new Array(lastBar).fill(0);
  for (let end = bars, next = 0, j = 0; end > 0; j++) {
    let len = baseLen;
    if (end > hurryFrom) len = Math.max(1, baseLen / 2);
    else if (end <= buildBar && style.drone >= 0.5) len = baseLen * 2;
    const start = Math.max(0, end - len);
    const degree = j === 0
      ? weightedPick(rng('harmony', 'pre'), blendChoices(share, scale, BEFORE_HIT))
      : weightedPick(rng('harmony', 'chord', rel(start)), blendChoices(share, scale, BEFORE, next));
    for (let b = start; b < end; b++) barDegree[b] = degree;
    [next, end] = [degree, start];
  }
  // After the hit, alternate the home chord with one that leads back to it.
  for (let b = bars, j = 0; b < lastBar; b += baseLen, j++) {
    const degree = j % 2 === 0 ? 0 : weightedPick(rng('harmony', 'after', j), blendChoices(share, scale, BEFORE, 0));
    for (let x = b; x < Math.min(b + baseLen, lastBar); x++) barDegree[x] = degree;
  }
  const barChord = barDegree.map((degree, b) => {
    const kind = surprises.get(b);
    let shift = 0;
    if (kind === 'oddChord') shift = pick(rng('surprise', 'shift', rel(b)), [1, -1, 6, 3]);
    if (kind === 'sideslip') shift = 1;
    const tones = chordTones(scale, degree, extras).map(n => n + shift);
    const clash = kind === 'twoKeys' ? 6 : 0;
    return { degree, tones, root: tones[0], clash, key: `${degree}/${shift}/${clash}` };
  });
  const spans = [];
  for (let b = 0; b < lastBar; b++) {
    const c = barChord[b];
    const b0 = b * bpb, b1 = Math.min(b0 + bpb, tailBeat);
    const last = spans[spans.length - 1];
    if (last && last.key === c.key && b !== bars) last.b1 = b1;
    else spans.push({ ...c, b0, b1 });
  }
  const beforeTail = b => b * bpb < tailBeat; // bar starts before the tail

  // Piano: as in the Gymnopédies, a low note on the first beat and then the
  // chord; otherwise (nearer Jóhannsson) one quiet chord a bar.
  if (style.piano >= AUDIBLE) {
    const from = style.drone >= 0.5 ? buildBar : 0;
    const pattern = style.oompah < 0.5 ? [[0, 'low', bpb], [0, 'chord', bpb]]
      : bpb === 3 ? [[0, 'low', 3], [1, 'chord', 2]] : [[0, 'low', 2], [1, 'chord', 1], [2, 'low', 2], [3, 'chord', 1]];
    const voiced = voiceFrom(barChord.map(c => c.tones), bars, 60);
    for (let b = from; b < lastBar && beforeTail(b); b++) {
      const c = barChord[b];
      const chord = voiced[b];
      const gap = surprises.get(b) === 'gap';
      for (const [x, part, len] of pattern) {
        const beat = b * bpb + x;
        if (beat >= tailBeat || (gap && part === 'chord')) continue;
        const t = beatT(beat);
        const dur = Math.min(len, tailBeat - beat) * beatDur;
        const notes = part === 'low' ? [lowNote(c.root)] : c.clash ? [...chord, ...chord.map(n => n + c.clash)] : chord;
        add('piano', 'piano', t, dur, { notes, vel: vel(t) * style.piano * (part === 'low' ? 0.85 : 0.6) });
      }
    }
  }

  // Tune: a motif, stated phrase by phrase (phrases counted back from the hit)
  // and varied more or less freely.
  if (style.tune >= AUDIBLE) {
    const phraseBars = style.tuneRepeat > 0.75 ? 2 : 4;
    const slots = phraseBars * bpb * 2; // quaver slots
    const mr = rng('tune', 'motif');
    const count = clamp(Math.round(style.tuneNotes * phraseBars), 2, slots / 2);
    const offbeats = style.tuneNotes > 2.5;
    const candidates = [];
    for (let s = 1; s < slots - 2; s++) if (s % 2 === 0 || offbeats) candidates.push([s, s % 2 === 0 ? 3 : 1]);
    const onsets = new Set([2]);
    while (onsets.size < count && onsets.size < candidates.length) onsets.add(weightedPick(mr, candidates));
    const times = [...onsets].sort((a, b) => a - b);
    const contour = [0];
    for (let i = 1; i < times.length; i++) {
      const leap = mr() < 0.7 ? 1 : 2 + Math.floor(mr() * 2);
      const last = contour[i - 1];
      const dir = last > 3 ? -1 : last < -3 ? 1 : mr() < 0.5 ? -1 : 1;
      contour.push(last + dir * leap);
    }
    const entry = Math.round(style.tuneEntry * bars);
    const until = style.tune > 0.6 ? tailBeat : hitBeat;
    for (let b = bars - Math.ceil((bars - entry) / phraseBars) * phraseBars; b * bpb < until; b += phraseBars) {
      if (b < 0) continue;
      const pr = rng('tune', 'phrase', rel(b));
      const anchor = pick(pr, [4, 2, 7, 4]);
      const piano = style.tunePiano >= 0.5;
      times.forEach((slot, i) => {
        const beat = b * bpb + slot / 2;
        if (beat >= until) return;
        const bar = b + Math.floor(slot / (bpb * 2));
        let step = anchor + contour[i];
        if (pr() > style.tuneRepeat) step += pr() < 0.5 ? 1 : -1;
        // On the beat, settle on a note of the chord underneath.
        if (slot % 2 === 0) {
          const pcs = barChord[bar].tones.map(n => mod(n, 12));
          const fit = [0, 1, -1, 2, -2].find(d => pcs.includes(mod(scaleNote(scale, step + d), 12)));
          if (fit !== undefined) step += fit;
        }
        const next = i + 1 < times.length ? times[i + 1] : slots - 1;
        const dur = Math.min((next - slot) / 2, until - beat) * beatDur;
        const t = beatT(beat);
        const note = scaleNote(scale, step) + 12;
        add('tune', piano ? 'piano' : 'lead', t, dur, piano ? { notes: [note], vel: vel(t) * style.tune * 0.75 } : { note, vel: vel(t) * style.tune * 0.6 });
      });
    }
  }

  // Strings: sustained chords, plus any sour clusters.
  if (style.strings * chordsLeft >= AUDIBLE) {
    const pivot = spans.findIndex(s => s.b0 >= hitBeat);
    const voiced = voiceFrom(spans.map(s => s.tones), pivot < 0 ? spans.length - 1 : pivot, 64);
    spans.forEach((s, i) => {
      const notes = voiced[i];
      const t = beatT(s.b0), dur = (s.b1 - s.b0) * beatDur;
      const v = vel(t + dur / 2) * 0.8 * style.strings * chordsLeft;
      add('strings', 'strings', t, dur, { notes, vel: v });
      if (s.clash) add('strings', 'strings', t, dur, { notes: notes.map(n => n + s.clash), vel: v * 0.6 });
    });
  }
  for (const [b, kind] of surprises) {
    const t = barT(b), c = barChord[b];
    const dur = Math.min(barDur, tailT - t);
    if (dur <= 0.05) continue;
    if (kind === 'cluster') {
      const base = c.root + 12;
      add('strings', 'strings', t, dur * (b === bars ? 2 : 1), { notes: [base, base + 1, base + 2, base + 3, base + 5], vel: vel(t) * 0.55, attack: dur * 0.7 });
    }
    if (kind === 'brassGrind') add('bass', 'brass', t, dur, { notes: [lowNote(c.root), lowNote(c.root) + 1], vel: vel(t) * 0.7 });
    if (kind === 'rub') {
      // Two high notes a semitone apart, fading in and held.
      const n = scaleNote(scale, 4) + 24;
      const len = Math.min(barDur * 2, tailT - t);
      add('strings', 'strings', t, len, { notes: [n, n + 1], vel: vel(t) * 0.35, attack: len * 0.6 });
    }
    if (kind === 'distort') add('electronics', 'buzz', t, dur, { notes: [lowNote(c.root) + 12, lowNote(c.root) + 18], vel: vel(t) * 0.5 });
    if (kind === 'grind') {
      // La Valse breaking up: harsh accented chords on every beat.
      for (let x = 0; x < bpb; x++) {
        const tt = beatT(b * bpb + x);
        const chord = voice(c.tones, null, 62);
        add('impact', 'stab', tt, beatDur * 0.6, { notes: [...chord, ...chord.map(n => n + 1)], vel: vel(tt) * 0.5 });
      }
    }
  }

  // Bass: a drone through the intro if the style holds one, then chord roots.
  if (style.bass * chordsLeft >= AUDIBLE) {
    const pedalEnd = style.drone >= 0.5 ? buildBeat : 0;
    if (pedalEnd > 0) add('bass', 'bass', p.start, beatT(pedalEnd) - p.start, { note: ROOT - 12, vel: vel(p.start) * style.bass });
    for (const s of spans) {
      if (s.b1 <= pedalEnd) continue;
      const b0 = Math.max(s.b0, pedalEnd);
      const t = beatT(b0);
      add('bass', 'bass', t, (s.b1 - b0) * beatDur, { note: lowNote(s.root), vel: vel(t) * style.bass * chordsLeft });
    }
  }

  // Pulse: a repeating figure, on harp nearer Ravel and on a soft synth nearer
  // Jóhannsson, that gets busier as the intensity rises.
  if (style.figure * chordsLeft >= AUDIBLE) {
    const pattern = pick(rng('pulse', 'pattern'), PULSE_PATTERNS);
    const harp = share.ravel > share.johannsson;
    const from = harp ? Math.floor(buildBar / 2) : buildBar;
    for (let b = from; b < lastBar && beforeTail(b); b++) {
      if (surprises.get(b) === 'gap') continue;
      const r = rng('pulse', 'bar', rel(b));
      const c = barChord[b];
      for (let x = 0; x < bpb; x++) {
        const beat = b * bpb + x;
        if (beat >= tailBeat) break;
        const level = intensity(beatT(beat));
        let sub = level < 0.5 ? 2 : 4;
        if (beatDur / sub < MIN_STEP) sub = 2;
        for (let s = 0; s < sub; s++) {
          const t = beatT(beat + s / sub);
          if (s > 0 && r() < (1 - level) * 0.5) continue;
          const step = x * sub + s;
          const idx = pattern[step % pattern.length];
          let note = (idx === 3 ? c.tones[0] + 12 : c.tones[idx]) + 12;
          if (c.clash && step % 2 === 1) note += c.clash;
          const quiet = b < buildBar ? 0.6 : 1;
          add('pulse', harp ? 'harp' : 'pulse', t, (beatDur / sub) * 0.9, { note, vel: vel(t) * quiet * style.figure * chordsLeft * (s === 0 ? 1 : 0.72) });
        }
      }
    }
  }

  // Snare: Boléro's rhythm, from the very start if Ravel is strong, rising with
  // the intensity.
  if (style.snare * chordsLeft >= AUDIBLE) {
    const from = style.snare >= 0.5 ? 0 : buildBar + Math.floor((bars - buildBar) / 2);
    const triplets = beatDur / 6 >= MIN_STEP;
    for (let b = from; b < bars; b++) {
      if (surprises.get(b) === 'gap') continue;
      let times = BOLERO[mod(rel(b), 2)];
      if (bpb === 4) times = [...times, 3, 3.5];
      if (!triplets) times = times.filter(x => Number.isInteger(x * 2));
      for (const x of times) {
        const t = beatT(b * bpb + x);
        add('perc', 'snare', t, 0.15, { vel: vel(t) * style.snare * chordsLeft * (Number.isInteger(x) ? 0.8 : 0.55) });
      }
    }
  }

  // Drums: low and heavy, entering halfway through the build and accelerating
  // into a fill.
  if (style.drums >= AUDIBLE && !noHit) {
    const roll = rng('perc', 'roll')() < 0.5;
    const buildBars = bars - buildBar;
    if (buildBars >= 2) {
      for (let bar = buildBar + Math.floor(buildBars / 2); bar < bars; bar++) {
        const barsLeft = bars - bar;
        const b0 = bar * bpb;
        let times = [];
        if (barsLeft === 1) {
          const fine = roll && beatDur / 4 >= MIN_STEP;
          for (let x = 0; x < bpb / 2; x += 0.5) times.push(x);
          for (let x = Math.ceil(bpb / 2); x < bpb; x += fine ? 0.25 : 0.5) times.push(x);
        } else if (barsLeft <= 4) times = [...Array(bpb).keys()];
        else times = [0];
        for (const x of times) {
          const t = beatT(b0 + x);
          const pitch = barsLeft === 1 ? lerp(1.3, 0.85, x / bpb) : 1;
          add('perc', 'perc', t, 0.5, { pitch, vel: vel(t) * style.drums * (Number.isInteger(x) ? 1 : 0.8) });
        }
      }
    }
    for (let b = hitBeat; b < tailBeat; b++) {
      if (b % bpb === 0 || (bpb === 4 && b % bpb === 2)) add('perc', 'perc', beatT(b), 0.5, { pitch: 0.9, vel: vel(beatT(b)) * style.drums });
    }
  }

  // Electronics: a riser into the hit, and a reverse-style swell that ends on it.
  if (style.electronics >= AUDIBLE && !noHit) {
    const rr = rng('electronics', 'riser');
    const riseBars = Math.min(bars - buildBar, rr() < 0.5 ? 4 : 8);
    const color = 0.3 + 0.5 * rr();
    const v = energyGain * style.electronics;
    if (riseBars >= 1) {
      const t = barT(bars - riseBars);
      add('electronics', 'riser', t, p.hit - t, { note: ROOT, vel: v, color });
    }
    const swellDur = Math.min(barDur, 2.5);
    add('electronics', 'swell', p.hit - swellDur, swellDur, { vel: v });
  }

  // The hit: a soft arrival nearer Satie, a full orchestra nearer Ravel, a deep
  // boom and low brass nearer Jóhannsson.
  const hc = barChord[bars] ?? barChord[barChord.length - 1];
  const [h0, h1, h2] = hc.tones;
  const hitNotes = [h0 - 12, h0, h2, h0 + 12, h1 + 12, h2 + 12];
  const hitKind = surprises.get(bars);
  if (style.boom >= AUDIBLE && !noHit) add('impact', 'impact', p.hit, 3.5, { vel: energyGain * style.boom });
  if (style.tutti >= AUDIBLE && !noHit) {
    const notes = hitKind === 'twoKeys' ? [...hitNotes, ...hitNotes.slice(2).map(n => n + 6)]
      : hitKind === 'cluster' ? [...hitNotes, h0 + 13] : hitNotes;
    add('impact', 'stab', p.hit, Math.min(beatDur * 3, 2), { notes, vel: energyGain * style.tutti });
  }
  if (style.brass >= AUDIBLE && !noHit && tailT - p.hit > 0.3) {
    add('bass', 'brass', p.hit, Math.min(barDur * 2, tailT - p.hit), { notes: [lowNote(h0), lowNote(h0) + 7], vel: energyGain * style.brass * 0.8 });
  }

  if (scape >= AUDIBLE) soundscape({ p, scale, scape, vel, rng, add });

  // Tail: the home chord held (or left ringing on the piano) so the reverb
  // rings out inside the file. The soundscape instead ends unresolved, on the
  // note just below home, high over the low home note.
  if (p.end - tailT > 0.3) {
    const notes = scape >= 0.5 ? [ROOT - 12, ROOT + 23] : [h0 - 12, h0 + 12, h1 + 12, h2 + 12];
    if (scape >= 0.5) add('tail', 'tail', tailT, p.end - tailT, { notes, vel: energyGain * 0.5 * scape });
    else if (style.piano > 0.5) add('tail', 'piano', tailT, p.end - tailT, { notes, vel: energyGain * 0.6 * style.piano });
    else add('tail', 'tail', tailT, p.end - tailT, { notes, vel: energyGain * 0.7 });
  }

  events.sort((a, b) => a.t - b.t);
  return {
    noHit,
    events, tempo, buildBar, hitBeat, tailBeat, tailT, style, spans,
    surprises: [...surprises].map(([bar, kind]) => ({ bar, kind, t: barT(bar) })),
  };
}

// The soundscape, in free time (seconds, not bars), as heard in "Escape":
// - breathing bass: the home note held low, rocking now and then to the note
//   a major third below it and back;
// - bloom: the home note spreading upwards, an octave at a time, through the
//   build, and thinning out again through the tail;
// - colour: single notes of the scale entering one by one over the held sound
//   towards the peak, then withdrawn, last in first out.
// Positions are fractions of each section, so moving a point stretches the
// soundscape rather than re-rolling it.
function soundscape({ p, scale, scape, vel, rng, add }) {
  const low = ROOT - 12;
  const level = t => vel(t) * scape;

  const r = rng('harmony', 'breath');
  for (let t = p.start, k = 0; t < p.end - 0.5; k++) {
    const home = k % 2 === 0;
    const len = Math.min(home ? 6 + 6 * r() : 3 + 3 * r(), p.end - t);
    // Only rock once the build has begun; before that, hold.
    const note = home || t < p.build ? low : low - 4;
    add('bass', 'bass', t, len, { note, vel: level(t) * 0.9 });
    t += len;
  }

  const span = p.hit - p.start, fade = p.end - p.tail;
  const octaves = [ROOT + 12, ROOT, ROOT + 24, ROOT + 36];
  const enter = [0.1, 0.3, 0.5, 0.75];
  octaves.forEach((note, i) => {
    const t = p.start + span * enter[i];
    const off = p.tail + fade * (0.85 - 0.2 * i); // the last to come in is the first to go
    add('strings', 'strings', t, off - t, { notes: [note], vel: level(t) * (0.5 - 0.07 * i), attack: Math.min(8, (off - t) * 0.4) });
  });

  const cr = rng('harmony', 'colour');
  const steps = [6, 2, 4, 1, 5];
  for (let i = steps.length - 1; i > 0; i--) {
    const j = Math.floor(cr() * (i + 1));
    [steps[i], steps[j]] = [steps[j], steps[i]];
  }
  const rise = p.hit - p.build, after = p.tail - p.hit;
  [0.1, 0.4, 0.7].forEach((f, i) => {
    const t = p.build + rise * f;
    const off = p.hit + after * (1 - 0.35 * i);
    add('strings', 'strings', t, off - t, { notes: [scaleNote(scale, steps[i]) + 12], vel: level(t) * 0.4, attack: Math.min(5, (off - t) * 0.4) });
  });
}
