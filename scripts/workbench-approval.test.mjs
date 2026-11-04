import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {requestReview,approveReview,requireApproval,readRequest,approvalAudioChoice} from './review.mjs';
import {bindJob} from './aiyoupu.mjs';
import {openWorkbenchSession,confirmWorkbenchApproval} from './workbench-approval.mjs';
import {hashObject,sha256} from './audio.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-workbench-approval-'));
const serverKey=crypto.randomBytes(24).toString('hex');
let seq=0;
const newDir=()=>path.join(root,'case-'+(++seq));
const put=(dir,name,content)=>{const file=path.join(dir,name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,content);return file;};
const expectCode=(fn,code)=>assert.throws(fn,e=>e.code===code,`expected ${code}`);

function makeReview({stage='score',musicSha256='music-A',jobSha256=null}={}){
  const dir=newDir(),svg=put(dir,'score.svg','<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  const out=path.join(dir,'review');
  requestReview({stage,out,files:[svg],display:[svg],musicSha256,jobSha256,notes:['protocol test']});
  return {dir,out,request:path.join(out,'request.json'),review:path.join(out,'index.html'),svg};
}
function click(session,overrides={}){
  return {provider:'workbench',sessionId:session.sessionId,nonce:session.nonce,displayedSha256:session.displaySha256,requestId:session.requestId,bundleSha256:session.bundleSha256,stage:session.stage,clickedAt:new Date().toISOString(),...overrides};
}

// 1. Legal workbench confirmation, then requireApproval accepts it.
{
  const j=makeReview({jobSha256:'job-A'}),session=openWorkbenchSession({serverKey,request:j.request});
  assert.equal(session.bundleSha256,readRequest(j.request).bundleSha256);
  const result=confirmWorkbenchApproval({request:j.request,credential:click(session),out:path.join(j.dir,'approval.json'),jobSha256:'job-A',audioChoice:'provided'});
  assert.equal(result.status,'SCORE_USER_APPROVED');
  const record=JSON.parse(fs.readFileSync(result.approval,'utf8'));
  assert.equal(record.schema,'aiyoupu-user-approval/v2');
  assert.equal(record.source,'workbench');
  assert.equal(record.decision,'approve');
  assert.equal(record.credential.provider,'workbench');
  assert.ok(record.credential.nonceSha256);
  assert.equal(record.credential.nonce,undefined,'raw nonce must never be stored in the approval');
  assert.ok(record.approvalSha256);
  const verified=requireApproval(result.approval,'score',{musicSha256:'music-A',jobSha256:'job-A'});
  assert.equal(verified.approval.source,'workbench');
  // The compatibility view is the actual consumed approval identity, not a
  // synthesized user response. This runs the same boundary used by bindJob.
  assert.equal(verified.response.source,'workbench');
  assert.equal(verified.response.requestId,record.requestId);
  assert.equal(verified.response.approvalSha256,record.approvalSha256);
  assert.equal(verified.response.credential.sessionId,record.credential.sessionId);
  assert.equal(verified.response.approvedAt,record.approvedAt);
  assert.equal(verified.response.credential.clickedAt,record.credential.clickedAt);
  assert.equal(verified.response.bundleSha256,record.bundleSha256);
  assert.equal(verified.response.actor,undefined,'v2 compatibility must not invent a user identity');
  assert.equal(verified.response.messageRef,undefined,'v2 compatibility must not invent chat evidence');
  assert.equal(approvalAudioChoice(verified),'provided');
  // Exercise the actual bind consumer, not only the view. The bind must stop
  // at the next real input requirement rather than fail on response.audioChoice.
  const project=path.join(j.dir,'project'),publicDir=path.join(project,'public');fs.mkdirSync(publicDir,{recursive:true});
  const score=path.join(publicDir,'score.svg');fs.writeFileSync(score,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
  const timeline={fps:30,durationInFrames:1,scoreWidth:10,scoreHeight:10,events:[{hand:'right',frame:0,x:1,y:1,notes:[{x:1,y:1,pitch:'C4',durationFrames:1,voice:'1',part:'P1'}]}],focusPath:[{focusX:1,focusY:1}]};
  const props=path.join(j.dir,'props.json');fs.writeFileSync(props,JSON.stringify({timeline,scoreSrc:'score.svg'}));
  let bindError=null;try{bindJob({project,props,out:path.join(j.dir,'bind.json'),production:path.join(j.dir,'missing-production.json'),'score-approval':result.approval,'source-type':'svg'});}catch(e){bindError=e;}
  assert.ok(bindError,'bind must reject missing production or later required evidence');
  assert.notEqual(bindError instanceof TypeError,true,'bind must not TypeError on a real v2 approval');
  assert.equal(bindError.code,'ENOENT','bind reaches production input load after accepting the real v2 approval identity');
  console.log('ok  1 legal workbench confirmation accepted');
}

// 2. Missing / invented credential is rejected as Agent self-approval.
{
  const j=makeReview();
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:null,out:path.join(j.dir,'a.json')}),'WORKBENCH_CREDENTIAL_REQUIRED');
  expectCode(()=>openWorkbenchSession({request:j.request,store:path.join(j.dir,'agent-store.json')}),'WORKBENCH_SERVER_KEY_REQUIRED');
  const agentStore=path.join(j.dir,'agent-store.json');
  openWorkbenchSession({request:j.request,store:agentStore,serverKey});
  expectCode(()=>openWorkbenchSession({request:j.request,store:agentStore,serverKey:'another-process-key-123'}),'WORKBENCH_SERVER_KEY_INVALID');
  const session=openWorkbenchSession({serverKey,request:j.request});
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:{...click(session),provider:'agent'},out:path.join(j.dir,'b.json')}),'WORKBENCH_PROVIDER_INVALID');
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:{...click(session),nonce:''},out:path.join(j.dir,'c.json')}),'WORKBENCH_CREDENTIAL_INCOMPLETE');
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:click(session,{nonce:'0'.repeat(64)}),out:path.join(j.dir,'d.json')}),'WORKBENCH_NONCE_INVALID');
  assert.equal(fs.existsSync(path.join(j.dir,'a.json'))||fs.existsSync(path.join(j.dir,'b.json'))||fs.existsSync(path.join(j.dir,'c.json'))||fs.existsSync(path.join(j.dir,'d.json')),false);
  console.log('ok  2 missing/invented credential rejected');
}

