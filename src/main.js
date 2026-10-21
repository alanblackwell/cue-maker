import { getLog, note } from './errors.js';
import { APP_VERSION } from './version.js';
import { FRAME_RATES, secondsToTimecode, timecodeToSeconds, snapToFrame } from './timecode.js';
import { generate, intensityAt, LAYERS, LAYER_LABELS, SEED_KEYS, POINT_KEYS, MOODS } from './generator.js';
import { parseFcpxml, assignMarkersToPoints } from './fcpxml.js';
import { defaultProject, migrateProject, serializeProject } from './project.js';
import { randomSeed } from './rng.js';
import { Transport } from './transport.js';
import { SketchPlayer } from './sketch.js';
import { Timeline } from './timeline.js';
import { renderCue, peakOf, RENDER_RATE } from './render.js';
import { encodeWav } from './wav.js';

const $ = sel => document.querySelector(sel);
const AUTOSAVE_KEY = 'cue-maker:autosave';
const MIN_GAP = 0.1;
const PEAK_TARGET = 10 ** (-1 / 20); // -1 dBFS
const MAX_MAKEUP_GAIN = 4;
const POINT_LABELS = { start: 'Intro / Lead-in', build: 'Build', hit: 'Climax / Hit', tail: 'Tail / Outro', end: 'End' };
const POINT_COLORS = { start: '--phase-intro', build: '--phase-build', hit: '--phase-climax', tail: '--phase-tail', end: '--muted' };
const LAYER_ROWS = [
  { label: 'Harmony', seed: 'harmony' },
  { label: LAYER_LABELS.pad, layer: 'pad', seed: 'pad' },
  { label: LAYER_LABELS.bass, layer: 'bass' },
  { label: LAYER_LABELS.pulse, layer: 'pulse', seed: 'pulse' },
  { label: LAYER_LABELS.perc, layer: 'perc', seed: 'perc' },
  { label: LAYER_LABELS.riser, layer: 'riser', seed: 'riser' },
  { label: LAYER_LABELS.impact, layer: 'impact' },
  { label: LAYER_LABELS.tail, layer: 'tail' },
];

let doc = loadAutosave() ?? defaultProject();
let result = generate(doc);
let projectHandle = null;
let videoUrl = null;
let loadedVideoName = null;
const seedHistory = [];

const video = $('#video');
const transport = new Transport(video);
const player = new SketchPlayer(transport);
const timeline = new Timeline($('#timeline'), {
  onSeek: t => transport.seek(t),
  onMovePoint: (key, t) => setPoint(key, t),
  onDragEnd: () => note('info', 'moved points', doc.points),
  formatTime: t => tc(t),
});

const rate = () => ({ num: doc.timing.fpsNum, den: doc.timing.fpsDen });
function tcStartSeconds() {
  try {
    return timecodeToSeconds(doc.timing.tcStart, rate(), doc.timing.dropFrame);
  } catch {
    return 0;
  }
}
const tc = t => secondsToTimecode(tcStartSeconds() + t, rate(), doc.timing.dropFrame);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const safeName = s => (s || 'cue').replace(/[^\w.-]+/g, '_');

// ---------------------------------------------------------------- state changes

function changed() {
  result = generate(doc);
  player.setEvents(result.events, doc.mutes);
  if (!transport.hasVideo) transport.fallbackDuration = Math.max(60, doc.points.end + 5);
  timeline.setModel({
    points: doc.points,
    tempo: result.tempo,
    events: result.events,
    markers: doc.markers,
    mutes: doc.mutes,
    duration: transport.duration,
    intensity: t => intensityAt(t, doc.points, doc.music),
  });
  updateReadouts();
  scheduleAutosave();
}

function setPoint(key, t) {
  const i = POINT_KEYS.indexOf(key);
  const lo = i === 0 ? 0 : doc.points[POINT_KEYS[i - 1]] + MIN_GAP;
  const hi = i === POINT_KEYS.length - 1
    ? (transport.hasVideo ? transport.duration : Infinity)
    : doc.points[POINT_KEYS[i + 1]] - MIN_GAP;
  doc.points[key] = clamp(snapToFrame(t, rate()), lo, hi);
  changed();
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(doc));
    } catch {
      // storage unavailable (private window etc.); saving to a file still works
    }
  }, 400);
}

function loadAutosave() {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? migrateProject(JSON.parse(text)) : null;
  } catch (err) {
    console.warn('Ignoring autosave:', err);
    return null;
  }
}

// ---------------------------------------------------------------- controls

