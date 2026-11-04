#!/usr/bin/env node
// Read-only one-song direction console. Preparation, notation review, keyframes
// and approvals live in the Agent workflow. This server serves one preview bundle.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {failure} from './audio.mjs';
import {isMain} from './entry.mjs';
import {previewManifest,materializeDirection} from './direction-engine.mjs';

const scripts=path.dirname(fileURLToPath(import.meta.url)),skillRoot=path.resolve(scripts,'..');
const mime=file=>({'.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg','.webm':'video/webm','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.json':'application/json','.html':'text/html'}[path.extname(file).toLowerCase()]??'application/octet-stream');
function args(argv){const a={};for(let i=0;i<argv.length;i++){const key=argv[i].startsWith('--')?argv[i].slice(2):null;if(!key)throw failure('INVALID_ARGUMENT',argv[i],'Use --preview <preview.json> [--port 7801].');const next=argv[i+1];a[key]=next&&!next.startsWith('--')?(i++,next):true;}return a;}
function send(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
function json(res,status,body){send(res,status,JSON.stringify(body));}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>2*1024*1024)throw failure('BODY_TOO_LARGE','Direction payload is too large','Choose fewer parameters.');chunks.push(c);}try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{throw failure('JSON_INVALID','Request body is not JSON','Reload and save the direction again.');}}
const idNow=()=>'D-'+Date.now().toString(36)+'-'+crypto.randomBytes(3).toString('hex');
const enc=p=>p?p.split('/').map(encodeURIComponent).join('/'):null;

export async function main(argv=process.argv.slice(2)){
 const a=args(argv),port=Number(a.port??7801);
 if(!a.preview)throw failure('PREVIEW_REQUIRED','指定一首已准备好预览','Run aiyoupu direction prepare and pass its preview.json with --preview.');
 const preview=path.resolve(String(a.preview));previewManifest(preview);
 const root=path.dirname(preview),assetRoot=path.join(root,'assets'),client=path.join(skillRoot,'workbench');
 const state=()=>{const p=previewManifest(preview),defaults={...(p.defaultDirection??{})},m=materializeDirection({preview,direction:defaults});return {schema:'aiyoupu-direction-console/v1',displayName:'AI有谱',title:p.title??'',subtitle:p.subtitle??'',chineseTitle:p.chineseTitle??p.title??'',noteCount:m.noteCount,eventCount:m.eventCount,fps:p.timeline.fps,durationInFrames:p.timeline.durationInFrames,timeline:p.timeline,scoreSrc:p.scoreSrc,audioSrc:p.audioSrc,scoreImage:p.scoreImage??null,provenance:p.provenance??null,direction:defaults,presets:m.presets,names:m.names,pipelineAvailable:!!p.pipelineAvailable,defaultPreset:p.defaultDirection?.presetId??'SlateClassic'};};
 const server=http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/index.html'))return send(res,200,fs.readFileSync(path.join(client,'index.html')),'text/html');
   if(req.method==='GET'&&u.pathname==='/app.js')return send(res,200,fs.readFileSync(path.join(client,'app.js')),'text/javascript');
   if(req.method==='GET'&&u.pathname==='/react-bundle.js')return send(res,200,fs.readFileSync(path.join(client,'react-bundle.js')),'text/javascript');
   if(req.method==='GET'&&u.pathname==='/brand-logo.png'){
    const preview=previewManifest(path.resolve(String(a.preview)));
    const preferred=preview.files.brand?path.join(preview.root,preview.files.brand.file):path.join(client,'brand-logo.png');
    const target=fs.existsSync(preferred)?preferred:path.join(client,'brand-logo.png');
    if(!fs.statSync(target,{throwIfNoEntry:false})?.isFile())return json(res,404,{message:'FallonTalk logo is missing from this portable preview.'});
    return send(res,200,fs.readFileSync(target),'image/png');
   }
   if(req.method==='GET'&&u.pathname==='/api/state')return json(res,200,state());
   if(req.method==='GET'&&u.pathname.startsWith('/assets/')){
    const rel=u.pathname.slice('/assets/'.length).split('/').map(decodeURIComponent).join(path.sep),target=path.resolve(assetRoot,rel),base=path.resolve(assetRoot);
    if(target!==base&&!target.startsWith(base+path.sep))return json(res,403,{message:'Asset path escapes this preview.'});
    if(!fs.statSync(target,{throwIfNoEntry:false})?.isFile())return json(res,404,{message:'Preview asset is missing.'});
    // The preview server is local-only. Include the exact implementation hash
    // so a browser check can prove it used the same bundle as the candidate.
    return send(res,200,fs.readFileSync(target),mime(target));
   }
   if(req.method==='POST'&&u.pathname==='/api/direction/validate'){
    const b=await body(req),r=materializeDirection({preview,direction:b.direction});
    return json(res,200,{status:'direction_valid',direction:r.direction,directionSha256:r.directionSha256,propsSha256:r.propsSha256,width:r.width,height:r.height,fps:r.fps,durationInFrames:r.durationInFrames,mappedMeasures:r.manifest.timeline.events.reduce((n,e)=>n+(e.notes??[]).filter(x=>x.measureId).length,0),props:r.props});
   }
   if(req.method==='POST'&&u.pathname==='/api/direction/save'){
    const b=await body(req),id=idNow(),saved=materializeDirection({preview,direction:b.direction,id,save:true,outRoot:root,origin:'workbench'});
    return json(res,200,{status:'direction_saved',id,file:saved.file,prompt:saved.prompt,directionSha256:saved.directionSha256,propsSha256:saved.propsSha256});
   }
   return json(res,404,{message:'Not found.'});
  }catch(e){return json(res,e.code==='OUTPUT_EXISTS'?409:400,{code:e.code??'UNKNOWN',message:e.message,next:e.next??''});}
 });
 await new Promise((resolve,reject)=>{server.on('error',e=>reject(e.code==='EADDRINUSE'?failure('PORT_IN_USE',`Port ${port} is already in use`,'Close the other process or pass --port <n>.'):e));server.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+port+'/',ready={status:'direction_console_ready',url,preview,pid:process.pid,startedAt:new Date().toISOString()};if(typeof a['ready-file']==='string')fs.writeFileSync(a['ready-file'],JSON.stringify(ready,null,2)+'\n');console.log(JSON.stringify(ready,null,2));resolve();});});
 return new Promise(()=>{});
}
if(isMain(import.meta.url)){try{await main();}catch(e){console.error(JSON.stringify({status:'blocked',code:e.code??'UNKNOWN',message:e.message,next:e.next??''},null,2));process.exitCode=2;}}
