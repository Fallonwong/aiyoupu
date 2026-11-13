import assert from 'node:assert/strict';
import {scoreAttackEvents,scoreChordGeometry} from '../components/ScoreChordGeometry.ts';
import {compilePerformance} from './music.mjs';
const event=(frame,notes)=>({frame,x:notes[0].x,y:notes[0].y,notes});
const note=(x,extra={})=>({x,y:100,pitch:'C4',voice:'1',part:'P1',staff:1,durationFrames:30,...extra});
const tied=[event(0,[note(100,{tieStart:true})]),event(30,[note(200,{tieStop:true,attack:false})]),event(60,[note(300)])];
const attacks=scoreAttackEvents(tied);
assert.deepEqual(attacks.map(e=>e.frame),[0,60],'continuation must not be an animation waypoint');
assert.equal(attacks[0].notes[0].durationFrames,60);
assert.equal(tied[0].notes[0].durationFrames,30,'source notation must remain intact');
for(const frame of Array.from({length:59},(_,i)=>i+1)){
 const g=scoreChordGeometry(tied,frame,58,14);
 const t=frame/60;
 assert(Math.abs(g.heads[0].x-(100+200*t))<.001,'flight must go directly from first attack to next real attack');
 assert(Math.abs(g.heads[0].y-(100-4*58*t*(1-t)))<.001,'one uninterrupted arc must bypass the continuation');
 assert(!g.heads.some(p=>p.x===200&&p.y===100),'no core may land on the continuation');
}
assert.equal(scoreChordGeometry(tied,60,58,14).heads[0].x,300,'next real attack lands at its own note');
const repeated=[event(0,[note(100)]),event(30,[note(200)]),event(60,[note(300)])];
assert(scoreChordGeometry(repeated,15,58,14).heads[0].y<100,'untied repeated pitch must attack');
const slurred=[event(0,[note(100,{slurs:[{id:'1',type:'start'}]})]),event(30,[note(200,{pitch:'D4',slurs:[{id:'1',type:'stop'}]})])];
assert(scoreChordGeometry(slurred,15,58,14).heads[0].y<100,'a slur must not suppress a new pitch');
const mixed=[event(0,[note(100,{tieStart:true}),note(100,{y:60,pitch:'E4'})]),event(30,[note(200,{tieStop:true,attack:false}),note(200,{y:50,pitch:'F4'})])];
const chord=scoreChordGeometry(mixed,15,58,14);
assert.equal(chord.heads.length,1,'only the newly attacked chord member participates');
assert(chord.heads.some(p=>p.y<50),'the new chord member still jumps');
assert.deepEqual(scoreAttackEvents(mixed)[1].notes.map(n=>n.pitch),['F4'],'partial chord removes only its tied member');
const chain=[event(0,[note(100,{tieStart:true})]),event(30,[note(200,{tieStart:true,tieStop:true})]),event(60,[note(300,{tieStop:true})])];
assert.deepEqual(scoreAttackEvents(chain).map(e=>e.frame),[0]);
assert.equal(scoreAttackEvents(chain)[0].notes[0].durationFrames,90);
const rest=[event(0,[note(100,{durationFrames:10})]),event(30,[note(200)])];
assert.equal(scoreChordGeometry(rest,20,58,14).heads.length,0,'no flying head across a rest');
assert.equal(scoreChordGeometry(rest,60,58,14).heads.length,0,'no head after release');
assert.equal(scoreChordGeometry([{...repeated[0],systemId:0},{...repeated[1],systemId:1}],15,58,14).segments.length,0,'no flight across systems');
const compiled=compilePerformance({fps:30,durationInFrames:90,events:tied.map(e=>({...e,hand:'right'}))},{strict:true});
assert.equal(compiled.music.soundingAttacks,2);
assert.equal(compiled.events[1].notes[0].attack,false);
assert.equal(compiled.events[0].notes[0].soundingEndFrame,60);
const shortMember=[event(0,[note(100,{y:20,pitch:'E4',durationFrames:10}),note(100)]),event(30,[note(200)])];
assert(scoreChordGeometry(shortMember,20,58,14).heads.every(p=>p.y>20),'an expired chord member must not keep flying');
const exact=(events,frame)=>scoreChordGeometry(events,frame,58,14,18,true);
const fractional=[event(0,[note(100)]),event(7.98,[note(150)]),event(15.96,[note(200)])];
assert.deepEqual(exact(fractional,8).heads,[{x:150,y:100}],'first visible attack frame must hit the glyph center');
assert.equal(exact(fractional,8).tails.at(-1).at(-1).x,150,'trail must not overshoot the visible landing');
const wraps=[{...event(239.49,[note(1500,{durationFrames:15.96})]),systemId:0},
  {...event(255.45,[note(370,{y:650,durationFrames:8})]),systemId:1}];
assert.deepEqual(exact(wraps,254).heads,[{x:1500,y:100}],'last note on old row stays lit while sounding');
assert.equal(exact(wraps,254).segments.length,0,'no cross-row trail');
assert.deepEqual(exact(wraps,256).heads,[{x:370,y:650}],'new row first attack lands even without a following arc');
assert.equal(exact(rest,20).heads.length,0,'a real rest remains dark');
assert.ok(!exact(tied,30).heads.some(p=>p.x===200&&p.y===100),'tie still does not re-attack');
// Reproduce the first We Never barline: one held pitch, a tied continuation
// at the barline, and a different real attack in the same chord.
const barline=[
  {...event(55.89,[note(659,{pitch:'Ab4',tieStart:true,durationFrames:7.98})]),systemId:0},
  {...event(63.87,[note(723,{pitch:'Ab4',tieStop:true,attack:false,durationFrames:7.98}),
    note(723,{pitch:'F4',y:118,durationFrames:7.98})]),systemId:0},
  {...event(71.85,[note(760,{pitch:'Eb4',y:127})]),systemId:0},
];
const crossing=[56,57,58,59,60,61,62,63,64].map(f=>exact(barline,f));
assert.deepEqual(crossing[0].heads,[{x:659,y:100}]);
assert.deepEqual(crossing.at(-1).heads,[{x:723,y:118}]);
for(let i=1;i<crossing.length;i++){
  assert.equal(crossing[i].heads.length,1);
  assert.ok(crossing[i].heads[0].x>crossing[i-1].heads[0].x,'no stall or teleport over the barline');
  assert.ok(crossing[i].segments.length>0,'cross-bar trail remains visible through landing');
}
assert.ok(crossing[4].heads[0].y<100,'barline is crossed in the air');
assert.deepEqual(scoreAttackEvents(barline)[1].notes.map(n=>n.pitch),['F4']);
assert.equal(exact(mixed,15).heads.length,1,'a moving member takes priority over a sustaining tie');
console.log(JSON.stringify({status:'PASS',checks:['ties','untied repeated notes','slurs','mixed tied chord','rests','release','system breaks','fractional landings','row exit and entrance','same-row barline flight from a sustaining tie']}));
