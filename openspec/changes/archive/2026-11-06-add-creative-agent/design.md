## Context

动机和范围见 proposal.md。本变更横跨对话、导入、引擎和画布，需要技术设计。

当前 `start_canvas` 只保存 prompt 与初始用户消息，`dispatch` 按命令直接执行阶段。Electron `Engine.run()` 每请求启动一个 Python JSONL 子进程，stdin 发送一次后关闭，stdout 仅接受既定事件。React Flow 的节点由 `graph(run, state)` 从真实产物派生。规划已有 `from_stage`、`pause_after`、`location`、审查反馈、缓存和版本机制；这些是复用基础。

参考基线为 Manga2Animate `29543daacbf58c609c360bad840649b0de6b4866`，沿用项目已改编的 Creator／Reviewer、有限反馈、候选和文件产物。实施前复读该提交对应阶段及主循环，记录差异，不搬运缺少授权的源码。总对话 Agent 和画布控制是本次必要增量；不改变 H3 Lite / 480P 默认值，也不借 Agent 调度自动切换当前不支持的后端配置。

## Goals / Non-Goals

**Goals:**
- 总 Agent 用结构化动作循环委派任务，统一用户交互与项目上下文。
- 专业任务复用已有推理和审查，允许阶段级调用及局部修改。
- 在无运行时完成整本导入和选页，在有运行时支持画布与制作操作。
- 会话、任务、内容和视图分别保存，保持引用关系与真实执行反馈。

**Non-Goals:**
- 不引入多 Agent 服务、数据库、插件注册、任意 shell／JavaScript 执行或后台无人值守运行。
- 首版专业任务串行，不建设通用依赖图、跨 Agent 广播或第二套审查。
- 不在本变更添加 EPUB、CBR、DRM 处理、整本自动改编或印刷页码自动识别。

## Decisions

### 1. 总 Agent 用现有 JSON 模型接口形成工具循环

使用当前配置的文本模型和 `client.json()`，新增 agent/system 提示词与 Pydantic 可判别动作协议。动作是 `reply`、`ask_user` 或 `call_tool`，每步最多一个工具，执行结果带回模型；这是模型驱动循环，不是基于关键词的固定聊天脚本。先不依赖尚未验证的渠道原生 function calling，不新造供应商客户端。实测本机 Python TLS 与幻灵不兼容，增加显式 HUANLING_TEXT_API、HUANLING_TEXT_TRANSPORT 配置；本机选择 native + curl，兼容接口复杂输出不稳定，未设为默认；同渠道同模型，通过 stdin 传入凭据，保持证书验证，不自动切换。视频评审仍使用现有原生协议。

`agent/loop.py` 负责模型循环和暂停，`agent/tools.py` 负责有限工具定义与直接分发。跨前后端的动作、工具结果和会话数据类型集中到 `schemas.py`；需要清楚拆分时才单设会话读写文件。工具参数逐项校验，不接受任意命令、路径、代码或模型给出的成功结论。

单次请求采用有限动作步数，初始实现取 8 步，可由代码配置；到限保留任务并返回实际进展，不额外设计自动续跑。用户“继续”恢复剩余目标。

### 2. 专业子 Agent 是可委派任务，不是独立运行服务

工具 `delegate(stage, goal, location, mode)` 的阶段固定为 script、arrangement、direction、storyboard；mode 区分继续与修订。调用现有 planning pipeline 的最小阶段入口，保留前置检查、反馈路由、阶段暂停和整体审查。必要时抽取既有阶段执行块，但不得复制 Creator／Reviewer 实现或让顶层 Agent 自行判定专业审查通过。

统一结果包含 `status`（completed / needs_user / blocked / failed）、summary、artifacts、issues、question。`completed` 必须对应该专业任务实际通过审查；正常阶段暂停不是失败。初次缺少上游产物时返回阻塞及所需阶段，由总 Agent 在已有授权范围内顺序补齐。

生成保留为制作工作流工具，复用现有关键帧和视频审查、任务 ID 与下载恢复，不强行把每个确定性处理包装为 Agent。

### 3. 项目级会话先于运行，文件仍是唯一业务依据

在已有 project.json 同级新增 session.json：version、revision、messages、active_book_id、active_page_id、active_run、goal、pending、tool_results 和授权范围。首版每个项目一条活动会话，不建设会话列表管理。

pending 仅表示等待用户、画布回执或中断的具体任务；工具结果保存摘要和产物引用，不重复存整份业务内容。消息有稳定 id，工具调用有 call_id，保存开始／结束结果。项目会话和运行继续使用现有文件锁；会话不持有运行锁跨越等待用户或前端回执。

模型只读近期消息、当前目标、待答问题、有效产物摘要、可操作节点；图片按需读取选定页面。用户授权的文件由 Electron 导入入口绑定；模型只使用书籍／页面／运行 ID，由工具解析路径，不自行扩展读取范围。

旧 canvas.json 中的 messages 首次使用 Agent 时按原 ID 导入会话一次，保留原文件；已有 prompt 保留为初始创作要求。节点布局继续保存在 canvas.json，不把会话复制到每个运行造成分叉。

### 4. 整本导入与选页

