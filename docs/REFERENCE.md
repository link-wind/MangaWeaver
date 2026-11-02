# 参考实现与接入记录

## Agent 会话运行时（2026-11-01）

本次重新读取 Manga2Animate `29543daacbf58c609c360bad840649b0de6b4866` 的 `src/run_all.py`、`src/create_script.py` 和脚本反馈提示词，保留原阶段、候选文件与审查循环。会话增量参考 Toonflow-app `d7366e36ba30943cf308121c28011b45bbf922e0` 的 `runtime/types.ts`、`sessions.ts`、`delivery.ts`、`delegation.ts` 以及前端 `replyStream.ts`；沿用真实文本／工具事件、固定子会话、送达边界与按块归并的思路，不迁入 SDK 或复制源码。

核对 Toonflow MIT 许可（Copyright 2026 HBAI-Ltd）。本项目独立实现本地文件和 JSONL 协议；若以后直接迁入代码，须保留相应许可与署名。用法见 [Agent 会话](AGENT_RUNTIME.md)。

核对日期：2026-10-23。

## Manga2Animate

- 仓库：https://github.com/annchenn/Manga2Animate
- 参考提交：`29543daacbf58c609c360bad840649b0de6b4866`。
- 检查了分格、MAGI OCR、角色描述、脚本与分镜生成和审查、主循环、视频生成及 H3 后端。
- 复用思路：MAGI 检测与阅读排序、图像＋文本调用、脚本按角色和片段组合选择、分镜候选比较、双层反馈、视频候选和任务 ID 保存。
- 该提交的文件清单未发现 LICENSE／NOTICE。当前按其公开流程和接口重新组织实现及中文提示词，不原样复制上游源码或模板，不将其代码自行标成宽松许可；后续若直接迁入代码，先确认授权。

## MiniMax H3

官方资料：
- https://platform.minimax.io/docs/api-reference/video-generation-v2-create
- https://platform.minimax.io/docs/api-reference/video-generation-v2-query
- https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json
- https://huggingface.co/MiniMaxAI/MiniMax-H3

已核实的接口合同：
- 创建：`POST /v2/video_generation`；查询：`GET /v2/query/video_generation/{task_id}`。
- 国际站 `https://api.minimax.io`；中国站当前文档使用 `https://api.minimax.cn`。密钥与站点需匹配，不能据国际站 401 直接判断中国站密钥无效。
- 当前选定模型：`MiniMax-H3-Lite`，默认生成 480P；`content` 包含非空文本和图像；图像通过 `role=first_frame`、`role=last_frame` 指定端点。
- 端点图与 `reference_image`／视频／音频参考模式互斥。原项目使用的是 `reference_image`，本项目调整为真实端点角色。
- 图像支持公开 URL、平台文件 URI、Base64 data URI；本项目优先本地图像转 data URI，避免额外图床。
- 时长为 4～15 的整数秒；Lite 分辨率为 `480P` 或 `768P`，不支持 `2K`；图生视频比例随输入图像，因此关键帧需要预先统一为 16:9。
- 图像单文件不超过 30 MB、宽高 256～5760、宽高比 0.4～2.5；完整请求不超过 64 MB。
- 成功创建返回 `task_id`；查询的 `task.status` 为 queued/running/succeeded/failed/cancelled，成功结果在 `task.content.url`。
- 首尾共享图像不能保证速度连续；每段至少 4 秒可能限制紧凑动作，任务构建会报出冲突，不静默变速。

以上为文档与代码核查结果。当前尚未验证账号权限、真实视频调用、计费或动画质量。

## Kie.ai（用户追加渠道）

