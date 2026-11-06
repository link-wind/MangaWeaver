## Why

MangaWeaver 的多 Agent 制作流程（六个阶段、Creator/Reviewer 专业角色、每阶段的通过门禁与审查失败回环）目前散落在 `agent/stages.py`、`agent/specialists.py`、`planning/pipeline.py`、`agent/tools.py` 里。画布只呈现来源、镜头、关键画面、视频等产物节点，用户看不到「哪些角色在哪个阶段协作、什么条件下通过、失败回到哪里」。参考 Metis 把 Agent 编排做成一张声明式图（`harness.json`）的思路，把这套已存在的编排信息提取成单一可读来源，并在画布增加一个只读的架构视图。

## What Changes

- 新增 `src/mangaweaver/agent/harness.py`，用一份声明式清单描述六个阶段的顺序、每阶段的 Creator/Reviewer 角色、通过不变量（gate）、审查失败回环目标与前置依赖。
- 新增 `read_agent_harness` 命令，只返回这份静态清单，不读取运行目录、不调用模型。
- 六个制作阶段的标签（`stages.LABELS` 与 `tasks.LABELS` 的阶段部分）改为从该清单读取，避免标签与架构描述分叉。
- 画布增加「产物 / 架构」切换；架构视图用现有 React Flow 渲染阶段、角色、门禁与回环边。

## Capabilities

### New Capabilities

- `agent-orchestration`: 声明式 Agent 编排清单与画布架构视图。

## Impact

- 新增 `src/mangaweaver/agent/harness.py`。
- `src/mangaweaver/agent/stages.py`、`src/mangaweaver/agent/tasks.py` 改为派生阶段标签；`src/mangaweaver/desktop.py` 增加命令注册。
- `desktop/electron/engine.ts`、`desktop/electron/main.ts` 允许并转发 `read_agent_harness`。
- `desktop/src/features/CanvasWorkspace.tsx` 增加视图切换，`desktop/src/lib/` 增加架构视图数据映射，样式保持现有白色简约风格。
- 不改变制作流程、模型、提示词、供应商或产物协议；不迁移现有门禁判断逻辑，也不新增模型决策。
