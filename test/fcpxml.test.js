import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFcpxml, parseXml, assignMarkersToPoints, placePoint } from '../src/fcpxml.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p2398" frameDuration="1001/24000s" width="1920" height="1080"/>
    <asset id="r2" name="A001" start="0s" duration="100s" hasVideo="1" format="r1"/>
  </resources>
  <library>
    <event name="Edit">
      <project name="Reel 1 &amp; titles">
        <sequence format="r1" duration="60s" tcStart="3600s" tcFormat="NDF">
          <spine>
            <gap name="Gap" offset="3600s" start="3600s" duration="10s">
              <marker start="3602s" duration="1001/24000s" value="Intro"/>
            </gap>
            <asset-clip ref="r2" offset="3610s" name="A001" start="20s" duration="30s">
              <!-- a comment -->
              <marker start="25s" duration="1001/24000s" value="build"/>
              <marker start="45s" duration="1001/24000s" value="Big HIT"/>
              <marker start="5s" duration="1001/24000s" value="trimmed away"/>
              <asset-clip ref="r2" lane="1" offset="48s" start="70s" duration="8s">
                <marker start="72s" duration="1001/24000s" value="tail"/>
              </asset-clip>
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;

const PREVIOUS = { start: 2, build: 10, hit: 26, tail: 30, end: 38 };

test('parseXml handles attributes, entities and nesting', () => {
  const root = parseXml('<a x="1 &amp; 2"><b/><c y=\'z\'></c></a>');
  assert.equal(root.children[0].attrs.x, '1 & 2');
  assert.deepEqual(root.children[0].children.map(n => n.name), ['b', 'c']);
});

test('parseFcpxml maps clip-local marker times to sequence time', () => {
  const info = parseFcpxml(SAMPLE);
  assert.equal(info.name, 'Reel 1 & titles');
  assert.deepEqual(info.rate, { num: 24000, den: 1001 });
  assert.equal(info.tcStart, 3600);
  assert.equal(info.dropFrame, false);
  assert.deepEqual(info.markers.map(m => [m.name, m.time]), [
    ['Intro', 3602],
    ['build', 3615],
    ['Big HIT', 3635],
    ['tail', 3640],
  ]);
});

test('named markers become phase points; missing ones keep previous spacing', () => {
  const info = parseFcpxml(SAMPLE);
  const markers = info.markers.map(m => ({ name: m.name, t: m.time - info.tcStart }));
  const { points, assigned } = assignMarkersToPoints(markers, PREVIOUS);
  assert.deepEqual(points, { start: 2, build: 15, hit: 35, tail: 40, end: 48 });
  assert.deepEqual(assigned.sort(), ['build', 'hit', 'start', 'tail']);
});

test('unnamed markers fill points in order around named ones', () => {
  const { points } = assignMarkersToPoints(
    [{ name: 'Marker 1', t: 5 }, { name: 'HIT', t: 20 }, { name: 'Marker 2', t: 30 }],
    PREVIOUS,
  );
  assert.equal(points.start, 5);
  assert.equal(points.hit, 20);
  assert.equal(points.tail, 30);
  assert.equal(points.build, 13); // derived: start + (10 - 2)
  assert.equal(points.end, 38); // derived: tail + (38 - 30)
});

test('rejects files without a sequence', () => {
  assert.throws(() => parseFcpxml('<fcpxml version="1.10"><resources/></fcpxml>'), /No sequence/);
});

test('placing a point between its neighbours moves only that point', () => {
  const { points, moved } = placePoint(PREVIOUS, 'hit', 20);
  assert.deepEqual(points, { ...PREVIOUS, hit: 20 });
  assert.deepEqual(moved, []);
});

test('placing a point past its neighbours pushes them along, keeping their spacing', () => {
  // Gary's case: points set from leftover markers, then Tail put on a late one.
  const early = { start: 6.5, build: 6.9, hit: 16, tail: 17.8, end: 45.6 };
  const { points, moved } = placePoint(early, 'tail', 119.8);
  assert.equal(points.tail, 119.8);
  assert.ok(Math.abs(points.end - (119.8 + 27.8)) < 1e-9);
  assert.deepEqual(moved, ['end']);

  const back = placePoint(PREVIOUS, 'build', 1).points;
  assert.equal(back.build, 1);
  assert.equal(back.start, 0); // pushed to 1 - 8, then kept at zero
});

test('pushed points are squeezed in before the end of the video', () => {
  const { points } = placePoint(PREVIOUS, 'hit', 59, 60);
  assert.equal(points.hit, 59);
  assert.equal(points.end, 60);
  assert.ok(points.tail > points.hit && points.tail < points.end);
});
