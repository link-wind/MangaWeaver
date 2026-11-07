## 设计决定

### 拆成"redo 提交"与"generate 恢复"两段，而不是一个长命令

redo 命令只做：校验 → 归档 → 记录反馈 → 重新提交（付费点在此，命令本身即显式确认）。轮询、下载、评审沿用 `generate` 既有恢复语义：已提交段不重复付费、已下载段直接用、评审按缓存。这样 redo 不需要复制轮询与评审逻辑，中断恢复也走同一条路。

### 用"归档"而不是删除来处理失败候选

候选文件改名 `<cid>.rejected-<轮次>.mp4`，条目移入 tasks.json 的 `superseded` 列表（保留远端 task_id 供平台核对费用）；失败评审移为 `review.rejected-<轮次>.json` 并删除其输入签名文件与 `selected.json`。评审载荷加入修订反馈后输入签名变化，若保留旧 review.json 会命中 cached_json 的"已有产物输入不同"硬错误——归档移走后即全新评审。

### 反馈经载荷进入评审，轮次自然失效

`video_review.select` 增加可选 feedback 参数进入载荷：签名变化使缓存失效，Reviewer 同时看到结构化反馈。评审通过后 redo.json 删除；再次失败可再次 redo（新反馈文本再次改变签名）。无反馈的重提（纯换候选）也走同一通道（feedback 为空串）。

### assemble 只重建，不评审

从磁盘 `selected.json`（含评审的 heard_cues）与 `dialogue/selected.json` 的声音计划重建每段字幕轨，镜头组装与成片导出复用从 pipeline.run 抽出的同一收尾函数，保证两条路径产物形状一致。缺少任何段的已选画面即报错，不做部分成片。

### 桌面入口直接执行，不走 Agent 任务协议

redo／assemble 与 resume 一样属于维护动作；resume 当前经 agent_run_stage 记录任务，redo 的提交事件（video.submitted 等）已通过引擎事件流直达 UI，第一版不再扩展 Agent 任务模型。付费按钮沿用既有"付费"标注约定。
