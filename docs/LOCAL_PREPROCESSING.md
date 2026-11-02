# 本地漫画预处理

## 使用

当前电脑已安装依赖并缓存权重，本地 `.env` 已明确设置 `LOCAL_OCR_PROVIDER=rapidocr`。

首页添加整页漫画并进入画布，点击“自动分格”。完成后画布展示按阅读顺序排列的单格；“检查分格”可校正裁框、顺序和文字。保存修订会创建新来源版本。角色描述和后续规划仍由原模型执行，自动分格不会调用 Gemini、GPT Image 或 H3。

其他环境安装：

```sh
uv pip install -e '.[preprocessing,local-ocr]'
.venv/bin/mangaweaver preprocess --page /素材/page.png --ocr-backend rapidocr --run-dir results/local-page
```

## 组成与产物

- MAGI：检测漫画格、排列阅读顺序，沿用参考项目算法。裁框限制在图片边缘内。
- RapidOCR 3.10.0 + ONNX Runtime：本地中文文字检测和识别，按位置和阅读顺序归入漫画格。
- `source/manifest.json`：有序裁图、坐标、逐格 OCR 草稿、总转录与不确定信息。
- `source/editor.json`：原始整页与可检查的裁框。
- `source/preprocessing.json`：实际 OCR 后端、MAGI 版本与页面来源。
- 桌面事件：加载模型 → 检测漫画格 → 识别文字 → 保存来源；完成后返回画布，不隐式开始付费规划。

默认 OCR 保留参考项目的 `magi`，中文素材可显式选 `rapidocr`。本机用中文漫画实测时，MAGI 自带 OCR 将中文误识为英文，因此选择 RapidOCR。没有自动降级或模型切换。

## 模型与依赖

MAGI 固定为 `ragavsachdeva/magi@15ad498ad45093ad3b833d625728220c6309ad99`，只使用 safetensors 权重。其 OCR 处理器固定为 `microsoft/trocr-base-printed@93450be3f1ed40a930690d951ef3932687cc1892`，缓存完整时不再请求网络。MAGI 完整检查点已含骨干权重，构造时不另外下载 ImageNet 权重。

Transformers 使用参考项目的 4.38.0，补齐 torchvision、matplotlib、scipy、networkx 等实际运行依赖。RapidOCR 使用安装包内的 PP-OCRv6 小模型。权重和 Python 环境位于本机，不包含在 Electron 安装包中。

## 验证（2026-10-26）

使用《入间同学入魔了》第 1 卷印刷页 94 的整页素材，执行真实模型推理，没有手工注入检测框。

- 通过桌面 JSONL 入口执行预处理，在禁止 socket 连接、Hugging Face 离线模式下成功完成。
- 得到 `p001`～`p006`，阅读顺序与原人工六格一致，裁图文件全部生成。
- 本次暖缓存 CPU 运行约 4.17 秒，付费 API 调用为 0；耗时会随机器与页面改变。
- 原始整页可读取，初始 prompt 正确绑定，阶段事件和来源产物均保留。
- 本地报告：`results/magi-desktop-offline-20261026/validation.json`。
- Python 14 项检查、桌面 3 项检查通过；`uv pip check` 通过。

OCR 已能识别主要中文对白，但仍有错字、艺术线条误识别、跨格气泡分配问题。例如本页“我…”可能按位置归入相邻反应格，“嗚”也存在错字；这些结果明确标为草稿，不能当作已确认台词。生成规划前需要在素材编辑器检查，后续原有 Creator／Reviewer 继续结合图像核对。
