import fs from 'node:fs';import path from 'node:path';
import {loadJob,songInputs} from './aiyoupu-legacy.mjs';
import {requireApproval} from './review.mjs';
import {musicIdentity} from './music.mjs';
import {sha256,hashObject,failure} from './audio.mjs';
import {validateAudioEvidence} from './audio-production.mjs';
import {approvedHistoricalSource} from './migration-v2.mjs';
import {parseMidi} from './midi.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>sha256(fs.readFileSync(p));
const fail=m=>{throw failure('WORKBENCH_INPUT_MISMATCH',m,'Use the approved SVG layout, matching MIDI and sampled master.');};
const pitchNumber=p=>{const m=/^([A-G])([#b]?)(-?\d+)$/.exec(p);if(!m)fail('Invalid pitch');return (Number(m[3])+1)*12+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0);};

/** Original data adapter against a UI-exported project; no workbench implementation included. */
export function exportWorkbench({job:jobFile,approval,out,layout,midi,sourceJob,sourceApproval,sourceReceipt}){
  if(fs.existsSync(out))throw failure('OUTPUT_EXISTS',out,'Choose a new filename.');
  let job,props,score,audio,scope,proof,sourceRequest;
  if(sourceJob){
    const s=approvedHistoricalSource({job:sourceJob,approval:sourceApproval,receipt:sourceReceipt});
    ({job,props}=s);score=s.scoreFile;audio=s.audioFile;sourceRequest=s.score.request;scope='approved-pilot-preview-only';
    proof={sourceVersion:'1.3.0',sourceJobSha256:hash(sourceJob),receiptSha256:hash(sourceReceipt),scoreRequestId:s.score.request.id,keyframeRequestId:s.keyframes.request.id};
  }else{
    job=loadJob(jobFile);({props,score,audio}=songInputs(job.project,job.propsFile));
    sourceRequest=requireApproval(job.scoreApproval,'score',{musicSha256:musicIdentity(props.timeline)}).request;
    requireApproval(approval,'keyframes',{jobSha256:hash(jobFile)});
    if(job.draft||job.executionProtocol!=='aiyoupu-checked/v2'||job.quality?.status!=='passed_within_scope'||!audio)fail('Current production needs both approvals and quality evidence');
    const evidence=validateAudioEvidence(job.audioProduction.evidence,audio,props.timeline);
    if(!['sampled-score-export','provided-recording'].includes(job.audioProduction.kind)||evidence.kind!==job.audioProduction.kind||evidence.kind==='sampled-score-export'&&evidence.engine?.profile!=='MuseScore Basic')fail('Audio engine evidence differs from the approved source');
    scope='approved-inputs-preview-only';proof={sourceVersion:'2.1.0',sourceJobSha256:hash(jobFile)};
  }
  if(!layout||!midi||job.fingerprints[path.resolve(layout)]!==hash(layout))fail('Supply frozen measured layout and MIDI');
  const evidence=read(layout),t=props.timeline;
  if(evidence.scoreSha256!==hash(score)||evidence.timelineSha256!==hashObject(t))fail('Layout is not this approved SVG/timeline');
  if(sourceRequest.fingerprints[path.resolve(midi)]!==hash(midi))fail('MIDI was not bound in the approved source review');
  const xml=fs.readFileSync(score,'utf8'),events=[];
  for(const [ei,e]of t.events.entries())for(const [ni,n]of e.notes.entries()){
    const m=evidence.mapping.filter(x=>x.eventIndex===ei&&x.noteIndex===ni);
    if(m.length!==1||Math.abs(m[0].x-n.x)>.01||Math.abs(m[0].y-n.y)>.01)fail('Missing/mismatched measured notehead');
    if(!xml.includes('id="'+m[0].svgId+'"'))fail('Notehead ID absent from SVG');
    const duration=n.durationFrames/t.fps;if(!Number.isFinite(duration)||duration<=0)fail('Missing note duration');
    events.push({eventId:n.id,scoreId:m[0].svgId,time:e.frame/t.fps,duration,pitch:pitchNumber(n.pitch),velocity:80,
      staff:e.hand==='right'?1:2,x:n.x,y:n.y,system:e.systemId??0,kind:n.attack===false?'sustain':'attack'});
  }
  const midiNotes=parseMidi(fs.readFileSync(midi)).notes,tuple=e=>`${e.pitch}:${e.time.toFixed(6)}:${e.duration.toFixed(6)}`;
  const written=events.filter(e=>e.kind==='attack').map(tuple).sort(),played=midiNotes.map(n=>tuple({pitch:n.pitch,time:n.startSeconds,duration:n.durationSeconds})).sort();
  if(JSON.stringify(written)!==JSON.stringify(played))fail('MIDI pitches, starts or durations differ');
  const audioName=path.basename(out,'.json')+'-master.wav',audioOut=path.join(path.dirname(path.resolve(out)),audioName);
  if(fs.existsSync(audioOut))throw failure('OUTPUT_EXISTS',audioOut,'Choose new filenames.');
  const project={title:props.chineseTitle??props.title,subtitle:props.subtitle??'',svg:xml,width:t.scoreWidth,height:t.scoreHeight,
    duration:t.durationInFrames/t.fps,events,midiCount:midiNotes.length,unmatched:0,pageCount:1,sample:false};
  const data={schema:'aiyoupu-workbench-project/v2',displayName:'AI有谱',skill:'aiyoupu',skillVersion:'2.1.0',project,
    aiyoupu:{scope,formalVideoSource:'Remotion offline renderer with both content approvals',scoreSha256:hash(score),
      audio:{file:audioName,sha256:hash(audio),engine:'MuseScore Basic',loading:'Select this unchanged companion file in the optional audio input'},
      performanceDuration:Math.max(...events.map(e=>e.time+e.duration)),staffCounts:{treble:events.filter(e=>e.staff===1).length,bass:events.filter(e=>e.staff===2).length},proof}};
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.copyFileSync(audio,audioOut,fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(out,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
  return {status:'workbench_project_exported_for_import_validation',out:path.resolve(out),audio:audioOut,notes:events.length,unmatched:project.unmatched,scope};
}
