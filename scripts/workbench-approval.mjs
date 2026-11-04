#!/usr/bin/env node
// Workbench-origin user approval protocol.
// A workbench click is a real user approval ONLY when the click carries a nonce
// issued by this backend for the exact review bundle being shown. The Agent may
// call these functions but cannot mint a credential without an open page session.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {sha256,hashObject,failure} from './audio.mjs';
import {readRequest,displayFingerprint} from './review.mjs';

export const APPROVAL_SCHEMA='aiyoupu-user-approval/v2';
export const CHALLENGE_SCHEMA='aiyoupu-workbench-challenge/v1';
const STORE_SCHEMA='aiyoupu-workbench-nonce-store/v1';
const CLOCK_SKEW_MS=5000;

export function defaultStorePath(requestFile){return path.join(path.dirname(path.resolve(requestFile)),'workbench-approval-store.json');}

function readStore(file){
  if(!fs.existsSync(file))return {schema:STORE_SCHEMA,sessions:{},serverKeySha256:null};
  let store;try{store=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){throw failure('WORKBENCH_STORE_INVALID',file,'Restore a readable nonce store; approvals cannot be validated without it.');}
  if(store?.schema!==STORE_SCHEMA||typeof store.sessions!=='object'||!store.sessions)throw failure('WORKBENCH_STORE_INVALID',file,'Restore the workbench nonce store instead of editing it.');
  return store;
}

// Called once by the workbench server at startup. The key stays in server memory;
// only its hash is persisted, so a session cannot be minted by another process.
export function initWorkbenchStore({store,serverKey}){
  if(typeof serverKey!=='string'||serverKey.length<16)throw failure('WORKBENCH_SERVER_KEY_REQUIRED','A server runtime key of at least 16 characters is required','Generate one per server launch; never write it to disk or hand it to the Agent.');
  const data=readStore(store),keySha256=sha256(serverKey);
  if(data.serverKeySha256&&data.serverKeySha256!==keySha256)throw failure('WORKBENCH_SERVER_KEY_INVALID',store,'Use the key created when this store was initialized, or start a new review.');
  data.serverKeySha256=keySha256;
  writeAtomic(store,data);
  return {store:path.resolve(store),serverKeySha256:keySha256,sessions:Object.keys(data.sessions).length};
}

/** Start a server whose runtime key is fresh on every launch.
 *  Only unexpired one-time challenges are dropped; approvals already written to
 *  disk are untouched, so a restart can never resurrect a stale session. */
export function initWorkbenchStoreForRestart({store,serverKey}){
  const data=readStore(store),keySha256=sha256(serverKey);
  const dropped=Object.keys(data.sessions).length;
  data.sessions={};
  data.serverKeySha256=keySha256;
  writeAtomic(store,data);
  return {store:path.resolve(store),serverKeySha256:keySha256,sessions:0,droppedSessions:dropped};
}

function writeAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.tmp-'+crypto.randomUUID();
  fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');
  fs.renameSync(temp,file);
}

const isTime=v=>typeof v==='string'&&!Number.isNaN(Date.parse(v));
const sessionCore=s=>({schema:s.schema,sessionId:s.sessionId,request:s.request,requestSha256:s.requestSha256,requestId:s.requestId,bundleSha256:s.bundleSha256,stage:s.stage,displaySha256:s.displaySha256,nonceSha256:s.nonceSha256,issuedAt:s.issuedAt,expiresAt:s.expiresAt});
const macOf=(serverKey,session)=>crypto.createHmac('sha256',serverKey).update(hashObject(sessionCore(session))).digest('hex');

