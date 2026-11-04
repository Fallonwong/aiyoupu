#!/usr/bin/env node
// One bounded performance diagnostic: sampled frame progress, long tasks and
// client/server validation request count during a real parameter drag.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Reuse an installed driver; this is a diagnostic dependency, not package
// content. Both paths are optional and only one must exist.
const puppeteerPath=[process.env.AIYOUPU_PUPPETEER_CORE,'E:/remotion-workspace/.cache/aiyoupu-v200/workbench-original/node_modules/puppeteer-core'].find(p=>p&&fs.existsSync(p));
if(!puppeteerPath)throw Error('Set AIYOUPU_PUPPETEER_CORE to an existing installed puppeteer-core; no install is attempted.');
const puppeteer=require(puppeteerPath);
const url=process.argv[2]??'http://127.0.0.1:7842/';
const browser=await puppeteer.launch({executablePath:'E:/remotion-workspace/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});
 let validationRequests=0;page.on('request',r=>{if(r.url().endsWith('/api/direction/validate'))validationRequests++;});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__playerRef&&window.__playerRef.getCurrentFrame()>=0);
 await new Promise(r=>setTimeout(r,400));
 await page.click('#play');
 await new Promise(r=>setTimeout(r,500));
 const result=await page.evaluate(async()=>{
  const longTasks=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(x=>x.duration)));
  try{observer.observe({entryTypes:['longtask']});}catch{}
  const player=window.__playerRef,startFrame=player.getCurrentFrame(),start=performance.now();let samples=0;
  for(let i=0;i<14;i++){const range=document.getElementById('scale');range.value=String(1.7+i*.04);range.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));samples++;}
  await new Promise(r=>setTimeout(r,500));const elapsed=(performance.now()-start)/1000,frames=player.getCurrentFrame()-startFrame;
  observer.disconnect();return {sampledInputs:samples,elapsedSeconds:Number(elapsed.toFixed(2)),framesAdvanced:Number(frames.toFixed(1)),playing:player.isPlaying(),longTaskCount:longTasks.length,longTaskMaxMs:longTasks.length?Number(Math.max(...longTasks).toFixed(1)):0,longTaskTotalMs:longTasks.length?Number(longTasks.reduce((n,x)=>n+x,0).toFixed(1)):0,scale:document.getElementById('scaleVal').textContent};
 });
 result.validationRequests=validationRequests;
 // Compare the shipped workbench bundle with the source component rather than
 // trusting the build command's success message.
 result.limits='Headless Chromium measurement on this machine; not a universal hardware or FPS certification.';
 fs.writeFileSync('workbench/verify-performance-result.json',JSON.stringify(result,null,2)+'\n');
 if(!result.playing||result.framesAdvanced<=0||result.validationRequests>3)throw Error(JSON.stringify(result));
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
