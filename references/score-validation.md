> V1.0.0 补充：[音源生产与识谱修订](workflow.md)。新 bind 需要 --audio-evidence，PDF/图片 score-request 需要 --notation-audit；旧 synthesize 示例仅用于 --preview-only 校谱草稿。


# Score validation and source comparison

This is a separate evidence pipeline. It does not modify the renderer/core or infer optical recognition, hand assignment, notehead coordinates, repeat expansion, or audio synchronization. `structuralPassed` and `visualReview` are independent. A successful `check` always leaves visual review pending.

## Stable controller interface

```powershell
node scripts/score.mjs capabilities --out NEW_DIR --python PYTHON_EXE
node scripts/score.mjs check --musicxml FILE --out NEW_DIR [--python PYTHON_EXE]
node scripts/score.mjs source --source PDF_OR_IMAGE --out NEW_DIR [--python PYTHON_EXE]
node scripts/score.mjs source --source PDF_OR_IMAGE --out NEW_DIR --omr EXECUTABLE --adapter aiyoupu-omr/v1 [--python PYTHON_EXE]
node scripts/score.mjs source --source PDF_OR_IMAGE --out NEW_DIR --omr-module ENTRY_POINT_NAME [--python PYTHON_EXE]
node scripts/score.mjs compare --source PDF_OR_IMAGE --musicxml FILE --svg FILE --timeline FILE --layout PDF_OR_IMAGE --out NEW_DIR [--mapping FILE] [--review FILE] [--layout-evidence FILE] [--pdftoppm EXECUTABLE] [--python PYTHON_EXE]
```

Python precedence is explicit `--python`, then `AIYOUPU_SCORE_PYTHON`, then the shared `environment.mjs` `discoverEnvironment`. Automatic selection considers only actually probed existing Python 3.10+ interpreters and skips Windows Store aliases. For `compare`/`source`, the chosen interpreter must also pass a real isolated Pillow import/image-operation probe, not just module presence. `check` uses stdlib only. Optional `--project ROOT` and repeatable `--authorized-project ROOT` are consumed only by discovery and stripped before Python invocation; they do not install, copy or modify projects. Results include `pythonSelection` with executable, method and Pillow requirement. The CLI never creates an environment or installs packages. PDF rasterization additionally needs installed Poppler `pdftoppm` (`--pdftoppm` also works with `source`). No executable command strings or shell interpolation are accepted. Output directories must be new. A pre-existing directory is not changed, including its old report.

Stdout is one JSON object, also written to `NEW_DIR/report.json` after output creation. Every result contains `code`, `status`, and actionable `next`. Exit codes:

| Exit | Meaning |
| --- | --- |
| 0 | Capability report, or all comparison gates explicitly satisfied (`reviewed`). This is not overall product/render/audio completion. |
| 2 | Invalid structural input, malformed arguments, stale evidence, missing crop dependencies, or tool/protocol failure. |
| 3 | `needs_review`: valid structure awaiting review; unavailable OMR; missing crops; unresolved differences; missing same-run layout evidence. |

Input/tool failures remain JSON and produce error reports where possible. Python startup failures are reported by the Node wrapper as `PYTHON_UNAVAILABLE`; non-JSON interpreter output becomes `PYTHON_PROTOCOL_ERROR`. Normal invocations have a 180-second wrapper timeout; adapters and PDF rasterization have 120-second subprocess timeouts.

## MusicXML checks

Only uncompressed UTF-8 `score-partwise` MusicXML is supported. Namespaces are normalized for querying. Entity declarations and UTF-16 are rejected. External DTDs are not fetched. MXL/timewise conversion must happen explicitly upstream. This is an inspector of the supported musical semantics, not full XSD validation.

`measures` contains every part/measure in document order. Stable identity is `PART_ID:ONE_BASED_ORDINAL`; printed measure numbers may repeat. Every measure and note retains `rawXml`, including unsupported notation. Event positions and durations are exact rational strings in quarter-note units. `backup` and `forward` are retained. Chord notes share the preceding onset and do not advance the counter; voices and rests are not collapsed.

