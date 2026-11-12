import fs from 'node:fs';
import path from 'node:path';
import {failure,hashObject} from './audio.mjs';
import {focusContinuityReport} from './focus-continuity.mjs';

export const CAMERA_LIMITS={scale:[.5,5],rotateX:[-80,80],rotateZ:[-90,10],focusX:[-120,120],focusY:[-120,120]};
export const TEACHING_MULTI_SYSTEM_SCALE=2.4;
export function teachingDefaultScale(timeline){
 const bounds=timeline.systemBounds;
 return bounds?.length?Math.min(2.4,Math.floor(858/(Math.max(...bounds.map(b=>b.bottom-b.top))+32)*20)/20):2.4;
}
/** A preview without written measure IDs is still valid visually, but it cannot
 * prove which four measures are the pilot. Say that explicitly at the shared
 * engine boundary instead of silently generating an empty mapping. */
export function measureMappingStatus(timeline){
 const notes=(timeline?.events??[]).flatMap(e=>e.notes??[]);
 const mapped=notes.filter(n=>typeof n.measureId==='string'&&n.measureId.trim()).length;
 return {mapped,total:notes.length,status:notes.length&&mapped===notes.length?'complete':mapped?'partial':'missing'};
}
export const DIRECTION_SCHEMA='aiyoupu-direction/v3';
export const PREVIEW_SCHEMA='aiyoupu-direction-preview/v1';
export const DIRECTION_PROMPT_VERSION=1;
export const DIRECTION_KEYS=new Set(['id','presetId','aspectRatio','cameraMode','theme','texture','typography','pipeline','camera','motionFx','titleScale','avatar']);
export const DIRECTION_ORIGINS=new Set(['agent','workbench']);
export const WORKFLOW_STEPS=[
 {id:'materials',label:'素材',panel:'materialsColumn'},
 {id:'notation',label:'识谱校对',panel:'materialsColumn'},
 {id:'score',label:'谱面确认',panel:'previewHeader'},
 {id:'audio',label:'音频',panel:'transport'},
 {id:'direction',label:'试方向',panel:'previewHeader'},
 {id:'keyframes',label:'关键帧',panel:'side'},
 {id:'confirm',label:'确认',panel:'side'},
 {id:'final',label:'成片',panel:'side'},
];

/** Status is derived from what the server actually has; nothing is hard-coded per song.
 *  'pending' means a human/Agent gate exists that this workbench does not record.
 *  'blocked' means a concrete missing input, and carries the reason to display. */
export function deriveWorkflowSteps({sourceStatus='needs_preparation',hasMaterials=false,hasTimeline=false,eventCount=0,hasScore=false,hasAudio=false,scoreApproved=false,directionSaved=false,keyframeApproved=false,finalDelivered=false}={}){
 const ready=sourceStatus==='ready_for_direction';
 const materialDone=ready||hasMaterials;
 const notationDone=hasTimeline&&eventCount>0;
 const steps=[
  {id:'materials',label:'素材',panel:'materialsColumn',status:materialDone?'done':'blocked',reason:materialDone?'':'尚未导入或选择可用素材'},
  {id:'notation',label:'识谱校对',panel:'materialsColumn',status:notationDone?'done':(materialDone?'blocked':'blocked'),reason:notationDone?'':(hasScore?'尚未生成同版时间轴；MusicXML/MIDI 可自动准备，PDF/图片需先识谱':'缺少同版谱面与时间轴')},
  {id:'score',label:'谱面确认',panel:'previewHeader',status:scoreApproved?'done':'pending',reason:scoreApproved?'':(notationDone?'待人工谱面审批（回 Agent）':'先完成谱面准备')},
  {id:'audio',label:'音频',panel:'transport',status:hasAudio?'done':'blocked',reason:hasAudio?'':'缺少同版音频，仅能静音看谱'},
  {id:'direction',label:'试方向',panel:'previewHeader',status:directionSaved?'done':(ready?'current':'blocked'),reason:directionSaved?'':(ready?'选择预设，满意后保存方向':'素材未就绪，暂不能试方向')},
  {id:'keyframes',label:'关键帧',panel:'side',status:keyframeApproved?'done':'pending',reason:keyframeApproved?'':(directionSaved?'待 Agent 生成并审批':'先保存方向')},
  {id:'confirm',label:'确认',panel:'side',status:keyframeApproved?'current':'pending',reason:keyframeApproved?'回 Agent 出成片样张':'依赖关键帧审批'},
  {id:'final',label:'成片',panel:'side',status:finalDelivered?'done':'pending',reason:finalDelivered?'':'回 Agent 渲染'},
 ];
 return steps.map(s=>({...s,reason:s.status==='done'?'':s.reason}));
}

