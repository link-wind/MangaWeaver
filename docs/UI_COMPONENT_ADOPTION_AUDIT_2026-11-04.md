# 前端开源组件选型与替换盘点

日期：2026-11-04。范围：`desktop/src/App.tsx`、全部 13 个 `features/*.tsx`、媒体／分栏组件和 `components/ui/`。这是调研与待确认建议，不代表已迁移；本轮未安装依赖、修改运行代码或调用模型。

## 1. 建议

优先采用 **shadcn/ui 官方 Radix 版本组件与主题规范 + 官方 AI Elements 展示模式**。保留 React Flow 与 Lucide；节点搜索按需采用 Command／cmdk，三栏交互考虑 Resizable／react-resizable-panels。

选择依据是当前已有 React、Tailwind 4、Radix 和本地 `components/ui/`，可以逐项替换。现有组件只是采用了相似组合方式，并不等于已经完成官方组件及主题接入。当前未找到 `desktop/components.json`。

shadcn 是将源码交给项目维护的方案，能减少从零实现与页面重复，但不会消除所有本地组件代码。若优先级改为“尽量不维护控件源码与样式”，**Radix Themes** 比 shadcn 更符合这个维度；它提供成套样式和主题参数，应作为整套基础控件的替代路线，而不是与 shadcn 在不同页面混用。

当前不建议在这一轮同时引入 Mantine、Radix Themes、shadcn 三套视觉体系。下面的收益与成本为结合源码的工程判断，尚未做候选库运行对照实验。

## 2. 候选库对比

