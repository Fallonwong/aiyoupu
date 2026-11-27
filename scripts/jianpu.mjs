import fs from 'node:fs';
import path from 'node:path';
import {sha256, hashObject, probeMedia} from './audio.mjs';
import {layoutJianpu, jianpuPositions} from './jianpu-layout.mjs';
import {jianpuSymbolic, tempoSeconds} from './jianpu-symbolic.mjs';
import {auditJianpuAudio, jianpuAudioXml} from './jianpu-audio.mjs';
import {executeLogged} from './execution.mjs';
import {approvalAudioChoice, requestReview, requireApproval} from './review.mjs';
import {measureNative} from './geometry-v2.mjs';
import {compilePerformance} from './music.mjs';
import {buildReadingCamera} from './reading-camera.mjs';
import {mappedTimeline, timelineFromMap, validateMappedNotation} from './performance-map.mjs';
import {masterAudio, renderScoreAudio, validateAudioEvidence} from './audio-production.mjs';
import {preparePreview} from './direction-engine.mjs';
import {isMain} from './entry.mjs';
import {auditJianpuImage, cropJianpuImage, validateImageAudit} from './jianpu-image.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
const hash = file => sha256(fs.readFileSync(file));
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };

function proofData(source, imageAudit) {
  const score = read(source);
  const layout = layoutJianpu(score);
  const check = {schema:'aiyoupu-jianpu-check/v1', source:path.resolve(source), sourceSha256:hash(source),
    score, scoreObjectSha256:hashObject(score), structuralPassed:true};
  if (imageAudit) {
    const audit=validateImageAudit(imageAudit,source);
    check.imageAudit=path.resolve(imageAudit);
    check.imageAuditSha256=hash(imageAudit);
    check.bindings={sourceSha256:audit.sourceSha256};
  }
  return {check, layout};
}

function bundle(dir, {browser} = {}) {
  const checkFile = path.resolve(dir, 'check.json');
  const stored = read(checkFile);
  const {check, layout} = proofData(stored.source,stored.imageAudit);
  const svg = path.resolve(dir, 'score.svg');
  if (hashObject(check) !== hashObject(stored) || sha256(layout.svg) !== hash(svg)) {
    fail('JIANPU_PROOF_STALE', 'JSON or proof SVG changed. Generate a new proof and request approval again.');
  }
  const symbolic = jianpuSymbolic(check);
  const values = Object.fromEntries(check.score.voices.map(voice => {
    const staff = voice.row === 'upper' ? 1 : 2;
    return ['Jianpu:' + staff + ':' + voice.id, voice.hand ?? (staff === 1 ? 'right' : 'left')];
  }));
  const mapping = symbolic.events.filter(event => event.kind === 'note').map(event => layout.positions.get(event.id));
  const notes = browser ? measureNative(svg, mapping, browser) : mapping;
  const placement = {notes, handMap:values, scoreWidth:layout.width, scoreHeight:layout.height};
  return {check, checkFile, layout, svg, symbolic, placement};
}

function idealMap(check, symbolic, {audio, evidence, leadSeconds = 0} = {}) {
  const position = jianpuPositions(check.score);
  const seconds = tempoSeconds(check.score, position);
  const beats = new Set([0, position.totalBeats]);
  for (const event of symbolic.events) {
    beats.add(event.startBeat);
    beats.add(event.endBeat);
  }
  for (const tempo of check.score.tempo) beats.add(position.anchor(tempo.at).beat);
  const ordered = [...beats].sort((a,b) => a-b).filter((value, i, items) => !i || value - items[i - 1] > 1e-8);
  return {schema:'aiyoupu-time-map/v2', scoreSha256:symbolic.scoreSha256, audioSha256:audio ? hash(audio) : null,
    anchors:ordered.map(beat => ({beat, seconds:seconds(beat) + leadSeconds, method:'manual', evidenceRef:evidence ?? check.source}))};
}

function makeTimeline(data, audio, map, rowPanScale = 1) {
  const {placement, symbolic, layout} = data;
  const timeline = audio ? mappedTimeline({symbolic, map, audio, placement}) : timelineFromMap({symbolic, map, placement});
  if (audio) timeline.durationInFrames = Math.max(timeline.durationInFrames, Math.ceil(probeMedia(audio).duration * timeline.fps));
  Object.assign(timeline, {systemBounds:layout.systemBounds});
  timeline.noteheadGeometry = 'glyph-center/v1';
  Object.assign(timeline, buildReadingCamera(timeline, undefined, {rowPanScale}));
  return compilePerformance(timeline, {strict:true});
}

