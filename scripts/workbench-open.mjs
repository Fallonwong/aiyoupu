import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {failure} from './audio.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scripts, '..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

/** Kept for frozen-task compatibility. The direction console does not expose
 * approvals; this helper only lets the legacy open command name one file. */
export function findApproval(jobFile) {
  const dirs = [path.dirname(jobFile), path.join(path.dirname(jobFile), 'review'), path.join(path.dirname(path.dirname(jobFile)), 'review')];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!/approval.*\.json$/i.test(name)) continue;
      try {const a = readJson(path.join(d, name));if (a.schema === 'aiyoupu-user-approval/v1' && a.stage === 'keyframes') return path.join(d, name);} catch {}
    }
  }
  return null;
}

/** Launch the one-song direction console. --task/--approval remain accepted for
 * callers that still pass them, but the UI never shows tasks or approvals. */
export async function launch({preview = null, taskFile = null, approvalFile = null, sampleProject = null, port = 7801}) {
  const previewFile = preview ? path.resolve(preview) : null;
  if (!previewFile) throw failure('PREVIEW_REQUIRED', '指定一首已准备好预览', '先运行 aiyoupu direction prepare，再用 --preview <preview.json> 打开方向台。');
  if (!fs.existsSync(previewFile)) throw failure('PREVIEW_MISSING', previewFile, 'Pass the preview.json produced by aiyoupu direction prepare.');
  const launchDir = path.join(skillRoot, 'workbench', 'launch');
  fs.mkdirSync(launchDir, {recursive: true});
  // A per-launch parameter file prevents two concurrent opens from sharing a
  // stale port or overwriting each other's preview.
  const argsFile = path.join(launchDir, `launch-${Date.now()}-${randomUUID().slice(0, 8)}.json`);
  const readyFile = argsFile.replace(/\.json$/, '.ready.json');
  const errorFile = argsFile.replace(/\.json$/, '.error.json');
  fs.writeFileSync(argsFile, JSON.stringify({preview: previewFile, taskFile, approvalFile, sampleProject, port, readyFile, errorFile}, null, 2) + '\n', {flag: 'wx'});
  const child = spawn(process.execPath, [path.join(scripts, 'workbench-launch-child.mjs'), argsFile], {detached: true, stdio: 'ignore', windowsHide: true});
  child.unref();
  // The parent reports success only after the child has bound the port and
  // written the exact HTTP readiness probe, not merely after spawn().
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyFile)) {
      const ready = readJson(readyFile);
      try {
        const response = await fetch(ready.url + 'api/state', {signal: AbortSignal.timeout(2000)});
        if (response.ok) { try { fs.unlinkSync(argsFile); } catch {} try { fs.unlinkSync(readyFile); } catch {} return {status: 'workbench_started', ...ready, preview: previewFile, scope: 'AI有谱 单曲方向台：本页只调整视觉方向'}; }
      } catch { /* bounded readiness retry */ }
    }
    if (fs.existsSync(errorFile)) {
      const error = readJson(errorFile);
      throw failure(error.code ?? 'WORKBENCH_START_FAILED', String(error.message ?? errorFile), error.next ?? 'Inspect the launch record and retry.');
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw failure('WORKBENCH_START_TIMEOUT', `No HTTP response on port ${port}`, 'Inspect the launch record; port conflicts must be resolved before reporting a started console.');
}
