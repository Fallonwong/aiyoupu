#!/usr/bin/env node
// Agent-facing direction workflow. Every operation is also available to the
// workbench through direction-engine.mjs; no browser is required here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {failure} from './audio.mjs';
import {preparePreview,validatePreparedPreview,previewManifest,extractPresets,materializeDirection,deriveJob,renderStill,directionPrompt,DIRECTION_SCHEMA,PREVIEW_SCHEMA} from './direction-engine.mjs';
import {engraveMusicXML,midiToMusicXML} from './workbench-engrave-bridge.mjs';
import {buildReadingCamera} from './reading-camera.mjs';

const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function parse(argv){const a={};for(let i=0;i<argv.length;i++){const arg=argv[i];if(arg==='--help'||arg==='-h')return {help:true};if(!arg.startsWith('--'))throw failure('INVALID_ARGUMENT',arg,'Use --name value arguments.');const key=arg.slice(2),next=argv[i+1];if(next&&!next.startsWith('--')){a[key]=next;i++;}else a[key]=true;}return a;}
const need=(a,k)=>{if(typeof a[k]!=='string'||!a[k])throw failure('ARGUMENT_REQUIRED',`--${k} is required`,`Supply --${k} <value>.`);return a[k];};
const json=v=>JSON.stringify(v,null,2);

export const DIRECTION_USAGE=`AI有谱 direction — Agent and workbench share one visual engine.
  prepare  --timeline <timeline.json> --score <same-run.svg> [--audio <same-arrangement.mp3>] [--title <title>] [--subtitle <text>] [--label <text>] [--direction <direction.json>] --out <preview-dir>
           --musicxml <score.musicxml> | --midi <score.mid> [same optional fields]
  validate --preview <preview.json> [--direction <direction.json>] [--json]
  still    --job <derived-job.json> --frame <n> --project <Remotion-project> --out <frame.png> [--browser <chromium>]
  save     --preview <preview.json> --id D-... [--direction <direction.json>] [--out-root <dir>]
  derive   [--preview <preview.json>] --direction <saved-direction.json> --project <Remotion-project> --out <job-dir> [--score-approval <score-approval.json>]
           Creates a visual-direction draft only. Formal production continues through aiyoupu bind with the same frozen assets and quality evidence.
  inspect  --preview <preview.json>
  prompt   --direction <saved-direction.json>

Exit 0 means the operation completed. A generated preview, direction, or still
is not score or keyframe approval; keep both human gates.`;

export function parseDirectionSpec(value){if(value===undefined)return undefined;if(typeof value==='object'&&value)return value;const file=path.resolve(String(value));if(!fs.existsSync(file))throw failure('DIRECTION_MISSING',file,'Supply an existing direction JSON file.');const d=read(file);if(d.schema===DIRECTION_SCHEMA)return d.direction;if(d.schema===PREVIEW_SCHEMA)throw failure('DIRECTION_INVALID','A preview bundle is not a direction','Pass preview.json to --preview; pass only visual parameters to --direction.');return d;}
const skillRootOf=()=>path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');

