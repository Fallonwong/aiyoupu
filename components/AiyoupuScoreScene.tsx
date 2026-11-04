import React from 'react';
import {portraitRunwayPose, portraitRunwayNoteStyle, portraitRunwayScoreFilter, type ScoreCameraMode, type RunwayCameraOptions} from './ScoreCameraPresets';
import {SunsetOcean} from './SunsetOcean';
import {DeepSapphire} from './DeepSapphire';
import type {ScoreSurfaceTexture, ScorePipelineMode, ScoreTypographyHud} from './ScoreVideoConfig';
import {AbsoluteFill, Audio, Img, Loop, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {depthPreset,themePreset,dimensions,type AspectRatio,type ScoreTheme} from './AiyoupuPresentation';
import {ScoreNoteLeap, type ScoreAttack, type ScoreNoteLeapProps} from './ScoreNoteLeap';

export type AiyoupuTimeline = {
  fps: number; durationInFrames: number; scoreWidth: number; scoreHeight: number;
  events: (ScoreAttack & {hand: 'left' | 'right'})[];
  cameraPath?: {cameraX: number; cameraY: number}[];
  focusPath?: {focusX:number;focusY:number}[];
  systemBands?: {centerY:number;top:number;bottom:number}[];
  systemBounds?: {top:number;bottom:number;left?:number;right?:number}[];
  status?: string;
};
export type AiyoupuScoreSceneProps = {
  aspectRatio?:AspectRatio; theme?:ScoreTheme; backgroundSrc?:string;
  timeline: AiyoupuTimeline; scoreSrc: string; audioSrc?: string;
  title?: string; subtitle?: string; label?: string; credit?: string;
  background?: string; fontFamily?: string;
  backgroundScene?: 'sunset-ocean' | 'deep-sapphire' | 'none';
  texture?: ScoreSurfaceTexture; pipeline?: ScorePipelineMode; typographyStyle?: ScoreTypographyHud['style']; chineseTitle?: string; titleScale?: number;
  scoreImage?: {x?: number; y?: number; width?: number; height?: number; filter?:string; blendMode?: React.CSSProperties['mixBlendMode']};
  cameraMode?: ScoreCameraMode; runwayCamera?: RunwayCameraOptions;
  camera?: {scale?: number; rotateZ?: number; rotateX?: number; anchorX?: number; anchorY?: number; follow?: boolean; left?: number; top?: number};
  rightStyle?: Partial<ScoreNoteLeapProps>; leftStyle?: Partial<ScoreNoteLeapProps>;
  /** Workbench-only mute: timeline animation still runs, audio is not mounted. */
  disableAudio?:boolean;
  vignette?: boolean; showProgress?: boolean; fadeFrames?: number;
  overlay?: {enabled?: boolean; src?: string; kind?: 'image' | 'video'; loopFrames?: number; transparent?: boolean; width?: number; height?: number; right?: number; bottom?: number};
};
/** Extracted shared score/camera/glow/layout from the existing full-score composition.
 * All asset paths are public-relative. The score and both hands share ONE transform.
 */
export const AiyoupuScoreScene: React.FC<AiyoupuScoreSceneProps> = ({
  aspectRatio, theme, backgroundSrc, backgroundScene, texture, pipeline, typographyStyle, chineseTitle, titleScale=1, timeline, scoreSrc, audioSrc, title='', subtitle='', label='', credit='', background='#6b6561', fontFamily='Arial, sans-serif',
  scoreImage={}, camera={}, cameraMode='classic', runwayCamera={}, rightStyle={}, leftStyle={}, vignette=true, showProgress=true, fadeFrames=8, overlay, disableAudio=false,
}) => {
  const frame = useCurrentFrame();
  const {width, height, fps, durationInFrames} = useVideoConfig();
  if (timeline.fps !== fps || timeline.durationInFrames !== durationInFrames) throw new Error('Composition fps/duration must equal timeline metadata');
  const D = durationInFrames;
  const modern=aspectRatio!==undefined;
  const aspect=aspectRatio??'16:9', preset={...depthPreset(aspect)}, palette=themePreset(theme??'slate');
  if(cameraMode==='portrait-focus')preset.tiltX=36;
  if(cameraMode==='portrait-classic'){preset.tiltX=0;preset.tiltZ=0;preset.perspective=1400;}
  if((cameraMode==='portrait-focus'||cameraMode==='portrait-classic')&&(!modern||aspect!=='9:16'))throw new Error('PORTRAIT_REQUIRES_EXPLICIT_9_16');
  if(cameraMode==='landscape-classic'&&(!modern||aspect!=='16:9'))throw new Error('LANDSCAPE_REQUIRES_EXPLICIT_16_9');
  if(pipeline&&(pipeline==='score-strip')!==(cameraMode==='portrait-runway'))throw new Error('PIPELINE_CAMERA_MISMATCH');
  const textureStyle=texture==='black-multiply'?{blend:'multiply' as const,filter:'none'}:texture==='metallic-screen'?{blend:'screen' as const,filter:'invert(0.92) hue-rotate(180deg) contrast(1.25)'}:undefined;
  if(modern&&(width!==dimensions(aspect).width||height!==dimensions(aspect).height))throw new Error('ASPECT_DIMENSIONS_MISMATCH');
  if(modern&&(!timeline.focusPath||timeline.focusPath.length!==D||timeline.focusPath.some(p=>!Number.isFinite(p.focusX)||!Number.isFinite(p.focusY))))throw new Error('FOCUS_PATH_REQUIRED: derive a path from actual layout and mapped performance times');
  if(cameraMode==='portrait-runway'&&(!modern||aspect!=='9:16'))throw new Error('RUNWAY_REQUIRES_EXPLICIT_9_16');
  const measuredFocus=timeline.focusPath?.[frame];
  const runway=cameraMode==='portrait-runway'?portraitRunwayPose(frame,measuredFocus!,runwayCamera):null;
  const focus=runway??measuredFocus;
  const notePreset=runway?portraitRunwayNoteStyle():{};
  const surface=modern?(theme==='custom'?background:palette.background):background;
  const rightGlow=rightStyle.glowColor??'#b895ff',leftGlow=leftStyle.glowColor??'#E95514';
  const rightColor=rightStyle.color??(modern?rightGlow:'#181045'),leftColor=leftStyle.color??'#E95514';
  const uiText=backgroundScene==='sunset-ocean'?'#fff8f0':(modern?palette.text:'#f3eaff');
  const fadeN = Math.min(Math.max(1, fadeFrames), (D-1)/2);
  const fade = interpolate(frame,[0,fadeN,D-fadeN,D],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const melody = timeline.events.filter(e=>e.hand==='right');
  const bass = timeline.events.filter(e=>e.hand==='left');
  const scale = camera.scale ?? (modern?(runway?.scale??preset.scale):1.5);
  const z = camera.rotateZ ?? (modern?(runway?.rotateZ??preset.tiltZ):-15);
  const rx = camera.rotateX ?? (modern?(runway?.rotateX??preset.tiltX):38);
  const track = melody.length ? melody : bass;
  const followX = track.length>1 ? interpolate(frame,track.map(e=>e.frame),track.map(e=>e.x),{extrapolateLeft:'clamp',extrapolateRight:'clamp'}) : (track[0]?.x ?? 0);
  const tilt = z*Math.PI/180;
  const path = timeline.cameraPath?.[Math.max(0,Math.min(Math.floor(frame),timeline.cameraPath.length-1))];
  const cameraX = modern?preset.targetScreenX-focus!.focusX:path?.cameraX ?? (camera.follow===false ? camera.left??0 : (camera.anchorX??width*760/1920)-followX*scale*Math.cos(tilt));
  const cameraY = modern?preset.targetScreenY-focus!.focusY:path?.cameraY ?? (camera.follow===false ? camera.top??0 : (camera.anchorY??height*400/1080)-followX*scale*Math.sin(tilt));
  const uiScale = modern&&aspect==='9:16'?.72:Math.min(width/1920,height/1080);
  const ipLoopFrames=overlay?.loopFrames;
  if (overlay?.enabled && !overlay.src) throw new Error('Enabled overlay requires an explicitly supplied asset');
  if (overlay?.enabled && overlay.loopFrames !== undefined && (!Number.isInteger(overlay.loopFrames) || overlay.loopFrames < 1)) throw new Error('overlay.loopFrames must be a positive integer');
  const overlayContent = overlay?.enabled && overlay.src ? (overlay.kind==='image'
    ? <Img src={staticFile(overlay.src)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>
    : <OffthreadVideo src={staticFile(overlay.src)} transparent={overlay.transparent??false} muted style={{width:'100%',height:'100%'}}/>) : null;
  return <AbsoluteFill style={{background:surface,overflow:'hidden'}}>
    {backgroundScene==='sunset-ocean'&&<SunsetOcean width={width} height={height}/>}
    {backgroundScene==='deep-sapphire'&&<DeepSapphire width={width} height={height}/>}
    {modern&&backgroundSrc&&<Img src={staticFile(backgroundSrc)} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/>}
    {audioSrc&&!disableAudio&&<Audio src={staticFile(audioSrc)} volume={modern?1:f=>interpolate(f,[Math.max(0,D-6),D],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}/>}
    <div style={modern?{position:'absolute',inset:0,perspective:runway?.perspective??preset.perspective,perspectiveOrigin:'50% 50%',zIndex:10,mixBlendMode:texture?(texture==='black-multiply'?undefined:'screen'):(theme==='custom'?'screen':undefined)}:{display:'contents'}}>
    <div style={{position:'absolute',left:cameraX,top:cameraY,width:timeline.scoreWidth,height:timeline.scoreHeight,transformOrigin:modern?`${focus!.focusX}px ${focus!.focusY}px`:'0 0',transformStyle:modern?'preserve-3d':undefined,transform:runway?`rotateZ(${z}deg) rotateY(${runway.rotateY}deg) rotateX(${rx}deg) scale(${scale}) scaleX(${runway.stretchX})`:`rotateZ(${z}deg) rotateX(${rx}deg) scale(${scale})`}}>
      {!modern&&<div style={{position:'absolute',left:-3000,top:-3000,width:Math.max(8000,timeline.scoreWidth+6000),height:Math.max(16000,timeline.scoreHeight+6000),background:surface}}/>}
      <div style={modern?{position:'absolute',inset:0,background:texture?(texture==='black-multiply'?surface:'#000000'):(runway?'#eae2d8':(theme==='custom'?'#000000':surface)),isolation:'isolate',transformStyle:'flat',boxShadow:runway&&!texture?'22px 30px 50px rgba(0,0,0,0.65), 0 0 1px rgba(0,0,0,.4)':undefined,borderRadius:runway?6:undefined,maskImage:runway&&!texture?'linear-gradient(to right, black 86%, rgba(0,0,0,0.4) 94%, transparent 100%)':undefined}:{display:'contents'}}>
      <Img src={staticFile(scoreSrc)} style={{position:'absolute',left:scoreImage.x??0,top:scoreImage.y??0,width:scoreImage.width??timeline.scoreWidth,height:scoreImage.height??timeline.scoreHeight,mixBlendMode:scoreImage.blendMode??textureStyle?.blend??(modern?palette.blend:'multiply'),filter:scoreImage.filter??textureStyle?.filter??(runway?portraitRunwayScoreFilter():(modern?palette.filter:undefined))}}/>
      <ScoreNoteLeap events={melody} color={rightColor} coreColor="#fff6ff" glowColor="#b895ff" glowStrength={1.2} trailFrames={16} {...notePreset} {...rightStyle} width={timeline.scoreWidth} height={timeline.scoreHeight} style={{...rightStyle.style,position:'absolute',inset:0}}/>
      <ScoreNoteLeap events={bass} color={leftColor} coreColor="#fff5db" glowColor="#ff9a46" glowStrength={1.2} arcHeight={34} trailFrames={16} {...notePreset} {...leftStyle} width={timeline.scoreWidth} height={timeline.scoreHeight} style={{...leftStyle.style,position:'absolute',inset:0}}/>
      </div>
    </div>
    </div>
    {vignette&&!modern&&<><AbsoluteFill style={{background:'radial-gradient(ellipse at 45% 52%,transparent 30%,rgba(58,50,68,.35) 70%,rgba(30,26,38,.7) 100%)',pointerEvents:'none'}}/><AbsoluteFill style={{background:'radial-gradient(ellipse at 100% 100%,rgba(0,0,0,.55) 0%,rgba(0,0,0,.24) 34%,transparent 72%)',pointerEvents:'none'}}/></>}
    <div style={{position:'absolute',left:110*uiScale,top:85*uiScale,opacity:fade,zIndex:modern?300:200,fontFamily:modern?'\"Bodoni MT\", Didot, Georgia, serif':fontFamily,color:uiText,textShadow:'0 2px 14px rgba(20,12,36,.5)'}}>
      <div style={{fontSize:17*uiScale,letterSpacing:6*uiScale,color:modern?uiText:'#d8cfe4'}}>{label}</div>
      <div style={{fontStyle:typographyStyle==='chinese-2x'?'normal':modern?'italic':undefined,fontSize:(typographyStyle==='chinese-2x'?208:104)*uiScale*titleScale,maxWidth:width-180*uiScale,overflowWrap:'anywhere',letterSpacing:3*uiScale,marginTop:16*uiScale,lineHeight:1,fontFamily:typographyStyle==='chinese-2x'?'"Alimama ShuHeiTi Bold", Arial, sans-serif':typographyStyle==='clean'?'Arial, sans-serif':undefined}}>{chineseTitle??title}</div>
      <div style={{fontFamily:typographyStyle==='chinese-2x'?'"Bodoni MT", Didot, Georgia, serif':modern?'\"Alimama ShuHeiTi Bold\", Arial, sans-serif':'Georgia, serif',fontStyle:typographyStyle==='chinese-2x'?'italic':undefined,fontSize:23*uiScale,color:modern?uiText:'#d9d0dd',marginTop:12*uiScale}}>{subtitle}</div>
    </div>
    {showProgress&&<div style={{position:'absolute',left:110*uiScale,right:170*uiScale,bottom:62*uiScale,zIndex:150,pointerEvents:'none'}}>
      <div style={{display:'flex',alignItems:'center',gap:36*uiScale,marginBottom:22*uiScale,opacity:fade}}>
        {(['TREBLE','BASS'] as const).map((text,i)=><span key={text} style={{display:'inline-flex',alignItems:'center',gap:10*uiScale,fontFamily:'Arial, sans-serif',fontSize:17*uiScale,fontWeight:600,letterSpacing:3*uiScale,color:modern?uiText:'#efe9f4'}}><span style={{width:12*uiScale,height:12*uiScale,borderRadius:'50%',background:modern?(i?leftGlow:rightGlow):(i?'#E95514':'#b895ff'),boxShadow:`0 0 8px ${modern?(i?leftGlow:rightGlow):(i?'#E95514':'#b895ff')}`}}/>{text}</span>)}
      </div>
      <div style={{position:'relative',height:2,background:'rgba(255,255,255,.16)',borderRadius:1}}><div style={{position:'absolute',left:0,top:0,height:2,width:`${frame/D*100}%`,background:modern?`linear-gradient(90deg,${rightGlow},${leftGlow})`:'linear-gradient(90deg,#b895ff,#E95514)',borderRadius:1}}/></div>
    </div>}
    {overlayContent&&<div style={{position:'absolute',right:overlay?.right??24*uiScale,bottom:overlay?.bottom??85*uiScale,width:overlay?.width??220*uiScale,height:overlay?.height??220*uiScale,zIndex:modern?400:100}}>{ipLoopFrames?<Loop durationInFrames={ipLoopFrames}>{overlayContent}</Loop>:overlayContent}</div>}
    {credit&&<div style={{position:'absolute',right:24*uiScale,bottom:48*uiScale,fontFamily,fontSize:21*uiScale,fontWeight:600,color:modern?uiText:'#eee7df',textShadow:'0 2px 8px #000'}}>{credit}</div>}
  </AbsoluteFill>;
};
