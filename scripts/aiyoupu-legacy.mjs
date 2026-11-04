#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {validateTimeline} from './prepare.mjs';
import {sha256,hashObject,probeMedia,audioFeatures,checkAlignment,synthesize,retime,failure,verifyAudioTransfer} from './audio.mjs';
import {compilePerformance,performance,musicIdentity,fromStructuredScore} from './music.mjs';
import {scoreRequest,approveReview,requireApproval,requestReview,approvalAudioChoice} from './review.mjs';
import {executeLogged} from './execution.mjs';
import {isMain} from './entry.mjs';
import {nativeGeometry,measureNative} from './geometry.mjs';
import {audioPlan,renderScoreAudio,masterAudio,registerRecording,validateAudioEvidence} from './audio-production.mjs';
import {scoreEvents,midiScoreEvents,mappedTimeline,validateTimeMap,secondsAt} from './performance-map.mjs';
import {parseMidi} from './midi.mjs';
import {qualityRequest} from './quality-review.mjs';
import {checkSourceScope} from './source-scope.mjs';
import {focusPath} from './camera-path.mjs';
import {requireQuality,validateProduction,evaluateQuality} from './quality.mjs';
import {notationAudit} from './notation-audit.mjs';
import {buildScoreStrip} from './score-strip.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url));
export const readJSON=(p)=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const writeJSON=(p,v)=>{fs.mkdirSync(path.dirname(path.resolve(p)),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});};
function args(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))throw failure('INVALID_ARGUMENT',argv[i],'Use --name value arguments.');const k=argv[i].slice(2);out[k]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;}return out;}
function need(a,key){if(typeof a[key]!=='string')throw failure('ARGUMENT_REQUIRED',`--${key} is required`,`Supply --${key} <value>.`);return a[key];}
function publicAsset(project,relative){if(typeof relative!=='string'||!relative)throw failure('ASSET_REQUIRED','Public-relative asset path required','Provide explicit song scoreSrc/audioSrc.');const root=path.resolve(project,'public'),p=path.resolve(root,relative);if(!p.startsWith(root+path.sep)||!fs.statSync(p,{throwIfNoEntry:false})?.isFile())throw failure('ASSET_INVALID',relative,'Use an existing file within this project public directory.');return p;}
export function songInputs(project,propsFile){const props=readJSON(propsFile);props.timeline=validateTimeline(props.timeline);return {props,score:publicAsset(project,props.scoreSrc),audio:props.audioSrc?publicAsset(project,props.audioSrc):null};}
function xmlAttributes(s){return Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1],m[2]]));}
export function validateLayout(props,svg,evidence){
  if(evidence.scoreSha256!==sha256(fs.readFileSync(svg))||evidence.timelineSha256!==hashObject(props.timeline))throw failure('LAYOUT_STALE','SVG/timeline differ from the layout evidence','Export the score and mapping together and regenerate the layout evidence.');
  if(!evidence.producer?.tool||!evidence.producer?.runId)throw failure('LAYOUT_PROVENANCE_REQUIRED','Layout tool and runId required','Record the actual engraving run, not an invented verified flag.');
  const text=fs.readFileSync(svg,'utf8'),svgRoot=xmlAttributes(text.match(/<svg\b([^>]*)>/)?.[1]??'');
  const native=evidence.geometryMethod==='browser-native-svg/v1';
  if(!native&&([...text.matchAll(/<svg\b/g)].length!==1||/<(?:defs|symbol|use|style|script|foreignObject|animate\w*|set)\b/i.test(text)||/\bstyle\s*=/i.test(text)))throw failure('LAYOUT_NORMALIZATION_REQUIRED','SVG contains unsupported nested, styled or indirect geometry','Use aiyoupu geometry with an existing browser and actual engraver notehead IDs; preserve original glyphs.');
  const box=svgRoot.viewBox?.trim().split(/[ ,]+/).map(Number);
  const expectedViewport=[0,0,props.timeline.scoreWidth,props.timeline.scoreHeight];
  if(!box||box.length!==4||!box.every((v,i)=>Number.isFinite(v)&&Math.abs(v-expectedViewport[i])<.001))throw failure('LAYOUT_NORMALIZATION_REQUIRED','SVG viewBox differs from the checked timeline viewport','Normalize SVG viewBox to 0 0 scoreWidth scoreHeight in the same layout operation.');
  const nodes=new Map([...text.matchAll(/<(ellipse|circle)\b([^>]*)>/g)].map(m=>{const a=xmlAttributes(m[2]);return [a.id,{x:Number(a.cx),y:Number(a.cy),attributes:a}];}));
  const map=evidence.mapping;if(!Array.isArray(map))throw failure('LAYOUT_MAPPING_REQUIRED','No notehead mapping','Provide eventIndex/noteIndex/svgId and coordinates from the same engraving.');
  let expected=0;
  props.timeline.events.forEach((e,i)=>e.notes.forEach((n,j)=>{expected++;const matches=map.filter(m=>m.eventIndex===i&&m.noteIndex===j);if(matches.length!==1)throw failure('LAYOUT_MAPPING_INCOMPLETE',`event ${i} note ${j}`,'Map every note once.');const m=matches[0],node=nodes.get(m.svgId);
    const rotation=node?.attributes.transform?.match(/^rotate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)$/);
    const transformSafe=!node?.attributes.transform||(rotation&&Math.abs(Number(rotation[2])-node.x)<.001&&Math.abs(Number(rotation[3])-node.y)<.001);
    if((!native&&(!node||!transformSafe||![node.x,node.y].every(Number.isFinite)||Math.abs(node.x-n.x)>.01||Math.abs(node.y-n.y)>.01))||![m.x,m.y].every(Number.isFinite)||Math.abs(m.x-n.x)>.01||Math.abs(m.y-n.y)>.01)throw failure('LAYOUT_COORDINATE_REVIEW_REQUIRED',`Mapping mismatch: ${m.svgId}`,'Measure actual SVG noteheads; never guess geometry.');}));
  if(map.length!==expected)throw failure('LAYOUT_EXTRA_MAPPING','Unexpected mapping entries','Remove stale entries and export together.');
  // Ancestor transforms affect coordinates too; unsupported layouts fail closed.
  if(!native&&/<g\b[^>]*\btransform\s*=|<svg\b[^>]*\btransform\s*=/.test(fs.readFileSync(svg,'utf8')))throw failure('LAYOUT_TRANSFORM_REVIEW_REQUIRED','Nested transformed SVG is not normalized','Measure coordinates using aiyoupu geometry first.');
  return {status:'geometry_checked',mappedNoteheads:expected,scope:'Checks SVG notehead coordinates, not recognition accuracy.'};
}

