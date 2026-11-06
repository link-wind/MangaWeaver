## Context

现有六个制作阶段是 `preprocess → script → arrangement → direction → storyboard → video`。`agent/stages.py` 维护阶段标签与每阶段「是否完成」判断；`agent/specialists.py` 从模板路径派生 `*.creator` / `*.reviewer` 角色；`planning/pipeline.py` 是 Creator→Reviewer 的固定顺序与反馈循环；`agent/tools.py` 声明阶段依赖（script→arrangement→direction→storyboard）。这套信息彼此分散，画布只画产物节点，看不到 Agent 架构。

参考 Metis 的 harness 图，把上述编排信息收敛为一份只读声明式清单，供画布架构视图展示，并作为阶段标签的单一来源。

## Goals / Non-Goals

**Goals:**

- 用一份声明式清单描述六个阶段、Creator/Reviewer 角色、门禁不变量、失败回环与阶段依赖。
- 画布新增可切换的架构视图，用现有 React Flow 渲染这份清单。
- 阶段标签从清单读取，消除标签与架构描述的分叉。

**Non-Goals:**

- 不把 `stages.completed()`、`planning/pipeline.py` 的反馈路由迁移到清单驱动执行。
- 不新增全局编排运行时、模型决策、角色抽象基类或另一套制作流程。
- 不改动视频生成、模型、提示词、供应商和产物协议。
- 不照搬 Metis 的 ROADMAP/GATELOG/RUN-NONCE 等治理产物和 L0–L4 并行 fleet。

## Decisions

### 清单结构

`harness.py` 定义一个只读的 `STAGES` 序列，每项含：

- `id`：阶段名（preprocess/script/arrangement/direction/storyboard/video）
- `label`：中文标签
- `creators` / `reviewers`：参与该阶段的角色名
- `gate`：通过不变量（中文一句话，供架构视图展示）
- `on_fail`：审查失败回环目标（空表示回自身继续修订）
- `requires`：前置阶段

其中 `creators`/`reviewers` 只描述角色，不包含 Metis 的 `systemPrompt`、`tools`、`model` 等字段；这些仍由 `specialists.py` 和提示词目录承担，避免重复维护。

### 视图渲染

架构视图复用现有 `bookGraph`/`graph` 同一份 React Flow 画布，用独立的节点集合渲染。阶段节点按列排列，`creators`/`reviewers` 作为子节点，`gate` 作为门禁节点展示不变量文字，`on_fail` 生成回环边。视图只读，不参与运行、不触发模型，节点不携带运行状态。

### 命令与数据边界

`read_agent_harness` 返回纯静态清单，注册在 `desktop.py` 的 `_dispatch`，允许列表在 `main.ts` 与 `engine.ts` 增加；不要求打开项目、不校验运行目录。清单只在首次进入架构视图时读取，不参与保存队列。

### 单一来源范围

让 `stages.LABELS` 与 `tasks.LABELS` 的六个制作阶段标签都从 `harness.STAGES` 派生；`tasks.LABELS` 额外保留角色资料、日语对白、剪辑导出与工具子阶段标签。`stages.completed()` 的现有判断保持不动并在注释中标注其对应 gate，避免为展示功能重写执行门禁。

## Risks / Trade-offs

- [清单与执行逻辑漂移] → 清单只描述展示与标签，明确不是执行真相；`completed()` 注释标注对应关系，避免误当作门禁来源。
- [视图切换增加画布复杂度] → 复用现有 React Flow 节点渲染，不新增画布库；切换不改变既有产物视图状态。
- [过度设计倾向] → 只做只读展示与标签单一来源，不迁移门禁判断、不建运行时。
