## Why

审查确认跨镜头画面一致性没有图像级锚点：`pipeline.py` 在每个镜头循环重置参考列表，分镜生成只拿到当前镜头来源格、角色参考和本镜头前序锚点；提示词要求"场景颜色优先沿用已有彩色关键帧"，但该关键帧根本不在生成输入里。跨镜头的色调、光照与角色状态延续只靠文字约束，事后仅有视频审查把关，发现问题时关键帧已全部生成，修复需整段重做。

## What Changes

- 规划在生成每个镜头的第一张关键画面时，把前一镜头已选关键帧的最后画面作为跨镜头衔接参考传入生图输入；第二张起由本镜头前序锚点承接，不重复传入。
- 分镜 Creator 与 Reviewer 的载荷与媒体列表增加 `previous_shot_final_image` 字段；Creator 提示词说明参考其光照、色调与角色状态但不复制姿态，Reviewer 提示词增加镜头间衔接检查。
- 衔接参考进入既有输入签名（media 签名与载荷签名），换参考自然形成新缓存条目；不改变 plan_signature（设计身份仍由 script+shot+direction 决定）。

## Capabilities

### New Capabilities

- `cross-shot-continuity`: 相邻镜头关键画面生成的衔接参考传递与审查。

### Modified Capabilities

无。`implement-mangaweaver-mvp` 声明的 shot-planning 规格尚未归档合并，不在此重复声明。

## Impact

修改 `src/mangaweaver/planning/pipeline.py`、`planning/storyboard.py`、`planning/storyboard_review.py` 与 `prompts/planning/storyboard/create.txt`、`prompts/planning/storyboard/review.txt`；新增单元测试。进行中运行的旧分镜候选缓存因输入签名变化会要求显式重跑分镜（既有"旧分镜输入不一致"行为，不静默复用）；生成输入变化需要一次真实页面生图验证衔接效果。不改变候选数、付费提交边界与 plan_signature 语义。