| 候选 | 提供内容 | 对本项目的收益 | 迁移代价／边界 | 建议 |
| --- | --- | --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com/docs) | 带默认样式的组件源码、主题规范 | 与现有 Tailwind／Radix 接近，补全表单、状态、弹层与导航 | 源码仍由项目维护；须删除旧 CSS 覆盖，不能只把标签改名 | 主推荐，显式选 Radix 版本 |
| [Radix Themes](https://www.radix-ui.com/themes/docs/overview/getting-started) | 成套样式、Theme、尺寸与颜色参数 | 更直接减少按钮／表单／状态／菜单的手写样式 | 要迁移现有封装与主题；缺少漫画、Agent 等业务界面 | 若更看重减少本地控件维护，选此路线 |
| [Mantine](https://mantine.dev/getting-started/) | React 组件、主题、hooks 与表单生态 | 覆盖广，通用控件有统一外观 | 会更换大量已有基础设施；仍需要漫画和 Agent 展示适配 | 可选整体重做路线，当前不优先 |
| [React Aria Components](https://react-aria.adobe.com/styling) | 无默认样式的可访问交互组件 | 表单、菜单、集合交互能力可用 | 仍需设计和维护样式，且与现有 Radix 职责重叠 | 当前不新增 |
| [shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements) | Agent 界面的组件组合模式 | 对话输入、消息、任务、工具、子 Agent 可借鉴 | 仅替换展示；需对接现有会话、停止、队列、流式事件 | 优先小范围试用 |
| [cmdk](https://github.com/dip/cmdk) | 命令菜单、搜索列表交互 | 减少节点搜索中的列表导航实现 | 不提供完整主题，不替代跨页检索与定位工具 | 通过 shadcn Command 按需接入 |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | 分栏、分隔条、布局保存接口 | 替代手写拖动与部分宽度约束逻辑 | 需迁移旧像素宽度与折叠状态；须重新验证 React Flow 的尺寸响应 | 第二批，整组迁移 |

官方资料已核实的几个区别：

- shadcn 当前默认底层已改为 Base UI，Radix 版本仍受支持。现有项目应显式选择 Radix，避免无意混入第二套原语。[官方说明](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- Radix Themes 与 Radix Primitives 不同：Themes 提供成套样式，Primitives 主要处理行为。[官方入门](https://www.radix-ui.com/themes/docs/overview/getting-started)
- AI Elements 已有 shadcn 官方页面；旧 Vercel 仓库提示将于 2026 年 11 月底弃用。因此新增试用应以新页面为准。[旧仓库说明](https://github.com/vercel/ai-elements)、[新模式说明](https://ui.shadcn.com/docs/ai-elements)
- react-resizable-panels 当前文档使用 Group／Panel／Separator；不要套用旧版 PanelGroup 示例。实施时锁版本并核对 API。[项目文档](https://github.com/bvaughn/react-resizable-panels)

本次 npm registry 元数据读取失败，未据此给出各候选最新版本、完整依赖开销或 React 19 实测兼容承诺。已核实的是官方能力与本地替换位置；实施前需锁定具体依赖／源码版本并核对许可证。

## 3. 当前源码统计

使用 TypeScript AST 统计 JSX 定义位置，扫描 App、features、components 和 components/ui。排除 `components/ui` 内部实现后：

| 项目 | 位置数 | 解释 |
| --- | ---: | --- |
| 直接写的 button | 63 | 不含 Dropdown Menu 内部的 1 处；部分是合法业务交互，不能全部机械替换 |
| 共用 Button 调用 | 51 | 说明已有一定复用，但尚未覆盖全客户端 |
| 原生 input | 8 | 含搜索、页码、坐标和 1 处 Checkbox |
| 原生 textarea | 6 | 首页、对话、反馈与对白编辑 |
| 原生 select | 3 | Planning 2 处，CreativeTimeline 1 处 |
| 原生 details | 21 | 核心协作折叠与低频技术详情混在一起 |
| 共用 Dialog 调用 | 4 | 另有手写引用预览弹层和 1 处 window.confirm |
| 共用 Select 调用 | 3 | 制作终点、对话权限、运行中送达方式 |
| 共用 ToggleGroup 调用 | 2 | 画布视图与设置分类 |
| 共用 Tooltip 调用 | 12 | 其余位置仍有原生 title |

这些是定义位置数，不是运行时元素数或组件替换工作量。`.map()` 中一个输入可能渲染成多个；两种 Button 数量也不能直接换算成设计统一率。样式文件目前共 2533 行，不能把其中所有代码都视为可删除。

### 页面覆盖

| 页面／组件 | 直接 button | input／textarea／select | 优先统一内容 |
| --- | ---: | --- | --- |
| App | 6 | 0／0／0 | 全局导航、Banner、确认与引用预览 |
| WorkspaceHome | 3 | 1／1／0 | 输入框、附件、搜索、成片卡片的基础样式 |
| MaterialLibrary | 2 | 1／0／0 | 搜索、类型切换、选材弹层、空状态 |
| ProjectSidebar | 11 | 1／0／0 | 导航、分组、跳页输入、当前项 |
| BookPicker | 2 | 1／0／0 | 页码范围、分页、页面选择样式 |
| CanvasWorkspace | 16 | 2／0／0 | Tabs、Checkbox、节点搜索、Progress、Context Menu |
| CreativeComposer | 2 | 0／1／0 | Prompt Input、引用芯片、草稿反馈 |
| CreativeTimeline | 13 | 0／1／1 | 消息、Task／Tool 展示、会话 Popover、分支 Select |
| EnvironmentSettings | 0 | 0／0／0 | 沿用弹窗，统一字段排版、状态与分类语义 |
| Planning | 1 | 0／1／2 | 规划版本／反馈阶段选择、反馈输入、折叠 |
| SourceEditor | 3 | 2／2／0 | 模式切换、坐标／对白字段、行内操作 |
| Generation | 0 | 0／0／0 | 阶段提示、任务状态、技术详情 |
| Results | 1 | 0／0／0 | 结果选择、状态、字幕与审查折叠 |
| CandidateHistory | 2 | 0／0／0 | 候选选择、采用按钮、历史折叠 |
| Media | 1 | 0／0／0 | 加载／失败状态与播放按钮 |

## 4. 替换清单

按职责整理为 **14 类替换候选**，其中 9 类优先、5 类第二批。这不是 14 个 npm 包。

### 第一批：9 类通用控件

| 类别 | 当前实现与位置 | 推荐开源组件 | 可减少的自定义与保留边界 |
| --- | --- | --- | --- |
| 1. 按钮／图标操作 | 全客户端散落 button，与共用 Button 并存 | shadcn Button／Button Group／Tooltip | 收拢尺寸、危险态、焦点；导航、媒体整卡选择不强行套操作按钮 |
| 2. 输入与组合输入 | 8 处 input、6 处 textarea，首页与聊天独立排版 | Input／Textarea／Field／Input Group | 统一边框、标签、错误、输入内按钮；保留页码解析、自动保存、IME 与现有快捷键 |
| 3. 下拉选择 | Planning 2 处、会话分支 1 处原生 select；现有 3 处共用 Select | 官方 Select | 统一尺寸、弹层与键盘操作；保留候选选择和切换分支的业务回调 |
| 4. 页签／模式切换 | 右侧创作／详情手写 tabKey；素材筛选、编辑模式自定义按钮 | Tabs／ToggleGroup | 内容面板切换用 Tabs，模式值切换用 ToggleGroup；详情面板保留未保存草稿 |
| 5. 选择框 | CanvasWorkspace 的 page-run-check | Checkbox | 统一选中、禁用和焦点；保留 nodrag／nopan，避免与画布拖动冲突 |
| 6. 进度与加载 | node-progress、runtime-spin、媒体加载文字 | Progress／Spinner／Skeleton | 统一等待／运行／完成／失败的表现；只有真实百分比才填确定进度 |
| 7. 状态与提示 | node-status、work-status、tag、banner、各种 error 文本 | Badge／Alert／Sonner | 统一语义颜色和尺寸；错误、待确认与恢复操作继续常驻，普通完成提示用轻通知 |
| 8. 弹窗与确认 | 现有 Dialog、手写 reference-preview、window.confirm、删除确认 | Dialog／Alert Dialog | 统一遮罩、焦点、关闭、操作区；保留删除范围与原始素材保留说明，取消优先聚焦 |
| 9. 会话浮层 | CreativeTimeline 以 details 模拟会话菜单，内有分支与上下文信息 | Popover + Select | 用适合表单内容的浮层处理回焦／边界；压缩历史仍走原入口 |

### 第二批：5 类结构与交互

| 类别 | 当前实现与位置 | 推荐开源组件 | 收益与代价 |
| --- | --- | --- | --- |
| 10. 右键菜单 | CanvasWorkspace 手动坐标 + DropdownMenuTrigger 锚点 | Context Menu | 保留真实右键与 Shift+F10 的一致入口；需适配 React Flow 节点焦点和虚拟化，收益不大时可后置 |
| 11. 协作／历史折叠 | details 共 21 处 | Collapsible／Accordion | 优先统一协作卡片、候选历史；低频原始 JSON 仍可用原生 details，避免增加包装 |
| 12. 节点搜索 | 手写输入、列表、匹配与弹层 | Command（cmdk）+ Popover | 替代列表键盘导航；仍仅搜索已加载节点，跨页加载和定位保持原工具 |
| 13. 三栏分隔 | PanelResizeHandle 的拖动、约束、localStorage 与两组调用 | Resizable（react-resizable-panels） | 删除通用拖动代码；须保留无项目也能调整、细线无阴影、双击复位与旧宽度迁移 |
| 14. 左侧目录骨架 | ProjectSidebar 的多个分组、当前项、折叠与设置入口 | Sidebar／Item／Separator／Pagination | 复用导航构件；书名、选页、成片关联仍由现有数据生成，不额外增加 SidebarRail 与第二套分栏状态 |

## 5. Agent 展示层可进一步复用

官方 [AI Elements](https://ui.shadcn.com/docs/ai-elements) 提供基于 shadcn 组件的界面组合模式。可作为第二批中协作／输入展示的延伸，不必安装整套 Agent 运行时。

| 本地位置 | 候选模式 | 实施边界 |
| --- | --- | --- |
| WorkspaceHome、CreativeComposer | [Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input)：Input Group + Attachment | 接本地漫画导入和画布引用；不照抄浏览器上传／模型选择示例，不新增模型选择需求 |
| CreativeTimeline 的消息外壳 | Message／Chat | 消息顺序、轮次、分支和历史错误归属由现有代码决定 |
| WorkCard、ToolRecord、work-step | [Task](https://ui.shadcn.com/docs/ai-elements/base/task)、Tool、Trace | 显示真实公开事件，保留 Creator／Reviewer、轮次、退回和完成状态 |
| 子专业任务与队列 | [Subagent](https://ui.shadcn.com/docs/ai-elements/base/subagent)、Queue | 根据当前 parent_id／call_id 映射，不因 UI 名称改变引擎模型或任务协议 |

本项目之前已移除只有阅读视口收益的 assistant-ui 试接入，详见 `docs/archive/validation-2026-11/OPEN_SOURCE_UI_TRIAL_2026-11-03.md`。新试用必须先说明能替换哪些现有代码；不重复引入一套会话运行时。也不因为采用某个聊天样例而改用 Next.js 或替换 Python／JSONL／IPC。

## 6. 保留的 4 类业务定制

1. **画布节点与来源连线**：继续 React Flow；节点内部组合 Card、Progress、Badge、Button。来源映射、分组、位置持久化与 Agent 架构图属于业务，不由通用组件库替代。
2. **漫画分格编辑**：保留 SourceEditor 的坐标映射、框选、阅读排序和保存协议。模式切换／输入字段可换标准组件；不为矩形框选引入一套白板引擎。
3. **会话与工作流状态**：保留 session、工具回执、停止／恢复、队列、分支、事实归属、流式事件归并。开源任务卡片只接收这些数据。
4. **整本选页与本地媒体生命周期**：保留延迟加载、页码范围、素材路径、media lease／release、字幕导出；用标准分页、选择、空状态装配外观。当前单一视频播放器可继续原生 controls，不立即增加播放器框架。

## 7. 如何判断真正减少了自定义

- 通用控件统一从 `components/ui/` 导入，原有原语封装要与官方组件对照替换，不再复制一套同功能实现。
- 选定一套尺寸、字重、间距、圆角、颜色和状态变量；组件采用默认变体，页面主要决定布局。
- 每迁移一处同时删除被取代的 CSS 和监听器。重点限制 `.run-target .ui-select` 等页面对控件内部的覆盖；不能把旧样式搬到新文件后宣称减少。
- 先做基础控件，再做首页／设置，再做画布／对话，最后覆盖专业页；每批确认普通、禁用、执行中、失败与待确认状态。
- 回归重点是草稿不丢失、取消操作不产生副作用、键盘回焦、三栏约束、画布拖动与列表选择不冲突；不用为每个样式包装增加机械测试。
- 不以原生标签清零或“开源率”作为目标。可访问的整卡按钮、低频 details、业务布局保留合理。

## 8. 推荐实施顺序

1. 明确主库路线，先补官方组件配置与共享主题，再替换现有 Button／Dialog／Select 等封装。
2. 落地第一批通用控件，先覆盖首页、设置和规划反馈，拆掉相应旧样式。
3. 用一个真实 Creator／Reviewer 任务卡片试用官方 Agent 展示模式，确认能减少代码后再迁移右侧栏。
4. 分栏、节点搜索、左栏单独迁移，保留已有宽度与页面选择语义。
5. 对上述所有页面做一次实际客户端验收；未验证的状态明确记为待验，不把构建通过等同于设计统一。

以上为建议顺序，尚未创建新 OpenSpec 或开始迁移。
