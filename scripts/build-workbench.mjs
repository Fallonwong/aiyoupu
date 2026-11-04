#!/usr/bin/env node
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.resolve(process.env.AIYOUPU_BUNDLE_PROJECT||process.argv[2]||'E:/remotion-workspace/.cache/aiyoupu-v200/runtime-v2');
const localRequire=createRequire(path.join(project,'package.json'));
const expected={react:'19.2.4','react-dom':'19.2.4',remotion:'4.0.515','@remotion/player':'4.0.515'};
for(const [name,version] of Object.entries(expected)){
 const actual=localRequire(name+'/package.json').version;if(actual!==version)throw Error(`${name}: ${actual}; expected ${version}`);
}
const resolvePlugin={name:'fixed-workbench-dependencies',setup(b){
 b.onResolve({filter:/^(react|react-dom|remotion|@remotion\/player)(\/.*)?$/},a=>({path:localRequire.resolve(a.path)}));
}};
const out=path.join(root,'workbench','react-bundle.js');
await build({entryPoints:[path.join(root,'workbench','entry.mjs')],outfile:out,bundle:true,format:'iife',platform:'browser',target:'es2020',jsx:'automatic',plugins:[resolvePlugin],nodePaths:[path.join(project,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},minify:true,legalComments:'none'});
console.log(JSON.stringify({status:'workbench_bundle_built',out,versions:expected,skillComponent:'components/AiyoupuScoreSceneV2.tsx'}));
