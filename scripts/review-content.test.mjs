#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {requestReview,scoreRequest} from './review.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-review-content-'));
try{
 const png=path.join(root,'frame.png');fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKXGQAAAAASUVORK5CYII=','base64'));
 const html=path.join(root,'comparison.html');fs.writeFileSync(html,'<!doctype html><title>comparison</title>');
 const plain=path.join(root,'score.svg');fs.writeFileSync(plain,'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
 const timeline=path.join(root,'timeline.json');fs.writeFileSync(timeline,JSON.stringify({fps:30,durationInFrames:2,scoreWidth:10,scoreHeight:10,focusPath:[{focusX:0,focusY:0},{focusX:0,focusY:0}],events:[{hand:'right',frame:0,x:1,y:1,notes:[{x:1,y:1,pitch:'C4'}]}]}));
 const linked=scoreRequest({source:plain,sourceType:'svg',timeline,score:html,out:path.join(root,'linked-review')});
 assert.equal(linked.status,'WAITING_FOR_SCORE_APPROVAL');
 assert.throws(()=>requestReview({stage:'score',out:path.join(root,'unshown'),files:[plain,timeline],display:[],musicSha256:'m'}),e=>e.code==='REVIEW_CONTENT_UNSUPPORTED');
 const review=requestReview({stage:'score',out:path.join(root,'shown'),files:[plain,timeline],display:[plain],musicSha256:'m'});
 const htmlText=fs.readFileSync(review.review,'utf8');
 assert.match(htmlText,/id="audio"/);
 assert.match(htmlText,/REVIEW_CONTENT_UNSUPPORTED|确认本版/);
 console.log(JSON.stringify({status:'PASS',groups:['source link allowed','hidden binary blocked','score page audio choice','score display bound']},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
