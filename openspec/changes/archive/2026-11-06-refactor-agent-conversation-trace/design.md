## Context

右侧创作对话栏当前由 `CreativeTimeline` 承担，把消息、任务、协作活动、工具记录和待确认问题塞进一条按时间排序的列表。数据本身已经完整：`WorkflowTask` 有 `parent_id`、`activities`、`handoffs`、`report.reviews` 和 `brief`，`TaskActivity` 有 `actor/role/iteration/status/accepted/issues/artifact`。问题不在数据缺失，而在展示没有层级，导致「多 Agent 协作」被压成扁平卡片加折叠。

本轮只重构展示与交互，不改数据协议、Agent 运行时、流式协议和模型调用。视觉继续沿用 `refine-editor-visual-system` 的 token 与语义状态色。

## Goals / Non-Goals

**Goals:**

- 把「对话」与「多 Agent 协作」分两层展示，让用户一眼看出当前任务由谁创建、谁审查、退回几轮。
- 提供一份可直接映射现有数据的协作 trace 树，替换扁平嵌套的 `WorkCard`。
- 保持流式、停止与恢复、历史阅读、待确认回答和「回到最新消息」现有行为不变。

**Non-Goals:**

- 不引入 assistant-ui、agent-prism、mastra、Langfuse 等组件库或观测平台。
- 不新增后端服务、不迁移组件框架、不重写 `App.tsx` 或页面结构。
- 不改变 Creator／Reviewer 的运行方式、候选数量、审查标准或任何模型调用。

## Decisions

### 1. 自研 trace 树，不引入 assistant-ui 或 agent-prism

`assistant-ui` 是单助手对话模型，且当前在 React 19 存在已知问题，接入还需为 JSONL 子进程协议自写 runtime，收益仅覆盖「对话壳」这一层，投入产出不符。`agent-prism` 面向 OTel/OpenInference/Langfuse 数据，需要 Tailwind 3（项目为 Tailwind 4），且是 Alpha、需复制源码，数据适配成本高。

因此协作展示自研一个轻量 `AgentTraceTree`，视觉借鉴 `agent-prism` 的 `TreeView` 层级（缩进、连接线、状态点、问题红色高亮、重复序列折叠摘要）和 LangGraph Studio 的 run 视图，但实现完全基于现有 shadcn/ui 组件与 `@xyflow/react`。

### 2. 对话栏拆成「对话」与「协作」两个视图

右侧面板顶部用分段控件（Tabs 语义不变）在两个视图间切换：

- 「对话」：只保留用户指令、Agent 结论性回复、待确认问题、流式文字、历史编辑/重新回答。删除任务卡片、协作活动和工具记录的展开层级。
- 「协作」：按 turn 分组渲染 trace 树，一个 turn 对应一棵任务树。

默认打开项目时进入「对话」，运行中可切到「协作」查看实时协作过程；存在待确认问题时在「对话」入口用现有角标提示。

### 3. trace 树信息架构

以单个 `WorkflowTask` 为根节点，层级为：

1. 任务根：`title` + `stage` + 状态。
2. 角色层：由 `activities` 按 `created_at` 排序，去重成角色链 `Creator → Reviewer → Creator（修订）→ Reviewer`。
3. 迭代层：同一角色相同 `professional_stage` 的连续活动归并为一轮，显示 `第 N 轮`、`审查通过`／`退回修订`／`复用`。
4. 产物层：`artifact` 与 `report.artifacts`，可点击定位画布节点。
5. 子任务：`parent_id` 指向当前任务的任务作为子节点，递归展开。

`handoffs` 的 `sender → receiver → summary` 渲染为角色交接连接；`report.reviews` 渲染为最终审查结论；`issues` 渲染为红色问题条目（`evidence` + `suggestion`）。

### 4. 渐进披露与折叠策略

- 默认展开到「角色层 + 最终结论」，中间逐轮活动折叠为「共 N 轮」摘要。
- 审查退回、失败、待确认的轮次默认高亮显示退回原因，其余轮次折叠。
- 单轮展开后显示该轮的 `message`、`artifact` 和 `issues`；工具参数继续折叠。
- 重复且无问题的中间轮次不逐条铺开，保持一眼可扫。

### 5. 画布与 trace 联动

- 点击 trace 中的产物或任务调用现有 `onLocate` 定位画布节点。
- 架构视图节点点击后，把对应 `task.id` 作为高亮传入 `AgentTraceTree`，滚动并高亮该任务。
- 反向从 trace 定位画布复用现有 `props.onLocate`，不新增协议。

### 6. 数据映射集中到辅助函数

新增 `desktop/src/lib/trace.ts`，集中提供 `taskTree`、`roleChain`、`iterationGroups` 等纯函数，把 `WorkflowTask` 和 `TaskActivity` 映射为 trace 树节点，供组件和现有测试复用。不把映射逻辑散落进组件。

## Risks / Trade-offs

- [拆成两个视图可能增加一次切换成本] → 运行中默认留在「对话」，切到「协作」后再自动回到最新轮次；待确认问题仍在「对话」入口有角标。
- [trace 树信息量仍可能偏大] → 默认只展开角色链与结论，逐轮折叠为摘要，问题轮次单独高亮，避免全量铺开。
- [自研 trace 可能不如成品组件精致] → 复用现有 `Trace`、`Disclosure`、`StatusBadge` 与语义色，先保证可读性与数据正确，视觉细节后续在实现中收敛。
- [React 19 与流式交互已稳定] → 本变更不触碰流式协议和 `conversation.ts` 的事件归并逻辑，只改消费层展示。

## Migration Plan

1. 新增 `desktop/src/lib/trace.ts`，实现任务树、角色链、迭代分组的纯函数映射。
2. 新增 `AgentTraceTree` 组件，先用现有本地离线项目数据渲染任务树，确认层级正确。
3. 重构 `CreativeTimeline` 为「对话 / 协作」两个视图，把任务与协作从对话主视图中移出。
4. 接入画布节点点击 → trace 高亮，以及 trace 产物/任务 → 画布定位。
5. 复验流式追加、停止与恢复、历史阅读、待确认回答，运行现有测试、类型检查、构建和 OpenSpec 严格校验，重新打包。

回滚按视图拆分进行：`AgentTraceTree` 是新增组件，移除即可回退；`CreativeTimeline` 的拆分保留数据映射函数，可单独回退到原单层展示。
