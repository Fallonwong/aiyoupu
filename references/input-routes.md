# 输入分支、实现依据与完成结果

本页对应 [README 的素材建议](../README.md#准备什么素材)。依据当前脚本能力选择路径；不为未测的真实任务编造成功率，不把流程计划描述成已自动完成。

## 推荐与成功率的含义

- **想保留原录音，最推荐 MP3＋已校订 MusicXML**：已有音符数据，可跳过重新识谱，再核对录音时间。
- **不需要保留原录音，最推荐已校订 MusicXML**：从同份谱面生成钢琴配乐，再核对声音和同步。
- **PDF/图片可以做，先识谱并核对音符**：需要当前有可用识谱工具；识谱完成后再对齐原音频或生成配乐。
- **MIDI 可以做，先确认左右手、声部及录音对应关系**：明确归属后再排谱和同步。
- **只有 MP3，建议先补对应乐谱**：没有可用转谱能力时，内置链路不能独立恢复完整双手乐谱。
- **谱面和录音不是同一版本，先解决版本差异**：明确采用哪些小节、如何重复，再继续制作。

推荐程度是基于缺失环节和内容来源的判断，不是统计概率。当前各输入类别的真实全流程成功率均为 not_measured。受控合成信号的起音误差、工程回归通过数、导入通过率均不能换算为“MP3 制作成功率”。

## A. 只有 MP3

1. 保留原录音；通过 FFmpeg/FFprobe 检查解码、长度、音频流及可听性。
2. 查找当前已授权可用的外部音频转谱能力，或补充对应 MusicXML/MIDI/谱面。Skill 不自带完整复调转谱模型。
3. 外部得到的 MusicXML/MIDI 先核对旋律、和弦、节奏、声部和段落，再转换为符号事件、创建排版与坐标。没有原谱时不能宣称已经完成原谱对照。
4. 用原音频和符号事件产生时间候选，建立经核对的映射，进入共同验证/渲染流程。

内置 `audio-analysis.py` 的 `align()` 需要 symbolic events，CLI `analyze-audio` 要求 `--events`，不承担第 2 步。`prepare()` 只收到音频且没有 SVG/timeline 时返回 incomplete/能力交接，不自动转谱。无可用补全能力时说明缺口，保留准备状态；不填模板音符或自行补左手。

## B. MP3 + PDF/五线谱图片

1. 检查页序、完整性、调号/拍号及符号可读性；`score source` 可准备原件与调用受支持的现有 OMR 适配器。
2. 识谱输出可编辑 MusicXML。OMR 是环境能力，不是内置保证；没有可用引擎时返回待补能力，而不是假定已经识谱成功。
3. `score check` 检查 XML 结构，`source-scope` 核对原谱范围；`notation-audit` 和原件/重排谱对照保留改动及疑点。全谱与选段需明确区分。
4. `symbolic` 保存音高、休止、声部与连线，反复显式展开为播放出现次数；通过现有排谱能力产生 SVG，再测量实际音符坐标。
5. 接 C 的原录音对齐步骤。识谱是否正确与演奏时间是否正确分别核对，不能以 BPM 相同或 XML 拍数平衡代替。

## C. MP3 + 已校订 MusicXML

1. `score check` → `symbolic`。保留源文件身份和显式播放顺序。另附原 PDF 时执行原件范围与逐小节对照，不重新对已确认 XML 做无必要识谱。
2. 复用现有排谱工具/Agent 能力生成 SVG 和音符 ID 映射；`geometry` 测量同次排版的实际坐标。排谱与 ID 对应需要真实产物，`prepare` 不是自动排谱器。
3. `audio-recording` 记录原音频来源；`analyze-audio` 使用已指定的 Python/NumPy 与 FFmpeg，给出频谱、粗 DTW 和短窗口起音编辑路径候选。候选不是观测真值，不自动判定不同改编。
4. `quality-request` 可先建立未批准的候选复核页。核对实际音高、段落与起音，明确真实锚点；反复使用 occurrence 标识，不强制每个书写小节只播放一次。
5. `map-time` 根据严格单调的手工/观测锚点映射符号起止。未测中间点是插值；没有独立测得的踏板/释放时间。
6. 进入共同验证/渲染流程。遇到原谱与录音差异，先解决改编/选段对应，不用时间拉伸掩盖错音或错段落。

## D. MP3 + MIDI

`parseMidi()` 读取 SMF 音符与 tempo map；`symbolic --midi --assignment` 要求明确 track/channel 对应 part/voice/staff、每个音符的小节归属。MIDI 的音高拼写是显示约定，不是原谱等音拼写的恢复。

建立实际记谱/排版后，按 C 的录音对齐流程处理。来自同次演奏的 MIDI 可以提供可核对的时间参考，但当前脚本不会自动认证它与 MP3 同源，也不会把 MIDI 的 tick/seconds 直接当另一份录音的最终时间映射。不存在通用音高分界自动判定左右手的保证。

## E. 已校订 MusicXML，没有录音，接受生成配乐

XML 检查、谱面确认与符号事件 → 同份谱排版 → `audio-plan` 检查现有音源 → `audio-render` 通过已验证 MuseScore Basic/MS Basic 导出完整音频 → 按需 `audio-master` 记录增益、前导静音和尾音处理 → 实际音频与谱面时间核对/映射 → 共同流程。

这一分支减少了匹配外部改编录音的不确定性。`renderScoreAudio()` 仍返回 FULL_SCORE_AUDIO_EXPORTED_UNALIGNED，不能把同源导出当成自动完成同步或试听。内置简易波形 `synthesize --preview-only` 不替代正式采样音源。

## F. PDF/图片，没有录音，接受生成配乐

先完成 B 的原谱准备、识谱和对照，再接 E。避免了匹配另一份录音的差异，但原件识别、和弦成员、连线、重复等仍需要确认。若原谱只有旋律，不自动编写左手伴奏。

## G. 已有 SVG、时间轴及源谱/音频

复用已有排版。`prepare` 校验/导入结构，`geometry`/`validateLayout` 核对实际坐标，检查符号身份、音频身份、v2 演奏映射和质量证据。旧固定 BPM 时间轴不因标记 verified 而成为已验证同步结果；新正式导出需满足当前绑定要求。

## 共同流程及实现位置

| 环节 | 当前实现依据 | 边界 |
|---|---|---|
| 素材接收/缺口交接 | `scripts/prepare.mjs` → `prepare()` | 结构传输层，不内置 OMR、完整音频转谱或自动坐标生成。 |
| XML 检查/原件准备/对照 | `scripts/score.mjs`、`scripts/score.py` → `inspect_musicxml()`、`source()`、`compare()` | XML 检查不是原谱音符真值；识谱使用可用适配器。 |
| 原谱范围 | `scripts/source-scope.mjs` → `checkSourceScope()` | 依据绑定证据的清点记录核对范围，不自动数清所有原谱小节或判真音高。 |
| 符号事件 | `scripts/performance-map.mjs` → `scoreEvents()`、`midiScoreEvents()` | 显式归属及播放顺序；不推测缺音、手部或伴奏。 |
| 源音频/采样导出 | `scripts/audio-production.mjs` → `registerRecording()`、`renderScoreAudio()`、`masterAudio()` | 记录来源并保护尾音；音频导出或登记不等于已对齐。 |
| 时间与频谱候选 | `scripts/audio-analysis.py` → `features()`、`align()`、`onset_alignment()` | 全部 needs_review；不提供校准的音高/改编结论。 |
| 演奏映射 | `scripts/performance-map.mjs` → `validateTimeMap()`、`mappedTimeline()` | 经核对锚点、无越界外推；符号音尾插值不等于实测释放。 |
| 原生坐标 | `scripts/geometry.mjs` → `measureNative()`；`aiyoupu-legacy.mjs` → `validateLayout()` | SVG 与坐标同次排版；几何正确不等于音符正确。 |
| 复核与质量 | `scripts/quality-review.mjs` → `qualityRequest()`；`quality.mjs` → `evaluateQuality()` | 未审项不自动批准；正式全量内容与时间证据重新计算。 |
| 镜头/绑定/审片/导出 | `camera-path.mjs` → `focusPath()`；`aiyoupu-legacy.mjs` → `bindJob()`、`keyframes()`、`verifyOutput()` 及 render 分支 | 制作选择及实际谱面、关键帧/试听确认；冻结同版数据/代码，输出流检查不代替音乐内容检查。 |

共同顺序：确认内容与来源 → 建立经核对的映射和质量证据 → 生成镜头、绑定同版参数 → 关键帧/试听确认 → Remotion 导出 → 画面元数据与原音频保留检查。必要的几何、内容、时间数据可以迭代准备，正式输出前必须一致。

## 未来如何获得可公布的成功率

分别统计 MP3、MP3+PDF、MP3+XML、MP3+MIDI、XML 生成配乐、PDF 生成配乐等真实任务；同时记录环境、工具、输入质量和同版条件。不要混合不同链路发布一个总概率。

完成率 = 达到事先约定音乐/同步标准且完成审片、交付校验的任务数 / 该组进入评估的有效真实任务总数。保留样本数和失败/待确认/能力缺失/版本冲突分布，不移除困难任务以抬高比例；未完成与待确认不能计成功。若评估自动化，还应单独报告无需额外内容修正的完成率，不能用经修订后的交付比例冒充自动识别准确率。

没有独立内容与时间参考时记 not_measured；任何百分比都需说明样本数、测试条件、是否经过修订及评估范围。当前文档只给推荐与链路，不提供推测百分比。
