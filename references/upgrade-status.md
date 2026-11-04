# AI有谱: implemented behavior and limits

The current package is a **V2.1 local release candidate**. V1.2.0 and V2.0 notes below describe earlier releases; their names are retained as history rather than current delivery labels.

## Implemented

- Separate symbolic notation identity, written occurrences and a monotone piecewise performance map; explicit playback order, voice/hand assignment and real layout coordinates. Preserve rests, chord members, accidentals as encoded by checked XML, ties and slurs. No guessed accompaniment or automatic filling.
- Evidence-bound original-source coverage inventory and explicit excerpt mapping. This checks declared scope, not OCR correctness or pitch correspondence.
- Unapproved review worksheet with original source, original audio, all written notes and separately entered observations. Candidate-only worksheets retain null final map identity and an unresolved blocker.
- Formal audible jobs recompute full human content/time review, source scope where needed, and all input hashes. No approval from three onsets, DTW, a passed summary or an Agent-generated review. Freeze underlying evidence and reachable code. A local JSON declaration is not identity authentication.
- Configuration confirmation, first-four direction review plus full-song risk positions, portrait/landscape presets, grand-staff-centered dynamic pivot, Smoothstep system changes, paper/dark/custom backgrounds, palette indicators, title and avatar layering. Existing default rendering is retained when aspect is omitted.
- Decoded output/master audio preservation check. This tests transport, not musical correctness.

## Partially implemented / experimental

- Local NumPy/FFmpeg pitch/chroma DTW plus short-window attack candidates and a monotone attack edit path. It proposes segment/note timing, retains coarse DTW separately, and exposes unmatched score/audio attacks. It can misalign repeats, soft attacks, legato or dense chords. All results remain needs_review.
- Pitch ranking and per-measure spectral costs help locate doubts. They miss some octave errors and cannot reliably identify absent or additional chord members. Do not convert ranking into calibrated confidence, precision or recall.
- Explicit unfolding and manual anchors handle known repeats/tempo drift. Recognition of the correct repeat occurrence or an unknown arrangement remains a review task.

## Not implemented

Automatic calibrated polyphonic transcription, reliable automatic arrangement identity, automatic PDF note truth, independently measured pedal/note-off recovery, or automatic production approval. An imported XML or a synthesized reference is not independent evidence of correctness against PDF/MP3.

## Unconfirmed without a real annotated reference

Real-song pitch/structure recall, false-positive rate and P95 alignment error. Controlled generated signals can test algorithms and gates but cannot establish those real-recording metrics. Keep missing results not_measured; never count abstention or gate rejection as successful detection.

Release 1.2.0 introduced these checks. Existing component defaults are retained; new formal exports require the current configuration, time-map and quality evidence. No private song media, annotations, fonts or personal avatars belong in the portable package.

## Visual and strip additions since V1.2.0

Four presets resolve to plain scene props with no personal character overlays. New configuration records bind the resolved camera and motion styles. Existing direct camera calls preserve defaults. The score-strip command requires supplied measured system bounds, source hashes and notehead mapping; it preserves original engraving and timing. It does not automatically recognize notes, unfold repeats, join separate page files or certify audio alignment. Engineering tests and approved visual review do not replace musical content/time review for a new song.
