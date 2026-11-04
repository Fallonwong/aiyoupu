# Visual configuration (V2.1 candidate)

Grounded in the 2026-10-24 decision: 14 kept options, 12 dropped. Retired choices remain readable in old jobs but are rejected for new presets.

V2.1 candidate provides the following portable configuration. Use `SCORE_PRESETS` from
`components/ScoreVideoConfig.ts` and `resolveScoreVideoConfig` from
`components/resolveScoreVideoConfig.ts`. The resolver returns ordinary
`AiyoupuScoreScene` props: serialize those resolved props before the existing bind,
keyframes and render workflow. Do not bind a wrapper whose settings differ from
the JSON reviewed by the user.

## Confirm only missing choices

Offer these choices before parsing/rendering a new song; reuse actual choices
already supplied. Recommendations are not consent.

| Section | Recommended / available |
|---|---|
| Aspect | **9:16**; 16:9 |
| Camera | portrait-focus; portrait-runway; landscape-classic |
| Theme | **slate-gray**; obsidian-dark; deep-sapphire |
| Surface | **black-multiply**; metallic-screen |
| Hand colors | right #b895ff / left #E95514; standard for new presets |
| Motion | **converge-arc**: 14-frame tapered trail, chord split/merge, right 58 / left 44 px arcs, no starburst or ground ripple, inactive highlight opacity 0. Alternative pulse-only: no air trail, notehead breathing only. |
| Character overlay | none; all portable presets disable overlays |
| Typography | chinese-2x; bodoni-royal; clean; optional status/progress bar |
| Pipeline | full-score for focus/classic; supplied score-strip for runway |

Preset factories return independent mutable FX objects; modifying one preset
does not change future presets. New presets do not include the discarded 62-degree camera, cyan/magenta hand palette, nebula/parchment themes, white-invert surface, or ground ripple rings. Existing low-level props and old jobs remain
compatible. Do not force these choices onto explicitly requested different work.

| Factory | Aspect / camera | Theme / surface | Avatar |
|---|---|---|---|
| SlateClassic | 9:16 / portrait-focus | slate-gray / black-multiply | none |
| SapphireRunway | 9:16 / portrait-runway | deep-sapphire / metallic-screen | none |
| ObsidianFocus | 9:16 / portrait-focus | obsidian-dark / metallic-screen | none |
| SapphireLandscape | 16:9 / landscape-classic | deep-sapphire / metallic-screen | none |

## Resolved scene example

```tsx
import {SCORE_PRESETS} from './animations/score/ScoreVideoConfig';
import {resolveScoreVideoConfig} from './animations/score/resolveScoreVideoConfig';
// approvedTimeline contains the actual measured per-frame focusPath.
const config = SCORE_PRESETS.SlateClassic('曲目名', 'Piano Study');
config.avatar = 'none'; // Only when this is the user's actual choice.
const props = resolveScoreVideoConfig(config, {
  timeline: approvedTimeline,
  scoreSrc: 'score/my-song/score.svg',
  audioSrc: 'score/my-song/audio.wav',
  pipeline: 'full-score',
});
// Save JSON.stringify(props), then bind that file. Render AiyoupuScoreScene.
```

All portable presets set `avatar: 'none'` and resolve to `overlay: {enabled:false}`.
No personal character, asset path, duration, aspect ratio or video special case is part of the Skill. Generic overlays remain a low-level explicit API for separately authorized assets.

## Configuration record

Keep `aiyoupu-production/v2` and the real `confirmationQuote` / `messageRef`.
For new presets, include `visual` with `cameraMode`, `texture`, `pipeline`,
`typographyStyle`, `showProgress`, and `motionFx` from the selected config.
Set `rightColor='#b895ff'`, `leftColor='#E95514'`; these are the main colors,
while glow/core colors are separate. `validateProduction(record, resolvedProps)`
checks the new visual choices and FX. Historical records without `visual`
continue to compare their original glow-color fields. Never invent user approval
for diagnostics. Inspect `production-check` output as configuration validation,
not song correctness or visual acceptance.

## Compatibility and boundaries

- `classic` keeps its original defaults. `landscape-classic` selects that modern
  16:9 behavior; `portrait-focus` uses tiltX 36, tiltZ -7, scale 1.18 and (540,960).
  `portrait-classic` remains a legacy flat portrait option, not a new recommendation.
- Old theme names remain accepted. `slate-gray` matches `slate`; the new parchment
  is #f5ede0 while historical `parchment` retains its old color. No silent rewrites.
- New texture props explicitly control filters and blending. Inverted textures
  include a black-point contrast adjustment so white SVG paper does not leave a
  gray rectangle. Supply neutral white or transparent score backgrounds; colored
  scanned paper needs its own reviewed surface preparation. Star backgrounds are
  self-contained deterministic components. Set resolved `backgroundScene='none'`
  to disable atmosphere; freeze and review the resulting props.
- The dynamic pivot, not every tilted note, has depth zero. All score geometry,
  highlights and trails share one transform. Check both staves and late systems.
- Runway requires an already prepared, verified continuous SVG and matching
  timeline/focusPath. Declaring `pipeline='score-strip'` does not create or verify
  one. Use [score-strip](score-strip.md) to prepare a strip from measured system bounds and source geometry.
- `ScoreCosmicRunway`'s independent procedural scene is not bundled as a substitute
  for native notation. No per-song timing repair scripts are included.
- The status bar uses the hand palette and progress. It is not an audio activity
  detector or a measure counter. Inactive opacity applies to note highlights;
  the current held note and moving trail retain their original sustain behavior.
- chinese-2x doubles the title size and uses the Chinese font stack with fallback.
  Test long titles; fonts are not downloaded automatically.

## Review

Keep both existing review stops: actual notation approval, then actual keyframes
and audition approval. Inspect first four reviewed bars plus later risk positions:
both staves, chord split/merge, rests/ties, line transitions, final systems, long
titles, and avatar clearance. Title zIndex 300 / avatar 400; masks cannot cover
active notes. A synthetic style render is engineering evidence only. Preserve
16:9 historical geometry, palette and defaults when no new props are selected.

## Real-song layout profile

The new runway resolver explicitly chooses a 75-frame lead-in of -55 score pixels,
start/settled scale 1.18, scaleMultiplier 1.25 and stretchX 1.45. These are selectable
layout starting points validated on the real-song review, not an auto-fit guarantee
for every score. The score and both hands share the same transform. Existing direct
`portraitRunwayPose()` calls retain the original 120-frame .90-to-1.18 behavior.

Chinese titles are upright; the Bodoni subtitle may be italic. New motion styles
use trailWidth 2, glowStrength 1.25, highlightFrames 10, starburst false and
holdHighlightUntilNext false, with right/left arcHeight 58/44. `pulse-only` now
explicitly sets pulseOnly true, hiding air trails and moving light cores.

When recording the selected visual configuration, also include the resolved
`runwayCamera` and `rightStyle`/`leftStyle` inside visual. The validator compares
those values to the final persisted props. User approval is still required for
the actual frames and audition.
