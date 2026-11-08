# 模型服务设置验收

日期：2026-11-07

变更：`configure-model-services`。

## 实施

按确认的模型服务、任务模型视觉稿实现五类设置Dialog。复用现有React/shadcn/Radix、Python Config与JSONL受限IPC，无新增依赖或服务。

连接目录与任务选择保存在`.env`的非秘密JSON字段，连接凭据分开保存；任务选择同步至原有标准配置字段。原始Key不回传，留空保留，原子写入权限0600；文件签名阻止覆盖外部修改。本地检查不实例化模型客户端；模型条目的手动测试直接使用当前草稿发起一次真实请求，不保存、不重试、不自动换模型。

参考Toonflow本地设置快照的分类与主从布局，以及Manga2Animate固定提交`29543daacbf58c609c360bad840649b0de6b4866`的显式环境配置。未引入任意供应商插件框架。

## 自动检查

- Python全量67项通过，包括6项配置读写与接口测试、凭据隔离、文件保留、版本冲突和能力限制回归。接口路由测试使用本地HTTP响应替身并禁止真实socket网络连接。
- 桌面端42项通过。
- TypeScript、Vite、Electron主进程与预加载构建通过；仅既有大bundle提示。
- OpenSpec严格校验与`git diff --check`通过。

## 实际客户端

独立Electron userData：`/tmp/mw-model-settings-validation-profile`、`/tmp/mw-model-service-test`。

独立配置：`results/settings-validation-20261107/.env`，只有离线占位Key与example.invalid地址。未修改用户真实`.env`，未调用任何付费或免费模型。

已操作验证：

1. 模型服务主从布局、文本／图像切换、添加命名连接、添加模型、编辑模型ID。
2. 本地检查成功显示“尚未验证接口；未调用模型”，不会冒充远端验证成功。
3. 新Key保存后清空输入，重开显示“已设置，留空保留”；连接目录和模型仍在。
4. 任务选择命名连接后，审查模型沿用该服务。修改被引用的模型ID会同步任务引用。
5. 不同文本／图像地址明确拒绝；改为同一地址后可保存。任务模型和12秒偏好已由Config重读核实。
6. 关闭与Cmd+Q均弹出未保存确认；继续编辑保留草稿，放弃后恢复旧值，保存并关闭实际落盘。
7. 本机环境、关于均可访问，路径只查看；本轮未更改真实路径。
8. 1480×980常用与1080×720最小窗口检查。底栏始终可见，最小窗口内容独立滚动。
9. 独立离线演示运行中打开设置，显示结束或停止后可保存；关闭返回原画布，演示继续。停止演示后进度保留。
10. 在独立profile中把幻灵文本地址临时改为本地HTTP mock并输入测试Key，点击模型旁“测试”后依次看到“测试中”和“接口可用”；mock只收到一次`POST /v1beta/models/gemini-3.8-flash:generateContent`，带Key且没有产生外部网络请求。
11. 本地mock返回401时，界面显示“测试失败”及脱敏后的请求号；当前Key没有出现在错误文本或设置结果中。
12. 修改地址后旧成功结果立即消失；改回原地址后仍保持“已配置 · 未验证”，不会把旧结果重新当作当前验证。
13. 图像页在按钮前明确显示“真实测试会发送一次请求并可能产生费用；视频只确认任务受理，不等待成片”，按钮文字为“真实测试”；本轮没有点击图像或视频，未产生付费调用。

验收中修正：旧全局label边距造成表单过松；同连接文本／图像地址编辑同步；设置错误去除Electron内部前缀；运行中打开设置不再先执行画布写入。

截图：

- `validation/model-settings/services-1480.png`
- `validation/model-settings/tasks-1480.png`
- `validation/model-settings/services-small.png`
- `validation/model-settings/packaged-services.png`
- `validation/model-settings/manual-test-success.png`
- `validation/model-settings/manual-test-warning.png`

上述截图记录布局验收时点；最后增加厂商差异图标与导航分隔线后，以最终包再次目视检查。

独立配置下打开首页历史真实项目曾提示“路径未授权”，该链路不涉及本轮设置修改；画布返回验收改用客户端生成的独立演示，未将历史项目打开视为通过。

## 交付边界

支持配置已有适配器，不能仅凭模型目录宣称远端权限可用。当前幻灵视频不支持Lite／480P组合时会阻止保存，须用户显式选择支持的型号与分辨率；不自动替换。文本接口已用本地mock验收完整IPC链路；图像和视频的真实测试入口已实现并提示计费边界，但本轮没有向外部模型提交付费请求。

## 打包与启动

`npm run pack`通过。已退出旧安装版进程，再启动最终`.app`，确认渲染地址来自新包的`app.asar/dist/index.html`，五类设置、厂商差异图标、导航分隔线、每个模型的手动“测试”入口及原凭据留空状态正常。真实配置仅只读查看，没有点击真实测试、保存或更改路径。

安装包：`desktop/release/mac-arm64/MangaWeaver.app`。

`app.asar` SHA-256：`703f897913c78061aa865b745fc23c6189deb188257eac3d816a0d2981181385`。

独立开发验收进程已关闭，最终安装包保持打开。构建仍使用项目既有默认Electron图标和本地未签名方式。
