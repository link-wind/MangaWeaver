# 对话栏协作 trace 验收

对应变更：`refactor-agent-conversation-trace`。

## 验收范围

- macOS Electron 42 打包客户端，常用窗口 1480×980、最小窗口 1080×720。
- 使用本地离线项目 `results/node-menu-validation/runs/canvas`，其中包含 Creator→Reviewer 任务、公开说明、产物和等待确认状态。
- 未提交任何付费模型请求，未生成新的 AI 图片或视频。

## 实际客户端结果

| 区域 | 结果 |
| --- | --- |
| 对话 / 协作切换 | 右侧创作栏顶部显示「对话」「协作」分段控件，默认停留在对话；切换后进入独立协作视图 |
| 对话视图 | 只显示用户指令、Agent 结论性回复、流式公开文字、待确认问题和历史编辑；任务卡片与工具记录不再混入 |
| 协作 trace | 显示「本地样例 · 来源脚本协作」任务卡、`脚本创作 → 脚本审查 通过` 角色链、审查通过结论、逐轮活动和公开说明 |
| 等待与产物 | 「制作至视频成片」显示等待回答；「漫画分格」显示已完成、复用已通过产物和 `production.json`、`manifest.json` 定位入口 |
| 画布到 trace | 架构视图点击「来源脚本」阶段后切到协作视图，并高亮对应任务；点击「漫画分格」阶段回落到父任务「制作至视频成片」并高亮 |
| trace 到画布 | 点击高亮任务的「查看画布」后打开详情页并定位「整页漫画」节点 |
| 最小窗口 | 1080×720 下右侧面板约 335px，对话/协作切换、角色链和卡片完整可见，内容纵向滚动，无横向溢出 |

## 实现范围

1. 新增 `desktop/src/lib/trace.ts`，把 `WorkflowTask`、`TaskActivity`、`handoffs` 与公开说明映射为任务树、角色链和迭代步骤。
2. 新增 `desktop/src/components/AgentTraceTree.tsx`，按任务、角色、迭代、审查、交接、产物和子任务呈现，并复用现有 `Trace`、`StatusBadge` 与语义色。
3. 重构 `desktop/src/features/CreativeTimeline.tsx`，把原单一时间线拆成「对话 / 协作」两个视图；对话视图移除任务卡片和工具记录。
4. `CanvasWorkspace` 的架构阶段节点点击按 `stage` 找任务，子任务阶段回落到父任务，并联动协作视图高亮。

没有引入 assistant-ui 或 agent-prism：前者是单助手模型且 React 19 有已知问题，后者需要 Tailwind 3 与 OTLP/OpenInference 数据模型，均超出本次最小改动范围。

## 自动检查与交付

- `npx tsc --noEmit`：通过。
- `npm test`：32 项通过，新增角色链归并、子任务归属、公开说明补链和审查退回态渲染测试。
- `npm run build`：通过，仅保留既有的大 bundle 警告。
- `npm run pack`：macOS arm64 `.app` 打包通过。

## 未覆盖边界

- macOS 目录选择窗口在应用控制接口中仍无法确认「打开」按钮；本轮改用最近项目直接打开，未把该问题归因于本次前端改动。
- 真实离线样例只包含审查通过的角色链；审查退回的红色状态与问题条目由组件级渲染测试覆盖，尚未在真实客户端样例中观察。
- ScreenCaptureKit 截图曾间歇返回捕获失败，最终文字和键盘/点击结果来自可访问性树与成功截图的组合。
