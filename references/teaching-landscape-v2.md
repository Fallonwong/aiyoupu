# AI有谱 V2.1 候选：横屏平面教学

仅增加 `TeachingLandscape`；旧四组工厂、14 保留项、12 废弃项和历史默认值原样保留。
新增 API 位于 `ScoreVideoConfigV2.ts`、`resolveScoreVideoConfigV2.ts`、`AiyoupuScoreSceneV2.tsx`，旧文件继续供历史任务使用。
接入已有兼容项目使用 `node <skill>/scripts/aiyoupu.mjs install --project <existing-project>`；
新安装入口只补充缺失文件、拒绝覆盖不同内容，也不自动安装依赖。正式任务入口为 `song-v2.tsx`，组合 ID 仍为 `Aiyoupu-Song`。

```tsx
import {SCORE_PRESETS, PRESET_DISPLAY_NAMES} from './animations/score/ScoreVideoConfigV2';
import {resolveScoreVideoConfig} from './animations/score/resolveScoreVideoConfigV2';
// timeline.focusPath must contain the measured grand-staff midpoint as constant focusY.
const props = resolveScoreVideoConfig(SCORE_PRESETS.TeachingLandscape('曲名'), {
  timeline, scoreSrc:'score/revision/score.svg', audioSrc:'score/revision/master.wav', pipeline:'full-score',
});
```

固定选择：1920×1080、`landscape-classic`、`pure-white`、`black-multiply`、`full-score`、`clean`。
多行谱带有同次 SVG 测量的 `systemBounds` 时，初始缩放按完整谱表高度和上下留白计算（最高 2.4 倍），包括符干、加线和力度记号；垂直取景使用舞台内部坐标。用户显式调整的缩放照常生效，进一步放大会得到局部特写。
camera 保持 rotateX=0、rotateZ=0 的平面投影；缩放不是锁死值，默认单行谱为 scale=2.8、多行谱按实测行高适配（最高 scale=2.4），范围 0.5–5，方向台和 Agent 均可用显式 scale 覆盖。单行谱 focusX 插值跟随右手，focusY 是本版大谱表中点常数；多行谱保留逐帧实测的 focusX/focusY，按当前谱表行逐行阅读。行间在实测边界切换并保留标题，末帧继续显示最后一行。
解析出的 props 带 `visualPreset:'TeachingLandscape'`，只凭白底/横屏/clean 组合不会触发教学场景。
确认配置记录需写 `preset:'TeachingLandscape'`，`visual.camera` 保存完整相机值；旧运行入口拒绝绑定教学任务。
双手均使用合流跃动：pulseOnly=false、trailFrames=14、taperTrail=true、followChordNotes=true、highlightFrames=10、holdHighlightUntilNext=false；右手弧高 58、左手弧高 44。
整屏中性白，透明或中性白 SVG；无彩色纸矩形、无 SVG 标题头。标题只由 Scene 的标题块绘制。
不添加实验风格、人物、环境效果；旧版 `pure-white` 色值不变，新教学场景单独使用 #ffffff。

## 歌词与音符重叠

先保留原版，再使用同版 MusicXML 重新刻谱。优先 Verovio `lyricTopMinMargin`、`spacingStaff`、
`spacingSystem`，必要时调整歌词排版参数；`header:'none'`、`footer:'none'` 去除标题页眉。
不要手绘字、移动个别歌词、改变音符/速度或把歌词移到谱外。
重刻后所有音头坐标、focusPath 和 layout evidence 都必须从新 SVG 同次测量生成，不能沿用旧坐标。
可用 `python scripts/engrave-teaching-v2.py --musicxml <score.musicxml> --out <new-dir> --module-dir <existing-Verovio-module-dir>`，不下载/安装依赖。
单行大谱表默认沿用原有的 2.8 倍平面构图。多行谱不再要求重排成单行：教学场景读取同一份逐帧 `focusPath`，用当前演奏行的实测中点平滑跟谱，默认按实测行高适配，以保留标题与底栏安全区；缩放可在 0.5–5 范围调整并随方向保存。每帧的真实 Y 坐标不会压成常数。换行前后的同版裁切和实际画面仍需人工确认。
按每个起音的 ceil(frame) 检查歌词与音头、符干、低音符头/符干，记录对象 ID、框坐标、帧与交集。
几何框交集只作为保守检测；结合真实图像检查，不能把自动零交集说成用户验收通过。

## 音频与审批

用户录音优先；否则 `audio-plan → audio-render（MuseScore Basic）→ audio-master`，保留完整音源证据与尾音。
内置合成器仅校准草稿。导入现有 WAV 不等于生成证据，不得伪造已执行的导出链路。
试点不构成正式谱面。谱面审批和实际关键帧/试听审批均引用用户原话，Agent 自审不能批准。
正式导出仍须 `aiyoupu.mjs render --job ... --approval ... --confirmed`。

用户提供 MusicXML 的简化试点可用 `bind --draft --source-type musicxml --score-review <check/report.json>`：
结构报告、原 MusicXML、原生 SVG 和时间轴必须均已展示且被本版真实谱面审批哈希绑定。
这是试点审看路线，不设置已通过质量审核，不适用于 PDF/OMR；正式任务仍须原完整比较/质量证据。

教学预设审看片/正式导出复制画面流并用同一已审母带重新封装，避免原渲染 AAC 帧引入整体延迟。
保留原渲染文件与封装命令；不移动音乐起音、不改增益或音符包络。新音频传输检查保留 .95 阈值，
只将粗搜索候选细化到单采样并明确检查零偏移，防止4采样步长错过真实匹配点。

## 工作台导出

```sh
node <skill>/scripts/aiyoupu.mjs workbench-export --job <frozen-job.json> --approval <keyframe-approval.json> --layout <frozen-layout.json> --midi <reviewed.mid> --out <new-project.json>
```

仅导出已审批 timeline、同一 SVG 及成品音频的相对引用和 SHA-256，不嵌入应用、不复制工作台代码、不使用实时录制。
导出为原工作台可读取的 `project` 对象：内嵌同版 SVG，事件按秒展开，保留逐音符头 ID、手别和坐标。
外层 `aiyoupu-workbench-project/v2` 只保存本 Skill 的版本、来源和审批证据，不要求工作台实现此schema。
可选母带另存同目录 WAV，在原工作台“演奏实录音频 · 可选”中选择；原工作台工程JSON不自动加载本地音频引用。
已批准的旧试点可用 `--source-job ... --source-approval ... --source-receipt ... --layout ... --midi ...` 只读校验原交付、两道原始审批和文件哈希，再导出预览项目。
这不继承新V2关键帧批准，也不把试点变成正式谱面。原工作台的预设仅供试方向，返回本Skill仍须本版关键帧审批与Remotion离线渲染。
命令拒绝草稿、缺少审批、过期文件、校准音频和覆盖已有输出。
