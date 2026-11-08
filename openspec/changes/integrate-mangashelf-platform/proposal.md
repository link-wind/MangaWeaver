# 提案：接入 MangaShelf 平台（素材导入与成片发布回传）

## Why

MangaShelf 平台（独立 Java 后端项目）已开放接入协议 v1（平台仓库 docs/api/mangaweaver-integration.md）：
scope Token、素材导出、成片发布回传。接入后用户可以把平台上的漫画素材导入本地创作，
成片经用户确认发布回平台，在网站上观看并定位原作——补全项目闭环中创作侧的出口
（对应平台仓库 openspec/changes/implement-mangaweaver-integration）。

## What Changes

- 新增 `shelf_client.py`：协议 v1 的最小 HTTP 客户端（requests），不含桌面 UI 集成。
- CLI 新增两个子命令（不走运行锁与 run_dir 机制，纯网络工具）：
  - `mangaweaver shelf-export`：导出指定章节版本页面，逐页下载并核验 SHA-256，
    落盘输出目录与 `mangashelf_manifest.json`（保存平台与页面来源，协议 17.2）。
  - `mangaweaver shelf-publish`：把本地成片回传平台——创建发布草稿（按键幂等）→
    预签名上传视频（可选字幕）→ 平台 ffprobe 验证 → 用户确认发布 → 输出回执
    （animation_id / revision_id / watch_url，协议 17.3）。
- 不改动既有三阶段命令、生成链路与本地素材格式；平台来源 ID 随清单保存，
  供未来时间轴映射与来源追溯使用。

## Capabilities

### New

- `shelf-platform-bridge`：以平台 Token 调用导出与发布回传协议的最小客户端能力。

## Impact

- 影响：src/mangaweaver/shelf_client.py（新文件）、cli.py（新增两个子命令分发）。
- 不影响：平台仓库、既有预处理/规划/生成行为；模型 Key 不传给平台（协议边界）。
- 风险：网络失败需显式报错并保留已下载产物；Token 由用户自行保管，不写入仓库。
