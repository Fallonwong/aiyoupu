import fs from 'node:fs';import path from 'node:path';
import {hashObject,sha256,failure} from './audio.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>sha256(fs.readFileSync(p));
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const semantics=m=>({durationQuarter:m.durationQuarter,timeByStaff:m.timeByStaff,staves:m.staves,context:[...String(m.rawXml??'').matchAll(/<(?:attributes|direction|barline)\b[\s\S]*?<\/(?:attributes|direction|barline)>/g)].map(x=>x[0]),events:m.events.map(e=>Object.fromEntries(['kind','onsetQuarter','durationQuarter','voice','staff','pitch','chord','grace','type','dots','ties','slurs','beams'].map(k=>[k,e[k]])))});
export function notationAudit({source,check,previous,out,expectedMeasures=[],observations}){
  if(fs.existsSync(out))throw failure('OUTPUT_EXISTS',out,'Use a new revision directory.');
  const c=read(check),p=previous?read(previous):null;
  if(!Array.isArray(c.measures))throw failure('SCORE_STRUCTURE_REQUIRED','Missing score check measures','Run score check on real MusicXML.');
  const old=new Map((p?.measures??[]).map(m=>[m.id,m]));const current=new Set(c.measures.map(m=>m.id));
  const changes=c.measures.filter(m=>!old.has(m.id)||hashObject(semantics(m))!==hashObject(semantics(old.get(m.id)))).map(m=>({measureId:m.id,before:old.has(m.id)?semantics(old.get(m.id)):null,after:semantics(m)}));
  for(const change of changes){
    change.details=[];const before=change.before,after=change.after;
    for(const field of ['durationQuarter','timeByStaff','staves','context'])if(JSON.stringify(before?.[field]??null)!==JSON.stringify(after[field]??null))change.details.push({eventIndex:null,field,before:before?.[field]??null,after:after[field]??null});
    for(let i=0;i<Math.max(before?.events.length??0,after.events.length);i++)for(const field of ['kind','onsetQuarter','durationQuarter','voice','staff','pitch','chord','grace','type','dots','ties','slurs','beams'])if(JSON.stringify(before?.events[i]?.[field]??null)!==JSON.stringify(after.events[i]?.[field]??null))change.details.push({eventIndex:i,field,before:before?.events[i]?.[field]??null,after:after.events[i]?.[field]??null});
  }
  const removed=[...old.keys()].filter(id=>!current.has(id));
  const issues=(c.issues??[]).map(i=>({...i,origin:'structural-check',reviewStatus:'unreviewed'}));
  const additional=[];
  for(const m of c.measures){const lanes=new Map();m.events.forEach((e,index)=>{
    if(!['note','rest'].includes(e.kind)||e.grace)return;
    const accidental={sharp:1,flat:-1,natural:0,'double-sharp':2,'sharp-sharp':2,'flat-flat':-2}[e.pitch?.accidental];
    const fraction=x=>{const[a,b=1]=String(x).split('/').map(Number);return a/b;};
    if(accidental!==undefined&&Math.abs(fraction(e.pitch.alter)-accidental)>.001)additional.push({code:'ACCIDENTAL_PITCH_CONFLICT',measureId:m.id,eventIndex:index,severity:'review',message:'Displayed accidental differs from pitch alter. Check original/key context; do not guess.',origin:'semantic-audit',reviewStatus:'unreviewed'});
    if(e.chord)return;const lane=e.voice??'<undeclared>',onset=fraction(e.onsetQuarter),end=lanes.get(lane)??0;
    if(onset>end+.001)additional.push({code:'VOICE_GAP_REVIEW',measureId:m.id,eventIndex:index,severity:'review',message:'Unexplained voice gap; verify rests/forward/cross-staff timing. Do not automatically pad.',origin:'semantic-audit',reviewStatus:'unreviewed'});
    lanes.set(lane,Math.max(end,onset+fraction(e.durationQuarter)));
  });}
  issues.push(...additional);
  const observationFiles={};const items=observations?read(observations).items:[];
  if(!Array.isArray(items))throw failure('OBSERVATIONS_INVALID','items array required','Record each doubt/correction with actual source evidence.');
  for(const item of items){
    if(!current.has(item.measureId)||!item.description?.trim()||!['uncertain','corrected'].includes(item.disposition)||!item.evidenceFile||hash(item.evidenceFile)!==item.evidenceSha256||item.disposition==='corrected'&&!item.reason?.trim())throw failure('OBSERVATIONS_INVALID','Invalid measure, disposition or changed/missing source evidence','Retain a real source crop and explain each correction; do not bulk-approve.');
    observationFiles[path.resolve(item.evidenceFile)]=hash(item.evidenceFile);
  }
  const priorities=c.measures.map(m=>{const n=m.events.filter(e=>e.kind==='note'),reasons=[];if(n.some(e=>['16th','32nd','64th'].includes(e.type)))reasons.push('dense-rhythm');if(n.some(e=>e.ties?.length||e.slurs?.length))reasons.push('ties-slurs');if(n.some(e=>e.chord))reasons.push('chords');if(new Set(n.map(e=>e.voice)).size>1)reasons.push('multiple-voices');if(m.events.some(e=>e.kind==='rest'))reasons.push('rests');return {measureId:m.id,printedNumber:m.number,reasons,issues:issues.filter(i=>i.measureId===m.id).length};}).sort((a,b)=>(b.reasons.length+b.issues)-(a.reasons.length+a.issues));
  const unintended=previous&&expectedMeasures.length?changes.map(c=>c.measureId).concat(removed).filter(id=>!expectedMeasures.includes(id)):[];
  const report={schema:'aiyoupu-notation-audit/v1',status:c.structuralPassed===true?'WAITING_FOR_SOURCE_REVIEW':'STRUCTURE_BLOCKED',sourceSha256:hash(source),checkSha256:hash(check),musicxmlSha256:c.sourceSha256,previousCheckSha256:previous?hash(previous):null,fingerprints:{[path.resolve(source)]:hash(source),[path.resolve(check)]:hash(check),...(previous?{[path.resolve(previous)]:hash(previous)}:{}),...(observations?{[path.resolve(observations)]:hash(observations)}:{}),...observationFiles},observations:items,structuralPassed:c.structuralPassed===true,changes,removedMeasures:removed,unexpectedChangedMeasures:unintended,pilotMeasures:priorities.slice(0,5),issues,accuracyCertified:false,notes:['No note correctness follows from balanced bar duration. Re-check accidentals/key/clef/octave, dot/beam/tuplet, rests, chord count, voice/staff and tie vs slur against the actual source.','Use installed professional OMR first; no automatic downloads or recognizer substitution. Agent-assisted reading is a disclosed fallback, not independent verification.','Resolve high-risk measures with source crops and explicit doubts; user corrections do not authorize changing other measures. Present every remaining doubt before user approval.']};
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  const html=`<!doctype html><meta charset="utf-8"><title>Notation revision</title><style>body{font:16px system-ui;max-width:1100px;margin:30px auto}pre{white-space:pre-wrap;background:#eee;padding:12px}details{margin:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px;word-break:break-word}</style><h1>谱面修订与疑点</h1><p>结构检查：${c.structuralPassed?'通过；不是识谱准确率证明':'失败'}。仍须逐小节对照原谱。</p><p>优先核对：${report.pilotMeasures.map(m=>esc(m.measureId)+' '+esc(m.reasons.join(', '))).join('；')}</p><p>超出指定修改范围：${esc(unintended.join(', ')||'无／未指定')}</p><h2>本轮变化</h2>${changes.map(x=>`<h3>${esc(x.measureId)}</h3><table><tr><th>事件索引</th><th>字段</th><th>修改前</th><th>修改后</th></tr>${x.details.map(d=>`<tr><td>${d.eventIndex??'小节上下文'}</td><td>${esc(d.field)}</td><td>${esc(JSON.stringify(d.before))}</td><td>${esc(JSON.stringify(d.after))}</td></tr>`).join('')}</table><details><summary>完整结构</summary><pre>${esc(JSON.stringify(x,null,2))}</pre></details>`).join('')}<p>删除小节：${esc(removed.join(', '))}</p><h2>未核对疑点</h2><pre>${esc(JSON.stringify({issues,observations:items},null,2))}</pre><p>本页不是用户批准，也不是独立识谱结论。与原谱/重排谱裁切对照一起审阅。</p>`;
  fs.writeFileSync(path.join(out,'index.html'),html);return {status:report.status,report:path.resolve(out,'report.json'),review:path.resolve(out,'index.html'),changedMeasures:changes.length,unexpectedChangedMeasures:unintended,next:'Show revision differences and source/reflow crops. Do not bulk-set issues to approved or claim measured OMR accuracy.'};
}
export function validateNotationAudit(file,{source,check}){
  const r=read(file);if(r.schema!=='aiyoupu-notation-audit/v1'||!r.structuralPassed||r.sourceSha256!==hash(source)||r.checkSha256!==hash(check))throw failure('NOTATION_AUDIT_STALE','Audit is missing, structurally blocked or belongs to other source/check bytes','Recreate notation-audit from the current revision and actual original input.');
  for(const [p,h]of Object.entries(r.fingerprints))if(!fs.existsSync(p)||hash(p)!==h)throw failure('NOTATION_AUDIT_STALE',p,'Recreate audit; preserve correction history.');return r;
}
