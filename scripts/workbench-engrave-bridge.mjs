import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {failure} from './audio.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scripts, '..');
const PREPARE_PY = path.join(scripts, 'workbench-prepare.py');
const PY_CANDIDATES = [process.env.AIYOUPU_PYTHON].filter(Boolean).filter(p => fs.existsSync(p));
const VEROVIO_CANDIDATES = [process.env.AIYOUPU_VEROVIO].filter(Boolean).filter(p => fs.existsSync(p));
const BROWSER_CANDIDATES = [
  process.env.AIYOUPU_BROWSER,
  process.env.AIYOUPU_CHROME,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(p => fs.existsSync(p));
const MUSESCORE_CANDIDATES = [
  process.env.AIYOUPU_MUSESCORE,
].filter(Boolean).filter(p => fs.existsSync(p));

export function prepareStatus() {
  return {python: PY_CANDIDATES[0] ?? null, verovio: VEROVIO_CANDIDATES[0] ?? null,
    browser: BROWSER_CANDIDATES[0] ?? null, musescore: MUSESCORE_CANDIDATES[0] ?? null,
    script: fs.existsSync(PREPARE_PY)};
}

/** Convert a standard MIDI file to MusicXML with the installed MuseScore CLI.
 *  The result is a notation draft; the workbench still shows the normal score
 *  review gate before any delivery is approved. */
export function midiToMusicXML(midiPath, outPath) {
  const [museScore] = MUSESCORE_CANDIDATES;
  if (!museScore) throw failure('MUSESCORE_REQUIRED', 'MuseScore 4 is needed to turn MIDI into a readable score',
    'Set AIYOUPU_MUSESCORE to an installed executable; no fixed author-machine path is used.');
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  const r = spawnSync(museScore, ['-o', outPath, midiPath],
    {encoding: 'utf8', timeout: 180000, windowsHide: true});
  if (!fs.existsSync(outPath) || !fs.statSync(outPath).size) {
    throw failure('MIDI_CONVERSION_FAILED', String(r.stderr || r.stdout || 'MuseScore produced no MusicXML').slice(-400),
      'Inspect the MIDI file, then re-import it.');
  }
  return {musicxml: outPath, converter: 'MuseScore 4 CLI', note: 'MIDI-to-score is a draft; review notation and hand assignment before approval.'};
}

/** Engrave MusicXML into SVG + timeline. Throws with an actionable reason on failure. */
export function engraveMusicXML(musicxmlPath, outDir) {
  const [python] = PY_CANDIDATES;
  if (!python) throw failure('PYTHON_UNAVAILABLE', 'No configured Python 3 found', 'Set AIYOUPU_PYTHON to an installed Python 3.10+ interpreter; no installation is performed.');
  if (!VEROVIO_CANDIDATES.length) throw failure('VEROVIO_UNAVAILABLE', 'No configured Verovio module found', 'Set AIYOUPU_VEROVIO to an existing module directory; no installation is performed.');
  const [browser] = BROWSER_CANDIDATES;
  if (!browser) throw failure('BROWSER_REQUIRED', 'No Edge or Chrome found', 'Install a Chromium browser for coordinate measurement.');
  if (!fs.existsSync(PREPARE_PY)) throw failure('PREPARE_SCRIPT_MISSING', PREPARE_PY, 'Restore scripts/workbench-prepare.py.');

  // The measurement helper uses a Chromium driver. Prefer a bundled driver when
  // present, otherwise search the standard local package roots. It is never
  // installed implicitly.
  const puppeteerCandidates = [
    process.env.AIYOUPU_PUPPETEER_CORE,
    path.join(skillRoot, 'node_modules', 'puppeteer-core'),
    path.join(process.cwd(), 'node_modules', 'puppeteer-core'),
  ].filter(Boolean);
  const puppeteerCore = puppeteerCandidates.find(p => fs.existsSync(path.join(p, 'package.json')));
  const env = {...process.env};
  if (puppeteerCore) env.AIYOUPU_PUPPETEER_CORE = puppeteerCore;
  const r = spawnSync(python, [PREPARE_PY, '--musicxml', musicxmlPath, '--out', outDir, '--browser', browser, '--verovio', VEROVIO_CANDIDATES[0]], {encoding: 'utf8', timeout: 300000, env});
  const lines = String(r.stdout || '').trim().split('\n').filter(Boolean);
  const last = lines.at(-1);
  if (r.status !== 0) throw failure('PREPARE_FAILED', String(last || r.stderr || 'engraving failed').slice(-400), 'Inspect the MusicXML, Verovio module and browser.');
  try {
    return JSON.parse(last);
  } catch {
    throw failure('PREPARE_PROTOCOL_ERROR', String(last || '').slice(-300), 'The engraving script must print one JSON line.');
  }
}
