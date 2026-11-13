#!/usr/bin/env node
import {cameraSpeedLimit,cameraTravel} from './reading-camera.mjs';
// Camera continuity is a measured property of the path, not a promise in prose.
// A path that holds one coordinate for several frames and then jumps is the
// literal "slideshow" camera: the score only moves when a new attack arrives.
// This module is the single authority used by validation, the CLI and reports.

const STATIC_EPS = 0.05;      // score units; below this the frame did not move
const MIN_HOP_W = 0.005;      // fraction of score width that counts as a visible cut
const MIN_HOP_H = 0.005;

function movement(path, i) {
  return { dx: path[i].focusX - path[i - 1].focusX, dy: path[i].focusY - path[i - 1].focusY };
}

function isStatic(path, i) {
  const { dx, dy } = movement(path, i);
  return Math.abs(dx) <= STATIC_EPS && Math.abs(dy) <= STATIC_EPS;
}

/** Shared thresholds so the CLI, validation and reports cannot drift apart. */
export function continuityThresholds(timeline) {
  const width = Number(timeline?.scoreWidth);
  const height = Number(timeline?.scoreHeight);
  return {
    staticEps: STATIC_EPS,
    hopX: Math.max(0.5, Number.isFinite(width) && width > 0 ? width * MIN_HOP_W : 4),
    hopY: Math.max(0.2, Number.isFinite(height) && height > 0 ? height * MIN_HOP_H : 2),
  };
}

/**
 * Report how a focus path actually moves.
 * - hops: isolated one-frame jumps that sit between two motionless frames.
 *   This is the exact signature of a per-attack camera, and it reads as a cut.
 * - shortRuns: movement finished within two frames while covering a visible
 *   distance. Not automatically fatal, but it cannot read as continuous motion.
 */
