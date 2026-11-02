## Why

MangaWeaver 已具备首页、素材库、成片库和多阶段画布，但界面仍有字重偏重、导航与附件占用空间、画布和对话信息重复等问题。需要统一视觉层级并突出漫画与生成内容，让它更像轻巧、精致的桌面创作工具。

## What Changes

- 统一浅色视觉规范、字体层级、间距、圆角、图标和状态表达。
- 精简首页：移除顶部标题与项目选择栏，缩小侧栏和附件，突出漫画输入与 prompt。
- 优化素材库与成片库的封面、卡片和空状态，减少说明文字。
- 优化画布节点、进度、分组和对话栏的密度与层级，清楚呈现 Creator／Reviewer 的真实协作记录。
- 保持现有工作流与桌面操作能力，主要调整视觉呈现和交互细节。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本变更属于现有桌面工作台的视觉与交互整理，不改变用户可执行的功能或引擎行为；按纯视觉变更跳过功能规格。

## Impact

- 设计依据：[MangaWeaver 视觉设计优化方案](../../../docs/WORKBENCH_VISUAL_DESIGN_PLAN.md) 和现有 `desktop/DESIGN.md`。
- 预计影响 `desktop/src/workbench.css`、首页、素材库、成片库、侧栏、画布与对话展示组件。
- 不新增依赖，不修改 Python 引擎、模型接口、任务协议或本地数据格式。
- OpenSpec 配置使用 `skip_specs: true`，不为纯视觉调整虚构行为需求。
