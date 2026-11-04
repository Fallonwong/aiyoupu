import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const puppeteerPath=[process.env.AIYOUPU_PUPPETEER_CORE,'E:/remotion-workspace/.cache/aiyoupu-v200/workbench-original/node_modules/puppeteer-core'].find(p=>p&&fs.existsSync(p));
const browserPath=[process.env.AIYOUPU_BROWSER,'E:/remotion-workspace/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'].find(p=>p&&fs.existsSync(p));
if(!puppeteerPath||!browserPath)throw Error('Set AIYOUPU_PUPPETEER_CORE and AIYOUPU_BROWSER to existing local tools; no install is attempted.');
const puppeteer=require(puppeteerPath);
const browser=await puppeteer.launch({executablePath:browserPath,headless:true,args:['--mute-audio']});
try{
 const page=await browser.newPage(),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:900});
 const url=process.argv[2]??'http://127.0.0.1:7801/';
 await page.goto(url,{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>window.__playerRef);
 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/direction/validate')&&r.status()===200),page.select('#presetSelect','TeachingLandscape')]);
 const {props}=await response.json();
 await new Promise(r=>setTimeout(r,300));
 fs.mkdirSync('workbench/verify-framing',{recursive:true});
 for(const frame of [0,120,240,360,480,600,700,770,884]){
  await page.evaluate(f=>{window.__playerRef.pause();window.__playerRef.seekTo(f);},frame);
  await new Promise(r=>setTimeout(r,50));
  const measured=await page.evaluate(({frame,timeline})=>{
   const img=document.querySelector('#player img'),ir=img.getBoundingClientRect();
   const stage=[...document.querySelectorAll('#player div')].find(el=>el.style.top==='126px').getBoundingClientRect();
   const focus=timeline.focusPath[frame],bands=timeline.systemBands;
   const band=bands.reduce((a,b)=>Math.abs(a.centerY-focus.focusY)<Math.abs(b.centerY-focus.focusY)?a:b);
   const factor=ir.width/timeline.scoreWidth;
   const notes=timeline.events.flatMap(e=>e.notes).filter(n=>n.y>=band.top&&n.y<band.bottom&&ir.left+n.x*factor>=stage.left+8&&ir.left+n.x*factor<=stage.right-8);
   const engraving=timeline.systemBounds?.[bands.indexOf(band)];
   const y0=engraving?ir.top+engraving.top*factor:Math.min(...notes.map(n=>ir.top+(n.y-8)*factor));
   const y1=engraving?ir.top+engraving.bottom*factor:Math.max(...notes.map(n=>ir.top+(n.y+8)*factor));
   return {frame,noteCount:notes.length,y0,y1,top:stage.top,bottom:stage.bottom,left:parseFloat(img.parentElement.style.left),zoom:document.getElementById('scale').value,zoomDisabled:document.getElementById('scale').disabled};
  },{frame,timeline:props.timeline});
  assert(measured.noteCount>0);
  assert(measured.y0>=measured.top&&measured.y1<=measured.bottom,`cropped grand staff at frame ${frame}: ${JSON.stringify(measured)}`);
  assert.equal(measured.zoomDisabled,false);
 assert.equal(Number(measured.zoom),props.camera.scale,'camera uses the selected initial zoom');
 assert(Number(measured.zoom)>=2.4,'multi-system teaching keeps its complete-staff default zoom');
  checks.push(measured);
  if(frame===770)await page.screenshot({path:'workbench/verify-framing/frame770.png'});
 }
 assert.notEqual(checks[0].left,checks[1].left,'horizontal following stays active');
 const [zoomResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/direction/validate')&&r.status()===200),page.$eval('#scale',e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));})]);
 assert.equal((await zoomResponse.json()).props.camera.scale,2,'explicit zoom remains adjustable');
 assert.deepEqual(errors,[]);
 fs.writeFileSync('workbench/verify-framing/result.json',JSON.stringify({status:'PASS',checks,errors},null,2));
 console.log(JSON.stringify({status:'PASS',checkedFrames:checks.map(c=>c.frame),zoom:props.camera.scale,horizontalFollowing:true,errors}));
 const source=await browser.newPage();
 await source.goto(new URL(props.scoreSrc,url).href);
 const bounds=await source.evaluate(()=>{const root=document.querySelector('svg'),inv=root.getScreenCTM().inverse(),scale=1600/root.viewBox.baseVal.width;return [...document.querySelectorAll('g.system')].map(g=>{const b=g.getBBox(),m=g.getScreenCTM();const p=new DOMPoint(b.x,b.y).matrixTransform(m).matrixTransform(inv),q=new DOMPoint(b.x+b.width,b.y+b.height).matrixTransform(m).matrixTransform(inv);return {top:p.y*scale,bottom:q.y*scale,left:p.x*scale,right:q.x*scale};});});
 fs.writeFileSync('workbench/verify-framing/system-bounds.json',JSON.stringify(bounds,null,2));
}finally{await browser.close();}