Checks include part declarations, pitch step/alter/octave, A0–C8 piano range warnings, fractional alterations, positive divisions/duration, additive/composite meters, written type/dots/tuplet versus performed duration, rests, chord adjacency/duration, voice/staff declarations and staff bounds, negative cursor, same-voice overlaps, tie pitch/voice continuity, slur/tuplet start-stop pairing, unclosed spans, pickup/short/overfull measures, grace timing, repeats/endings/jumps and special attributes. Sound `tie` and visual `tied` differences are surfaced. Intended versus notated duration differences are review issues rather than silently corrected durations; see [MusicXML duration semantics](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/) and [chord semantics](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/).

`hand` remains `null`. MusicXML staff 1/2 or treble/bass does not prove right/left hand. Missing voices/staves/hands are reported, never inferred from pitch. The controller must obtain explicit hand/timeline declarations separately. The original XML remains available for key/clef/transposition/engraving details; the inspector does not rewrite or normalize the music. Complex repeats, cross-voice spans, polymetric/nonstandard notation, and incomplete excerpts may require expert interpretation or an explicit upstream correction. A structural failure never gets turned into success through visual review.

## OMR adapter contract

`source` first validates the source (PDF is actually rasterized, image is decoded), and preserves original bytes. It discovers installed module names (`audiveris`, `homr`, `oemer`), registered entry points, and `AIYOUPU_OMR_ADAPTER`. A module being importable does not prove a usable CLI; raw vendor executables are never invoked with guessed arguments. No professional OMR adapter available means `OMR_UNAVAILABLE`, exit 3, no transcribed MusicXML, and actionable integration instructions. MuseScore is an engraver and is not counted as OMR.

Explicit `--omr EXE` requires `--adapter aiyoupu-omr/v1`. The environment variable `AIYOUPU_OMR_ADAPTER` means an already configured executable implementing this exact protocol. Invocation (no shell):

```text
EXE --protocol aiyoupu-omr/v1 --source ABSOLUTE_INPUT --out ABSOLUTE_ADAPTER_DIR
```

The adapter must use a real installed professional OMR engine, write MusicXML inside the supplied directory, return zero, and emit exactly one JSON response:

```json
{
  "protocol": "aiyoupu-omr/v1",
  "status": "transcribed",
  "sourceSha256": "SHA256_OF_EXACT_SOURCE_BYTES",
  "engine": {"name": "actual professional engine", "version": "verified version"},
  "musicxml": "result.musicxml"
}
```

No package-specific adapter is bundled or asserted to work. Integrators verify their engine's real interface and wrap it, without auto-installation. An environment-provided Python module can register an `importlib.metadata` entry point in group `aiyoupu.omr`; `--omr-module NAME` loads only that registered entry point. Its callable receives `{protocol, source, sourceSha256, out}` and returns the same response object. Registration and explicit selection constitute trust in that integration. The engine's claims are not independently authenticated by this script.

Requests, adapter responses, stdout/stderr, and structural checks are saved. `OMR_TRANSCRIBED_UNREVIEWED` is only a transcription result. It always remains `needs_review`, including when structural checks pass. Bad output paths, stale source hashes, invalid response formats, and failing exits are rejected.

## Agent-assisted measure comparison

Start `compare` with real source, MusicXML, SVG, timeline and an image/PDF of the re-engraved score. Missing mapping is allowed: it creates one pending row per measure, `mapping.json`, `review-template.json`, `layout-evidence.json`, page PNGs, original inputs and readable `comparison.html`. The Agent can then produce crops from known layout positions. If positions cannot be established, keep them pending. There is no general-purpose automatic measure detector and no automatic pixel similarity verdict.

The HTML includes a page viewer. Select measure/side/page and click two corners to define a crop. Export `mapping.json` and rerun into a new output directory. Coordinates refer to generated raster pixels (PDF: 120 dpi); no original PDF point coordinates or arbitrary viewport coordinates are substituted.

