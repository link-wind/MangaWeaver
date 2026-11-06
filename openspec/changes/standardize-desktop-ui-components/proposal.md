## Why

当前前端仍混用本地 Radix 封装、原生控件和页面专属样式，通用交互与样式需要重复维护。此前局部打磨未完成组件体系迁移，需要按《前端开源组件选型与替换盘点》覆盖全部页面，同时删除被替代的实现。

## What Changes

- 选定 shadcn/ui 官方 **Radix 版本**为统一基础，接入官方组件配置、默认样式与一套共享主题，保留白色简约、轻字重和小导航。
- 将盘点中的全部 14 类候选纳入实施：按钮、输入、下拉、页签／模式、选择框、进度／加载、状态／提示、弹窗／确认、会话浮层、右键菜单、业务折叠、节点搜索、三栏分隔和左侧目录。
- 使用官方 AI Elements 的 Prompt Input、Message／Chat、Task／Tool／Subagent／Queue 展示模式，对接现有会话与 Creator／Reviewer 数据。
- 引入 Command／cmdk 与 Resizable／react-resizable-panels，分别替代手写搜索列表交互和分栏拖动；记录依赖版本与来源。
- 逐页迁移首页、素材库、书籍选页、左栏、画布与右侧栏、设置、分格编辑、规划、候选历史、视频任务和结果页；同步清理旧 CSS、监听器和重复封装。
- 保留 React Flow、漫画框选／来源映射、任务状态与媒体生命周期；低频原始报告的原生 details、合法整卡按钮可保留并说明理由，不以原生标签清零为目标。
- 本变更明确更新早期“不引入新分栏库”和“仅采用本地 Radix 基础封装”的组件选型；其余未归档变更的功能合同与待验收项继续有效。

## Capabilities

### New Capabilities

- `desktop-component-system`: 全客户端共享主题、标准控件、搜索／分栏／导航迁移以及逐页一致性验收。
- `desktop-agent-ui-composition`: 基于官方组件模式的 Agent 输入、消息、任务、工具、子任务与队列展示，保留现有行为与数据协议。

### Modified Capabilities

无。`openspec/specs/` 当前无已归档主规范；本变更与已有未归档的桌面、保存、任务、媒体及删除规范共同生效，不重复补勾或归档旧任务。

## Impact

主要影响 `desktop/components.json`、`desktop/package.json`／锁文件、`desktop/src/components/`、`desktop/src/features/`、App、主题／样式及设计和验收文档。减少通用行为的手写代码，但 shadcn 分发的组件源码仍由项目维护。

Python 三阶段、模型客户端、提示词、默认渠道／分辨率、IPC／JSONL、项目格式、产物版本和真实删除语义不在变更范围。无需变更或重新验证 MiniMax H3 入口能力；默认离线验收，不自动提交付费制作。