export function validateScoreReviewEvidence(reportFile,props,score,runId,userReviewed=false){
  const report=readJSON(reportFile),root=path.dirname(path.resolve(reportFile)),files=[];
  const stale=(message)=>{throw failure('SCORE_REVIEW_STALE',message,'Regenerate the actual comparison and review from unchanged source/layout inputs.');};
  const local=(name)=>{if(typeof name!=='string'||path.basename(name)!==name)stale('Invalid comparison artifact path');const p=path.join(root,name);if(!fs.statSync(p,{throwIfNoEntry:false})?.isFile())stale(`Missing comparison artifact: ${name}`);files.push(p);return p;};
  for(const k of ['source','musicxml','svg','timeline','layout']){
    const names=fs.readdirSync(root).filter(n=>n.startsWith(`original-${k}.`)&&fs.statSync(path.join(root,n)).isFile());
    if(names.length!==1)stale(`Missing or ambiguous original ${k} snapshot`);
    const file=local(names[0]);if(sha256(fs.readFileSync(file))!==report.bindings?.[`${k}Sha256`])stale(`Changed ${k} snapshot`);
    if(k==='timeline'&&(userReviewed?musicIdentity(readJSON(file))!==musicIdentity(props.timeline):hashObject(readJSON(file))!==hashObject(props.timeline)))stale('Props timeline differs from reviewed timeline');
  }
  if(report.bindings.svgSha256!==sha256(fs.readFileSync(score)))stale('Props SVG differs from reviewed SVG');
  const evidence=readJSON(local('layout-evidence.json')),mapping=readJSON(local('mapping.json'));
  if(evidence.schema!=='aiyoupu-score-layout/v1'||evidence.sameRun!==true||evidence.runId!==runId||!evidence.producer||hashObject(evidence.bindings)!==hashObject(report.bindings)||hashObject(evidence)!==report.layoutEvidenceSha256)stale('Same-run producer evidence changed or is invalid');
  if(hashObject(mapping)!==report.mappingSha256||hashObject(mapping.bindings)!==hashObject(report.bindings))stale('Measure mapping changed');
  const structural=readJSON(local('check.json'));
  if(structural.structuralPassed!==true||structural.sourceSha256!==report.bindings.musicxmlSha256)stale('Structure check no longer matches MusicXML');
  for(const side of ['source','layout'])for(const item of report.pages?.[side]??[])if(sha256(fs.readFileSync(local(item.file)))!==item.sha256)stale('Comparison page bytes changed');
  if(!report.measures?.length||(!userReviewed&&report.measures.some(m=>m.status!=='approved')))stale('Unapproved measure');
  for(const m of report.measures)for(const side of ['source','layout']){const item=m.crops?.[side];if(!item||sha256(fs.readFileSync(local(item.file)))!==item.sha256)stale('Measure crop bytes changed');}
  local('review-template.json');local('comparison.html');
  return [...new Set(files)];
}
export function bindJob(a){
  const project=path.resolve(need(a,'project')),propsFile=path.resolve(need(a,'props')),out=path.resolve(need(a,'out'));
  const assetProject=path.resolve(a['asset-project']??project);
  const {props,score,audio}=songInputs(assetProject,propsFile),sourceType=a['source-type']??'svg';
  const productionFile=path.resolve(need(a,'production'));validateProduction(readJSON(productionFile),props);
  let userReview=null;
  let audioEvidence=null;
  if(a['score-approval']){
    userReview=requireApproval(a['score-approval'],'score',{musicSha256:musicIdentity(props.timeline)});
    if(userReview.request.sourceType!==sourceType)throw failure('SOURCE_TYPE_MISMATCH','Reviewed source type differs','Keep the original source type.');
    const compiled=compilePerformance(props.timeline,{strict:true});
    if(hashObject(compiled)!==hashObject(props.timeline))throw failure('MUSIC_COMPILE_REQUIRED','Performance metadata is missing or stale','Run aiyoupu music --timeline INPUT --out NEW, then update song props.');
    const audioChoice=approvalAudioChoice(userReview);
    if(!audio&&audioChoice!=='silent')throw failure('AUDIO_MISSING','The user did not approve a silent song','Provide the chosen recording or synthesize after explicit consent.');
    if(audio&&audioChoice==='silent')throw failure('AUDIO_DECISION_MISMATCH','User approved silence','Use the reviewed audio decision.');
    if(audio){audioEvidence=validateAudioEvidence(need(a,'audio-evidence'),audio,props.timeline,{draft:!!a.draft});if(audioChoice==='synthesize'&&audioEvidence.kind==='provided-recording')throw failure('AUDIO_DECISION_MISMATCH','Generated audio cannot be relabeled as a user recording','Use actual sampled export evidence.');}
  }
  if(!['svg','musicxml','midi','audio','pdf','staff-image','jianpu-image'].includes(sourceType))throw failure('SOURCE_TYPE_INVALID',sourceType,'Use a documented source type.');
  const image=props.scoreImage??{};
  if((image.x??0)!==0||(image.y??0)!==0||(image.width??props.timeline.scoreWidth)!==props.timeline.scoreWidth||(image.height??props.timeline.scoreHeight)!==props.timeline.scoreHeight)throw failure('LAYOUT_NORMALIZATION_REQUIRED','Score image uses offsets/scales outside the checked SVG coordinate system','Normalize exported SVG and timeline together; the legacy component remains compatible with custom transforms.');
  if(!audio&&!a['silent-confirmed'])throw failure('AUDIO_MISSING','Song props have no audioSrc','Ask whether to synthesize piano-like audio or explicitly confirm a silent preview; do not claim an audible work.');
  const layoutFile=path.resolve(need(a,'layout')),layout=readJSON(layoutFile);validateLayout(props,score,layout);
  if(layout.geometryMethod==='browser-native-svg/v1'){
    const fresh=measureNative(score,layout.mapping,a.browser);
    if(fresh.some((m,i)=>Math.abs(m.x-layout.mapping[i].x)>.01||Math.abs(m.y-layout.mapping[i].y)>.01))throw failure('LAYOUT_STALE','Browser geometry changed','Regenerate geometry from the same actual SVG.');
  }
  let scoreReview=null,reviewFiles=[];
  if(['pdf','staff-image','jianpu-image','musicxml','audio'].includes(sourceType)){
    if(!a['score-review'])throw failure('SCORE_REVIEW_REQUIRED','Structured score and visual review evidence required','Run aiyoupu score check/compare and resolve uncertain measures before binding.');
    scoreReview=readJSON(a['score-review']);
    if(scoreReview.structuralPassed!==true||scoreReview.layoutEvidenceVerified!==true||(!userReview&&(scoreReview.visualReview?.status!=='approved'||scoreReview.visualReview?.complete!==true||scoreReview.status!=='reviewed')))throw failure('SCORE_REVIEW_REQUIRED','Score review has not passed structure and review gates','Produce actual crops and same-run evidence, then obtain the user score approval.');
    reviewFiles=validateScoreReviewEvidence(a['score-review'],props,score,layout.producer.runId,!!userReview);
  }
  if(/needs_|uncertain/.test(props.timeline.status??'')&&!a.draft&&!userReview)throw failure('TIMELINE_REVIEW_REQUIRED','Timeline is still marked uncertain','Resolve the doubts, or explicitly request a labeled draft.');
  let alignment=null;
  let quality=null;
  if(audio&&props.timeline.notation?.schema==='aiyoupu-symbolic-events/v2'){
    validateTimeMap(props.timeline.map,props.timeline.symbolic,audio);
    if(!a.draft)quality=requireQuality(path.resolve(need(a,'quality')),{timeline:props.timeline,audio,originalSourceSha256:scoreReview?.bindings?.sourceSha256});
    alignment={status:quality?'reviewed_map':'needs_review',method:'performance-map/v2',accuracyCertified:false};
  }else if(audio&&!a.draft)throw failure('QUALITY_REVIEW_REQUIRED','New production requires a v2 time map and content review','Use symbolic, map-time and quality; legacy three-onset reports cannot authorize production.');
  else if(audio&&a.alignment){alignment=readJSON(need(a,'alignment'));if(alignment.audioSha256!==sha256(fs.readFileSync(audio))||alignment.timelineSha256!==hashObject(props.timeline)||alignment.status!=='sampled_onsets_passed')throw failure('AUDIO_ALIGNMENT_REQUIRED','Missing, stale or failing audio calibration','Run aiyoupu align; inspect and correct start/middle/end timestamp offsets.');const fresh=checkAlignment(props.timeline,audio,a);if(fresh.status!=='sampled_onsets_passed')throw failure('AUDIO_ALIGNMENT_REQUIRED','Current decoded audio failed calibration','Correct the timing; changing a report status cannot bypass this check.');alignment=fresh;}
  const entry=fs.existsSync(path.join(project,'src/aiyoupu-demo/song.tsx'))?'src/aiyoupu-demo/song.tsx':'src/song.tsx';
  if(!fs.existsSync(path.join(project,entry)))throw failure('SONG_ENTRY_MISSING','Checked song entry is not installed','Use aiyoupu install --project or --standalone first.');
  const files=[productionFile,...(quality?.files??[]),...runtimeSources(project,entry),propsFile,score,layoutFile,...(props.backgroundSrc?[publicAsset(project,props.backgroundSrc)]:[]),...(props.overlay?.enabled?[publicAsset(project,props.overlay.src)]:[]),...(audio?[audio]:[]),...(a.alignment?[path.resolve(a.alignment)]:[]),...(a['score-review']?[path.resolve(a['score-review'])]:[]),...reviewFiles,...(a['score-approval']?[path.resolve(a['score-approval'])]:[])];
  const job={schemaVersion:1,status:a.draft?'checked_draft':'bound',project,assetProject,entry,composition:'Aiyoupu-Song',propsFile,propsSha256:sha256(fs.readFileSync(propsFile)),fingerprints:Object.fromEntries(files.map(p=>[p,sha256(fs.readFileSync(p))])),timelineSha256:hashObject(props.timeline),scoreSrc:props.scoreSrc,audioSrc:props.audioSrc??null,sourceType,silentConfirmed:!audio&&!!a['silent-confirmed'],draft:!!a.draft,alignment,scoreReview:scoreReview?'structure_and_visual_passed':'not_supplied',layout:validateLayout(props,score,layout)};
  if(userReview){job.scoreApproval=path.resolve(a['score-approval']);job.musicSha256=musicIdentity(props.timeline);job.reviewProtocol='two-user-gates/v1';}
  job.production=readJSON(productionFile);job.quality=quality?.result??null;job.executionProtocol='aiyoupu-checked/v2';
  if(audioEvidence){job.audioProduction={kind:audioEvidence.kind,scope:audioEvidence.scope,engine:audioEvidence.engine,soundfont:audioEvidence.soundfont,mix:audioEvidence.mix,evidence:path.resolve(a['audio-evidence'])};for(const p of [path.resolve(a['audio-evidence']),...Object.keys(audioEvidence.fingerprints??{})])job.fingerprints[p]=sha256(fs.readFileSync(p));}
  writeJSON(out,job);return {status:job.status,job:out,audio:audio?'calibrated':'explicitly_silent',next:'Use aiyoupu preview/render --job with this exact frozen job.'};
}
export function loadJob(file){const job=readJSON(file);if(job.schemaVersion!==1||job.composition!=='Aiyoupu-Song')throw failure('INVALID_JOB','Not a checked song job','Bind the song first.');for(const [p,hash] of Object.entries(job.fingerprints))if(!fs.existsSync(p)||sha256(fs.readFileSync(p))!==hash)throw failure('JOB_STALE',`Changed input: ${p}`,'Revalidate and bind a new job; do not change props between preview and render.');
  const assetProject=job.assetProject??job.project,props=readJSON(job.propsFile);
  if(sha256(fs.readFileSync(job.propsFile))!==job.propsSha256||hashObject(props.timeline)!==job.timelineSha256||props.scoreSrc!==job.scoreSrc||(props.audioSrc??null)!==job.audioSrc)throw failure('JOB_STALE','Job references differ from its frozen props/assets','Bind a new checked job; no demo fallback is permitted.');
  const publicRoot=path.resolve(assetProject,'public'),assetPath=p=>path.resolve(publicRoot,p),scorePath=assetPath(job.scoreSrc),audioPath=job.audioSrc?assetPath(job.audioSrc):null;
  if(!fs.statSync(scorePath,{throwIfNoEntry:false})?.isFile()||!job.fingerprints[scorePath]||(audioPath&&(!fs.statSync(audioPath,{throwIfNoEntry:false})?.isFile()||!job.fingerprints[audioPath])))throw failure('JOB_STALE','Job references differ from its frozen props/assets','Bind a new checked job; no demo fallback is permitted.');
  return job;}