export function extractPresets(skillRoot){
 const read=f=>fs.readFileSync(path.join(skillRoot,'components',f),'utf8'),presets=[];
 for(const file of ['ScoreVideoConfig.ts','ScoreVideoConfigV2.ts']){
  const text=read(file),start=text.indexOf('export const SCORE_PRESETS');let end=text.indexOf('export const OFFICIAL_HAND_PALETTE',start);if(end<0)end=text.length;
  const sec=text.slice(start,end);
  for(const m of sec.matchAll(/\n\s{2}([A-Z][A-Za-z]+):\s*\(title/g)){
   const chunk=sec.slice(m.index,m.index+1800),get=k=>chunk.match(new RegExp(k+String.raw`:\s*'([^']+)'`))?.[1]??null,id=m[1];
   if(!presets.some(p=>p.id===id))presets.push({id,aspectRatio:get('aspectRatio'),cameraMode:get('cameraMode'),theme:get('theme'),texture:get('texture'),typography:get('style'),pipeline:get('pipeline'),camera:id==='TeachingLandscape'?{scale:2.8,rotateX:0,rotateZ:0,focusX:0,focusY:0}:{scale:id==='SapphireLandscape'?1.28:1.18,rotateX:get('cameraMode')==='portrait-runway'?0:40,rotateZ:get('cameraMode')==='portrait-runway'?-72:id==='SapphireLandscape'?-10:-7,focusX:0,focusY:0}});
  }
 }
 const names={},labels=read('ScoreVideoConfigV2.ts').match(/PRESET_DISPLAY_NAMES\s*=\s*\{([\s\S]*?)\}/)?.[1]??'';
 for(const m of labels.matchAll(/([A-Z][A-Za-z]+):'([^']+)'/g))names[m[1]]=m[2];
 return {presets,names};
}

export function normalizeDirection(input,presets,{pipelineAvailable=true}={}){
 if(!input||typeof input!=='object')throw failure('DIRECTION_INVALID','Direction is missing','Choose a preset and complete parameters.');
 const unexpected=Object.keys(input).filter(k=>!DIRECTION_KEYS.has(k));
 if(unexpected.length)throw failure('DIRECTION_SHAPE_INVALID',`Unexpected direction fields: ${unexpected.slice(0,8).join(', ')}`,'Pass visual direction parameters or a saved direction record, never timeline/props/preview data.');
 const d=structuredClone(input),preset=presets.find(p=>p.id===d.presetId);
 if(!preset)throw failure('DIRECTION_PRESET_INVALID',String(d.presetId),'Use a preset supplied by the Skill.');
 Object.assign(d,{...preset,...d,typography:d.typography??preset.typography,motionFx:d.motionFx??'converge-arc',camera:{...preset.camera,...d.camera}});delete d.id;
 const teaching=d.presetId==='TeachingLandscape';
 if(teaching)Object.assign(d,{aspectRatio:'16:9',theme:'pure-white',texture:'black-multiply',pipeline:'full-score',typography:'clean',cameraMode:'landscape-classic',motionFx:'converge-arc'});
 d.titleScale=Number(d.titleScale??1);if(!Number.isFinite(d.titleScale)||d.titleScale<.5||d.titleScale>2)throw failure('DIRECTION_RANGE_INVALID','titleScale outside supported range','Use 0.5 to 2.');if(teaching)d.titleScale=1;
 if(d.cameraMode==='portrait-runway')Object.assign(d,{aspectRatio:'9:16',pipeline:'score-strip'});
 if(d.cameraMode==='portrait-focus')Object.assign(d,{aspectRatio:'9:16',pipeline:'full-score'});
 if(d.cameraMode==='landscape-classic')Object.assign(d,{aspectRatio:'16:9',pipeline:'full-score'});
 if(!['9:16','16:9'].includes(d.aspectRatio)||!['slate-gray','obsidian-dark','deep-sapphire','pure-white'].includes(d.theme)||!['black-multiply','metallic-screen'].includes(d.texture)||!['chinese-2x','bodoni-royal','clean'].includes(d.typography)||!['converge-arc','pulse-only'].includes(d.motionFx))throw failure('DIRECTION_VALUE_INVALID','Unsupported visual option','Use only the values exposed by the Skill.');
 if(d.theme==='pure-white'&&!teaching)throw failure('DIRECTION_VALUE_INVALID','White paper belongs to TeachingLandscape','Choose TeachingLandscape or a standard theme.');
 if(d.pipeline==='score-strip'&&!pipelineAvailable)throw failure('SCORE_STRIP_REQUIRED','This imported full-page score has no verified continuous strip','Use portrait-focus, or return to Agent for score-strip preparation.');
 d.avatar=d.avatar??{kind:'none'};
 if(teaching||!['none','asset'].includes(d.avatar.kind))d.avatar={kind:'none'};
 if(d.avatar.kind==='asset'&&(!d.avatar.src||!['image','video'].includes(d.avatar.media)))throw failure('AVATAR_INVALID','Local avatar needs an explicit source and media type','Select a supplied local image/video.');
 d.camera=d.camera??preset.camera;
 for(const [key,[min,max]] of Object.entries(CAMERA_LIMITS)){
  const n=Number(d.camera[key]);if(!Number.isFinite(n)||n<min||n>max)throw failure('DIRECTION_RANGE_INVALID',`${key} outside Skill range`,`Use ${min} to ${max}.`);d.camera[key]=n;
 }
 // Teaching keeps its flat projection, but zoom is a user choice. 2.8 is the
 // historical single-system default; multi-system defaults are chosen by the
 // caller that has the timeline geometry.
 if(teaching)Object.assign(d.camera,{rotateX:0,rotateZ:0});
 return d;
}

export function deriveSceneProps(base,direction,presets,{audioSrc,scoreSrc,pipelineAvailable=true}={}){
 const d=normalizeDirection(direction,presets,{pipelineAvailable}),pulse=d.motionFx==='pulse-only',teaching=d.presetId==='TeachingLandscape';
 // Teaching follows the measured current system; multi-row scores keep their
 // measured Y and are never flattened into a constant page midpoint.
 if(teaching&&(!base.timeline.focusPath?.length||base.timeline.focusPath.length!==base.timeline.durationInFrames))throw failure('TEACHING_FOCUS_PATH_REQUIRED','TeachingLandscape needs a complete measured focus path','Prepare an unmodified full score timeline first.');
  const hand=(side)=>({...(base[side]??{}),trailFrames:pulse?0:14,taperTrail:!pulse,followChordNotes:true,rippleRing:false,rippleFrames:0,rippleOpacity:0,inactiveNoteOpacity:0,arcHeight:pulse?0:side==='rightStyle'?58:44,trailWidth:2,glowStrength:1.25,pulseOnly:pulse,...(pulse?{pulseFrames:20}:{}),holdHighlightUntilNext:false,highlightFrames:pulse?20:10,starburst:false,color:side==='rightStyle'?'#b895ff':'#E95514',glowColor:side==='rightStyle'?'#b794f4':'#ff9a46',coreColor:side==='rightStyle'?'#ffffff':'#fff5db'});
  const focusPath=smoothFocus(teaching?smoothSystemTransitions(base.timeline.focusPath,24):base.timeline.focusPath,d.camera.focusX,d.camera.focusY);
  const timeline={...base.timeline,focusPath,...(teaching?{systemBands:teachingSystemBands(focusPath,base.timeline.scoreHeight)}:{})};
  const props={...base,timeline,scoreSrc:scoreSrc??base.scoreSrc,aspectRatio:d.aspectRatio,cameraMode:d.cameraMode,theme:d.theme,texture:d.texture,pipeline:d.pipeline,typographyStyle:d.typography,titleScale:d.titleScale,showProgress:true,camera:{scale:d.camera.scale,rotateX:d.camera.rotateX,rotateZ:d.camera.rotateZ},rightStyle:hand('rightStyle'),leftStyle:hand('leftStyle'),vignette:false,backgroundScene:d.theme==='deep-sapphire'?'deep-sapphire':'none',overlay:d.avatar.kind==='asset'?{enabled:true,src:d.avatar.src,kind:d.avatar.media,transparent:true,...(d.avatar.media==='video'?{loopFrames:300}:{})}:{enabled:false}};
 if(audioSrc!==undefined){if(audioSrc)props.audioSrc=audioSrc;else delete props.audioSrc;}
 if(teaching)props.visualPreset='TeachingLandscape';else delete props.visualPreset;
 if(d.cameraMode==='portrait-runway')props.runwayCamera={...(base.runwayCamera??{}),introFrames:75,leadIn:-55,startScale:1.18,settledScale:1.18,scaleMultiplier:1.25,stretchX:1.45};else delete props.runwayCamera;
 return props;
}

export function productionFromDirection({base,direction,savedAt,id,sourceProps,presets,props}){
 const d=normalizeDirection(direction,presets);
 if(!props)props=deriveSceneProps({timeline:{durationInFrames:1,focusPath:[{focusX:0,focusY:0}]}},d,presets);
 const origin=base.origin??'workbench';
 if(!DIRECTION_ORIGINS.has(origin))throw failure('DIRECTION_ORIGIN_INVALID',String(origin),'Use the actual Agent or workbench entry.');
 return {...base,schema:'aiyoupu-production/v2',preset:d.presetId,confirmationQuote:origin==='agent'?'Agent 方向 '+id+'：'+d.presetId:'用户在工作台保存方向 '+id+'：'+d.presetId,messageRef:(origin==='agent'?'agent-direction:':'workbench:')+id,aspectRatio:d.aspectRatio,theme:d.theme,rightColor:'#b895ff',leftColor:'#E95514',avatar:d.avatar.kind==='asset'?{kind:'asset',src:d.avatar.src}:{kind:'none'},milestone:'first-four-pilot',visual:{...base.visual,cameraMode:d.cameraMode,texture:d.texture,pipeline:d.pipeline,typographyStyle:d.typography,showProgress:true,motionFx:{trailFrames:d.motionFx==='pulse-only'?0:14,taperTrail:d.motionFx!=='pulse-only',followChordNotes:true,rippleRing:false,rippleFrames:0,rippleOpacity:0,inactiveNoteOpacity:0},camera:{...d.camera},rightStyle:props.rightStyle,leftStyle:props.leftStyle,...(props.runwayCamera?{runwayCamera:props.runwayCamera}:{})},workbench:{directionId:id,savedAt,sourceProps,kind:'visual_direction_record',origin,notAnApproval:true,requiresNewKeyframeApproval:true}};
}
export function smoothFocus(focusPath=[],dx,dy){return focusPath.map(p=>({...p,focusX:p.focusX+dx,focusY:p.focusY+dy}));}
/** Replace a short system transition with a longer smoothstep while preserving
 * the measured rest positions. The destination frame stays fixed so the first
 * attack on the new system is already settled; the eased lead-in starts before
 * that boundary and moves X/Y together. Used only by the teaching camera. */
export function smoothSystemTransitions(focusPath=[],frames=24){
 if(focusPath.length<2)return focusPath.map(p=>({...p}));
 const out=focusPath.map(p=>({...p})),width=Math.max(16,Math.round(frames));
 // A one-frame boundary between otherwise constant rows is the literal jump
 // this teaching camera replaces. Seed a short measured direction so the next
 // pass extends into a real eased interval rather than treating it as rest.
 for(let i=1;i+1<out.length;i++)if(Math.abs(out[i].focusY-out[i-1].focusY)<1e-6&&Math.abs(out[i+1].focusY-out[i].focusY)>=1e-3)out[i].focusY=out[i+1].focusY;
 // Collapse extended steps into one transition span before re-timing. Otherwise
 // the two halves of a staircase would be fitted independently and the first
 // boundary could consume the full jump again.
 for(let i=1;i<out.length;i++){
  const d=Math.sign(out[i].focusY-out[i-1].focusY);
  if(!d)continue;
  let end=i;while(end+1<out.length&&Math.sign(out[end+1].focusY-out[end].focusY)===d)end++;
  const first=out[Math.max(0,i-1)].focusY,last=out[end].focusY,count=end-i+1;
  for(let j=0;j<count;j++)out[i+j].focusY=first+(last-first)*(j+1)/count;
  i=end;
 }
 for(let i=1;i<out.length;i++){
  if(Math.abs(out[i].focusY-out[i-1].focusY)<1e-6)continue;
  const originalStart=i;
  let end=i;while(end+1<out.length&&Math.abs(out[end+1].focusY-out[end].focusY)>=1e-3)end++;
  // Stretch the whole one-way movement, including the constant row before the
  // first measured pan. This preserves where the new row starts sounding while
  // preventing the first frame of the move from carrying the full delta.
  const destination=end;
  const before=Math.max(0,originalStart-1),start=Math.max(before+1,destination-width+1);
  const y0=out[before].focusY,y1=out[destination].focusY,x0=out[start].focusX,x1=out[destination].focusX,
    span=destination-start+1;
  if(span<2){i=end;continue;}
  for(let j=start;j<=destination;j++){
   const t=(j-start)/span,s=t*t*(3-2*t);
   out[j].focusY=y0+(y1-y0)*s;out[j].focusX=x0+(x1-x0)*s;
  }
  out[destination]={...out[destination],focusY:y1,focusX:x1};
  i=destination;
 }
 return out;
}

export function teachingSystemBands(path=[],scoreHeight=0){
 if(path.length<2||!Number.isFinite(scoreHeight)||scoreHeight<=0)return [];
 const clusters=[];
 for(const point of path){
  if(!Number.isFinite(point.focusY))continue;
  const cluster=clusters.find(item=>Math.abs(item.y-point.focusY)<2);
  if(cluster)cluster.count++;
  else clusters.push({y:point.focusY,count:1});
 }
 const minimum=Math.max(8,Math.ceil(path.length*.02));
 const centres=clusters.filter(item=>item.count>=minimum).map(item=>item.y).sort((a,b)=>a-b);
 if(centres.length<2)return [];
 return centres.map((centerY,index)=>({centerY,
  top:index===0?0:(centres[index-1]+centerY)/2,
  bottom:index===centres.length-1?scoreHeight:(centerY+centres[index+1])/2}));
}


/** The browser and the Agent both use this output. Keep serialization decisions
 * here so a visually equivalent direction cannot acquire two different hashes. */
export function propsSha256(props){return hashObject(props);}

export function validatePreparedPreview(base,{pipelineAvailable=false}={}){
 if(!base||typeof base!=='object')throw failure('PREVIEW_INVALID','Prepared preview is missing','Create it through aiyoupu direction prepare.');
 const timeline=base.timeline;
 if(!timeline||!Number.isFinite(timeline.fps)||!Number.isInteger(timeline.durationInFrames)||!Number.isFinite(timeline.scoreWidth)||!Number.isFinite(timeline.scoreHeight))throw failure('PREVIEW_INVALID','Timeline metadata is incomplete','Regenerate the prepared preview.');
 if(!Array.isArray(timeline.events)||!timeline.events.length||!Array.isArray(timeline.focusPath)||timeline.focusPath.length!==timeline.durationInFrames)throw failure('PREVIEW_INVALID','Timeline events or focusPath is incomplete','Prepare the score before opening the direction workbench.');
 if(typeof base.scoreSrc!=='string'||!base.scoreSrc.trim())throw failure('PREVIEW_INVALID','Score source is missing','Supply the same-run SVG with the timeline.');
  // Cameras that only move on an attack look like a slideshow in the real
  // canvas. Report it here, where a direction is about to be chosen, instead
  // of discovering it after a full render.
  base.cameraContinuity=focusContinuityReport(timeline);
 if(base.audioSrc!==undefined&&base.audioSrc!==null&&typeof base.audioSrc!=='string')throw failure('PREVIEW_INVALID','Audio source must be a path string or null','Supply the optional same-arrangement audio.');
 return {timeline:{...timeline},pipelineAvailable:!!pipelineAvailable,measureMapping:measureMappingStatus(timeline),cameraContinuity:base.cameraContinuity};
}

export function directionPrompt(id,file){if(!/^D-[A-Za-z0-9_-]+$/.test(String(id)))throw failure('DIRECTION_ID_INVALID',String(id),'Use an ID created by aiyoupu direction save.');if(typeof file!=='string'||!file)throw failure('DIRECTION_FILE_INVALID',String(file),'Pass the saved direction file.');
 return `继续 AI有谱 ${DIRECTION_PROMPT_VERSION===1?'方向':'任务'} ${id}。读取 ${file}，用其派生 job 与 props 生成关键帧和试听；不要复用旧审批。`;}

export function normalizePreviewInput(raw,{presets,baseDir}){
 if(!raw||typeof raw!=='object')throw failure('PREVIEW_INVALID','Preview input is missing','Supply a JSON object with title, timeline, score, and optional audio.');
 const dir=path.resolve(baseDir??'.');
 const filePath=v=>typeof v==='string'&&v?path.resolve(dir,v):null;
 const score=filePath(raw.score??raw.svg);if(!score||!fs.statSync(score,{throwIfNoEntry:false})?.isFile())throw failure('SCORE_MISSING',String(raw.score??raw.svg??''),'Supply an existing SVG file.');
 const audio=raw.audio?filePath(raw.audio):null;if(audio&&!fs.statSync(audio,{throwIfNoEntry:false})?.isFile())throw failure('AUDIO_MISSING',raw.audio,'Remove the optional audio or supply an existing file.');
 const timelineFile=raw.timeline?filePath(raw.timeline):null;let timeline=raw.timelineData??raw.timelineJson??null;
 if(timelineFile){if(!fs.statSync(timelineFile,{throwIfNoEntry:false})?.isFile())throw failure('TIMELINE_MISSING',raw.timeline,'Supply the same-run timeline JSON.');timeline=readJSON(timelineFile);}
 if(!timeline)throw failure('TIMELINE_MISSING','Timeline data is missing','Supply timeline or timelineData computed from the same SVG.');
 const base={title:raw.title??'',subtitle:raw.subtitle??'',label:raw.label??'',chineseTitle:raw.chineseTitle??raw.title??'',timeline,scoreSrc:path.basename(score),audioSrc:audio?path.basename(audio):null,provenance:raw.provenance??null};
 if(raw.scoreImage)base.scoreImage=raw.scoreImage;
 if(raw.direction)base.direction=raw.direction;
 return {base,score,audio,presets};}

export function createPreviewBundle({base,score,audio,out,title,direction,presets}){
 const preview=path.resolve(out);if(fs.existsSync(preview))throw failure('OUTPUT_EXISTS',preview,'Choose a new preview directory.');
 const d=normalizeDirection(direction??base.direction??{presetId:'SlateClassic'},presets,{pipelineAvailable:base.timeline?.scorePipeline==='score-strip'});
 fs.mkdirSync(preview,{recursive:true});
 const assets=path.join(preview,'assets');fs.mkdirSync(assets,{recursive:true});
 const scoreName=path.basename(score);fs.copyFileSync(score,path.join(assets,scoreName),fs.constants.COPYFILE_EXCL);
 let audioName=null;if(audio){audioName=path.basename(audio);fs.copyFileSync(audio,path.join(assets,audioName),fs.constants.COPYFILE_EXCL);}
 const payload={schema:PREVIEW_SCHEMA,title:title??base.title??'',subtitle:base.subtitle??'',label:base.label??'',chineseTitle:base.chineseTitle??base.title??'',timeline:base.timeline,timelineSha256:hashObject(base.timeline),scoreSrc:scoreName,audioSrc:audioName,...(base.scoreImage?{scoreImage:base.scoreImage}:{}),provenance:base.provenance??null,defaultDirection:d,presets:presets.presets.map(p=>p.id)};
 const manifest={schema:PREVIEW_SCHEMA,...payload,files:{score:{file:'assets/'+scoreName,sha256:sha256(fs.readFileSync(path.join(preview,'assets',scoreName)))},audio:audioName?{file:'assets/'+audioName,sha256:sha256(fs.readFileSync(path.join(preview,'assets',audioName)))}:null}};
 fs.writeFileSync(path.join(preview,'preview.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {status:'direction_preview_created',preview,timeline:path.join(preview,'preview.json'),noteCount:base.timeline.events.reduce((n,e)=>n+(e.notes?.length??0),0),eventCount:base.timeline.events.length,direction:d};}

// Kept local to avoid making preview creation depend on global Node state.
function readJSON(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
