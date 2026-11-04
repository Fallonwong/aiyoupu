#!/usr/bin/env node
// Optional local confirmation page for the two human content gates. Separate
// from the one-song direction console.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {failure} from './audio.mjs';
import {isMain} from './entry.mjs';
import {initWorkbenchStoreForRestart,openWorkbenchSession,confirmWorkbenchApproval} from './workbench-approval.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url)),skillRoot=path.resolve(scripts,'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function args(argv){const a={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))throw failure('INVALID_ARGUMENT',argv[i],'Use --request <review/request.json> [--out <approval.json>] [--port <n>].');const key=argv[i].slice(2),next=argv[i+1];a[key]=next&&!next.startsWith('--')?(i++,next):true;}return a;}
function send(res,code,body,type='application/json'){res.writeHead(code,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
const json=(res,code,body)=>send(res,code,JSON.stringify(body));
const readBody=async req=>{const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>2*1024*1024)throw failure('BODY_TOO_LARGE','Approval payload is too large','Reload the page.');chunks.push(c);}const raw=Buffer.concat(chunks);return raw.length?JSON.parse(raw.toString('utf8')):{};};

export async function main(argv=process.argv.slice(2)){
 const a=args(argv),port=Number(a.port??7802);
 if(!a.request||!fs.existsSync(String(a.request)))throw failure('REVIEW_REQUEST_REQUIRED','An actual review request is required','Pass --request review/request.json.');
 const request=path.resolve(String(a.request)),dir=path.dirname(request),requestData=read(request),out=a.out?path.resolve(String(a.out)):path.join(dir,'approval.json');
 const serverKey=crypto.randomBytes(32).toString('hex'),store=path.join(skillRoot,'workbench','approvals',String(port),'sessions.json');
 initWorkbenchStoreForRestart({store,serverKey});
 let session=null;
  // This page is intentionally retired as a default content-gate route. It
  // cannot yet show every source type, so it must not record a blanket
  // approval that claims the user saw hidden material.
  const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&u.pathname==='/'){
    session=openWorkbenchSession({serverKey,request,store});
    const media=requestData.display.map((d,i)=>({file:d.file,url:'/view/'+i,original:d.original??d.file}));
    const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AI有谱 · 审片确认</title><style>body{font:15px/1.6 system-ui;background:#f4f6f8;color:#172033;margin:0;padding:20px}h1{font-size:20px}.card{max-width:1100px;margin:auto;background:#fff;border:1px solid #e2e7ee;border-radius:14px;padding:20px}img,video{max-width:100%;display:block;margin:10px auto;border-radius:7px}button{background:#101d33;color:#fff;border:0;border-radius:8px;padding:10px 20px;cursor:pointer}.warn{color:#9a4b08;background:#fff5e9;border:1px solid #f5d5ae;padding:10px;border-radius:7px}#note{color:#526079}</style></head><body><div class="card"><h1>AI有谱 · ${requestData.stage==='score'?'谱面确认':'关键帧与试听确认'}</h1><p class="warn">这是单独的人工内容确认页，不是方向台。请先实际查看下列全部内容。</p><div id="media"></div>${requestData.stage==='score'?'<label>音频方式 <select id="audio"><option value="">请选择</option><option value="provided">使用已有录音</option><option value="synthesize">生成钢琴音频</option><option value="silent">明确静音</option></select></label>':''}<button id="confirm" type="button">我已查看并确认这一版</button><p id="note">确认前请核对实际谱面/关键帧、音频与疑点；Agent 自检不等于批准。</p></div><script>const media=${JSON.stringify(media)};const box=document.getElementById('media');for(const item of media){let n;if(/\.(png|jpe?g|webp)$/i.test(item.file)){n=document.createElement('img');n.src=item.url;n.alt=item.file}else if(/\.(mp4|webm)$/i.test(item.file)){n=document.createElement('video');n.src=item.url;n.controls=true}else if(/\.(wav|mp3)$/i.test(item.file)){n=document.createElement('audio');n.src=item.url;n.controls=true}else{continue}box.appendChild(n)}const credential=${JSON.stringify({provider:'workbench',sessionId:session.sessionId,nonce:session.nonce,displayedSha256:session.displaySha256,requestId:session.requestId,bundleSha256:session.bundleSha256,stage:session.stage})};document.getElementById('confirm').onclick=async()=>{const audio=document.getElementById('audio')?.value||undefined;if(credential.stage==='score'&&!audio){document.getElementById('note').textContent='请选择音频方式再确认。';return}const r=await fetch('/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credential,audioChoice:audio,clickedAt:new Date().toISOString()})});const j=await r.json();document.getElementById('note').textContent=j.message||j.status;document.getElementById('confirm').disabled=true}</script></body></html>`;
    return send(res,200,html,'text/html');
   }
   if(req.method==='GET'&&u.pathname.startsWith('/view/')){
    const i=Number(u.pathname.slice(6)),d=requestData.display[i];if(!Number.isInteger(i)||!d)return json(res,404,{message:'Not found'});
    const file=path.resolve(dir,d.file);if(!file.startsWith(path.resolve(dir)+path.sep)||!fs.existsSync(file))return json(res,404,{message:'Missing review asset'});
    const ext=path.extname(file).toLowerCase();return send(res,200,fs.readFileSync(file),{'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg'}[ext]??'application/octet-stream');
   }
   if(req.method==='POST'&&u.pathname==='/confirm'){const b=await readBody(req);return json(res,200,confirmWorkbenchApproval({request,credential:b,out,store}));}
   return json(res,404,{message:'Not found'});
  }catch(e){return json(res,400,{code:e.code??'UNKNOWN',message:e.message,next:e.next??''});}
 });
 await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(port,'127.0.0.1',()=>{console.log(JSON.stringify({status:'approval_console_ready',url:'http://127.0.0.1:'+port+'/',request,out,stage:requestData.stage,scope:'Separate human content gate; not the direction console.'},null,2));resolve();});});
 return new Promise(()=>{});
}
if(isMain(import.meta.url)){try{await main();}catch(e){console.error(JSON.stringify({status:'blocked',code:e.code??'UNKNOWN',message:e.message,next:e.next??''},null,2));process.exitCode=2;}}
