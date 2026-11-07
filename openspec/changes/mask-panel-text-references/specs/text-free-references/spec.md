## Purpose

关键帧生成的来源参考不携带原作文字：自动预处理的 OCR 词框用于生成去字参考图，生图模型不再把气泡文字复现进画面，同时保持所有阅读链路使用原图。

## ADDED Requirements

### Requirement: 去字参考生成

自动预处理 MUST 在存在 OCR 词框时为每个漫画格生成遮罩参考图（词框外扩 2px 填白），记录于 `Panel.masked_image`；无词框的格 MUST 不生成，遮罩保持缺省。

#### Scenario: 有词框的格

- **WHEN** 自动预处理使用 rapidocr 并检测到文字框
- **THEN** 相交格获得裁剪到格内坐标的 text_boxes，并在 source/masked/ 下生成去字参考。

#### Scenario: 无词框的格

- **WHEN** 格子没有文字或使用 MAGI 路径（无坐标）
- **THEN** 不生成遮罩参考，生图媒体沿用原图。

### Requirement: 生图参考替换

关键帧生成 MUST 优先使用去字参考作为来源媒体；脚本、编排、演出与分镜审查 MUST 继续使用原图。

#### Scenario: 生图输入无文字

- **WHEN** 关键帧候选生成的来源格存在去字参考
- **THEN** 生图媒体使用去字参考，载荷与输入签名随之记录。

### Requirement: 旧清单兼容

text_boxes 与 masked_image MUST 为可选字段；masked_image 声明但文件缺失时加载 MUST 显式报错。

#### Scenario: 旧清单加载

- **WHEN** 加载不含新字段的既有清单
- **THEN** 解析成功，行为与现状一致。
