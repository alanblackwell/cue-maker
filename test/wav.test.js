import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/wav.js';

const ascii = (bytes, at, n) => String.fromCharCode(...bytes.slice(at, at + n));

test('24-bit stereo PCM layout and sample values', () => {
  const left = new Float32Array([0, 0.5, -1, 1]);
  const right = new Float32Array([0, -0.5, 0, 0]);
  const wav = encodeWav([left, right], 48000, { dither: false });
  const v = new DataView(wav.buffer);
  assert.equal(ascii(wav, 0, 4), 'RIFF');
  assert.equal(v.getUint32(4, true), wav.length - 8);
  assert.equal(ascii(wav, 8, 8), 'WAVEfmt ');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(ascii(wav, 36, 4), 'data');
  assert.equal(v.getUint32(40, true), 4 * 2 * 3);
  const sample = i => {
    const o = 44 + i * 3;
    const u = wav[o] | (wav[o + 1] << 8) | (wav[o + 2] << 16);
    return u & 0x800000 ? u - 0x1000000 : u;
  };
  assert.equal(sample(2), 4194304); // left 0.5
  assert.equal(sample(3), -4194303); // right -0.5 (Math.round rounds .5 upwards)
  assert.equal(sample(4), -8388607); // left -1
  assert.equal(sample(6), 8388607); // left 1
});

test('bext chunk carries the time reference', () => {
  const wav = encodeWav([new Float32Array(10)], 48000, {
    bext: { description: 'Cue', timeReference: 3600 * 48000, date: '2026-10-21', time: '12:00:00', codingHistory: 'A=PCM' },
  });
  const v = new DataView(wav.buffer);
  assert.equal(ascii(wav, 36, 4), 'bext');
  const base = 44;
  assert.equal(ascii(wav, base, 3), 'Cue');
  assert.equal(v.getUint32(base + 338, true), 3600 * 48000);
  const dataAt = base + v.getUint32(40, true);
  assert.equal(ascii(wav, dataAt, 4), 'data');
  assert.equal(v.getUint32(4, true), wav.length - 8);
});
