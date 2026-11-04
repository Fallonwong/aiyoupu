import React from 'react';
import {AbsoluteFill,Audio,Img,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import {AiyoupuScoreScene as LegacyScene,type AiyoupuScoreSceneProps as LegacySceneProps} from './AiyoupuScoreScene';
import {ScoreNoteLeap} from './ScoreNoteLeap';
export type {AiyoupuTimeline} from './AiyoupuScoreScene';
export type AiyoupuScoreSceneProps=LegacySceneProps & {visualPreset?:'TeachingLandscape'};

/** Only the explicitly selected teaching combination takes the new flat path. */
export const AiyoupuScoreScene:React.FC<AiyoupuScoreSceneProps>=(props)=>{
  if(props.visualPreset!=='TeachingLandscape') return <LegacyScene {...props}/>;
  return <TeachingScene {...props}/>;
};
/** Keep the last engraved system on screen after its final attack. The measured
 * camera path may stop before the final frame, so hold the destination rather
 * than falling back to the empty top-left of the page. */
const teachingFrameFocus=(timeline:LegacySceneProps['timeline'],frame:number,fallback:{focusX:number;focusY:number})=>{
  const path=timeline.focusPath;if(!path?.length)return fallback;
  const at=path[Math.max(0,Math.min(path.length-1,frame))];return at??path[path.length-1];
};
const TeachingScene:React.FC<AiyoupuScoreSceneProps>=(props)=>{
  const frame=useCurrentFrame(),{width,height,fps,durationInFrames}=useVideoConfig();
  const {timeline,scoreSrc,audioSrc,title='',chineseTitle,subtitle='',label='',showProgress=true}=props;
  const focus=teachingFrameFocus(timeline,frame,{focusX:0,focusY:0});
  if(width!==1920||height!==1080||timeline.fps!==fps||timeline.durationInFrames!==durationInFrames||props.theme!=='pure-white'||props.typographyStyle!=='clean'||props.cameraMode!=='landscape-classic'||
    props.aspectRatio!=='16:9'||props.pipeline!=='full-score'||props.texture!=='black-multiply'||
    !Number.isFinite(props.camera?.scale)||(props.camera?.scale??0)<0.5||(props.camera?.scale??0)>5||props.camera?.rotateX!==0||props.camera?.rotateZ!==0||!focus||
    !timeline.focusPath||timeline.focusPath.length!==durationInFrames||timeline.focusPath.some(p=>!Number.isFinite(p.focusX)||!Number.isFinite(p.focusY))||props.overlay?.enabled||props.backgroundSrc) throw Error('TEACHING_PRESENTATION_MISMATCH');
  // The title is a persistent teaching label and remains readable throughout,
  // including the final bar.
  const opacity=1;
  const multiSystem=timeline.focusPath.some(p=>Math.abs(p.focusY-timeline.focusPath![0].focusY)>1e-6);
  // Keep one current system in view with room for the persistent title and the
  // transport. The focus comes from measured geometry; only its screen anchor
  // changes. The active row is centred in the remaining stage so the same
  // framing holds from the first bar through the final bar.
  const titleFont=multiSystem?56:104;
  const titleTop=multiSystem?32:85;
  const stageTop=multiSystem?126:0,stageBottom=multiSystem?96:0;
  const scoreScale=props.camera?.scale??2.8;
  // At a large teaching zoom the score is wider than the stage. Clamp its
  // horizontal focal point so reading never drifts off the engraved page at
  // either end of a line.
  // Use the stage's available width. The permanent title band occupies the
  // top of multi-system teaching, so centring against the raw 1920 canvas would
  // push the left brace off screen at either end of a staff.
  const halfW=960/scoreScale;
  // A multi-row score is read one system at a time. The adjacent measured rows
  // were fitted with a white gap, so a dissolve does not need a hard crop that
  // could cut through the grand staff.
  const focusPath=timeline.focusPath!;
  let transitionStart=frame,transitionEnd=frame;
  if(multiSystem){
    while(transitionStart>0&&Math.abs(focusPath[transitionStart].focusY-focusPath[transitionStart-1].focusY)>1e-6)transitionStart--;
    while(transitionEnd+1<focusPath.length&&Math.abs(focusPath[transitionEnd+1].focusY-focusPath[transitionEnd].focusY)>1e-6)transitionEnd++;
  }
  // A row change is measured with a small tolerance so subpixel differences in
  // the prepared path do not keep the last frame in a transition forever.
  const movingRow=(a:{focusY:number},b:{focusY:number})=>Math.abs(a.focusY-b.focusY)>=.5;
  if(multiSystem){
    while(transitionStart>0&&movingRow(focusPath[transitionStart],focusPath[transitionStart-1]))transitionStart--;
    while(transitionEnd+1<focusPath.length&&movingRow(focusPath[transitionEnd+1],focusPath[transitionEnd]))transitionEnd++;
  }
  const inTransition=multiSystem&&transitionEnd>transitionStart;
  const previousFocus=inTransition?focusPath[Math.max(0,transitionStart-1)]:focus;
  const nextFocus=inTransition?focusPath[Math.min(focusPath.length-1,transitionEnd+1)]:focus;
  const bands=timeline.systemBands??[];
  const bandFor=(y:number)=>bands.length?bands.reduce((best,band)=>Math.abs(band.centerY-y)<Math.abs(best.centerY-y)?band:best):null;
  // Each reading band is isolated to its own engraved system. At a boundary the
  // outgoing and incoming bands meet edge to edge, so the score advances to the
  // next row without scrolling through the page gap or showing a white flash.
  const rawProgress=inTransition?(frame-transitionStart+1)/(transitionEnd-transitionStart+2):1;
  const incoming=!inTransition||rawProgress>=.5;
  const scoreLayer=(key:string,layerFocus:{focusX:number;focusY:number},layerOpacity:number,showNotes:boolean)=>{
    // Horizontal panning stays inside one engraved system. The page margins
    // inside the SVG are part of the readable staff, so derive the bounds from
    // the system's notes rather than the nominal full-page width.
    const band=bandFor(layerFocus.focusY);
    const rowEvents=timeline.events.filter(e=>band
      ?e.notes?.some(n=>n.y>=band.top&&n.y<band.bottom)
      :Math.abs(e.y-layerFocus.focusY)<350);
    const noteYs=rowEvents.flatMap(e=>(e.notes??[e]).map(n=>n.y));
    // Smooth the measured horizontal steps within this row. Never average
    // across the return to the next row's left edge.
    const samples=inTransition?[layerFocus]:focusPath.slice(Math.max(0,frame-3),frame+4)
      .filter(p=>Math.abs(p.focusY-layerFocus.focusY)<1e-6&&Math.abs(p.focusX-layerFocus.focusX)<200);
    const constrained=samples.reduce((sum,p)=>sum+p.focusX,0)/samples.length;
    const layerX=timeline.scoreWidth>halfW*2?Math.max(halfW,Math.min(timeline.scoreWidth-halfW,constrained)):timeline.scoreWidth/2;
    // The score already lives inside a stage offset by stageTop. Its anchor
    // must use stage-local coordinates; adding stageTop again clips the bass.
    const stageHeight=height-stageTop-stageBottom;
    // A chord's average Y can hide its lowest ledger note. Keep all actual
    // noteheads inside the stage, with a gutter for their outlines/ledger lines.
    const engraving=timeline.systemBounds?.[band?bands.indexOf(band):0];
    const rowMin=engraving?.top??(noteYs.length?Math.min(...noteYs):layerFocus.focusY);
    const rowMax=engraving?.bottom??(noteYs.length?Math.max(...noteYs):layerFocus.focusY);
    const minFocus=rowMax+16-stageHeight/(2*scoreScale);
    const maxFocus=rowMin-16+stageHeight/(2*scoreScale);
    const viewY=multiSystem?(minFocus<=maxFocus
      ?Math.max(minFocus,Math.min(maxFocus,layerFocus.focusY))
      :(rowMin+rowMax)/2):layerFocus.focusY;
    const layerTop=stageHeight/2-viewY;
    // Isolate the measured engraving, including stems, ledger lines and
    // dynamics. Do not crop from chord centres or cover music with white masks.
    const clipTop=Math.max(0,stageHeight/2+(rowMin-16-viewY)*scoreScale);
    const clipBottom=Math.max(0,stageHeight/2-(rowMax+16-viewY)*scoreScale);
    return <div key={key} aria-hidden={key==='previous'} style={{position:'absolute',inset:0,opacity:layerOpacity,
      clipPath:multiSystem&&engraving?`inset(${clipTop}px 0 ${clipBottom}px 0)`:undefined}}>
      <div style={{position:'absolute',left:960-layerX,top:layerTop,width:timeline.scoreWidth,height:timeline.scoreHeight,
        transformOrigin:`${layerX}px ${viewY}px`,transform:`scale(${scoreScale})`,zIndex:10}}>
        <Img src={staticFile(scoreSrc)} style={{position:'absolute',inset:0,width:timeline.scoreWidth,height:timeline.scoreHeight,mixBlendMode:'multiply',objectFit:'fill',objectPosition:'0 0'}}/>
        {showNotes&&(['right','left'] as const).map(hand=><ScoreNoteLeap key={hand} {...(hand==='right'?props.rightStyle:props.leftStyle)}
          events={timeline.events.filter(e=>e.hand===hand)} width={timeline.scoreWidth} height={timeline.scoreHeight}
          color={hand==='right'?'#b895ff':'#E95514'} followChordNotes starburst={false} rippleRing={false} inactiveNoteOpacity={0} pulseOnly={false} style={{position:'absolute',inset:0}}/>)}
      </div>
    </div>;
  };
  return <AbsoluteFill style={{background:'#ffffff',overflow:'hidden',color:'#171717',fontFamily:'Arial, "Microsoft YaHei", sans-serif'}}>
    {audioSrc&&!props.disableAudio&&<Audio src={staticFile(audioSrc)}/>}
    <div style={{position:'absolute',left:0,right:0,top:stageTop,bottom:stageBottom,overflow:'hidden',zIndex:10}}>
      {scoreLayer('current',inTransition?nextFocus:focus,incoming?1:0,incoming)}
      {inTransition&&!incoming&&scoreLayer('previous',previousFocus,1,true)}
    </div>
    <div style={{position:'absolute',left:96,top:titleTop,zIndex:300,opacity,padding:'0 18px 4px',right:96}}>
      <div style={{fontSize:17,letterSpacing:4}}>{label}</div>
      <div style={{fontSize:titleFont,lineHeight:1,marginTop:12,maxWidth:multiSystem?1160:1700,wordBreak:'normal',overflowWrap:'break-word'}}>{chineseTitle??title}</div>
      {!multiSystem&&<div style={{fontSize:23,marginTop:12}}>{subtitle}</div>}
      {multiSystem&&<div style={{fontSize:18,marginTop:8,color:'#5d6470',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subtitle}</div>}
    </div>
    {showProgress&&<div style={{position:'absolute',left:110,right:170,bottom:62,zIndex:150}}>
      <div style={{display:'flex',gap:36,fontSize:17,marginBottom:22}}><span style={{color:'#8059bf'}}>● 高音声部</span><span style={{color:'#bf440d'}}>● 低音声部</span></div>
      <div style={{height:2,background:'#e2e2e2'}}><div style={{height:2,width:`${frame/durationInFrames*100}%`,background:'linear-gradient(90deg,#b895ff,#E95514)'}}/></div>
    </div>}
  </AbsoluteFill>;
};
