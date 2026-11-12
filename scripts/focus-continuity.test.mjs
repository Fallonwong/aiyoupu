#!/usr/bin/env node
// A focused regression for the camera-continuity gate: the defect it guards
// (one focus sample per attack, held for the note value) is invisible to every
// shape check, so it needs its own assertions.
import assert from 'node:assert/strict';
import {focusContinuityReport, assertFocusContinuity, repairFocusContinuity} from './focus-continuity.mjs';

const base = {fps: 30, scoreWidth: 1000, scoreHeight: 500, durationInFrames: 120,
  events: [{hand: 'right', frame: 0, x: 100, y: 200, notes: [{x: 100, y: 200, pitch: 'C5'}]}]};
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };

// One coordinate held for 13 frames then jumping: the real reported defect.
const stepped = [];
for (let f = 0; f < 120; f++) stepped.push({focusX: 100 + Math.floor(f / 13) * 60, focusY: 200});

check('a held coordinate then a jump is reported as discontinuous', () => {
  const report = focusContinuityReport({...base, focusPath: stepped});
  assert.equal(report.status, 'discontinuous');
  assert.ok(report.hops.length > 0, 'expected hops');
  assert.ok(report.hops[0].frame > 0, 'first hop cannot be frame 0');
});

check('the gate blocks a formal bind on a stepped path', () => {
  assert.throws(() => assertFocusContinuity({...base, focusPath: stepped}), e => e.code === 'FOCUS_PATH_DISCONTINUOUS');
});

check('continuous travel is accepted and never flagged', () => {
  const smooth = Array.from({length: 120}, (_, f) => ({focusX: 100 + f * 2, focusY: 200}));
  const report = focusContinuityReport({...base, focusPath: smooth});
  assert.equal(report.status, 'continuous');
  assert.equal(report.hops.length, 0);
  assert.equal(assertFocusContinuity({...base, focusPath: smooth}).checked, true);
});

check('repair makes a stepped path continuous and keeps every landing exact', () => {
  const result = repairFocusContinuity({...base, focusPath: stepped}, {windowFrames: 14});
  assert.equal(result.before.hops.length > 0, true);
  assert.equal(result.after.hops.length, 0, 'repair must remove every hop');
  assert.equal(result.after.shortRuns.length, 0, 'repair must not leave abrupt moves');
  assert.equal(result.timeline.focusPath.length, stepped.length, 'frame count is preserved');
  for (let i = 1; i < stepped.length; i++) {
    if (stepped[i].focusX === stepped[i - 1].focusX) continue;
    assert.equal(result.timeline.focusPath[i].focusX, stepped[i].focusX, 'landing frame ' + i + ' moved');
  }
});

check('an already smooth path is left byte-identical by repair', () => {
  const smooth = Array.from({length: 120}, (_, f) => ({focusX: 100 + f * 2, focusY: 200}));
  const result = repairFocusContinuity({...base, focusPath: smooth});
  assert.equal(result.repaired, 0);
  assert.deepEqual(result.timeline.focusPath, smooth);
});

check('a short score is not judged with a pixel-sized threshold', () => {
  const tiny = Array.from({length: 40}, (_, f) => ({focusX: 10 + f * .2, focusY: 5}));
  const report = focusContinuityReport({...base, scoreWidth: 40, scoreHeight: 20, durationInFrames: 40, focusPath: tiny});
  assert.equal(report.checked, true);
  assert.equal(report.status, 'continuous');
});

check('repair leaves a back-to-back landing pair alone rather than deforming it', () => {
  const tight = [];
  for (let f = 0; f < 40; f++) tight.push({focusX: f < 10 ? 100 : f < 12 ? 300 : 300, focusY: 200});
  const result = repairFocusContinuity({...base, durationInFrames: 40, focusPath: tight}, {windowFrames: 14});
  // Only three frames exist between the two landings; the pair must survive.
  assert.equal(result.timeline.focusPath[10].focusX, 300, 'landing value changed');
});

console.log('\nfocus-continuity: ' + checks + ' groups passed');
