# AI有谱 V2.1 使用指南

## 安装

先安装官方 Remotion Skill，再安装本 Skill；已有部分直接复用。

```sh
npx skills add remotion-dev/skills --skill remotion-best-practices
```

按提示安装官方 Remotion Skill。再从 [V2.1 预览版](https://github.com/Fallonwong/piano-remotion/releases/tag/v2.1.0-rc.1) 下载 `aiyoupu-2.1.0-rc.1.zip`，将 `aiyoupu/` 放入当前 Agent 的 Skill 目录，保留组件、脚本和 references。安装后开启新对话。仓库地址仍为 `Fallonwong/piano-remotion`，本次未改名。升级前保留旧 Skill、运行环境和历史任务，不覆盖旧任务文件。

## 发起制作

```text
使用 $aiyoupu，先读取官方 $remotion-best-practices。
素材：<实际文件路径>。工程：<已有 Remotion 工程路径，如有>。
请制作原版钢琴跟谱视频，保留双手跳跃、发光、高亮和运镜，个人装饰关闭。
先展示原谱与重排谱的逐小节对照、修订差异和疑点，等我确认。
然后展示真实关键帧、短试听和连音动态，再等我确认，之后导出 MP4。
有录音就保留原录音；没有录音先复用现有钢琴音源并试听。
优先复用环境，需要新增工具或音源时先说明方案。
```

不支持 `$名称` 的 Agent，可改成“依次读取官方 Remotion Skill 和本 Skill 的 SKILL.md，按其执行”。

## 准备素材

优先提供已校订 MusicXML：接受生成配乐时，从同份谱生成完整钢琴音频；保留原演奏时，配上同改编、同选段的 MP3。MIDI 需明确声部/左右手及小节归属，SVG 需匹配同次排版的时间轴与坐标。PDF/图片先复用已安装 OMR 并核对识谱结果；简谱先明确调号、八度和节奏。只有 MP3 时需补充乐谱或确认现有转谱工具，内置分析不负责完整复调转谱。

详见 [素材推荐顺序与提交清单](README.md#哪些素材更容易得到可靠结果)。推荐顺序依据当前处理环节，不代表已测得的成功率百分比。多份素材应属于同一版本，选段应说明原谱小节范围和反复顺序。

[不同输入的完成把握与实际链路](README.md#不同输入的完成把握与实际链路) 分别说明只有 MP3、MP3＋PDF/图片、MP3＋MusicXML、MP3＋MIDI 及无录音生成配乐的路径；实现依据与统计口径见 [输入分支说明](references/input-routes.md)。只有 MP3 且没有可用转谱/补谱途径时，当前内置链路不能独立生成完整准确乐谱。当前各类真实任务完成率均待统计，不将导入或预览成功当作内容与同步通过。

无需一次准备所有格式。Agent 先发现当前可用工具，按缺口补齐，Python 和全部 CLI 并非基础动画前提。

## 两次确认

先核对谱面，包括左右手、休止符、和弦、附点与连线。修订后查看具体小节的前后变化。然后核对真实关键帧、最终音频的试听与连音动态。镜头或混音变化更新审片；音乐数据变化更新谱面确认。

## 音频

所有预设的延音线、圆滑线、同音反复、部分延音和弦及休止动画遵循[起音与连线语义](references/music-motion-semantics.md)。延音线续音不重新跳动，圆滑线下的新音仍正常起音。

优先录音或现有采样音源。试听用于选择音色，全曲母版从完整批准谱面生成。整体增益、静音补偿和尾音处理另存记录，保留原件，避免盲裁余音。

## 脚本和数据

```sh
node <skill>/scripts/aiyoupu.mjs --help
```

[音源与谱面修订流程](references/workflow.md) · [几何、审阅和渲染](references/rendering.md) · [数据契约](references/data-contract.md) · [更多提示词](examples/agent-prompts.md)

原视觉数值保留；入口和应用协议已改名，旧任务不能直接加载。新的有声歌曲使用带音频来源记录的 checked job，PDF/图片审阅包含 notation-audit，预览和导出共用同版素材。许可仍未指定，历史通知见 history/v130/LICENSE.txt。


## V1.1.0 更新

本版新增横竖屏预设、主题、动态焦点与前四小节先导，以及独立的谱面事件和演奏时间映射。旧组件未设置 aspectRatio 时保留原效果；旧任务进行新的正式导出时，需补齐本版配置、时间映射和质量证据，重新绑定。详见 [制作配置](references/production.md)。

新视频先确认画幅、背景、双手色彩、交付节奏和IP，再进入谱面确认、实际关键帧与试听确认。详见 [制作配置](references/production.md)。

新正式 bind 需要 --production；有声正式作品还需要 v2 演奏映射和 --quality。音频 FFT/DTW 分析是候选辅助，不能自动证明错音、不同改编或逐音准确；缺少人工参考时保持 needs_review。详见 [内容与同步证据](references/performance-quality.md)。现有 Python + NumPy 可运行候选分析，不自动安装模型或依赖。历史任务可检查，新正式导出需按当前证据重新绑定。

PDF/图片与 XML 同时存在时先用 source-scope 核对范围；全谱小节数不一致会阻断，选段需给出源小节映射。quality-request 可从候选分析创建原谱＋原音频＋逐音复核页，初始所有项均为未审，不能作为批准。短窗口起音与分段映射用于改善时间候选；密集和弦、八度及不同改编的自动判定仍未校准，见 [能力状态](references/upgrade-status.md)。

## V2.0 更新（历史）

四组预设、无人物默认、14帧合流及纯脉冲，使用[视觉配置](references/visual-presets.md)；纵深跑道使用[连续谱带工具](references/score-strip.md)，从真实坐标与裁切边界生成。保留原有乐谱与关键帧/试听两阶段确认。

## 横屏教学预设 TeachingLandscape

16:9 大平面教学：全屏中性白纸、14 帧合流跃动（右手弧高 58、左手 44）；单行谱默认 2.8 倍平面构图，多行谱按当前实测谱表行逐行阅读并按实测行高适配初始缩放，在行边界切换并保留标题和末行，缩放可在 0.5–5 调整。选法：`resolveScoreVideoConfig(SCORE_PRESETS.TeachingLandscape('曲名'), {...})`，详见 [教学预设说明](references/teaching-landscape-v2.md)。

```text
使用 $aiyoupu 的 TeachingLandscape 教学预设，16:9，横屏大平面。
素材：<score.musicxml>。先展示谱面确认，再出前四小节关键帧，等我确认后渲染。
```

## Agent 全流程与方向台（V2.1）

制作流程以 Agent CLI 为全流程入口。工作台是可选的一页视觉定方向工具；它不负责导入、准备、识谱、任务管理、审批、关键帧或成片。以下是可直接运行的命令：

```sh
# 已准备的同版 SVG + timeline，或直接给 MusicXML / MIDI
node <skill>/scripts/aiyoupu.mjs direction prepare --musicxml <score.musicxml> --audio <同改编录音.mp3> --title "曲名" --out <preview-dir>
node <skill>/scripts/aiyoupu.mjs direction inspect --preview <preview-dir>/preview.json
node <skill>/scripts/aiyoupu.mjs direction validate --preview <preview-dir>/preview.json --direction <direction.json> --json
node <skill>/scripts/aiyoupu.mjs direction save --preview <preview-dir>/preview.json --direction <direction.json> --id D-<name>
node <skill>/scripts/aiyoupu.mjs direction derive --preview <preview-dir>/preview.json --direction <preview-dir>/directions/D-<name>.json --project <Remotion工程> --out <job-dir>
node <skill>/scripts/aiyoupu.mjs direction still --job <job-dir>/job.json --project <Remotion工程> --frame 0 --out <still.png>
```

谱面或关键帧需要人工确认时，Agent 用对话展示实际内容并引用真实用户回复，这是默认路线。独立确认页是可选的兼容入口，不复用方向台；只有请求中的内容能完整展示时才使用：

```sh
node <skill>/scripts/aiyoupu.mjs workbench review --request <review/request.json> --port 7802
```

`direction validate` 与工作台读取同一份方向引擎，`--json` 输出的 `propsSha256` 可用于 Agent/工作台一致性验收。`direction still` 复用现有 Remotion 环境；如果依赖、SVG、焦点路径或真实音频缺失，会明确阻断。方向记录 `aiyoupu-direction/v3` 绑定预览文件哈希、谱面哈希、timeline 哈希、方向参数哈希和 props 哈希；它不是谱面或关键帧批准。把已保存方向接回 Agent 时，可只传方向文件，让 `derive` 读取其中记录的 preview：`direction derive --direction <saved-direction.json> --project <Remotion工程> --out <job-dir>`；同时传 `--preview` 时两份路径必须一致。它生成的是画面方向草稿；正式制作使用同一 `props.json`、`production.json` 与冻结资产继续 `aiyoupu bind --asset-project <job-dir> ... --quality <packet>`。不能把 `direction_draft` 改成正式任务，也不能用静音或草稿绕过正式质量门。

可选工作台只打开指定的单曲预览包：

```sh
node <skill>/scripts/aiyoupu.mjs workbench open --preview <preview-dir>/preview.json --port 7801
```

首屏就是画布、播放控制、预设、常用参数、折叠的高级参数和“保存方向并复制”。工作台不扫描素材目录，不上传文件，不重新排版。`--task`/`--approval` 只为旧命令兼容保留，不会出现在界面。中文文件名经服务端安全解析；缺音频会显示静音状态，不会触发重新准备。

保存后回 Agent 发送方向台上的短提示词（仅含方向 ID 与文件路径）；Agent 用 `direction derive` 生成冻结 job/props。派生 job 会记录首四小节、实际运行时入口及其源码指纹；没有匹配的真实谱面审批时停在 Gate 1，不自动造审批。接入既有审批后才进入 `keyframes` 与人工关键帧确认。新方向不复用旧审批，正式导出仍要求两侧真实人工确认。

PDF/图片还需要先用已安装 OMR 或 Agent 的识谱能力产出、校对 MusicXML；工作台和 `direction prepare` 都不会伪造识谱。MIDI 经已安装 MuseScore 4 转成 MusicXML 后才能测坐标。

本页版本是 **V2.1 预览版（v2.1.0-rc.1）**。工程目录的基线依赖版本与历史发布记录分别保留；内部生成的工作台预览工程协议仍标为 v2，与发布版本独立。当前曲目的完整正式制作与成片尚未完成实际验收。

## 公开找谱

公开来源查找顺序 IMSLP → Mutopia → PDMX → GitHub → MuseScore → 商业库；每个候选（含失败）记录进 sources.json，版本不匹配即停。详见 [公开找谱分支](references/public-score-sources-v2.md) 与 [示例](examples/sources-v2.json)。
