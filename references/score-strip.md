# 多行谱面转连续长谱

`score-strip` rearranges already measured notation for the existing B2
`portrait-runway` camera. It translates/crops the original SVG glyphs, transforms
note coordinates and creates one `focusPath` sample per frame. The camera still
rotates the horizontal data strip into the established depth view; this command
does not introduce a new camera, recognize music, or fit audio timing.

## Inputs and command

Use one self-contained SVG with `viewBox="0 0 scoreWidth scoreHeight"`, its
coordinate-matched timeline and a complete geometry `layout.json` with source
hashes and `{eventIndex,noteIndex,svgId,x,y}` mappings. Every notehead must have a
unique SVG ID supplied by the engraving/mapping preparation. Each event needs
`systemId` (legacy `sys` is accepted). Do not guess bounds or note assignments.

Supply a measured system packet:

```json
{
  "schema": "aiyoupu-strip-systems/v1",
  "scoreSha256": "SHA256 of source SVG bytes",
  "timelineSha256": "hashObject(source timeline) from scripts/audio.mjs",
  "systems": [
    {"id": 0, "x": 0, "y": 0, "width": 1600, "height": 400, "centerY": 210},
    {"id": 1, "x": 0, "y": 400, "width": 1600, "height": 400, "centerY": 610}
  ]
}
```

Bounds are in the same SVG coordinate space as the timeline. `centerY` is the
measured midpoint of the grand staff, not the current melody note. Include stems,
beams, slurs, accidentals and ledger lines inside each crop. Crops cannot overlap.
The array determines left-to-right reading order. Numbers above are illustrative,
not default geometry for a song.

```text
node <skill>/scripts/aiyoupu-legacy.mjs score-strip --svg <source.svg> --timeline <timeline.json> --layout <layout.json> --systems <systems.json> --project <existing-remotion-project> --browser <existing-Chrome-executable> --out <new-directory> --scale 1 --gap 0
```

No dependencies/browser are installed. The output directory must be new. Existing
input files remain untouched. Scale must be positive; gap is nonnegative output
pixels. All rows share a grand-staff center after placement.

## Outputs and use

- `score-strip.svg`: original engraving cloned into clipped, translated viewports;
  IDs and local paint references are namespaced per system.
- `timeline.json`: converted event/note coordinates, dimensions, systems and
  continuous `focusPath`. Original event frames, pitches, durations and musical
  fields are preserved. Old `cameraPath` is replaced by the new focus path.
- `layout.json`: source-bound output mapping, independently remeasured in Chromium,
  compatible with the existing native geometry validation path.
- `strip-evidence.json`: source/output hashes, placement and limitations; never a
  fabricated user approval.

Use these three corresponding SVG/timeline/layout files together. Pass the new
timeline and SVG to `resolveScoreVideoConfig(SCORE_PRESETS.SapphireRunway(...),
{timeline, scoreSrc, pipeline:'score-strip', ...})`. Keep the original recording
and audio timing. Freeze/rebind the changed layout and show actual frames and a
short motion preview before full export. Existing score/keyframe approvals are
not automatically copied into a new job.

## Boundaries

Supports one normalized SVG containing multiple systems with explicit mapping.
Multiple separate page files and backward/repeated system traversal need an
already unfolded, mapped score first. The tool rejects conflicting simultaneous
systems, incomplete mappings, stale hashes, overlapping crops, cropped mapped
noteheads, external resources and unsupported SVG stylesheet/active elements.
Plain paths, inline attributes, local definitions and fragment references are
supported. It does not automatically detect staff lines or remove repeated clefs,
titles or margins, redraw staff connections, or repair notation.

The head geometry checks cannot prove that a crop preserved every slur/beam/label.
Review each join visually. Retained system margins can leave a gap between staff
segments; adjust measured crop bounds only after confirming notation clearance.
Constant centerY and continuously interpolated focusX provide depth tracking with
the existing camera; a horizontal strip file alone is not visual approval.

Regression command (synthetic, no human approval):

```text
node <skill>/scripts/score-strip.test.mjs <project> <existing-Chrome-executable> <new-evidence-directory>
```
