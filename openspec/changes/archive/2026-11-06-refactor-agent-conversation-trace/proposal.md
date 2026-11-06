## Why

右侧创作对话栏现在把「用户指令」「Agent 文字回复」「任务卡片」「Creator／Reviewer 协作过程」「工具调用」「待确认问题」全部压进同一条时间线，再靠大量 `Trace` 折叠层层嵌套。结果是信息密度高、层级混乱，用户很难一眼看出当前由哪个 Agent 在做、被谁审查、退回了几轮，多 Agent 协作特性没有被展示出来。

## What Changes

- 把对话栏从单一时间线拆成「对话」与「协作」两个视图：对话只保留用户指令与 Agent 结论性回复，协作过程收进独立 trace 树。
- 新增轻量的多 Agent 协作 trace 树组件，按「任务 → 角色 → 迭代轮次 → 审查结论 → 产物」层级展示，直接映射现有 `WorkflowTask` 与 `TaskActivity` 数据。
- 审查退回、失败、待确认使用语义状态色和红色问题高亮；重复迭代折叠成摘要；角色链以 `Creator → Reviewer` 可读路径呈现。
- 保持架构视图的节点点击联动到 trace 树对应任务；产物可定位到画布节点。
- 保持现有数据协议、Agent 运行时、流式协议和付费模型调用不变，只重构展示层级与交互。

## Capabilities

### New Capabilities

- `desktop-agent-collaboration-panel`: 桌面工作台对话栏的多 Agent 协作分层展示、trace 树与画布联动要求。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无归档主规范，本变更以新增能力描述可观察的界面行为。

## Impact

- 主要影响 `desktop/src/features/CreativeTimeline.tsx`、`desktop/src/features/CanvasWorkspace.tsx` 的右侧 `conversation` 面板，以及 `desktop/src/workbench.css`、`desktop/src/style.css`。
- 新增 `AgentTraceTree` 组件与必要的展示辅助函数，数据源复用现有 `WorkflowTask`、`TaskActivity`、`handoffs`、`report.reviews`。
- 不新增前端依赖，不迁移组件框架，不修改 Python 引擎、受限 IPC、Agent 协议或模型配置。
- 视觉验收使用现有本地离线示例和打包客户端，不调用付费模型。
