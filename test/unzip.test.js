import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { zipEntries, fcpxmlInZip } from '../src/unzip.js';
import { parseFcpxml } from '../src/fcpxml.js';

// Builds a zip in memory. CRCs are left at zero, since the reader doesn't check them.
function makeZip(files, { deflate = false } = {}) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, deflate ? 8 : 0, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, new Uint8Array(eocd.buffer)]);
}

const BUNDLE = {
  'Reel.fcpxmld/': '',
  'Reel.fcpxmld/Info.fcpxml': '<fcpxml version="1.10"/>',
  '__MACOSX/Reel.fcpxmld/._Info.fcpxml': 'resource fork',
};

test('lists zip entries', () => {
  return makeZip(BUNDLE).arrayBuffer().then(buf => {
    assert.deepEqual(zipEntries(new Uint8Array(buf)).map(e => e.name), Object.keys(BUNDLE));
  });
});

for (const deflate of [false, true]) {
  test(`finds Info.fcpxml in a zipped bundle (${deflate ? 'deflated' : 'stored'}), skipping __MACOSX`, async () => {
    const zip = new File([makeZip(BUNDLE, { deflate })], 'Reel.fcpxmld.zip');
    const xml = await fcpxmlInZip(zip);
    assert.equal(xml.name, 'Reel.fcpxmld.zip › Info.fcpxml');
    assert.equal(await xml.text(), '<fcpxml version="1.10"/>');
  });
}

test('a zip without XML gives null; a non-zip is an error', async () => {
  assert.equal(await fcpxmlInZip(new File([makeZip({ 'notes.txt': 'hi' })], 'a.zip')), null);
  await assert.rejects(fcpxmlInZip(new File(['not a zip'], 'b.zip')), /not a zip/);
});

const GARY = new URL('../media/For Alan Cue Test XML wMarkers 10.23.fcpxmld.zip', import.meta.url);
test('reads the markers from the zip Gary emailed', { skip: !existsSync(GARY) && 'media/ not present' }, async () => {
  const xml = await fcpxmlInZip(new File([readFileSync(GARY)], 'gary.zip'));
  const info = parseFcpxml(await xml.text());
  assert.equal(info.markers.length, 14);
});
