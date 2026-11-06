## Why

当前画布的节点标题、状态、操作和右栏容器同时强调自己，真实漫画与动画素材占比不足，多 Agent 记录也缺少清楚的阅读主线。用户已确认 `docs/prototypes/toonflow-canvas-v1/` 的完整视觉稿，要求依照该稿实施。

## What Changes

- 画布采用轻量项目目录、克制的工具栏和媒体优先节点：标题移到媒体外，常态隐藏不必要的成功标签及操作，运行与异常仍清楚显示。
- 右栏使用“创作助手”统一入口，对话以连续正文呈现结论，折叠的协作摘要显示真实角色链；详细交接、审查与产物入口保留在协作视图。
- 输入区合并节点引用、指令、权限和发送操作，自动保存信息退出常驻表单行，保存失败仍可见。
- 保留三栏伸缩、节点菜单与二次删除确认、流式追加、历史阅读、停止恢复及既有专业页面入口。
- 使用真实运行在实际 Electron 客户端检查常用与最小窗口，更新设计文档并重新打包 `.app`。
- 首页提供「体验演示」，在独立本地运行中用已有漫画和视频展示分格、规划、协作审查与预览，不调用模型。

## Capabilities

### New Capabilities

- `canvas-creative-surface`: 与已确认视觉稿一致的画布创作界面、连续对话及可展开的真实协作摘要。

### Modified Capabilities

无。当前主规范目录尚无已归档的相关能力，本变更复用既有实现及相关未归档变更，不重新定义后台工作流。

## Impact

主要涉及 `desktop/src/features/CanvasWorkspace.tsx`、`CreativeTimeline.tsx`、`CreativeComposer.tsx`、`ProjectSidebar.tsx`、`AgentTraceTree.tsx` 和共享样式，必要时精简画布展示数据。沿用 React Flow、shadcn/Radix、Lucide 和 react-resizable-panels，不新增组件库、后端协议或模型调用。

正式创作继续使用真实会话、活动、审查和产物。演示预设仅存在于明确标注的独立模拟运行，不写入正式项目；复用现有 `desktop_simulation.py`，不修改正式生成调用。