export function focusContinuityReport(timeline) {
  const path = timeline?.focusPath;
  const width = Number(timeline?.scoreWidth);
  if (!Array.isArray(path) || path.length < 2) {
    return { schema: 'aiyoupu-focus-continuity/v1', checked: false, reason: 'focusPath needs at least two frames' };
  }
  if (path.some(p => !p || !Number.isFinite(p.focusX) || !Number.isFinite(p.focusY))) {
    return { schema: 'aiyoupu-focus-continuity/v1', checked: false, reason: 'focusPath contains a non-finite sample' };
  }
  const { hopX, hopY } = continuityThresholds(timeline);
  const bounds=timeline.systemBounds;
  const rowChanges=new Set();
  let lastRow;
  for(const e of [...(timeline.events??[])].sort((a,b)=>a.frame-b.frame)){
    const row=e.systemId??bounds?.findIndex(b=>e.y>=b.top&&e.y<=b.bottom);
    if(row===undefined||row===-1)continue;
    if(lastRow!==undefined&&row!==lastRow)rowChanges.add(Math.ceil(e.frame));
    lastRow=row;
  }
  const declared=timeline.focusHandoffs;
  const validHandoff=h=>h&&Number.isInteger(h.frame)&&h.frame>0&&h.frame<path.length&&
    Number.isInteger(h.dipFrames)&&h.dipFrames>=0&&h.dipFrames<=5&&rowChanges.has(h.frame)&&
    Math.abs(movement(path,h.frame).dy)>hopY;
  const invalidHandoffs=declared!==undefined&&(!Array.isArray(declared)||
    declared.some(h=>!validHandoff(h))||new Set(declared.map(h=>h.frame)).size!==declared.length);
  const cuts=new Set(!invalidHandoffs?(declared??[]).map(h=>h.frame):[]);
  const sweeps=[];
  const speeds=[0,...path.slice(1).map((_,i)=>{
    const {dx,dy}=movement(path,i+1);return cuts.has(i+1)?0:cameraTravel(dx,dy,timeline);
  })];
  const speedLimit=cameraSpeedLimit(timeline.fps);
  for(let f=1;f<speeds.length;f++){
    if(speeds[f]<=speedLimit)continue;
    const start=f;
    let peak=speeds[f];
    while(f+1<speeds.length&&speeds[f+1]>speedLimit)peak=Math.max(peak,speeds[++f]);
    sweeps.push({start,end:f,peakPercentPerFrame:+(100*peak).toFixed(2)});
  }
  // Repeated troughs in same-direction, same-row motion are visible even
  // when every frame has a different position. Ignore isolated pauses.
  const troughs=[],fps=timeline.fps||30;
  for(let f=4;f<path.length-3;f++){
    const steps=Array.from({length:7},(_,i)=>movement(path,f+i-3));
    if(steps.some((d,i)=>cuts.has(f+i-3)||Math.abs(d.dy)>STATIC_EPS))continue;
    const dir=Math.sign(steps[0].dx);
    if(!dir||steps.some(d=>d.dx*dir<0))continue;
    const s=steps.map(d=>Math.abs(d.dx)),side=Math.min(Math.max(...s.slice(0,3)),Math.max(...s.slice(4)));
    if(s[3]>=s[2]||s[3]>s[4]||s[3]>.32*side||cameraTravel(side,0,timeline)<.0015*30/fps)continue;
    troughs.push(f);
  }
  const stopGo=[];
  for(let i=0;i<troughs.length;){
    let j=i;
    while(j+1<troughs.length&&troughs[j+1]-troughs[j]<=.7*fps)j++;
    if(j-i>=2)stopGo.push({start:troughs[i],end:troughs[j],count:j-i+1});
    i=j+1;
  }
  const hops = [];
  let staticFrames = 0;
  let maxStepX = 0;
  let maxStepY = 0;
  for (let i = 1; i < path.length; i++) {
    const { dx, dy } = movement(path, i);
    if(cuts.has(i)) continue;
    maxStepX = Math.max(maxStepX, Math.abs(dx));
    maxStepY = Math.max(maxStepY, Math.abs(dy));
    if (isStatic(path, i)) {
      staticFrames++;
      continue;
    }
    if (Math.abs(dx) <= hopX && Math.abs(dy) <= hopY) continue;
    const beforeStatic = i - 1 < 1 || isStatic(path, i - 1);
    const afterStatic = i + 1 >= path.length || isStatic(path, i + 1);
    if (beforeStatic && afterStatic) {
      hops.push({
        frame: i,
        dx: Number(dx.toFixed(3)),
        dy: Number(dy.toFixed(3)),
        percentWidth: Number.isFinite(width) && width > 0 ? Number((Math.abs(dx) / width * 100).toFixed(3)) : null,
      });
    }
  }
  const shortRuns = [];
  for (let i = 1; i < path.length;) {
    if (cuts.has(i)||isStatic(path, i)) { i++; continue; }
    let end = i;
    while (end + 1 < path.length && !cuts.has(end + 1) && !isStatic(path, end + 1)) end++;
    const span = end - i + 1;
    const travelX = Math.abs(path[end].focusX - path[i - 1].focusX);
    const travelY = Math.abs(path[end].focusY - path[i - 1].focusY);
    if (span <= 2 && (travelX > hopX || travelY > hopY)) {
      shortRuns.push({ start: i, end, span, travelX: Number(travelX.toFixed(3)), travelY: Number(travelY.toFixed(3)) });
    }
    i = end + 1;
  }
  const transitions = path.length - 1;
  return {
    schema: 'aiyoupu-focus-continuity/v1',
    checked: true,
    frames: path.length,
    staticFrames,
    staticRatio: Number((staticFrames / transitions).toFixed(4)),
    longestSingleFrameStep: { x: Number(maxStepX.toFixed(3)), y: Number(maxStepY.toFixed(3)) },
    thresholds: { hopX: Number(hopX.toFixed(3)), hopY: Number(hopY.toFixed(3)), staticEps: STATIC_EPS },
    hops,
    shortRuns,
    handoffs:[...cuts],
    invalidHandoffs:!!invalidHandoffs,
    sweeps,
    stopGo,
    status: invalidHandoffs ? 'invalid_handoffs' : hops.length ? 'discontinuous' : shortRuns.length ? 'abrupt' : sweeps.length||stopGo.length ? 'motion_review_required' : 'continuous',
  };
}

function failure(code, message, next) {
  return Object.assign(new Error(message), { code, next });
}

const NEXT_STEP = 'Regenerate the path with the camera-path command (or direction prepare), which interpolates every frame; never place one coordinate per attack.';

/**
 * Blocking form used before a real export can be bound.
 * Previews stay open on purpose: a stepped path is a defect to inspect and fix,
 * not a reason to lose access to already-prepared material.
 */
