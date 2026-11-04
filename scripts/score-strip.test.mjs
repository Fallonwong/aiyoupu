// Run: node score-strip.test.mjs PROJECT EXISTING_CHROME NEW_EVIDENCE_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildScoreStrip} from './score-strip.mjs';
import {hashObject,sha256} from './audio.mjs';

const [project,browser,out]=process.argv.slice(2);
assert(project&&browser&&out,'Expected project, browser and new evidence directory');
assert(!fs.existsSync(out),'Evidence directory must be new');fs.mkdirSync(out,{recursive:true});
const source=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="540" viewBox="0 0 600 540"><defs><linearGradient id="ink"><stop stop-color="black"/></linearGradient></defs><rect width="600" height="540" fill="white"/>
${[0,180,360].map((y,i)=>`<g transform="translate(0,${y})">${[50,60,70,80,90,110,120,130,140,150].map(v=>`<path d="M30 ${v}H570" stroke="black"/>`).join('')}<ellipse id="r${i}" cx="120" cy="70" rx="7" ry="4" fill="url(#ink)"/><ellipse id="l${i}" cx="120" cy="120" rx="7" ry="4" fill="black"/></g>`).join('')}</svg>`;
// Unequal crop heights retain the complete grand staves.
const timeline={fps:30,durationInFrames:120,scoreWidth:600,scoreHeight:540,events:[0,1,2].flatMap(i=>['right','left'].map(hand=>({frame:10+i*40,hand,systemId:i,x:120,y:(hand==='right'?70:120)+i*180,notes:[{id:hand+i,x:120,y:(hand==='right'?70:120)+i*180,pitch:hand==='right'?'C5':'C3',durationFrames:30,attack:true}]})))};
const mapping=timeline.events.map((e,eventIndex)=>({eventIndex,noteIndex:0,svgId:(e.hand==='right'?'r':'l')+e.systemId,x:e.x,y:e.y}));
const layout={scoreSha256:sha256(source),timelineSha256:hashObject(timeline),mapping};
const packet={schema:'aiyoupu-strip-systems/v1',scoreSha256:sha256(source),timelineSha256:hashObject(timeline),systems:[{id:0,x:0,y:0,width:600,height:170,centerY:95},{id:1,x:0,y:180,width:600,height:175,centerY:275},{id:2,x:0,y:360,width:600,height:180,centerY:455}]};
const write=(name,data)=>{const p=path.join(out,name);fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data));return p;};
const input={svg:write('source.svg',source),timeline:write('source-timeline.json',timeline),layout:write('source-layout.json',layout),systems:write('systems.json',packet),project,browser,out:path.join(out,'generated'),scale:.8,gap:4};
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
await buildScoreStrip(input);
const generated=JSON.parse(fs.readFileSync(path.join(input.out,'timeline.json'))),geometry=JSON.parse(fs.readFileSync(path.join(input.out,'layout.json'))),svg=fs.readFileSync(path.join(input.out,'score-strip.svg'),'utf8');
check('three arbitrary systems and dimensions',()=>{assert.equal(generated.scoreWidth,1448);assert.equal(generated.scoreHeight,144);});
check('musical content and timing retained',()=>{assert.deepEqual(generated.events.map(e=>[e.frame,e.hand,e.notes.map(n=>[n.id,n.pitch,n.durationFrames,n.attack])]),timeline.events.map(e=>[e.frame,e.hand,e.notes.map(n=>[n.id,n.pitch,n.durationFrames,n.attack])]));});
check('all six glyphs independently remeasured',()=>{assert.equal(geometry.mapping.length,6);for(const m of geometry.mapping){const n=generated.events[m.eventIndex].notes[m.noteIndex];assert(Math.hypot(m.x-n.x,m.y-n.y)<.05);}});
check('local paint references namespaced',()=>{assert(svg.includes('url(#strip1-ink)'));assert(svg.includes('id="strip1-ink"'));});
check('forward continuous path and aligned staff center',()=>{assert.equal(generated.focusPath.length,120);for(let i=0;i<120;i++){assert.equal(generated.focusPath[i].focusY,76);if(i)assert(generated.focusPath[i].focusX>=generated.focusPath[i-1].focusX);}});
check('inputs untouched',()=>{assert.equal(fs.readFileSync(input.svg,'utf8'),source);assert.deepEqual(JSON.parse(fs.readFileSync(input.timeline)),timeline);});
check('output evidence hashes match',()=>{assert.equal(geometry.scoreSha256,sha256(svg));assert.equal(geometry.timelineSha256,hashObject(generated));});
async function rejects(name,overrides,pattern){const target=path.join(out,'reject-'+checks);await assert.rejects(buildScoreStrip({...input,...overrides,out:target}),pattern);assert(!fs.existsSync(target));checks++;console.log('PASS '+name);}
await rejects('stale system mapping rejected',{systems:write('stale.json',{...packet,scoreSha256:'stale'})},/stale system/);
await rejects('overlapping crops rejected',{systems:write('overlap.json',{...packet,systems:packet.systems.map((s,i)=>i===1?{...s,y:100}:s)})},/overlapping/);
await rejects('cropped notehead rejected',{systems:write('cropped.json',{...packet,systems:packet.systems.map((s,i)=>i===0?{...s,x:120,width:480}:s)})},/crop cuts/);
await rejects('unknown system rejected',{systems:write('missing.json',{...packet,systems:packet.systems.slice(0,2)})},/known system/);
const reverse={...timeline,events:timeline.events.map(e=>({...e,systemId:2-e.systemId}))};
await rejects('repeat/backward traversal rejected',{timeline:write('reverse.json',reverse),layout:write('reverse-layout.json',{...layout,timelineSha256:hashObject(reverse)}),systems:write('reverse-systems.json',{...packet,timelineSha256:hashObject(reverse)})},/backward/);
await assert.rejects(buildScoreStrip(input),/already exists/);checks++;
fs.writeFileSync(path.join(out,'test-results.json'),JSON.stringify({status:'PASS',checks,generated:input.out,scope:'synthetic geometry and content-preservation tests, not human music approval'},null,2));
