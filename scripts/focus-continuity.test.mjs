#!/usr/bin/env node
// A focused regression for the camera-continuity gate: the defect it guards
// (one focus sample per attack, held for the note value) is invisible to every
// shape check, so it needs its own assertions.
import assert from 'node:assert/strict';
import {focusContinuityReport, assertFocusContinuity, repairFocusContinuity} from './focus-continuity.mjs';
import {buildReadingCamera} from './reading-camera.mjs';

const base = {fps: 30, scoreWidth: 1000, scoreHeight: 500, durationInFrames: 120,
  events: [{hand: 'right', frame: 0, x: 100, y: 200, notes: [{x: 100, y: 200, pitch: 'C5'}]}]};
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };

// One coordinate held for 13 frames then jumping: the real reported defect.
const stepped = [];
for (let f = 0; f < 120; f++) stepped.push({focusX: 100 + Math.floor(f / 13) * 60, focusY: 200});

check('a held coordinate then a jump is reported as discontinuous', () => {
  const report = focusContinuityReport({...base, focusPath: stepped});
  assert.equal(report.status, 'discontinuous');
  assert.ok(report.hops.length > 0, 'expected hops');
  assert.ok(report.hops[0].frame > 0, 'first hop cannot be frame 0');
});

check('the gate blocks a formal bind on a stepped path', () => {
  assert.throws(() => assertFocusContinuity({...base, focusPath: stepped}), e => e.code === 'FOCUS_PATH_DISCONTINUOUS');
});

check('continuous travel is accepted and never flagged', () => {
  const smooth = Array.from({length: 120}, (_, f) => ({focusX: 100 + f * 2, focusY: 200}));
  const report = focusContinuityReport({...base, focusPath: smooth});
  assert.equal(report.status, 'continuous');
  assert.equal(report.hops.length, 0);
  assert.equal(assertFocusContinuity({...base, focusPath: smooth}).checked, true);
});

check('repair makes a stepped path continuous and keeps every landing exact', () => {
  const result = repairFocusContinuity({...base, focusPath: stepped}, {windowFrames: 14});
  assert.equal(result.before.hops.length > 0, true);
  assert.equal(result.after.hops.length, 0, 'repair must remove every hop');
  assert.equal(result.after.shortRuns.length, 0, 'repair must not leave abrupt moves');
  assert.equal(result.timeline.focusPath.length, stepped.length, 'frame count is preserved');
  for (let i = 1; i < stepped.length; i++) {
    if (stepped[i].focusX === stepped[i - 1].focusX) continue;
    assert.equal(result.timeline.focusPath[i].focusX, stepped[i].focusX, 'landing frame ' + i + ' moved');
  }
});

check('an already smooth path is left byte-identical by repair', () => {
  const smooth = Array.from({length: 120}, (_, f) => ({focusX: 100 + f * 2, focusY: 200}));
  const result = repairFocusContinuity({...base, focusPath: smooth});
  assert.equal(result.repaired, 0);
  assert.deepEqual(result.timeline.focusPath, smooth);
});

check('a short score is not judged with a pixel-sized threshold', () => {
  const tiny = Array.from({length: 40}, (_, f) => ({focusX: 10 + f * .2, focusY: 5}));
  const report = focusContinuityReport({...base, scoreWidth: 40, scoreHeight: 20, durationInFrames: 40, focusPath: tiny});
  assert.equal(report.checked, true);
  assert.equal(report.status, 'continuous');
});

check('repair leaves a back-to-back landing pair alone rather than deforming it', () => {
  const tight = [];
  for (let f = 0; f < 40; f++) tight.push({focusX: f < 10 ? 100 : f < 12 ? 300 : 300, focusY: 200});
  const result = repairFocusContinuity({...base, durationInFrames: 40, focusPath: tight}, {windowFrames: 14});
  // Only three frames exist between the two landings; the pair must survive.
  assert.equal(result.timeline.focusPath[10].focusX, 300, 'landing value changed');
});

