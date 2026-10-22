// The project document: everything needed to regenerate a cue exactly.
// Saved as JSON; `version` lets later releases open older files.

import { APP_VERSION } from './version.js';
import { POINT_KEYS, STYLE_RADIUS } from './generator.js';

export const PROJECT_FORMAT = 'cue-maker-project';
export const PROJECT_VERSION = 2;

export function defaultProject() {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    title: 'Cue 1M1',
    video: { name: null, duration: null },
    // tcStart is a timecode string so it keeps its meaning if the frame rate changes.
    timing: { fpsNum: 24, fpsDen: 1, dropFrame: false, tcStart: '01:00:00:00' },
    points: { start: 2, build: 10, hit: 26, tail: 30, end: 38 },
    markers: [],
    // The Final Cut XML the markers came from, or null.
    xml: null,
    // style: a point in the composers' plane (see generator.js); sour: 0..1.
    music: { style: [0, 0], sour: 0.2, tempo: 96, energy: 0.8, buildCurve: 1.8 },
    seeds: { harmony: 1, tune: 2, pulse: 3, perc: 4, electronics: 5, surprise: 6 },
    locks: { harmony: false, tune: false, pulse: false, perc: false, electronics: false, surprise: false },
    mutes: {
      piano: false, tune: false, strings: false, bass: false, pulse: false, perc: false,
      electronics: false, impact: false, tail: false,
    },
  };
}

export function migrateProject(raw) {
  if (!raw || raw.format !== PROJECT_FORMAT) throw new Error('This is not a Cue Maker project file');
  if (raw.version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer Cue Maker (format ${raw.version}); reload the page to update`);
  }
  raw = structuredClone(raw);
  // Format changes: transform older versions here, oldest first.
  if (raw.version < 2) {
    // Mood gave way to the style point and Sweet/Sour; layers were renamed.
    delete raw.music?.mood;
    for (const k of ['seeds', 'locks']) {
      if (raw[k]?.riser !== undefined) raw[k].electronics = raw[k].riser;
      for (const old of ['pad', 'riser']) delete raw[k]?.[old];
    }
    if (raw.mutes) {
      if (raw.mutes.pad !== undefined) raw.mutes.strings = raw.mutes.pad;
      if (raw.mutes.riser !== undefined) raw.mutes.electronics = raw.mutes.riser;
      delete raw.mutes.pad;
      delete raw.mutes.riser;
    }
  }
  const base = defaultProject();
  const doc = { ...base };
  for (const key of ['title', 'markers', 'xml']) if (raw[key] !== undefined) doc[key] = raw[key];
  for (const key of ['video', 'timing', 'points', 'music', 'seeds', 'locks', 'mutes']) doc[key] = { ...base[key], ...raw[key] };
  if (!doc.xml?.file) doc.xml = null;
  const [x, y] = Array.isArray(doc.music.style) ? doc.music.style.map(Number) : [NaN, NaN];
  doc.music.style = Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) <= STYLE_RADIUS + 1e-9 ? [x, y] : base.music.style;
  const ordered = POINT_KEYS.every((k, i) => i === 0 || doc.points[k] > doc.points[POINT_KEYS[i - 1]]);
  if (!ordered) doc.points = base.points;
  return doc;
}

export function serializeProject(doc) {
  return JSON.stringify({ ...doc, savedWith: APP_VERSION, savedAt: new Date().toISOString() }, null, 2);
}
