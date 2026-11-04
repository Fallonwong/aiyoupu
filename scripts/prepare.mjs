#!/usr/bin/env node
// Node.js >=18; built-in modules only. No score coordinates are inferred.
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMidi } from './midi.mjs';
import {isMain} from './entry.mjs';

const HELP = `Usage: node prepare.mjs --svg score.svg --timeline timeline.json
  [--audio performance.mp3] [--midi score.mid] [--musicxml score.musicxml]
  [--score-image staff.png] [--jianpu-image numbered.png]
  [--pdf score.pdf]
  --out <project>/public/score/<slug> [--preprocessor <executable>]

--out is the exact destination directory, which must not already exist.
Missing SVG/timeline: exit 3 with an incomplete report and optional tool discovery.
Preprocessor protocol: executable --out <scratch-directory> [--svg <input>]
  [--timeline <input>] [--audio <input>] [--midi <input>] [--musicxml <input>]
  [--score-image <input>] [--jianpu-image <input>]
It must write score.svg and timeline.json for missing inputs. Existing explicit
SVG/timeline inputs take precedence. No shell, command strings, or auto-installs.
Exit codes: 0 imported, 2 invalid input/tool failure, 3 incomplete.
`;
const fail = (message) => { throw new Error(message); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function checkNumbers(value, at = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${at}: non-finite number`);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) checkNumbers(child, `${at}.${key}`);
  }
}

export function validateTimeline(t) {
  if (!object(t)) fail('timeline must be a JSON object');
  checkNumbers(t);
  const width = t.scoreWidth ?? t.width;
  for (const [key, value] of Object.entries({ fps: t.fps, width, scoreHeight: t.scoreHeight })) {
    if (!finite(value) || value <= 0) fail(`${key} must be a finite positive number`);
  }
  if (t.width !== undefined && (!finite(t.width) || t.width <= 0)) fail('width must be finite and positive');
  if (t.scoreWidth !== undefined && (!finite(t.scoreWidth) || t.scoreWidth <= 0)) fail('scoreWidth must be finite and positive');
  if (t.width !== undefined && t.scoreWidth !== undefined && t.width !== t.scoreWidth) fail('width and scoreWidth disagree');
  if (!Number.isSafeInteger(t.durationInFrames) || t.durationInFrames <= 0) fail('durationInFrames must be a positive safe integer');
  if (!Array.isArray(t.events) || !t.events.length) fail('events must be a nonempty array');
  if (t.cameraPath !== undefined) {
    if (!Array.isArray(t.cameraPath) || t.cameraPath.length !== t.durationInFrames) fail('cameraPath must contain one sample per frame');
    t.cameraPath.forEach((p,i)=>{if(!object(p)||!finite(p.cameraX)||!finite(p.cameraY))fail(`cameraPath[${i}] needs finite cameraX/cameraY`);});
  }
  if(t.focusPath!==undefined&&(!Array.isArray(t.focusPath)||t.focusPath.length!==t.durationInFrames||t.focusPath.some(p=>!object(p)||!finite(p.focusX)||!finite(p.focusY))))fail('focusPath must contain one finite focusX/focusY sample per frame');
  const last = { left: -Infinity, right: -Infinity };
  const point = (p, at) => {
    if (!object(p) || !finite(p.x) || !finite(p.y)) fail(`${at}: x/y must be finite numbers`);
  };
  t.events.forEach((event, i) => {
    const at = `events[${i}]`;
    if (!object(event)) fail(`${at}: must be an object`);
    if (event.hand !== 'left' && event.hand !== 'right') fail(`${at}: hand must be left or right`);
    if (!finite(event.frame) || event.frame < 0 || event.frame >= t.durationInFrames) fail(`${at}: frame must be finite and in [0, durationInFrames)`);
    if (event.frame === last[event.hand]) fail(`${at}: same-hand same-frame attacks must be grouped into one event.notes array`);
    if (event.frame < last[event.hand]) fail(`${at}: each hand must be sorted by frame`);
    last[event.hand] = event.frame;
    point(event, at);
    if (!Array.isArray(event.notes) || !event.notes.length) fail(`${at}: notes must be a nonempty array`);
    event.notes.forEach((note, j) => {
      point(note, `${at}.notes[${j}]`);
      if (note.pitch !== undefined && typeof note.pitch !== 'string') fail(`${at}.notes[${j}]: pitch must be a string`);
    });
  });
  // Canonical contract field; preserve supplied coordinates, frames and status.
  return { ...t, scoreWidth: width };
}

function parseArgs(argv) {
  const allowed = new Set(['svg', 'timeline', 'audio', 'midi', 'musicxml', 'score-image', 'jianpu-image', 'pdf', 'out', 'preprocessor']);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!allowed.has(key)) fail(`unknown argument: ${argv[i]}`);
    if (Object.hasOwn(args, key)) fail(`duplicate argument: --${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) fail(`--${key} requires a value`);
    args[key] = value;
  }
  if (!args.out) fail('--out is required');
  return args;
}

