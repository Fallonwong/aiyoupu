> V1.0.0 补充：[音源生产与识谱修订](workflow.md)。新 bind 需要 --audio-evidence，PDF/图片 score-request 需要 --notation-audit；旧 synthesize 示例仅用于 --preview-only 校谱草稿。


# Portable piano asset import

For new song work use `aiyoupu-legacy.mjs prepare`, then the [review/alignment/bind workflow](rendering.md). The importer is a structural transport layer; imported does not mean score-approved or audio-verified. `--pdf <file>` records a PDF source for the preparation adapter or explicit incomplete handoff; it does not perform built-in OMR.

For missing standard data, use the [Agent material-preparation workflow](material-preparation.md) first. It covers MusicXML, MIDI, SVG, MP3, staff images and jianpu images, reusing available Agent tools instead of mandating a complete CLI suite. A script's incomplete status is an Agent handoff, not a requirement that the user write a timeline manually.

Requires Node.js 18 or newer. Uses built-in modules only; no npm install, Python,
Remotion upgrade, or CLI installation. Copy the complete Skill to another computer,
or copy the complete `scripts/` directory for import-only use.
The full Remotion workflow requires Node.js >=20. Replace `<skill>` with the
actual Skill root; quote paths with spaces.

```powershell
node <skill>/scripts/prepare.mjs --svg "C:/inputs/score.svg" --timeline "C:/inputs/timeline.json" --audio "C:/inputs/performance.mp3" --midi "C:/inputs/score.mid" --musicxml "C:/inputs/score.musicxml" --out "C:/project/public/score/my-piece"
```

Image source inputs are also accepted: `--score-image <staff.png>` and `--jianpu-image <jianpu.jpg>`. These check file existence and pass source paths to an explicit adapter, or return a capability handoff for Agent-native processing. They do not implement built-in image decoding/recognition and do not replace the required final SVG/timeline. Without an adapter, no output bundle is created until those assets exist. With complete standard assets, image paths may be supplied for context; originals stay at their source paths and are not copied to the final bundle. One file is accepted per flag; process multi-page sources with Agent tools before final import.

`--out` names the final slug directory, not the public root. It must not already
exist. Paths containing spaces are supported. The tool writes fixed filenames:
`score.svg`, `timeline.json`, optional `audio.mp3`, `score.mid`, `score.musicxml`,
`timed-notes.json`, and `manifest.json`. Manifest asset paths are relative to the
bundle, so the bundle remains relocatable. Under a project's `public/score/my-piece`
the browser paths are `score/my-piece/score.svg`, etc., usable with `staticFile()`.

Timeline validation is deliberately stricter than the draft Python validator:

- Positive finite `fps`, `scoreWidth` (or `width` alias), `scoreHeight`;
  positive safe integer `durationInFrames`. Both width fields must agree if present.
- Nonempty `events`; each event has `hand: left|right`, finite `frame/x/y` and a
  nonempty `notes` array with finite `x/y`. Optional `pitch` must be a string.
- Frames may be fractional but must satisfy `0 <= frame < durationInFrames`.
  Each hand's events must strictly increase. Both hands may attack at the same
  frame. A chord in one hand must be one event containing all noteheads in `notes`;
  duplicate same-hand frames are rejected, not silently merged.
- Non-finite numbers anywhere in JSON are rejected, including overflow `1e999`;
  JSON syntax such as literal `NaN`/`Infinity` is also rejected.
- Out-of-dimension coordinates generate warnings, since SVG viewBox origins and
  transforms can vary. Coordinates and attacks are never manufactured or moved.
  Unknown timeline metadata and the supplied `status` are retained. `width` is
  normalized by adding `scoreWidth`; no other timeline data is transformed.

SVG and uncompressed MusicXML receive root-element sanity checks only. This is
not a complete XML parser, an SVG renderer, an audio decoder, or independent
certification of supplied `verified` claims. MP3 is an opaque byte copy; it is
never transcribed. MusicXML is copied, **not converted to beat events** in this
bounded implementation. Compressed `.mxl` must first be unpacked externally.

Optional MIDI export supports synchronous SMF format 0/1 with PPQN division,
running status, velocity-zero note releases and tempo changes across tracks.
The default tempo is 500000 microseconds per quarter. `timed-notes.json` records
ticks, seconds, MIDI pitch, velocity, channel and track. Tempo integration occurs
at both note endpoints, including notes spanning changes. Sustain-pedal extension,
SMPTE, format 2, cross-track attack/release pairs, and conflicting tempo changes
at one tick are not supported. Overlapping equal pitches within a track are
paired FIFO. Malformed or unsupported supplied MIDI fails the import explicitly.
There is no automatic hand assignment, layout mapping or MP3 alignment.

Exit codes: **0** imported with structural validation, **2** invalid arguments,
invalid supplied inputs or preprocessor failure, **3** incomplete due to missing
SVG/timeline. Machine-readable reports use stdout for 0/3 and stderr for 2.
Imports report `status: imported`, `validation: structural_only`; this does not
claim musical accuracy, synchronization, successful rendering or final delivery.

## Explicit external preprocessor

When SVG or timeline is omitted, the importer searches **PATH only** for common
MuseScore, Audiveris and Verovio executable names. Detection does not execute them
or establish conversion capability. Without an explicit preprocessor the importer
returns `incomplete`, missing assets and discovered paths; it installs nothing.
Installed GUI applications outside PATH may therefore not be discovered.

```powershell
node <skill>/scripts/prepare.mjs --midi "C:/inputs/score.mid" --preprocessor "C:/tools/my-score-adapter.exe" --out "C:/project/public/score/my-piece"
```

The adapter receives the exact argument vector:

```text
<executable> --out <scratch-directory> [--svg <absolute-input>] [--timeline <absolute-input>] [--audio <absolute-input>] [--midi <absolute-input>] [--musicxml <absolute-input>]
  [--score-image <absolute-input>] [--jianpu-image <absolute-input>]
```

It must return exit 0 and write `score.svg` and/or `timeline.json` for the omitted
resources into the scratch directory. Explicit inputs take precedence. Both
resources must use the same rendering layout and already established coordinates.
An adapter must report any uncertain musical timing using `needs_review` or
`needs_audio_alignment`. The importer never upgrades this status. Tool success
without required outputs fails explicitly. Only recognized assets are published;
extra adapter files are discarded. The adapter is an explicitly trusted executable
with normal user privileges, **not sandboxed by the importer**. Shell command
strings and Windows `.cmd`/`.bat` launchers are not supported. Timeout: 120 seconds;
captured stdout/stderr combined limit: 1 MiB. A normal CLI generally needs an adapter
to implement this protocol; passing MuseScore directly is not sufficient.

Failed validation produces no destination bundle. Staging is cleaned on handled
failures; an abrupt process termination can leave `.aiyoupu-prepare-*` scratch files
or a partial newly reserved destination. A new destination is reserved exclusively
before publication; an existing destination is never merged or overwritten.

## Fixtures and checks

Fixtures are an original tiny SVG, its matching coordinate timeline, and a separate
one-note MusicXML example. Tests generate synthetic SMF data and a metadata-only
MP3 byte-copy fixture, **not a playable recording**. These verify importing and
failure behavior; they are not evidence of recognition or musical performance.
All preprocessing test outputs stay in `<skill>/scripts/.test-run-*`. Run those
tests from a writable Skill copy. The separate doctor tests write to the OS
temporary directory. Optional preprocessor
integration uses a tiny local native fixture (Windows C# compiler if present,
otherwise an executable Node shebang on POSIX). No third-party dependency is needed
by production scripts. Tests preserve their generated evidence for inspection.