function buildControls() {
  $('#version').textContent = `v${APP_VERSION}`;

  for (const r of FRAME_RATES) $('#fps').append(new Option(r.label, r.id));
  for (const [id, m] of Object.entries(MOODS)) $('#mood').append(new Option(`${m.label} · ${m.key}`, id));

  const pointsBody = $('#points');
  for (const k of POINT_KEYS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <th scope="row"><span class="swatch" style="background: var(${POINT_COLORS[k]})"></span>${POINT_LABELS[k]}</th>
      <td><button class="tc-btn" data-jump="${k}" title="Go to this point"></button></td>
      <td class="nudge"><button data-nudge="${k}" data-d="-1" title="One frame earlier">‹</button><button data-nudge="${k}" data-d="1" title="One frame later">›</button></td>
      <td><button class="btn small" data-set="${k}" title="Move this point to the playhead">Set here</button></td>`;
    pointsBody.append(tr);
  }
  pointsBody.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const { jump, nudge, set, d } = b.dataset;
    if (jump) transport.seek(doc.points[jump]);
    if (set) setPoint(set, transport.time);
    if (nudge) setPoint(nudge, doc.points[nudge] + (Number(d) * rate().den) / rate().num);
  });

  const layersBody = $('#layers');
  for (const row of LAYER_ROWS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.label}</td>
      <td>${row.layer ? `<input type="checkbox" data-play="${row.layer}" aria-label="Play ${row.label}">` : ''}</td>
      <td>${row.seed ? `<input type="checkbox" data-lock="${row.seed}" aria-label="Lock ${row.label}">` : ''}</td>
      <td class="seed">${row.seed ? `<span data-seed="${row.seed}"></span>` : ''}</td>`;
    layersBody.append(tr);
  }
  layersBody.addEventListener('change', e => {
    const { play, lock } = e.target.dataset;
    if (play) doc.mutes[play] = !e.target.checked;
    if (lock) doc.locks[lock] = e.target.checked;
    changed();
  });

  $('#title').addEventListener('input', e => {
    doc.title = e.target.value;
    scheduleAutosave();
  });
  $('#fps').addEventListener('change', e => {
    const r = FRAME_RATES.find(x => x.id === e.target.value);
    if (!r) return;
    doc.timing = { ...doc.timing, fpsNum: r.num, fpsDen: r.den, dropFrame: r.df };
    syncControls();
    changed();
  });
  $('#tc-start').addEventListener('change', e => {
    try {
      timecodeToSeconds(e.target.value, rate(), doc.timing.dropFrame);
      doc.timing.tcStart = e.target.value.trim().replace(/[;.]/g, ':');
      e.target.classList.remove('invalid');
      changed();
    } catch (err) {
      e.target.classList.add('invalid');
      toast(err.message);
    }
  });
  $('#video-sound').addEventListener('change', e => (video.muted = !e.target.checked));

  const music = (id, key, parse = Number) =>
    $(id).addEventListener('input', e => {
      doc.music[key] = parse(e.target.value);
      updateOutputs();
      changed();
    });
  music('#mood', 'mood', String);
  music('#tempo', 'tempo');
  music('#energy', 'energy');
  music('#curve', 'buildCurve');

  $('#reroll').addEventListener('click', () => {
    seedHistory.push({ ...doc.seeds });
    for (const k of SEED_KEYS) if (!doc.locks[k]) doc.seeds[k] = randomSeed();
    changed();
  });
  $('#undo-variation').addEventListener('click', () => {
    const seeds = seedHistory.pop();
    if (seeds) doc.seeds = seeds;
    changed();
  });

  $('#play').addEventListener('click', () => transport.toggle());
  $('#to-start').addEventListener('click', () => transport.seek(doc.points.start));
  $('#video-file').addEventListener('change', e => openVideo(e.target));
  $('#fcpxml-file').addEventListener('change', e => importFcpxml(e.target));
  $('#project-file').addEventListener('change', e => openProject(e.target));
  $('#save-project').addEventListener('click', saveProject);
  $('#bug-report').addEventListener('click', bugReport);
  $('#render').addEventListener('click', renderAndSave);
}

function syncControls() {
  $('#title').value = doc.title;
  const t = doc.timing;
  let fps = FRAME_RATES.find(r => r.num === t.fpsNum && r.den === t.fpsDen && r.df === t.dropFrame);
  if (!fps) {
    fps = { id: 'custom', label: `${(t.fpsNum / t.fpsDen).toFixed(3)} (from FCPXML)` };
    $('#fps').querySelector('[value="custom"]')?.remove();
    $('#fps').append(new Option(fps.label, fps.id));
  }
  $('#fps').value = fps.id;
  $('#tc-start').value = t.tcStart;
  $('#tc-start').classList.remove('invalid');
  $('#mood').value = doc.music.mood;
  $('#tempo').value = doc.music.tempo;
  $('#energy').value = doc.music.energy;
  $('#curve').value = doc.music.buildCurve;
  updateOutputs();
}

function updateOutputs() {
  $('#tempo-out').textContent = `${doc.music.tempo} BPM target`;
  $('#energy-out').textContent = `${Math.round(doc.music.energy * 100)}%`;
}

