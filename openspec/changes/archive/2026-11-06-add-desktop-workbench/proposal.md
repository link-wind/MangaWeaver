## Why

目前 MangaWeaver 需要通过 CLI 和产物目录检查漫画、镜头规划、审查意见及生成结果，难以直观比较并提出修订。增加本地桌面工作台，让创作者在同一界面完成素材检查、规划反馈、任务跟踪和视频预览，复用已有 Python 引擎。

## What Changes

- 新增 Electron + React + TypeScript + Vite 桌面客户端，采用 Tailwind CSS 与 shadcn/ui 构建基础界面。
- 支持新建本地项目、导入漫画页或已有运行目录，检查分格、阅读顺序及对白；源素材修订另存，保留原始结果。
- 展示来源脚本、静态／动作镜头编排、关键画面及 Creator／Reviewer 意见，支持指定阶段提交反馈并查看修订结果。
- 增加轻量 Electron IPC / Python 子进程桥接，提供明确阶段事件、错误和产物信息，沿用原有任务保存与恢复机制。
- 支持本地图片对照、带声音的视频播放、字幕及审查查看、导出已有视频。
- 首版以当前 macOS 本地环境交付，使用已配置的 Python 与 FFmpeg；不建设 HTTP 服务、数据库、复杂剪辑时间线或自动更新体系。

## Capabilities

### New Capabilities

- `desktop-workbench`: 本地项目、素材校正、镜头规划查看和反馈修订。
- `desktop-engine-bridge`: 桌面客户端与既有 Python 流程之间的命令、事件、任务恢复和配置边界。
- `desktop-media-review`: 图片／视频／字幕／审查的对照查看及结果导出。

### Modified Capabilities

无。当前主规范目录尚未建立已有能力；本变更新增桌面入口，复用 `implement-mangaweaver-mvp` 中的引擎行为，不替代或归档该变更。

## Impact

- 新增 `desktop/` 前端及 Electron 工程、少量 Python 桥接代码，以及对应使用说明；现有三阶段业务目录继续承担生成流程。
- 为业务阶段增加必要的显式事件出口，不复制规划、评审、模型客户端和任务恢复实现。
- 默认模型、渠道、候选数量、MiniMax H3 Lite / 480P 及密钥本地保存约定继续沿用；客户端不能自动降级或更换模型。
- 既有实验产物可只读查看；整张故事板 `reference_image` 实验尚未进入正式引擎，本次不将其包装为可提交的正式生成路线。
- 本次为独立规划，不包含生成质量算法改造、额外付费生成或应用代码实施。
