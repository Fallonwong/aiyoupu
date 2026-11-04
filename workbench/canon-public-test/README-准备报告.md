# 卡农本地实测样例 · 准备报告

本目录是工作台「本地素材实测 · 卡农」的数据来源。原始下载文件保持只读；本轮所有派生文件都放在 `prepared/`。

## 1. 来源与许可

| 项目 | 内容 |
| --- | --- |
| 曲目 | Canon in D（Johann Pachelbel） |
| 来源 | Mutopia Project，`https://www.mutopiaproject.org/ftp/PachelbelJ/CanonInD/` |
| 版本 ID | Mutopia-2009/09/07-1700 |
| 许可 | Creative Commons Attribution 3.0（CC-BY-3.0），依据 `sources.json` |
| 下载日期 | 2026-11-03 |
| 转换工具 | MuseScore Studio 4.7.5（MIDI → MusicXML / SVG / MP3） |
| 本机原件 | `CanonInD.mid`、`CanonInD.musicxml`、`CanonInD-musescore-1.svg`、`CanonInD-musescore.mp3`、`CanonInD-a4.pdf`、`CanonInD.rdf`、`sources.json` |

`CanonInD-a4.pdf` 只作为原件对照，不参与时间轴推导，也不作为 MIDI 对齐的证明。

## 2. 链路每一步

1. **读谱面结构**：解析 MusicXML，得到 44 小节、142 个发声音符、1 个声部（voice 1）、单一高音谱表、`divisions=2`、速度 `quarter=60`。文件里没有 `<backup>`、没有 `<chord/>`、没有反复记号、没有第二谱表。
2. **量音头坐标**：
   - 从 SVG 里按出现顺序提取 142 个 `<path class="Note">` 音头，写成 `prepared/canon-score-ids.svg`（只给这些音头补 `id="canon-note-N"`，其余元素保持原样）。
   - 用 `scripts/geometry-v2.mjs` 的 `measureNative`（Edge 无头、`getBBox` + `getScreenCTM`）量出每个音头在 SVG 原生 viewBox 里的真实中心点。
   - 坐标不手写，也不从 PDF 或图片推测。
3. **配对与自证**：按「同一谱表 → x 递增」的阅读顺序把音头与 MusicXML 音符一一配对；再用几何自证：把每个音头的垂直位置换算成半音步，与 MusicXML 的 diatonic 音高相减，同一谱表内的结果必须落入极窄的簇。实测最大偏差 **0.001 半音**，每个谱表最多两个簇（对应谱号切换）。偏差超过 0.6 半音时脚本直接报 `CANON_PITCH_PAIRING_UNPROVEN` 并拒绝出时间轴。
4. **归一化**：`scoreWidth` 固定 1600，`scoreHeight = viewBox高 × (1600 / viewBox宽)`，缩放系数写进 `timeline.normalization.scale`。SVG 的 `viewBox`、`timeline.scoreWidth/scoreHeight`、`scoreImage` 共用同一个坐标空间，音头 id 与 `events[].notes[]` 一一对应。
5. **时间轴**：帧率 30。每音 `frame = tick × (60 / bpm / divisions) × 30`，`durationFrames` 同法换算；事件含 `measure`、`hand`、`frame`、`x`、`y`、`notes[]`（每音 `pitch` / `durationFrames` / `x` / `y`）。
6. **focusPath**：按 8 个谱表行（system）的中心 y 与行内音头 x 生成逐帧焦点；换行用 12–16 帧 Smoothstep 过渡，长度等于 `durationInFrames`。
7. **音频**：`CanonInD-musescore.mp3` 时长 179.069 秒；MusicXML 自身计时为 4/4 × 44 小节 × 1 秒/拍 = **176.0 秒**，末音从 172.0 秒开始、写谱时值 4 秒，收在 176.0 秒。时间轴按谱面计时生成，总时长取音频时长（5373 帧）。差额来自 MP3 末尾静音（`silencedetect` 在 173.46s 起持续到结尾），中间没有为了对齐而拉长时间轴，也没有对音频做变速。
8. **写盘**：`prepared/timeline.json`、`prepared/layout.json`、`prepared/summary.json`、`prepared/canon-score-ids.svg`。浏览器测量现场（临时 profile 与 DOM dump）写在系统临时目录，不落进仓库。

一键复现：

```sh
node scripts/prepare-canon-sample.mjs --browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
```

## 3. 实际缺口（如实标注）

1. **只有一个声部、一个谱表**。Mutopia 的这份 MIDI 导入 MuseScore 后是一行高音谱表、voice 1；没有左手低音谱表。工作台里这份样例只会点亮右手配色（淡紫），低音橙色不会出现。原始 `sources.json` 也写着「MuseScore MIDI 导入后拆为两个谱表，待人工核对」，实际导出结果并非双谱表。
2. **音频与谱面的关系是同一次导出**。MP3 由同一个 MuseScore 工程导出，不是独立演奏录音；它能证明「按谱面弹」，不能证明是某位演奏家的版本。
3. **谱面时长 vs 音频时长差 3.069 秒**，全部落在尾部静音。时间轴没有为这 3 秒伪造事件。
4. **没有谱面审批**。坐标只证明排版位置，不构成谱面正确性审批；`layout.json` 的 `limits` 字段也这么写。
5. **`CanonInD.mid` 只用于交叉核对**，不是时间轴来源；从 MIDI 直接生成的左右手划分未经人工确认，因此没有采用。
