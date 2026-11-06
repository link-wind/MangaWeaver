## Why

当前工作台已具备制作与多 Agent 协作能力，但选材、节点编辑与过程查看仍分散；防抖保存、媒体生命周期和异步写回也需要更明确的边界。借鉴 Toonflow 已核对的交互与工程做法，提升中途编辑的可靠性与创作过程的清晰度。

## What Changes

- 统一首页输入工具行、漫画书架与选材面板，选材返回后保留原输入及引用。
- 节点默认突出产物，选中后显示相关操作；长文本继续进入现有详情区，明确保存与执行的区别。
- 连续展示对话正文，折叠工具记录；以阶段任务承载 Creator／Reviewer 协作、送达状态与队列，并支持节点搜索和双向定位。
- 整理设置的分类与内容区，仅覆盖已有本机环境及版本信息；不新增模型管理、账户或用量平台。
- 为可编辑来源和画布快照补保存版本校验，切换及退出前等待保存；沿用原子替换并使用唯一临时文件。
- 为媒体 token 建立获取／释放边界；异步结果在应用前核对项目、运行、对象与任务归属。
- 浏览已有候选与正式采用分开，沿用审查、来源签名和修订规则，不增加绕过审查的选用路径。
- 复用现有事件去重、50ms 批处理、运行锁、画布回执和任务恢复，仅减少确定存在的重复历史复制；不预建虚拟列表。

## Capabilities

### New Capabilities

- `workbench-editing-session`：编辑版本冲突、切换前保存、失败保留草稿与异步编辑归属。
- `workbench-contextual-tools`：选材、节点上下文编辑、候选浏览／采用、节点搜索与本机设置导航。
- `workbench-collaboration-navigation`：连续消息、阶段协作详情、送达／排队状态和产物双向定位。
- `workbench-media-lifecycle`：共享媒体资源的使用与释放，避免跨节点错误清理及过期加载写回。

### Modified Capabilities

无。当前 `openspec/specs/` 尚无归档主规范；既有桌面、Agent 和任务上下文约束仍在历史变更中，本轮以增量合同补充，不重写或归档其他变更。

## Impact

涉及现有 React 页面、Electron 受限 IPC／媒体入口和 Python 文件保存边界。保留三阶段、Creator／Reviewer 与现有本地产物协议，新增保存版本及媒体释放字段通过现有入口扩展，不迁入 Toonflow 框架、插件体系或网络服务。

设计依据：`docs/TOONFLOW_INSPIRED_DESIGN.md`、`docs/TOONFLOW_ENGINEERING_REFERENCE.md` 与参考记录。白色简约风格沿用 `desktop/DESIGN.md`。本变更不代替 `refine-workbench-visual-design` 尚未完成的实机验收，也不自动认定旧视频播放问题已解决。
