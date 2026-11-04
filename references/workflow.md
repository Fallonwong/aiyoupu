# 音源生产与谱面修订流程

V1.0.0 保持原 ScoreNoteLeap/AiyoupuScoreScene 动效和两次内容确认。新增脚本不依赖 Python 音频库，不自动下载音源；这里的路径均为占位符。

## 音源选择与完整音频

```sh
node <skill>/scripts/aiyoupu-legacy.mjs audio-plan
node <skill>/scripts/aiyoupu-legacy.mjs audio-plan --musescore <MuseScore4.exe> --soundfont <MS-Basic.sf3> --authorized-project <explicit-root>
```

优先用户录音，其次现有音源。检测当前系统常见 MuseScore 4 路径、PATH 和显式授权目录的 sound/SoundFonts 子目录；候选不等于已完成试听。已安装软件或音色不在 PATH 时不得直接要求重装。非 Windows 可显式提供程序和音色；本轮仅验证 Windows。

没有候选时报告缺口、可信下载来源、版本、大小、使用/再分发条款及安装位置，再等待用户授权。音色文件不随 Skill 分发。不要因为缺采样音源，自写振荡器并称作正式钢琴配乐。

谱面确认的 audioChoice=synthesize 表示同意生成音频，不代表用户已经批准未知音色。优先复用实际音源。以下入口采用 MuseScore Basic profile，只支持该程序自己的 bundled MS Basic；不能传另一份 SoundFont 就声称已加载它。实际乐器分配还需检查与试听。其他音源/引擎走经过验证的适配器并保留日志，当前脚本尚未实现通用 FluidSynth/任意 SoundFont 渲染。

```sh
node <skill>/scripts/aiyoupu-legacy.mjs audio-render --musicxml <full-approved.musicxml> --timeline <compiled.json> --score-approval <score-approval.json> --musescore <MuseScore4.exe> --soundfont <bundled-MS-Basic.sf3> --out <new-full-raw.wav>
```

必须从完整已批准 MusicXML 导出；脚本检查它和 timeline.sourceMusicxmlSha256 一致，截取的小节试听不能替换全曲。输出 WAV、实际 command 日志和 .audio.json 来源记录，状态为未校准。导出记录绑定原谱、程序、音色文件及日志；它不是音色好听或钢琴乐器设置正确的证明。

需要补前导静音、整体增益或处理近静音尾巴时：

```sh
node <skill>/scripts/aiyoupu-legacy.mjs audio-master --evidence <full-raw.wav.audio.json> --timeline <compiled.json> --out <new-master.wav> --lead-seconds 0.1666667 --gain-db 3 --duration-seconds <actual-composition-seconds>
```

只做显式整体处理，输出新文件；不重写 note envelope。尾部裁切要通过近静音 RMS/peak 检查；可听尾音阻止裁切，应保留尾巴或重新规划 composition。不会按固定秒数盲裁混响。整段增益在任务允许的混音范围内一次决定，纳入最终试听，无须逐数值微审批。保留动态、避免削波。

用户已有录音：

```sh
node <skill>/scripts/aiyoupu-legacy.mjs audio-recording --audio <provided.mp3> --timeline <compiled.json> --out <recording-evidence.json>
```

这是用户提供录音的声明和字节绑定，不是自动来源鉴真；不得把 Agent 自写波形登记成用户录音。绑定前仍须全曲时长、声音和同步检查。外部专业音源路径未接入时说明适配缺口，不伪造 receipt。

新 checked bind 增加 `--audio-evidence <master.wav.audio.json 或 recording-evidence.json>`；之后的 job 把来源、音源及混音日志固定下来：

```sh
node <skill>/scripts/aiyoupu-legacy.mjs quality --timeline <mapped-timeline.json> --audio <master.wav> --quality <review-packet.json> --source <original-source> --out <quality-result.json>
node <skill>/scripts/aiyoupu-legacy.mjs bind --project <project> --props <actual-song-props.json> --layout <layout.json> --production <production.json> --quality <review-packet.json> --score-approval <score-approval.json> --audio-evidence <master.wav.audio.json> --out <job.json>
```

PDF/图片等还须提供 [谱面审阅与渲染](rendering.md) 中的 source-type、score-review、browser 参数。录音源与生成音频选择应对应，不能更名绕过来源记录。源文件复制到 public 后只要字节一致可以验证；绝对路径记录是本地证据，迁移需重新绑定。

