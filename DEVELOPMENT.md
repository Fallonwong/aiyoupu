# 开发与技术参考

本页供开发、维护与迁移使用。产品介绍和普通用户操作分别见[首页](README.md)及[使用指南](README_使用说明.md)。内部数据协议、验证结果、兼容记录不作为首页产品文案。

## 入口和技术资料

- [Skill 执行规范](SKILL.md)
- [视觉配置](references/visual-presets.md)与[教学模式](references/teaching-landscape-v2.md)
- [音频与谱面流程](references/workflow.md)
- [几何、审阅与渲染](references/rendering.md)
- [环境与安装](references/environment.md)
- [数据契约](references/data-contract.md)
- [输入分支与能力边界](references/input-routes.md)
- [内容与同步证据](references/performance-quality.md)
- [当前能力与限制](references/upgrade-status.md)
- [延音与起音语义](references/music-motion-semantics.md)

脚本入口：`node <skill>/scripts/aiyoupu.mjs --help`。完整执行要求以SKILL.md及对应参考文件为准，普通用户无需手动执行内部绑定命令。

## 版本与迁移

当前下载版本为v2.3.0。V2由Piano Remotion更名为AI有谱，slug为aiyoupu；命令、Composition ID、组件名和数据协议存在不兼容变化，见[历史迁移说明](history/migration-v2/migration-guide.md)。仓库现为Fallonwong/aiyoupu，历史检查清单只代表当时状态。

历史任务保持原环境，新版本另存props、layout、job和审批资料。不同版本的内容确认不能自动互用；方向保存不是谱面或关键帧批准。正式有声任务需要对应的谱面、排版、音频与质量证据，direction_draft不可冒充正式绑定任务。

依赖基线为Remotion 4.0.515、React 19.2.4、TypeScript 5.9.3。运行工程协议版本与公开发布版本独立。工作台提供四个入口；Skill的专用连续谱带/跑道能力见[连续谱带](references/score-strip.md)，不作为当前工作台可用入口展示。

## 验证记录的适用范围

方向协议、代表性乐理语义、教学框景、播放状态、启动就绪及安装保护已有技术检查。当前曲目的完整正式bind、真实用户内容审批和全曲成片尚未完成实际验收，不能从技术夹具通过推导为真实曲目交付通过。

性能仅有本机headless Chromium短段采样，不保证所有设备的帧率；测试中存在Node DEP0187弃用警告。版本、任务、素材、props、运行源码和审批证据必须按各自绑定关系核验。不同输入的真实完成率尚无完整统计样本，不宣称成功率百分比。

发布ZIP与GitHub主分支是独立快照。文档更新不会自动更改已发布ZIP；已发布资产应保持可追溯，不静默替换同版本文件。后续打包需重建manifest并核对包内字节。

许可状态见[历史许可通知](history/v130/LICENSE.txt)；本次文案整理不新增授权。
