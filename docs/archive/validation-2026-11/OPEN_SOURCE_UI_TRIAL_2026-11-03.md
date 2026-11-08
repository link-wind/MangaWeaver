# 开源界面组件局部接入

后续决定：`unify-desktop-creation-experience` 已移除仅视口的 assistant-ui 试接入，保留 Radix 基础组件与 React Flow。本文记录试用时状态；当前实施见 `DESKTOP_EXPERIENCE_VALIDATION_2026-11-03.md`。

本轮继续 `refine-creative-workbench`，只修改客户端展示，不调用模型或更改本地凭据。

## 接入决定

| 组件 | 本轮决定 | 范围 |
| --- | --- | --- |
| React Flow 12.12.0 | 沿用 | 现有节点、折叠、定位与画布回执保持 |
| shadcn/ui 组合方式 | 按需采用 | 本地维护 Dialog 与 Dropdown Menu，基于 Radix 原语，使用项目样式 |
| assistant-ui React 0.15.32 | 局部试用 | ExternalStoreRuntime 只读消息投影与 Thread Viewport 阅读视口 |
| react-resizable-panels | 暂不引入 | 继续现有拖动、键盘、宽度保存；没有同时引入第二套分栏实现 |

Radix Dialog 1.3.1、Dropdown Menu 2.2.1 与 assistant-ui 使用 MIT 许可，具体依赖与传递版本由 desktop/package-lock.json 锁定。本地基础组件借鉴组合方式，未复制远端整套模板。

## 实现边界

- 选材弹层使用 Portal、焦点约束、Escape 和外侧点击关闭，关闭时恢复入口焦点。复用原素材数据和导入，不触发制作。
- 引用菜单使用键盘导航和视口碰撞定位，关闭后回到输入框，目标／参考语义不变。
- assistantMessages 只投影消息与公开正文，保持 ID，排除已被轮次替代的助手摘要；工具不会转为可执行 tool-call。
- assistant-ui 只参与阅读滚动，现有专业卡片仍由 CreativeTimeline 绘制；输入、草稿、停止、分支和队列仍走项目原入口。未配置云端线程服务或模型连接。
- 当前为局部试用，未全面迁移消息渲染、Composer 或附件到 assistant-ui。引入完整运行时有额外依赖成本，后续应按实际使用收益决定是否扩大，而非默认继续迁移。

## 本地验证

2026-11-03 使用独立 Electron 验证配置与 `results/refine-creative-workbench-validation/project`：

- 中文草稿打开选材并 Escape 关闭后保留，焦点回到“从素材库选择”。已查看实际弹层截图。
- 画布引用菜单打开、方向键和 Escape 可用；关闭后焦点回到创作输入框。
- 通过客户端发送离线要求，固定样例的第一段在任务结束前显示，后续两段继续追加，最终状态为已完成。
- 展开协作详情显示本地样例的脚本创作／脚本审查、轮次和公开文字，保留“回到最新消息”。这些是明确标注的本地事件，不是模型效果验证。
- 桌面 26 项回归通过，TypeScript／Vite／Electron 构建通过，OpenSpec strict 验证通过。

未完成：长历史中持续上翻的滚动稳定性、跨分支阅读恢复、最小窗口及全部运行中队列／停止／恢复的完整客户端回归。原任务 6.2、6.3 不因此勾选。最后构建 JS 约 955 kB（gzip 295 kB），仍有既有的大块提示；本轮没有为了消除提示额外拆包。

参考：[assistant-ui 外部状态](https://www.assistant-ui.com/docs/runtimes/custom/external-store)、[shadcn/ui](https://ui.shadcn.com/docs)、[React Flow](https://reactflow.dev/)、[可调整面板](https://github.com/bvaughn/react-resizable-panels)。
