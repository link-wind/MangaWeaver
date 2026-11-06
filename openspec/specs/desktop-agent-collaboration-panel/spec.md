# desktop-agent-collaboration-panel Specification

## Purpose
规定 MangaWeaver 桌面工作台创作对话栏如何分层展示普通对话与多 Agent 协作过程，使用户能识别当前 Agent、审查结论与迭代状态，并能从 trace 定位到画布产物。

## Requirements

### Requirement: 对话与协作分层
对话栏 MUST 将用户指令与 Agent 结论性回复，和 Creator／Reviewer 的协作过程分开展示；协作过程 MUST NOT 与普通消息混排在同一条无层级的时间线中。

#### Scenario: 查看一次创作任务
- **WHEN** 用户提交一次创作并等待 Agent 完成
- **THEN** 对话区只显示用户指令与 Agent 的结论性回复，协作过程默认收进独立 trace 树，不占用对话区主视图

#### Scenario: 查看协作过程
- **WHEN** 用户需要了解某次任务由哪些角色参与、被审查几轮
- **THEN** 对话栏提供进入协作视图的入口，协作过程以「任务 → 角色 → 迭代 → 审查 → 产物」层级树呈现

### Requirement: 角色与迭代可读
协作 trace MUST 清晰显示参与角色链、每轮迭代的审查结论与退回次数；审查退回、失败与待确认 MUST 使用语义状态色与可读文字。

#### Scenario: 识别角色链
- **WHEN** 一次任务包含创建与审查角色
- **THEN** trace 以可读路径呈现角色先后关系（例如 `Creator → Reviewer`），用户无需展开即可识别协作结构

#### Scenario: 识别审查退回
- **WHEN** 某轮审查未通过
- **THEN** 该轮以语义色高亮，显示退回原因与建议，且退回次数在折叠态仍可见

#### Scenario: 重复迭代折叠
- **WHEN** 同一角色经过多轮相似迭代
- **THEN** 中间轮次折叠为「共 N 轮」摘要，避免逐轮铺开造成混乱

### Requirement: 画布与产物联动
协作 trace MUST 支持从任务或产物定位到画布对应节点；画布架构视图的节点 MUST 能联动高亮 trace 中对应任务。

#### Scenario: 从 trace 定位产物
- **WHEN** trace 中展示关键帧、脚本或视频产物
- **THEN** 用户可点击产物定位到画布对应节点并展开详情

#### Scenario: 从画布定位任务
- **WHEN** 用户在架构视图点击某个阶段或角色节点
- **THEN** 对话栏 trace 高亮并滚动到对应任务，用户能反查其协作过程

### Requirement: 状态与历史保持
对话栏 MUST 保持流式追加、历史阅读、停止与恢复、待确认回答与「回到最新消息」的现有交互不被重构破坏。

#### Scenario: 流式运行与停止
- **WHEN** Agent 流式输出或运行中被停止
- **THEN** 对话与 trace 均实时更新，停止状态可读，恢复后从进度继续

#### Scenario: 阅读历史
- **WHEN** 用户向上翻阅历史或存在未读的待确认问题
- **THEN** 历史可正常滚动阅读，「回到最新消息」与待确认入口保持可用
