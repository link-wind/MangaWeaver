# agent-orchestration Specification

## Purpose
用一份声明式清单描述漫画转动画的多 Agent 编排，并在桌面画布提供只读架构视图，让用户看到阶段、角色、门禁与失败回环，同时保持现有制作流程不变。

## Requirements

### Requirement: 声明式 Agent 编排清单
工作台 MUST 提供一份只读清单，描述六个制作阶段的顺序、每阶段 Creator/Reviewer 角色、通过不变量、审查失败回环目标和前置依赖。清单 MUST 是阶段标签的单一来源，且不改变现有制作流程或门禁执行逻辑。

#### Scenario: 读取编排清单
- **WHEN** 客户端请求 `read_agent_harness`
- **THEN** 返回静态阶段、角色、门禁、回环与依赖，不读取运行目录，不调用模型

#### Scenario: 阶段标签与清单一致
- **WHEN** 阶段按钮读取中文标签
- **THEN** 标签来自清单，不与架构描述分叉

### Requirement: 画布架构视图
画布 MUST 支持在产物视图和架构视图之间切换。架构视图 MUST 用现有 React Flow 渲染阶段、Creator/Reviewer 角色、门禁不变量和失败回环边，且 MUST 为只读，不触发模型、不参与运行、不改变既有产物视图。

#### Scenario: 查看 Agent 架构
- **WHEN** 用户从画布切换到架构视图
- **THEN** 按顺序展示六个阶段、各阶段角色与门禁，审查失败回环可见；切回产物视图时原产物节点与位置不变

#### Scenario: 架构视图不提交制作
- **WHEN** 用户在架构视图查看阶段和门禁
- **THEN** 不产生任何制作任务或模型调用
