## Why

审查确认两处可感知短板：导出滤镜硬编码 `scale=1280:720`，480P 生成的素材被强制上采样放大且模糊，用户不能选择原分辨率导出；H3 视频提交是最贵的环节却零记录，各渠道用量文件每轮覆盖写、跨 run 无汇总，引擎无法回答"这个 run 花了多少、提交了多少次"。

## What Changes

- 新增 `EXPORT_RESOLUTION` 配置（默认 `source` 跟随生成素材实际分辨率，可选 480P／720P／1080P 显式档位）；组装滤镜的目标画布按该配置推导，不再强制 720P。
- 成片收尾函数传入配置；`assemble` 命令从运行目录的 config.json 读取同一配置，两条路径一致。
- 新增只读 `usage` 命令：汇总运行目录内各 `*_usage.json` 的模型调用与词元数，扫描 `video/*/*/tasks.json` 统计每段提交次数（含归档的重提轮次）与请求时长，写入 `usage_summary.json` 并输出；不加运行锁，不调用模型。
- `.env.example` 补充 `EXPORT_RESOLUTION` 说明。

## Capabilities

### New Capabilities

- `video-export-config`: 导出分辨率跟随或显式指定。
- `usage-visibility`: 运行用量与视频提交次数的只读汇总。

### Modified Capabilities

无。`implement-mangaweaver-mvp` 声明的 video-production 规格尚未归档合并，不在此重复声明。

## Impact

修改 `src/mangaweaver/config.py`（纯增量字段）、`generation/assembly.py`、`generation/pipeline.py`、`cli.py`，新增 `generation/usage.py` 与单元测试，更新 `.env.example`。旧运行 config.json 缺新字段时取默认值 `source`；历史产物不迁移。桌面用量展示留待后续变更。
