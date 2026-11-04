# V2.0 破坏性迁移说明

原名 piano-remotion，现名 AI有谱（aiyoupu）。本目录旧值均为迁移对照。

| 旧调用/字段 | V2调用/字段 |
|---|---|
| `$piano-remotion` | `$aiyoupu` |
| `node <old-skill>/scripts/piano-v130.mjs ...` | `node <aiyoupu>/scripts/aiyoupu.mjs ...` |
| `node <old-skill>/scripts/piano.mjs ...` | 当前任务使用 `aiyoupu.mjs`；V2内部旧行为诊断入口为 `aiyoupu-legacy.mjs` |
| `PianoRemotion-Song` / `PianoRemotion-Demo` | `Aiyoupu-Song` / `Aiyoupu-Demo` |
| `PianoScoreSceneV130` / `PianoScoreScene` | `AiyoupuScoreSceneV2` / `AiyoupuScoreScene` |
| `piano-*` 应用schema / `piano_remotion.omr` | `aiyoupu-*` / `aiyoupu.omr` |
| `PIANO_*` 配置变量 | `AIYOUPU_*` |

不留旧文件名的提示入口，因此旧命令、旧import路径、旧组合ID、旧schema和环境变量在V2失效，没有隐含过渡期。
旧任务文件不原地升级：继续在冻结V1.3.0环境检查/复现；V2另存新props、layout、job和审批包，旧审批不能冒充V2画面批准。
相同乐谱/母带的旧批准可作为工作台“已批准来源”的证据，导出仍须逐一验证旧request/response/job/receipt及文件哈希；不据此授权V2正式视频导出。
新名字重渲是待用户目检的迁移预览。最终导出仍需对应V2冻结任务和本版关键帧批准。

版本为2.0.0。依赖版本、乐谱、音符、相机数值、母带和原审批记录不因改名变化。
本次不覆盖本机已安装旧Skill，测试使用本地V2副本；正式安装/替换由用户决定。