新增 `preprocessing/import_manga.py`，提供单页、MOBI、PDF、CBZ 明确解析分支。本机未安装 Calibre，实施选择显式安装的 mobi 0.4.1／KindleUnpack CLI（GPL-3.0-only，独立进程调用、不复制源码），按导出 OPF spine 与 HTML 的阅读顺序解析页面图像，不能按解包文件字典序假定页序；PDF 逐页本地渲染；CBZ 以有效图片自然顺序排序。已验证 mobi 导出 OPF spine，PDF 固定使用 pypdfium2 5.x，不预建多个解析后端。

来源保存在项目 sources/book-id 下，包含 book.json、pages/、thumbnails/。book.json 记录原文件指纹、解析版本、页面稳定 ID、1-based 文件页序和项目内页面路径。索引完成后才报告导入成功；原文件不改动。解包只接受落在目标目录内的条目，禁止路径穿越，排除非页面资源，损坏或加密输入清楚报错。

用户选页后创建已有运行结构，并保存书籍／页面引用；单页直接选定。整本默认只提取和展示缩略图，不整本发送给模型。已选页由真实整页进入 MAGI，随后沿用纵向单格 → 镜头编排结构。

### 5. 画布命令采用完成回执，不长期占用子进程

视图命令固定为 select、focus、layout、open_details，参数只含可用节点 ID 和经过校验的位置。前端 `canvasCommands.ts` 通过 React Flow 实例执行，完成后返回结果。命令携带 call_id、project/session revision、run ID 和页面 ID，执行前检查上下文仍匹配。

当前 JSONL 单请求 stdin 已关闭，因此不在 Python 里同步等待反向输入。Agent 要执行视图操作时保存 pending，返回结构化 `canvas_command` 并结束当前请求；前端应用命令、取得实际结果后通过 `agent_continue` 新请求回传。Python 核对 call_id 和上下文、记录结果，再继续循环。失败也进入工具结果，不在成功回执前声称已控制画布。重开应用不自动重放未确认命令，用户继续时先读取现状。

业务工具成功后发已有 artifact 事件，前端刷新 RunData 并重建节点，沿用保存的位置。内容修改和手动编辑共享来源修订／fork_canvas／规划工具；不开放通用改节点文本工具。

### 6. IPC 与会话执行

扩展现有命令白名单：agent_message、agent_continue、agent_select_page、read_session；增加必要事件类型（assistant、tool、question、canvas_command），同时更新 Python、Electron parser 和 TS 类型。保留 started、stage、artifact、completed、failed 的终态语义。全局对话消息和页面选择按钮最终调用同一 select_page 工具；点击选页使用 agent_select_page 确定性执行，不增加一次模型调用。

Engine 的活动任务键使用项目会话／运行绑定，阻止两轮消息或按钮与 Agent 同时修改。发送按钮显示对话模型可能计费；进行中的制作阶段仍展示真实事件，可停止。长任务执行期间接受用户输入为草稿，用户停止后再明确发送，不建设后台消息调度器。

### 7. 付费授权与恢复沿用已有边界

工具执行器从用户明确请求或 UI 操作记录授权，授权绑定项目、页面、任务种类及配置；模型不能给自己授予许可。导入、读取、画布操作和 MAGI 不产生制作费用，消息入口说明 Agent 模型本身计费。明确要求完整制作时允许在授权范围内顺序执行；单纯“打开”“看看”不授权规划／生图／视频。需要新增制作范围时提供简短执行摘要等待决定，不逐工具重复确认。

生图／视频前继续实际配置校验，H3 Lite 在渠道不可用则返回 blocked，保留现状。仅记录工具开始不能证明远端未提交；中断恢复优先读取原阶段和 task_id，未知提交状态保留原有需核查语义，不重新提交。

## Risks / Trade-offs

- [整本提取页序与封面处理差异] → 用现有 MOBI 的封面、相邻页及选中页做人工对照，UI 明确文件页序，不承诺自动匹配印刷页。
- [原规划是整体循环，独立阶段可能破坏缓存] → 基于现有 pause_after/from_stage 做最小入口，验证上游签名和局部修订，不重写总流水线。
- [结构化 JSON 渠道返回不稳定] → 沿用现有解析、校验与有限网络重试；非法动作清楚失败，不以固定脚本或换模型兜底。
- [全书和历史消息过大] → 缩略图分页展示、上下文摘要、按需页面图像；不自动扫描全书内容。
- [会话和 UI 回执中断] → 保存带 ID 的 pending 与工具结果，继续时核对真实内容和上下文，不重放付费动作。
- [OCR 草稿仍有错误] → 保留现有检查分格入口和不确定标注，Agent 不把本地 OCR 当作已确认台词。

## Migration Plan

1. 新能力添加于现有桌面入口旁，先完成真实文件导入和专业任务适配。
2. 接入会话与模型循环后，将首页和画布发送按钮统一路由到 Agent；原阶段按钮保留，调用同一工具入口。
3. 旧项目按需增加 session.json 和书籍引用，不批量改写已有运行、签名或成片。
4. 本地验证导入→询问→选页→MAGI→画布聚焦；使用已配置模型验证一次专业任务与审查，明确记录调用费用和未验证阶段，不默认重跑付费视频。
5. 如新入口不可用，可继续使用原手动按钮；既有数据和制作流程保持可用。这是保留原入口，不增加自动运行时回退。
