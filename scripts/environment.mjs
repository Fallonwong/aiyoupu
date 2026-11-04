import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';

export const BASELINE = Object.freeze({remotion:'4.0.515','@remotion/cli':'4.0.515',react:'19.2.4','react-dom':'19.2.4',typescript:'5.9.3'});
const TIMEOUT = 5000;
const CLI_TIMEOUT = Math.max(1,Math.min(120000,Number(process.env.AIYOUPU_CLI_PROBE_TIMEOUT_MS)||15000));
const exists = p => {try{return fs.statSync(p).isFile();}catch{return false;}};
const dirs = p => {try{return fs.readdirSync(p,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(p,e.name));}catch{return [];}};
const canonical = p => {try{return fs.realpathSync(p);}catch{return path.resolve(p);}};
const key = p => process.platform==='win32'?canonical(p).toLowerCase():canonical(p);
const inside = (root,p) => {const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};

// No shell, stdin, browser preparation, package installation, or unbounded child processes.
export function probe(file,args=[],cwd,timeoutMs=TIMEOUT,extraEnv={}) {
  return new Promise(resolve=>{
    try {
    execFile(file,args,{cwd,encoding:'utf8',timeout:timeoutMs,maxBuffer:256*1024,windowsHide:true,env:{...process.env,CI:'1',PYTHONDONTWRITEBYTECODE:'1',...extraEnv}},(error,stdout,stderr)=>{
      resolve({path:file,args,ok:!error,exitCode:error?(typeof error.code==='number'?error.code:null):0,timedOut:!!error?.killed,stdout:stdout.trim(),stderr:stderr.trim(),error:error?String(error.code??error.message):null});
    }).stdin?.end();
    } catch(error) {
      resolve({path:file,args,ok:false,exitCode:null,timedOut:false,stdout:'',stderr:'',error:String(error.code??error.message)});
    }
  });
}