// 3. Content hash must match what the page displayed.
{
  const j=makeReview({stage:'keyframes'}),session=openWorkbenchSession({serverKey,request:j.request,store:path.join(j.dir,'store.json')});
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:click(session,{displayedSha256:'f'.repeat(64)}),out:path.join(j.dir,'a.json'),store:path.join(j.dir,'store.json')}),'WORKBENCH_DISPLAY_MISMATCH');
  const changed=makeReview({stage:'keyframes'});
  const s2=openWorkbenchSession({serverKey,request:changed.request,store:path.join(changed.dir,'store.json')});
  expectCode(()=>confirmWorkbenchApproval({request:changed.request,credential:click(s2,{displayedSha256:'e'.repeat(64)}),out:path.join(changed.dir,'a.json'),store:path.join(changed.dir,'store.json')}),'WORKBENCH_DISPLAY_MISMATCH');
  console.log('ok  3 displayed content hash mismatch rejected');
}

// 4. Nonce is one-time: replay and duplicate approval are rejected.
{
  const j=makeReview({stage:'keyframes'}),store=path.join(j.dir,'store.json'),session=openWorkbenchSession({serverKey,request:j.request,store});
  confirmWorkbenchApproval({request:j.request,credential:click(session),out:path.join(j.dir,'approval.json'),store});
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:click(session),out:path.join(j.dir,'approval-2.json'),store}),'WORKBENCH_NONCE_REPLAY');
  const fresh=openWorkbenchSession({serverKey,request:j.request,store});
  expectCode(()=>confirmWorkbenchApproval({request:j.request,credential:click(fresh),out:path.join(j.dir,'approval.json'),store}),'WORKBENCH_ALREADY_APPROVED');
  assert.equal(fs.existsSync(path.join(j.dir,'approval-2.json')),false);
  console.log('ok  4 nonce replay and duplicate approval rejected');
}