async function isFile(file) {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}

async function findExecutable(name) {
  const isWindows = os.platform() === 'win32';
  const dirs = name.includes('/') || name.includes('\\') ? [''] : (process.env.PATH || '').split(path.delimiter);
  const suffixes = isWindows && !path.extname(name) ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const dir of dirs) for (const suffix of suffixes) {
    const candidate = path.resolve(dir.replace(/^"|"$/g, ''), name + suffix);
    if (await isFile(candidate)) {
      try { await fs.access(candidate, isWindows ? constants.F_OK : constants.X_OK); return candidate; } catch { /* continue */ }
    }
  }
  return null;
}

async function discoverTools() {
  const names = ['MuseScore4', 'MuseScore3', 'mscore', 'musescore', 'Audiveris', 'audiveris', 'verovio'];
  const found = await Promise.all(names.map(async (name) => ({ name, executable: await findExecutable(name) })));
  return { search: 'PATH only; detection does not establish layout or alignment capability', found: found.filter((x) => x.executable) };
}

const LIMITATIONS = [
  'Import validates structure only; supplied verification status is not independently certified.',
  'SVG coordinate provenance, ties, pitch accuracy and MP3 synchronization require separate review.',
  'No MP3 transcription, optical music recognition or score-coordinate generation is performed.',
];

