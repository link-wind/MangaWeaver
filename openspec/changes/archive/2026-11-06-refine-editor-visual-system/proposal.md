## Why

MangaWeaver 的基础组件已经统一，但整体仍像功能工作台，首页、画布和对话的视觉密度、层级与“创作编辑器”的质感不足。需要在现有组件系统上收敛视觉语言，让漫画、关键帧和成片成为视觉主角。

## What Changes

- 建立一套更明确的编辑器视觉基线：语义状态色、固定字号梯度、4/8px 间距、两档圆角、三档深度和统一焦点样式。
- 重构首页为创作启动器：主标题更克制，漫画输入和提示词进入同一张创作卡片，最近成片以媒体封面优先。
- 统一画布节点结构：类型／状态、媒体、标题／元信息、按需操作四段式；描述收进详情，生成中用细进度条表达。
- 统一画布和对话栏的工具条、边框、背景和状态表达，使三栏形成连续的编辑器界面。
- 保持现有功能、数据协议、模型调用和项目操作不变，只调整展示层级和视觉状态。

## Capabilities

### New Capabilities

- `desktop-editor-visual-system`: 桌面工作台的统一视觉层级、状态语言和编辑器质感要求。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无归档主规范，本变更以新增能力描述可观察的界面行为。

## Impact

- 主要影响 `desktop/src/theme.css`、`desktop/src/style.css`、`desktop/src/workbench.css`、`WorkspaceHome`、`CanvasWorkspace` 和对话展示相关组件。
- 不新增前端依赖，不迁移组件框架，不修改 Python 引擎、受限 IPC、Agent 协议或模型配置。
- 视觉验收使用现有本地示例和打包客户端，不调用付费模型。
