# 前端开源组件来源与维护边界

日期：2026-11-04。对应 OpenSpec：`standardize-desktop-ui-components`。

## 固定来源

组件从 shadcn 官方注册表读取并复制实际源码；不是依据组件名称另写相似控件。Radix 路线固定，未加入 Base UI、React Aria、Next.js、AI SDK、assistant-ui 或第二套会话运行时。基础控件采用 new-york-v4；新增加的 AI 展示构件采用同站 Radix 的 radix-nova 注册表。两者使用同一套本地语义 token。

注册表本身不提供不可变 Git 提交标识。以下记录本次获取的原始 `files[0].content` 的 SHA-256，防止后来同一 URL 更新时混淆来源。副本的导入路径已适配项目；哈希用于原始来源识别，不要求与适配后文件相同。

运行依赖固定：`radix-ui@1.8.1`、`cmdk@1.1.1`、`react-resizable-panels@4.18.0`；其余解析版本见 `package-lock.json`。删除重复的独立 Radix 直接依赖，统一从 `radix-ui` 导入。React 19、Tailwind 4、Vite 8 类型与构建检查通过后记录在验收文件中。

| 本地副本 | 官方注册表 | 原始源码 SHA-256 |
| --- | --- | --- |
| accordion.tsx | [new-york-v4/accordion](https://ui.shadcn.com/r/styles/new-york-v4/accordion.json) | `99de242681eb43121969db02bbb102aeeb1865ef52c7635672508a58c5429085` |
| alert-dialog.tsx | [new-york-v4/alert-dialog](https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json) | `b3dfb83e54ed8c82071df5289e5149628bf573458fc2da2d62f93f8380041b28` |
| alert.tsx | [new-york-v4/alert](https://ui.shadcn.com/r/styles/new-york-v4/alert.json) | `d03dcae5cdb63c381c1144ca9a0c49ba0e46466967d7deb94662034042acb034` |
| attachment.tsx | [radix-nova/attachment](https://ui.shadcn.com/r/styles/radix-nova/attachment.json) | `1def1ffa33178cd61ac2b47240f3707823acf85b9a55dcec01a8aacb5802b2e0` |
| badge.tsx | [new-york-v4/badge](https://ui.shadcn.com/r/styles/new-york-v4/badge.json) | `13a9380dfff853ee730c14a52df49f22aecd31f40f2998d7c1e7ec458b6e1650` |
| bubble.tsx | [radix-nova/bubble](https://ui.shadcn.com/r/styles/radix-nova/bubble.json) | `df1e461e33e835b7f69296939c2325e8cd76941b5ec69375d80d639793c5c4e2` |
| button-group.tsx | [new-york-v4/button-group](https://ui.shadcn.com/r/styles/new-york-v4/button-group.json) | `a9ac862707ff8d78255f2696baf48f9a87d9e92e21eb476f8f9e9361313c1761` |
| button.tsx | [new-york-v4/button](https://ui.shadcn.com/r/styles/new-york-v4/button.json) | `79dd6f75f8136394442202d6b8b922fb269eaad0a5dba579397c9d5b41f893bb` |
| checkbox.tsx | [new-york-v4/checkbox](https://ui.shadcn.com/r/styles/new-york-v4/checkbox.json) | `ba0ac64064e2d8fa7299d53e9e84b9a4772fef8dd4cf6170c56d3030a1d69941` |
| collapsible.tsx | [new-york-v4/collapsible](https://ui.shadcn.com/r/styles/new-york-v4/collapsible.json) | `c6598e5584f4258b5d9fefadbc5ad6a66888ad58729f4b634a0bb2d9c513188b` |
| command.tsx | [new-york-v4/command](https://ui.shadcn.com/r/styles/new-york-v4/command.json) | `319e9264567dd46f04d705028bc345470663ca5919f31292c4ec43ea5ceb9336` |
| context-menu.tsx | [new-york-v4/context-menu](https://ui.shadcn.com/r/styles/new-york-v4/context-menu.json) | `bcde5df1ed9887bb050f0badabfb5f79912eb53bdc883dbe6c003d05914d99a4` |
| dialog.tsx | [new-york-v4/dialog](https://ui.shadcn.com/r/styles/new-york-v4/dialog.json) | `2ade6074e5fad0a4eb171ead44c43d3301a3c83d186d7236fb1fdbea80ee556b` |
| dropdown-menu.tsx | [new-york-v4/dropdown-menu](https://ui.shadcn.com/r/styles/new-york-v4/dropdown-menu.json) | `d954efb735f13734751207ad22cb0cddd7f6ec53c59d16675d103dae08cb61fb` |
| field.tsx | [new-york-v4/field](https://ui.shadcn.com/r/styles/new-york-v4/field.json) | `4a4d17fcb933513f637f9f7e2daf5d8348f7de086b29738337dec7e6dd1819a0` |
| input-group.tsx | [new-york-v4/input-group](https://ui.shadcn.com/r/styles/new-york-v4/input-group.json) | `e379899ac50d6cabc9d9eb1668f265176951c62b1fe83a6f23ee97fe8074d526` |
| input.tsx | [new-york-v4/input](https://ui.shadcn.com/r/styles/new-york-v4/input.json) | `0c9457181f6ddc80969bcf854e92c362903a55b6e889fbef3fd85343ecc4af5b` |
| item.tsx | [new-york-v4/item](https://ui.shadcn.com/r/styles/new-york-v4/item.json) | `9ade8136f010284b7ec0142f52606616dd4b23798012e75a9fc6aac1fb2d792e` |
| label.tsx | [new-york-v4/label](https://ui.shadcn.com/r/styles/new-york-v4/label.json) | `344bde38b8531615dbf8e14af3895517c24d8ef6ce56ddeda7e2e6fe4b5d0c00` |
| message.tsx | [radix-nova/message](https://ui.shadcn.com/r/styles/radix-nova/message.json) | `64e9ae0f9d1e268b0ed7b738a53d374d273fe1e7e2dd7b35ad7417e50a9bbe6c` |
| pagination.tsx | [new-york-v4/pagination](https://ui.shadcn.com/r/styles/new-york-v4/pagination.json) | `224843c4f509e8b8c9848adefa43d1491846f0851138fa9b51cc6ba1319c5653` |
| popover.tsx | [new-york-v4/popover](https://ui.shadcn.com/r/styles/new-york-v4/popover.json) | `3f99d3add6c9fa4f03721e81297ee10e1310785ee1d9d9d4c82a114d84ab0757` |
| progress.tsx | [new-york-v4/progress](https://ui.shadcn.com/r/styles/new-york-v4/progress.json) | `e012e1f7e6e66d11229d1233eccf91954edcd9179b418ff1d114dc651b86fd35` |
| resizable.tsx | [new-york-v4/resizable](https://ui.shadcn.com/r/styles/new-york-v4/resizable.json) | `aaf3ea20e8060c75dd86e06fedfca053d49f81071123ba647b5699efcbc010ea` |
| select.tsx | [new-york-v4/select](https://ui.shadcn.com/r/styles/new-york-v4/select.json) | `962830436bd0b7ee50e556f0747e277d6a86869ed27d167516346b15f26309d8` |
| separator.tsx | [new-york-v4/separator](https://ui.shadcn.com/r/styles/new-york-v4/separator.json) | `ad7d5403fe337160e41dbf04147896e448ae3a747b8d06660d627d74d60021bc` |
| sidebar.tsx | [new-york-v4/sidebar](https://ui.shadcn.com/r/styles/new-york-v4/sidebar.json) | `2ba1a9b9422f4172373f4cd0587b675d2331a41f4fa68f65dab2b23ca98fd9d2` |
| skeleton.tsx | [new-york-v4/skeleton](https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json) | `f51ce0fcd31e5c31437382e80ea0af94b4fc3d64221d27091d36824546780a43` |
| spinner.tsx | [new-york-v4/spinner](https://ui.shadcn.com/r/styles/new-york-v4/spinner.json) | `5d040fc49cb54c0296070644053b5a8840ddbfca89a430546bf308df3fffad65` |
| tabs.tsx | [new-york-v4/tabs](https://ui.shadcn.com/r/styles/new-york-v4/tabs.json) | `e1df6e2f95ece373ca909c1d54b8ba8cf4c47dd425c1784bbb9a01c38dd0936b` |
| textarea.tsx | [new-york-v4/textarea](https://ui.shadcn.com/r/styles/new-york-v4/textarea.json) | `5cafcfeeee29534f449387a16b585f5923d2faab1a0cdc50a874416b175f59ce` |
| toaster.tsx | [new-york-v4/sonner](https://ui.shadcn.com/r/styles/new-york-v4/sonner.json) | `13ccc9b0fe4248e622f83a1d3b2f0566b72b5e04162d7d0c8db8945ecc71b55f` |
| toggle-group.tsx | [new-york-v4/toggle-group](https://ui.shadcn.com/r/styles/new-york-v4/toggle-group.json) | `45186473eaa30a966adf16e2b0aa0d16522425fda0658e2c85b8dcb1b62956ef` |
| toggle.tsx | [new-york-v4/toggle](https://ui.shadcn.com/r/styles/new-york-v4/toggle.json) | `28ae7d72730890a3ba6c668fd511c63a358ad26534c2c25d5922748d47e1fa99` |
| tooltip.tsx | [new-york-v4/tooltip](https://ui.shadcn.com/r/styles/new-york-v4/tooltip.json) | `611e4305879b2773eafe76bf3c5caa69d8e47367fd97887a71634a27828f4433` |
| trace.tsx | [radix-nova/trace](https://ui.shadcn.com/r/styles/radix-nova/trace.json) | `17f86b0e19fcfc7a8277061efa8c1af9b8f779436f60e1adb70c95f3e20b4468` |

## 必要的本地适配

- 仅把 `cn` 与组件路径改为 `@/lib/utils`、`@/components/ui`。统一 `components.json`、TypeScript 与 Vite 别名。
- Button 保留本项目原有中性描边默认，主操作显式 `variant="default"`；默认／图标尺寸为 32px，其他变体沿用官方。
- Progress 的未知值使用不确定状态，完成进度来自真实任务。不会按时间估算百分比。
- Spinner 和弹窗关闭的辅助文本改为中文。
- Sidebar 取官方 Header／Footer／Content／Group／Menu 的实际源码子集。删除本项目不需要的移动端 Sheet、独立开合状态与宽度 cookie，避免与 Resizable 争夺宽度。
- Resizable 保留官方 Group／Panel／Separator API。App 管目录与主区，CanvasWorkspace 管主区内画布与对话，分别只有一个 Group；这是对“一层三栏”的必要组合适配，保留页面现有所有权与草稿身份，未引入另一套拖动逻辑。旧 localStorage 像素值直接作为 Panel 默认尺寸，库提供像素 API，无需额外百分比换算模型。
- Panel 在每次挂载时固定初始 `defaultSize`。4.18.0 会在该属性变化时重新注册 Panel，实时宽度通过 `onResize` 保存后不能再作为变化中的默认值传回，否则会取消鼠标拖动；显式复位／折叠继续使用面板 API，重新挂载时读取最新宽度。
- Tooltip、Select、Dialog、ToggleGroup 只在 `components/controls.tsx` 保留旧业务签名。ActionMenu 是 DropdownMenu 与 Button 的小组合，焦点、定位、键盘处理由 Radix 实现。
- Trace 的注册表 `IconPlaceholder` 展开为本项目已有 Lucide 图标；Radix 的开合状态选择器显式写为 `data-[state=…]`。
- Sonner 使用官方图标与语义 token，白色主题固定，不为单一主题引入 next-themes。

## AI Elements 对照

采用 [Prompt Input](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input)、[Message](https://ui.shadcn.com/docs/ai-elements/radix/message)、[Task](https://ui.shadcn.com/docs/ai-elements/radix/task)、[Tool](https://ui.shadcn.com/docs/ai-elements/radix/tool)、[Subagent](https://ui.shadcn.com/docs/ai-elements/radix/subagent)、[Queue](https://ui.shadcn.com/docs/ai-elements/radix/queue) 的展示组合。

输入是 InputGroup + Attachment + DropdownMenu；消息是 Message + Bubble；任务、工具、子任务和待送达要求是 Trace／TraceCollapsible。继续读取本地真实 JSONL 事件、turnParts、workflow 与 pending_requests。保留项目原有 Cmd／Ctrl+Enter、IME 检查和单一历史跟随逻辑。Queue 保留原时间顺序，展示的是已排队要求，不凭空增加 Agent 计划。

Manga2Animate 的固定参考提交与 Toonflow 参考边界继续见 `docs/REFERENCE.md`；本次不改变制作引擎、模型、提示词或供应商。

## 许可证

shadcn/ui 与其展示模式采用 MIT。下方保留完整许可，来自官方 npm `shadcn@4.23.0` 的 LICENSE.md。Radix、cmdk、react-resizable-panels 和 Sonner 的许可随 npm 包分发并保留在安装依赖中。

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