function sameApproval(data, approval) {
  const review = requireApproval(approval, 'score', {musicSha256:data.symbolic.scoreSha256});
  const files = review.request.fingerprints;
  const sourceType=data.check.imageAudit?'jianpu-image':'jianpu-json';
  const audit=data.check.imageAudit && validateImageAudit(data.check.imageAudit,data.check.source);
  if (review.request.sourceType !== sourceType || (audit && (files[data.check.imageAudit]!==data.check.imageAuditSha256 ||
      files[audit.original]!==audit.sourceSha256 || files[audit.capture]!==audit.captureSha256 || files[audit.comparison]!==audit.comparisonSha256)) || files[data.check.source] !== data.check.sourceSha256 ||
      files[data.svg] !== hash(data.svg) || files[data.checkFile] !== hash(data.checkFile)) {
    fail('JIANPU_APPROVAL_STALE', 'Approval must cover this source, check and displayed proof SVG.');
  }
  return review;
}

export function validateJianpuBind({reportFile, timeline, score, approval, layout}) {
  const data = bundle(path.dirname(path.resolve(reportFile)));
  if (path.resolve(reportFile) !== data.checkFile || hash(data.svg) !== hash(score) ||
      timeline.sourceJianpuSha256 !== data.check.sourceSha256 || layout.geometryMethod !== 'browser-native-svg/v1' ||
      layout.producer.runId !== hash(data.svg).slice(0,20) || layout.mapping.some(item =>
        data.layout.positions.get(timeline.events[item.eventIndex]?.notes[item.noteIndex]?.id)?.svgId !== item.svgId)) {
    fail('JIANPU_PROOF_STALE', 'Bound assets differ from the frozen JianpuJSON and proof.');
  }
  validateMappedNotation(timeline, data.check);
  const review = sameApproval(data, approval);
  return Object.keys(review.request.fingerprints);
}

function usage() {
  return {commands:[
    'jianpu image-crops --image original.png --regions regions.json --out capture-dir',
    'jianpu image-audit --capture capture.json --draft recognition.jianpu.json --out audit-dir',
    'jianpu proof --source score.jianpu.json --out proof-dir [--image-audit image-audit.json]',
    'jianpu review --proof proof-dir --out review-dir [--reference original-crop.png]',
    'jianpu audio --proof proof-dir --score-approval approval.json --musescore MuseScore4.exe --soundfont "MS Basic.sf3" --out audio-dir',
    'jianpu prepare --proof proof-dir --score-approval approval.json --browser browser.exe --out bundle-dir [--audio path --audio-evidence receipt.json] [--map reviewed-recording-map.json] [--title title --subtitle subtitle --direction direction.json --row-pan-scale 1.25]',
  ]};
}