export async function directionMain(sub,argv=process.argv.slice(2)){
 const a=parse(argv);if(a.help)return {status:'help',usage:DIRECTION_USAGE};
 if(sub==='prepare'){
  const direction=parseDirectionSpec(a.direction);
  const skillRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const out=path.resolve(need(a,'out'));
  if(a.pdf||a['score-image']||a['jianpu-image'])throw failure('NOTATION_RECOGNITION_REQUIRED','PDF/images need notation recognition and user review before direction preview','Use an installed OMR/Agent workflow to produce corrected MusicXML; this command never invents notes.');
  let timeline,score;
  if(a.musicxml||a.midi){
   const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aiyoupu-notate-'));
   let xml;
   try{
    xml=a.midi?midiToMusicXML(path.resolve(String(a.midi)),path.join(temp,'score.musicxml')).musicxml:path.resolve(String(a.musicxml));
    const prepared=engraveMusicXML(xml,path.join(temp,'engraved'));
    timeline=read(prepared.timeline);score=prepared.svg;
    Object.assign(timeline,buildReadingCamera(timeline));
    return preparePreview({timeline,score,audio:a.audio?path.resolve(String(a.audio)):null,title:a.title??'',subtitle:a.subtitle??'',label:a.label??'',chineseTitle:a.chinese??a.title??'',direction,out,skillRoot});
   }finally{fs.rmSync(temp,{recursive:true,force:true});}
  }
  timeline=read(path.resolve(need(a,'timeline')));score=path.resolve(need(a,'score'));
  return preparePreview({timeline,score,audio:a.audio?path.resolve(String(a.audio)):null,title:a.title??'',subtitle:a.subtitle??'',label:a.label??'',chineseTitle:a.chinese??a.title??'',direction,out,skillRoot});
 }
 if(sub==='validate'){
  const preview=path.resolve(need(a,'preview')),direction=parseDirectionSpec(a.direction);
  const p=previewManifest(preview),m=materializeDirection({preview,direction});
  if(a.json)return m;
  return {status:'direction_valid',preview,title:p.title,noteCount:m.noteCount,eventCount:m.eventCount,aspectRatio:m.direction.aspectRatio,presetId:m.direction.presetId,directionSha256:m.directionSha256,propsSha256:m.propsSha256,durationInFrames:m.durationInFrames,mappedMeasures:m.manifest.timeline.events.reduce((n,e)=>n+(e.notes??[]).filter(x=>x.measureId).length,0)};
 }
 if(sub==='inspect'){
  const preview=path.resolve(need(a,'preview')),p=previewManifest(preview),presets=extractPresets(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  return {status:'preview_ready',preview,title:p.title,subtitle:p.subtitle,noteCount:p.timeline.events.reduce((n,e)=>n+(e.notes?.length??0),0),eventCount:p.timeline.events.length,durationInFrames:p.timeline.durationInFrames,fps:p.timeline.fps,audio:!!p.audio,presets:presets.presets.map(x=>x.id)};
 }
 if(sub==='save'){
  const preview=path.resolve(need(a,'preview')),direction=parseDirectionSpec(a.direction);
  const saved=materializeDirection({preview,direction:direction??previewManifest(preview).defaultDirection,id:need(a,'id'),save:true,outRoot:a['out-root']?path.resolve(String(a['out-root'])):undefined,origin:'agent'});
  return {...saved,mappedMeasures:s.manifest.timeline.events.reduce((n,e)=>n+(e.notes??[]).filter(x=>x.measureId).length,0)};
 }
 if(sub==='derive'){
  const direction=typeof a.direction==='string'?path.resolve(a.direction):null;
  if(!direction&&typeof a.preview!=='string')throw failure('DIRECTION_REQUIRED','Pass a saved direction file, or an explicit preview for a draft derive','Save the chosen direction first so its source and approval can be traced.');
  const preview=typeof a.preview==='string'?path.resolve(a.preview):null;
  const project=path.resolve(need(a,'project'));
  return deriveJob({preview,directionFile:direction,out:need(a,'out'),project,entry:typeof a.entry==='string'?a.entry:null,composition:a.composition??'Aiyoupu-Song',scoreApproval:typeof a['score-approval']==='string'?path.resolve(a['score-approval']):null});
 }
 if(sub==='still'){
  return renderStill({jobFile:need(a,'job'),frame:Number(a.frame??0),out:need(a,'out'),project:need(a,'project'),browser:a.browser?path.resolve(String(a.browser)):undefined});
 }
 if(sub==='prompt'){const record=read(path.resolve(need(a,'direction')));return {status:'direction_prompt',id:record.id,file:path.resolve(need(a,'direction')),prompt:directionPrompt(record.id,path.resolve(need(a,'direction')))};}
 throw failure('INVALID_SUBCOMMAND',String(sub),DIRECTION_USAGE);
}

export default directionMain;
