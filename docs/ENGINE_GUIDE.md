# 引擎使用指南与历史验证记录

原 README 的详细配置、命令和阶段验证记录。部分条目描述早期状态；当前项目入口与能力边界以根目录 README 为准。

# MangaWeaver

从漫画分镜到连贯动画：先编排镜头，再确定漫画关键瞬间在时间中的位置。

首版采用三阶段本地 Python 工作流，以 [Manga2Animate](https://github.com/annchenn/Manga2Animate) 为参考。第二阶段增加镜头编排与动作镜头演出，其他环节保持其 Creator／Reviewer、候选比较和有限反馈循环的思路。参考版本、许可情况和 H3 接口证据见 [REFERENCE](REFERENCE.md)。

## 当前实现

1. **预处理**：MAGI 分格与阅读顺序，本地 OCR 显式选择 MAGI 或 RapidOCR；也可直接导入已经准备好的有序漫画格。
2. **规划**：来源脚本与审查 → 镜头分类／编排与审查 → 动作演出与审查 → 视觉分镜与审查。问题按脚本、编排、演出、画面归属反馈到下一轮。
3. **生成**：静态镜头用单首帧；动作镜头用相邻首尾帧分段生成。MiniMax H3 视频候选经评审后连接，动作镜头另做整镜接缝和节奏审查，最终导出 1280×720、24 fps 有声版，保留原始候选。当前原始生成默认 480P，导出到 720P 仅为统一文件规格，不代表细节提升。

漫画格、动画镜头、关键帧、生成段分别编号。多个漫画格可以合成一个镜头，同一漫画格也可以支持多个镜头。动作镜头的原漫画瞬间可以位于中段或末段。

**验证范围**：已通过两个本地协议样例、3 项关键逻辑测试、命令与打包资源检查、FFmpeg 拼接检查，详情见 [验证记录](archive/validation-2026-10/VALIDATION.md)。已完成一次真实 H3 首尾帧单段生成、查询与下载；已完成 Kie 来源脚本 JSON、两图参考生图和完整视频评审接口实测；尚未完成整套规划循环、Lite 真实生成、两段接缝、真实漫画动画质量验收；示例图为原创线条示意，人工计划仅用于验证数据与任务协议。

本地预处理已完成真实漫画单页离线实测：6 格、逐格中文 OCR 草稿、整页来源与桌面事件链路，详情见 [本地预处理](LOCAL_PREPROCESSING.md)。

## 安装

需要 Python 3.12+、`uv`，视频组装需要系统可执行的 `ffmpeg` 和 `ffprobe`。

```sh
uv venv --python 3.12
uv pip install -e .
cp .env.example .env
.venv/bin/mangaweaver --help
```

自动分格和 OCR 另装重依赖；使用清单导入时无需安装：

```sh
uv pip install -e '.[preprocessing,local-ocr]'
# 中文漫画使用本地 RapidOCR；不设置则沿用 MAGI OCR
# .env 中设置 LOCAL_OCR_PROVIDER=rapidocr
```

当前选择幻灵渠道，在 `.env` 分别配置三组密钥：

```dotenv
MODEL_PROVIDER=huanling
IMAGE_PROVIDER=huanling
VIDEO_PROVIDER=huanling
VIDEO_UPLOAD_PROVIDER=uguu
HUANLING_BASE_URL=https://ai.huanling.icu
HUANLING_API_KEY=规划与评审分组密钥
HUANLING_IMAGE_API_KEY=生图分组密钥
HUANLING_VIDEO_API_KEY=视频分组密钥
TEXT_MODEL=gemini-3.8-flash
VIDEO_REVIEW_MODEL=gemini-3.8-flash
IMAGE_MODEL=gpt-image-2
IMAGE_SIZE=1536x864
IMAGE_QUALITY=low
MINIMAX_BASE_URL=https://ai.huanling.icu
MINIMAX_MODEL=MiniMax-H3-Lite
MINIMAX_RESOLUTION=480P
```

Gemini 继续负责脚本与评审，GPT Image 通过 OpenAI 兼容的 `/v1/images/edits` 接收漫画及前序帧参考；无参考图时才使用 `/v1/images/generations`。使用 16:9 尺寸，不自动裁图。同步请求保存状态，不自动重复收费。渠道的模型列表不代表实际请求成功，详见验证记录。

**幻灵实测明确拒绝 H3 Lite，只支持标准 MiniMax-H3。** 默认 Lite 配置仍会阻止视频调用。用户明确允许标准版时，可以在本次命令中显式设置 `MINIMAX_MODEL=MiniMax-H3 MINIMAX_RESOLUTION=768P`，并使用新运行目录。幻灵 V2 入口要求公开 HTTPS 图片地址，显式选择 `VIDEO_UPLOAD_PROVIDER=uguu` 可匿名临时托管生成关键帧，文件按 Uguu 公开规则约 3 小时后删除；上传后匿名下载并核对图片哈希。也可显式选择 `kie`，此时需要 `KIE_API_KEY` 并受其上传配额限制。生成仍由幻灵执行，模型密钥不会发送给 Uguu。三组幻灵密钥及 Kie 凭据只存 `.env`。

Gemini 规划／评审对明确的 429、500、502、503、504 最多尝试 5 次，保留次数与耗时；没有自动更换模型或渠道。图片、视频创建不自动重复提交。

历史 Kie 渠道仍可显式选择 `MODEL_PROVIDER=kie`，搭配 `KIE_API_KEY`、`IMAGE_PROVIDER=`、`IMAGE_MODEL=nano-banana-pro`；视频官方渠道需显式设置 `VIDEO_PROVIDER=minimax`、`MINIMAX_API_KEY` 与对应 `MINIMAX_BASE_URL`。旧渠道不会自动启用。

如需原生 Gemini，显式设置 `MODEL_PROVIDER=gemini`，配置 `GEMINI_API_KEY` 或 `GOOGLE_CLOUD_PROJECT` 和应用默认凭据，并将模型 ID 改回该渠道可用的名称（例如原实现的 `gemini-3.1-pro-preview`、`gemini-3-pro-image`）。不自动切换供应商或模型。

配置从当前目录 `.env` 读取；也可在子命令前使用 `--env-file /绝对路径/.env`。已有环境变量优先。配置快照不含凭据；`.env`、虚拟环境和 `results/` 不提交版本控制。

独立生图渠道可在 `.env` 显式设置 `IMAGE_PROVIDER=ciyuan`、
`IMAGE_MODEL=gemini-nano-banana-2.1` 和 `CIYUAN_IMAGE_API_KEY`，其余规划和评审继续用 Kie。
如需将规划和评审也显式切到词元，设置 `MODEL_PROVIDER=ciyuan` 和独立的
`CIYUAN_API_KEY`，`TEXT_MODEL`／`VIDEO_REVIEW_MODEL` 使用该 Key 可调用的模型 ID。
词元客户端发送原生 Gemini 多模态请求、JSON Schema 并执行本地结构校验；
文本／图片评审与视频评审的实际验证范围见 `docs/archive/validation-2026-10/VALIDATION.md`，不自动退回 Kie。
词元使用 `/v1beta/models/<model>:generateContent`，参考图以内联图片发送，固定生成 16:9、1K。
同步收费请求只提交一次；中断或失败保留状态，恢复时不自动重复收费。
`TARGET_DURATION=12` 可要求编排总时长恰好 12 秒；默认 0 表示不限定。
词元余额接口的 `unit=USD` 是平台返回单位，实际人民币成本需核对充值兑换比例。

## 无密钥检查两个案例

```sh
.venv/bin/mangaweaver preprocess \
  --manifest examples/cross-panel/source.json \
  --run-dir results/local-cross-panel

.venv/bin/mangaweaver generate \
  --plan examples/cross-panel/production.json \
  --run-dir results/local-cross-panel --dry-run

.venv/bin/mangaweaver generate \
  --plan examples/key-moment/production.json \
  --run-dir results/local-key-moment --dry-run
```

`--dry-run` 读取选定计划、验证图像和 H3 时长限制，保存 `generation_tasks.json`；不创建模型客户端，也不提交生成任务。这两个例子的评审是明确标注的人工协议检查，不能证明模型审查或视频生成已经完成。素材和预期结果见 [examples](../examples/README.md)。

## 使用真实素材

已有分格时准备 `SourceManifest` JSON，格式见 `examples/cross-panel/source.json`。`panels` 列表就是阅读顺序；`panel_id` 必须唯一。图像路径相对清单文件，人物描述、参考图和可检查文本可一并提供。缺少角色描述时，规划阶段调用所选模型客户端补充。

```sh
.venv/bin/mangaweaver preprocess --manifest /素材/source.json --run-dir results/scene01
.venv/bin/mangaweaver plan --run-dir results/scene01
.venv/bin/mangaweaver generate --run-dir results/scene01 --dry-run
.venv/bin/mangaweaver generate --run-dir results/scene01
```

也可让 MAGI 自动处理页面，按阅读顺序重复 `--page`：

```sh
.venv/bin/mangaweaver preprocess \
  --page /素材/page01.png --page /素材/page02.png \
  --reference /素材/characters.png --case scene01 --run-dir results/scene01
```

自动预处理使用固定版本的 `ragavsachdeva/magi` 模型代码和权重，首次下载后可离线运行；设备默认 CUDA 可用时使用 CUDA，否则 CPU，可用 `--device` 明确指定。页面顺序由用户给定，页内排序使用 MAGI。`--ocr-backend rapidocr` 或 `.env` 的 `LOCAL_OCR_PROVIDER=rapidocr` 显式启用中文 OCR，结果保存到各格 `text` 和总 `transcript`，标为待核对草稿；不会自动更换 OCR 后端。已有运行不接受静默更换输入。

默认各环节只生成 1 个候选：脚本、编排、演出、每张关键画面和每段视频均为 1。Reviewer 仍检查唯一结果；规划最多 2 轮，仅按反馈修订必要内容，不预先批量生成备选。图像数量和视频段数会随编排增加，请在视频提交前查看 dry-run 产物。

## 检查结果与继续

```text
results/scene01/
├── config.json                 # 有效配置，不含凭据
├── source/                     # 输入、文字、角色和准备结果
├── iter0/                      # 各组候选、评审与选定方案
├── planning_state.json         # 已形成完整素材的一轮
├── planning_draft.json         # 被审查阻断的阶段草案，可显式修订，不是生产计划
├── production.json             # 所有必要评审通过后才发布的计划
├── generation_tasks.json       # 来源、镜头、关键帧与视频段的对应关系
├── video/<shot>/<segment>/     # task_id、请求时长、实际时长、候选与评审
├── final.mp4                   # 完整镜头齐备且最终文件可读才导出
├── export.json                 # 计划指纹、顺序、目标与成片实际时长
└── log.txt
```

中断后可显式继续同一规划，或指定阶段开始新的修订轮次：

```sh
.venv/bin/mangaweaver plan --run-dir results/scene01 --resume
.venv/bin/mangaweaver plan --run-dir results/scene01 \
  --from-stage arrangement --feedback '合并同一传球事件，保留结尾反应镜头'
```

阶段可选 `script`、`arrangement`、`direction`、`storyboard`。新轮次保留旧候选与评审；开始修订时撤下旧 `production.json`，待通过后重新发布。若修订影响已经提交的视频，使用新运行目录生成，并通过 `--plan` 指向修订后的计划，不混用旧任务。

再次执行相同 `generate` 命令会继续保存的任务 ID，不重复提交。创建请求中断且未拿到 ID 时，系统保留 `submitting` 状态并报错，需要在平台核对实际任务、将 `task_id` 补入对应 `tasks.json` 后继续。配置、来源或素材指纹变化会报错，使用原输入继续或新建运行目录。

## 当前边界

- H3 Lite 官方 V2 支持 `first_frame`／`last_frame` 端点图，每段必须为 **4～15 整数秒**，默认生成 `480P`（Lite 另支持 `768P`，不支持 `2K`）。原漫画关键帧在 4 秒、镜头长 8 秒时，会生成两个 4 秒段；更短的节拍需要重新考虑生成方案。
- 首尾图需要同尺寸、16:9。渠道若只返回 1 像素高度差，会在 video_frames/ 保存复制底部边界一行的派生图和来源记录，原评审图不变；其他尺寸差仍报错。不自动裁切、缩放构图、加速或拉长时间来消除计划与接口冲突。
- 共享关键帧不保证接缝的速度连续。完整动作镜头评审失败会停止并保存结果，首版不做自动上游重规划和运动修复。
- 只在相邻段的实际边界帧像素完全相同时删除一张重复帧；跨镜头直接 cut，不默认叠化。
- Kie 对话中的图片和完整视频通过上传后的 URL 发送，图像生成使用提交／查询／下载的异步任务。原生 Gemini 仍以内联媒体发送。首版以小场景为主。
- Kie 文档未确认原生 JSON Schema 强制约束；代码在提示中提供 Schema，并用 Pydantic 校验。仅允许去掉完整 Markdown JSON 围栏，不截取或修复错误内容。
- 首版不做模型训练、latent prefix、长程历史记忆或独立配音／混音系统。保留并拼接 H3 原生音轨；生成要求同步环境声、动作音效及与当前镜头匹配的原作对白，不逐段生成背景音乐。缺失音轨时明确报错，不静默导出无声版。

## 开发与计划

```sh
.venv/bin/python -m unittest discover -s tests -v
openspec validate implement-mangaweaver-mvp --strict
```

目标见 [PROJECT_GOALS](../PROJECT_GOALS.md)，架构见 [ARCHITECTURE_DRAFT](ARCHITECTURE_DRAFT.md)，实施进度见 [OpenSpec tasks](../openspec/changes/implement-mangaweaver-mvp/tasks.md)。不建立通用 Agent 框架、数据库或插件层；业务模块直接调用。

## Kie.ai 专项检查与漫画素材

已完成一次来源脚本 JSON、一张两图参考关键画面及完整 MP4 视频评审的真实接口检查。详细消耗与范围见 [验证记录](archive/validation-2026-10/VALIDATION.md)。视频评审能返回未通过结果，不能以接口成功代替质量通过。

可用已生成的短视频重新运行检查（会产生 Kie 调用费用）：

```sh
.venv/bin/python examples/check_kie.py \
  --video /绝对路径/已有短视频.mp4 --run-dir results/kie-check-new
```

脚本使用两张原创示意参考图，不额外生成 H3 视频。漫画下载与实验素材入口见 [素材来源](MANGA_SOURCES.md)，包括 Pepper&Carrot、Manga109-s、Comic Book Plus 和 Digital Comic Museum。


当前幻灵 Gemini 3.8 Flash 已实测支持图片与完整视频输入。该渠道可能忽略原生 JSON Schema，因此通过提示词传入结构并执行本地校验；不把格式参数当作强制保证。规划按脚本、编排、演出审查逐层放行，再制作关键帧；被拒绝的图片不传给下一张。阶段草案保存为 planning_draft.json，可用 --from-stage 继续定向修订。演出 Reviewer 同时接收已审查来源事实和原图，避免丢失上游识别结果。

## 日语配音与中文字幕

生成前沿用 Gemini Creator／Reviewer 审查日语翻译、说话人和段内发声时间；H3 按官方格式演绎确定的日语台词。视频评审核对实际声音并提供字幕时间，后期导出 `final_clean.mp4`、`final.srt` 和带中文字幕的 `final.mp4`。

设置 `SUBTITLE_FONT` 为可读中文字体路径；提交视频前检查字体。示例：`SUBTITLE_FONT="/System/Library/Fonts/Supplemental/Arial Unicode.ttf"`。`--dry-run` 只构建未经对白准备的视频任务草稿，不调用 Gemini 或 H3；实际最终提示词在对白审查通过后记录到 `generation_tasks.json`。详见 [H3 提示词与字幕规则](H3_PROMPTS.md)。

## 最新整页测试

印刷页91的9格已编排为5镜头，选用6张关键帧，生成带原生声音、日语及中文字幕的22.333秒预览：`results/iruma-page091-ja-20s/preview.mp4`。它尚未通过质量验收：第二段新增语音／姿势跳变，第三段评审对即兴喊话的判定存在矛盾，末段主句盲听正确但第二句笑声未独立确认。修订过程实际生图12张，不能按选用的6张估算已发生费用。完整记录见同目录 `TEST_REPORT.json`。

连续对话页测试：第3话第94页实际6格（含极窄沉默反应格），编排4镜头，21.375秒，预览位于 `results/iruma-dialogue-page094-ja-20s-6panels/preview.mp4`。日语、声音及中文字幕已导出，独立盲听确认主要台词；第3镜头非计划切镜导致未验收通过，其他视线／有限动作表现限制见同目录 `TEST_REPORT.json`。

整套故事板参考模式已做独立对照：`results/iruma-dialogue-page094-ref15s/preview.mp4`，复用4张图、单次H3 `reference_image`请求，15.083秒，日语及中文字幕。它验证了幻灵这条入口可以完成整套参考生成；仍有递物视线、叠化和有限口型问题，未通过质量验收。该实验尚未加入正式CLI，不改变默认Lite480P，详情见同目录 `TEST_REPORT.json`。

## 桌面工作台

新增本地 Electron + React 工作台，可打开已有运行，检查漫画与关键画面、提交阶段反馈、跟踪与恢复任务、播放和导出视频。启动、环境设置和首版边界见 [桌面使用说明](DESKTOP.md)。Python CLI 仍可独立使用。

统一创作对话、整本漫画导入和画布操作见 [创作 Agent](CREATIVE_AGENT.md)。
