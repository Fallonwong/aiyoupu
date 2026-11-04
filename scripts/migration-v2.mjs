import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {sha256,hashObject,failure} from './audio.mjs';
import {musicIdentity} from './music.mjs';
import {scoreIdentity,validateSymbolic} from './performance-map.mjs';
const protocol=JSON.parse(fs.readFileSync(new URL('../history/migration-v2/legacy-protocol.json',import.meta.url),'utf8'));
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>sha256(fs.readFileSync(f));
const fail=m=>{throw failure('MIGRATION_EVIDENCE_INVALID',m,'Use untouched source delivery, job and both actual approvals; never edit old evidence.');};
function historicalMusicIdentity(t){
  if(t.notation?.schema!==protocol.symbolic)return musicIdentity(t);
  const s=t.symbolic;
  if(!s||s.schema!==protocol.symbolic||s.scoreSha256!==scoreIdentity(s)||s.scoreSha256!==t.notation.scoreSha256)fail('Changed historical symbolic notation');
  const normalized={...s,schema:'aiyoupu-symbolic-events/v2'};
  normalized.scoreSha256=scoreIdentity(normalized);validateSymbolic(normalized);
  return s.scoreSha256;
}
function targetMusicIdentity(t){
  if(t.notation?.schema!==protocol.symbolic)return musicIdentity(t);
  return scoreIdentity({...t.symbolic,schema:'aiyoupu-symbolic-events/v2'});
}
function approval(file,stage,expected){
  const a=read(file);
  if(a.schema!==protocol.approval||a.stage!==stage||a.decision!=='approve'||hash(a.request)!==a.requestSha256||hash(a.response)!==a.responseSha256)fail('Changed source approval');
  const r=read(a.request),answer=read(a.response),{bundleSha256,...body}=r;
  if(r.schema!==protocol.request||hashObject(body)!==bundleSha256||r.stage!==stage||
    answer.schema!==protocol.response||answer.actor!=='user'||answer.decision!=='approve'||!answer.message?.trim()||!answer.messageRef?.trim()||
    answer.requestId!==r.id||answer.bundleSha256!==bundleSha256)fail('Missing actual source response');
  for(const [f,h]of Object.entries(r.fingerprints??{}))if(hash(f)!==h)fail('Changed source review input');
  for(const item of r.display??[])if(hash(path.join(path.dirname(a.request),item.file))!==item.sha256)fail('Changed displayed source media');
  if(stage==='score'&&r.musicSha256!==expected||stage==='keyframes'&&r.jobSha256!==expected)fail('Source approval belongs to another version');
  return {request:r,response:answer,approval:a};
}
export function approvedHistoricalSource(source){
  const job=read(source.job);
  if(job.composition!==protocol.composition)fail('Not the supported frozen source generation');
  for(const [f,h]of Object.entries(job.fingerprints??{}))if(hash(f)!==h)fail('Changed frozen job input');
  const props=read(job.propsFile);
  if(hash(job.propsFile)!==job.propsSha256||hashObject(props.timeline)!==job.timelineSha256)fail('Changed source props/timeline');
  const sourceIdentity=historicalMusicIdentity(props.timeline);
  const score=approval(job.scoreApproval,'score',sourceIdentity);
  const keyframes=approval(source.approval,'keyframes',hash(source.job));
  const receipt=read(source.receipt);
  if(receipt.status!=='APPROVED_PILOT_EXPORTED'||receipt.videoSha256!==hash(receipt.video)||receipt.verification?.fileSha256!==receipt.videoSha256||
    receipt.approvals?.score?.requestId!==score.request.id||receipt.approvals?.keyframes?.requestId!==keyframes.request.id)fail('Delivery does not match both approved stages');
  const asset=relative=>{const file=path.resolve(job.project,'public',relative),publicDir=path.resolve(job.project,'public');if(!file.startsWith(publicDir+path.sep)||job.fingerprints[file]!==hash(file))fail('Changed or out-of-scope source asset');return file;};
  const scoreFile=asset(props.scoreSrc),audioFile=asset(props.audioSrc),audioEvidence=read(job.audioProduction.evidence);
  if(job.audioProduction.kind!=='sampled-score-export'||audioEvidence.engine?.profile!=='MuseScore Basic'||
    audioEvidence.audioSha256!==hash(audioFile)||audioEvidence.musicSha256!==sourceIdentity)fail('Source master is not the bound sampled piano audio');
  return {job,props,score,keyframes,receipt,scoreFile,audioFile,audioEvidence,musicSha256:sourceIdentity,targetMusicSha256:targetMusicIdentity(props.timeline)};
}
export function inheritedScoreApproval(record,{musicSha256}={}){
  const s=approvedHistoricalSource(record.source);
  if(record.schema!=='aiyoupu-inherited-score-approval/v1'||record.musicSha256!==s.musicSha256||musicSha256&&musicSha256!==s.targetMusicSha256)fail('Notation changed during migration');
  return {request:s.score.request,response:s.score.response,approval:record,scope:'Unchanged source notation only; no inherited V2 keyframe approval'};
}