内置 synthesize 只用于校谱草稿，现在显式要求 `--preview-only`，会生成 calibration-preview 来源记录；完整作品 bind 拒绝它，仅 `--draft` 可使用。保留兼容的底层 API，但不得通过直接调用绕过正式音源策略。

## 同步检查不能决定音色

能量阈值没找到起音，返回 needs_review；不等于漏音。密集十六分、和弦、连奏、踏板音应保留原时值/包络，用针对性波形/频谱证据和听感复核。严禁为了通过自动阈值改短衰减、截断延音或改谱。旧 align 仅供诊断，不能授权新正式输出。当前使用 [分段映射与内容证据](performance-quality.md) 的人工复核门禁；FFT/DTW/起音编辑路径仍只是候选，不伪造 sampled_onsets_passed 或自动准确结论。

先出 10–15 秒代表性试听可按需进行；默认两次内容确认仍是谱面及关键帧/试听。音源选择不满意时可提前试听，不强制每个用户增加固定第三道审批。第二次确认必须包含最终 master 产生的试听和音源/混音说明；音源、主音频或混音改变都要重新绑定并重新确认关键帧/试听。短试听不能冒充全曲母版。

## 识谱：优先提高可核对性

优先用户已有可靠 MusicXML/MIDI，避免重复识别。PDF/五线谱图片优先已安装专业 OMR；MuseScore/VexFlow 只是排谱工具。没有专业 OMR 时，说明采用 Agent 辅助识读、能力边界及疑点。简谱先确认调号、八度标记、节拍/下划线、左右手/单旋律范围，不能硬套西洋五线谱 OMR。

先评估原件：缺页、歪斜、模糊、裁切、谱线/符干/附点分辨率和跨系统连线。不对原件做破坏性预处理，保留页码和坐标。复杂长谱先选 3–5 个代表性小节进行识读/排谱小样，再决定是否扩大。可以复用第二种现有工具交叉读取高风险段；两个结果一致仍不是人工正确基准。

每轮识别保存可编辑 MusicXML。用同一次排版的 SVG/坐标，生成原件与重排谱逐小节裁切。结构通过不能代替原谱核对；平衡拍数也不能证明音高/节奏正确。

```sh
node <skill>/scripts/aiyoupu-legacy.mjs notation-audit --source <original.pdf> --check <compare-dir/check.json> --out <new-audit-dir>
node <skill>/scripts/aiyoupu-legacy.mjs notation-audit --source <original.pdf> --check <new-compare/check.json> --previous <previous-compare/check.json> --expected-measures P1:3,P1:4 --observations <observations.json> --out <new-revision-audit-dir>
```

新 PDF/图片 CLI score-request 要求 `--notation-audit <audit/report.json>`。请使用 compare 输出里的 check.json，确保审阅所见与审计字节相同，不混用带 CLI 元信息的其他报告。报告包含：

- 逐小节前后差异：音高、时值、休止符、声部/谱表、和弦、附点、符杠、连线及调号/拍号/速度上下文；保留删除的小节。
- 密集节奏、连音、和弦、多声部、休止符的代表性检查优先级。
- 结构疑点和新增的显示变音记号/实际音高冲突、声部空档提示。它们只提示复核，不自动补休止符或修改音高。
- 明确列出超出用户指定小节范围的连带变化；相机或坐标改变不应触发整首重新识谱。

observations.json 格式：

```json
{"items":[{"measureId":"P1:3","eventIndex":2,"description":"附点与符杠不清楚","disposition":"uncertain","evidenceFile":"<actual-crop.png>","evidenceSha256":"<actual-hash>"},{"measureId":"P1:4","eventIndex":1,"description":"根据用户指出的位置修正八度","disposition":"corrected","reason":"<实际修正依据>","evidenceFile":"<actual-crop.png>","evidenceSha256":"<actual-hash>"}]}
```

逐项保留未确定/已修正，不批量改成 approved。审计 HTML 和裁切一同加入第一道用户审阅；所有小节仍须可查看。用户要求修某处不代表认可其他音符；修改后重新核对相关上下文并列出变化。未解决错误不能宣布准确；普通数据文件无法认证人类身份，仍须真实用户消息。

识谱工具按当前环境接入，结果需要对照原谱确认。要评价准确率，需要人工校订的标准谱及音高/时值/声部/连线分别统计；请勿以“结构检查通过率”或单次成片成功替代。
