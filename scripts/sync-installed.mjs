#!/usr/bin/env node
// Copy exactly the manifest-distributable program files to the optional Skill
// location. User runtime data and private media are outside this copy scope.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {DISTRIBUTION_FILES} from './build-manifest.mjs';
const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dst=path.resolve(process.argv[2]??'C:/Users/52675/.agents/skills/piano-remotion');
// Top-level program files come from the manifest rebuild source set; the
// generated manifest is copied after it is rebuilt so the installed record and
// bytes are from the same snapshot. Private tests and runtime folders are never
// enumerated from the source tree.
const manifest=JSON.parse(fs.readFileSync(path.join(src,'manifest.json'),'utf8'));
const files=[...new Set([...Object.keys(manifest.files??{}),...DISTRIBUTION_FILES])].sort().map(rel=>({from:path.join(src,rel),to:path.join(dst,rel),rel}));
const targetRoot=path.resolve(dst);
if(!targetRoot.startsWith(path.resolve(dst)))throw Error('unreachable');
for(const {from,to,rel} of files){if(!fs.statSync(from,{throwIfNoEntry:false})?.isFile())throw Error(`Distribution source is missing: ${rel}. Rebuild the manifest first.`);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
const manifestTo=path.join(dst,'manifest.json');fs.copyFileSync(path.join(src,'manifest.json'),manifestTo);
// Retired program files are the one deletion class this sync may perform. User
// runtime directories are only inventoried here and remain untouched.
const retired=['scripts/workbench-imports.mjs','scripts/workbench-tasks.mjs','scripts/workbench.test.mjs','workbench/scene.js','workbench/README-v4-修复验收.md','workbench/README-预设切换验收.md','workbench/verify-v12-acceptance.mjs','workbench/verify-v13-audio.mjs','workbench/verify-v13-final.mjs','workbench/verify-v13-flow.mjs','workbench/verify-v13-multitask.mjs','workbench/verify-v4-final-acceptance.mjs'];
const removed=[];
for(const rel of retired){const p=path.join(dst,rel);if(fs.existsSync(p)){fs.rmSync(p,{force:true});removed.push(rel);}}
const runtimeDirs=['imports','renders','runs','approvals','directions','verify-audio-review','verify-main','verify-v13'];
const preserved=runtimeDirs.map(rel=>'workbench/'+rel).filter(rel=>fs.existsSync(path.join(dst,rel)));
if(fs.existsSync(path.join(dst,'workbench','local-assets.json')))preserved.push('workbench/local-assets.json');
console.log(JSON.stringify({status:'installed_synced',target:dst,files:files.length,manifest:manifestTo,removed,preserved},null,2));