function updateReadouts() {
  for (const k of POINT_KEYS) $(`[data-jump="${k}"]`).textContent = tc(doc.points[k]);
  const { bpm, bars } = result.tempo;
  $('#tempo-readout').textContent =
    `Tempo fitted to ${bpm.toFixed(1)} BPM so the hit lands on the first beat of bar ${bars + 1} ` +
    `(${bars} bar${bars === 1 ? '' : 's'} of 4/4 from the cue start).`;
  for (const row of LAYER_ROWS) {
    if (row.layer) $(`[data-play="${row.layer}"]`).checked = !doc.mutes[row.layer];
    if (row.seed) {
      $(`[data-lock="${row.seed}"]`).checked = doc.locks[row.seed];
      $(`[data-seed="${row.seed}"]`).textContent = doc.seeds[row.seed];
    }
  }
  $('#undo-variation').disabled = seedHistory.length === 0;
}

// ---------------------------------------------------------------- files

async function openVideo(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  try {
    await transport.load(videoUrl);
  } catch (err) {
    $('#no-video').hidden = false;
    toast(err.message);
    console.warn(err);
    changed();
    return;
  }
  $('#no-video').hidden = true;
  loadedVideoName = file.name;
  doc.video = { name: file.name, duration: transport.duration };
  note('info', 'opened video', doc.video);
  if (doc.points.end > transport.duration) toast(`The cue ends after the video (${tc(transport.duration)}). Move the End point.`);
  else toast(`Opened ${file.name}`);
  changed();
}

async function importFcpxml(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const info = parseFcpxml(await file.text());
    if (info.rate) {
      doc.timing.fpsNum = info.rate.num;
      doc.timing.fpsDen = info.rate.den;
      doc.timing.dropFrame = info.dropFrame;
    }
    doc.timing.tcStart = secondsToTimecode(info.tcStart, rate(), doc.timing.dropFrame);
    doc.markers = info.markers.map(m => ({ name: m.name, t: m.time - info.tcStart }));
    if (!doc.markers.length) {
      toast('No markers found in that file. Add markers in Final Cut, then export XML again.');
    } else {
      const { points, assigned, ignored } = assignMarkersToPoints(doc.markers, doc.points);
      doc.points = points;
      const names = assigned.map(k => POINT_LABELS[k]).join(', ');
      toast(`Imported ${doc.markers.length} markers from "${info.name}". Set: ${names || 'none'}` +
        (ignored.length ? `. ${ignored.length} marker(s) didn't fit and are shown on the ruler only.` : '.'));
    }
    note('info', 'imported FCPXML', { file: file.name, markers: doc.markers, timing: doc.timing });
    syncControls();
    changed();
  } catch (err) {
    toast(`Couldn't read that FCPXML: ${err.message}`);
    console.warn(err);
  }
}

async function openProject(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    doc = migrateProject(JSON.parse(await file.text()));
    projectHandle = null;
    seedHistory.length = 0;
    syncControls();
    changed();
    const v = doc.video.name;
    toast(v && loadedVideoName !== v ? `Opened project. Now open its video, "${v}".` : 'Opened project.');
  } catch (err) {
    toast(`Couldn't open that project: ${err.message}`);
    console.warn(err);
  }
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function saveProject() {
  const text = serializeProject(doc);
  const name = `${safeName(doc.title)}.cue.json`;
  if (window.showSaveFilePicker) {
    try {
      projectHandle ??= await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Cue Maker project', accept: { 'application/json': ['.json'] } }],
      });
      const w = await projectHandle.createWritable();
      await w.write(text);
      await w.close();
      toast(`Saved ${projectHandle.name}`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Save in place failed, downloading instead:', err);
    }
  }
  download(name, new Blob([text], { type: 'application/json' }));
}

