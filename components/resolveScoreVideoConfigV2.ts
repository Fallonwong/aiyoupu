import {resolveScoreVideoConfig as legacyResolve, type ScoreVideoAssets} from './resolveScoreVideoConfig';
import {OFFICIAL_HAND_PALETTE, CONVERGE_ARC_MOTION_FX, type ScoreVideoConfig} from './ScoreVideoConfig';
import {TEACHING_LANDSCAPE_SINGLE_SYSTEM_SCALE,type TeachingLandscapeConfig} from './ScoreVideoConfigV2';
import type {AiyoupuScoreSceneProps} from './AiyoupuScoreSceneV2';
import {smoothTeachingFocusPath,teachingFocusPath,teachingSystemBands,teachingDefaultScale} from './TeachingFocusV2';

export function resolveScoreVideoConfig(config:ScoreVideoConfig|TeachingLandscapeConfig,assets:ScoreVideoAssets):AiyoupuScoreSceneProps {
  if (!('preset' in config) || config.preset!=='TeachingLandscape') return legacyResolve(config as ScoreVideoConfig,assets);
  if(config.aspectRatio!=='16:9'||config.cameraMode!=='landscape-classic'||config.theme!=='pure-white'||
    config.texture!=='black-multiply'||config.pipeline!=='full-score'||assets.pipeline!=='full-score'||
    config.avatar!=='none'||config.typography.style!=='clean'||!assets.scoreSrc||config.motionFx.trailFrames!==14) throw Error('INVALID_TEACHING_CONFIG');
  legacyResolve({...config,theme:'slate-gray'},assets); // Reuse palette and invariant checks.
  // Staff centers are geometry evidence, never a hard-coded song coordinate.
  const focus=assets.timeline.focusPath;
  if(!focus?.length||focus.length!==assets.timeline.durationInFrames||focus.some(p=>!Number.isFinite(p.focusX)||!Number.isFinite(p.focusY))) throw Error('TEACHING_STAFF_MIDPOINT_REQUIRED');
  const focusPath=smoothTeachingFocusPath(teachingFocusPath(assets.timeline,focus[0].focusY),24);
  const timeline={...assets.timeline,focusPath,systemBands:teachingSystemBands(focusPath,assets.timeline.scoreHeight)};
  const multiSystem=timeline.focusPath.some(p=>Math.abs(p.focusY-timeline.focusPath[0].focusY)>1e-6);
  const userScale=(config as TeachingLandscapeConfig & {cameraScale?:number}).cameraScale;
  const hand=(h:'left'|'right')=>({...CONVERGE_ARC_MOTION_FX,arcHeight:h==='right'?58:44,trailWidth:2,glowStrength:1.25,pulseOnly:false,holdHighlightUntilNext:false,highlightFrames:10,trailFrames:14,
    followChordNotes:true,inactiveNoteOpacity:0,starburst:false,rippleRing:false,rippleFrames:0,rippleOpacity:0,
    color:OFFICIAL_HAND_PALETTE[h].color,glowColor:OFFICIAL_HAND_PALETTE[h].glow,coreColor:OFFICIAL_HAND_PALETTE[h].core});
  return {visualPreset:'TeachingLandscape',timeline,scoreSrc:assets.scoreSrc,...(assets.audioSrc?{audioSrc:assets.audioSrc}:{}),
    aspectRatio:'16:9',cameraMode:'landscape-classic',theme:'pure-white',texture:'black-multiply',pipeline:'full-score',
    typographyStyle:'clean',title:config.typography.title,chineseTitle:config.typography.chineseTitle,
    subtitle:config.typography.subtitle,camera:{rotateX:0,rotateZ:0,scale:Number.isFinite(userScale)?Number(userScale):multiSystem?teachingDefaultScale(timeline):TEACHING_LANDSCAPE_SINGLE_SYSTEM_SCALE},
    rightStyle:hand('right'),leftStyle:hand('left'),showProgress:config.typography.showStatusBar,
    vignette:false,backgroundScene:'none',overlay:{enabled:false}};
}
