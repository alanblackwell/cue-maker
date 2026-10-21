import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_RATES, framesToTimecode, timecodeToFrames, secondsToTimecode, timecodeToSeconds, snapToFrame,
} from '../src/timecode.js';

const rate = id => FRAME_RATES.find(r => r.id === id);

test('non-drop timecode at 24 fps', () => {
  assert.equal(secondsToTimecode(3601.5, rate('24')), '01:00:01:12');
  assert.equal(timecodeToFrames('01:00:00:00', rate('24')), 86400);
});

test('23.976 start timecode as FCPXML writes it', () => {
  // FCP writes 01:00:00:00 at 23.976 as 86486400/24000s = 3603.6 s.
  assert.equal(secondsToTimecode(3603.6, rate('23.976')), '01:00:00:00');
  assert.ok(Math.abs(timecodeToSeconds('01:00:00:00', rate('23.976')) - 3603.6) < 1e-9);
});

test('29.97 drop-frame skips frame numbers at minute boundaries', () => {
  const r = rate('29.97df');
  assert.equal(framesToTimecode(1799, r, true), '00:00:59;29');
  assert.equal(framesToTimecode(1800, r, true), '00:01:00;02');
  assert.equal(framesToTimecode(17982, r, true), '00:10:00;00');
  assert.equal(framesToTimecode(107892, r, true), '01:00:00;00');
});

test('drop-frame round trip', () => {
  for (const id of ['29.97df', '59.94df']) {
    const r = rate(id);
    for (let f = 0; f < 200000; f += 37) assert.equal(timecodeToFrames(framesToTimecode(f, r, true), r, true), f);
  }
});

test('rejects malformed timecode', () => {
  assert.throws(() => timecodeToFrames('1:00:00', rate('24')));
  assert.throws(() => timecodeToFrames('00:00:00:24', rate('24')));
});

test('snapToFrame lands on frame boundaries', () => {
  const r = rate('23.976');
  const t = snapToFrame(10.02, r);
  assert.ok(Math.abs(t * 24000 / 1001 - Math.round(t * 24000 / 1001)) < 1e-9);
});
