import {validateMappedNotation,validateSymbolic} from './performance-map.mjs';
import {createHash} from 'node:crypto';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,next:'Preserve note durations, voices and tie/slur declarations from reviewed notation; do not infer missing values.'});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function musicIdentity(t){
  if(t.notation?.schema==='aiyoupu-symbolic-events/v2'){validateSymbolic(t.symbolic);if(t.symbolic.scoreSha256!==t.notation.scoreSha256)fail('NOTATION_IDENTITY_STALE','Changed symbolic source');return t.notation.scoreSha256;}
  return hash({fps:t.fps,durationInFrames:t.durationInFrames,events:t.events.map(e=>({hand:e.hand,frame:e.frame,notes:e.notes.map(n=>({id:n.id,pitch:n.pitch,durationFrames:n.durationFrames,voice:n.voice,part:n.part,tieStart:n.tieStart,tieStop:n.tieStop,slurs:n.slurs,beams:n.beams}))}))});
}
export function performance(t,{strict=false}={}){
  const items=[];const ids=new Set();
  for(const e of t.events)for(const [j,n] of e.notes.entries()){
    const id=n.id??`${e.hand}:${e.frame}:${j}`;
    if(ids.has(id))fail('NOTE_ID_DUPLICATE',id);ids.add(id);
    const duration=n.durationFrames??e.durationFrames;
    if(duration===undefined&&strict)fail('MUSIC_DURATION_REQUIRED',`Missing durationFrames: ${id}`);
    if(duration!==undefined&&(!Number.isFinite(duration)||duration<=0||e.frame+duration>t.durationInFrames+.001))fail('MUSIC_DURATION_INVALID',id);
    if((n.tieStart||n.tieStop)&&(!n.voice||duration===undefined))fail('TIE_CONTEXT_REQUIRED',id);
    if(!/^[A-G][#b]?-?\d+$/.test(n.pitch??''))fail('PITCH_REQUIRED',id);
    if(n.slurs!==undefined&&(!Array.isArray(n.slurs)||n.slurs.some(s=>typeof s.id!=='string'||!['start','continue','stop'].includes(s.type))))fail('SLUR_INVALID',id);
    items.push({...n,id,hand:e.hand,startFrame:e.frame,endFrame:e.frame+(duration??.65*t.fps),legacyDuration:duration===undefined,event:e});
  }
  items.sort((a,b)=>a.startFrame-b.startFrame);
  const active=new Map(),spans=[],byNote=new Map(),slurs=new Map();
  for(const n of items){
    const key=`${n.part??'P1'}:${n.voice??n.hand}:${n.pitch}`;
    let span;
    if(n.tieStop){
      span=active.get(key);if(!span||Math.abs(span.endFrame-n.startFrame)>.001)fail('TIE_DISCONTINUITY',n.id);
      if(span.hand!==n.hand)fail('TIE_HAND_CHANGE_REVIEW',n.id);
      active.delete(key);span.endFrame=n.endFrame;span.noteIds.push(n.id);span.segments.push(n);
    }else{
      if(active.has(key))fail('TIE_UNCLOSED',n.id);
      span={id:n.id,pitch:n.pitch,hand:n.hand,startFrame:n.startFrame,endFrame:n.endFrame,noteIds:[n.id],segments:[n],slurConnected:false};spans.push(span);
    }
    if(n.tieStart)active.set(key,span);byNote.set(n.id,span);
    const lane=`${n.part??'P1'}:${n.voice??n.hand}:`;
    if([...slurs.keys()].some(k=>k.startsWith(lane)))span.slurConnected=true;
    for(const s of n.slurs??[]){
      const sk=`${n.part??'P1'}:${n.voice??n.hand}:${s.id}`;
      if(s.type==='start'){if(slurs.has(sk))fail('SLUR_DUPLICATE_START',n.id);slurs.set(sk,[]);}
      if(!slurs.has(sk))fail('SLUR_DISCONTINUITY',n.id);
      slurs.get(sk).push(span);span.slurConnected=true;
      if(s.type==='stop')slurs.delete(sk);
    }
  }
  if(active.size)fail('TIE_UNCLOSED',[...active.keys()].join(','));
  if(slurs.size)fail('SLUR_UNCLOSED',[...slurs.keys()].join(','));
  for(const span of spans){const first=span.segments[0];span.legatoOverlapFrames=span.slurConnected&&spans.some(next=>next!==span&&next.slurConnected&&next.hand===span.hand&&(next.segments[0].voice??'')===(first.voice??'')&&(next.segments[0].part??'P1')===(first.part??'P1')&&Math.abs(next.startFrame-span.endFrame)<.001)?Math.min(.03*t.fps,t.durationInFrames-span.endFrame):0;}
  return {spans,items,byNote,musicSha256:musicIdentity(t),legacyDurations:items.filter(n=>n.legacyDuration).length};
}
export function compilePerformance(t,options={}){
  const p=performance(t,options),out=structuredClone(t);let serial=0;
  for(const e of out.events)for(const [j,n] of e.notes.entries()){
    const id=n.id??`${e.hand}:${e.frame}:${j}`,span=p.byNote.get(id);
    Object.assign(n,{id,attack:!n.tieStop,soundingStartFrame:span.startFrame,soundingEndFrame:span.endFrame,highlightEndFrame:e.frame+(n.durationFrames??e.durationFrames??.65*t.fps)});serial++;
  }
  out.music={schema:'aiyoupu-performance/v1',musicSha256:musicIdentity(out),writtenNotes:serial,soundingAttacks:p.spans.length,legacyDurations:p.legacyDurations};return out;
}
export function attackFrames(t){return [...new Set(performance(t).spans.map(s=>s.startFrame))].sort((a,b)=>a-b);}
export function fromStructuredScore(check,placement,{fps=30,leadFrames=10,tailFrames=15}={}){
  if(check.structuralPassed!==true||!Array.isArray(check.measures))fail('SCORE_STRUCTURE_REQUIRED','Run score check first.');
  const blocked=(check.issues??[]).filter(i=>i.severity==='error'||['REPEAT_OR_JUMP','GRACE_TIMING','MICROTONAL'].includes(i.code));
  if(blocked.length)fail('MUSIC_INTERPRETATION_REQUIRED',blocked.map(i=>i.code).join(','));
  if(!(placement.tempoBpm>0)||!(fps>0)||!(placement.scoreWidth>0)||!(placement.scoreHeight>0))fail('MUSIC_PARAMETERS_REQUIRED','Explicit tempo, fps and score dimensions required.');
  const fraction=s=>{const [a,b=1]=String(s).split('/').map(Number);if(!Number.isFinite(a/b))fail('MUSIC_DURATION_INVALID',String(s));return a/b;};
  const pos=new Map(placement.notes.map(p=>[p.id,p]));if(pos.size!==placement.notes.length)fail('NOTE_ID_DUPLICATE','Placement IDs');
  const start=new Map(),groups=new Map(),ids=[];let ending=leadFrames;
  for(const m of check.measures){
    const offset=start.get(m.part)??0;
    m.events.forEach((e,index)=>{
      if(e.kind!=='note')return;
      const id=`${m.id}:${index}`,p=pos.get(id),hand=placement.handMap?.[`${m.part}:${e.staff}:${e.voice}`];
      if(!p||!['right','left'].includes(hand))fail('NOTE_PLACEMENT_REQUIRED',id);
      if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||!p.svgId)fail('NOTE_PLACEMENT_REQUIRED',id);
      const alter=fraction(e.pitch.alter),pitch=`${e.pitch.step}${alter===-1?'b':alter===1?'#':alter===0?'':(()=>fail('MICROTONAL_UNSUPPORTED',id))()}${e.pitch.octave}`;
      const frame=leadFrames+(offset+fraction(e.onsetQuarter))*60/placement.tempoBpm*fps,durationFrames=fraction(e.durationQuarter)*60/placement.tempoBpm*fps;
      const key=`${hand}:${frame}`,g=groups.get(key)??{hand,frame,x:0,y:0,notes:[]};
      g.notes.push({id,pitch,x:p.x,y:p.y,durationFrames,part:m.part,voice:e.voice,staff:e.staff,measureId:m.id,tieStart:e.ties?.includes('start')??false,tieStop:e.ties?.includes('stop')??false,slurs:(e.slurs??[]).map(s=>({id:String(s.number),type:s.type})),beams:e.beams??[]});groups.set(key,g);ending=Math.max(ending,frame+durationFrames);
    });
    start.set(m.part,offset+fraction(m.durationQuarter));
  }
  const events=[...groups.values()].sort((a,b)=>a.frame-b.frame||a.hand.localeCompare(b.hand));
  events.forEach((e,i)=>{e.x=e.notes.reduce((s,n)=>s+n.x,0)/e.notes.length;e.y=e.notes.reduce((s,n)=>s+n.y,0)/e.notes.length;e.notes.forEach((n,j)=>ids.push({eventIndex:i,noteIndex:j,svgId:pos.get(n.id).svgId}));});
  const tempi=check.measures.flatMap(m=>[...String(m.rawXml??'').matchAll(/tempo="([\d.]+)"|<per-minute>([\d.]+)<\/per-minute>/g)].map(x=>Number(x[1]??x[2])));
  if(tempi.some(v=>Math.abs(v-placement.tempoBpm)>.001)&&!placement.tempoOverrideReason)fail('TEMPO_REVIEW_REQUIRED','Source tempo differs or changes; expand it upstream or record the explicit chosen override.');
  const t=compilePerformance({fps,leadFrames,tempoBpm:placement.tempoBpm,durationInFrames:Math.ceil(ending+tailFrames),scoreWidth:placement.scoreWidth,scoreHeight:placement.scoreHeight,events,status:'needs_user_review',sourceMusicxmlSha256:check.sourceSha256},{strict:true});
  return {timeline:t,mapping:ids};
}
export function validateNotationMapping(t,check){
  if(t.notation?.schema==='aiyoupu-symbolic-events/v2')return validateMappedNotation(t,check);
  if(!check.structuralPassed||!t.tempoBpm||t.sourceMusicxmlSha256!==check.sourceSha256)fail('NOTATION_MAPPING_REQUIRED','Use music-from-check with the actual structural report.');
  const fraction=s=>{const [a,b=1]=String(s).split('/').map(Number);return a/b;};
  const source=new Map(),partOffsets=new Map();for(const m of check.measures){const offset=partOffsets.get(m.part)??0;m.events.forEach((e,i)=>{if(e.kind==='note')source.set(`${m.id}:${i}`,{...e,sourcePart:m.part,absoluteQuarter:offset+fraction(e.onsetQuarter)});});partOffsets.set(m.part,offset+fraction(m.durationQuarter));}
  const notes=t.events.flatMap(e=>e.notes);if(notes.length!==source.size)fail('NOTATION_NOTE_COUNT','Written note count differs from MusicXML.');
  for(const event of t.events)for(const n of event.notes){
    const e=source.get(n.id);if(!e)fail('NOTATION_NOTE_MISMATCH',n.id);
    const accidental=fraction(e.pitch.alter),p=`${e.pitch.step}${accidental===-1?'b':accidental===1?'#':''}${e.pitch.octave}`;
      if(n.pitch!==p||n.voice!==e.voice||n.staff!==e.staff||n.part!==e.sourcePart||Math.abs(event.frame-((t.leadFrames??0)+e.absoluteQuarter*60/t.tempoBpm*t.fps))>.001||Math.abs(n.durationFrames-fraction(e.durationQuarter)*60/t.tempoBpm*t.fps)>.001||!!n.tieStart!==!!e.ties?.includes('start')||!!n.tieStop!==!!e.ties?.includes('stop')||JSON.stringify(n.beams??[])!==JSON.stringify(e.beams??[])||JSON.stringify(n.slurs??[])!==JSON.stringify((e.slurs??[]).map(s=>({id:String(s.number),type:s.type}))))fail('NOTATION_SEMANTICS_LOST',n.id);
  }
  return {status:'written_note_semantics_match',writtenNotes:notes.length};
}
