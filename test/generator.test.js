import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, fitTempo, LAYERS, MOODS } from '../src/generator.js';
import { defaultProject } from '../src/project.js';

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

test('rhythmic events fall on the sixteenth-note grid', () => {
  const doc = defaultProject();
  const { events, tempo } = generate(doc);
  const step = tempo.beatDur / 4;
  for (const e of events.filter(e => e.type === 'pulse' || e.type === 'perc')) {
    const k = (e.t - doc.points.start) / step;
    assert.ok(near(k, Math.round(k), 1e-6), `${e.type} at ${e.t}`);
  }
});

test('nothing new starts after the tail except the tail itself', () => {
  for (const mood of Object.keys(MOODS)) {
    const doc = defaultProject();
    doc.music.mood = mood;
    const { events, tailT } = generate(doc);
    const late = events.filter(e => e.t >= tailT - 1e-9 && e.layer !== 'tail');
    assert.deepEqual(late, [], mood);
  }
});

test('changing one seed leaves the other layers unchanged', () => {
  const a = defaultProject();
  const b = structuredClone(a);
  b.seeds.pulse = 999;
  const ea = generate(a).events, eb = generate(b).events;
  for (const layer of ['pad', 'bass', 'perc', 'riser', 'impact', 'tail']) {
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
