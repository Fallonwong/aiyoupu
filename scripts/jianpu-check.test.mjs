import assert from 'node:assert/strict';
import test from 'node:test';
import {validateJianpu} from './jianpu-check.mjs';

const f = (n, d = 1) => ({n, d});
const at = (measure, n, d = 1) => ({measure, beat: f(n, d)});
const edge = (noteId, side = 'start') => ({noteId, edge: side});
const note = (id, measure, beat, degree, options = {}) => ({
  id, voice: 'upper', measure, beat, degree, octave: 0, accidental: 0,
  duration: f(1), durationLines: 0, extensionDashes: 0, dots: 0, ...options,
});
const long = (duration = 4) => ({duration: f(duration), extensionDashes: duration - 1});
const mark = (id, type, start, fields = {}) => ({id, type, start, placement: 'above', ...fields});

function example() {
  return {
    schema: 'aiyoupu-jianpu/v1', title: 'Contract test',
    tonic: {step: 'G', accidental: 0, octave: 4}, meter: {beats: 4, beatUnit: 4},
    tempo: [{at: at(1, 0), bpm: 86, transition: 'step'}],
    voices: [{id: 'upper', row: 'upper'}, {id: 'lower', row: 'lower', hand: 'left'}],
    measures: [
      {number: 1, system: 1, voices: ['upper']},
      {number: 2, system: 2, voices: ['upper', 'lower'], barline: 'final'},
    ],
    notes: [
      note('a', 1, f(0), 3, {duration: f(3, 2), dots: 1, lyric: {text: '啊', continuesOn: ['b']}}),
      note('b', 1, f(3, 2), 4, {duration: f(1, 2), durationLines: 1}),
      note('c', 1, f(2), 5, long(2)),
      note('chord', 1, f(2), 7, long(2)),
      note('d', 2, f(0), 5),
      note('e', 2, f(1), 0, long(3)),
      note('bass', 2, f(0), 1, {...long(), voice: 'lower', octave: -1}),
    ],
    tuplets: [],
    annotations: [
      mark('dynamic', 'dynamic', edge('a'), {value: 'mp'}),
      mark('hairpin', 'diminuendo', at(1, 2), {end: at(2, 1)}),
      mark('melisma', 'slur', edge('a'), {end: edge('b')}),
      mark('tie', 'tie', edge('c'), {end: edge('d')}),
      mark('accent', 'accent', edge('a')),
      mark('staccato', 'staccato', edge('b')),
    ],
    issues: [],
  };
}

test('double voice enters late, chord shares time, cross-bar tie and hairpin retain anchors', () => {
  assert.deepEqual(validateJianpu(example()), {
    status: 'structure_valid', readyForPlayback: true, errors: [], issues: [], playbackIssues: [],
  });
});

for (const [count, normal] of [[3, 2], [5, 4]]) {
  test('tuplet occupies exact fraction for ' + count + ' in the time of ' + normal, () => {
    const score = example();
    const member = i => note('n' + i, 1, f(i * normal, count * 2), i + 1, {
      duration: f(1, 2), durationLines: 1, tupletId: 't', beamGroupIds: ['beam'],
    });
    score.notes = Array.from({length: count}, (_, i) => member(i));
    const groupEnd = normal / 2;
    for (let beat = groupEnd; beat < 4; beat++) score.notes.push(note('rest' + beat, 1, f(beat), 0));
    score.measures = score.measures.slice(0, 1);
    score.tuplets = [{id: 't', count, ratio: f(normal, count), start: edge('n0'),
      end: edge('n' + (count - 1), 'end'), placement: 'above', bracket: 'bracket'}];
    score.annotations = [];
    assert.equal(validateJianpu(score).readyForPlayback, true);
    score.tuplets[0].ratio.n++;
    assert.equal(validateJianpu(score).status, 'invalid');
  });
}

test('unknown heading blocks validation, image doubts and qualitative tempo block readiness', () => {
  const score = example();
  delete score.tonic.octave;
  score.tempo = [];
  score.annotations.push(mark('rit', 'tempoText', at(2, 0), {value: '渐慢'}));
  const source = {page: 1, x: 10, y: 20, width: 13, height: 14};
  score.issues.push({id: 'i', field: 'annotation', message: 'Unclear mark', source});
  const report = validateJianpu(score);
  assert.equal(report.status, 'needs_source_review');
  assert.equal(report.readyForPlayback, false);
  assert.equal(report.playbackIssues.length, 3);
  assert.deepEqual(report.issues[0].source, source);
  delete score.meter;
  assert.equal(validateJianpu(score).status, 'invalid');
});

test('rejects a broken tie, missing hairpin endpoint and incorrect written duration', () => {
  const score = example();
  score.notes.find(n => n.id === 'd').octave = 1;
  score.notes.find(n => n.id === 'a').duration = f(5, 4);
  delete score.annotations.find(n => n.id === 'hairpin').end;
  const {errors} = validateJianpu(score);
  for (const path of ['annotations.tie', 'annotations.hairpin', 'notes.a']) {
    assert.ok(errors.some(error => error.path === path));
  }
});
