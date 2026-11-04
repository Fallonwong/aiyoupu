// Shared direction engine. The Agent CLI, the workbench server, and the browser
// bundle all call these functions. Keep presentation choices here so the
// Agent and UI cannot drift into separate visual semantics.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {failure,hashObject,sha256} from './audio.mjs';
import {compilePerformance,musicIdentity} from './music.mjs';
import {requireApproval} from './review.mjs';
import {
  CAMERA_LIMITS,DIRECTION_SCHEMA,PREVIEW_SCHEMA,TEACHING_MULTI_SYSTEM_SCALE,
  extractPresets,normalizeDirection,deriveSceneProps,productionFromDirection,
  propsSha256,validatePreparedPreview,directionPrompt,teachingDefaultScale,
} from './workbench-core.mjs';

export {CAMERA_LIMITS,DIRECTION_SCHEMA,PREVIEW_SCHEMA,TEACHING_MULTI_SYSTEM_SCALE,extractPresets,normalizeDirection,deriveSceneProps,productionFromDirection,propsSha256,validatePreparedPreview,directionPrompt};

const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const fileHash=p=>sha256(fs.readFileSync(p));
const skillRootOf=()=>path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inside=(root,target)=>{const a=path.resolve(root),b=path.resolve(target);return b===a||b.startsWith(a+path.sep);};

export function previewManifest(file){
 const preview=path.resolve(file);if(!fs.statSync(preview,{throwIfNoEntry:false})?.isFile())throw failure('PREVIEW_MISSING',preview,'Create the preview with aiyoupu direction prepare.');
 const manifest=read(preview);if(manifest.schema!==PREVIEW_SCHEMA)throw failure('PREVIEW_SCHEMA_INVALID',String(manifest.schema),'Open a preview created by this Skill version.');
 if(!manifest.files?.score?.file||!manifest.timeline)throw failure('PREVIEW_INCOMPLETE',preview,'Regenerate the preview with score, timeline, and optional audio.');
 const root=path.dirname(preview),score=path.join(root,manifest.files.score.file),audio=manifest.files.audio?path.join(root,manifest.files.audio.file):null;
 if(!inside(root,score)||audio&&!inside(root,audio)||!fs.statSync(score,{throwIfNoEntry:false})?.isFile())throw failure('PREVIEW_ASSET_MISSING',score,'Keep the score and audio inside the preview folder.');
 if(fileHash(score)!==manifest.files.score.sha256)throw failure('PREVIEW_STALE','Score bytes changed','Regenerate the preview.');
 if(manifest.files.audio){if(!fs.statSync(audio,{throwIfNoEntry:false})?.isFile()||fileHash(audio)!==manifest.files.audio.sha256)throw failure('PREVIEW_STALE','Audio bytes changed','Regenerate the preview.');}
 if(manifest.files.brand){
  const logo=path.join(root,manifest.files.brand.file);
  if(!inside(root,logo)||!fs.statSync(logo,{throwIfNoEntry:false})?.isFile()||fileHash(logo)!==manifest.files.brand.sha256)throw failure('PREVIEW_STALE','Brand mark changed','Regenerate the preview.');
 }
 validatePreparedPreview(manifest,{pipelineAvailable:!!manifest.pipelineAvailable});
 return {...manifest,root,score,audio:manifest.files.audio?audio:null};
}

