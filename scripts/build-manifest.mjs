#!/usr/bin/env node
// Rebuild the distributable file hashes. Everything is included by default,
// except runtime/generated areas; workbench has an explicit allowlist so a
// local acceptance screenshot or job cannot leak into the package.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './audio.mjs';
import {isMain} from './entry.mjs';

export const WORKBENCH_PROGRAM_FILES=Object.freeze(['app.js','entry.mjs','index.html','react-bundle.js','README-工作台.md','local-assets.example.json','brand-logo.png']);
export const WORKBENCH_PUBLIC_TEST_FILES=Object.freeze(['canon-public-test/CanonInD-a4.pdf','canon-public-test/CanonInD-musescore-1.svg','canon-public-test/CanonInD-musescore.mp3','canon-public-test/CanonInD-preview.png','canon-public-test/CanonInD.mid','canon-public-test/CanonInD.musicxml','canon-public-test/CanonInD.rdf','canon-public-test/README-准备报告.md','canon-public-test/sources.json','canon-public-test/prepared/canon-score-ids.svg','canon-public-test/prepared/layout.json','canon-public-test/prepared/summary.json','canon-public-test/prepared/timeline.json']);
export const DISTRIBUTION_FILES=Object.freeze([...WORKBENCH_PROGRAM_FILES.map(x=>'workbench/'+x),...WORKBENCH_PUBLIC_TEST_FILES.map(x=>'workbench/'+x)]);
export function buildManifest({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),manifestFile=null}={}){
 const manifestPath=manifestFile??path.join(root,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),files={};
const topExcluded=new Set(['.git','.cache','node_modules','.remotion','out','dist','.tmp-midi.b64','manifest.json','launch-args.json','launch-error.log']);
const workbenchAllow=new Set(DISTRIBUTION_FILES);
function add(rel){const full=path.join(root,rel);if(!fs.statSync(full).isFile())return;const b=fs.readFileSync(full);files[rel]={bytes:b.length,sha256:sha256(b)};}
function walk(dir,base){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const rel=base?base+'/'+e.name:e.name;if(topExcluded.has(rel)||/^D-[A-Za-z0-9_-]+\.json$/.test(e.name)||/\.test\.mjs$/.test(e.name))continue;if(e.isDirectory()){if(rel==='workbench')continue;walk(path.join(dir,e.name),rel);}else add(rel);}}
 walk(root,'');for(const rel of workbenchAllow)add(rel);
 const sorted=Object.fromEntries(Object.keys(files).sort().map(k=>[k,files[k]]));manifest.files=sorted;
 fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 return {status:'manifest_rebuilt',version:manifest.version,files:Object.keys(sorted).length,bytes:Object.values(sorted).reduce((n,f)=>n+f.bytes,0),manifest:manifestPath};
}
if(isMain(import.meta.url))console.log(JSON.stringify(buildManifest(),null,2));
