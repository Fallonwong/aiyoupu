import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {extractPresets,deriveSceneProps} from './workbench-core.mjs';
const require=createRequire(import.meta.url);
const puppeteerPath=[process.env.AIYOUPU_PUPPETEER_CORE,'E:/remotion-workspace/.cache/aiyoupu-v200/workbench-original/node_modules/puppeteer-core'].find(p=>p&&fs.existsSync(p));
const browserPath=[process.env.AIYOUPU_BROWSER,'E:/remotion-workspace/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'].find(p=>p&&fs.existsSync(p));
if(!puppeteerPath||!browserPath)throw Error('Set AIYOUPU_PUPPETEER_CORE and AIYOUPU_BROWSER to existing local tools; no install is attempted.');
const puppeteer=require(puppeteerPath);
const browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--mute-audio']});
try {
 const page=await browser.newPage(),errors=[],results=[];
 await page.setViewport({width:1440,height:900});
 page.on('pageerror',e=>errors.push(e.message));
 const url=process.argv[2]??'http://127.0.0.1:7801/';
 await page.goto(url,{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>window.__setPlayerConfiguration);
 const {presets}=extractPresets(process.cwd());
 const note=(x,flags={})=>({x,y:200,pitch:'C4',voice:'1',part:'P1',staff:1,durationFrames:30,...flags});
 const timeline={fps:30,durationInFrames:91,scoreWidth:1600,scoreHeight:600,
  focusPath:Array.from({length:91},()=>({focusX:400,focusY:300})),events:[
   {hand:'right',frame:0,x:200,y:200,notes:[note(200,{tieStart:true})]},
   {hand:'right',frame:30,x:400,y:200,notes:[note(400,{tieStop:true,attack:false})]},
   {hand:'right',frame:60,x:600,y:200,notes:[note(600)]}]};
 for(const preset of presets)for(const motionFx of preset.id==='TeachingLandscape'?['converge-arc']:['converge-arc','pulse-only']){
  const props=deriveSceneProps({timeline,scoreSrc:'assets/score.svg'}, {presetId:preset.id,motionFx},presets,{pipelineAvailable:true});
  const portrait=props.aspectRatio==='9:16';
  await page.evaluate(config=>window.__setPlayerConfiguration(config),{props,width:portrait?1080:1920,height:portrait?1920:1080,durationInFrames:91,fps:30,remount:true});
  await new Promise(r=>setTimeout(r,100));
  for(const f of [30,31,45,59,60,90]){
   await page.evaluate(f=>{window.__playerRef.pause();window.__playerRef.seekTo(f);},f);
   await new Promise(r=>setTimeout(r,45));
   const counts=await page.evaluate(()=>({ellipses:document.querySelectorAll('#player svg[width="1600"][height="600"] ellipse').length,heads:document.querySelectorAll('#player svg[width="1600"][height="600"] circle').length}));
   assert.equal(counts.ellipses,f===60?2:0,`${preset.id}/${motionFx} at ${f}: only a new strike pulses`);
   if(f===90)assert.equal(counts.heads,0,'release removes final head');
   if(motionFx==='converge-arc'&&f>30&&f<60){
    const cores=await page.$$eval('#player svg[width="1600"][height="600"] circle[r="4.5"]',els=>els.map(e=>({x:+e.getAttribute('cx'),y:+e.getAttribute('cy')})));
    const t=f/60,expected={x:200+400*t,y:200-4*58*t*(1-t)};
    assert.equal(cores.length,1);
    assert(Math.abs(cores[0].x-expected.x)<.001&&Math.abs(cores[0].y-expected.y)<.001,`${preset.id}: one flight from first to third note, bypassing the second`);
   }
  }
  results.push({preset:preset.id,motionFx,status:'PASS'});
 }
 assert.deepEqual(errors,[]);
 fs.mkdirSync('workbench/verify-music',{recursive:true});
 // Check the actual source passage as well as the synthetic preset fixtures.
 const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/direction/validate')&&r.status()===200),page.select('#presetSelect','TeachingLandscape')]);
 await new Promise(r=>setTimeout(r,300));
 for(const frame of [42,44,46,48]){
  await page.evaluate(f=>{window.__playerRef.pause();window.__playerRef.seekTo(f);},frame);
  await new Promise(r=>setTimeout(r,50));
  const cores=await page.$$eval('#player svg circle[r="4.5"]',els=>els.map(e=>({x:+e.getAttribute('cx'),y:+e.getAttribute('cy')})));
  const event=state.timeline.events.find(e=>e.hand==='right'&&e.frame>41&&e.frame<42);
  for(const note of event.notes)assert(!cores.some(p=>Math.abs(p.x-note.x)<.001&&Math.abs(p.y-note.y)<.001),'the real continuation must not have a core or landing');
  if(frame===44)await page.screenshot({path:'workbench/verify-music/tie-frame44.png'});
 }
 fs.writeFileSync('workbench/verify-music/result.json',JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors}));
}finally{await browser.close();}
