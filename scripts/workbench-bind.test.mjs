#!/usr/bin/env node
// The real review page returns a v2 approval. Feed that exact result into the
// same bind consumer and prove a missing formal quality packet blocks, while
// the audio decision is readable rather than throwing a TypeError.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {requestReview,requireApproval,approvalAudioChoice} from './review.mjs';
import {openWorkbenchSession,confirmWorkbenchApproval} from './workbench-approval.mjs';
import {bindJob} from './aiyoupu.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-bind-v2-'));
try{
 const dir=path.join(root,'case'),publicDir=path.join(dir,'public');fs.mkdirSync(publicDir,{recursive:true});
 const svg=path.join(publicDir,'score.svg');fs.writeFileSync(svg,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
 const timeline={fps:30,durationInFrames:1,scoreWidth:10,scoreHeight:10,events:[{hand:'right',frame:0,x:1,y:1,notes:[{x:1,y:1,pitch:'C4',durationFrames:1,voice:'1',part:'P1'}]}],focusPath:[{focusX:1,focusY:1}]};
 const request=path.join(dir,'review');requestReview({stage:'score',out:request,files:[svg],display:[svg],musicSha256:'music-v2',notes:['real page approval']});
 const serverKey=crypto.randomBytes(24).toString('hex'),session=openWorkbenchSession({serverKey,request:path.join(request,'request.json')});
 const credential={provider:'workbench',sessionId:session.sessionId,nonce:session.nonce,displayedSha256:session.displaySha256,requestId:session.requestId,bundleSha256:session.bundleSha256,stage:session.stage,clickedAt:new Date().toISOString()};
 const approved=confirmWorkbenchApproval({request:path.join(request,'request.json'),credential,out:path.join(dir,'approval.json'),audioChoice:'provided'});
 assert.equal(approved.status,'SCORE_USER_APPROVED');
 const review=requireApproval(approved.approval,'score',{musicSha256:'music-v2'});
 assert.equal(review.response.source,'workbench');
 assert.equal(review.response.audioChoice,'provided');
 assert.equal(review.response.requestId,approved.requestId);
 assert.equal(review.response.displaySha256,approved.displaySha256);
 assert.equal(review.response.credential.provider,'workbench');
 assert.equal(approvalAudioChoice(review),'provided');
 const props=path.join(dir,'props.json');fs.writeFileSync(props,JSON.stringify({timeline,scoreSrc:'score.svg'}));
 let error=null;try{bindJob({project:dir,'asset-project':dir,props,production:path.join(dir,'missing-production.json'),'score-approval':approved.approval,'source-type':'svg',out:path.join(dir,'job.json')});}catch(e){error=e;}
 assert.ok(error);assert.notEqual(error instanceof TypeError,true);
 assert.equal(error.code,'ENOENT','bind must consume the v2 approval and then fail only on the missing formal production input');
 console.log(JSON.stringify({status:'PASS',checks:['real v2 approval identity','audioChoice through compatibility view','bind consumes v2 without TypeError','formal input still blocks'],requestId:review.response.requestId,approvalSha256:review.response.approvalSha256},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