export function assertFocusContinuity(timeline, { strict = false } = {}) {
  const report = focusContinuityReport(timeline);
  if (!report.checked) return report;
  if(report.invalidHandoffs)throw failure('FOCUS_HANDOFF_INVALID','A declared row handoff does not match an attack and a row change','Rebuild the path with camera-path.');
  if (report.hops.length) {
    throw failure(
      'FOCUS_PATH_DISCONTINUOUS',
      'focusPath holds still for several frames and then jumps ' + report.hops.length + ' time(s); first at frame ' + report.hops[0].frame + ' by ' + report.hops[0].dx + ' units (' + report.hops[0].percentWidth + '% of the score width). That renders as a slideshow camera, not motion.',
      NEXT_STEP,
    );
  }
  if (strict && report.shortRuns.length) {
    throw failure(
      'FOCUS_PATH_ABRUPT',
      'focusPath covers a visible distance inside ' + report.shortRuns.length + ' move(s) of at most two frames; first from frame ' + report.shortRuns[0].start + '. No easing can be seen at that speed.',
      NEXT_STEP,
    );
  }
  if(strict&&(report.sweeps.length||report.stopGo.length)){
    const range=[...report.sweeps,...report.stopGo].sort((a,b)=>a.start-b.start)[0];
    throw failure('FOCUS_MOTION_REVIEW_REQUIRED',`Fast sweep or repeated braking at frames ${range.start}–${range.end}`,'Rebuild with camera-path and review a rendered clip across the affected frames.');
  }
  return report;
}

/**
 * Replace abrupt movement with real motion.
 *
 * Horizontal tracking follows the melody, so a gap between two measured
 * landings is eased across every frame in that gap: the picture keeps travelling
 * instead of holding still and cutting once per attack. Both endpoints stay
 * exact, so a landing is reached precisely and never smeared past its note.
 *
 * Vertical movement is a system change, which production limits to a 12..16
 * frame Smoothstep, so it is capped by windowFrames independently.
 *
 * Only gaps whose movement currently finishes in two frames or less are
 * touched, so repairing a path that already travels is a byte-identical no-op.
 * Gaps shorter than three frames have no room to ease and are reported as
 * residual rather than deforming an attack to look smooth.
 * Used by the explicit repair command only, never during validation.
 */
export function repairFocusContinuity(timeline, { windowFrames = 14, maxPasses = 8 } = {}) {
  const path = Array.isArray(timeline?.focusPath) ? timeline.focusPath : null;
  if (!path || path.length < 2) throw failure('FOCUS_PATH_REQUIRED', 'focusPath needs at least two frames', 'Prepare the score first.');
  const before = focusContinuityReport(timeline);
  if (!before.checked) throw failure('FOCUS_PATH_REQUIRED', before.reason, 'Prepare the score first.');
  if(before.handoffs.length||before.invalidHandoffs)
    throw failure('FOCUS_HANDOFF_REBUILD_REQUIRED','This path declares row handoffs','Regenerate it with camera-path rather than smoothing across a declared handoff.');
  const current = path.map(p => ({ focusX: p.focusX, focusY: p.focusY }));
  const yCap = Math.max(2, Math.round(windowFrames));
  let repaired = 0;

  const easeAxis = (axis, epsilon, cap) => {
    const moved = i => Math.abs(current[i][axis] - current[i - 1][axis]) > epsilon;
    for (let pass = 0; pass < maxPasses; pass++) {
      // Landings: the last frame of each contiguous movement run, plus frame 0.
      const landings = [0];
      for (let i = 1; i < current.length; i++) {
        if (!moved(i)) continue;
        let end = i;
        while (end + 1 < current.length && moved(end + 1)) end++;
        landings.push(end);
        i = end;
      }
      let changed = false;
      for (let n = 1; n < landings.length; n++) {
        const a = landings[n - 1];
        const b = landings[n];
        const gap = b - a;
        if (gap < 3) continue;
        const travel = Math.abs(current[b][axis] - current[a][axis]);
        if (travel <= epsilon) continue;
        // Already travelling across this gap: real motion, leave it alone.
        let moving = 0;
        for (let k = a + 1; k <= b; k++) if (moved(k)) moving++;
        if (moving > 2) continue;
        // Ease the leading edge of the gap; a capped axis rest over the rest.
        const span = cap ? Math.min(gap, cap) : gap;
        const start = b - span;
        const from = current[start][axis];
        const to = current[b][axis];
        if (Math.abs(to - from) <= epsilon) continue;
        for (let j = start + 1; j < b; j++) {
          const t = (j - start) / span;
          const s = t * t * (3 - 2 * t);
          current[j][axis] = Number((from + (to - from) * s).toFixed(4));
        }
        current[b][axis] = to;
        repaired++;
        changed = true;
      }
      if (!changed) break;
    }
  };

  // X travels across the whole gap; Y honours the 12..16 frame system rule.
  easeAxis("focusX", 0.05, 0);
  easeAxis("focusY", 0.05, yCap);

  const after = focusContinuityReport({ ...timeline, focusPath: current });
  return {
    timeline: { ...timeline, focusPath: current },
    repaired,
    before,
    after,
    residual: after.shortRuns.length,
    note: after.shortRuns.length
      ? 'Gaps of fewer than three frames have no room to ease; they are reported as residual instead of being smoothed over an attack.'
      : null,
  };
}

