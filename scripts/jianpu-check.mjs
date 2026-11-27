import fs from 'node:fs';
import {isMain} from './entry.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../references/jianpu.schema.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const own = (value, key) => Object.hasOwn(value, key);
const shapeTypes = {
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray,
  string: value => typeof value === 'string',
  integer: Number.isSafeInteger,
  number: Number.isFinite,
  null: value => value === null,
};

// Evaluate only the structural keywords used by the bundled schema.
export function validateShape(value, rule = schema, at = '$') {
  if (rule.$ref) return validateShape(value, schema.$defs[rule.$ref.split('/').at(-1)], at);
  const error = message => [{path: at, message}];
  if (rule.anyOf) return rule.anyOf.some(choice => !validateShape(value, choice, at).length) ? [] : error('No allowed shape matched');
  if (rule.enum && !rule.enum.includes(value)) return error('Expected one of: ' + rule.enum.join(', '));
  if (rule.type && !shapeTypes[rule.type](value)) return error('Expected ' + rule.type);
  if (value < rule.minimum || value > rule.maximum) return error('Value is out of range');
  if (typeof value === 'string' && value.length < rule.minLength) return error('Text is empty');
  if (Array.isArray(value)) {
    if (value.length < rule.minItems || value.length > rule.maxItems) return error('Array length is out of range');
    return value.flatMap((item, index) => validateShape(item, rule.items, at + '[' + index + ']'));
  }
  if (rule.properties) {
    const missing = rule.required.filter(key => !own(value, key)).map(key => ({path: at + '.' + key, message: 'Required field is missing'}));
    const fields = Object.entries(value).flatMap(([key, item]) => {
      const location = at + '.' + key;
      return own(rule.properties, key) ? validateShape(item, rule.properties[key], location) : [{path: location, message: 'Unknown field'}];
    });
    return [...missing, ...fields];
  }
  return [];
}

const gcd = (a, b) => b === 0n ? a : gcd(b, a % b);
function fraction(n, d = 1n) {
  const divisor = gcd(n, d);
  return {n: n / divisor, d: d / divisor};
}
const exact = ({n, d}) => fraction(BigInt(n), BigInt(d));
const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const multiply = (a, b) => fraction(a.n * b.n, a.d * b.d);
const compare = (a, b) => a.n * b.d - b.n * a.d;
const equal = (a, b) => compare(a, b) === 0n;
const sortByBeat = (a, b) => Math.sign(Number(compare(a, b)));
const beatLabel = ({n, d}) => n + '/' + d;
const zero = fraction(0n);

