## Why

审查确认视频阶段没有反馈修订回路：任一段评审不通过即 `ReviewRejected` 终止整个运行，审查意见不回流成新任务；重新提交需要手工修改 tasks.json，评审缓存会复用同一次失败结论；删除某个镜头视频后也没有"仅重新合成"入口，恢复下载后只能整段重跑 video 阶段，存在重复付费提交风险。"保留候选供人工处理"之后没有后续动作可走。

## What Changes

- 新增 `redo` 引擎命令：针对指定视频段作废未通过候选（文件与任务 ID 归档保留），归档失败评审，记录用户修订反馈，并重新提交新候选（显式付费动作）；输入签名不一致或段无提交记录时明确拒绝。
- `generate` 恢复时读取段的修订反馈并传入视频评审载荷：评审缓存因此失效重建，Reviewer 能看到上一轮失败原因与用户反馈；评审通过后清除反馈记录。既有已提交、已下载与已通过段按现有缓存语义复用，不重复付费。
- 新增 `assemble` 引擎命令：从各段 `selected.json` 与对白计划重组装镜头、成片与字幕导出，不提交、不评审；段缺失时明确报错。
- 桌面 Generation 页按段提供"重提 · 付费"（含反馈输入）与"重组装成片"入口；引擎命令白名单同步。

## Capabilities

### New Capabilities

- `video-segment-redo`: 段级候选作废重提、评审反馈回流与仅重组装导出。

### Modified Capabilities

无。`implement-mangaweaver-mvp` 声明的 video-production 规格尚未归档合并，不在此重复声明。

## Impact

新增 `src/mangaweaver/generation/redo.py`；修改 `generation/pipeline.py`（抽出成片收尾函数并接入评审反馈）、`generation/video_review.py`、`cli.py`、`desktop.py`、`desktop/electron/engine.ts`、`desktop/src/features/Generation.tsx`、`desktop/src/App.tsx`。已归档候选保留任务 ID 供平台核对；`redo` 是显式付费提交，沿用"提交不自动重试"约定。真实重新提交链路需实机验证一次。
