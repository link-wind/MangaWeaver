## Why

审查确认原图文字泄漏只有一道软防线：关键帧生成的参考图就是含气泡文字的原漫画裁格，防泄漏仅靠提示词"不要绘制气泡"和分镜审查事后挑错，无任何去字手段。审查能发现问题但无法预防，重生成即重复花费。自动 OCR（rapidocr 路径）已产出词级坐标，目前只保留文本、丢弃框坐标。

## What Changes

- `Panel` 增加 `text_boxes`（裁格内相对坐标的文字区域）与 `masked_image`（去字参考图，可空）两个可选字段；旧清单不受影响。
- rapidocr 路径把页面级 OCR 框裁剪进相交格的裁剪坐标并持久化；MAGI 路径无坐标，维持原状不遮罩。
- 新增确定性遮罩步骤：预处理时按词框外扩 2px 填白，写入 `source/masked/<panel_id>.png`；无词框的格不生成。
- 关键帧生成（storyboard.create）的来源媒体改用去字参考（无则原图）；脚本、编排、演出与分镜审查等需要阅读文字的阶段继续使用原图。
- `load_source` 解析并校验去字参考文件存在性；遮罩为白色矩形填充，属于第一版主路径，效果以真实页面验证为准。

## Capabilities

### New Capabilities

- `text-free-references`: 关键帧生成参考图的文字遮罩。

### Modified Capabilities

无。`implement-mangaweaver-mvp` 声明的 manga-preprocessing 规格尚未归档合并，不在此重复声明。

## Impact

修改 `src/mangaweaver/schemas.py`、`preprocessing/transcript.py`、`preprocessing/character_description.py`、`planning/storyboard.py`，新增 `preprocessing/mask_text.py` 与单元测试。新清单包含新字段，旧运行加载不受影响；重新预处理会改变来源签名，需按既有约定使用运行目录。不改变脚本理解、审查阅读与付费提交边界。
