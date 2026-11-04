#!/usr/bin/env node
// Prepare the local Mutopia Canon in D test material for the workbench preview.
// Inputs are read-only originals; every derived file is written into
// workbench/canon-public-test/prepared/. Note coordinates come from real
// browser measurement (getBBox + getScreenCTM) of the same SVG, never hand typed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {measureNative} from './geometry-v2.mjs';
import {sha256,hashObject,failure} from './audio.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scripts, '..');
export const CANON_DIR = path.join(skillRoot, 'workbench', 'canon-public-test');
export const PREPARED_DIR = path.join(CANON_DIR, 'prepared');
const FPS = 30;
const NORMALIZED_WIDTH = 1600;

const stepIndex = {C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6};

function parseMusicXmlNotes(text) {
  const close = '<' + '/';
  const measures = [...text.matchAll(new RegExp('<measure number="(\\d+)"[^>]*>([\\s\\S]*?)' + close + 'measure>', 'g'))];
  if (!measures.length) throw failure('CANON_XML_INVALID', 'No measures found', 'Supply the MuseScore export.');
  const divisions = Number(text.match(/<divisions>(\d+)</)?.[1] ?? 0);
  if (!divisions) throw failure('CANON_XML_INVALID', 'Missing divisions', 'Supply the MuseScore export.');
  const tempos = [...text.matchAll(/<sound[^>]*tempo="([\d.]+)"/g)].map(m => Number(m[1]));
  const bpm = tempos[0] ?? 60;
  const notes = [];
  let tick = 0, measureIndex = 0;
  for (const m of measures) {
    measureIndex++;
    const body = m[2];
    for (const raw of body.matchAll(new RegExp('<note\\b([^>]*)>([\\s\\S]*?)' + close + 'note>', 'g'))) {
      const attrs = raw[1], inner = raw[2];
      const duration = Number(inner.match(/<duration>(\d+)</)?.[1] ?? 0);
      if (/<grace\b/.test(attrs) || /<grace\b/.test(inner)) continue;
      if (/<rest\b/.test(inner)) { tick += duration; continue; }
      const step = inner.match(/<step>([A-G])</)?.[1];
      const octave = Number(inner.match(/<octave>(\d+)</)?.[1]);
      const alter = Number(inner.match(/<alter>(-?\d+)</)?.[1] ?? 0);
      if (!step || !Number.isFinite(octave)) throw failure('CANON_XML_INVALID', 'Pitched note without step/octave', 'Check the MusicXML export.');
      notes.push({
        measure: measureIndex, tick, duration,
        step, octave, alter,
        pitch: step + (alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '') + octave,
        diatonic: octave * 7 + stepIndex[step],
      });
      tick += duration;
    }
  }
  return {divisions, bpm, notes, measureCount: measures.length, totalTicks: tick};
}

function parseStaffSystems(svg) {
  const lines = [...svg.matchAll(new RegExp('<polyline class="StaffLines"[^>]*points="([^"]+)"', 'g'))].map(m => {
    const p = m[1].trim().split(/\s+/).map(q => q.split(',').map(Number));
    return {y: p[0][1], x1: Math.min(p[0][0], p[1][0]), x2: Math.max(p[0][0], p[1][0])};
  }).sort((a, b) => a.y - b.y);
  if (!lines.length) throw failure('CANON_SVG_INVALID', 'No staff lines found', 'Supply the MuseScore SVG export.');
  const staves = [];
  for (const line of lines) {
    const current = staves.at(-1);
    if (current && Math.abs(line.y - current.lines.at(-1).y) < 120) current.lines.push(line);
    else staves.push({lines: [line]});
  }
  return staves.map(s => ({
    top: Math.min(...s.lines.map(l => l.y)),
    bottom: Math.max(...s.lines.map(l => l.y)),
    left: Math.min(...s.lines.map(l => l.x1)),
    right: Math.max(...s.lines.map(l => l.x2)),
  }));
}

