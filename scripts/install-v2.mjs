import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverEnvironment,BASELINE} from './environment.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
let mode,targetArg,reuseProject,planOnly=false;
for(let i=0;i<args.length;i++) {
  const a=args[i];
  if(a==='--plan'){planOnly=true;continue;}
  if(['--standalone','--project','--reuse-project'].includes(a)) {
    const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`${a} requires a path`);
    if(a==='--reuse-project'){if(reuseProject)throw new Error('Duplicate --reuse-project');reuseProject=path.resolve(value);}
    else {if(mode)throw new Error('Choose exactly one install mode');mode=a;targetArg=value;}
  } else throw new Error(`Unknown argument: ${a}`);
}
if(!['--standalone','--project'].includes(mode)||!targetArg) {console.error('Usage: node install.mjs --standalone NEW_DIRECTORY | --project EXISTING_REMOTION_DIRECTORY');process.exit(1);}
const target=path.resolve(targetArg), plan=[];
const add=(from,to)=>{for(const e of fs.readdirSync(from,{withFileTypes:true})) {if(['node_modules','.remotion','.cache','out'].includes(e.name))continue;const a=path.join(from,e.name),b=path.join(to,e.name);e.isDirectory()?add(a,b):plan.push([a,b]);}};
if(mode==='--standalone') {
  if(fs.existsSync(target)) throw new Error('Standalone target must not exist; refusing to overwrite');
  add(path.join(root,'assets/runtime'),target);
} else {
  const pkg=JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));
  if(!({...pkg.dependencies,...pkg.devDependencies}).remotion) throw new Error('Expected an existing Remotion project');
  // Project installs only touch Aiyoupu-named paths. The bundled demo score
  // is for Standalone and is not copied into an existing project's public tree.
  const song=fs.readFileSync(path.join(root,'assets/runtime/src/song-v2.tsx'),'utf8').replaceAll("'./animations/score/","'../animations/score/").replaceAll('"./animations/score/','"../animations/score/');
  plan.push([null,path.join(target,'src/aiyoupu-demo/song-v2.tsx'),song]);
  // Legacy V1 shares the runtime folder through a separate entry path.
  const legacy=fs.readFileSync(path.join(root,'assets/runtime/src/song.tsx'),'utf8').replaceAll("'./animations/score/","'../animations/score/").replaceAll('\"./animations/score/','\"../animations/score/');
  plan.push([null,path.join(target,'src/aiyoupu-demo/song.tsx'),legacy]);
  // A host project already has its composition registry. Install the render
  // entry under a distinct name so this updater cannot overwrite that file.
  const renderEntry=`import React from 'react';
import {Composition,getInputProps,registerRoot} from 'remotion';
import {dimensions} from '../animations/score/AiyoupuPresentation';
import {AiyoupuScoreScene,type AiyoupuScoreSceneProps} from '../animations/score/AiyoupuScoreSceneV2';
type SongProps=AiyoupuScoreSceneProps & {width?:number;height?:number;presentation?:{cameraPath?:{cameraX:number;cameraY:number}[]}};
const Song:React.FC<SongProps>=(props)=><AiyoupuScoreScene {...props} timeline={{...props.timeline,cameraPath:props.presentation?.cameraPath??props.timeline.cameraPath}}/>;
const Root:React.FC=()=>{const input=getInputProps<SongProps>();if(!input.timeline||!input.scoreSrc)throw new Error('SONG_PROPS_REQUIRED: provide the checked song props; no demo fallback is allowed.');return <Composition id="Aiyoupu-Song" component={Song} durationInFrames={input.timeline.durationInFrames} fps={input.timeline.fps} width={input.width??dimensions(input.aspectRatio).width} height={input.height??dimensions(input.aspectRatio).height} defaultProps={{...input}}/>;};
registerRoot(Root);
`;
  plan.push([null,path.join(target,'src/aiyoupu-demo/song-root-v2.tsx'),renderEntry]);
}
add(path.join(root,'components'),path.join(target,'src/animations/score'));
// Preflight the entire plan before any writes. Identical files may be reused.
for(const [src,dst,content] of plan) {
  for(let parent=path.dirname(dst);;parent=path.dirname(parent)) {
    if(fs.existsSync(parent)&&!fs.statSync(parent).isDirectory())throw new Error(`Parent path is not a directory: ${parent}. Nothing installed.`);
    if(parent===path.dirname(parent))break;
  }
  if(fs.existsSync(dst)&&(!fs.statSync(dst).isFile()||!fs.readFileSync(dst).equals(src?fs.readFileSync(src):Buffer.from(content)))) throw new Error(`Existing file differs: ${dst}. Nothing installed.`);
}
const environment=await discoverEnvironment({project:target,authorizedProjects:reuseProject?[reuseProject]:[]});
const reuse=reuseProject?environment.projects.find(p=>p.project===reuseProject):null;
if(environment.verificationPending&&!environment.selectedProject)throw new Error('ENVIRONMENT_VERIFICATION_PENDING: matching packages exist, but CLI verification timed out. Inspect diagnostics and re-probe; do not reinstall dependencies. Nothing installed.');
if(reuseProject&&!reuse?.compatible)throw new Error(`Incompatible --reuse-project: ${JSON.stringify(reuse?.issues??['not found'])}. Nothing installed.`);
const dependencyTarget=path.join(target,'node_modules');
const dependencySource=reuse?fs.realpathSync(path.join(reuse.project,'node_modules')):null;
if(reuse) {
  if(path.relative(target,dependencySource)===''||!path.relative(target,dependencySource).startsWith('..')&&!path.isAbsolute(path.relative(target,dependencySource)))throw new Error('Reuse source must be outside installation target');
  try {fs.lstatSync(dependencyTarget);throw new Error('Dependency target already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
  // Exact runtime declaration match is required as well as installed package probes.
  const pkg=JSON.parse(fs.readFileSync(mode==='--standalone'?path.join(root,'assets/runtime/package.json'):path.join(target,'package.json'),'utf8'));
  const declared={...pkg.dependencies,...pkg.devDependencies};
  for(const [name,version] of Object.entries(BASELINE))if(declared[name]!==version)throw new Error(`Target declaration ${name} must be exactly ${version} for reuse. Nothing installed.`);
}
const runtimePkg=JSON.parse(fs.readFileSync(path.join(root,'assets/runtime/package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'assets/runtime/package-lock.json'),'utf8'));
const targetPkg=mode==='--standalone'?runtimePkg:JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));
let targetLock=mode==='--standalone'?lock:null;
if(mode==='--project')try{targetLock=JSON.parse(fs.readFileSync(path.join(target,'package-lock.json'),'utf8'));}catch{ /* absence is disclosed in the plan */ }
const ready=!!environment.selectedProject;
const result={mode,target,planOnly,files:plan.map(([,destination])=>destination),environment,
  dependencies:{action:reuse?'link':ready?'reuse-existing':'confirmation_required',source:dependencySource,target:dependencyTarget,versions:reuse?.versions??environment.projects[0]?.versions??{},expectedVersions:BASELINE},
  confirmation_required:!ready,
  npmCi:{executed:false,command:'npm ci',cwd:target,expected:{dependencies:targetPkg.dependencies??{},devDependencies:targetPkg.devDependencies??{},lockedPackageCount:targetLock?.packages?Object.keys(targetLock.packages).length-1:null,lockfile:path.join(target,'package-lock.json')},reason:ready?'Compatible existing dependencies found; no npm operation needed.':mode==='--standalone'?'No compatible existing environment selected. npm ci would install the bundled exact lockfile including development dependencies; separate explicit confirmation is required.':'No compatible existing environment selected. Review the target package.json and lockfile before authorizing its package manager; bundled lockfile must not replace the project lockfile.'},
  entry:mode==='--standalone'?'src/index.tsx':'src/aiyoupu-demo/song-root-v2.tsx',songEntry:mode==='--standalone'?'src/song-v2.tsx':'src/aiyoupu-demo/song-v2.tsx'};
if(!planOnly) {
  for(const [src,dst,content] of plan) {fs.mkdirSync(path.dirname(dst),{recursive:true});if(!fs.existsSync(dst)) src?fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL):fs.writeFileSync(dst,content,{flag:'wx'});}
  if(reuse)fs.symlinkSync(dependencySource,dependencyTarget,process.platform==='win32'?'junction':'dir');
  result.installed=target;
}
if(!planOnly&&mode==='--project'){
 // A project keeps its own composition registry. Never overwrite an existing
 // root or public score folder; the installed V2 song entry is the render path.
 result.projectRegistration={status:'manual',reason:'Preserve the host project composition registry.',entry:null,songEntry:path.join(target,'src/aiyoupu-demo','song-v2.tsx')};
}
result.distribution={
 schema:'aiyoupu-install-scope/v1',version:JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version,
 programFiles:Object.keys(JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).files??{}),
 preserved:['existing shared components (never overwritten)','V1 entry/song files (left in place)','user private and runtime files'],
 coexistence:mode==='--project'?{v1:['src/song.tsx','src/aiyoupu-demo/song.tsx'],v2:['src/song-v2.tsx','src/aiyoupu-demo/song-v2.tsx']}:{v1:['src/song.tsx'],v2:['src/song-v2.tsx']}
};
console.log(JSON.stringify(result,null,2));
