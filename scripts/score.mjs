#!/usr/bin/env node
// Stable JSON-only CLI. Python performs parsing/cropping; no installs or shell execution.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {discoverEnvironment} from './environment.mjs';
import {isMain} from './entry.mjs';
export async function run(argv = process.argv.slice(2)) {
  const args = [], authorizedProjects = [];
  let project, explicitPython;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!['--python', '--project', '--authorized-project'].includes(flag)) {args.push(flag); continue;}
    const value = argv[++i];
    if (!value || value.startsWith('--') || (flag === '--python' && explicitPython) || (flag === '--project' && project))
      return {exit: 2, report: {code: 'INVALID_ARGUMENT', status: 'error', next: [`Supply one value for ${flag}; only --authorized-project may repeat.`]}};
    if (flag === '--authorized-project') authorizedProjects.push(path.resolve(value));
    else if (flag === '--project') project = path.resolve(value);
    else explicitPython = value;
  }
  let python = explicitPython || process.env.AIYOUPU_SCORE_PYTHON;
  const requiresPillow = ['compare', 'source'].includes(args[0]);
  let method = explicitPython ? 'explicit' : 'AIYOUPU_SCORE_PYTHON';
  if (!python) {
    method = 'discoverEnvironment';
    let environment;
    try { environment = await discoverEnvironment({project: project || process.cwd(), authorizedProjects}); }
    catch (error) {return {exit: 2, report: {code: 'ENVIRONMENT_DISCOVERY_FAILED', status: 'error', message: error.message, next: ['Inspect authorized project roots or supply --python EXE. No environment is created.']}};}
    // Module presence is only a discovery hint: actually import Pillow and exercise
    // its image API before choosing an existing interpreter for crops/source decoding.
    const candidates = environment.pythons.filter(p => p.valid && /^3\./.test(p.version) && Number(p.version.split('.')[1]) >= 10 && (!requiresPillow || p.libraries.PIL));
    const failures = [];
    for (const candidate of candidates) {
      const code = 'import sys,json,xml.etree.ElementTree; ' + (requiresPillow ? 'from PIL import Image; Image.new("RGB",(1,1)).getpixel((0,0)); ' : '') + 'print(json.dumps({"executable":sys.executable}))';
      const probe = spawnSync(candidate.path, ['-I', '-B', '-c', code], {encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 65536});
      if (probe.status === 0) {
        try {if (typeof JSON.parse(probe.stdout).executable === 'string') {python = candidate.path; break;}} catch { /* keep rejected probe */ }
      }
      failures.push({path: candidate.path, exit: probe.status, error: probe.error?.message || probe.stderr?.slice(-1000)});
    }
    if (!python) return {exit: 2, report: {code: 'PYTHON_UNAVAILABLE', status: 'error', requiresPillow,
      candidates: environment.pythons.map(p => ({path:p.path, valid:p.valid, version:p.version, pillow:!!p.libraries.PIL, issues:p.issues})), failures,
      next: [`No usable existing Python 3.10+${requiresPillow ? ' with Pillow' : ''} found. Supply --python EXE or --authorized-project ROOT for an existing environment. No installation was performed.`]}};
  }
  const result = spawnSync(python, ['-B', path.join(path.dirname(fileURLToPath(import.meta.url)), 'score.py'), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024,
    env: {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
      AIYOUPU_SCORE_PYTHON_SELECTION: JSON.stringify({path: python, method, requiresPillow})},
  });
  if (result.error) return {exit: 2, report: {code: 'PYTHON_UNAVAILABLE', status: 'error', message: result.error.message, next: ['Verify a Python 3.10+ interpreter; pass --python EXE. No environment is created.']}};
  try {return {exit: result.status ?? 2, report: {...JSON.parse(result.stdout), pythonSelection: {path: python, method, requiresPillow}}};}
  catch {return {exit: 2, report: {code: 'PYTHON_PROTOCOL_ERROR', status: 'error', message: result.stderr.slice(-4000), next: ['Check interpreter and stderr; Python must emit one JSON object.']}};}
}
if (isMain(import.meta.url)) {
  const {exit, report} = await run(); console.log(JSON.stringify(report, null, 2)); process.exitCode = exit;
}
