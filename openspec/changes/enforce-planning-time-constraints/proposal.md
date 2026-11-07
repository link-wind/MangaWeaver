## Why

审查实证了三处规划期约束缺失：对白"说话人不确定写 null"的约定与声音计划校验正面冲突，构成确定性死锁，且失败发生在关键帧图片已付费之后；H3 每段 4～15 整数秒的后端限制只在生成期校验，静态镜头 3 秒、4.5 秒或动作锚点差 5.5 秒都能通过全部规划校验后烧掉图片费用；镜头顺序校验游标取镜头最小来源格索引，交错覆盖（镜头一覆盖第 1、3 格、镜头二覆盖第 2、4 格）与嵌套覆盖不被拦截，动画会先呈现后格事件。另外镜头总时长只在编排候选生成时单点强制，恢复与生成路径不复查。

## What Changes

- 脚本阶段完成后阻断存在未确定说话人的对白，进入既有草案反馈循环要求归属；脚本 Creator 提示词同步要求为每句对白归属确定说话人并把推断依据写入 uncertainties。
- 静态镜头时长与动作镜头相邻锚点时间差在 `check_source`／`check_shot` 中强制 4～15 整数秒；段长常量与载荷规则文本收敛到 schemas 单一来源，生成客户端校验与四处提示词载荷改用同一常量。
- 镜头顺序游标改用前一镜头最大来源格索引：拒绝镜头间交错与嵌套覆盖，仍允许同格拆分与共享格接续。
- 目标时长配置大于零时，规划完成、恢复检查点与视频任务构建三处复查镜头总时长。

## Capabilities

### New Capabilities

- `planning-time-integrity`: 规划阶段的时间与对白可生成性约束，违规在图片费用支出前被拒绝并明确报告。

### Modified Capabilities

无。`implement-mangaweaver-mvp` 声明的 shot-planning／video-production 规格尚未归档合并，不在此重复声明。

## Impact

修改 `src/mangaweaver/schemas.py`、`planning/pipeline.py`、`planning/shot_arrangement.py`、`planning/arrangement_review.py`、`planning/shot_direction.py`、`planning/direction_review.py`、`generation/pipeline.py`、`clients/minimax.py` 与 `prompts/planning/script/create.txt`；新增约束探针测试。历史运行中含不合规静态时长或未确定说话人对白的草案在显式重跑时会被拒绝并明确报错，不自动迁移。不改变模型渠道、候选数、付费提交边界与既有反馈轮次配置。