async function inspectProject(project) {
  const result={project,compatible:false,versions:{},cliPath:null,issues:[],modulePaths:{},cliProbe:null};
  try {
    JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
    const req=createRequire(path.join(project,'package.json'));
    const modules=canonical(path.join(project,'node_modules'));
    for(const [name,version] of Object.entries(BASELINE)) {
      try {
        const metadata=req.resolve(`${name}/package.json`);
        if(!inside(modules,canonical(metadata)))throw new Error('resolution escapes project node_modules; authorize that project explicitly');
        result.versions[name]=JSON.parse(fs.readFileSync(metadata,'utf8')).version;
        result.modulePaths[name]=req.resolve(name);
        if(result.versions[name]!==version)result.issues.push(`${name}: expected ${version}, found ${result.versions[name]}`);
        if(name==='@remotion/cli') {
          const pkg=JSON.parse(fs.readFileSync(metadata,'utf8'));
          const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.remotion;
          if(!bin)throw new Error('Remotion executable missing from package bin');
          result.cliPath=canonical(path.resolve(path.dirname(metadata),bin));
          if(!exists(result.cliPath))throw new Error('Remotion executable does not exist');
        }
      }catch(e){result.issues.push(`${name}: ${e.message}`);}
    }
    if(result.cliPath&&result.issues.length===0) {
      result.cliProbe=await probe(process.execPath,[result.cliPath,'--help'],project,CLI_TIMEOUT);
      const p=result.cliProbe;
      // --help prints the exact version banner without the unrelated
      // dependency scan performed before --version in 4.0.515.
      // Accept only that exact banner, the known exit codes, and empty stderr.
      const banner=p.stdout.replace(/\x1b\[[0-9;]*m/g,'');
      p.version= /(?:^|\n)@remotion\/cli (\d+\.\d+\.\d+)(?:\r?\n|$)/.exec(banner)?.[1]??null;
      p.ok=!p.timedOut&&[0,1].includes(p.exitCode)&&!p.stderr&&p.version===BASELINE['@remotion/cli'];
      if(!p.ok)result.issues.push(p.timedOut?'ENVIRONMENT_VERIFICATION_PENDING: installed packages match, but CLI probe timed out. Do not reinstall; inspect the process/cache and retry with AIYOUPU_CLI_PROBE_TIMEOUT_MS (max 120000).':'Remotion help/version banner probe failed; see cliProbe');
    }
  }catch(e){result.issues.push(e.message);}
  if(Number(process.versions.node.split('.')[0])<20)result.issues.push('Node >=20 required');
  result.compatible=result.issues.length===0;
  return result;
}

const toolNames=['ffmpeg','ffprobe','mscore','MuseScore4','musescore','audiveris','verovio'];
const extensions=process.platform==='win32'?['.exe','.com','.cmd','.bat','']:[''];
const pathDirs=()=> (process.env.PATH??'').split(path.delimiter).filter(Boolean).map(p=>p.replace(/^"|"$/g,''));
function candidatesAt(directory,names,add) {for(const name of names)for(const ext of extensions)add(path.join(directory,name+ext));}

async function discoverPackageManagers(projects) {
  const names=['npm','pnpm','yarn','bun'];
  const home=os.homedir();
  const directories=[...new Set([
    ...pathDirs(),path.dirname(process.execPath),
    path.join(home,'.bun/bin'),path.join(home,'.local/share/pnpm'),
    ...[process.env.APPDATA&&path.join(process.env.APPDATA,'npm'),process.env.PNPM_HOME].filter(Boolean),
  ].map(p=>path.resolve(p)))];
  const packageRoots=[...new Set([
    ...directories.map(d=>path.join(d,'node_modules')),
    path.resolve(path.dirname(process.execPath),'../lib/node_modules'),
    ...projects.map(p=>path.join(p,'node_modules')),
  ])];
  const packageManagers={};
  for(const name of names) {
    const entry={paths:[],path:null,version:null,available:false,probes:[],issues:[]};
    packageManagers[name]=entry;
    const commands=new Map(),wrappers=[];
    const remember=p=>{const actual=canonical(p);if(!entry.paths.includes(actual))entry.paths.push(actual);return actual;};
    const addScript=p=>{
      const actual=remember(p);
      commands.set(key(actual),/\.(?:exe|com)$/i.test(actual)?{path:actual,args:['--version'],cliPath:actual}:{path:process.execPath,args:[actual,'--version'],cliPath:actual});
    };
    // Read only known installed package metadata. Never execute Corepack proxies:
    // even --version can download a manager when its requested version is absent.
    for(const root of packageRoots)for(const pkgName of name==='yarn'?['yarn','@yarnpkg/cli-dist']:[name]) {
      const metadata=path.join(root,pkgName,'package.json');
      try {
        const pkg=JSON.parse(fs.readFileSync(metadata,'utf8'));
        if(pkg.name!==pkgName)continue;
        const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[name];
        if(!bin)continue;
        const script=path.resolve(path.dirname(metadata),bin);
        if(exists(script)&&!/[\\/]corepack[\\/]/i.test(canonical(script)))addScript(script);
      } catch { /* absent packages are recorded after candidate discovery */ }
    }
    for(const d of directories)candidatesAt(d,[name],p=>{
      if(!exists(p))return;
      const actual=remember(p);
      if(/[\\/]corepack[\\/]/i.test(actual)) {wrappers.push({path:actual,reason:'Corepack proxy skipped to prevent automatic downloads'});return;}
      if(/\.(?:cmd|bat|ps1)$/i.test(actual)||(process.platform==='win32'&&!/\.(?:exe|com|[cm]?js)$/i.test(actual))) {
        if(/\.(?:cmd|bat)$/i.test(actual)) {
          // Resolve only quoted literal %~dp0-relative JS filenames. Never expand
          // variables, evaluate batch code or forward its arguments to a shell.
          const stat=fs.statSync(actual);
          if(stat.size<=64*1024)for(const match of fs.readFileSync(actual,'utf8').matchAll(/"%~dp0([^"\r\n%]+\.[cm]?js)"/gi)) {
            const script=path.resolve(path.dirname(actual),match[1]);
            if(new RegExp(`^${name}(?:-cli)?\\.[cm]?js$`,'i').test(path.basename(script))&&exists(script)&&!/[\\/]corepack[\\/]/i.test(canonical(script)))addScript(script);
          }
        }
        wrappers.push({path:actual,reason:'Shell wrapper is not executed; use an existing installed CLI script'});return;
      }
      if(/\.[cm]?js$/i.test(actual))addScript(actual);
      else commands.set(key(actual),{path:actual,args:['--version'],cliPath:actual});
    });
    for(const command of commands.values()) {
      const result=await probe(command.path,command.args,undefined,TIMEOUT,{
        COREPACK_ENABLE_NETWORK:'0',COREPACK_ENABLE_AUTO_PIN:'0',COREPACK_ENABLE_PROJECT_SPEC:'0',
        npm_config_update_notifier:'false',npm_config_manage_package_manager_versions:'false',
        PNPM_MANAGE_PACKAGE_MANAGER_VERSIONS:'false',YARN_ENABLE_NETWORK:'0',
      });
      const version=/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(result.stdout)?.[1]??null;
      const valid=result.ok&&version!==null;
      entry.probes.push({...result,cliPath:command.cliPath,version,ok:valid});
      if(valid&&!entry.available) {entry.available=true;entry.path=command.cliPath;entry.version=version;}
    }
    for(const wrapper of wrappers)entry.issues.push(`${wrapper.path}: ${wrapper.reason}`);
    if(entry.paths.length===0)entry.issues.push('Not found in PATH, Node installation, known manager directories or authorized project dependencies');
    else if(!entry.available)entry.issues.push('No installed executable or CLI script passed the version probe; no packages were installed');
  }
  return packageManagers;
}