function parseNoteGeometry(svg) {
  const out = [];
  let index = 0;
  for (const m of svg.matchAll(new RegExp('<path class="Note"([^>]*)>', 'g'))) {
    const d = m[1].match(/ d="([^"]+)"/)?.[1];
    if (!d) continue;
    const pairs = [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map(x => [Number(x[1]), Number(x[2])]);
    if (!pairs.length) continue;
    const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
    out.push({
      index, svgId: 'canon-note-' + index,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
    index++;
  }
  return out;
}

function withNoteIds(svg, notes) {
  let cursor = 0;
  return svg.replace(new RegExp('<path class="Note"([^>]*)>', 'g'), (whole, attrs) => {
    const note = notes[cursor++];
    if (!note) return whole;
    return '<path class="Note" id="' + note.svgId + '"' + attrs + '>';
  });
}

function audioDuration(file) {
  try {
    return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], {encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}).trim());
  } catch { return null; }
}

export function buildCanonSample({browser, write = true, log = () => {}} = {}) {
  const svgFile = path.join(CANON_DIR, 'CanonInD-musescore-1.svg');
  const xmlFile = path.join(CANON_DIR, 'CanonInD.musicxml');
  const audioFile = path.join(CANON_DIR, 'CanonInD-musescore.mp3');
  for (const f of [svgFile, xmlFile]) if (!fs.existsSync(f)) throw failure('CANON_SOURCE_MISSING', f, 'Keep the Mutopia/MuseScore originals in workbench/canon-public-test/.');
  const svgRaw = fs.readFileSync(svgFile, 'utf8');
  const viewBox = svgRaw.match(/<svg[^>]*viewBox="([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4) throw failure('CANON_SVG_INVALID', 'Missing viewBox', 'Supply the MuseScore SVG export.');
  const [vbX, vbY, vbW, vbH] = viewBox;
  const xml = parseMusicXmlNotes(fs.readFileSync(xmlFile, 'utf8'));
  const staves = parseStaffSystems(svgRaw);
  const svgNotes = parseNoteGeometry(svgRaw);
  if (svgNotes.length !== xml.notes.length) throw failure('CANON_COUNT_MISMATCH', svgNotes.length + ' SVG noteheads vs ' + xml.notes.length + ' MusicXML notes', 'Re-export both files from the same MuseScore run.');
  const preparedSvgPath = path.join(PREPARED_DIR, 'canon-score-ids.svg');
  if (write) fs.mkdirSync(PREPARED_DIR, {recursive: true});
  const svgWithIds = withNoteIds(svgRaw, svgNotes);
  if (!browser || !fs.existsSync(browser)) throw failure('BROWSER_REQUIRED', String(browser || ''), 'Point --browser at an installed Chromium/Edge.');
  // Measurement scratch (browser profile, DOM dump) stays outside the repo so the
  // prepared folder only holds the deliverables.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-geometry-'));
  if (write) {
    fs.mkdirSync(workDir, {recursive: true});
    fs.writeFileSync(preparedSvgPath, svgWithIds);
  }
  const measured = measureNative(preparedSvgPath, svgNotes.map(n => ({svgId: n.svgId, noteIndex: n.index})), browser, path.join(workDir, 'browser'));
  const byIndex = new Map(measured.map(m => [m.noteIndex, m]));
  const staffOf = y => {
    let best = 0, bd = Infinity;
    staves.forEach((s, i) => { const d = Math.abs((s.top + s.bottom) / 2 - y); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const geometric = svgNotes.map(n => {
    const m = byIndex.get(n.index);
    const staff = staffOf(m.y);
    return {...n, x: m.x, y: m.y, staff, system: staff};
  });
  const ordered = [...geometric].sort((a, b) => a.system !== b.system ? a.system - b.system : a.x - b.x || b.y - a.y);
  // Pair measured noteheads with MusicXML notes in reading order, then prove the
  // pairing: for every staff system the diatonic-pitch-minus-vertical-offset value
  // must fall into a small number of tight clusters (one per clef on that staff).
  const paired = ordered.map((n, i) => ({...n, xml: xml.notes[i]}));
  const staffHalf = (staves[0].bottom - staves[0].top) / 8;
  const perSystem = [];
  for (let s = 0; s < staves.length; s++) {
    const members = paired.filter(p => p.staff === s);
    const offsets = members.map(p => {
      const stepsFromBottom = (staves[s].bottom - p.y) / staffHalf;
      return p.xml.diatonic - stepsFromBottom;
    });
    const clusters = [];
    for (const value of [...offsets].sort((a, b) => a - b)) {
      const cluster = clusters.at(-1);
      if (cluster && Math.abs(value - cluster.mean) < 0.6) {
        cluster.values.push(value);
        cluster.mean = cluster.values.reduce((a, b) => a + b, 0) / cluster.values.length;
      } else clusters.push({values: [value], mean: value});
    }
    const spread = Math.max(...clusters.map(c => Math.max(...c.values.map(v => Math.abs(v - c.mean)))));
    perSystem.push({system: s, notes: members.length, clefClusters: clusters.map(c => Number(c.mean.toFixed(2))), spread: Number(spread.toFixed(3))});
  }
  const deviation = Math.max(...perSystem.map(s => s.spread));
  if (perSystem.some(s => s.clefClusters.length > 2)) throw failure('CANON_PITCH_PAIRING_UNPROVEN', 'A staff system spans more than two clef offsets: ' + JSON.stringify(perSystem), 'Do not publish this timeline until the pairing is verified.');
  if (deviation > 0.6) throw failure('CANON_PITCH_PAIRING_UNPROVEN', 'Vertical notehead positions do not follow the MusicXML pitch order (max deviation ' + deviation.toFixed(2) + ' half-steps)', 'Do not publish this timeline until the pairing is verified.');
  const scale = NORMALIZED_WIDTH / vbW;
  const scoreWidth = NORMALIZED_WIDTH;
  const scoreHeight = Number((vbH * scale).toFixed(4));
  const framesPerTick = (60 / xml.bpm / xml.divisions) * FPS;
  const groups = [];
  for (const p of paired) {
    const last = groups.at(-1);
    if (last && last.tick === p.xml.tick) last.notes.push(p);
    else groups.push({tick: p.xml.tick, measure: p.xml.measure, duration: p.xml.duration, notes: [p]});
  }
  const events = groups.map(g => {
    const notes = g.notes.map(p => ({
      x: Number((p.x * scale).toFixed(3)), y: Number((p.y * scale).toFixed(3)),
      pitch: p.xml.pitch, durationFrames: Math.round(g.duration * framesPerTick),
    }));
    return {
      measure: g.measure, hand: 'right', frame: Number((g.tick * framesPerTick).toFixed(3)),
      x: Number((notes.reduce((s, n) => s + n.x, 0) / notes.length).toFixed(3)),
      y: Number((notes.reduce((s, n) => s + n.y, 0) / notes.length).toFixed(3)),
      durationFrames: Math.round(g.duration * framesPerTick),
      notes,
    };
  });
  const audioSeconds = audioDuration(audioFile);
  const scoreSeconds = (xml.totalTicks / xml.divisions) * (60 / xml.bpm);
  const durationSeconds = audioSeconds ?? scoreSeconds;
  const durationInFrames = Math.ceil(durationSeconds * FPS);
  // System windows from measured y bands (systems are single staves here).
  const systemBands = staves.map((s, i) => {
    const members = paired.filter(n => n.system === i);
    return {
      name: 'S' + i,
      staffTop: Number((s.top * scale).toFixed(3)),
      staffBottom: Number((s.bottom * scale).toFixed(3)),
      centerY: Number((((s.top + s.bottom) / 2) * scale).toFixed(3)),
      firstX: Number((Math.min(...members.map(m => m.x)) * scale).toFixed(3)),
      lastX: Number((Math.max(...members.map(m => m.x)) * scale).toFixed(3)),
      measures: [...new Set(members.map(m => m.xml.measure))],
      firstFrame: Math.min(...members.map(m => m.xml.tick * framesPerTick)),
      lastFrame: Math.max(...members.map(m => m.xml.tick * framesPerTick)),
    };
  });
  const notesSorted = events.map(e => ({frame: e.frame, x: e.x}));
  const systemsSorted = systemBands.map(b => ({first: b.firstFrame, last: b.lastFrame, y: b.centerY}));
  const focusPath = Array.from({length: durationInFrames}, (_, frame) => {
    let index = systemsSorted.findLastIndex(s => frame >= s.first);
    index = Math.max(0, index);
    const a = systemsSorted[index], b = systemsSorted[Math.min(systemsSorted.length - 1, index + 1)];
    const transition = Math.min(14, b.first - a.last);
    let y = a.y;
    if (index < systemsSorted.length - 1 && frame >= b.first - transition && transition > 0) {
      const t = Math.max(0, Math.min(1, (frame - (b.first - transition)) / transition));
      y = a.y + (b.y - a.y) * (t * t * (3 - 2 * t));
    }
    let x = notesSorted[0].x;
    for (let i = 1; i < notesSorted.length; i++) {
      if (frame >= notesSorted[i].frame) x = notesSorted[i].x;
      else {
        const p = notesSorted[i - 1], n = notesSorted[i];
        const q = Math.max(0, Math.min(1, (frame - p.frame) / Math.max(1e-6, n.frame - p.frame)));
        x = p.x + (n.x - p.x) * q;
        break;
      }
    }
    return {focusX: Number(x.toFixed(2)), focusY: Number(y.toFixed(2))};
  });
  const timeline = {
    schema: 'aiyoupu-timeline/canon-local-v1',
    fps: FPS, durationInFrames, durationInSeconds: Number(durationSeconds.toFixed(3)),
    scoreWidth, scoreHeight,
    viewBox: {x: vbX, y: vbY, width: vbW, height: vbH},
    normalization: {width: NORMALIZED_WIDTH, scale, note: 'Coordinates are native viewBox units multiplied by this scale; scoreWidth/scoreHeight and scoreImage therefore share one coordinate space.'},
    bpm: xml.bpm, divisions: xml.divisions,
    systems: systemBands,
    events, focusPath,
    status: 'measured_preview_only',
  };
  const layout = {
    schema: 'aiyoupu-canon-layout/v1',
    geometryMethod: 'browser-native-svg/getBBox+getScreenCTM',
    scoreSha256: sha256(fs.readFileSync(svgFile)),
    preparedScoreSha256: sha256(Buffer.from(svgWithIds)),
    xmlSha256: sha256(fs.readFileSync(xmlFile)),
    audioSha256: fs.existsSync(audioFile) ? sha256(fs.readFileSync(audioFile)) : null,
    timelineSha256: hashObject(timeline),
    noteheadCount: svgNotes.length,
    staffSystems: staves.length,
    pairing: {method: 'reading order within each staff system', pitchCheckMaxDeviationHalfSteps: Number(deviation.toFixed(3)), clefClusters: perSystem},
    limits: [
      'Coordinates prove engraving position only; they do not grant notation approval.',
      'The MuseScore export is a single treble staff with one voice; no left-hand staff exists in this file.',
      'Audio comes from the same MuseScore export and is not an independently recorded performance.',
    ],
  };
  const summary = {
    status: 'canon_prepared',
    notes: events.reduce((n, e) => n + e.notes.length, 0),
    events: events.length,
    measures: xml.measureCount,
    systems: staves.length,
    durationInFrames,
    scoreSeconds: Number(scoreSeconds.toFixed(3)),
    audioSeconds,
    audioTailSeconds: audioSeconds ? Number((audioSeconds - scoreSeconds).toFixed(3)) : null,
    scoreWidth, scoreHeight,
    pairingDeviation: Number(deviation.toFixed(3)),
    files: {timeline: 'prepared/timeline.json', layout: 'prepared/layout.json'},
  };
  if (write) {
    fs.writeFileSync(path.join(PREPARED_DIR, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
    fs.writeFileSync(path.join(PREPARED_DIR, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
    fs.writeFileSync(path.join(PREPARED_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  log(summary);
  return {timeline, layout, summary};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const browser = arg('browser') ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const result = buildCanonSample({browser, log: s => console.log(JSON.stringify(s, null, 2))});
  console.log(JSON.stringify({status: result.summary.status, dev: result.summary.pairingDeviation}));
}
