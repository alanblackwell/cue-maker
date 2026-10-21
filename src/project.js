// The project document: everything needed to regenerate a cue exactly.
// Saved as JSON; `version` lets later releases open older files.

import { APP_VERSION } from './version.js';
import { POINT_KEYS, MOODS } from './generator.js';

export const PROJECT_FORMAT = 'cue-maker-project';
export const PROJECT_VERSION = 1;

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
    music: { mood: 'dark', tempo: 96, energy: 0.8, buildCurve: 1.8 },
    seeds: { harmony: 1, pad: 2, pulse: 3, perc: 4, riser: 5 },
    locks: { harmony: false, pad: false, pulse: false, perc: false, riser: false },
    mutes: { pad: false, bass: false, pulse: false, perc: false, riser: false, impact: false, tail: false },
  };
}

export function migrateProject(raw) {
  if (!raw || raw.format !== PROJECT_FORMAT) throw new Error('This is not a Cue Maker project file');
  if (raw.version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer Cue Maker (format ${raw.version}); reload the page to update`);
  }
  // Future format changes: transform older versions here, oldest first.
  const base = defaultProject();
  const doc = { ...base };
  for (const key of ['title', 'markers']) if (raw[key] !== undefined) doc[key] = raw[key];
  for (const key of ['video', 'timing', 'points', 'music', 'seeds', 'locks', 'mutes']) doc[key] = { ...base[key], ...raw[key] };
  if (!MOODS[doc.music.mood]) doc.music.mood = base.music.mood;
  const ordered = POINT_KEYS.every((k, i) => i === 0 || doc.points[k] > doc.points[POINT_KEYS[i - 1]]);
  if (!ordered) doc.points = base.points;
  return doc;
}

export function serializeProject(doc) {
  return JSON.stringify({ ...doc, savedWith: APP_VERSION, savedAt: new Date().toISOString() }, null, 2);
}
