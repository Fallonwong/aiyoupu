#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const puppeteerPath=[process.env.AIYOUPU_PUPPETEER_CORE,'E:/remotion-workspace/.cache/aiyoupu-v200/workbench-original/node_modules/puppeteer-core'].find(p=>p&&fs.existsSync(p));
if(!puppeteerPath)throw Error('Set AIYOUPU_PUPPETEER_CORE to an existing installed puppeteer-core; no install is attempted.');
const puppeteer=require(puppeteerPath);
const url=process.argv[2]??'http://127.0.0.1:7821/';
const out=process.argv[3]??path.resolve('workbench/verify-direction.json');
// Headless Edge intermittently fails when reusing the installed browser
// profile. The existing offline shell is the pinned Chromium used by Remotion.
const browserPath=[process.env.AIYOUPU_BROWSER,'E:/remotion-workspace/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'].find(p=>p&&fs.existsSync(p));
if(!browserPath)throw Error('Set AIYOUPU_BROWSER to an existing Chromium/Edge executable; no install is attempted.');
const browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const page=await browser.newPage();
await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
const errors=[];
page.on('response',r=>{if(r.status()>=400)errors.push({url:r.url(),status:r.status()})});
page.on('pageerror',e=>errors.push({message:e.message}));
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__playerRef||document.querySelector('#notice:not([hidden])'),{timeout:60000});
 await page.screenshot({path:out.replace(/\.json$/,'.png'),fullPage:false});
 const forbidden=await page.evaluate(()=>['fileInput','taskSelect','prepareTask','reviewConfirm','saveDirection','keyframes','stepbar','materialsColumn','reviewCard'].filter(id=>document.getElementById(id)));
 const labels=await page.evaluate(()=>document.body.innerText);
 const oldLabels=['开始准备','上传素材','导入本地素材','新曲','素材准备','关键帧','审批'].filter(x=>labels.includes(x));
 await page.evaluate(()=>document.getElementById('play').click());
 await new Promise(r=>setTimeout(r,1800));
 const playback=await page.evaluate(()=>{const audioElement=document.querySelector('#player audio');const silent=document.getElementById('audioState').textContent.includes('无音轨');const player=window.__playerRef;let playing=false;try{playing=silent?Boolean(player?.isPlaying()):Boolean(audioElement&&!(audioElement.paused||audioElement.ended));}catch{}return {frame:Number(document.getElementById('frame').textContent.split(' ')[0]),time:audioElement?.currentTime??null,audioState:document.getElementById('audioState').textContent,playing,silent};});
 await page.evaluate(()=>{const e=document.getElementById('titleScale');e.value='1.3';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await new Promise(r=>setTimeout(r,1300));
 const afterChange=await page.evaluate(()=>{const audioElement=document.querySelector('#player audio'),silent=document.getElementById('audioState').textContent.includes('无音轨'),player=window.__playerRef;let playing=false;try{playing=silent?Boolean(player?.isPlaying()):Boolean(audioElement&&!(audioElement.paused||audioElement.ended));}catch{}return {frame:Number(document.getElementById('frame').textContent.split(' ')[0]),time:audioElement?.currentTime??null,titleScale:document.getElementById('titleScaleVal').textContent,playing,silent};});
 await page.click('#presetSelect');
 await page.select('#presetSelect','SapphireLandscape');
 await new Promise(r=>setTimeout(r,1700));
 const landscape=await page.evaluate(()=>({presetStatus:document.getElementById('presetStatus').textContent,frame:Number(document.getElementById('frame').textContent.split(' ')[0]),audioState:document.getElementById('audioState').textContent}));
 await page.click('#save');
 await page.waitForFunction(()=>!document.getElementById('copy').hidden,{timeout:60000});
 const saved=await page.evaluate(()=>({message:document.getElementById('saveMessage').textContent,prompt:document.getElementById('prompt').value,copyVisible:!document.getElementById('copy').hidden}));
 const report={status:'direction_console_verified',url,forbidden,oldLabels,playback,afterChange,landscape,saved,errors};
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 if(forbidden.length||oldLabels.length||errors.length||!playback.playing||(!playback.silent&&playback.time<0.2)||(!playback.silent&&afterChange.time<playback.time)||(playback.silent&&!afterChange.playing)||saved.copyVisible===false||!saved.prompt.includes('继续 AI有谱'))throw Error('Direction workbench assertions failed: '+JSON.stringify(report));
 console.log(JSON.stringify({status:'PASS',forbidden,oldLabels,playback,afterChange,landscape,errorCount:errors.length,promptLength:saved.prompt.length},null,2));
}finally{await browser.close();}