- [Gemini 3.1 Pro 对话接口](https://docs.kie.ai/market/gemini/gemini-3-1-pro)：OpenAI 兼容消息结构，图片与完整视频均通过 `image_url` 传 URL；业务错误可能使用 HTTP 200，需检查 `code`。
- [文件上传](https://docs.kie.ai/file-upload-api/upload-file-stream)：文档指定 `https://kieai.redpandaai.co/api/file-stream-upload`，返回 downloadUrl，文件保留 24 小时。
- [Nano Banana Pro](https://docs.kie.ai/market/google/pro-image-to-image)：`POST /api/v1/jobs/createTask`，`image_input`、`aspect_ratio`、`resolution` 等输入；[查询](https://docs.kie.ai/market/common/get-task-detail)返回 `resultJson.resultUrls`。
- 保留参考项目的模型请求、候选与结果处理方式，新增直接客户端适配；没有直接复制 Kie 示例程序，也没有增加自动切换或通用代理框架。
- 原生 Schema 强制支持未确认。实测通过 Schema 提示＋Pydantic 校验得到来源脚本和评审 JSON；接口会附 Markdown 围栏，因此规范化输出包装后继续严格校验字段。

## 本地预处理实测补充（2026-10-26）

本轮重新读取同一参考提交下 `src/croppanels.py`、`src/magi.py` 和 `requirements.txt`，继续使用其 MAGI 检测及阅读排序方法，不复制其源码。因真实中文漫画输入中 MAGI 自带 OCR 生成了错误英文，新增明确可选的本地 RapidOCR，仅替换文字识别，保留检测、排序和后续规划协议。单页离线实测与版本见 [本地预处理](LOCAL_PREPROCESSING.md)。

## 创作 Agent 增量（2026-10-26）

复读同一参考提交的 `src/run_all.py`、`src/create_script.py` 与 README 阶段协议：保留参考项目的候选、Creator／Reviewer、反馈轮次和文件恢复；将 MangaWeaver 已有 `from_stage`、`pause_after`、`location` 封装为专业任务。总对话循环、书籍导入与画布回执为新需求，不复制或重写已有专业推理。

MOBI 使用 PyPI `mobi==0.4.1` 的 KindleUnpack 独立 CLI（GPL-3.0-only），不复制源码；发布带该可选工具的完整环境时应随工具提供其许可与源码获取说明。PDF 使用 `pypdfium2`，依赖声明在 book-import extra。使用和验证见 `docs/CREATIVE_AGENT.md`。

## 画布运行进度（2026-10-27）

复读同一参考提交的 `src/run_all.py` 阶段调度与已有产物恢复机制。保留 Creator／Reviewer 与文件式产物，仅在阶段通过、单帧完成和任务状态落盘时发布 JSONL 事件与规划检查点，满足客户端逐步显示需求。对话栏运行记录属于桌面增量，不增加业务 Agent 或改写原有模型选择、审核与任务恢复。

## 书籍画布与折叠（2026-10-27）

本轮沿用上述参考提交的单页运行目录及恢复机制，复读现有 `agent/tools.py`、`agent/loop.py`、桌面 JSONL 与图投影代码。仅新增页面运行索引和语义分组的显示投影，书籍与页面浏览不包装为专业推理 Agent。阶段逻辑、Creator／Reviewer、模型客户端与 H3 能力约束不变；未迁入上游源码。

2026-10-27：分阶段按钮继续委派既有 preprocess／delegate／generate，复用参考提交 29543daacbf58c609c360bad840649b0de6b4866 的按阶段执行和文件式恢复原则。十页惰性加载属于本地工作台增量，不改变原 Creator／Reviewer 或 H3 Lite／480P 约束。

2026-10-27：角色识别真实响应包含分析文字和唯一 JSON 围栏。对照同一参考提交 create_script.py 的 JSON 提取，本项目仅提取唯一 JSON 代码块，并继续使用原 Schema 校验；多块、截断或字段不合法仍报错，不修补业务内容。Gemini、幻灵、Kie、词元共用这段包装处理。已用真实失败响应本地恢复 2 个角色并验证缓存复用，新增 API 调用为 0；Python 共 24 项检查通过。

2026-10-27：停止修正继续遵循同一参考提交 run_all.py 在中断后保留文件式恢复结果的原则；进程跟踪属于桌面增量。修复只读进程清除制作登记的问题，统一两个停止入口和队列标记，未新增服务或通用调度框架。验收见 CLIENT_ACCEPTANCE_2026-10-27.md。

同轮手工来源校正复用既有 save_source／start_canvas 文件式版本路径，补齐原页身份继承，不修改专业制作阶段或模型提示词；原生保存和导出验收已完成。

## 统一任务与协作时间线（2026-10-29）

复读固定参考提交 `29543daacbf58c609c360bad840649b0de6b4866` 的 run_all.py 阶段执行、auto_resume、有限迭代和 create_script.py 的候选／反馈文件读取。继续复用已有专业 Creator／Reviewer 和本地文件恢复；新增任务账本、角色调用边界、待处理修改和客户端时间线，不引入新 Agent 框架。模型与视频配置保持现状，Lite／480P 验证依用户决定移出本轮。

## 消息、画布引用与专业交接（2026-10-31）

继续以 Manga2Animate 固定提交 `29543daacbf58c609c360bad840649b0de6b4866` 为制作基线，复读 `run_all.py`、`create_script.py` 及 `create_script_without_feedback_no_fewshot.txt`、`create_script_with_one_feedback.txt`。保留原先按反馈修订指定内容、正确部分复用和有限阶段循环，仅在现有任务、调用与检查点边界补入明确任务书和回报。

交互协作参考 Toonflow-app 固定提交 `aaf8b1d5cec6160adf595ab1c09cb078dc6f0f0b` 的 `apps/server/src/agent/runtime/delivery.ts`、`mentions.ts`、`delegation.ts` 与 `packages/teams/storyboardTeam/team.json`。采用消息送达与意图区分、固定产物引用、有限专业角色交接的思路；实现继续使用本项目 JSONL、独立收件文件、项目任务账本和现有 Creator／Reviewer，没有迁入 SDK、任意递归子 Agent、服务或数据库，也没有复制上游源码。

引用由后端核对真实对象与签名，图像进入原多模态／GPT Image 请求及既有缓存签名；新的控制用途若后端不支持则明确阻止。H3 能力检查和供应商配置保持现状。本轮客户端使用隔离的本地协议预设和原生窗口验证，不代表新增付费模型或动画质量实测。