export async function prepare(args) {
  const out = path.resolve(args.out);
  // Refuse merging or overwriting a previous bundle, including a symlink.
  try { await fs.lstat(out); fail(`output already exists: ${out}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputs = {};
  for (const key of ['svg', 'timeline', 'audio', 'midi', 'musicxml', 'score-image', 'jianpu-image', 'pdf']) {
    if (args[key]) {
      inputs[key] = path.resolve(args[key]);
      if (!await isFile(inputs[key])) fail(`--${key} is not a readable file: ${inputs[key]}`);
    }
  }
  const missing = ['svg', 'timeline'].filter((key) => !inputs[key]);
  const tools = missing.length ? await discoverTools() : undefined;
  if (missing.length && !args.preprocessor) {
    return { exitCode: 3, status: 'incomplete', missing, optionalTools: tools, limitations: LIMITATIONS,
      inputValidation: 'file_existence_only_at_this_stage',
      agentHandoff: {
        workflowReference: 'references/material-preparation.md',
        availableSources: Object.keys(inputs), requiredOutputs: missing.map(k=>k==='svg'?'score.svg':'timeline.json'),
        action: 'Discover and reuse the current Agent capabilities for the missing stages; CLI discovery is only one source of capability evidence.',
        interfaces: ['Agent tools/Skills/libraries may generate assets directly, then rerun this importer.', 'An explicitly selected executable adapter may implement --preprocessor.'],
      },
      next: 'Continue material preparation with available Agent capabilities; supply matching SVG + timeline, or explicitly choose an existing adapter. Do not install all optional CLIs.' };
  }
  let staging;
  let published = false;
  try {
    // Validate ordinary imports before creating any output directory.
    let tool;
    if (missing.length) {
      tool = await findExecutable(args.preprocessor);
      if (!tool) fail(`preprocessor executable not found: ${args.preprocessor}`);
      if (/\.(cmd|bat)$/i.test(tool)) fail('preprocessor must be a native executable; wrap scripts in an executable (shell execution is disabled)');
      await fs.mkdir(path.dirname(out), { recursive: true });
      staging = await fs.mkdtemp(path.join(path.dirname(out), '.aiyoupu-prepare-'));
      const commandArgs = ['--out', staging];
      for (const [key, file] of Object.entries(inputs)) commandArgs.push(`--${key}`, file);
      const result = spawnSync(tool, commandArgs, { shell: false, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
      if (result.error || result.status !== 0) fail(`preprocessor failed: ${result.error?.message || `exit ${result.status}`}; ${String(result.stderr || '').slice(-2000)}`);
      for (const key of missing) {
        const file = path.join(staging, key === 'svg' ? 'score.svg' : 'timeline.json');
        // Reject symlink outputs and non-files from the executable interface.
        const stat = await fs.lstat(file).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink()) fail(`preprocessor did not produce a regular ${path.basename(file)}`);
        inputs[key] = file;
      }
    }
    const svg = await fs.readFile(inputs.svg, 'utf8');
    if (!/<svg\b[^>]*>/i.test(svg) || !(/<\/svg\s*>\s*$/i.test(svg) || /<svg\b[^>]*\/\s*>\s*$/i.test(svg))) fail('SVG must contain a complete svg root element');
    const timeline = validateTimeline(JSON.parse((await fs.readFile(inputs.timeline, 'utf8')).replace(/^\uFEFF/, '')));
    const midiNotes = inputs.midi ? parseMidi(await fs.readFile(inputs.midi)) : null;
    if (inputs.musicxml) {
      const xml = await fs.readFile(inputs.musicxml);
      if (xml[0] === 0x50 && xml[1] === 0x4b) fail('compressed MusicXML (.mxl) is unsupported; provide an unpacked .musicxml file');
      if (!/<score-(partwise|timewise)\b/.test(xml.toString('utf8'))) fail('MusicXML must contain score-partwise or score-timewise');
    }
    const warnings = [...LIMITATIONS];
    if(inputs['score-image']||inputs['jianpu-image'])warnings.push('Source image paths were accepted for preparation; the importer did not recognize or decode their notation. Originals are retained at their supplied paths, not copied into this output bundle.');
    if (timeline.status !== 'verified') warnings.push(`Timeline status remains ${JSON.stringify(timeline.status ?? 'unspecified')}; review/alignment may be unfinished.`);
    const width = timeline.scoreWidth;
    if (timeline.events.some((e) => [e, ...e.notes].some((p) => p.x < 0 || p.y < 0 || p.x > width || p.y > timeline.scoreHeight))) {
      warnings.push('Some coordinates lie outside the declared dimensions; inspect SVG viewBox, transforms and overflow. Coordinates were preserved.');
    }
    if (!staging) {
      await fs.mkdir(path.dirname(out), { recursive: true });
      staging = await fs.mkdtemp(path.join(path.dirname(out), '.aiyoupu-prepare-'));
    }
    // Only known bundle files are published, never arbitrary preprocessor outputs.
    const bundle = path.join(staging, 'bundle');
    await fs.mkdir(bundle);
    const assets = { svg: 'score.svg', timeline: 'timeline.json' };
    await fs.copyFile(inputs.svg, path.join(bundle, assets.svg));
    await fs.writeFile(path.join(bundle, assets.timeline), JSON.stringify(timeline, null, 2) + '\n');
    for (const [key, name] of [['audio', 'audio.mp3'], ['midi', 'score.mid'], ['musicxml', 'score.musicxml']]) {
      if (inputs[key]) { await fs.copyFile(inputs[key], path.join(bundle, name)); assets[key] = name; }
    }
    if (midiNotes) {
      assets.timedNotes = 'timed-notes.json';
      await fs.writeFile(path.join(bundle, assets.timedNotes), JSON.stringify(midiNotes, null, 2) + '\n');
    }
    const manifest = {
      schemaVersion: 1, status: 'imported', validation: 'structural_only',
      timelineStatus: timeline.status ?? null, assets,
      fps: timeline.fps, scoreWidth: width, scoreHeight: timeline.scoreHeight,
      durationInFrames: timeline.durationInFrames, events: timeline.events.length,
      hands: Object.fromEntries(['left', 'right'].map((hand) => [hand, timeline.events.filter((e) => e.hand === hand).length])),
      preprocessor: tool ? path.basename(tool) : null, warnings,
    };
    await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Reserve the final directory exclusively, so a concurrent writer is never overwritten.
    await fs.mkdir(out);
    published = true;
    for (const name of await fs.readdir(bundle)) await fs.rename(path.join(bundle, name), path.join(out, name));
    return { exitCode: 0, ...manifest, out };
  } catch (error) {
    if (published) await fs.rm(out, { recursive: true, force: true });
    throw error;
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) process.stdout.write(HELP);
    else {
      const result = await prepare(args);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'failed', error: error.message }) + '\n');
    process.exitCode = 2;
  }
}
