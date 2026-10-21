// PCM WAV / Broadcast WAV encoding. The optional `bext` chunk carries a time
// reference (samples since midnight), which Pro Tools, Logic and similar tools
// can use to spot the file at its original timecode.

import { makeRng } from './rng.js';

const BEXT_FIXED = 602;

function writeAscii(view, offset, text, length = text.length) {
  for (let i = 0; i < length; i++) view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) & 0x7f : 0);
}

// channels: Float32Array per channel, all the same length.
export function encodeWav(channels, sampleRate, options = {}) {
  const { bitDepth = 24, gain = 1, dither = true, seed = 1, bext = null } = options;
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('bitDepth must be 16 or 24');
  const nCh = channels.length;
  const frames = channels[0].length;
  const bytes = bitDepth / 8;
  const dataBytes = frames * nCh * bytes;
  const history = bext ? (bext.codingHistory ?? '') : '';
  const bextBytes = bext ? BEXT_FIXED + history.length + (history.length & 1) : 0;
  const total = 12 + 24 + (bext ? 8 + bextBytes : 0) + 8 + dataBytes + (dataBytes & 1);
  if (total > 0xffffffff) throw new Error('Render is too long for a single WAV file (4 GB limit)');

  const buffer = new ArrayBuffer(total);
  const v = new DataView(buffer);
  let o = 0;
  const str = s => { writeAscii(v, o, s); o += s.length; };
  const u16 = x => { v.setUint16(o, x, true); o += 2; };
  const u32 = x => { v.setUint32(o, x, true); o += 4; };

  str('RIFF'); u32(total - 8); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(nCh); u32(sampleRate); u32(sampleRate * nCh * bytes); u16(nCh * bytes); u16(bitDepth);

  if (bext) {
    str('bext'); u32(bextBytes);
    const base = o;
    writeAscii(v, base, bext.description ?? '', 256);
    writeAscii(v, base + 256, bext.originator ?? '', 32);
    writeAscii(v, base + 288, bext.originatorReference ?? '', 32);
    writeAscii(v, base + 320, bext.date ?? '', 10);
    writeAscii(v, base + 330, bext.time ?? '', 8);
    const ref = Math.max(0, Math.round(bext.timeReference ?? 0));
    v.setUint32(base + 338, ref % 2 ** 32, true);
    v.setUint32(base + 342, Math.floor(ref / 2 ** 32), true);
    v.setUint16(base + 346, 1, true); // version; UMID, loudness and reserved stay zero
    writeAscii(v, base + BEXT_FIXED, history);
    o = base + bextBytes;
  }

  str('data'); u32(dataBytes);
  const full = 2 ** (bitDepth - 1);
  const scale = (full - 1) * gain;
  const rng = makeRng(seed);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      let x = channels[c][i] * scale;
      if (dither) x += rng() - rng(); // TPDF dither, ±1 LSB
      const s = Math.max(-full, Math.min(full - 1, Math.round(x)));
      if (bitDepth === 16) v.setInt16(o, s, true);
      else {
        v.setUint8(o, s & 0xff);
        v.setUint8(o + 1, (s >> 8) & 0xff);
        v.setUint8(o + 2, (s >> 16) & 0xff);
      }
      o += bytes;
    }
  }
  return new Uint8Array(buffer);
}
