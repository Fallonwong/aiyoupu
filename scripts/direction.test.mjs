#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {preparePreview,previewManifest,materializeDirection,validatePreparedPreview,deriveJob,directionPrompt,DIRECTION_SCHEMA,PREVIEW_SCHEMA} from './direction-engine.mjs';
import {loadJob} from './aiyoupu.mjs';
import {nextGate} from './gates.mjs';
import {smoothSystemTransitions} from './workbench-core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-direction-test-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/></svg>';
 const svgFile=path.join(testRoot,'score.svg');fs.writeFileSync(svgFile,svg);
 const focusPath=Array.from({length:30},(_,i)=>({focusX:20+i*.1,focusY:40}));
 const timeline={fps:30,durationInFrames:30,scoreWidth:100,scoreHeight:100,events:[{hand:'right',frame:0,x:20,y:30,notes:[{x:20,y:30,pitch:'C5'}]},{hand:'left',frame:15,x:30,y:60,notes:[{x:30,y:60,pitch:'C3'}]}],focusPath};
 const audioFile=path.join(testRoot,'tone.wav');
 spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','pcm_s16le',audioFile],{windowsHide:true});
 assert.ok(fs.existsSync(audioFile));
 let blocked=false;try{validatePreparedPreview({timeline:{...timeline,focusPath:[]},scoreSrc:'score.svg'});}catch(e){blocked=e.code==='PREVIEW_INVALID';}
 assert.equal(blocked,true,'an incomplete focusPath must block the direction console');
 assert.throws(()=>materializeDirection({preview:path.join(testRoot,'missing.json'),direction:{presetId:'SlateClassic'}}),e=>e.code==='PREVIEW_MISSING');
 const first=preparePreview({timeline,score:svgFile,audio:audioFile,title:'测试曲',subtitle:'Automatic test',out:path.join(testRoot,'preview'),skillRoot:root});
 assert.equal(first.noteCount,2);assert.equal(first.eventCount,2);
 assert.throws(()=>materializeDirection({preview:first.preview,direction:{presetId:'SlateClassic',timeline:{events:[]}}}),e=>e.code==='DIRECTION_SHAPE_INVALID','a preview-shaped object must never be stored as a direction');
 const manifestFile=first.preview,manifest=previewManifest(manifestFile);
 assert.equal(manifest.schema,PREVIEW_SCHEMA);assert.equal(manifest.files.score.sha256.length,64);
 const portrait=materializeDirection({preview:manifestFile,direction:{presetId:'SlateClassic',camera:{scale:1.3,rotateX:40,rotateZ:-7,focusX:2,focusY:4}}});
 const landscape=materializeDirection({preview:manifestFile,direction:{presetId:'SapphireLandscape',camera:{scale:1.4,rotateX:32,rotateZ:-5,focusX:0,focusY:0}}});
 assert.equal(portrait.direction.aspectRatio,'9:16');assert.equal(landscape.direction.aspectRatio,'16:9');
 const teachingSingle=materializeDirection({preview:manifestFile,direction:{presetId:'TeachingLandscape'}});
 assert.equal(teachingSingle.direction.aspectRatio,'16:9');assert.equal(teachingSingle.props.camera.scale,2.8,'single-system teaching retains its historical default');
 assert.equal(teachingSingle.props.visualPreset,'TeachingLandscape');
 assert.equal(teachingSingle.props.rightStyle.pulseOnly,false,'teaching uses converge-arc, not pulse-only');
 assert.equal(teachingSingle.props.rightStyle.trailFrames,14);assert.equal(teachingSingle.props.rightStyle.arcHeight,58);
 assert.equal(teachingSingle.props.leftStyle.arcHeight,44);
 const teachingZoom=materializeDirection({preview:manifestFile,direction:{presetId:'TeachingLandscape',camera:{scale:3.3,rotateX:0,rotateZ:0,focusX:0,focusY:0}}});
 assert.equal(teachingZoom.props.camera.scale,3.3,'teaching zoom remains a user choice');
 const split=Math.floor(manifest.timeline.durationInFrames/2);
 const multiTimeline={...manifest.timeline,focusPath:manifest.timeline.focusPath.map((p,i)=>({...p,focusY:i<split?40:70}))};
 const multiPreviewDir=path.join(testRoot,'multi-preview');
 const multi=preparePreview({timeline:multiTimeline,score:svgFile,out:multiPreviewDir,skillRoot:root,title:'多行教学'});
 const teachingMulti=materializeDirection({preview:multi.preview,direction:{presetId:'TeachingLandscape'}});
 assert.equal(teachingMulti.props.camera.scale,2.4,'multi-system teaching uses a wider measured-system default');
 assert.equal(teachingMulti.props.timeline.focusPath.at(-1).focusY,70,'multi-system focus Y must be preserved');
 const base=Array.from({length:60},(_,i)=>({focusX:i,focusY:i<15?40:i<30?55:70}));
 const smoothed=smoothSystemTransitions(base,24),transition=smoothed.map(p=>p.focusY);
 const transitionStep=Math.max(...transition.slice(1).map((y,i)=>Math.abs(y-transition[i])));
 assert.ok(transitionStep<=15,`system transition must be eased, max step ${transitionStep}`);
 // The measured 15-frame pan is extended into a sustained eased move, so no
 // single frame consumes the whole row change.
 // Server path: same shared engine, then an HTTP round-trip.
 const port=7840+Math.floor(Math.random()*80),child=spawn(process.execPath,[path.join(root,'scripts','workbench-server.mjs'),'--preview',manifestFile,'--port',String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let childOutput='';child.stdout.on('data',d=>childOutput+=d);child.stderr.on('data',d=>childOutput+=d);
 let up=null;for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/state');if(r.ok){up=await r.json();break;}}catch{}await wait(100);}
 if(!up)throw Error('server did not start: '+childOutput);
 try{
  const stateResponse=await fetch('http://127.0.0.1:'+port+'/api/state');assert.equal(stateResponse.headers.get('content-type').startsWith('application/json'),true);
  const page=await fetch('http://127.0.0.1:'+port+'/');const pageText=await page.text();
  assert.equal(page.status,200);assert.match(pageText,/保存方向并复制/);for(const id of ['fileInput','taskSelect','prepareTask','reviewConfirm','saveDirection','steps'])assert.equal(pageText.includes(id),false,`console must not contain ${id}`);
  const validDir=async d=>{const r=await fetch('http://127.0.0.1:'+port+'/api/direction/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction:d})});return {status:r.status,body:await r.json()};};
  const sPortrait=await validDir(portrait.direction),sLandscape=await validDir(landscape.direction);
  assert.equal(sPortrait.body.propsSha256,portrait.propsSha256,'9:16 Agent/server props must match');
  assert.equal(sLandscape.body.propsSha256,landscape.propsSha256,'16:9 Agent/server props must match');
  assert.deepEqual(sPortrait.body.props,portrait.props);assert.deepEqual(sLandscape.body.props,landscape.props);
  const saved=await fetch('http://127.0.0.1:'+port+'/api/direction/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction:portrait.direction})}).then(r=>r.json());
  assert.equal(saved.status,'direction_saved');assert.equal(saved.propsSha256,portrait.propsSha256);
  const record=JSON.parse(fs.readFileSync(saved.file,'utf8'));assert.equal(record.schema,DIRECTION_SCHEMA);assert.equal(record.directionSha256,portrait.directionSha256);assert.equal(record.approval.keyframeApproval,'REQUIRED_FOR_NEW_JOB');
  assert.match(saved.prompt,/D-[A-Za-z0-9_-]+/);assert.ok(saved.prompt.length<450,'prompt must carry only ID + path');assert.doesNotMatch(saved.prompt,/"timeline"|"props"|"focusPath"/);
  assert.equal(directionPrompt(record.id,saved.file),saved.prompt);
 assert.equal(record.direction.timeline,undefined,'direction save must never persist a timeline');
 assert.equal(JSON.stringify(record.direction).length<1500,true,'direction record must remain parameter-sized');
  globalThis.__savedServerDirection=saved;
 }finally{child.kill();await wait(250);}
 // Same hashes from the Agent CLI JSON path.
 const directionFile=path.join(testRoot,'agent-direction.json');fs.writeFileSync(directionFile,JSON.stringify(portrait.direction));
 const cli=spawnSync(process.execPath,[path.join(root,'scripts','aiyoupu.mjs'),'direction','validate','--preview',manifestFile,'--direction',directionFile,'--json'],{encoding:'utf8',windowsHide:true});
 assert.equal(cli.status,0,cli.stderr);const cliData=JSON.parse(cli.stdout);assert.equal(cliData.propsSha256,portrait.propsSha256,'Agent CLI props must match server props');assert.deepEqual(cliData.props,portrait.props);
 const savedDirection=globalThis.__savedServerDirection;
 assert.equal(savedDirection.propsSha256,portrait.propsSha256);
  const runtimeProject=path.join(testRoot,'runtime');fs.mkdirSync(path.join(runtimeProject,'src','animations','score'),{recursive:true});fs.writeFileSync(path.join(runtimeProject,'src','song-v2.tsx'),"import {AiyoupuScoreScene} from './animations/score/AiyoupuScoreSceneV2';export {AiyoupuScoreScene};");fs.writeFileSync(path.join(runtimeProject,'src','animations','score','AiyoupuScoreSceneV2.tsx'),'export const AiyoupuScoreScene=1;');fs.mkdirSync(path.join(runtimeProject,'node_modules','@remotion','cli'),{recursive:true});fs.writeFileSync(path.join(runtimeProject,'node_modules','@remotion','cli','remotion-cli.js'),'');
 const dirs=path.join(testRoot,'agent-out');const derived=deriveJob({preview:manifestFile,directionFile:savedDirection.file,out:dirs,project:runtimeProject});assert.equal(derived.propsSha256,portrait.propsSha256);assert.equal(derived.requiresNewKeyframeApproval,true);assert.ok(fs.existsSync(derived.job));
  const job=JSON.parse(fs.readFileSync(derived.job,'utf8'));assert.equal(job.workbenchSource.propsSha256,portrait.propsSha256);
  assert.equal(job.status,'direction_draft');assert.equal(job.draft,true);assert.equal(job.quality,null);
  assert.equal(job.followup.command,'aiyoupu bind','direction draft must name the supported formal bind continuation');
  assert.equal(job.followup.required,true);
  assert.ok(fs.existsSync(path.join(dirs,'public',job.scoreSrc)),'derived props scoreSrc must exist under the derived job public root');
  if(job.audioSrc)assert.ok(fs.existsSync(path.join(dirs,'public',job.audioSrc)),'derived props audioSrc must exist under the derived job public root');
  assert.ok(Array.isArray(job.pilotMeasures));
 const loaded=loadJob(derived.job);assert.equal(loaded.executionProtocol,'aiyoupu-direction/v3');
  const gate=nextGate({jobFile:derived.job,approvalFile:null});assert.equal(gate.status,'WAITING_FOR_SCORE_APPROVAL');assert.equal(gate.gate,1);
  const measuredTimeline={...manifest.timeline,events:manifest.timeline.events.map((e,i)=>({...e,notes:e.notes.map((n,j)=>({...n,measureId:`P1:${i%4+1}`,occurrence:1,pickup:false}))}))};
  const measuredPreviewDir=path.join(testRoot,'measured-preview');
  const measured=preparePreview({timeline:measuredTimeline,score:svgFile,out:measuredPreviewDir,skillRoot:root,title:'小节映射'});
  const measuredSave=materializeDirection({preview:measured.preview,direction:{presetId:'SlateClassic'},id:'D-measured',save:true,outRoot:testRoot});
  const measuredJobDir=path.join(testRoot,'measured-job');
  const measuredJob=deriveJob({preview:null,directionFile:measuredSave.file,out:measuredJobDir,project:runtimeProject});
  const measuredData=JSON.parse(fs.readFileSync(measuredJob.job,'utf8'));assert.equal(measuredData.pilotMeasures.length,2,'both repeated written measures are locatable');
  assert.ok(measuredData.pilotMeasures.every(m=>/^P1:[1-2]$/.test(m.id.split('@')[0])));
  assert.throws(()=>deriveJob({preview:manifestFile,directionFile:measuredSave.file,out:path.join(testRoot,'wrong-preview'),project:runtimeProject}),e=>e.code==='DIRECTION_PREVIEW_MISMATCH');
 console.log(JSON.stringify({status:'PASS',groups:['preview-validation','cli-prepare','server-contract','9:16 hash equality','16:9 hash equality','direction save boundary','Agent derive']},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{fs.rmSync(testRoot,{recursive:true,force:true});}