// Called by the workbench server when it renders/hosts a review page. Returns the
// one-time nonce that the page must send back with the user's click.
export function openWorkbenchSession({request,store=defaultStorePath(request),serverKey,stage=null,ttlMs=30*60*1000,now=new Date(),sessionId='WS-'+crypto.randomUUID()}){
  const r=readRequest(request),requestSha256=sha256(fs.readFileSync(request));
  if(!['score','keyframes'].includes(r.stage))throw failure('REVIEW_STAGE_INVALID',r.stage,'Use score or keyframes.');
  if(stage&&stage!==r.stage)throw failure('REVIEW_STAGE_INVALID',stage,'Open a session for the stage this request actually covers.');
  if(!Number.isFinite(ttlMs)||ttlMs<=0)throw failure('WORKBENCH_TTL_INVALID',ttlMs,'Use a positive session lifetime.');
  const issuedAt=new Date(now).toISOString(),expiresAt=new Date(Date.parse(issuedAt)+ttlMs).toISOString();
  const nonce=crypto.randomBytes(32).toString('hex'),displaySha256=displayFingerprint(r);
  if(typeof serverKey!=='string'||serverKey.length<16)throw failure('WORKBENCH_SERVER_KEY_REQUIRED','Only the running workbench server can open a confirmation session','Call this from the server process; the page must receive the nonce from it.');
  const data=readStore(store),keySha256=sha256(serverKey);
  if(!data.serverKeySha256){data.serverKeySha256=keySha256;}
  else if(data.serverKeySha256!==keySha256)throw failure('WORKBENCH_SERVER_KEY_INVALID',store,'Use the key created when this store was initialized, or start a new review.');
  const entry={schema:CHALLENGE_SCHEMA,sessionId,request:path.resolve(request),requestSha256,requestId:r.id,bundleSha256:r.bundleSha256,stage:r.stage,displaySha256,nonceSha256:sha256(nonce),issuedAt,expiresAt,consumedAt:null};
  entry.mac=macOf(serverKey,entry);
  data.sessions[sessionId]=entry;
  writeAtomic(store,data);
  return {schema:CHALLENGE_SCHEMA,sessionId,nonce,request:path.resolve(request),requestId:r.id,bundleSha256:r.bundleSha256,stage:r.stage,displaySha256,issuedAt,expiresAt};
}

// Validate a click credential and write the tamper-evident approval record.
export function confirmWorkbenchApproval({request,credential,out,store=defaultStorePath(request),jobSha256=null,propsSha256=null,audioChoice=null,now=new Date()}){
  const fail=(code,message,next)=>failure(code,message,next??'Keep the review open, show the current bundle, and let the user click confirm themselves.');
  if(!credential||typeof credential!=='object')throw fail('WORKBENCH_CREDENTIAL_REQUIRED','No workbench interaction credential was supplied','Only a click produced by the workbench page can approve; Agent-written JSON is not a user approval.');
  if(credential.provider!=='workbench')throw fail('WORKBENCH_PROVIDER_INVALID',`Unsupported approval provider: ${String(credential.provider??'missing')}`,'Open the review in the workbench page and let the user confirm there.');
  const required=['sessionId','nonce','displayedSha256','requestId','bundleSha256','stage'];
  if(required.some(k=>typeof credential[k]!=='string'||!credential[k].trim())||!isTime(credential.clickedAt))throw fail('WORKBENCH_CREDENTIAL_INCOMPLETE','The click credential is missing sessionId, nonce, displayedSha256, requestId, bundleSha256, stage or clickedAt','Reload the review page so it can attach the full click credential.');

  const r=readRequest(request),requestSha256=sha256(fs.readFileSync(request)),expectedDisplay=displayFingerprint(r);
  if(credential.requestId!==r.id||credential.bundleSha256!==r.bundleSha256||credential.stage!==r.stage)throw fail('WORKBENCH_REQUEST_MISMATCH','Credential belongs to a different review request','Confirm the currently displayed request; do not reuse another one.');
  const data=readStore(store),session=data.sessions[credential.sessionId];
  if(!session||session.requestId!==r.id||session.bundleSha256!==r.bundleSha256||session.stage!==r.stage)throw fail('WORKBENCH_SESSION_INVALID','No open workbench session matches this request','Open a new session from the workbench page.');
  if(session.requestSha256!==requestSha256||session.displaySha256!==expectedDisplay)throw fail('WORKBENCH_DISPLAY_MISMATCH','The review bundle changed after the session was opened','Reopen the session against the current request.');
  if(session.consumedAt)throw fail('WORKBENCH_NONCE_REPLAY',`Nonce already used at ${session.consumedAt}`,'A nonce approves once; display a new review before any further confirmation.');
  if(sha256(credential.nonce)!==session.nonceSha256)throw fail('WORKBENCH_NONCE_INVALID','Nonce does not belong to this session','Reload the page; never copy or invent a nonce.');
  if(credential.displayedSha256!==expectedDisplay)throw fail('WORKBENCH_DISPLAY_MISMATCH','The content the page reported is not the content in the review bundle','Re-render the page from the current request, then confirm again.');
  const clickedAt=Date.parse(credential.clickedAt),issuedAt=Date.parse(session.issuedAt),expiresAt=Date.parse(session.expiresAt);
  if(!Number.isFinite(clickedAt)||clickedAt<issuedAt-CLOCK_SKEW_MS||clickedAt>expiresAt)throw fail('WORKBENCH_CREDENTIAL_EXPIRED','Click time is outside the session window','Show the review again and let the user click within the session lifetime.');
  if(fs.existsSync(out))throw failure('WORKBENCH_ALREADY_APPROVED',out,'Keep the existing approval; a second approval for the same request is not allowed.');

  const chosenAudio=r.stage==='score'?audioChoice??credential.audioChoice:null;
  if(r.stage==='score'&&!['provided','synthesize','silent'].includes(chosenAudio))throw fail('AUDIO_DECISION_REQUIRED','The score confirmation must record the user audio choice','Select provided audio, generated audio, or explicit silence before confirming the score.');
  // Validate every decision field before consuming the one-time session, so a
  // missing audio choice is a correctable interaction, not a burned nonce.
  data.sessions[credential.sessionId].consumedAt=new Date(now).toISOString();
  data.sessions[credential.sessionId].consumedClickAt=new Date(clickedAt).toISOString();
  writeAtomic(store,data);
  const body={schema:APPROVAL_SCHEMA,source:'workbench',stage:r.stage,decision:'approve',request:path.resolve(request),requestSha256,requestId:r.id,bundleSha256:r.bundleSha256,displaySha256:expectedDisplay,musicSha256:r.musicSha256??null,jobSha256:jobSha256??r.jobSha256??null,propsSha256:propsSha256??null,...(chosenAudio?{audioChoice:chosenAudio}:{}),approvedAt:new Date(now).toISOString(),nonceStore:path.resolve(store),credential:{provider:'workbench',sessionId:credential.sessionId,nonceSha256:session.nonceSha256,sessionMac:session.mac,issuedAt:session.issuedAt,expiresAt:session.expiresAt,clickedAt:new Date(clickedAt).toISOString(),displaySha256:expectedDisplay}};
  const approval={...body,approvalSha256:hashObject(body)};
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(approval,null,2)+'\n',{flag:'wx'});
  return {status:r.stage==='score'?'SCORE_USER_APPROVED':'KEYFRAMES_USER_APPROVED',approval:path.resolve(out),requestId:r.id,displaySha256:expectedDisplay,approvalSha256:approval.approvalSha256,next:r.stage==='score'?'Proceed to actual-song setup, keyframes and short audition; full render still requires the keyframe approval.':'Render this exact reviewed job; do not change its props or inputs.'};
}

