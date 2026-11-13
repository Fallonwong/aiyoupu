import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {sha256,hashObject} from './audio.mjs';
import {validateTimeline} from './prepare.mjs';

const requireValue=(ok,message)=>{if(!ok)throw new Error(`SCORE_STRIP: ${message}`);};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));

/** Rearranges already measured notation. No pitch recognition, time fitting or camera rotation. */
export async function buildScoreStrip({svg,timeline,layout,systems,project,browser,out,scale=1,gap=0}) {
  requireValue(!fs.existsSync(out),'output directory already exists');
  requireValue(Number.isFinite(scale)&&scale>0&&Number.isFinite(gap)&&gap>=0,'invalid scale/gap');
  requireValue(browser&&fs.statSync(browser,{throwIfNoEntry:false})?.isFile(),'supply an existing Chrome executable');
  const svgBytes=fs.readFileSync(svg),source=svgBytes.toString('utf8');
  const original=read(timeline),t=validateTimeline(original),l=read(layout),packet=read(systems);
  requireValue(l.scoreSha256===sha256(svgBytes)&&l.timelineSha256===hashObject(original),'stale source geometry evidence');
  requireValue(packet.schema==='aiyoupu-strip-systems/v1'&&packet.scoreSha256===sha256(svgBytes)&&packet.timelineSha256===hashObject(original),'stale system bounds');
  const rows=packet.systems;
  requireValue(Array.isArray(rows)&&rows.length>0&&new Set(rows.map(s=>s.id)).size===rows.length,'unique measured systems required');
  const ids=new Map(rows.map((s,i)=>[s.id,i]));
  for(const s of rows){
    requireValue((typeof s.id==='string'||Number.isFinite(s.id))&&['x','y','width','height','centerY'].every(k=>Number.isFinite(s[k])),'invalid system fields');
    requireValue(s.x>=0&&s.y>=0&&s.width>0&&s.height>0&&s.x+s.width<=t.scoreWidth+.001&&s.y+s.height<=t.scoreHeight+.001&&s.centerY>=s.y&&s.centerY<=s.y+s.height,'bounds outside source viewport');
  }
  for(let i=0;i<rows.length;i++)for(let j=0;j<i;j++){
    const a=rows[i],b=rows[j];requireValue(!(a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height),'overlapping system crops');
  }
  const eventRow=e=>ids.get(e.systemId??e.sys);
  for(const e of t.events)requireValue(eventRow(e)!==undefined,'every event requires a known systemId (or sys)');
  const ordered=[...t.events].sort((a,b)=>a.frame-b.frame);
  for(let i=1;i<ordered.length;i++)requireValue(eventRow(ordered[i])>=eventRow(ordered[i-1]),'backward/repeated system traversal requires a separately unfolded score');
  const noteCount=t.events.reduce((n,e)=>n+e.notes.length,0);
  requireValue(Array.isArray(l.mapping)&&l.mapping.length===noteCount,'complete source notehead mapping required');
  const seen=new Set();
  for(const m of l.mapping){
    const key=`${m.eventIndex}:${m.noteIndex}`,n=t.events[m.eventIndex]?.notes[m.noteIndex];
    requireValue(n&&typeof m.svgId==='string'&&m.svgId&&!seen.has(key),'invalid/duplicate note mapping');seen.add(key);
    requireValue(Math.hypot(n.x-m.x,n.y-m.y)<=.01,'mapping coordinates disagree with timeline');
  }
  requireValue(!/<!DOCTYPE|<!ENTITY/i.test(source),'DTD/entities unsupported');
  const req=createRequire(path.join(path.resolve(project),'package.json'));
  const {openBrowser}=req('@remotion/renderer');
  const chrome=await openBrowser('chrome',{browserExecutable:path.resolve(browser)});
  let result;
  try {
    const page=await chrome.newPage({context:()=>null,logLevel:'error',indent:false,pageIndex:0,onBrowserLog:null,onLog:()=>{}});
    await page.goto({url:'data:text/html,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="margin:0"></body>'),timeout:30000});
    result=await page.evaluate(({source,rows,t,l,scale,gap})=>{
      const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
      const ns='http://www.w3.org/2000/svg';
      const doc=new DOMParser().parseFromString(source,'image/svg+xml');
      check(!doc.querySelector('parsererror')&&doc.documentElement.localName==='svg','invalid SVG');
      const original=doc.documentElement;
      check(!original.hasAttribute('transform'),'root transform unsupported; normalize first');
      const vb=original.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      check(vb?.length===4&&vb.every((v,i)=>Math.abs(v-[0,0,t.scoreWidth,t.scoreHeight][i])<.001),'SVG/timeline viewport mismatch');
      const all=[original,...original.querySelectorAll('*')],idSet=new Set();
      for(const el of all){
        check(!['script','style','foreignObject','image','a','animate','animateTransform','animateMotion','set','filter'].includes(el.localName),'unsupported active/external/styled SVG element');
        if(el.id){check(!idSet.has(el.id),'duplicate source SVG id');idSet.add(el.id);}
        for(const attr of el.attributes){
          check(!/^on/i.test(attr.name)&&attr.name!=='xml:base','unsupported SVG attribute');
          if(attr.localName==='href')check(attr.value.startsWith('#'),'external SVG reference');
          if(/url\(/i.test(attr.value))check(!attr.value.replace(/url\(\s*['"]?#[\w:.-]+['"]?\s*\)/g,'').includes('url('),'external/unsupported CSS reference');
          check(!/@import|javascript:|expression\(/i.test(attr.value),'active SVG value');
        }
      }
      const src=document.importNode(original,true);document.body.append(src);
      const measure=(root,id)=>{
        const node=[...root.querySelectorAll('[id]')].find(e=>e.id===id);check(node,'missing glyph '+id);
        const heads=node.matches('.note')?node.querySelectorAll('.notehead'):null;
        check(!heads||heads.length===1,'expected one notehead '+id);
        const el=heads?heads[0]:node;
        const st=getComputedStyle(el);check(!el.closest('defs,symbol')&&st.display!=='none'&&st.visibility!=='hidden'&&Number(st.opacity)>0,'hidden glyph '+id);
        const b=el.getBBox();check(b.width>0&&b.height>0,'empty glyph '+id);
        const matrix=root.getScreenCTM().inverse().multiply(el.getScreenCTM());
        const point=(x,y)=>new DOMPoint(x,y).matrixTransform(matrix);
        const corners=[point(b.x,b.y),point(b.x+b.width,b.y),point(b.x,b.y+b.height),point(b.x+b.width,b.y+b.height)];
        const center=point(b.x+b.width/2,b.y+b.height/2);
        return {x:center.x,y:center.y,corners};
      };
      const byId=new Map(rows.map((s,i)=>[s.id,i]));
      for(const m of l.mapping){
        const event=t.events[m.eventIndex],row=rows[byId.get(event.systemId??event.sys)],p=measure(src,m.svgId);
        check(Math.hypot(p.x-m.x,p.y-m.y)<=.05,'source glyph mapping changed '+m.svgId);
        check(p.corners.every(c=>c.x>=row.x-.01&&c.x<=row.x+row.width+.01&&c.y>=row.y-.01&&c.y<=row.y+row.height+.01),'crop cuts mapped notehead '+m.svgId);
      }
      const center=Math.max(...rows.map(s=>(s.centerY-s.y)*scale));
      let x=0;
      const placed=rows.map((s,i)=>{
        const v={...s,stripX:x,stripY:center-(s.centerY-s.y)*scale,stripWidth:s.width*scale,stripHeight:s.height*scale};
        x+=v.stripWidth+(i<rows.length-1?gap:0);return v;
      });
      const height=Math.max(...placed.map(s=>s.stripY+s.stripHeight));
      const root=document.createElementNS(ns,'svg');
      root.setAttribute('width',String(x));root.setAttribute('height',String(height));root.setAttribute('viewBox',`0 0 ${x} ${height}`);
      placed.forEach((s,i)=>{
        const clone=document.importNode(original,true),prefix=`strip${i}-`;
        for(const el of [clone,...clone.querySelectorAll('*')]){
          for(const attr of [...el.attributes]){
            let value=attr.value;
            if(attr.localName==='href'&&value.startsWith('#'))value='#'+prefix+value.slice(1);
            value=value.replace(/url\(\s*(['"]?)#([\w:.-]+)\1\s*\)/g,(_,q,id)=>`url(#${prefix}${id})`);
            if(attr.name==='id')value=prefix+value;
            el.setAttributeNS(attr.namespaceURI,attr.name,value);
          }
        }
        clone.setAttribute('x',String(s.stripX));clone.setAttribute('y',String(s.stripY));
        clone.setAttribute('width',String(s.stripWidth));clone.setAttribute('height',String(s.stripHeight));
        clone.setAttribute('viewBox',`${s.x} ${s.y} ${s.width} ${s.height}`);
        clone.setAttribute('preserveAspectRatio','none');clone.style.overflow='hidden';
        root.append(clone);
      });
      const output=structuredClone(t);
      const transform=(n,s)=>({...n,x:s.stripX+(n.x-s.x)*scale,y:s.stripY+(n.y-s.y)*scale});
      output.events=t.events.map(e=>{const i=byId.get(e.systemId??e.sys),s=placed[i];return {...transform(e,s),systemId:s.id,notes:e.notes.map(n=>transform(n,s))};});
      if(output.allNotes)output.allNotes=output.allNotes.map(n=>{const s=placed[byId.get(n.systemId??n.sys)];check(s,'allNotes requires systemId');return transform(n,s);});
      output.scoreWidth=x;output.scoreHeight=height;if(output.width!==undefined)output.width=x;
      delete output.cameraPath;delete output.focusPath;delete output.focusHandoffs;
      output.systems=placed.map(s=>({...s,centerY:center,focusY:center}));
      document.body.append(root);
      const mapping=l.mapping.map(m=>{
        const event=output.events[m.eventIndex],i=byId.get(event.systemId),svgId=`strip${i}-${m.svgId}`;
        const p=measure(root,svgId),n=event.notes[m.noteIndex];
        check(Math.hypot(p.x-n.x,p.y-n.y)<=.05,'output registration mismatch '+svgId);
        return {...m,svgId,x:p.x,y:p.y};
      });
      return {svg:new XMLSerializer().serializeToString(root),timeline:output,mapping,systems:placed,centerY:center};
    },{source,rows,t,l,scale,gap});
  } finally {await chrome.close({silent:true});}
  // Both hands use one shared track; interpolate continuously across strip joins.
  const targets=[];
  for(const e of [...result.timeline.events].sort((a,b)=>a.frame-b.frame)){
    const previous=targets.at(-1);
    if(previous?.frame===e.frame){requireValue(previous.systemId===e.systemId,'simultaneous systems conflict');if(e.hand==='right')Object.assign(previous,e);}
    else targets.push({...e});
  }
  result.timeline.focusPath=Array.from({length:t.durationInFrames},(_,f)=>{
    const next=targets.findIndex(e=>e.frame>f);
    const a=targets[next<0?targets.length-1:Math.max(0,next-1)],b=targets[next<0?targets.length-1:next];
    const u=a===b?0:Math.max(0,Math.min(1,(f-a.frame)/(b.frame-a.frame)));
    return {focusX:a.x+(b.x-a.x)*u,focusY:result.centerY};
  });
  result.timeline.pipeline='score-strip';
  result.timeline.alignmentStatus='Timing retained from source; not newly certified';
  // Mapping was independently measured in the browser after placement.
  const geometry={geometryMethod:'browser-native-svg/v1',scoreSha256:sha256(result.svg),timelineSha256:hashObject(result.timeline),producer:{tool:'aiyoupu score-strip / existing Chromium',runId:hashObject({svg:sha256(svgBytes),timeline:hashObject(original),packet,scale,gap})},mapping:result.mapping};
  const evidence={schema:'aiyoupu-score-strip/v1',status:'geometry_checked',sourceSvgSha256:sha256(svgBytes),sourceTimelineSha256:hashObject(original),systemBoundsSha256:hashObject(packet),outputSvgSha256:geometry.scoreSha256,outputTimelineSha256:geometry.timelineSha256,mappedNoteheads:noteCount,systems:result.systems,scale,gap,pitchesAndTiming:'preserved',userApproved:false,limitations:['One self-contained SVG; supplied measured system crops and note IDs','No automatic recognition, repeat unfolding or time alignment','Inspect beams/slurs/labels at joins; notehead checks cannot prove crop completeness']};
  // No original file is overwritten. All validation precedes output creation.
  fs.mkdirSync(out,{recursive:true});
  const write=(name,data)=>fs.writeFileSync(path.join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx'});
  write('score-strip.svg',result.svg);write('timeline.json',result.timeline);write('layout.json',geometry);write('strip-evidence.json',evidence);
  return {status:'strip_geometry_checked',out:path.resolve(out),systems:rows.length,mappedNoteheads:noteCount,next:'Use these SVG/timeline/layout files with the existing portrait-runway preset. Review joins and actual keyframes before export; no user approval was created.'};
}