function bugReport() {
  const counts = Object.fromEntries(LAYERS.map(l => [l, result.events.filter(e => e.layer === l).length]));
  const report = {
    kind: 'cue-maker-bug-report',
    appVersion: APP_VERSION,
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    audio: player.info,
    video: transport.hasVideo
      ? { name: doc.video.name, duration: video.duration, width: video.videoWidth, height: video.videoHeight, currentTime: video.currentTime }
      : null,
    generated: { tempo: result.tempo, buildBar: result.buildBar, tailT: result.tailT, counts },
    project: doc,
    log: getLog(),
  };
  download(`cue-maker-report-${Date.now()}.json`, new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  toast('Bug report downloaded. Email it along with a description of what happened.');
}

// ---------------------------------------------------------------- rendering

async function renderAndSave() {
  // Ask for the folder first: browsers only allow the picker straight after a click.
  let dir = null;
  if (window.showDirectoryPicker) {
    try {
      dir = await window.showDirectoryPicker({ id: 'cue-renders', mode: 'readwrite' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn(err);
    }
  }
  const button = $('#render');
  const progress = $('#render-progress');
  const status = $('#render-status');
  button.disabled = true;
  progress.hidden = false;
  const snapshot = structuredClone(doc);
  const events = result.events;
  const base = `${safeName(snapshot.title)}_${tc(snapshot.points.start).replace(/[:;]/g, '')}`;
  const timeReference = Math.round((tcStartSeconds() + snapshot.points.start) * RENDER_RATE);
  const saved = [];
  const started = performance.now();

  const save = async (name, bytes) => {
    if (dir) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
    } else {
      download(name, new Blob([bytes], { type: 'audio/wav' }));
    }
    saved.push(name);
  };
  const encode = (buffer, gain, label) => {
    const now = new Date();
    return encodeWav([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate, {
      gain,
      bext: {
        description: `${snapshot.title} - ${label}`,
        originator: 'Cue Maker',
        originatorReference: `cue-maker-${APP_VERSION}`,
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().slice(0, 8),
        timeReference,
        codingHistory: `A=PCM,F=${RENDER_RATE},W=24,M=stereo,T=Cue Maker ${APP_VERSION}\r\n`,
      },
    });
  };

  try {
    const stems = $('#stems').checked
      ? LAYERS.filter(l => !snapshot.mutes[l] && events.some(e => e.layer === l))
      : [];
    const jobs = 1 + stems.length;
    status.textContent = 'Rendering mix…';
    const mix = await renderCue(snapshot, events, { onProgress: f => (progress.value = f / jobs) });
    const peak = peakOf(mix);
    // One gain for the mix and every stem, so the stems still sum to the mix.
    const gain = peak > 0 ? Math.min(PEAK_TARGET / peak, MAX_MAKEUP_GAIN) : 1;
    await save(`${base}_mix.wav`, encode(mix, gain, 'mix'));
    for (const [i, layer] of stems.entries()) {
      status.textContent = `Rendering stem: ${LAYER_LABELS[layer]}…`;
      const buffer = await renderCue(snapshot, events, {
        layers: [layer],
        onProgress: f => (progress.value = (i + 1 + f) / jobs),
      });
      await save(`${base}_${layer}.wav`, encode(buffer, gain, LAYER_LABELS[layer]));
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    status.textContent =
      `Rendered ${saved.length} file${saved.length === 1 ? '' : 's'} in ${secs} s ` +
      `(peak normalised to -1 dBFS, ${(20 * Math.log10(gain)).toFixed(1)} dB gain). ` +
      `Timestamped at ${tc(snapshot.points.start)}.`;
    note('info', 'rendered', { files: saved, peak, gain });
  } catch (err) {
    status.textContent = `Render failed: ${err.message}`;
    console.error(err);
  } finally {
    button.disabled = false;
    progress.hidden = true;
  }
}

// ---------------------------------------------------------------- keyboard, loop

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 5000);
}

document.addEventListener('pointerdown', () => player.unlock(), { capture: true });
document.addEventListener('keydown', e => {
  player.unlock();
  const typing = e.target.closest('input:not([type="checkbox"]):not([type="range"]), select, textarea');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const frame = rate().den / rate().num;
  if (e.key === ' ') {
    e.preventDefault();
    transport.toggle();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (e.target.matches('input[type="range"]')) return;
    e.preventDefault();
    transport.seek(snapToFrame(transport.time, rate()) + (e.key === 'ArrowLeft' ? -frame : frame));
  } else if (e.key === 'Home') {
    e.preventDefault();
    transport.seek(doc.points.start);
  }
});

function phaseAt(t) {
  const p = doc.points;
  if (t < p.start) return 'before the cue';
  if (t >= p.end) return 'after the cue';
  const name = t < p.build ? 'Intro' : t < p.hit ? 'Build' : t < p.tail ? 'Climax' : 'Tail';
  const bar = Math.floor((t - p.start) / result.tempo.barDur) + 1;
  return `${name} · bar ${bar}`;
}

let lastPhase = '';
function frameLoop() {
  const t = transport.time;
  const label = tc(t);
  $('#tc').textContent = label;
  $('#tc-overlay').textContent = label;
  const phase = phaseAt(t);
  if (phase !== lastPhase) $('#phase-now').textContent = lastPhase = phase;
  $('#play').textContent = transport.playing ? 'Pause' : 'Play';
  if (!transport.hasVideo && transport.playing && t >= transport.duration) transport.pause();
  timeline.setPlayhead(t);
  requestAnimationFrame(frameLoop);
}

buildControls();
syncControls();
changed();
if (doc.video.name) toast(`Restored your last session. Re-open the video "${doc.video.name}" to see picture.`);
requestAnimationFrame(frameLoop);