export function jianpuMain(argv) {
  const [command, ...flags] = argv;
  if (!command || command === '--help') return usage();
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i], value = flags[i+1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) fail('JIANPU_ARGUMENT_INVALID', key);
    options[key.slice(2)] = value;
  }
  const need = name => options[name] ?? fail('JIANPU_ARGUMENT_REQUIRED', '--' + name);
  const out = path.resolve(need('out'));
  if (command === 'image-crops') return cropJianpuImage({image:need('image'),regions:need('regions'),out,ffmpeg:options.ffmpeg,ffprobe:options.ffprobe});
  if (command === 'image-audit') return auditJianpuImage({capture:need('capture'),draft:need('draft'),out});
  if (command === 'proof') {
    const {check, layout} = proofData(need('source'),options['image-audit']);
    fs.mkdirSync(out, {recursive:false});
    write(path.join(out, 'check.json'), check);
    fs.writeFileSync(path.join(out, 'score.svg'), layout.svg, {flag:'wx'});
    return {status:'proof_created', score:path.join(out,'score.svg'), readiness:jianpuPositions(check.score).validation};
  }
  const data = bundle(need('proof'), {browser:options.browser});
  if (command === 'review' && data.check.imageAudit) {
    const audit=validateImageAudit(data.check.imageAudit,data.check.source);
    return requestReview({stage:'score',out,sourceType:'jianpu-image',musicSha256:data.symbolic.scoreSha256,
      files:[data.check.source,data.checkFile,data.svg,data.check.imageAudit,audit.capture,audit.original,audit.comparison],
      display:[audit.comparison,audit.original,data.svg],
      notes:['请核对整张原谱与 '+audit.measures.length+' 小节逐节对照。','确认使用原录音、采样钢琴或静音，再锁定本版谱面。']});
  }
  if (command === 'review') return requestReview({
    stage:'score', out, sourceType:'jianpu-json', musicSha256:data.symbolic.scoreSha256,
    files:[data.check.source, data.checkFile, data.svg, ...(options.reference ? [options.reference] : [])],
    display:[...(options.reference ? [options.reference] : []), data.svg],
    notes:['请核对简谱数字、节奏与换行，以及实际出现的声部、连音、力度和歌词。', '请选择录音、采样钢琴或静音。'],
  });
  const review = sameApproval(data, need('score-approval'));
  const choice = approvalAudioChoice(review);
  if (command === 'audio') {
    if (choice !== 'synthesize') fail('AUDIO_DECISION_MISMATCH', 'Score approval does not select sampled piano.');
    const musescore = path.resolve(need('musescore')), soundfont = path.resolve(need('soundfont'));
    const timeline = makeTimeline(data, null, idealMap(data.check, data.symbolic));
    fs.mkdirSync(out, {recursive:false});
    const transport = path.join(out,'playback-only.musicxml');
    fs.writeFileSync(transport, jianpuAudioXml(data.check.score, data.symbolic), {flag:'wx'});
    const midi = path.join(out,'playback-probe.mid');
    const probeLog = path.join(out,'playback-probe.command.json');
    executeLogged(musescore, ['-o', midi, transport], {cwd:out, log:probeLog});
    const audit = auditJianpuAudio(data.check.score, data.symbolic, fs.readFileSync(midi));
    write(path.join(out,'playback-audit.json'), {schema:'aiyoupu-jianpu-playback-audit/v1', ...audit,
      scoreSha256:data.symbolic.scoreSha256, fingerprints:Object.fromEntries([midi, transport, musescore, probeLog].map(file => [path.resolve(file),hash(file)]))});
    const result = renderScoreAudio({musicxml:transport, timeline:{...timeline, sourceMusicxmlSha256:hash(transport)},
      musescore, soundfont, out:path.join(out,'piano-raw.wav')});
    return masterAudio({evidence:result.evidence, timeline, out:path.join(out,'piano.wav')});
  }
  if (command !== 'prepare') fail('JIANPU_COMMAND_INVALID', command);
  need('browser');
  const audio = options.audio && path.resolve(options.audio);
  if ((choice === 'silent') === !!audio) fail('AUDIO_DECISION_MISMATCH', 'Audio must match the score approval.');
  let map;
  if (audio) {
    const receipt = path.resolve(need('audio-evidence'));
    const evidence = validateAudioEvidence(receipt, audio, {notation:{schema:'aiyoupu-symbolic-events/v2',scoreSha256:data.symbolic.scoreSha256},symbolic:data.symbolic});
    if (choice === 'provided' && (evidence.kind !== 'provided-recording' || !options.map)) fail('RECORDING_MAP_REQUIRED', 'Use provided recording evidence and an explicit reviewed map.');
    if (choice === 'synthesize') {
      if (evidence.kind !== 'sampled-score-export') fail('AUDIO_DECISION_MISMATCH', 'Use the approved sampled export.');
      const auditFile = path.join(path.dirname(receipt),'playback-audit.json');
      const audit = read(auditFile);
      const transport = Object.keys(audit.fingerprints ?? {}).find(file => path.basename(file) === 'playback-only.musicxml');
      const midi = Object.keys(audit.fingerprints ?? {}).find(file => path.basename(file) === 'playback-probe.mid');
      if (audit.schema !== 'aiyoupu-jianpu-playback-audit/v1' || audit.scoreSha256 !== data.symbolic.scoreSha256 ||
          !transport || !midi || audit.fingerprints[transport] !== sha256(jianpuAudioXml(data.check.score, data.symbolic)) ||
          evidence.fingerprints[transport] !== audit.fingerprints[transport] ||
          Object.entries(audit.fingerprints).some(([file,digest]) => hash(file) !== digest)) {
        fail('JIANPU_AUDIO_AUDIT_STALE', 'Regenerate the sampled export with the current approved score.');
      }
      auditJianpuAudio(data.check.score, data.symbolic, fs.readFileSync(midi));
    }
    map = options.map ? read(options.map) : idealMap(data.check, data.symbolic, {audio, evidence:receipt, leadSeconds:evidence.mix?.leadSeconds});
  } else map = idealMap(data.check, data.symbolic);
  const timeline = makeTimeline(data, audio, map, Number(options['row-pan-scale'] ?? 1));
  validateMappedNotation(timeline, data.check);
  const layout = {geometryMethod:'browser-native-svg/v1', scoreSha256:hash(data.svg), timelineSha256:hashObject(timeline),
    producer:{tool:'JianpuJSON layout + Chromium getBBox',runId:hash(data.svg).slice(0,20)},
    mapping:timeline.events.flatMap((event, eventIndex) => event.notes.map((note, noteIndex) => ({
      eventIndex, noteIndex, svgId:data.layout.positions.get(note.id).svgId, x:note.x, y:note.y})))};
  fs.mkdirSync(out, {recursive:false});
  write(path.join(out,'timeline.json'), timeline);
  write(path.join(out,'layout.json'), layout);
  return preparePreview({timeline, score:data.svg, audio, title:options.title ?? data.check.score.title,
    subtitle:options.subtitle ?? '', direction:options.direction ? read(options.direction) : undefined,
    out:path.join(out,'direction'), skillRoot:path.resolve(import.meta.dirname,'..')});
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(jianpuMain(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({status:'blocked', code:error.code ?? 'JIANPU_ERROR', message:error.message})); process.exitCode = 1; }
}
