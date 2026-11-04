import type {AiyoupuScoreSceneProps, AiyoupuTimeline} from './AiyoupuScoreScene';
import {OFFICIAL_HAND_PALETTE, type ScoreVideoConfig} from './ScoreVideoConfig';

export type ScoreVideoAssets = {
  timeline: AiyoupuTimeline;
  scoreSrc: string;
  audioSrc?: string;
  /** Declare the supplied geometry; this resolver never generates a strip. */
  pipeline: ScoreVideoConfig['pipeline'];
};

/** Resolve once, persist these plain JSON props, then bind/review that exact file. */
export function resolveScoreVideoConfig(config: ScoreVideoConfig, assets: ScoreVideoAssets): AiyoupuScoreSceneProps {
  const {aspectRatio, cameraMode, theme, texture, motionFx, typography, pipeline} = config;
  if (!['9:16','16:9'].includes(aspectRatio) ||
      !['portrait-focus','portrait-runway','landscape-classic'].includes(cameraMode) ||
      !['slate-gray','obsidian-dark','deep-sapphire'].includes(theme) ||
      !['black-multiply','metallic-screen'].includes(texture) ||
      config.avatar !== 'none' ||
      !['chinese-2x','bodoni-royal','clean'].includes(typography.style)) throw new Error('INVALID_VIDEO_CONFIG');
  if ((cameraMode === 'landscape-classic') !== (aspectRatio === '16:9')) throw new Error('CAMERA_ASPECT_MISMATCH');
  if (!['full-score','score-strip'].includes(pipeline) || assets.pipeline !== pipeline ||
      (cameraMode === 'portrait-runway') !== (pipeline === 'score-strip')) throw new Error('PIPELINE_CAMERA_MISMATCH');
  if (!assets.scoreSrc || !Number.isFinite(assets.timeline.fps) || assets.timeline.fps <= 0) throw new Error('INVALID_VIDEO_ASSETS');
  if (!Number.isInteger(motionFx.trailFrames) || motionFx.trailFrames<0 || motionFx.rippleFrames<0||!Number.isInteger(motionFx.rippleFrames) ||
      [motionFx.rippleOpacity,motionFx.inactiveNoteOpacity].some(n=>!Number.isFinite(n)||n<0||n>1) ||
      [motionFx.taperTrail,motionFx.followChordNotes,motionFx.rippleRing,typography.showStatusBar].some(v=>typeof v!=='boolean')) throw new Error('INVALID_MOTION_CONFIG');
  if (motionFx.rippleRing || motionFx.rippleOpacity!==0) throw new Error('RIPPLE_RETIRED');
  const expectedColors = {
    rightColor:OFFICIAL_HAND_PALETTE.right.color,rightGlow:OFFICIAL_HAND_PALETTE.right.glow,rightCore:OFFICIAL_HAND_PALETTE.right.core,
    leftColor:OFFICIAL_HAND_PALETTE.left.color,leftGlow:OFFICIAL_HAND_PALETTE.left.glow,leftCore:OFFICIAL_HAND_PALETTE.left.core,
  };
  for (const [key,value] of Object.entries(config.handColors??{})) {
    if (typeof value !== 'string' || value.toLowerCase() !== expectedColors[key as keyof typeof expectedColors]?.toLowerCase()) throw new Error('STANDARD_PALETTE_REQUIRED');
  }
  const style = (hand: 'right'|'left') => ({
    ...motionFx, color:OFFICIAL_HAND_PALETTE[hand].color,
    glowColor:OFFICIAL_HAND_PALETTE[hand].glow, coreColor:OFFICIAL_HAND_PALETTE[hand].core,
    rippleColor:OFFICIAL_HAND_PALETTE[hand].color,
    holdHighlightUntilNext:false, trailWidth:2, glowStrength:1.25,
    highlightFrames:10, starburst:false, pulseOnly:motionFx.trailFrames===0,
  });
  return {
    timeline:assets.timeline,scoreSrc:assets.scoreSrc,...(assets.audioSrc?{audioSrc:assets.audioSrc}:{}),
    aspectRatio,cameraMode,theme,texture,pipeline,typographyStyle:typography.style,
    ...(cameraMode==='portrait-runway'?{runwayCamera:{introFrames:75,leadIn:-55,startScale:1.18,settledScale:1.18,scaleMultiplier:1.25,stretchX:1.45}}:{}),
    title:typography.title,chineseTitle:typography.chineseTitle,subtitle:typography.subtitle,
    showProgress:typography.showStatusBar,vignette:false,
    backgroundScene:theme==='deep-sapphire'?'deep-sapphire':'none',
    rightStyle:{...style('right'),arcHeight:58},leftStyle:{...style('left'),arcHeight:44},
    overlay:{enabled:false},
  };
}
