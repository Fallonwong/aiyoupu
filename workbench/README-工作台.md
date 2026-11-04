# AI有谱 · 单曲方向台

方向台只做一件事：浏览 Agent 已经准备好的单曲预览，选择视觉预设与参数，保存方向。准备、识谱、音频、任务、关键帧、审批和成片全部在 Agent 对话与 Skill CLI 中完成。

## 启动

```sh
node <skill>/scripts/aiyoupu.mjs workbench open --preview <preview-dir>/preview.json --port 7801
```

启动前，Agent 已用以下任一入口生成预览包：

```sh
# MusicXML：已安装 Verovio + Chromium
node <skill>/scripts/aiyoupu.mjs direction prepare --musicxml <score.musicxml> --out <preview-dir>

# MIDI：先经已安装的 MuseScore 4 转 MusicXML
node <skill>/scripts/aiyoupu.mjs direction prepare --midi <score.mid> --out <preview-dir>

# 已有同版 SVG + timeline
node <skill>/scripts/aiyoupu.mjs direction prepare --score <score.svg> --timeline <timeline.json> --out <preview-dir>
```

服务只读取这个预览包，不扫描素材目录。预览包中的 `preview.json` 记录源谱、音频、timeline 与文件的 SHA-256。缺谱、缺音轨、文件损坏或焦点路径不完整会在页面明确报错；可选音频不会触发重新排版。

## 页面边界

首屏包含：真实 `AiyoupuScoreSceneV2` 画布、播放/暂停/进度、四个可用 Skill 预设、常用画幅/运镜/字号、折叠的高级参数，以及“保存方向并复制”。深海纵深跑道入口保持隐藏；既有跑道预设只为历史任务保留。

方向台只播放预览包中由 Agent 提供的同版音频，不会自行生成音乐。没有音轨时，播放按钮按时间轴运行画面与音符动效，并明确标记“静音预览”；若提供音轨，调整预设或参数会保留当前帧和播放/暂停状态。跑道预设不出现在工作台；其历史实现仍保留给旧任务，不计入当前四预设选择范围。

页面不包含：上传、新建任务、素材列表、开始准备、识谱校对、步骤带、审批卡、关键帧或正式出片入口。

修改参数保留当前帧和音频播放状态；音频状态每 250ms 检查一次，不在动画帧循环里查询 DOM。

## 数据与回流

保存后写入 `<preview-root>/directions/D-<id>.json`：

- 版本化方向参数；
- 预览文件、源谱、音频、timeline 与图像哈希；
- 共享方向引擎算出的 `propsSha256`；
- `keyframeApproval: REQUIRED_FOR_NEW_JOB`，明确保存方向不是审批。

页面给出的短提示词只携带方向 ID 与方向文件路径。回到 Agent 后：

```sh
node <skill>/scripts/aiyoupu.mjs direction derive --direction <方向文件> --project <Remotion工程> --out <job-dir>
node <skill>/scripts/aiyoupu.mjs direction still --job <job-dir>/job.json --project <Remotion工程> --frame 0 --out <still.png>
```

再由 Agent 用 Keyframes 流程生成关键帧、短试听和审片，等待用户实际确认。

派生 job 记录首四小节、运行时入口和源码指纹，并继续把媒体写入 job 自己的 `public` 树。若谱面尚未通过真实用户审批，流程停在 Gate 1；它始终是画面方向草稿。正式制作使用 `aiyoupu bind --asset-project <job-dir> --props <job-dir>/props.json --production <job-dir>/production.json ... --quality <packet>` 接入现有谱面审阅与 v2 质量门，再进入关键帧阶段。不得把草稿状态改成 bound，或用草稿/静音绕过正式质量证据。

谱面与关键帧的正式内容门由 Agent 组织并引用用户真实回复。独立辅助页是可选兼容入口，不是默认必经步骤：`aiyoupu workbench review --request <review/request.json> --port 7802` 仅在请求内容全部可展示时可用；谱面阶段还会要求用户选择音频方式。方向台不记录审批。

## 验证

```sh
node scripts/direction.test.mjs
node workbench/verify-direction.mjs http://127.0.0.1:7801/ <临时结果.json>
```

`direction.test.mjs` 在 9:16 和 16:9 两种方向下比较 Agent 与工作台 HTTP 路径的 props/哈希，检查短提示词与审批边界；浏览器脚本检查首屏无旧控件、播放与音频推进、改参数保留状态、保存与资源请求。验收结果文件是临时测试产物，不纳入交付。