function runtimeSources(project,entry){
  const seen=new Set();const visit=p=>{p=path.resolve(p);if(seen.has(p))return;if(!fs.existsSync(p))throw failure('RUNTIME_SOURCE_MISSING',p,'Preserve installed source dependencies.');seen.add(p);const src=fs.readFileSync(p,'utf8');for(const m of src.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const base=path.resolve(path.dirname(p),m[1]);const file=['','.tsx','.ts','.mjs','.json','/index.tsx','/index.ts'].map(ext=>base+ext).find(f=>fs.statSync(f,{throwIfNoEntry:false})?.isFile());if(!file)throw failure('RUNTIME_SOURCE_MISSING',base,'Resolve actual local imports.');visit(file);}};visit(path.join(project,entry));
  for(const f of fs.readdirSync(scripts).filter(f=>/\.(mjs|py)$/.test(f)))seen.add(path.join(scripts,f));
  for(const f of ['package.json','package-lock.json','tsconfig.json','remotion.config.ts'])if(fs.existsSync(path.join(project,f)))seen.add(path.join(project,f));return [...seen];
}
function runtime(job){const require=createRequire(path.join(job.project,'package.json')),versions={};for(const [n,v] of Object.entries({'remotion':'4.0.515','@remotion/cli':'4.0.515','react':'19.2.4','react-dom':'19.2.4','typescript':'5.9.3'})){try{versions[n]=require(`${n}/package.json`).version;}catch{throw failure('ENVIRONMENT_MISSING',`Cannot resolve ${n}`,'Run aiyoupu doctor with authorized project roots; reuse a compatible installation before requesting install.');}if(versions[n]!==v)throw failure('ENVIRONMENT_INCOMPATIBLE',`${n}: ${versions[n]} (baseline ${v})`,'Use a validated compatible project, never link incompatible node_modules.');}return path.join(path.dirname(require.resolve('@remotion/cli/package.json')),'remotion-cli.js');}
export function verifyOutput(job,file,a={}){
  const media=probeMedia(file,a.ffprobe??'ffprobe'),props=readJSON(job.propsFile),video=media.streams.find(s=>s.codec_type==='video'),audio=media.streams.find(s=>s.codec_type==='audio');
  if(!video)throw failure('VIDEO_STREAM_MISSING','No video stream','Check renderer output.');
  const duration=props.timeline.durationInFrames/props.timeline.fps;
  const expectedWidth=props.width??(props.aspectRatio==='9:16'?1080:props.aspectRatio==='16:9'?1920:1280),expectedHeight=props.height??(props.aspectRatio==='9:16'?1920:props.aspectRatio==='16:9'?1080:720);
  if(Math.abs(Number(video.duration??media.duration)-duration)>.1||video.width!==expectedWidth||video.height!==expectedHeight)throw failure('VIDEO_METADATA_MISMATCH','Unexpected duration or dimensions','Render the complete checked composition with its own props.');
  const [num,den]=String(video.avg_frame_rate??video.r_frame_rate).split('/').map(Number);if(Math.abs(num/den-props.timeline.fps)>.001)throw failure('VIDEO_FPS_MISMATCH','Frame rate differs from timeline','Use the checked fps.');
  let decoded=null,alignment=null;
  if(job.audioSrc){if(!audio)throw failure('AUDIO_STREAM_MISSING','Rendered video has no audio','Use the same audioSrc and props in preview/export.');decoded=audioFeatures(file,a.ffmpeg??'ffmpeg');alignment=job.executionProtocol==='aiyoupu-checked/v2'?verifyAudioTransfer(path.join(job.project,'public',job.audioSrc),file,{ffmpeg:a.ffmpeg??'ffmpeg',fps:props.timeline.fps}):checkAlignment(props.timeline,file,a);if(job.executionProtocol!=='aiyoupu-checked/v2'&&alignment.status!=='sampled_onsets_passed')throw failure('RENDER_ALIGNMENT_REVIEW_REQUIRED','Rendered onset samples differ from the checked timeline','Inspect the decoded output at the reported timestamps.');}
  return {schemaVersion:1,status:job.draft?'draft_media_verified':'media_verified',file:path.resolve(file),fileSha256:media.fileSha256,video:{codec:video.codec_name,width:video.width,height:video.height,fps:num/den,duration},audio:audio?{codec:audio.codec_name,rms:decoded?.rms,peak:decoded?.peak}:null,silentConfirmed:job.silentConfirmed,alignment,limits:'Stream and sampled onset checks do not certify all pitches or all note timings.'};
}
export function pilotMeasures(t){
  const notes=t.symbolic?.events??t.events.flatMap(e=>e.notes.map(n=>({...n,startFrame:e.frame,endFrame:e.frame+(n.durationFrames??0)})));
  const primaryPart=notes.find(n=>n.part)?.part,measures=new Map();
  for(const n of notes){if(n.pickup||primaryPart&&n.part!==primaryPart||!n.measureId)continue;const id=`${n.measureId}@${n.occurrence??1}`,old=measures.get(id);
    const start=t.symbolic?secondsAt(t.map,n.startBeat)*t.fps:n.startFrame,end=t.symbolic?secondsAt(t.map,n.endBeat)*t.fps:n.endFrame;
    measures.set(id,{id,start:Math.min(old?.start??Infinity,start),end:Math.max(old?.end??0,end)});
  }
  return [...measures.values()].sort((a,b)=>a.start-b.start).slice(0,4);
}
export function keyframes(job,a){
  const dir=path.resolve(need(a,'out'));if(fs.existsSync(dir))throw failure('OUTPUT_EXISTS',dir,'Choose a new keyframe directory.');
  const props=readJSON(job.propsFile),t=props.timeline,cli=runtime(job);
  const firstFour=pilotMeasures(t);
  if(job.production?.milestone&&!firstFour.length)throw failure('PILOT_MEASURES_REQUIRED','No explicit measure/occurrence data','Map source measures before generating a first-four pilot.');
  const pilotEnd=firstFour.length?Math.min(t.durationInFrames-1,Math.ceil(Math.max(...firstFour.map(m=>m.end)))):t.durationInFrames-1;
  const frameSet=new Set([Math.min(t.durationInFrames-1,Math.ceil(t.fps*.3)),Math.floor(t.durationInFrames*.5),Math.max(0,t.durationInFrames-Math.ceil(t.fps*.3)-1)]);
  const chosen=[t.events[0],t.events.find(e=>e.notes.length>1),t.events.find(e=>e.notes.some(n=>n.tieStop)),t.events.find(e=>e.hand==='left'),t.events.find((e,i)=>i>0&&Math.abs(e.y-t.events[i-1].y)>200)];
  chosen.filter(Boolean).forEach(e=>frameSet.add(Math.floor(e.frame)));
  frameSet.add(pilotEnd);
  firstFour.forEach(m=>frameSet.add(Math.floor(m.start)));
  const frames=[...frameSet].sort((x,y)=>(x<=pilotEnd?0:1)-(y<=pilotEnd?0:1)||x-y);fs.mkdirSync(dir,{recursive:true});
  const common=[`--props=${job.propsFile}`,...(a.browser?[`--browser-executable=${path.resolve(a.browser)}`]:[])];
  const images=[];
  for(const frame of frames){const file=path.join(dir,`frame-${frame}.png`);executeLogged(process.execPath,[cli,'still',job.entry,job.composition,file,`--frame=${frame}`,...common],{cwd:job.project,log:file+'.command.json'});const bytes=fs.readFileSync(file);if(bytes.subarray(1,4).toString()!=='PNG')throw failure('KEYFRAME_INVALID',file,'Inspect actual rendered frames.');images.push(file);}
  const clips=[];const special=t.events.find(e=>e.notes.some(n=>n.tieStart||(n.slurs?.length??0)>0));
  if(job.audioSrc){const start=Math.max(0,(special?.frame??t.events[0].frame)/t.fps-.2),end=Math.min(t.durationInFrames/t.fps,start+4);const clip=path.join(dir,'audition.wav');executeLogged(a.ffmpeg??'ffmpeg',['-v','error','-ss',String(start),'-i',path.join(job.project,'public',job.audioSrc),'-t',String(end-start),'-c:a','pcm_s16le',clip],{cwd:job.project,log:clip+'.command.json'});clips.push(clip);}
  if(special&&a['motion-clip']!==false){
    const start=Math.max(0,Math.floor(special.frame-t.fps*.2)),end=Math.min(t.durationInFrames-1,start+Math.min(Math.ceil(3*t.fps),Math.floor(t.durationInFrames/2))-1),clip=path.join(dir,'motion-preview.mp4');
    executeLogged(process.execPath,[cli,'render',job.entry,job.composition,clip,`--frames=${start}-${end}`,'--concurrency=2',...common],{cwd:job.project,log:clip+'.command.json'});clips.push(clip);
  }
  if(job.production?.milestone==='first-four-pilot'){const clip=path.join(dir,'first-four.mp4');executeLogged(process.execPath,[cli,'render',job.entry,job.composition,clip,`--frames=0-${pilotEnd}`,'--concurrency=2',...common],{cwd:job.project,log:clip+'.command.json'});clips.push(clip);}
  const manifest=path.join(dir,'frames.json');writeJSON(manifest,{schema:'aiyoupu-keyframes/v1',jobSha256:sha256(fs.readFileSync(a.job)),frames:frames.map((frame,i)=>({frame,seconds:frame/t.fps,file:images[i]})),clips});
  const logs=fs.readdirSync(dir).filter(n=>n.endsWith('.command.json')).map(n=>path.join(dir,n));
  return requestReview({stage:'keyframes',out:path.join(dir,'review'),files:[path.resolve(a.job),...Object.keys(job.fingerprints),manifest,...images,...clips,...logs],display:[...images,...clips],jobSha256:sha256(fs.readFileSync(a.job)),notes:[`音频来源与混音：${JSON.stringify(job.audioProduction??{kind:job.audioSrc?'legacy-unverified':'silent'})}。请确认本版实际试听。`,'先核对前四小节方向，再核对所附全曲中段/尾段和换行风险帧；首四小节不代表全曲正确。','连音必须试听/观看短片段；静帧无法证明没有重复起音。','确认本版后才允许完整导出。未回复时本回合结束。']});
}
export async function main(argv){
  const [command,...rest]=argv;
  if(['doctor','install','prepare','score'].includes(command)){const child=spawnSync(process.execPath,[path.join(scripts,`${command}.mjs`),...rest],{stdio:'inherit',windowsHide:true});return {exitCode:child.status??2,delegated:true};}
  if(!command||command==='--help')return {status:'help',commands:['score-strip','quality-request','source-scope','production-check','symbolic','analyze-audio','map-time','camera-path','quality','audio-plan','audio-render','audio-master','audio-recording','notation-audit','doctor','install','prepare','score','music','music-from-check','geometry','score-request','approve','status','keyframes','synthesize','align','calibrate','bind','preview','render','verify'],usage:'Two user gates: score-request -> actual user response -> approve; keyframes -> actual user response -> approve; then render. No automatic installs.'};
  const a=args(rest);
  if(command==='quality-request')return qualityRequest({timeline:a.timeline?readJSON(a.timeline):undefined,candidate:a.candidate?readJSON(a.candidate):undefined,symbolic:a.events?readJSON(a.events):undefined,check:readJSON(need(a,'check')),audio:need(a,'audio'),source:need(a,'source'),checkedSource:a['checked-source'],sourceScope:a['source-scope']?readJSON(a['source-scope']):undefined,out:need(a,'out')});
  if(command==='source-scope'){const result=checkSourceScope({source:need(a,'source'),inventory:readJSON(need(a,'inventory')),check:readJSON(need(a,'check')),selection:a.selection?readJSON(a.selection):undefined});writeJSON(need(a,'out'),result);return {...result,exitCode:result.status==='blocked'?3:0};}
  if(command==='production-check')return {status:'configuration_recorded',configuration:validateProduction(readJSON(need(a,'production')))};
  if(command==='score-strip')return buildScoreStrip({svg:need(a,'svg'),timeline:need(a,'timeline'),layout:need(a,'layout'),systems:need(a,'systems'),project:need(a,'project'),browser:need(a,'browser'),out:need(a,'out'),scale:Number(a.scale??1),gap:Number(a.gap??0)});
  if(command==='symbolic'&&a.midi){const bytes=fs.readFileSync(a.midi),assignment=readJSON(need(a,'assignment')),check={schema:'aiyoupu-midi-check/v2',structuralPassed:true,sourceSha256:sha256(bytes),midi:parseMidi(bytes),assignment};const data=midiScoreEvents(check.midi,check.sourceSha256,assignment);writeJSON(need(a,'out'),data);writeJSON(a.out+'.check.json',check);return {status:data.status,events:data.events.length,check:a.out+'.check.json'};}
  if(command==='symbolic'){const data=scoreEvents(readJSON(need(a,'check')),{playback:a.playback?readJSON(a.playback):undefined});writeJSON(need(a,'out'),data);return {status:data.status,scoreSha256:data.scoreSha256,events:data.events.length};}
  if(command==='analyze-audio'){const r=spawnSync(need(a,'python'),['-B',path.join(scripts,'audio-analysis.py'),'--events',need(a,'events'),'--audio',need(a,'audio'),'--bpm',need(a,'bpm'),'--out',need(a,'out'),'--ffmpeg',a.ffmpeg??'ffmpeg'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});if(r.error||r.status!==0)throw failure('ANALYSIS_UNAVAILABLE',r.error?.message??r.stdout??r.stderr,'Use an existing Python with NumPy; no install is performed.');return JSON.parse(r.stdout);}
  if(command==='map-time'){const t=mappedTimeline({symbolic:readJSON(need(a,'events')),map:readJSON(need(a,'map')),audio:need(a,'audio'),placement:readJSON(need(a,'placement')),fps:Number(a.fps??30)});const compiled=compilePerformance(t,{strict:true});writeJSON(need(a,'out'),compiled);return {status:'needs_content_and_timing_review',file:path.resolve(a.out)};}
  if(command==='camera-path'){const t=readJSON(need(a,'timeline'));t.focusPath=focusPath({timeline:t,systems:readJSON(need(a,'systems')),transitionFrames:Number(a['transition-frames']??14)});writeJSON(need(a,'out'),t);return {status:'camera_proposed',file:path.resolve(a.out)};}
  if(command==='quality'){const packet=readJSON(need(a,'quality'));const result=evaluateQuality({timeline:readJSON(need(a,'timeline')),audio:need(a,'audio'),check:packet.check,review:packet.review,sourceScope:packet.sourceScope,originalSourceSha256:a.source?sha256(fs.readFileSync(a.source)):undefined});writeJSON(need(a,'out'),result);return {...result,exitCode:result.status==='passed_within_scope'?0:3};}
  if(command==='geometry')return nativeGeometry({svg:need(a,'svg'),timeline:need(a,'timeline'),mapping:need(a,'mapping'),browser:need(a,'browser'),out:need(a,'out')});
  if(command==='music-from-check'){const result=fromStructuredScore(readJSON(need(a,'check')),readJSON(need(a,'placement')),{fps:Number(a.fps??30)});writeJSON(need(a,'out'),result.timeline);writeJSON(`${a.out}.mapping.json`,result.mapping);return {status:'notation_compiled_unreviewed',timeline:path.resolve(a.out),mapping:path.resolve(`${a.out}.mapping.json`),next:'Measure native SVG geometry, create comparison, then ask the user to approve the notation.'};}
  if(command==='music'){const timeline=compilePerformance(validateTimeline(readJSON(need(a,'timeline'))),{strict:true});writeJSON(need(a,'out'),timeline);return {status:'music_compiled',music:timeline.music,file:path.resolve(a.out)};}
  if(command==='audio-plan')return audioPlan({musescore:a.musescore,soundfont:a.soundfont,authorizedProjects:a['authorized-project']?[a['authorized-project']]:[]});
  if(command==='notation-audit')return notationAudit({source:need(a,'source'),check:need(a,'check'),previous:a.previous,out:need(a,'out'),expectedMeasures:a['expected-measures']?.split(',')??[],observations:a.observations});
  if(command==='audio-recording')return registerRecording({audio:need(a,'audio'),timeline:readJSON(need(a,'timeline')),out:need(a,'out')});
  if(command==='audio-render'){
    const timeline=readJSON(need(a,'timeline')),approval=requireApproval(a['score-approval'],'score',{musicSha256:musicIdentity(timeline)});
    if(approvalAudioChoice(approval)!=='synthesize')throw failure('SYNTHESIS_CONFIRMATION_REQUIRED','User did not choose generated audio','Use the approved audio decision.');
    return renderScoreAudio({musicxml:need(a,'musicxml'),timeline,musescore:need(a,'musescore'),soundfont:need(a,'soundfont'),out:need(a,'out')});
  }
  if(command==='audio-master')return masterAudio({evidence:need(a,'evidence'),timeline:readJSON(need(a,'timeline')),out:need(a,'out'),leadSeconds:Number(a['lead-seconds']??0),gainDb:Number(a['gain-db']??0),durationSeconds:a['duration-seconds']===undefined?undefined:Number(a['duration-seconds'])});
  if(command==='score-request'){const sourceType=need(a,'source-type');if(['pdf','staff-image','jianpu-image'].includes(sourceType))need(a,'notation-audit');return scoreRequest({source:need(a,'source'),sourceType,timeline:need(a,'timeline'),comparison:a.comparison,score:a.score,audit:a['notation-audit'],out:need(a,'out')});}
  if(command==='approve')return approveReview({request:need(a,'request'),response:need(a,'response'),out:need(a,'out')});
  if(command==='status'){const job=loadJob(need(a,'job'));try{if(!job.draft&&(job.executionProtocol!=='aiyoupu-checked/v2'||job.audioSrc&&!job.quality))throw failure('QUALITY_REBIND_REQUIRED','Legacy/new unchecked job','Rebind current evidence.');requireApproval(job.scoreApproval,'score',{musicSha256:musicIdentity(readJSON(job.propsFile).timeline)});requireApproval(a.approval,'keyframes',{jobSha256:sha256(fs.readFileSync(a.job))});return {status:'READY_FOR_RENDER'};}catch(e){return {status:e.code,next:e.next};}}
  if(command==='synthesize'){const t=validateTimeline(readJSON(need(a,'timeline'))),approval=requireApproval(a['score-approval'],'score',{musicSha256:musicIdentity(t)});if(approvalAudioChoice(approval)!=='synthesize')throw failure('SYNTHESIS_CONFIRMATION_REQUIRED','User did not choose synthetic audio','Ask for an explicit audio choice.');if(a['preview-only']!==true)throw failure('PREVIEW_ONLY_SYNTHESIS','The built-in oscillator is for calibration only','Use audio-plan/audio-render for production; explicitly pass --preview-only for a labeled draft.');performance(t,{strict:true});const out=need(a,'out'),result=synthesize(t,out,{confirmed:a.confirmed===true});writeJSON(out+'.audio.json',{schema:'aiyoupu-audio-evidence/v1',audio:path.resolve(out),audioSha256:sha256(fs.readFileSync(out)),musicSha256:musicIdentity(t),kind:'calibration-preview',scope:'full-score',purpose:'calibration-preview',fingerprints:{},limits:'Not a sampled piano; draft-only.'});return {...result,purpose:'calibration-preview',evidence:path.resolve(out+'.audio.json')};}
  if(command==='align'){const {props,audio}=songInputs(need(a,'project'),need(a,'props'));if(!audio)throw failure('AUDIO_MISSING','No audioSrc in supplied props','Ask about synthesis or silent preview.');const report=checkAlignment(props.timeline,audio,a);writeJSON(need(a,'out'),report);return {...report,exitCode:report.status==='sampled_onsets_passed'?0:3};}
  if(command==='calibrate'){const {props}=songInputs(need(a,'project'),need(a,'props'));if(props.timeline.notation?.schema==='aiyoupu-symbolic-events/v2')throw failure('MAP_REVISION_REQUIRED','A v2 job must update its explicit map, not independently shift frame fields','Revise the anchors and re-run map-time/camera-path and quality.');props.timeline=retime(props.timeline,Number(need(a,'offset-seconds')));writeJSON(need(a,'out'),props);return {status:'calibration_proposed',file:path.resolve(a.out),next:'Re-run align, review measured offsets and regenerate stale layout/review evidence. A global shift does not fix tempo drift.'};}
  if(command==='bind')return bindJob(a);
  const job=loadJob(need(a,'job'));
  if(command==='verify'){const report=verifyOutput(job,need(a,'video'),a);if(a.report)writeJSON(a.report,report);return report;}
  if(!['preview','render','keyframes'].includes(command))throw failure('INVALID_COMMAND',command,'Use --help.');
  requireApproval(job.scoreApproval,'score',{musicSha256:musicIdentity(readJSON(job.propsFile).timeline)});
  if(command==='keyframes')return keyframes(job,a);
  if(command==='render'&&!job.draft&&(job.executionProtocol!=='aiyoupu-checked/v2'||job.audioSrc&&!job.quality))throw failure('QUALITY_REBIND_REQUIRED','Legacy job cannot authorize a new production export','Rebind with current configuration, content evidence and execution fingerprints.');
  if(command==='render')requireApproval(a.approval,'keyframes',{jobSha256:sha256(fs.readFileSync(a.job))});
  const cli=runtime(job),cliArgs=[command==='preview'?'studio':'render',job.entry];
  if(command==='render'){if(a.confirmed!==true)throw failure('EXPORT_CONFIRMATION_REQUIRED','Render requires explicit export intent','Confirm export, then pass --confirmed.');if(fs.existsSync(need(a,'out')))throw failure('OUTPUT_EXISTS',a.out,'Choose a new output file.');cliArgs.push(job.composition,path.resolve(a.out));}
  cliArgs.push(`--props=${job.propsFile}`);
  if(a.browser)cliArgs.push(`--browser-executable=${path.resolve(a.browser)}`);
  if(command==='preview'&&a.port)cliArgs.push(`--port=${a.port}`);
  if(command==='preview')cliArgs.push('--no-open');
  if(command==='render')cliArgs.push('--concurrency=2');
  if(command==='preview'){
    const result=spawnSync(process.execPath,[cli,...cliArgs],{cwd:job.project,stdio:'inherit',windowsHide:true});if(result.status!==0)throw failure('REMOTION_FAILED',String(result.status),'Inspect Studio output.');
  }else executeLogged(process.execPath,[cli,...cliArgs],{cwd:job.project,log:`${a.out}.render-log.json`});
  if(command==='preview')return {status:'preview_closed'};
  const report=verifyOutput(job,a.out,a);writeJSON(a.report??`${a.out}.verification.json`,report);return report;
}
if(isMain(import.meta.url)){
  try{const result=await main(process.argv.slice(2));if(!result.delegated)console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode??0;}
  catch(error){console.error(JSON.stringify({status:'blocked',code:error.code??'INVALID_INPUT',message:error.message,next:error.next??'Check arguments and supplied files; no success was recorded.'},null,2));process.exitCode=2;}
}
