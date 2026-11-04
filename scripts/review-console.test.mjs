#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requestReview} from './review.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-review-console-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKXGQAAAAASUVORK5CYII=','base64');
const file=path.join(temp,'frame.png');fs.writeFileSync(file,png);
requestReview({stage:'keyframes',out:path.join(temp,'review'),files:[file],display:[file],jobSha256:'review-console-job',notes:['test']});
// Score-stage page collects the audio decision before the user can confirm.
const svg=path.join(temp,'score.svg');fs.writeFileSync(svg,'<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>');
requestReview({stage:'score',out:path.join(temp,'score-review'),files:[svg],display:[svg],musicSha256:'score-music',notes:['audio gate']});
const request=path.join(temp,'review','request.json');
const port=7861,child=spawn(process.execPath,[path.join(root,'scripts','aiyoupu-workbench-approval.mjs'),'--request',request,'--out',path.join(temp,'approval.json'),'--port',String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
try{
 let page=null;for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/');if(r.ok){page=await r.text();break;}}catch{}await wait(100);}
 assert.ok(page,'review console did not start: '+output);
 assert.match(page,/人工内容确认页/);
 const media=await fetch('http://127.0.0.1:'+port+'/view/0');assert.equal(media.status,200);assert.match(media.headers.get('content-type'),/^image\/png/);
 const state=page.match(/const credential=(\{[^;]+\});/);assert.ok(state,'credential was not rendered');
 const credential=JSON.parse(state[1]);
 const response=await fetch('http://127.0.0.1:'+port+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credential,clickedAt:new Date().toISOString()})});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.status,'KEYFRAMES_USER_APPROVED');assert.ok(fs.existsSync(result.approval));
 // Separate score request proves the visible choice is recorded only after
 // the user picks one; no missing value can be treated as approval evidence.
 const scoreChild=spawn(process.execPath,[path.join(root,'scripts','aiyoupu-workbench-approval.mjs'),'--request',path.join(temp,'score-review','request.json'),'--out',path.join(temp,'score-approval.json'),'--port',String(port+1)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{
  let scorePage=null;for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+(port+1)+'/');if(r.ok){scorePage=await r.text();break;}}catch{}await wait(100);}
  assert.match(scorePage,/id="audio"/);
  const scoreState=scorePage.match(/const credential=(\{[^;]+\});/),scoreCredential=JSON.parse(scoreState[1]);
  const missing=await fetch('http://127.0.0.1:'+(port+1)+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scoreCredential,clickedAt:new Date().toISOString()})});assert.equal(missing.status,400);
  const chosen=await fetch('http://127.0.0.1:'+(port+1)+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...scoreCredential,audioChoice:'silent',clickedAt:new Date().toISOString()})});const scoreResult=await chosen.json();assert.equal(chosen.status,200,JSON.stringify(scoreResult));assert.equal(scoreResult.status,'SCORE_USER_APPROVED');
 }finally{scoreChild.kill();}
 console.log(JSON.stringify({status:'PASS',groups:['separate page','media served','one-time click credential','approval bound to displayed content','audio choice required'],approval:result.approval},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{child.kill();await wait(200);fs.rmSync(temp,{recursive:true,force:true});}