/** Read only. Other projects are inspected only when explicitly authorized.
 * pythonPaths: executable filenames. toolPaths: executable filenames or directories.
 * selectedProject is an absolute project path or null, never an implicit install.
 */
export async function discoverEnvironment({project=process.cwd(),authorizedProjects=[],pythonPaths=[],toolPaths=[]}={}) {
  // Accept explicit configuration for environments outside PATH and the
  // standard installed locations. These are existing files/directories, never
  // an implicit install.
  const configuredPython=[process.env.AIYOUPU_PYTHON].filter(Boolean);
  const configuredTools=[['AIYOUPU_VEROVIO','verovio'],['AIYOUPU_MUSESCORE','MuseScore4'],['AIYOUPU_FFMPEG','ffmpeg'],['AIYOUPU_FFPROBE','ffprobe']].map(([k,name])=>{const value=process.env[k];return value?{value,name}:null;}).filter(Boolean);
  pythonPaths=[...pythonPaths,...configuredPython];
  const roots=[];
  for(const p of [project,...authorizedProjects].map(p=>path.resolve(p)))if(!roots.some(r=>key(r)===key(p)))roots.push(p);
  const projects=[];
  for(const p of roots)projects.push(await inspectProject(p));
  const packageManagers=await discoverPackageManagers(roots);
  const pythonCandidates=new Map(), toolCandidates=new Map(), launchers=[];
  const addPython=p=>{if(exists(p))pythonCandidates.set(key(p),canonical(p));};
  const addTool=(p,name)=>{if(exists(p))toolCandidates.set(key(p),{name:name??path.basename(p,path.extname(p)),path:canonical(p)});};
  const configuredDirectories={};
  for(const configured of configuredTools){const target=path.resolve(configured.value),dir=fs.statSync(target,{throwIfNoEntry:false})?.isDirectory();if(dir){configuredDirectories[configured.name]=canonical(target);for(const n of toolNames)candidatesAt(target,[n],f=>addTool(f,n));}else if(exists(target))addTool(target,configured.name);}
  const addLauncher=(p,name)=>{if(exists(p)&&!launchers.some(x=>key(x.path)===key(p)))launchers.push({name,path:canonical(p)});};
  for(const p of pythonPaths)addPython(path.resolve(p));
  for(const root of roots)for(const v of ['.venv','venv'])for(const bin of ['Scripts/python.exe','bin/python','bin/python3'])addPython(path.join(root,v,bin));
  for(const root of [process.env.VIRTUAL_ENV,process.env.CONDA_PREFIX].filter(Boolean))for(const bin of ['python.exe','Scripts/python.exe','bin/python','bin/python3'])addPython(path.join(root,bin));
  for(const d of pathDirs()) {
    candidatesAt(d,['python','python3'],addPython);
    candidatesAt(d,['py'],p=>addLauncher(p,'py'));
    candidatesAt(d,['conda'],p=>addLauncher(p,'conda'));
    for(const n of toolNames)candidatesAt(d,[n],p=>addTool(p,n));
  }
  const home=os.homedir();
  if(process.platform==='win32') {
    const local=process.env.LOCALAPPDATA??path.join(home,'AppData/Local');
    const programRoots=[process.env.ProgramFiles??'C:/Program Files',process.env['ProgramFiles(x86)']??'C:/Program Files (x86)'];
    const pythonRoots=[...dirs(path.join(local,'Programs/Python')),...dirs('C:/').filter(p=>/^Python\d/i.test(path.basename(p))),...programRoots.flatMap(d=>dirs(d).filter(p=>/^Python\d/i.test(path.basename(p))))];
    for(const p of pythonRoots)addPython(path.join(p,'python.exe'));
    addLauncher(path.join(local,'Programs/Python/Launcher/py.exe'),'py');
    addLauncher(path.join(process.env.SystemRoot??'C:/Windows','py.exe'),'py');
    for(const root of [home,...programRoots,process.env.ProgramData??'C:/ProgramData'])for(const n of ['miniconda3','anaconda3','miniforge3','mambaforge']) {
      const p=path.join(root,n);addPython(path.join(p,'python.exe'));addLauncher(path.join(p,'Scripts/conda.exe'),'conda');
    }
    for(const root of programRoots)for(const d of dirs(root).filter(p=>/^(MuseScore|Audiveris|Verovio|ffmpeg)/i.test(path.basename(p)))) {
      for(const sub of ['', 'bin'])for(const n of toolNames)candidatesAt(path.join(d,sub),[n],p=>addTool(p,n));
    }
    for(const root of ['C:/ffmpeg/bin',path.join(local,'Microsoft/WinGet/Links'),path.join(home,'scoop/shims'),path.join(process.env.ProgramData??'C:/ProgramData','chocolatey/bin')])for(const n of toolNames)candidatesAt(root,[n],p=>addTool(p,n));
  } else {
    for(const d of ['/usr/bin','/usr/local/bin','/opt/homebrew/bin']) {
      candidatesAt(d,['python3','python'],addPython);
      for(const n of toolNames)candidatesAt(d,[n],p=>addTool(p,n));
    }
    for(const d of [path.join(home,'miniconda3'),path.join(home,'anaconda3')]) {addPython(path.join(d,'bin/python'));addLauncher(path.join(d,'bin/conda'),'conda');}
  }
  for(const p of toolPaths) {
    const absolute=path.resolve(p);
    if(exists(absolute))addTool(absolute);
    else for(const n of toolNames)candidatesAt(absolute,[n],f=>addTool(f,n));
  }
  const launcherProbes=[];
  for(const launcher of launchers) {
    if(/WindowsApps/i.test(launcher.path))continue;
    const r=await probe(launcher.path,launcher.name==='py'?['-0p']:['env','list','--json']);
    launcherProbes.push({...launcher,probe:r});
    if(!r.ok)continue;
    if(launcher.name==='py')for(const line of r.stdout.split(/\r?\n/)) {const match=line.match(/([A-Za-z]:\\.*?python(?:\d+(?:\.\d+)?)?\.exe)\s*$/i);if(match)addPython(match[1]);}
    else {try{for(const d of JSON.parse(r.stdout).envs??[])addPython(path.join(d,process.platform==='win32'?'python.exe':'bin/python'));}catch{ /* malformed launcher response is retained */ }}
  }
  const pyCode='import sys,json,importlib.util; names=["numpy","PIL","cv2","music21","mido","pretty_midi","librosa","soundfile","lxml","cairosvg","reportlab"]; print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0],"libraries":{n:importlib.util.find_spec(n) is not None for n in names}}))';
  const pythons=[];
  for(const p of pythonCandidates.values()) {
    if(/[/\\]Microsoft[/\\]WindowsApps[/\\]/i.test(p)) {pythons.push({path:p,valid:false,version:null,libraries:{},probe:null,issues:['Windows Store alias skipped']});continue;}
    const r=await probe(p,['-I','-c',pyCode]);
    let data;try{data=JSON.parse(r.stdout);}catch{ /* retained probe explains failure */ }
    const valid=r.ok&&typeof data?.executable==='string'&&exists(data.executable)&&/^3\./.test(data.version);
    pythons.push({path:valid?canonical(data.executable):p,discoveredPath:p,valid,version:data?.version??null,libraries:data?.libraries??{},probe:r,issues:valid?[]:['Python 3 executable probe failed']});
  }
  const tools={};
  for(const n of toolNames)tools[n]={paths:[],probes:[],available:false};
  for(const item of toolCandidates.values()) {
    const n=item.name;
    const result=await probe(item.path,[/^ff(mpeg|probe)$/i.test(n)?'-version':'--version']);
    const entry=tools[n]??={paths:[],probes:[],available:false};
    entry.paths.push(item.path);entry.probes.push(result);entry.available ||= result.ok;
  }
  return {baseline:BASELINE,compatibilityPolicy:'Exact installed versions, local module resolution, Node >=20 and actual Remotion CLI version probe required; timeouts mean unverified, not absent.',projects,selectedProject:projects.find(p=>p.compatible)?.project??null,verificationPending:projects.some(p=>p.cliProbe?.timedOut),packageManagers,pythons,selectedPython:pythons.find(p=>p.valid)?.path??null,pythonRequired:false,tools,configuredModules:configuredDirectories,launcherProbes,probeTimeoutMs:TIMEOUT,cliProbeTimeoutMs:CLI_TIMEOUT};
}
