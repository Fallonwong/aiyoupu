import fs from 'node:fs';
import path from 'node:path';
import {discoverEnvironment} from './environment.mjs';
import {validateTimeline} from './prepare.mjs';
const args=process.argv.slice(2), options={authorizedProjects:[],pythonPaths:[]};
let targetArg, propsFileArg;
for(let i=0;i<args.length;i++) {
  const a=args[i];
  if(['--props','--authorized-project','--python'].includes(a)) {
    const value=args[++i];
    if(!value||value.startsWith('--'))throw new Error(`${a} requires a value`);
    if(a==='--props')propsFileArg=value;
    else options[a==='--python'?'pythonPaths':'authorizedProjects'].push(value);
  } else if(a.startsWith('--')||targetArg)throw new Error(`Unknown argument: ${a}`);
  else targetArg=a;
}
const target=path.resolve(targetArg??'.');
const environment=await discoverEnvironment({project:target,...options});
const report={project:target,node:process.version,checks:[],optional:environment.tools,environment};
const check=(name,ok,detail)=>report.checks.push({name,ok,detail});
check('node',Number(process.versions.node.split('.')[0])>=20,'Node >=20');
let projectPackage;
try {projectPackage=JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));check('package.json',true,path.join(target,'package.json'));}catch(e){check('package.json',false,e.message);}
check('environment',!!environment.selectedProject,environment.selectedProject?`Reuse compatible environment: ${environment.selectedProject}`:'No compatible environment found. Run install.mjs --plan to review reuse or confirmation_required; no automatic dependency installation.');
report.dependencyIssues=environment.projects[0].issues;
check('typescript-config',fs.existsSync(path.join(target,'tsconfig.json')),'tsconfig.json');
check('lockfile',['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock'].some(f=>fs.existsSync(path.join(target,f))),'Use the project lockfile; package manager is not switched automatically');
let material;

try {
  if(propsFileArg){const propsFile=path.resolve(propsFileArg);material=JSON.parse(fs.readFileSync(propsFile,'utf8'));report.assetSelection={mode:'explicit-props',propsFile};}
  else {
    let slug;
    if(projectPackage?.name==='aiyoupu-portable-runtime'&&fs.existsSync(path.join(target,'src/index.tsx'))) {slug='demo';report.assetSelection={mode:'standalone',slug};}
    else if(fs.existsSync(path.join(target,'src/aiyoupu-demo/index.tsx'))) {slug='aiyoupu-demo';report.assetSelection={mode:'existing-project',slug};}
    else if(['demo','aiyoupu-demo'].some(s=>fs.existsSync(path.join(target,'public/score',s,'timeline.json')))) throw new Error('Score directories exist but no AI有谱 installation is identified; pass --props <song-props.json> explicitly.');
    if(slug){const p=path.join(target,'public/score',slug,'timeline.json');material={timeline:JSON.parse(fs.readFileSync(p,'utf8')),scoreSrc:`score/${slug}/score.svg`};}
  }
  if(material){validateTimeline(material.timeline);check('timeline',true,`${material.timeline.events.length} attacks; structural check only`);
    for(const [label,value] of [['score',material.scoreSrc],['audio',material.audioSrc],['overlay',material.overlay?.enabled?material.overlay.src:undefined]]) {
      if(!value&&label==='score')throw new Error('scoreSrc required');
      if(!value&&label==='overlay'&&material.overlay?.enabled)throw new Error('Enabled overlay requires src');
      if(value){const publicRoot=path.resolve(target,'public');const f=path.resolve(publicRoot,value);check(`asset:${label}`,f.startsWith(publicRoot+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile(),String(value));}
    }
  } else report.assets='No demo assets installed yet; install first or pass --props <song-props.json> to check user assets.';
}catch(e){check('materials',false,e.message);}
report.browser='No browser is prepared or launched by doctor. Rendering may require an existing browser or separately authorized provisioning.';
console.log(JSON.stringify(report,null,2));
if(report.checks.some(c=>!c.ok))process.exitCode=1;