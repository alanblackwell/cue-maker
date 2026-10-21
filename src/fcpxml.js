// Reads markers from a Final Cut Pro XML export (File > Export XML…).
//
// FCPXML times are rationals like "1001/24000s". Each clip has its own local
// timeline: `offset` places the clip in its parent's time, `start` is the local
// time of its first visible frame, and a marker's `start` is in that local time.
// So a marker's sequence time is parent(offset + (marker.start - clip.start)).
//
// Not handled yet: retimed clips (timeMap) and the timing of secondary
// storylines with their own offset; markers on primary and connected clips are.

import { POINT_KEYS } from './generator.js';

const CLIP_ELEMENTS = new Set([
  'asset-clip', 'clip', 'gap', 'ref-clip', 'sync-clip', 'mc-clip', 'video', 'audio', 'title',
]);
const MARKER_ELEMENTS = new Set(['marker', 'chapter-marker']);
const MIN_GAP = 0.1;

export function parseRational(text) {
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s$/.exec(String(text).trim());
  if (!m) throw new Error(`Unrecognised FCPXML time "${text}"`);
  return { n: Number(m[1]), d: m[2] ? Number(m[2]) : 1 };
}

export function parseTime(text) {
  if (text == null || text === '') return 0;
  const { n, d } = parseRational(text);
  return n / d;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENTITIES[e] ?? all,
  );

function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decode(m[2] ?? m[3]);
  return attrs;
}

// A deliberately tiny XML reader (elements and attributes only), so the same
// code runs in the browser and under Node tests without a DOM.
export function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const m of text.matchAll(re)) {
    const [, closing, name, attrText, selfClosing] = m;
    if (!name) continue;
    if (closing) {
      while (stack.length > 1 && stack.pop().name !== name);
      continue;
    }
    const node = { name, attrs: parseAttrs(attrText), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function* descendants(node) {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function collectMarkers(node, toSequence, range, out) {
  for (const child of node.children) {
    if (MARKER_ELEMENTS.has(child.name)) {
      const local = parseTime(child.attrs.start);
      if (range && (local < range.start - 1e-9 || local >= range.end)) continue; // trimmed off
      out.push({ name: child.attrs.value ?? '', note: child.attrs.note ?? '', kind: child.name, time: toSequence(local) });
    } else if (CLIP_ELEMENTS.has(child.name)) {
      const offset = parseTime(child.attrs.offset);
      const start = parseTime(child.attrs.start);
      const duration = child.attrs.duration ? parseTime(child.attrs.duration) : Infinity;
      collectMarkers(child, x => toSequence(offset + (x - start)), { start, end: start + duration }, out);
    } else if (child.name === 'spine') {
      collectMarkers(child, toSequence, range, out);
    }
  }
}

// Returns markers in sequence time (seconds, including the sequence's start
// timecode) plus the sequence's frame rate and start time.
export function parseFcpxml(text) {
  const root = parseXml(text);
  const nodes = [...descendants(root)];
  if (!nodes.some(n => n.name === 'fcpxml')) throw new Error('This file is not FCPXML');
  const sequence = nodes.find(n => n.name === 'sequence');
  if (!sequence) throw new Error('No sequence found. Export the project (timeline) as XML from Final Cut.');
  const project = nodes.find(n => n.name === 'project' && n.children.includes(sequence));

  let rate = null;
  const format = nodes.find(n => n.name === 'format' && n.attrs.id === sequence.attrs.format);
  if (format?.attrs.frameDuration) {
    const { n, d } = parseRational(format.attrs.frameDuration);
    const g = gcd(d, n);
    rate = { num: d / g, den: n / g };
  }

  const markers = [];
  collectMarkers(sequence, x => x, null, markers);
  markers.sort((a, b) => a.time - b.time);

  return {
    name: project?.attrs.name ?? '',
    rate,
    dropFrame: sequence.attrs.tcFormat === 'DF',
    tcStart: parseTime(sequence.attrs.tcStart),
    duration: parseTime(sequence.attrs.duration),
    markers,
  };
}

// Marker names that identify a phase point. Checked in this order.
const NAME_PATTERNS = [
  ['hit', /\b(hit|climax|impact|peak|sting)\b/i],
  ['build', /\b(build|rise|riser|swell)\b/i],
  ['tail', /\b(tail|outro|reverb|decay|ring)\b/i],
  ['end', /\b(end|out|stop|cue ?out)\b/i],
  ['start', /\b(intro|lead[- ]?in|start|cue ?in|in)\b/i],
];

// markers: [{name, t}] in video time. Named markers go to their phase; unnamed
// ones fill the remaining points wherever they fit chronologically. Points with
// no marker keep their previous spacing from a neighbouring point.
export function assignMarkersToPoints(markers, previous) {
  const found = {};
  const unnamed = [];
  const ignored = [];
  for (const m of markers) {
    const key = NAME_PATTERNS.find(([k, re]) => !(k in found) && re.test(m.name))?.[0];
    if (key) found[key] = m.t;
    else unnamed.push(m);
  }
  for (const m of unnamed) {
    const key = POINT_KEYS.find(
      (k, i) =>
        !(k in found) &&
        POINT_KEYS.every((o, j) => !(o in found) || (j < i ? found[o] < m.t : found[o] > m.t)),
    );
    if (key) found[key] = m.t;
    else ignored.push(m);
  }

  const points = { ...found };
  for (let i = 1; i < POINT_KEYS.length; i++) {
    const k = POINT_KEYS[i], before = POINT_KEYS[i - 1];
    if (!(k in points) && before in points) points[k] = points[before] + (previous[k] - previous[before]);
  }
  for (let i = POINT_KEYS.length - 2; i >= 0; i--) {
    const k = POINT_KEYS[i], after = POINT_KEYS[i + 1];
    if (!(k in points) && after in points) points[k] = points[after] - (previous[after] - previous[k]);
  }
  if (!Object.keys(found).length) Object.assign(points, previous);

  points.start = Math.max(0, points.start);
  for (let i = 1; i < POINT_KEYS.length; i++) {
    const k = POINT_KEYS[i];
    points[k] = Math.max(points[k], points[POINT_KEYS[i - 1]] + MIN_GAP);
  }
  return { points, assigned: Object.keys(found), ignored };
}
