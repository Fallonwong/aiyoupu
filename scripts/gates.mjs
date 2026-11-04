import fs from 'node:fs';
import path from 'node:path';
import {sha256} from './audio.mjs';
import {loadJob} from './aiyoupu.mjs';
import {musicIdentity} from './music.mjs';
import {requireApproval} from './review.mjs';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

/**
 * Standard two-gate state machine.
 * Every answer names the exact command, what must be shown, and what to ask.
 * Nothing here creates an approval; it only reports which gate is open.
 */
export function nextGate({jobFile, approvalFile}) {
  const job = loadJob(jobFile);
  const jobSha = sha256(fs.readFileSync(jobFile));
  const props = read(job.propsFile);
  const musicSha = musicIdentity(props.timeline);

  const base = {
    schema: 'aiyoupu-gate-status/v1',
    jobFile: path.resolve(jobFile),
    jobSha256: jobSha,
    draft: !!job.draft,
    timeline: {fps: props.timeline.fps, durationInFrames: props.timeline.durationInFrames, notes: props.timeline.events.reduce((n, e) => n + (e.notes?.length ?? 0), 0)},
  };

  const openScore = () => {
    const ok = (() => { try { requireApproval(job.scoreApproval, 'score', {musicSha256: musicSha}); return true; } catch { return false; } })();
    return ok;
  };

  if (!openScore()) {
    return {
      ...base, stage: 'score', status: 'WAITING_FOR_SCORE_APPROVAL', gate: 1,
      next: 'aiyoupu score-request --source-type <type> --source <original> --timeline <timeline.json> --out <review-dir>',
      then: 'aiyoupu approve --request <review-dir>/request.json --response <user-response.json> --out <score-approval.json>',
      showBeforeAsking: ['原谱与重排谱的逐小节对照', '本版修订差异', '仍不确定的小节与原因', 'requestId 与 bundleSha256'],
      askUser: '请确认这版谱面是否可用于后续制作；如不可用，请指出具体小节。',
      mustNot: ['Agent 自批', '把未展示的版本声明为已确认', '在用户未回复时继续出关键帧'],
      afterApprove: '继续音频准备与关键帧；正式导出仍需第二道审批。',
    };
  }

  const scoreApproval = (() => { try { return requireApproval(job.scoreApproval, 'score', {musicSha256: musicSha}); } catch { return null; } })();

  let keyframeOk = false;
  let keyframeReason = null;
  if (approvalFile && fs.existsSync(approvalFile)) {
    try { requireApproval(approvalFile, 'keyframes', {jobSha256: jobSha}); keyframeOk = true; }
    catch (error) { keyframeReason = {code: error.code ?? null, message: error.message, next: error.next ?? null}; }
  }

  if (!keyframeOk) {
    return {
      ...base, stage: 'keyframes', status: 'WAITING_FOR_KEYFRAME_APPROVAL', gate: 2,
      scoreApproval: scoreApproval?.approval ?? job.scoreApproval,
      stale: keyframeReason,
      next: 'aiyoupu keyframes --job <frozen-job.json> --out <new-keyframe-dir> --browser <edge-or-chrome>',
      then: 'aiyoupu approve --request <keyframe-dir>/review/request.json --response <user-response.json> --out <keyframe-approval.json>',
      showBeforeAsking: ['真实渲染的关键帧图（首四小节 + 全曲风险位置）', '短试听与连音片段', '音频来源/音源/混音设置', '双手声部、和弦、换行与相机路径'],
      askUser: '请确认画面与声音是否可用于正式导出；如不可用，请指出具体帧或问题。',
      mustNot: ['用静帧证明没有重复起音', '用 10–15 秒片段替代全曲母带试听', '改动谱面后复用旧的关键帧审批'],
      afterApprove: '用同一冻结 job 执行 render --approval ... --confirmed；不得改动 props 或输入。',
    };
  }

  return {
    ...base, stage: 'ready', status: 'READY_FOR_RENDER', gate: 3,
    scoreApproval: scoreApproval?.approval ?? job.scoreApproval,
    keyframeApproval: path.resolve(approvalFile),
    next: 'aiyoupu render --job <frozen-job.json> --approval <keyframe-approval.json> --out <new.mp4> --confirmed',
    then: 'aiyoupu verify --job <frozen-job.json> --video <new.mp4>',
    showBeforeAsking: ['成片路径与时长/分辨率/帧率', '音轨存在性与可听性', '采样起音的对齐结果'],
    askUser: '请确认是否作为最终交付。',
    mustNot: ['用 --confirmed 绕过审批', '为通过检测器而截短衰减或改音符'],
    notes: '两道审批均已记录；导出仍须保持同一 job、同一 props、同一音频。',
  };
}
