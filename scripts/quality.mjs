import fs from 'node:fs';
import path from 'node:path';
import {failure,hashObject,sha256,probeMedia} from './audio.mjs';
import {validateTimeMap,secondsAt,validateMappedNotation} from './performance-map.mjs';
import {checkSourceScope} from './source-scope.mjs';
const fail=(code,message)=>{throw failure(code,message,'Present actual source/audio evidence; unresolved items cannot authorize production.');};
export function evaluateQuality({timeline,audio,review,check,originalSourceSha256,sourceScope}){
  const s=timeline.symbolic,map=timeline.map;validateTimeMap(map,s,audio);validateMappedNotation(timeline,check);
  const media=probeMedia(audio);if(!media.streams.some(s=>s.codec_type==='audio')||map.anchors.at(-1).seconds>media.duration+2/timeline.fps)fail('QUALITY_AUDIO_COVERAGE','Mapped score extends beyond actual audio');
  if(review.schema!=='aiyoupu-quality-review/v2'||review.scoreSha256!==s.scoreSha256||review.audioSha256!==map.audioSha256||review.mapSha256!==hashObject(map)||review.checkSha256!==hashObject(check))fail('QUALITY_STALE','Review belongs to other score/audio/map/check');
  if(review.actor!=='user'||!review.messageRef?.trim()||!review.message?.trim())fail('QUALITY_USER_EVIDENCE_REQUIRED','Actual independent user review required; local JSON does not authenticate identity');
  if(!Object.keys(review.fingerprints??{}).length)fail('QUALITY_EVIDENCE_REQUIRED','Source crops/audio annotations required');
  for(const [p,h]of Object.entries(review.fingerprints))if(!fs.existsSync(p)||sha256(fs.readFileSync(p))!==h)fail('QUALITY_STALE',p);
  const evidence=ref=>typeof ref==='string'&&(Object.hasOwn(review.fingerprints,ref)||Object.hasOwn(review.fingerprints,path.resolve(ref)));
  if(review.source?.status!=='reviewed'||!evidence(review.source.evidenceRef)||review.source.sourceSha256!==s.sourceSha256||!Object.values(review.fingerprints).includes(s.sourceSha256))fail('SOURCE_REVIEW_REQUIRED','Original source and comparison evidence must be bound');
  if(originalSourceSha256&&(review.source.originalSourceSha256!==originalSourceSha256||!Object.values(review.fingerprints).includes(originalSourceSha256)))fail('SOURCE_REVIEW_REQUIRED','Review does not bind the actual original PDF/image');
  if(originalSourceSha256&&originalSourceSha256!==s.sourceSha256){
    if(!sourceScope?.source||!sourceScope.inventory||!evidence(sourceScope.source))fail('SOURCE_SCOPE_REQUIRED','Original PDF/image requires a frozen scope inventory and explicit excerpt mapping where applicable');
    const scope=checkSourceScope({...sourceScope,check});
    if(scope.originalSourceSha256!==originalSourceSha256||scope.status==='blocked')fail('SOURCE_SCOPE_MISMATCH',JSON.stringify(scope.issues));
    for(const [p,h]of Object.entries(sourceScope.inventory.fingerprints))if(!evidence(p)||review.fingerprints[p]!==h)fail('QUALITY_EVIDENCE_REQUIRED','Source inventory evidence must be frozen in the review');
  }
  if(!map.anchors.every(a=>evidence(a.evidenceRef)))fail('QUALITY_EVIDENCE_REQUIRED','Every time anchor must reference frozen evidence');
  if(review.structure?.status!=='matched'||review.structure.extraNotesChecked!==true||!evidence(review.structure.evidenceRef))fail('STRUCTURE_REVIEW_REQUIRED','Full playback order, excerpt scope, repeats and extra notes need explicit review');
  const ids=new Map(s.events.filter(e=>e.kind==='note').map(e=>[e.id,e]));
  if(!ids.size)fail('QUALITY_COVERAGE','No pitched events to review');
  const items=review.notes??[];if(items.length!==ids.size||new Set(items.map(n=>n.id)).size!==ids.size)fail('QUALITY_COVERAGE','Every written occurrence needs a unique review item');
  const issues=[],errors=[];
  for(const n of items){const e=ids.get(n.id);if(!e||!evidence(n.evidenceRef))fail('QUALITY_EVIDENCE_REQUIRED',n.id);
    const timingKind=e.ties.includes('stop')?'reviewed-tie-boundary':'observed';
    if(n.pitchStatus!=='matched'||n.pitch!==e.pitch||n.timingStatus!==timingKind||!Number.isFinite(n.observedSeconds)||n.observedSeconds<0||!Number.isFinite(n.uncertaintySeconds)||n.uncertaintySeconds<0||n.uncertaintySeconds>1/timeline.fps){issues.push({id:n.id,code:'NOTE_REVIEW_REQUIRED'});continue;}
    const error=Math.abs(n.observedSeconds-secondsAt(map,e.startBeat));errors.push(error);if(error>2/timeline.fps)issues.push({id:n.id,code:'TIMING_RESIDUAL',errorSeconds:error});
  }
  if(review.unresolved?.length)issues.push(...review.unresolved.map(x=>({code:'UNRESOLVED',detail:x})));
  errors.sort((a,b)=>a-b);
  const median=errors[Math.floor(errors.length/2)]??null,p95=errors[Math.min(errors.length-1,Math.ceil(errors.length*.95)-1)]??null;
  if(median!==null&&median>1/timeline.fps)issues.push({code:'MEDIAN_TIMING_ERROR',seconds:median});
  return {schema:'aiyoupu-quality-result/v2',status:issues.length?'needs_review':'passed_within_scope',scope:'complete reviewed symbolic occurrences against this exact audio; human evidence, not automatic accuracy certification',scoreSha256:s.scoreSha256,audioSha256:map.audioSha256,mapSha256:hashObject(map),reviewSha256:hashObject(review),reviewedNotes:items.length,expectedNotes:ids.size,coverage:items.length/ids.size,issues,timing:{medianSeconds:errors[Math.floor(errors.length/2)]??null,p95Seconds:errors[Math.min(errors.length-1,Math.ceil(errors.length*.95)-1)]??null},accuracyCertified:false};
}
export function requireQuality(file,{timeline,audio,originalSourceSha256}){
  const packet=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!packet.check||!packet.review)fail('QUALITY_PACKET_REQUIRED','Packet needs original check and review; summary status alone is rejected');
  const result=evaluateQuality({timeline,audio,check:packet.check,review:packet.review,sourceScope:packet.sourceScope,originalSourceSha256});if(result.status!=='passed_within_scope')fail('QUALITY_REVIEW_REQUIRED',JSON.stringify(result.issues));
  return {result,files:[file,...Object.keys(packet.review.fingerprints)]};
}
export function validateProduction(config,props){
  const failConfig=message=>fail('PRODUCTION_CONFIRMATION_REQUIRED',message);
  if(config.schema!=='aiyoupu-production/v2'||!config.messageRef?.trim()||!config.confirmationQuote?.trim())failConfig('Record actual user configuration confirmation');
  if(!['16:9','9:16'].includes(config.aspectRatio)||!['slate','parchment','dark','kraft','pure-white','custom','slate-gray','obsidian-dark','deep-sapphire'].includes(config.theme))failConfig('Choose aspect and theme');
  if(!/^#[0-9a-f]{6}$/i.test(config.rightColor??'')||!/^#[0-9a-f]{6}$/i.test(config.leftColor??'')||!['first-four-keyframes','first-four-pilot'].includes(config.milestone))failConfig('Choose colors and first-four milestone');
  if(!['none','asset'].includes(config.avatar?.kind)||config.avatar.kind==='asset'&&!config.avatar.src)failConfig('Choose no avatar or explicit project asset');
  if(config.theme==='custom'){
    const image=typeof config.backgroundSrc==='string'&&!!config.backgroundSrc.trim(),color=/^#[0-9a-f]{6}$/i.test(config.backgroundColor??'');
    if(Number(image)+Number(color)!==1||props&&(image?props.backgroundSrc!==config.backgroundSrc:!!props.backgroundSrc||props.background!==config.backgroundColor))failConfig('Confirm exactly one custom background image or six-digit color and matching props');
  }
  // v2 records without visual fields retain their historical glow-color semantics.
  // New preset records explicitly bind camera, texture, pipeline, typography and FX.
  const visual=config.visual;
  if(props && (props.texture || props.pipeline || props.typographyStyle) && !visual)failConfig('New visual preset props require a visual configuration record');
  if(visual){
    if(config.avatar.kind!=='none')failConfig('Portable presets require no character overlay');
    if(!['portrait-focus','portrait-runway','landscape-classic'].includes(visual.cameraMode)||!['black-multiply','metallic-screen'].includes(visual.texture)||!['full-score','score-strip'].includes(visual.pipeline)||!['chinese-2x','bodoni-royal','clean'].includes(visual.typographyStyle)||typeof visual.showProgress!=='boolean')failConfig('Choose complete visual configuration');
    if((visual.cameraMode==='landscape-classic')!==(config.aspectRatio==='16:9')||(visual.cameraMode==='portrait-runway')!==(visual.pipeline==='score-strip'))failConfig('Camera, aspect and pipeline mismatch');
    if(config.rightColor?.toLowerCase()!=='#b895ff'||config.leftColor?.toLowerCase()!=='#e95514')failConfig('New presets use the standard hand palette');
    const fx=visual.motionFx;
    if(!fx||!Number.isInteger(fx.trailFrames)||fx.trailFrames<0||!Number.isInteger(fx.rippleFrames)||fx.rippleFrames<0||[fx.rippleOpacity,fx.inactiveNoteOpacity].some(n=>!Number.isFinite(n)||n<0||n>1)||[fx.taperTrail,fx.followChordNotes,fx.rippleRing].some(v=>typeof v!=='boolean')||fx.rippleRing||fx.rippleOpacity!==0)failConfig('Choose complete motion FX');
    for(const side of ['rightStyle','leftStyle']){
      const style=visual[side];
      if(!style||!Number.isFinite(style.arcHeight)||style.arcHeight<0||style.trailWidth!==2||style.glowStrength!==1.25||style.highlightFrames!==10||style.holdHighlightUntilNext!==false||style.starburst!==false||style.pulseOnly!==(fx.trailFrames===0))failConfig(`Record resolved motion style: ${side}`);
    }
    if(visual.cameraMode==='portrait-runway'){
      const cam=visual.runwayCamera;
      if(!cam||!Number.isFinite(cam.introFrames)||cam.introFrames<0||!Number.isFinite(cam.leadIn)||['startScale','settledScale','scaleMultiplier','stretchX'].some(k=>!Number.isFinite(cam[k])||cam[k]<=0))failConfig('Record resolved runway camera');
    }
    if(props){
      for(const key of ['cameraMode','texture','pipeline','typographyStyle','showProgress'])if(props[key]!==visual[key])failConfig(`Visual props mismatch: ${key}`);
      for(const side of ['rightStyle','leftStyle'])for(const key of ['trailFrames','rippleFrames','rippleOpacity','inactiveNoteOpacity','taperTrail','followChordNotes','rippleRing'])if(props[side]?.[key]!==fx[key])failConfig(`Motion props mismatch: ${side}.${key}`);
      if(props.rightStyle?.glowColor!=='#b794f4'||props.rightStyle?.coreColor!=='#ffffff'||props.leftStyle?.glowColor!=='#ff9a46'||props.leftStyle?.coreColor!=='#fff5db')failConfig('Standard glow/core colors required');
      for(const side of ['rightStyle','leftStyle'])if(hashObject(props[side])!==hashObject(visual[side]))failConfig(`Resolved style mismatch: ${side}`);
      if(visual.cameraMode==='portrait-runway'&&hashObject(props.runwayCamera)!==hashObject(visual.runwayCamera))failConfig('Resolved camera mismatch');
    }
  }
  if(props&&(props.aspectRatio!==config.aspectRatio||props.theme!==config.theme||(visual?props.rightStyle?.color:props.rightStyle?.glowColor)!==config.rightColor||(visual?props.leftStyle?.color:props.leftStyle?.glowColor)!==config.leftColor||!!props.overlay?.enabled!==(config.avatar.kind==='asset')||config.avatar.kind==='asset'&&props.overlay?.src!==config.avatar.src))failConfig('Props do not match confirmed configuration');
  if(props?.aspectRatio&&((props.width??(props.aspectRatio==='9:16'?1080:1920))!==(props.aspectRatio==='9:16'?1080:1920)||(props.height??(props.aspectRatio==='9:16'?1920:1080))!==(props.aspectRatio==='9:16'?1920:1080)))failConfig('Composition dimensions differ from aspect');
  return config;
}