// 5. Job/props change invalidates an existing workbench approval.
{
  const j=makeReview({stage:'keyframes',jobSha256:'job-A'}),store=path.join(j.dir,'store.json');
  const result=confirmWorkbenchApproval({request:j.request,credential:click(openWorkbenchSession({serverKey,request:j.request,store})),out:path.join(j.dir,'approval.json'),store,jobSha256:'job-A',propsSha256:'props-A'});
  expectCode(()=>requireApproval(result.approval,'keyframes',{jobSha256:'job-B'}),'USER_APPROVAL_STALE');
  expectCode(()=>requireApproval(result.approval,'keyframes',{jobSha256:'job-A',propsSha256:'props-B'}),'USER_APPROVAL_STALE');
  assert.ok(requireApproval(result.approval,'keyframes',{jobSha256:'job-A',propsSha256:'props-A'}));
  console.log('ok  5 job/props change invalidates approval');
}

// 6. Chat approval path still works unchanged, and is not accepted as workbench.
{
  const j=makeReview({jobSha256:'job-chat'}),response=put(j.dir,'response.json',JSON.stringify({schema:'aiyoupu-user-response/v1',actor:'user',requestId:readRequest(j.request).id,bundleSha256:readRequest(j.request).bundleSha256,decision:'approve',message:'确认这一版',messageRef:'chat:2026-11-03T10:00:00Z/msg-1',audioChoice:'provided'}));
  const result=approveReview({request:j.request,response,out:path.join(j.dir,'chat-approval.json')});
  assert.equal(result.status,'SCORE_USER_APPROVED');
  const record=JSON.parse(fs.readFileSync(result.approval,'utf8'));
  assert.equal(record.schema,'aiyoupu-user-approval/v1');
  assert.equal(record.source,undefined);
  const verified=requireApproval(result.approval,'score',{musicSha256:'music-A'});
  assert.equal(verified.response.actor,'user');
  expectCode(()=>requireApproval(result.approval,'keyframes'),'USER_APPROVAL_INVALID');
  console.log('ok  6 chat approval still valid');
}

// 7. Tampering with a written approval is detected.
{
  const j=makeReview({stage:'keyframes'}),store=path.join(j.dir,'store.json');
  const result=confirmWorkbenchApproval({request:j.request,credential:click(openWorkbenchSession({serverKey,request:j.request,store})),out:path.join(j.dir,'approval.json'),store});
  const record=JSON.parse(fs.readFileSync(result.approval,'utf8'));record.jobSha256='job-forged';
  put(j.dir,'forged.json',JSON.stringify(record));
  expectCode(()=>requireApproval(path.join(j.dir,'forged.json'),'keyframes'),'USER_APPROVAL_INVALID');
  console.log('ok  7 tampered approval detected');
}

// 8. A hand-written v2 record with a fabricated nonce store entry is rejected.
{
  const j=makeReview({stage:'keyframes'}),store=path.join(j.dir,'store.json'),r=readRequest(j.request),requestSha256=sha256(fs.readFileSync(j.request));
  put(j.dir,'store.json',JSON.stringify({schema:'aiyoupu-workbench-nonce-store/v1',sessions:{'WS-forged':{schema:'aiyoupu-workbench-challenge/v1',sessionId:'WS-forged',request:j.request,requestSha256,requestId:r.id,bundleSha256:r.bundleSha256,stage:'keyframes',displaySha256:'0'.repeat(64),nonceSha256:'1'.repeat(64),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),consumedAt:new Date().toISOString()}}}));
  const forged={schema:'aiyoupu-user-approval/v2',source:'workbench',stage:'keyframes',decision:'approve',request:j.request,requestSha256,requestId:r.id,bundleSha256:r.bundleSha256,displaySha256:'0'.repeat(64),musicSha256:null,jobSha256:null,propsSha256:null,approvedAt:new Date().toISOString(),nonceStore:store,credential:{provider:'workbench',sessionId:'WS-forged',nonceSha256:'1'.repeat(64),sessionMac:'f'.repeat(64),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),clickedAt:new Date().toISOString(),displaySha256:'0'.repeat(64)}};
  put(j.dir,'forged-v2.json',JSON.stringify({...forged,approvalSha256:hashObject(forged)}));
  expectCode(()=>requireApproval(path.join(j.dir,'forged-v2.json'),'keyframes'),'USER_APPROVAL_INVALID');
  console.log('ok  8 fabricated v2 record rejected without a real server session');
}

fs.rmSync(root,{recursive:true,force:true});
console.log('workbench-approval: all 8 groups passed');
