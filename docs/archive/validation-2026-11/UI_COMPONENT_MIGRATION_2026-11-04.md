# 桌面组件迁移对照

变更：`standardize-desktop-ui-components`。本次仅改变前端组件、布局和展示；不改变制作引擎、H3 模型或付费调用边界。

## 基线与来源

开始前已有大量未提交修改，基线另存 `/tmp/mw-component-migration-baseline.txt` 与 `/tmp/mw-component-migration-baseline.patch`。这些是本次会话的临时审计文件，不是项目依赖。旧变更的未完成客户端验收继续保留。

源码来源、版本、原始源码哈希、MIT 许可和适配说明见 [THIRD_PARTY_UI.md](../../../desktop/THIRD_PARTY_UI.md)。采用官方 Radix 源码，配置文件明确 `radix-nova`；未安装另一套 Agent 运行时。

## 14 类落点

| 类别 | 实际构件 | 主要落点 |
| --- | --- | --- |
| 按钮与提示 | Button、ButtonGroup、Tooltip | 所有页面操作、画布视图工具 |
| 输入 | Input、Textarea、Field、InputGroup | 首页／对话／反馈输入，检索、坐标与对白 |
| 下拉 | Select | 规划版本与修订阶段、会话分支、权限、送达方式、制作终点 |
| 页签与模式 | Tabs、ToggleGroup | 专业阶段、右工作区、设置；画布视图、素材筛选与分格模式 |
| 选择框 | Checkbox | 多页画布运行选择，保留 nodrag／nopan |
| 加载与进度 | Progress、Spinner、Skeleton | 真实节点进度、本地媒体、素材读取 |
| 状态与反馈 | Badge、Alert、Sonner | 协作与视频任务、审查、问题常驻与轻通知 |
| 弹窗与确认 | Dialog、AlertDialog | 设置、选材、素材／引用预览；永久删除与重新读取 |
| 会话浮层 | Popover + Select | 分支与上下文信息 |
| 右键 | ContextMenu | 真正的节点上下文菜单，删除旧假触发器与坐标状态 |
| 折叠 | Collapsible、TraceCollapsible | 协作过程、工具结果、候选、脚本、字幕与审查 |
| 检索 | Command／cmdk + Popover | 仅在已加载节点中筛选与定位，保留画布命令回执 |
| 三栏 | Resizable／react-resizable-panels | App 与 CanvasWorkspace 的嵌套布局，旧像素偏好沿用 |
| 目录与条目 | Sidebar、Item、Separator、Pagination | 目录分组／导航、任务条目、分隔及十页一组浏览 |

## 页面与职责

| 文件／分支 | 迁移内容 | 保留的业务边界 |
| --- | --- | --- |
| WorkspaceHome：首页、成片库 | InputGroup／Attachment、搜索、Button、菜单 | 只列真实成片，点击打开所属项目，主动添加素材 |
| MaterialLibrary／MaterialPicker | Dialog、筛选 ToggleGroup、搜索、Skeleton | 本地主动导入、按 ID 取素材；取消不导入 |
| BookPicker | 范围 Input、分页、选择 Button | 仅加载当前十页窗口，原文件页序不变 |
| ProjectSidebar | 官方 Sidebar 子集与 Separator | 紧凑书籍跳页，宽度只由 Resizable 管理 |
| EnvironmentSettings | Dialog、Tabs、Button | 仍只配置本机路径，选择取消不写配置，运行限制不变 |
| CanvasWorkspace | Tabs、ContextMenu、cmdk、Resizable、Progress、Checkbox、Badge | React Flow 节点／边／位置、折叠身份、引用、真实清理预览不变 |
| CreativeComposer | InputGroup、Attachment、DropdownMenu、Select | 草稿、目标与参考、IME、Cmd／Ctrl+Enter、权限和送达方式不变 |
| CreativeTimeline | Message／Bubble、Trace、Popover／Select | 原轮次、父子任务、Creator／Reviewer、公开流式块与队列顺序不变 |
| SourceEditor／SourceView | Input／Textarea／Field、ToggleGroup、Collapsible、Button | 矩形框选、坐标映射、阅读顺序和保存协议不变 |
| Planning | Select、Field、InputGroup、Badge、Collapsible、Button | 修正版本值与文件名的错误映射；不提交额外模型请求 |
| CandidateHistory | Collapsible、Button 缩略图 | 采用权限、来源与审查记录仍由既有接口决定 |
| Generation | Item、Badge、Alert、Collapsible、Button | 预览／显式生成／查询的边界、远端 ID 不变 |
| Results | Button、Badge、Collapsible | 选中真实产物、原生音轨、字幕与导出不变 |
| Media | Skeleton、Spinner、Alert、Button | 继续 lease／release 与本地协议；保留 video 原生控件 |
| App | Alert、Dialog、AlertDialog、Tabs、Resizable、统一日志入口 | 保存失败继续保留草稿；关闭弹层不隐式执行 |

## 删除的重复实现与合理保留

- 删除 `PanelResizeHandle.tsx` 的指针捕获、手写拖动和键盘调整；只保留 `panelWidth.ts` 的旧值读取与保存。
- 删除 `useDetailsMenus.ts` 的全局点击／Escape 监听。菜单和浮层交给 Radix。
- 删除画布手写页签键盘轮转、搜索结果键盘／浮层、右键假按钮及 `x/y` 定位状态。macOS 的 Shift+F10 只把键盘入口转为标准 contextmenu 事件，实际定位和焦点仍由 ContextMenu 管理。
- 删除 `.button` 变体、旧 `.ui-*` 控件、手写分隔线、旧输入外观、搜索面板、附件和通知的重复规则。页面布局置于 Tailwind components 层，避免覆盖共享控件 utilities。
- 保留漫画裁切矩形、React Flow 卡片／组与媒体比例等业务布局。保留技术 JSON、错误原因、清理文件范围的原生 details；不为原生标签数量增加包装。
- 保留唯一的会话滚动跟随状态与监听；展开协作即暂停跟随，继续提供“回到最新消息”。

构建、逐页客户端结果与未完成边界另记在本次验收文档中；代码迁移不等于全部客户端验收通过。

## 视觉收敛补充

复核发现，组件迁移完成后页面仍保留旧字号、字重、字体和控件高度。2026-11-04 补充处理如下：

- 系统字体与等宽字体只在 `desktop/src/theme.css` 定义；页面、菜单、弹窗和通知继承同一字体，日志、代码、快捷键与测量值使用等宽字体。
- 字号收敛为 11px 元信息、12px 控件、13px 正文、14px 小节标题，以及 16／20／24／28／32px 的标题层级；页面不再直接写 8、9、10、10.5、15、18、22 等零散字号。
- 字重只用 400、500、600；输入、按钮、Select 和 Toggle 继承命名高度变量，默认 32px、紧凑 28px、大号 40px、小型附属操作 24px。
- 清理旧 CSS 中被后续同选择器声明覆盖的重复属性；页面只保留布局、媒体比例和业务卡片样式。旧按钮、输入和菜单外观不能再覆盖共享组件。
- 彩色正文、占位和辅助信息统一使用语义文字／弱文字 token；代码与日志仍使用统一等宽字体。

Toonflow 当前依赖的精确对照和 MangaWeaver 不再增加第二套通用组件库的结论见 [Toonflow 借鉴设计方案](../../TOONFLOW_INSPIRED_DESIGN.md)。
