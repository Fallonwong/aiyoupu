#!/usr/bin/env node
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const puppeteerPath=[process.env.AIYOUPU_PUPPETEER_CORE,'E:/remotion-workspace/.cache/aiyoupu-v200/workbench-original/node_modules/puppeteer-core'].find(p=>p&&fs.existsSync(p));
if(!puppeteerPath)throw Error('Set AIYOUPU_PUPPETEER_CORE to an existing installed puppeteer-core; no install is attempted.');
const puppeteer=require(puppeteerPath);
const url=process.argv[2]??'http://127.0.0.1:7834/';
const browserPath=[process.env.AIYOUPU_BROWSER,'E:/remotion-workspace/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'].find(p=>p&&fs.existsSync(p));
if(!browserPath)throw Error('Set AIYOUPU_BROWSER to an existing Chromium/Edge executable; no install is attempted.');
const browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:900});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__playerRef);
 await new Promise(r=>setTimeout(r,400));
 await page.click('#play');
 await new Promise(r=>setTimeout(r,800));
 await page.click('#pause');
 const before=await page.evaluate(()=>({playing:window.__playerRef.isPlaying(),frame:window.__playerRef.getCurrentFrame()}));
 await page.$eval('#scale',e=>{e.value='2.1';e.dispatchEvent(new Event('input',{bubbles:true}))});
 await new Promise(r=>setTimeout(r,1800));
 const after=await page.evaluate(()=>({playing:window.__playerRef.isPlaying(),frame:window.__playerRef.getCurrentFrame(),scale:document.getElementById('scaleVal').textContent,status:document.getElementById('saveMessage').textContent}));
 const report={status:before.playing? 'needs_review':'PASS',before,after,errors};
 fs.writeFileSync('workbench/verify-pause-result.json',JSON.stringify(report,null,2)+'\n');
 if(after.playing||Math.abs(after.frame-before.frame)>2||errors.length)throw Error(JSON.stringify(report));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
