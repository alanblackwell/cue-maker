import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, fitTempo, styleWeights, styleAt, COMPOSERS, LAYERS } from '../src/generator.js';
import { defaultProject, migrateProject } from '../src/project.js';

// Points to try: the centre, each composer, and beyond each one.
const STYLES = [[0, 0], ...COMPOSERS.flatMap(c => [c.at, c.at.map(v => v * 1.85)])];
const docAt = (style, sour = 0.2) => {
  const doc = defaultProject();
  doc.music.style = style;
  doc.music.sour = sour;
  return doc;
};

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('tempo is fitted so the hit lands on a downbeat', () => {
  const t = fitTempo(2, 26, 96);
  assert.equal(t.bars, 10);
  assert.ok(near(t.bpm, 100));
  assert.ok(near(2 + t.bars * t.barDur, 26));
});

test('generation is deterministic', () => {
  const doc = defaultProject();
  assert.deepEqual(generate(doc), generate(structuredClone(doc)));
});

test('impact sits exactly on the hit and every layer produces events', () => {
  const doc = defaultProject();
  const { events } = generate(doc);
  const impact = events.find(e => e.type === 'impact');
  assert.equal(impact.t, doc.points.hit);
  for (const layer of LAYERS) assert.ok(events.some(e => e.layer === layer), layer);
});

test('style weights: 1 at each composer, and exaggerated beyond', () => {
  for (const c of COMPOSERS) {
    const w = styleWeights(c.at);
    for (const k of COMPOSERS) assert.ok(near(w[k.id], k === c ? 1 : 0), `${c.id}/${k.id}`);
    const beyond = styleWeights(c.at.map(v => v * 1.5));
    assert.ok(beyond[c.id] > 1);
  }
  assert.equal(styleAt(COMPOSERS[0].at).beatsPerBar, 3); // Satie counts in three
  assert.equal(styleAt(COMPOSERS[2].at).beatsPerBar, 4); // Jóhannsson in four
});

test('rhythmic events fall on the beat grid (sixteenths and triplets)', () => {
  for (const style of STYLES) {
    const doc = docAt(style);
    const { events, tempo } = generate(doc);
    const step = tempo.beatDur / 12;
    for (const e of events.filter(e => ['pulse', 'harp', 'perc', 'snare'].includes(e.type))) {
      const k = (e.t - doc.points.start) / step;
      assert.ok(near(k, Math.round(k), 1e-6), `${style}: ${e.type} at ${e.t}`);
    }
  }
});

test('nothing new starts after the tail except the tail itself', () => {
  for (const style of STYLES) {
    for (const sour of [0, 1]) {
      const { events, tailT } = generate(docAt(style, sour));
      const late = events.filter(e => e.t >= tailT - 1e-9 && e.layer !== 'tail');
      assert.deepEqual(late, [], `${style} sour ${sour}`);
    }
  }
});

test('every event is well formed, for every style and sourness', () => {
  for (const style of STYLES) {
    for (const sour of [0, 0.5, 1]) {
      const { events } = generate(docAt(style, sour));
      for (const e of events) {
        assert.ok(Number.isFinite(e.t) && Number.isFinite(e.dur) && e.dur > 0 && Number.isFinite(e.vel), JSON.stringify(e));
        for (const n of e.notes ?? [e.note ?? 60]) assert.ok(Number.isInteger(n) && n > 20 && n < 110, JSON.stringify(e));
      }
    }
  }
});

test('fully sweet means no surprises; more sour only adds them, in the same places', () => {
  assert.deepEqual(generate(docAt([0, 0], 0)).surprises, []);
  let prev = [];
  for (const sour of [0.2, 0.4, 0.6, 0.8, 1]) {
    const { surprises } = generate(docAt([0, 0], sour));
    const key = s => `${s.bar}:${s.kind}`;
    const now = new Set(surprises.map(key));
    for (const s of prev) assert.ok(now.has(key(s)), `${key(s)} vanished at sour ${sour}`);
    prev = surprises;
  }
  assert.ok(prev.length > 0);
});

test('moving the start point leaves the music near the hit unchanged', () => {
  const a = docAt([0, 0]);
  const { tempo } = generate(a);
  const b = structuredClone(a);
  b.points.start -= tempo.barDur * 2; // two more bars, same tempo
  // The tune comes in a set way through the cue, so a longer intro brings it in
  // earlier; the last four bars before the hit, and after it, stay the same.
  const near = e => e.t >= a.points.hit - 4 * tempo.barDur && e.t < a.points.tail;
  assert.deepEqual(generate(b).events.filter(near).map(e => e.notes ?? e.note), generate(a).events.filter(near).map(e => e.notes ?? e.note));
});

test('opens a version 1 project', () => {
  const v1 = {
    format: 'cue-maker-project', version: 1, music: { mood: 'tense', tempo: 110, energy: 0.5, buildCurve: 1 },
    seeds: { harmony: 7, pad: 8, pulse: 9, perc: 10, riser: 11 }, mutes: { pad: true, riser: false },
  };
  const doc = migrateProject(v1);
  assert.equal(doc.version, 2);
  assert.equal(doc.music.mood, undefined);
  assert.deepEqual(doc.music.style, [0, 0]);
  assert.equal(doc.music.tempo, 110);
  assert.equal(doc.seeds.electronics, 11);
  assert.equal(doc.mutes.strings, true);
  assert.ok(generate(doc).events.length > 0);
});

test('changing one seed leaves the other layers unchanged', () => {
  const a = defaultProject();
  const b = structuredClone(a);
  b.seeds.pulse = 999;
  const ea = generate(a).events, eb = generate(b).events;
  for (const layer of LAYERS.filter(l => l !== 'pulse')) {
    assert.deepEqual(ea.filter(e => e.layer === layer), eb.filter(e => e.layer === layer), layer);
  }
});

test('copes with a very short cue', () => {
  const doc = defaultProject();
  doc.points = { start: 0, build: 0.2, hit: 0.5, tail: 0.6, end: 1 };
  const { events } = generate(doc);
  assert.ok(events.length > 0);
  for (const e of events) assert.ok(Number.isFinite(e.t) && Number.isFinite(e.dur) && e.dur > 0, JSON.stringify(e));
});
