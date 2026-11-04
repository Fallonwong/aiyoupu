import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {executeLogged} from './execution.mjs';
import {sha256,hashObject,failure} from './audio.mjs';
import {compilePerformance} from './music.mjs';
export function measureNative(svg,mapping,browser,logDirectory){
  if(!browser||!fs.existsSync(browser))throw failure('BROWSER_REQUIRED','An existing Chrome/Chromium executable is required','Run doctor; do not download a browser without authorization.');
  const text=fs.readFileSync(svg,'utf8');
  if(/<(?:script|foreignObject|image)\b|(?:href|src)\s*=\s*["'](?!#)|url\(\s*(?!#)/i.test(text))throw failure('SVG_EXTERNAL_CONTENT','Only self-contained static SVG is supported','Use the engraver static export without scripts or external content.');
  const dir=logDirectory??fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-svg-'));fs.mkdirSync(dir,{recursive:true});
  const html=path.join(dir,'geometry.html');
  const code=`const root=document.querySelector('svg');const inverse=root.getScreenCTM().inverse();const result=${JSON.stringify(mapping).replaceAll('<','\\u003c')}.map(m=>{const el=document.getElementById(m.svgId);if(!el)throw Error('Missing ID '+m.svgId);const style=getComputedStyle(el);if(el.closest('defs,symbol')||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)throw Error('Hidden glyph '+m.svgId);const b=el.getBBox();if(!b.width||!b.height)throw Error('Empty glyph '+m.svgId);const p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(el.getScreenCTM()).matrixTransform(inverse);return {...m,x:p.x,y:p.y};});document.querySelector('#result').textContent=JSON.stringify(result);`;
  fs.writeFileSync(html,`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline'"><style>body{margin:0}</style>${text}<pre id="result"></pre><script>try{${code}}catch(e){document.querySelector('#result').textContent=JSON.stringify({error:e.message})}</script>`,{flag:'wx'});
  const r=executeLogged(browser,['--headless','--disable-gpu','--no-sandbox','--no-first-run','--disable-background-networking',`--user-data-dir=${path.join(dir,'profile')}`,'--dump-dom','--virtual-time-budget=1000',pathToFileURL(html).href],{log:path.join(dir,'browser-command.json'),timeout:30000});
  const raw=r.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];if(!raw)throw failure('SVG_MEASUREMENT_FAILED','Browser did not return glyph measurements','Inspect browser-command.json.');
  const result=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  if(!Array.isArray(result))throw failure('SVG_MEASUREMENT_FAILED',result.error,'Supply actual notehead element IDs from the same engraver run.');return result;
}
export function nativeGeometry({svg,timeline,mapping,browser,out}){
  if(fs.existsSync(out))throw failure('OUTPUT_EXISTS',out,'Choose a new layout output directory.');fs.mkdirSync(out,{recursive:true});
  const source=JSON.parse(fs.readFileSync(timeline)),ids=JSON.parse(fs.readFileSync(mapping));
  const measured=measureNative(svg,ids,browser,path.join(out,'browser'));
  const t=structuredClone(source);
  for(const m of measured){const n=t.events[m.eventIndex]?.notes[m.noteIndex];if(!n)throw failure('LAYOUT_MAPPING_INCOMPLETE',m.svgId,'Map every written note exactly once.');n.x=m.x;n.y=m.y;}
  for(const e of t.events){e.x=e.notes.reduce((s,n)=>s+n.x,0)/e.notes.length;e.y=e.notes.reduce((s,n)=>s+n.y,0)/e.notes.length;}
  const compiled=compilePerformance(t,{strict:true}),layout={geometryMethod:'browser-native-svg/v1',scoreSha256:sha256(fs.readFileSync(svg)),timelineSha256:hashObject(compiled),producer:{tool:'existing-Chromium SVG getBBox/getScreenCTM',runId:sha256(fs.readFileSync(svg)).slice(0,20)},mapping:measured};
  fs.writeFileSync(path.join(out,'timeline.json'),JSON.stringify(compiled,null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(out,'layout.json'),JSON.stringify(layout,null,2)+'\n',{flag:'wx'});
  return {status:'native_svg_measured',timeline:path.resolve(out,'timeline.json'),layout:path.resolve(out,'layout.json'),limits:'Coordinate measurement preserves glyphs; it does not recognize pitches or prove notation correctness.'};
}