export function validateJianpu(score) {
  const errors = validateShape(score);
  const playbackIssues = [];
  const report = () => ({
    status: errors.length ? 'invalid' : score.issues.length ? 'needs_source_review' : 'structure_valid',
    readyForPlayback: !errors.length && !score.issues.length && !playbackIssues.length,
    errors,
    issues: Array.isArray(score?.issues) ? score.issues : [],
    playbackIssues,
  });
  if (errors.length) return report();
  const fail = (path, message) => errors.push({path, message});
  const index = (items, name, key = 'id') => {
    const map = new Map();
    for (const item of items) {
      if (map.has(item[key])) fail(name + '.' + item[key], 'Duplicate ' + key);
      map.set(item[key], item);
    }
    return map;
  };
  const voices = index(score.voices, 'voices');
  if (new Set(score.voices.map(voice => voice.row)).size !== voices.size) fail('voices', 'Voice rows must be distinct');
  if (!score.voices.some(voice => voice.row === 'upper')) fail('voices', 'An upper voice is required');
  const measures = index(score.measures, 'measures', 'number');
  const notes = index(score.notes, 'notes');
  const tuplets = index(score.tuplets, 'tuplets');
  const annotations = index(score.annotations, 'annotations');
  index(score.issues, 'issues');

  let cursor = zero;
  let previousMeasure;
  const ends = new Map();
  const onsets = new Map();
  const lengths = new Map();
  const starts = new Map();
  const lanes = new Map();
  const members = new Map();
  for (const measure of score.measures) {
    const at = 'measures.' + measure.number;
    if (previousMeasure && (measure.number <= previousMeasure.number || measure.system < previousMeasure.system)) fail(at, 'Measures must be in written order');
    previousMeasure = measure;
    const meter = measure.meter ?? score.meter;
    const full = fraction(BigInt(meter.beats) * 4n, BigInt(meter.beatUnit));
    const length = measure.span ? exact(measure.span) : full;
    if (length.n === 0n || compare(length, full) > 0n) fail(at, 'Measure span must be positive and within the meter');
    starts.set(measure.number, cursor);
    lengths.set(measure.number, length);
    cursor = add(cursor, length);
    const lane = new Map();
    for (const voice of measure.voices) {
      if (!voices.has(voice) || lane.has(voice)) fail(at, 'Unknown or duplicate active voice: ' + voice);
      lane.set(voice, []);
    }
    lanes.set(measure.number, lane);
  }

  for (const note of score.notes) {
    const at = 'notes.' + note.id;
    const lane = lanes.get(note.measure)?.get(note.voice);
    if (!lane) {
      fail(at, 'Note must belong to an active voice in an existing measure');
      continue;
    }
    const base = fraction(1n, 2n ** BigInt(note.durationLines));
    const dotFactor = fraction(2n ** BigInt(note.dots + 1) - 1n, 2n ** BigInt(note.dots));
    const written = add(multiply(base, dotFactor), fraction(BigInt(note.extensionDashes)));
    if (!equal(written, exact(note.duration))) fail(at, 'Written duration disagrees with duration lines, dots or extension dashes');
    if (note.durationLines && note.extensionDashes) fail(at, 'Extension dashes require an undivided base note');
    if (note.beamGroupIds && note.beamGroupIds.length !== note.durationLines) fail(at, 'Beam group entries must match duration-line count');
    if (note.degree === 0 && (note.octave !== 0 || note.accidental !== 0 || note.accidentalSign || note.lyric || note.fingering)) fail(at, 'A rest has no pitch, lyric or fingering');
    if (note.accidentalSign && ['doubleFlat', 'flat', 'natural', 'sharp', 'doubleSharp'][note.accidental + 2] !== note.accidentalSign) fail(at, 'Accidental sign disagrees with the effective accidental');
    const group = note.tupletId ? tuplets.get(note.tupletId) : undefined;
    if (note.tupletId && !group) fail(at, 'Unknown tuplet: ' + note.tupletId);
    if (group) {
      if (!members.has(group.id)) members.set(group.id, []);
      members.get(group.id).push(note);
    }
    const start = exact(note.beat);
    const duration = group ? multiply(written, exact(group.ratio)) : written;
    const end = add(start, duration);
    onsets.set(note.id, add(starts.get(note.measure), start));
    ends.set(note.id, add(starts.get(note.measure), end));
    if (compare(start, lengths.get(note.measure)) >= 0n || compare(end, lengths.get(note.measure)) > 0n) fail(at, 'Note or rest extends outside the measure, use a tie for held notes across a barline');
    lane.push({start, end, note});
  }

  for (const [measure, lane] of lanes) {
    for (const [voice, entries] of lane) {
      const at = 'measures.' + measure + '.voices.' + voice;
      entries.sort((a, b) => sortByBeat(a.start, b.start));
      let end = zero;
      for (let i = 0; i < entries.length;) {
        const start = entries[i].start;
        const simultaneous = [];
        while (i < entries.length && equal(entries[i].start, start)) simultaneous.push(entries[i++]);
        if (!equal(start, end)) fail(at, 'Gap or overlap near beat ' + beatLabel(start));
        if (simultaneous.length > 1 && simultaneous.some(entry => entry.note.degree === 0)) fail(at, 'A rest cannot share a chord onset');
        end = simultaneous[0].end;
        for (const entry of simultaneous) if (compare(entry.end, end) > 0n) end = entry.end;
      }
      if (!equal(end, lengths.get(measure))) fail(at, 'Expected occupied duration ' + beatLabel(lengths.get(measure)) + ', reached ' + beatLabel(end));
    }
  }

  function anchor(value, at) {
    if (own(value, 'noteId')) {
      if (!own(value, 'edge') || own(value, 'measure') || own(value, 'beat') || own(value, 'voice')) {
        fail(at, 'A note anchor needs exactly noteId and edge');
        return undefined;
      }
      const beat = (value.edge === 'end' ? ends : onsets).get(value.noteId);
      if (!beat) fail(at, 'Unknown or invalid note anchor ' + value.noteId);
      return beat;
    }
    if (own(value, 'edge') || !own(value, 'measure') || !own(value, 'beat') || !measures.has(value.measure)) {
      fail(at, 'A beat anchor needs an existing measure and beat, with an optional voice');
      return undefined;
    }
    const local = exact(value.beat);
    if (compare(local, lengths.get(value.measure)) > 0n || (value.voice && !lanes.get(value.measure).has(value.voice))) {
      fail(at, 'Beat anchor exceeds measure bounds or refers to an inactive voice');
      return undefined;
    }
    return add(starts.get(value.measure), local);
  }

  for (const group of score.tuplets) {
    const at = 'tuplets.' + group.id;
    const start = anchor(group.start, at + '.start');
    const end = anchor(group.end, at + '.end');
    const list = members.get(group.id) ?? [];
    const count = new Set(list.map(note => beatLabel(onsets.get(note.id)))).size;
    if (count !== group.count || new Set(list.map(note => note.voice)).size !== 1) fail(at, 'Tuplet must contain its declared number of onsets in one voice');
    const ratio = exact(group.ratio);
    if (ratio.n === 0n || group.ratio.d !== group.count) fail(at, 'Tuplet ratio must be positive and written as normal count / declared count');
    if (start && end && (compare(start, end) > 0n || list.some(note => compare(onsets.get(note.id), start) < 0n || compare(onsets.get(note.id), end) > 0n))) fail(at, 'Tuplet anchors must cover all member onsets in order');
  }

  const tieStarts = new Set();
  const tieEnds = new Set();
  for (const mark of score.annotations) {
    const at = 'annotations.' + mark.id;
    const start = anchor(mark.start, at + '.start');
    const end = mark.end ? anchor(mark.end, at + '.end') : undefined;
    if (['crescendo', 'diminuendo', 'tie', 'slur', 'pedal'].includes(mark.type) && !mark.end) fail(at, 'This annotation requires both endpoints');
    if (start && end && compare(start, end) >= 0n) fail(at, 'End must follow start');
    if (['dynamic', 'tempoText', 'tempoMark', 'expressionText'].includes(mark.type) && !mark.value) fail(at, 'Written text is required');
    if (mark.type === 'dynamic' && mark.value && !/^(p{1,6}|f{1,6}|mp|mf|sf|sfz|sffz|sfp|sfpp|fp|rf|rfz|fz)$/.test(mark.value)) fail(at, 'Unrecognized dynamic marking');
    if (['tie', 'slur', 'accent', 'staccato'].includes(mark.type)) {
      const first = notes.get(mark.start.noteId);
      const last = notes.get(mark.end?.noteId);
      if (!first?.degree || mark.start.edge !== 'start' ||
          (['tie', 'slur'].includes(mark.type) && (!last?.degree || mark.end.edge !== 'start'))) fail(at, 'Symbol must anchor to pitched note onsets');
      if (mark.type === 'tie' && first && last && ends.has(first.id) && onsets.has(last.id)) {
        if (first.voice !== last.voice || first.degree !== last.degree || first.octave !== last.octave ||
            first.accidental !== last.accidental || !equal(ends.get(first.id), onsets.get(last.id))) fail(at, 'Tie must connect adjacent written segments of the same pitch and voice');
        if (tieStarts.has(first.id) || tieEnds.has(last.id)) fail(at, 'Tie forks or merges');
        tieStarts.add(first.id);
        tieEnds.add(last.id);
      }
    }
  }

  const lyricOwners = new Set(score.notes.filter(note => note.lyric).map(note => note.id));
  for (const note of score.notes) {
    for (const id of note.lyric?.continuesOn ?? []) {
      const next = notes.get(id);
      if (!next?.degree || next.voice !== note.voice || lyricOwners.has(id) ||
          !onsets.has(note.id) || !onsets.has(id) || compare(onsets.get(id), onsets.get(note.id)) <= 0n) fail('notes.' + note.id + '.lyric', 'Continuation must be an unassigned later pitched note in the same voice: ' + id);
      lyricOwners.add(id);
    }
  }

  let previousTempo;
  const tempoMarks = new Set();
  for (const [i, tempo] of score.tempo.entries()) {
    const at = 'tempo[' + i + ']';
    const position = anchor(tempo.at, at + '.at');
    if (position && (!i && !equal(zero, position) || previousTempo && compare(position, previousTempo) <= 0n)) fail(at, 'Tempo table must start at beat zero and move strictly forward');
    if (position) previousTempo = position;
    if (tempo.transition === 'linear' && i === score.tempo.length - 1) fail(at, 'A linear tempo segment needs a following point');
    if (tempo.annotationId) {
      if (!['tempoText', 'tempoMark'].includes(annotations.get(tempo.annotationId)?.type)) fail(at, 'Tempo source must refer to a written tempo annotation');
      tempoMarks.add(tempo.annotationId);
    }
  }
  if (!score.tempo.length) playbackIssues.push('Initial numeric tempo is unresolved');
  if (score.tonic.octave === undefined) playbackIssues.push('Register of undotted degree 1 is unresolved');
  for (const mark of score.annotations) {
    if (mark.type === 'tempoText' && /渐慢|渐快|\brit|\brall|\baccel/i.test(mark.value ?? '') && !tempoMarks.has(mark.id)) playbackIssues.push('Playback tempo is unresolved for ' + mark.id);
  }
  return report();
}

if (isMain(import.meta.url)) {
  try {
    const [file, extra] = process.argv.slice(2);
    if (!file || extra) throw new Error('Usage: node scripts/jianpu-check.mjs <score.jianpu.json>');
    const score = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const result = validateJianpu(score);
    process.exitCode = result.status === 'invalid' ? 1 : 0;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    process.exitCode = 1;
    console.error(JSON.stringify({status: 'invalid', message: error.message}));
  }
}
