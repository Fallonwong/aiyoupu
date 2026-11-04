import fs from 'node:fs';
import {hashObject,sha256,failure} from './audio.mjs';
const fail=(code,message)=>{throw failure(code,message,'Retain source notation and explicit playback order; never infer or fill missing notes.');};
const q=v=>{const [a,b=1]=String(v).split('/').map(Number);if(!Number.isFinite(a/b)||b===0)fail('SCORE_TIME_INVALID',String(v));return a/b;};
const pitchMidi=p=>{const m=/^([A-G])([#b]?)(-?\d+)$/.exec(p??'');if(!m)fail('PITCH_REQUIRED',String(p));return 12*(Number(m[3])+1)+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0);};
export const scoreIdentity=s=>hashObject({schema:s.schema,sourceSha256:s.sourceSha256,events:s.events,playback:s.playback});
export function midiScoreEvents(midi,sourceSha256,assignment){
  if(!midi.notes?.length||!(midi.ppqn>0))fail('MIDI_EVENTS_REQUIRED','Use the strict SMF parser');
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const events=midi.notes.map((n,i)=>{
    const a=assignment?.lanes?.[`${n.track}:${n.channel}`],measureId=assignment?.noteMeasures?.[String(i)];if(!a?.part||!a.voice||!Number.isInteger(a.staff)||a.staff<1||typeof measureId!=='string'||!measureId)fail('MIDI_ASSIGNMENT_REQUIRED',`${n.track}:${n.channel}`);
    return {id:`midi:${i}@1`,writtenId:`midi:${i}`,measureId,occurrence:1,pickup:false,part:a.part,voice:a.voice,staff:a.staff,kind:'note',pitch:`${names[n.pitch%12]}${Math.floor(n.pitch/12)-1}`,midi:n.pitch,startBeat:n.startTick/midi.ppqn,endBeat:n.endTick/midi.ppqn,ties:[],slurs:[],beams:[]};
  });
  const result={schema:'aiyoupu-symbolic-events/v2',sourceSha256,playback:{midi:'explicit track/channel assignment; no notation/quantization inference'},events,status:'needs_source_review',limits:'MIDI pitch spelling is a display convention; meter, rests and original engraving are not recovered.'};result.scoreSha256=scoreIdentity(result);return result;
}
export function scoreEvents(check,{playback}={}){
  if(!check.structuralPassed||!check.measures?.length)fail('SCORE_STRUCTURE_REQUIRED','No checked notation');
  if((check.issues??[]).some(i=>i.severity==='error'||['GRACE_TIMING','MICROTONAL'].includes(i.code)))fail('INTERPRETATION_REQUIRED','Grace/microtonal/error requires explicit interpretation');
  if((check.issues??[]).some(i=>i.code==='REPEAT_OR_JUMP')&&!playback)fail('PLAYBACK_ORDER_REQUIRED','Repeat/jump must be explicitly unfolded');
  const measures=new Map(check.measures.map(m=>[m.id,m]));
  const parts=[...new Set(check.measures.map(m=>m.part))];
  // Multiple parts share occurrence order by ordinal, with explicit per-part lists.
  const orders=playback??Object.fromEntries(parts.map(p=>[p,check.measures.filter(m=>m.part===p).map(m=>m.id)]));
  if(Object.keys(orders).length!==parts.length||parts.some(p=>!Array.isArray(orders[p])||!orders[p].length))fail('PLAYBACK_ORDER_INVALID','Each part needs an ordered measure ID list');
  const events=[];
  for(const part of parts){let beat=0;const counts=new Map();for(const id of orders[part]){
    const m=measures.get(id);if(!m||m.part!==part)fail('PLAYBACK_ORDER_INVALID',String(id));
    const occurrence=(counts.get(id)??0)+1;counts.set(id,occurrence);
    m.events.forEach((e,i)=>{if(!['note','rest'].includes(e.kind))return;
      const alter=e.pitch?q(e.pitch.alter):0;if(!Number.isInteger(alter)||Math.abs(alter)>1)fail('PITCH_INTERPRETATION_REQUIRED',id);
      const pitch=e.pitch?`${e.pitch.step}${alter===1?'#':alter===-1?'b':''}${e.pitch.octave}`:null;
      events.push({id:`${id}:${i}@${occurrence}`,writtenId:`${id}:${i}`,measureId:id,occurrence,pickup:m.implicit===true,part,voice:e.voice,staff:e.staff,kind:e.kind,
        pitch,midi:pitch?pitchMidi(pitch):null,startBeat:beat+q(e.onsetQuarter),endBeat:beat+q(e.onsetQuarter)+q(e.durationQuarter),ties:e.ties??[],slurs:e.slurs??[],beams:e.beams??[]});
    });beat+=q(m.durationQuarter);
  }}
  const result={schema:'aiyoupu-symbolic-events/v2',sourceSha256:check.sourceSha256,playback:orders,events:events.sort((a,b)=>a.startBeat-b.startBeat||a.id.localeCompare(b.id)),status:'needs_source_review'};
  result.scoreSha256=scoreIdentity(result);return result;
}
export function validateSymbolic(s){
  if(s.schema!=='aiyoupu-symbolic-events/v2'||s.scoreSha256!==scoreIdentity(s)||!s.events?.length)fail('SYMBOLIC_INVALID','Changed/missing symbolic events');
  const ids=new Set();for(const e of s.events){if(ids.has(e.id)||!Number.isFinite(e.startBeat)||!Number.isFinite(e.endBeat)||e.endBeat<=e.startBeat||e.startBeat<0||!['note','rest'].includes(e.kind))fail('SYMBOLIC_INVALID',e.id);ids.add(e.id);if(e.kind==='note'&&pitchMidi(e.pitch)!==e.midi)fail('SYMBOLIC_PITCH_INVALID',e.id);}return s;
}
export function validateTimeMap(map,s,audio){
  validateSymbolic(s);
  if(map.schema!=='aiyoupu-time-map/v2'||map.scoreSha256!==s.scoreSha256||map.audioSha256!==sha256(fs.readFileSync(audio)))fail('TIME_MAP_STALE','Map score/audio mismatch');
  if(!Array.isArray(map.anchors)||map.anchors.length<2)fail('TIME_MAP_INVALID','At least two anchors required');
  map.anchors.forEach((a,i)=>{const b=map.anchors[i-1];if(!Number.isFinite(a.beat)||!Number.isFinite(a.seconds)||a.beat<0||a.seconds<0||!['observed','manual'].includes(a.method)||!a.evidenceRef?.trim()||(b&&(a.beat<=b.beat||a.seconds<=b.seconds)))fail('TIME_MAP_INVALID','Anchors need strictly increasing beat/seconds and actual evidence references');});
  if(map.anchors[0].beat>Math.min(...s.events.map(e=>e.startBeat))||map.anchors.at(-1).beat<Math.max(...s.events.map(e=>e.endBeat)))fail('TIME_MAP_COVERAGE','No extrapolation beyond anchors');
  return map;
}
export function secondsAt(map,beat){
  let i=map.anchors.findIndex(a=>a.beat>=beat);if(i<0||beat<map.anchors[0].beat)fail('TIME_MAP_COVERAGE',String(beat));if(i===0)return map.anchors[0].seconds;
  const a=map.anchors[i-1],b=map.anchors[i];return a.seconds+(beat-a.beat)/(b.beat-a.beat)*(b.seconds-a.seconds);
}
export function mappedTimeline({symbolic,map,audio,placement,fps=30,tailFrames=15}){
  validateTimeMap(map,symbolic,audio);if(!(fps>0)||!Number.isFinite(fps)||!Number.isInteger(tailFrames)||tailFrames<0)fail('TIMING_PARAMETERS','Invalid fps/tail');
  if(!(placement.scoreWidth>0&&placement.scoreHeight>0))fail('LAYOUT_REQUIRED','Score dimensions required');
  const positions=new Map(placement.notes.map(n=>[n.id,n]));if(positions.size!==placement.notes.length)fail('LAYOUT_REQUIRED','Duplicate placement ID');
  const groups=new Map();let end=0;
  for(const n of symbolic.events){end=Math.max(end,secondsAt(map,n.endBeat)*fps);if(n.kind!=='note')continue;
    const p=positions.get(n.id)??positions.get(n.writtenId),hand=placement.handMap?.[`${n.part}:${n.staff}:${n.voice}`];
    if(!p||![p.x,p.y].every(Number.isFinite)||!['left','right'].includes(hand))fail('LAYOUT_REQUIRED',n.id);
    const frame=secondsAt(map,n.startBeat)*fps,durationFrames=(secondsAt(map,n.endBeat)-secondsAt(map,n.startBeat))*fps;
    const key=`${hand}:${frame}`,g=groups.get(key)??{hand,frame,systemId:p.systemId,notes:[]};
    if(g.systemId!==p.systemId)fail('SYSTEM_MAPPING_CONFLICT',n.id);
    g.notes.push({id:n.id,writtenId:n.writtenId,pitch:n.pitch,part:n.part,voice:n.voice,staff:n.staff,measureId:n.measureId,occurrence:n.occurrence,pickup:n.pickup,x:p.x,y:p.y,durationFrames,tieStart:n.ties.includes('start'),tieStop:n.ties.includes('stop'),slurs:n.slurs.map(a=>({id:String(a.number),type:a.type})),beams:n.beams,timingMethod:map.anchors.some(a=>Math.abs(a.beat-n.startBeat)<1e-9)?'anchor':'interpolated'});groups.set(key,g);
  }
  const events=[...groups.values()].sort((a,b)=>a.frame-b.frame||a.hand.localeCompare(b.hand));for(const e of events){e.x=e.notes.reduce((a,n)=>a+n.x,0)/e.notes.length;e.y=e.notes.reduce((a,n)=>a+n.y,0)/e.notes.length;}
  return {fps,durationInFrames:Math.ceil(end+tailFrames),scoreWidth:placement.scoreWidth,scoreHeight:placement.scoreHeight,events,status:'needs_content_and_timing_review',sourceMusicxmlSha256:symbolic.sourceSha256,notation:{schema:'aiyoupu-symbolic-events/v2',scoreSha256:symbolic.scoreSha256},timing:{schema:'aiyoupu-time-map/v2',mapSha256:hashObject(map),audioSha256:map.audioSha256},symbolic,map};
}
export function validateMappedNotation(t,check){
  const s=validateSymbolic(t.symbolic);if(s.sourceSha256!==check.sourceSha256||!check.structuralPassed)fail('NOTATION_MAPPING_REQUIRED','Wrong checked source');
  const rebuilt=check.schema==='aiyoupu-midi-check/v2'?midiScoreEvents(check.midi,check.sourceSha256,check.assignment):scoreEvents(check,{playback:s.playback});if(rebuilt.scoreSha256!==s.scoreSha256||t.notation?.scoreSha256!==s.scoreSha256||t.timing?.mapSha256!==hashObject(t.map))fail('NOTATION_MAPPING_REQUIRED','Changed notation/map');
  const expected=s.events.filter(n=>n.kind==='note'),actual=t.events.flatMap(e=>e.notes.map(n=>({...n,frame:e.frame})));
  if(actual.length!==expected.length||new Set(actual.map(n=>n.id)).size!==expected.length)fail('NOTATION_NOTE_COUNT','Missing/duplicate notes');
  const src=new Map(expected.map(n=>[n.id,n]));for(const n of actual){const e=src.get(n.id);if(!e||n.pitch!==e.pitch||n.part!==e.part||n.voice!==e.voice||n.staff!==e.staff||n.writtenId!==e.writtenId||n.measureId!==e.measureId||n.occurrence!==e.occurrence||!!n.pickup!==!!e.pickup||!!n.tieStart!==e.ties.includes('start')||!!n.tieStop!==e.ties.includes('stop')||hashObject(n.slurs??[])!==hashObject(e.slurs.map(a=>({id:String(a.number),type:a.type})))||hashObject(n.beams??[])!==hashObject(e.beams)||Math.abs(n.frame-secondsAt(t.map,e.startBeat)*t.fps)>1e-6||Math.abs(n.durationFrames-(secondsAt(t.map,e.endBeat)-secondsAt(t.map,e.startBeat))*t.fps)>1e-6)fail('NOTATION_SEMANTICS_LOST',n.id);}
  return {status:'notation_and_map_match',writtenNotes:actual.length};
}