// Verification side: confirm the consumed server-issued session still matches.
// When the server key is present in env, also verify the session HMAC.
export function verifyWorkbenchSession(approval,{serverKey=process.env.AIYOUPU_WORKBENCH_SERVER_KEY}={}){
  const store=approval?.nonceStore,sessionId=approval?.credential?.sessionId;
  if(!store||!sessionId)throw failure('USER_APPROVAL_INVALID',sessionId??'missing session','Approve from the workbench page so the record references its nonce store.');
  const data=readStore(store),session=data.sessions?.[sessionId];
  if(!session)throw failure('USER_APPROVAL_INVALID',sessionId,'The server-issued session for this approval no longer exists; obtain a new confirmation.');
  if(!session.consumedAt)throw failure('USER_APPROVAL_INVALID',sessionId,'This session was never consumed by a user click.');
  if(session.mac!==approval.credential.sessionMac||session.nonceSha256!==approval.credential.nonceSha256||session.requestId!==approval.requestId||session.bundleSha256!==approval.bundleSha256||session.displaySha256!==approval.displaySha256)throw failure('USER_APPROVAL_INVALID',sessionId,'Approval does not match the server-issued nonce session.');
  if(session.requestSha256!==approval.requestSha256||session.request!==approval.request||session.consumedClickAt!==approval.credential.clickedAt)throw failure('USER_APPROVAL_INVALID',sessionId,'Approval request or click time does not match the consumed session.');
  if(serverKey&&session.mac!==macOf(serverKey,session))throw failure('USER_APPROVAL_INVALID',sessionId,'Session HMAC does not verify against the server key.');
  return {...session,verification:serverKey?'hmac':'structural'};
}