export function preparePreview({timeline,score,audio,title='',subtitle='',label='',chineseTitle=title,direction,out,skillRoot}){
 if(timeline.events?.some(e=>e.notes?.some(n=>n.tieStart||n.tieStop)))timeline=compilePerformance(timeline,{strict:true});
 const previewDir=path.resolve(out);if(fs.existsSync(previewDir))throw failure('OUTPUT_EXISTS',previewDir,'Choose a new preview folder.');
 if(!score||!fs.statSync(score,{throwIfNoEntry:false})?.isFile())throw failure('SCORE_MISSING',String(score),'Supply the SVG produced with this timeline.');
 if(audio&&!fs.statSync(audio,{throwIfNoEntry:false})?.isFile())throw failure('AUDIO_MISSING',String(audio),'Remove the optional audio or supply the real same-arrangement file.');
 const base=validatePreparedPreview({title,subtitle,label,chineseTitle,timeline,scoreSrc:'assets/'+path.basename(score),audioSrc:audio?'assets/'+path.basename(audio):null,provenance:{kind:'agent-prepared'}});
 const presets=extractPresets(skillRoot).presets;
 const d=normalizeDirection(direction??{presetId:'SlateClassic'},presets,{pipelineAvailable:timeline.scorePipeline==='score-strip'});
 fs.mkdirSync(path.join(previewDir,'assets'),{recursive:true});
 fs.copyFileSync(score,path.join(previewDir,'assets',path.basename(score)),fs.constants.COPYFILE_EXCL);
 if(audio)fs.copyFileSync(audio,path.join(previewDir,'assets',path.basename(audio)),fs.constants.COPYFILE_EXCL);
 // The console is a branded entry point. Copy the local brand mark into this
 // preview so opening a new song never falls back to a missing/old UI banner.
 const brandMark=path.join(skillRoot, 'workbench', 'brand-logo.png');
 if(fs.statSync(brandMark,{throwIfNoEntry:false})?.isFile())fs.copyFileSync(brandMark,path.join(previewDir,'assets','fallontalk-logo.png'),fs.constants.COPYFILE_EXCL);
 const files={score:{file:'assets/'+path.basename(score),sha256:fileHash(score)},audio:audio?{file:'assets/'+path.basename(audio),sha256:fileHash(audio)}:null};
 if(fs.statSync(path.join(previewDir,'assets','fallontalk-logo.png'),{throwIfNoEntry:false})?.isFile())files.brand={file:'assets/fallontalk-logo.png',sha256:fileHash(path.join(previewDir,'assets','fallontalk-logo.png'))};
 const manifest={schema:PREVIEW_SCHEMA,title,subtitle,label,chineseTitle,timeline:base.timeline,timelineSha256:hashObject(base.timeline),scoreSrc:'assets/'+path.basename(score),audioSrc:audio?'assets/'+path.basename(audio):null,provenance:{kind:'agent-prepared'},defaultDirection:d,files};
 fs.writeFileSync(path.join(previewDir,'preview.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {status:'preview_created',preview:path.join(previewDir,'preview.json'),score:path.join(previewDir,files.score.file),audio:audio?path.join(previewDir,files.audio.file):null,noteCount:timeline.events.reduce((n,e)=>n+(e.notes?.length??0),0),eventCount:timeline.events.length,durationInFrames:timeline.durationInFrames};
}

function directionPaths(preview,outRoot=path.dirname(preview)){return {outRoot:path.resolve(outRoot),directions:path.join(path.resolve(outRoot),'directions')};}

export function materializeDirection({preview,direction,id,save=false,outRoot,origin='agent'}){
 const p=previewManifest(preview),presets=extractPresets(skillRootOf()).presets;
 const chosePreset=direction&&direction.presetId&&direction.presetId!==p.defaultDirection?.presetId;
 const supplied={...(direction??{}),presetId:(direction??p.defaultDirection??{}).presetId??p.defaultDirection?.presetId??'SlateClassic'};
 const d=normalizeDirection(chosePreset?supplied:{...(p.defaultDirection??{}),...supplied},presets,{pipelineAvailable:!!p.pipelineAvailable});
 // A teaching direction gets a sensible zoom default, but an explicit scale
 // from the Agent or console always wins and is persisted with the direction.
 if(d.presetId==='TeachingLandscape'&&!Number.isFinite(Number(supplied.camera?.scale))){
  const multi=p.timeline.focusPath.some((q,i)=>i>0&&Math.abs(q.focusY-p.timeline.focusPath[0].focusY)>1e-6);
  d.camera.scale=multi?teachingDefaultScale(p.timeline):2.8;
 }
 const props=deriveSceneProps({title:p.title??'',subtitle:p.subtitle??'',label:p.label??'',chineseTitle:p.chineseTitle??p.title??'',timeline:p.timeline,scoreSrc:p.scoreSrc,...(p.scoreImage?{scoreImage:p.scoreImage}:{}),provenance:p.provenance??null},d,presets,{scoreSrc:p.scoreSrc,audioSrc:p.audioSrc??null,pipelineAvailable:!!p.pipelineAvailable});
 const directionHash=hashObject(d),propsHash=sha256(JSON.stringify(props,null,2)+'\n');
 const result={status:'direction_validated',preview:path.resolve(preview),previewSha256:fileHash(path.resolve(preview)),direction:d,directionSha256:directionHash,props,propsSha256:propsHash,noteCount:p.timeline.events.reduce((n,e)=>n+(e.notes?.length??0),0),eventCount:p.timeline.events.length,width:d.aspectRatio==='9:16'?1080:1920,height:d.aspectRatio==='9:16'?1920:1080,fps:p.timeline.fps,durationInFrames:p.timeline.durationInFrames,scoreFile:p.score,audioFile:p.audio,previewFile:path.resolve(preview),pipelineAvailable:!!p.pipelineAvailable,presets:extractPresets(skillRootOf()).presets,names:extractPresets(skillRootOf()).names,manifest:p};
 if(save){
  if(!/^D-[A-Za-z0-9_-]+$/.test(id??''))throw failure('DIRECTION_ID_INVALID',String(id),'Supply an explicit --id D-... for Agent saves.');
  const {directions}=directionPaths(preview,outRoot);fs.mkdirSync(directions,{recursive:true});
  const file=path.join(directions,id+'.json');if(fs.existsSync(file))throw failure('DIRECTION_EXISTS',file,'Use a new direction ID.');
  if(!['agent','workbench'].includes(origin))throw failure('DIRECTION_ORIGIN_INVALID',String(origin),'Use the actual entry that saved this direction.');
  const record={schema:DIRECTION_SCHEMA,id,savedAt:new Date().toISOString(),origin,preview:{file:path.resolve(preview),sha256:result.previewSha256},source:{scoreSha256:fileHash(result.scoreFile),audioSha256:result.audioFile?fileHash(result.audioFile):null,timelineSha256:p.timelineSha256},direction:d,directionSha256:directionHash,propsSha256:propsHash,approval:{scoreApprovalReused:false,keyframeApproval:'REQUIRED_FOR_NEW_JOB',status:'NOT_REQUESTED'}};
  fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  const prompt=directionPrompt(id,file);
  const {props:ignored,manifest:ignoredManifest,...summary}=result;
  return {...summary,status:'direction_saved',id,file,prompt};
 }
 return result;
}

export function loadDirection(file){const target=path.resolve(file),record=read(target);if(record.schema!==DIRECTION_SCHEMA||!record.id||!record.preview?.file||!record.direction)throw failure('DIRECTION_INVALID',String(file),'Open a direction saved by this Skill version.');if(fileHash(record.preview.file)!==record.preview.sha256)throw failure('DIRECTION_STALE','Preview changed after this direction was saved','Recreate the preview and save a new direction.');return {...record,file:target};}

export function validateDirectionFile(file){const record=loadDirection(file),m=materializeDirection({preview:record.preview.file,direction:record.direction});if(m.directionSha256!==record.directionSha256||m.propsSha256!==record.propsSha256)throw failure('DIRECTION_HASH_MISMATCH','Saved direction and current shared engine disagree','Re-save the direction after updating the Skill.');return {status:'direction_valid',id:record.id,origin:record.origin??'legacy-unrecorded',file:path.resolve(file),...m};}

export function chooseSongEntry(project,entry=null){
 const root=path.resolve(project),candidates=entry?[entry]:['src/aiyoupu-demo/song-v2.tsx','src/song-v2.tsx'];
 return candidates.find(p=>fs.existsSync(path.join(root,p)))??null;
}

/** Content identity for the exact visual implementation a job invokes. Follow
 * local imports so a changed scene or geometry file cannot look like the same
 * reviewed build merely because its entry path did not change. */
export function runtimeSourceFingerprint(project,entry){
 const root=path.resolve(project),main=path.join(root,entry),seen=new Set();
 const visit=file=>{
  const target=path.resolve(file);if(seen.has(target))return;if(!inside(root,target)||!fs.statSync(target,{throwIfNoEntry:false})?.isFile())throw failure('RUNTIME_SOURCE_MISSING',target,'Install the complete V2 runtime before deriving a job.');
  seen.add(target);const source=fs.readFileSync(target,'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g)){
   const base=path.resolve(path.dirname(target),match[1]);const resolved=['','.tsx','.ts','.mjs','.js','.json','/index.tsx','/index.ts'].map(ext=>base+ext).find(p=>fs.statSync(p,{throwIfNoEntry:false})?.isFile());
   if(!resolved)throw failure('RUNTIME_SOURCE_MISSING',base,'Resolve the actual local import before rendering.');visit(resolved);
  }
 };
 visit(main);const files=Object.fromEntries([...seen].sort().map(file=>[path.relative(root,file).replaceAll('\\','/'),fileHash(file)]));
 const implementation=Object.keys(files).filter(file=>/^src\/(?:animations\/score|aiyoupu-demo)\/[^/]+\.(?:tsx?|mjs|js|json)$/.test(file));
 if(!implementation.some(file=>/AiyoupuScoreSceneV2\.tsx$/.test(file)))throw failure('RUNTIME_SOURCE_MISSING','The computed entry does not import the V2 scene','Install the AiyoupuScoreSceneV2 runtime.');
 return {schema:'aiyoupu-runtime-sources/v1',entry,files,implementationSha256:sha256(JSON.stringify(implementation.map(file=>[file,files[file]])))};
}

export function attachRuntimeSources(record,runtimeSources){
 return {...record,runtimeSources};
}

export function deriveJob({preview,directionFile,out,project,entry=null,composition='Aiyoupu-Song',assetProject,scoreApproval=null}){
 const saved=directionFile?loadDirection(directionFile):null,id=saved?.id??'D-derive';
 let material;
 if(directionFile){
  if(preview&&path.resolve(preview)!==path.resolve(saved.preview.file))throw failure('DIRECTION_PREVIEW_MISMATCH',String(preview),'Use the preview recorded by this saved direction, or omit --preview.');
  const materialized=materializeDirection({preview:saved.preview.file,direction:saved.direction});
  if(materialized.directionSha256!==saved.directionSha256||materialized.propsSha256!==saved.propsSha256)throw failure('DIRECTION_HASH_MISMATCH','Saved direction and current shared engine disagree','Re-save the direction.');
  material=materialized;
 }else material=materializeDirection({preview,direction:{presetId:'SlateClassic'}});
 const jobDir=path.resolve(out);if(fs.existsSync(jobDir))throw failure('OUTPUT_EXISTS',jobDir,'Choose a new job folder.');
 const propsFile=path.join(jobDir,'props.json');const productionFile=path.join(jobDir,'production.json');
 fs.mkdirSync(jobDir,{recursive:true});fs.writeFileSync(propsFile,JSON.stringify(material.props,null,2)+'\n',{flag:'wx'});
 const production=productionFromDirection({base:{origin:saved?.origin??'agent'},direction:material.direction,savedAt:new Date().toISOString(),id,sourceProps:material.propsSha256,presets:extractPresets(skillRootOf()).presets,props:material.props});
 fs.writeFileSync(productionFile,JSON.stringify(production,null,2)+'\n',{flag:'wx'});
 const publicDir=path.join(jobDir,'public'),assets=path.join(publicDir,'assets');fs.mkdirSync(assets,{recursive:true});
 // props.scoreSrc/audioSrc are public-relative asset paths (assets/...). Copy
 // to those exact job-relative destinations; basename-only copying leaves
 // bind/songInputs looking for assets/<name> at public/<name>.
 const scoreDest=path.join(publicDir,material.props.scoreSrc);fs.mkdirSync(path.dirname(scoreDest),{recursive:true});
 if(material.scoreFile&&fs.existsSync(material.scoreFile))fs.copyFileSync(material.scoreFile,scoreDest,fs.constants.COPYFILE_EXCL);
 const audioDest=material.props.audioSrc?path.join(publicDir,material.props.audioSrc):null;
 if(material.audioFile&&audioDest&&fs.existsSync(material.audioFile)){fs.mkdirSync(path.dirname(audioDest),{recursive:true});fs.copyFileSync(material.audioFile,audioDest,fs.constants.COPYFILE_EXCL);}
 const runtimeProject=path.resolve(project),resolvedEntry=chooseSongEntry(runtimeProject,entry),projectHasSong=!!resolvedEntry;
 if(!projectHasSong)throw failure('SONG_ENTRY_MISSING','The selected Remotion project has no prepared song entry','Install the Skill runtime or pass --project for a project that already contains src/aiyoupu-demo/song-v2.tsx (or src/song-v2.tsx).');
 const cli=path.join(runtimeProject,'node_modules','@remotion','cli','remotion-cli.js');
 if(!fs.existsSync(cli))throw failure('REMOTION_MISSING','The selected project has no @remotion/cli','Reuse a compatible existing Remotion project; this command does not install dependencies.');
 const runtimeSources=runtimeSourceFingerprint(runtimeProject,resolvedEntry);
 const job={schemaVersion:1,status:'direction_draft',project:runtimeProject,entry:resolvedEntry,composition,propsFile,propsSha256:fileHash(propsFile),timelineSha256:hashObject(material.props.timeline),scoreSrc:material.props.scoreSrc,audioSrc:material.props.audioSrc??null,assetProject:jobDir,direction:{id,file:directionFile?path.resolve(directionFile):null},productionFile,fingerprints:{[propsFile]:fileHash(propsFile),[productionFile]:fileHash(productionFile),...Object.fromEntries([[path.join(publicDir,material.props.scoreSrc),fileHash(path.join(publicDir,material.props.scoreSrc))],...(material.props.audioSrc?[[path.join(publicDir,material.props.audioSrc),fileHash(path.join(publicDir,material.props.audioSrc))]]:[])])},draft:true,executionProtocol:'aiyoupu-direction/v3',scoreReview:'not_supplied',quality:null,production,workbenchSource:{directionId:id,origin:saved?.origin??'agent',preview:material.previewFile??material.preview??null,directionSha256:material.directionSha256,propsSha256:sha256(JSON.stringify(material.props,null,2)+'\n'),requiresNewKeyframeApproval:true}};
 if(scoreApproval){
  const file=path.resolve(scoreApproval),approval=requireApproval(file,'score',{musicSha256:musicIdentity(material.props.timeline)}),record=read(file);
  job.scoreApproval=file;job.musicSha256=musicIdentity(material.props.timeline);job.reviewProtocol='two-user-gates/v1';job.fingerprints[file]=fileHash(file);
  for(const ref of [record.request,record.response])if(typeof ref==='string'&&fs.existsSync(ref))job.fingerprints[path.resolve(ref)]=fileHash(path.resolve(ref));
 }
 // Written measure/occurrence identities are preserved by the preparation
 // path. Include the same, ordered identities in the returned job so a later
 // keyframe run can point to its first four measures without guessing layout.
 const pilotMeasureIds=[...new Set(material.props.timeline.events.flatMap(e=>(e.notes??[]).filter(n=>n.measureId&&!n.pickup).map(n=>`${n.measureId}@${n.occurrence??1}`)))];
 job.pilotMeasures=pilotMeasureIds.slice(0,4).map(id=>{const [written,occurrence]=id.split('@');const items=material.props.timeline.events.flatMap(e=>(e.notes??[]).filter(n=>n.measureId===written&&String(n.occurrence??1)===occurrence).map(n=>({n,frame:e.frame})));return {id,start:Math.min(...items.map(x=>x.n.soundingStartFrame??x.frame)),end:Math.max(...items.map(x=>x.n.soundingEndFrame??x.frame))};});
 const complete=attachRuntimeSources(job,runtimeSources);
 // The direction job freezes choice and assets only. Name the supported next
 // gate so this draft cannot be treated as a formal checked production job.
 complete.followup={required:true,protocol:'aiyoupu-checked/v2',command:'aiyoupu bind',inputs:['--project','--asset-project <derived-job-dir>','--props','--production','--layout','--quality','--score-review','--score-approval','--audio-evidence','--browser','--out'],reason:'Formal bind must evaluate current score review and v2 quality evidence for the same frozen assets.',limits:'Do not mark this direction draft as bound or render it as a formally accepted work.',example:'aiyoupu bind --project <Remotion-project> --asset-project <derived-job-dir> --props <derived-job-dir>/props.json --production <derived-job-dir>/production.json --layout <same-run-layout.json> --source-type <svg|musicxml|midi|audio|pdf|staff-image|jianpu-image> --score-review <check-or-comparison.json> --score-approval <score-approval.json> --audio-evidence <master.audio.json> --quality <quality-packet.json> --browser <existing-browser> --out <bound-job.json>' };
 fs.writeFileSync(path.join(jobDir,'job.json'),JSON.stringify(complete,null,2)+'\n',{flag:'wx'});
  return {status:'job_derived',job:path.join(jobDir,'job.json'),props:propsFile,production:productionFile,id,propsSha256:material.propsSha256,directionSha256:material.directionSha256,requiresNewKeyframeApproval:true,followup:complete.followup};
}

/** Render a real still without opening a browser UI. This reuses the installed
 * Remotion CLI and the same props file as the final job. */
export function renderStill({preview,directionFile,jobFile,frame=0,out,browser,project}){
 const target=path.resolve(out);if(fs.existsSync(target))throw failure('OUTPUT_EXISTS',target,'Choose a new PNG path.');
 const jobPath=jobFile?path.resolve(jobFile):null;
 if(!jobPath)throw failure('JOB_REQUIRED','A derived job is required for deterministic rendering','Run aiyoupu direction derive, then pass --job.');
 const job=read(jobPath),propsFile=path.resolve(job.propsFile);
 const args=[path.join(path.resolve(project),'node_modules','@remotion','cli','remotion-cli.js'),'still',job.entry??'src/aiyoupu-demo/song-v2.tsx',job.composition??'Aiyoupu-Song',target,`--frame=${frame}`,`--props=${propsFile}`,`--public-dir=${path.join(job.assetProject,'public')}`];
 if(browser)args.push(`--browser-executable=${path.resolve(browser)}`);
 const cwd=path.resolve(project);const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:600000,windowsHide:true,maxBuffer:32*1024*1024});
 if(r.error||r.status!==0||!fs.existsSync(target))throw failure('STILL_RENDER_FAILED',String(r.stderr||r.stdout||r.error?.message||r.status).slice(-1200),'Inspect the existing Remotion environment and the derived props.');
 return {status:'still_rendered',file:target,frame,bytes:fs.statSync(target).size,sha256:fileHash(target)};
}
