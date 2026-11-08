# 任务：接入 MangaShelf 平台

- [x] shelf_client.py：协议 v1 客户端（Bearer、exports、publications、上传、轮询）
- [x] shelf-export 子命令：导出页面 → 逐页 SHA-256 核验 → 落盘 + 清单；摘要不符显式报错
- [x] shelf-publish 子命令：发布键幂等草稿 → 预签名上传视频/字幕 → verify → 轮询 READY →
      publish → 回执（animation_id / revision_id / watch_url）保存 receipt.json
- [x] cli.py 分发（绕过 run_dir/运行锁；--platform/--token 显式传入，不落 Config）
- [x] 真实端到端一次：对平台完成一次导出（摘要核验通过）与一次成片发布回传（回执可查询）
