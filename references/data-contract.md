# Timeline and scene contract

All times are **frames**, potentially fractional for attacks. `fps` is positive; `durationInFrames` is an integer. Frame bounds: `0 <= frame < durationInFrames`. Each hand's events must be strictly increasing; group same-hand simultaneous notes in a single `notes` array. Do not retrigger tied continuations. `hand` is `left` or `right`.

```json
{"fps":30,"durationInFrames":180,"scoreWidth":1600,"scoreHeight":900,"status":"needs_review","events":[{"hand":"right","frame":8,"x":200,"y":150,"notes":[{"x":200,"y":150,"pitch":"C5"}]}]}
```

`x`, `y`, `notes[].x/y` are finite coordinates using the SAME layout as the SVG. Normally they fall within scoreWidth/scoreHeight; the importer warns on overflow and preserves coordinates to support intentional cropped layouts. In the legacy visual API pitch strings were informational; Checked songs require valid pitches and explicit durationFrames. A chord's event x/y chooses its moving head target; notes lists every highlighted notehead. Upstream preparation is responsible for selecting the target and preserving rests as timing gaps. The timeline retains written tie-stop heads with attack:false; only the sounding timeline omits renewed tie attacks. Original core suppresses travel to a new row if `next.x < current.x-200` or `abs(next.y-current.y)>200`; tail discontinuity guards also remain unchanged. Do not silently alter this source behavior.

Optional `cameraPath` is one `{cameraX,cameraY}` sample per frame. Otherwise the scene uses the original melodic X following equation and configurable rotation/scale. A new score's line transitions may need its own reviewed cameraPath. The demo deliberately exercises the original discontinuity behavior, not automatic score-aware camera planning.

`scoreImage` maps SVG pixels into timeline space with `x/y/width/height`; default is full score dimensions. Do not mix coordinates from different engravers or a new layout revision. `camera` transforms the score and BOTH effect instances together. Its `follow:false,left,top` produces fixed placement; defaults: `scale:1.5,rotateZ:-15,rotateX:38`. No personal assets are implied by these visual defaults.

`rightStyle/leftStyle` expose all original component props: arcHeight, trailFrames, highlightFrames, holdHighlightUntilNext, color, coreColor, glowColor, glowStrength, starburst, trailWidth, taperTrail. Width/height and absolute positioning stay shared with the score. Scene defaults use original full-score treatment (right purple, left orange, glow 1.2, trail 16); original ScoreNoteLeap defaults are unchanged.

Composition fps/duration must match timeline. A `--props` JSON may contain timeline directly (not its filename), scoreSrc/audioSrc public-relative paths, title/subtitle/label/credit, background/fontFamily, scoreImage/camera, vignette/showProgress/fadeFrames and overlay. Overlay needs `enabled:true,src` and optionally `kind:'image'|'video',loopFrames,transparent,width,height,right,bottom`; default is off, videos muted. Keep private files outside the Skill folder.

Structural validity is not proof of correct score recognition, hand assignment, ties, exact coordinates, ownership or audio alignment. A real performance needs start/middle/end listening and measured synchronization checks. Preserve `needs_review` until such checks pass.

When input is not already a matched SVG/timeline, follow [material preparation](material-preparation.md). Agent-native tools and executable adapters share this same final contract. Recognized source symbols are not yet SVG coordinates; MIDI note timestamps are not automatically proof of alignment to a separate MP3. Keep occurrence IDs/layout mappings and nominal-versus-performance timing in the user's intermediate preparation report. Do not invent a second hand for a single-voice source.

## Musical semantics

Each written note needs a stable id, pitch, durationFrames, explicit part/staff/voice, optional tieStart/tieStop, slurs [{id,type}] and beams. `music-from-check` produces these from structural MusicXML plus an actual-engraver placement/hand map. `music` compiles soundingStartFrame/soundingEndFrame, attack and per-segment highlightEndFrame. Ties merge same-pitch spans; slurs keep distinct pitches and a short overlap in the optional harmonic synth. Beam membership is never a tie. Unclosed/gapped chains block the checked workflow.

Geometry may change without changing music identity. Use props.presentation.cameraPath for new camera samples, leaving musical evidence stable. Changed musical timing needs renewed score approval; changed presentation needs renewed keyframe approval. Approval/job files are local, version-bound evidence, not portable paths or cryptographic human authentication.

The original ScoreNoteLeap leap, trail and camera equations remain; optional sustain metadata extends highlight behavior. AiyoupuScoreScene and Aiyoupu remain unchanged. See [geometry and rendering workflow](rendering.md) for native SVG measurements, review responses and unsupported notation cases.