```json
{
  "schema": "aiyoupu-score-mapping/v1",
  "bindings": {
    "sourceSha256": "...", "musicxmlSha256": "...", "svgSha256": "...",
    "timelineSha256": "...", "layoutSha256": "..."
  },
  "measures": [
    {"id": "P1:1", "source": {"page": 1, "rect": [40, 70, 510, 178]},
     "layout": {"page": 1, "rect": [80, 200, 700, 300]}},
    {"id": "P1:2", "source": null, "layout": null}
  ]
}
```

The rectangles above are illustrative, not universal. Mapping must list every measure exactly once in XML order, including separate parts. Each crop is real image content with bounds validation; whole-page placeholders are not inferred to be measure mappings. Multi-frame images require explicit conversion to separate pages. Missing crops remain pending. Agent-supplied mapping is still subject to human visual inspection; the tool cannot authenticate semantic crop correctness.

The producer of SVG and timeline must also supply evidence that both belong to the same layout operation. The controller-facing evidence format is:

```json
{
  "schema": "aiyoupu-score-layout/v1",
  "runId": "unique-id-of-one-layout-job",
  "producer": "actual producer and version",
  "sameRun": true,
  "bindings": {
    "sourceSha256": "...", "musicxmlSha256": "...", "svgSha256": "...",
    "timelineSha256": "...", "layoutSha256": "..."
  }
}
```

All five hashes are computed over exact bytes. The comparison CLI verifies this declaration and those hashes, but cannot reconstruct or independently certify a producer's run history. The report returns `runId` (otherwise null) and preserves the producer sidecar as `layout-evidence.json`. The controller can require the same run id in its own notehead-mapping evidence, alongside the current SVG/timeline hashes and all visual review gates. The template emitted without producer evidence has `sameRun:false` and is pending. Do not fill it with `sameRun:true` merely because files happen to exist. The controller/producer should emit it during the actual shared layout run. Missing evidence prevents `reviewed`; mismatching supplied evidence is a hard `STALE_LAYOUT_EVIDENCE` failure. This sidecar needs no core change.

After supplying actual mapping and actual producer evidence, rerun `compare` and use the cropped comparison page. Human review can select `pending`, `difference`, or `approved`, add reviewer and a note resolving differences, and export `review.json`. Alternatively fill the generated template. Rerun with `--mapping`, `--layout-evidence` and `--review`:

```json
{
  "schema": "aiyoupu-score-review/v1",
  "bindings": {"sourceSha256": "...", "musicxmlSha256": "...", "svgSha256": "...", "timelineSha256": "...", "layoutSha256": "..."},
  "mappingSha256": "canonical mapping hash from report/template",
  "layoutEvidenceSha256": "canonical producer evidence hash from template",
  "measures": [{
    "id": "P1:1", "status": "approved", "reviewer": "actual reviewer",
    "note": "What was compared and how observed differences were resolved",
    "cropSha256": {"source": "exact generated crop hash", "layout": "exact generated crop hash"}
  }]
}
```

JSON canonical hashes use Python `json.dumps(sort_keys=True,separators=(',',':'),ensure_ascii=False)` UTF-8. Use the generated template rather than independently recreating canonicalization. Crop byte hashes also protect against rasterizer/image decoding changes. Changing source, XML, SVG, timeline, reflow image/PDF, mapping, producer evidence or crop bytes invalidates old approvals. Missing review rows stay pending; unknown/duplicate ids fail. An unresolved `difference` can never pass. Changing a decision to approved requires a reviewer and a nonempty resolution note; the software cannot verify the identity or truth of a human assertion.

`SCORE_REVIEW_APPROVED` / `reviewed` requires structural success, all real crops, all per-measure approvals and valid producer evidence. It is not a complete renderer/audio gate. `timeline.json` is only checked as a JSON object and hash-bound here; the existing timeline validator must separately validate its musical/coordinate contract. Actual same-layout coordinates and musical synchronization are checked separately.
