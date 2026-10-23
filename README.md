# Cue Maker

Rule-based sketching and rendering of film music cues, scored to picture.
Mark out the Intro, Build, Hit, Tail and End against a proxy video, explore
variations, then render a 48 kHz / 24-bit WAV (and optional stems).

Everything runs in the browser on the user's own machine. Video and audio
never leave it.

## Running locally

No install step and no dependencies; you just need Node.

```sh
npm start            # or: node serve.mjs [port]
```

Then `npm run chrome`, which opens a separate Chrome window with a new, empty
profile each time, so you see a first run with no autosave or granted
permissions, as a new user would (or open <http://127.0.0.1:8000/> yourself). Chrome is
the supported browser for now: it can save projects and renders straight into
a chosen folder, and drag and drop of Final Cut's `.fcpxmld` package has only
been designed for it. Safari (`npm run safari`) is untested. Opening
`index.html` directly as a `file://` URL will not work.

```sh
npm test             # logic, file formats and a simulated Web Audio run
```

## Workflow with Final Cut Pro

1. In Final Cut, put markers on the timeline where the cue should start, start
   building, hit, start its tail, and end. Naming them `Intro`, `Build`, `Hit`,
   `Tail`, `End` makes the mapping explicit; unnamed markers are used in order.
2. **File > Export XML…** Recent versions of Final Cut save a `.fcpxmld`
   bundle; Cue Maker reads the `Info.fcpxml` inside it for you.
3. Export a proxy of the same timeline as **H.264** (Chrome can't play
   ProRes).
4. In Cue Maker, drop the proxy on the video window and the `.fcpxmld` (or
   `.fcpxml`, or a `.zip` of either, as mail programs send them) on the XML
   panel beside it; both together works too. The XML
   panel shrinks to a tick once markers are loaded (hover it for details),
   and also sets the frame rate and start timecode.
5. Markers show as blue triangles on the timeline ruler. If the guess from
   their names or order is wrong (leftover clip markers often get in the
   way), click a marker and choose which phase point it should be. Points it
   passes are pushed along, keeping their spacing, so they stay in order.

Rendered WAVs carry a Broadcast WAV time reference for the cue's start, so
tools that honour it (Pro Tools, Logic and others) can spot them to timecode.

## How it fits together

| File | Role |
| --- | --- |
| `src/generator.js` | The compositional rules. A pure function from the project document to timed events. Tempo is fitted so the hit lands on a downbeat. Style is a point among three reference composers; see [docs/style-space.md](docs/style-space.md). |
| `src/stylepad.js` | The style pad: drag a point towards Satie, Ravel or Jóhannsson, or past one to exaggerate them. |
| `src/instruments.js` | Web Audio synthesis for each event type, shared by sketch and final render; `QUALITY` sets the difference. |
| `src/sketch.js` | Real-time playback slaved to the video, using a look-ahead scheduler with drift correction. |
| `src/render.js` | Final render through `OfflineAudioContext` at 48 kHz. |
| `src/wav.js` | 16/24-bit WAV with TPDF dither and a `bext` chunk. |
| `src/fcpxml.js` | Reads markers from FCPXML and maps them to phase points. |
| `src/unzip.js` | Pulls the FCPXML out of a zipped `.fcpxmld` (as sent by email). |
| `src/timecode.js` | Rational frame rates, drop-frame timecode. |
| `src/transport.js` | One clock: the video, or an internal clock when there's no picture. |
| `src/timeline.js` | The canvas timeline and its interactions. |
| `src/project.js` | The saved project format and its versioning. |
| `src/main.js` | UI wiring, files, rendering, bug reports. |

Everything random is seeded per layer (`harmony`, `tune`, `pulse`, `perc`,
`electronics`, `surprise`), and each choice is keyed by its bar's position
counted back from the hit, so a project file reproduces a cue exactly and small
edits make small changes. **Sweet / sour** sets how many of the surprise
seed's surprises are let in. **New variation**
re-rolls the unlocked layers.

## Reporting problems

**Bug report** in the toolbar downloads a JSON file with the project, app
version, browser and audio details, and recent errors. Since generation is
deterministic, that's enough to reproduce what was heard.

## Deploying to GitHub Pages

The repository root is the site; there's no build step. After pushing, enable
Pages for the `main` branch, serving from `/ (root)`. `.nojekyll` stops GitHub
from processing the files.

## Known limits (v0.2)

- Constant fitted tempo; no accelerando through the build yet.
- FCPXML: retimed clips and secondary-storyline offsets aren't handled.
- Instrument levels and the synthetic reverb are first guesses, to be tuned by ear.
- The piano is a soft electric-piano stand-in, not a real piano sound. A real piano would mean a better synthesiser, licensed samples or the user's own recordings.
- The key is fixed at D.
- Peak normalisation is sample-peak to −1 dBFS, not true-peak or loudness.