// Geometry and cadence of the reported failure, with synthetic notes only.
const anchors=[...Array.from({length:27},(_,i)=>[i*9,450+i*40,0]),[250,365,1],[258,405,1],[266,440,1]];
const wrap={...base,durationInFrames:275,scoreWidth:1600,scoreHeight:1693,
  systemBounds:[{top:25,bottom:425},{top:480,bottom:820}],
  events:anchors.map(([frame,x,row])=>({frame,x,y:row?650:225,hand:'right'}))};

check('strict review catches a fast multi-frame rewind and repeated same-row braking',()=>{
  let i=0;
  const focusPath=Array.from({length:wrap.durationInFrames},(_,f)=>{
    while(i+1<anchors.length&&f>=anchors[i+1][0])i++;
    const [a,x,row]=anchors[i],[b,endX,endRow]=anchors[i+1]??anchors[i];
    const t=a===b?0:(f-a)/(b-a),u=t*t*(3-2*t);
    return {focusX:x+(endX-x)*u,focusY:225+425*(row+(endRow-row)*u)};
  });
  const report=focusContinuityReport({...wrap,focusPath});
  assert.equal(report.hops.length,0);
  assert.equal(report.shortRuns.length,0);
  assert.ok(report.sweeps.some(s=>s.start>234&&s.end<=250));
  assert.ok(report.stopGo.some(s=>s.end<234));
  assert.throws(()=>assertFocusContinuity({...wrap,focusPath},{strict:true}),e=>e.code==='FOCUS_MOTION_REVIEW_REQUIRED');
});

check('a long return pans through the row entrance without changing the music',()=>{
  const rebuilt={...wrap,...buildReadingCamera(wrap)};
  assert.deepEqual(rebuilt.events,wrap.events);
  assert.deepEqual(rebuilt.focusHandoffs,[]);
  const [pan]=rebuilt.rowPans;
  assert.ok(pan.start<234&&pan.frame===250&&pan.end>250);
  assert.equal(rebuilt.focusPath[pan.start].zoom,1);
  assert.equal(rebuilt.focusPath[pan.end].zoom,1);
  assert.ok(rebuilt.focusPath[250].focusX>365&&rebuilt.focusPath[250].focusX<1490);
  const minimum=Math.min(...rebuilt.focusPath.map(p=>p.zoom??1));
  assert.ok(minimum>=.88&&minimum<.95);
  for(let f=pan.start+1;f<=pan.end;f++){
    const a=rebuilt.focusPath[f-1],b=rebuilt.focusPath[f];
    assert.ok(b.focusY>a.focusY,'the camera keeps moving toward the next row');
    assert.ok(Math.abs(b.focusX-a.focusX)<50,'no single-frame return');
  }
  for(const [frame,x] of anchors.filter(([f])=>f<pan.start||f>pan.end))assert.equal(rebuilt.focusPath[frame].focusX,x);
  assert.equal(assertFocusContinuity(rebuilt,{strict:true}).status,'continuous');
  const cut={...wrap,focusHandoffs:[{frame:250,dipFrames:5}],
    focusPath:rebuilt.focusPath.map((p,f)=>f<pan.start||f>pan.end?p:
      f<250?{focusX:1490,focusY:225}:{focusX:365,focusY:650})};
  assert.throws(()=>assertFocusContinuity(cut,{strict:true}),e=>e.code==='FOCUS_LEGACY_ROW_CUT');
  const disguised={...cut,rowPans:rebuilt.rowPans,focusHandoffs:[]};
  assert.throws(()=>assertFocusContinuity(disguised,{strict:true}),e=>['FOCUS_PATH_DISCONTINUOUS','FOCUS_MOTION_REVIEW_REQUIRED'].includes(e.code));
});

check('a nearby row with enough musical time still pans instead of cutting',()=>{
  const input={...wrap,events:[{frame:0,x:400,y:225},{frame:60,x:370,y:650}]};
  const result={...input,...buildReadingCamera(input)};
  assert.deepEqual(result.focusHandoffs,[]);
  assert.deepEqual(result.rowPans,[]);
  assert.ok(result.focusPath[55].focusY>225&&result.focusPath[55].focusY<650);
  assert.equal(assertFocusContinuity(result,{strict:true}).status,'continuous');
});

console.log('\nfocus-continuity: ' + checks + ' groups passed');
