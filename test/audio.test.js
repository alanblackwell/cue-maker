import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeContext } from './fake-webaudio.js';
import { generate, LAYERS, MOODS } from '../src/generator.js';
import { defaultProject } from '../src/project.js';

globalThis.OfflineAudioContext = FakeContext;
globalThis.AudioContext = FakeContext;
const { createMixGraph, playEvent, QUALITY } = await import('../src/instruments.js');
const { renderCue } = await import('../src/render.js');
const { SketchPlayer } = await import('../src/sketch.js');

test('every event plays without Web Audio errors, for every mood and quality', () => {
  for (const mood of Object.keys(MOODS)) {
    const doc = defaultProject();
    doc.music.mood = mood;
    const { events } = generate(doc);
    for (const q of [QUALITY.sketch, QUALITY.final]) {
      const ctx = new FakeContext();
      const graph = createMixGraph(ctx, q);
      for (const ev of events) playEvent(ctx, graph, ev, ev.t - doc.points.start, q);
      for (const s of ctx.sources) assert.ok(s.stopped >= s.started, `${mood}: source stops before it starts`);
    }
  }
});

test('offline render covers exactly start to end, for the mix and each stem', async () => {
  const doc = defaultProject();
  const { events } = generate(doc);
  const mix = await renderCue(doc, events);
  assert.equal(mix.length, Math.ceil((doc.points.end - doc.points.start) * 48000));
  for (const layer of LAYERS) await renderCue(doc, events, { layers: [layer] });
});

function fakeTransport(time) {
  const t = new EventTarget();
  t.time = time;
  t.playing = true;
  return t;
}

test('sketch playback can start mid-cue on a freshly created audio context', () => {
  const doc = defaultProject();
  const { events } = generate(doc);
  for (const v0 of [doc.points.start, doc.points.build + 0.3, doc.points.hit - 0.01, doc.points.tail + 1]) {
    const player = new SketchPlayer(fakeTransport(v0));
    player.setEvents(events, doc.mutes);
    player.unlock();
    player.start(); // the context's currentTime is 0, so sounds that began earlier map to negative times
    player.stop();
  }
});

test('sketch scheduler queues events as the audio clock advances', () => {
  const doc = defaultProject();
  const { events } = generate(doc);
  const transport = fakeTransport(doc.points.build);
  const player = new SketchPlayer(transport);
  player.setEvents(events, doc.mutes);
  player.unlock();
  player.start();
  const ctx = player.ctx;
  const before = ctx.sources.length;
  for (let i = 0; i < 50; i++) {
    ctx.currentTime += 0.04;
    transport.time += 0.04;
    player.tick();
  }
  const until = player.session.until;
  player.stop();
  assert.ok(ctx.sources.length > before);
  const queued = events.filter(e => e.t >= doc.points.build && e.t < until).length;
  assert.ok(queued > 0 && player.session === null);
});
