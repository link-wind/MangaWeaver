## Why

目前运行中发送的消息一律进入“待修改”，进度询问和后续要求也可能误触发修订；画布选择又不能表达固定版本的目标与参考。已有多 Agent 时间线需要进一步连接到明确的专业任务书与回报，让用户看清谁在处理什么、为什么退回以及实际产物在哪里。

## What Changes

- 将消息的送达方式与业务意图区分：支持调整当前任务、稍后处理；进度询问不创建修订，停止走已有中断路径，只有真实内容修改进入原修订流程。
- 复用本地收件与任务账本，固定消息发送时的任务、页面、运行版本和授权，安全边界处理，支持撤回；停止或重开不自动执行。
- 支持把选中画布节点加入输入框，形成明确的目标或参考引用，发送时固定真实产物版本，后续切页不改变引用。第一版不建设全局素材搜索。
- 在总 Agent 与现有阶段 Creator／Reviewer 之间补齐精简任务书和结构化回报，记录真实交接、反馈接收者与产物；沿用现有有限反馈循环与专业审查权。
- 输入区仅增加必要的送达选择和引用标签，交接摘要简短、细节折叠，继续复用任务与画布双向定位。

## Capabilities

### New Capabilities

- `agent-message-delivery`：运行中消息的送达、意图处理、任务归属及中断恢复边界。
- `agent-context-references`：画布对象与产物版本的明确引用、验证及专业输入传递。
- `agent-task-handoffs`：总 Agent 与专业 Creator／Reviewer 的任务书、结构化回报与真实交接展示。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无已归档主规范；本次为已实施的 `unify-agent-task-workflow` 增量，明确收窄其“运行中提交待处理修改”：只有确认为内容修改的消息才进入该路径，其余任务身份、审查、停止与画布回执约定继续沿用。

## Impact

- Python：`agent/loop.py`、`agent/tasks.py`、`agent/workflow.py`、`agent/tools.py`、相关 schema 与桌面命令；按需接入现有规划／生成入口和角色事件，不重写三阶段算法。
- 桌面：输入框、画布上下文、消息／任务时间线及受限 IPC 类型；沿用现有 JSONL、`session.json`、`tasks.json`、`pending_requests/` 和运行目录，不增加数据库或服务。
- 参考：Manga2Animate 固定提交 `29543daacbf58c609c360bad840649b0de6b4866` 继续作为制作流程依据；Toonflow-app 固定提交 `aaf8b1d5cec6160adf595ab1c09cb078dc6f0f0b` 仅参考消息送达、引用和有限角色协作，不迁入其 SDK 或泛化 Agent 框架。
- 不涉及候选采用切换、共享资产库、自动多视角生成、任意递归委派或模型／视频后端调整。Lite／480P 验证与新增付费模型测试不纳入本次范围。
