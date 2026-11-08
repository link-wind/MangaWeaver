# 本地生成产物

整理日期：2026-11-07。这里只保留真实生成产物、它们依赖的来源文件和必要的运行记录。

## 已有成片

| 运行 | 主要文件 | 说明 |
| --- | --- | --- |
| `iruma-static-ja-10s/` | `final.mp4`、`final_clean.mp4`、`final.srt` | 约 10.1 秒，静态对话场景；保留原音轨、中文字幕及原审查记录 |
| `paid-e2e-20261027/runs/page012/` | `final.mp4`、`final_clean.mp4`、`final.srt` | 约 13.4 秒，公开演示视频的来源；所属项目只登记这条有效运行 |

## 完整预览

以下视频已经生成且可读取，但原记录未通过完整质量审查。保留用于查看已有结果，不把预览改成正式成片或伪造审查通过。

| 运行 | 主要文件 |
| --- | --- |
| `iruma-page044-flash38-12s/` | `preview_with_audio.mp4`；`preview.mp4` 是此前静音导出 |
| `iruma-page091-ja-20s/` | `preview.mp4`、`preview_clean.mp4`、`preview.srt` |
| `iruma-dialogue-page094-ja-20s-6panels/` | `preview.mp4`、`preview_clean.mp4`、`preview.srt` |
| `iruma-dialogue-page094-ref15s/` | `preview.mp4`、`preview_clean.mp4`、`preview.srt`；整张故事板参考实验 |

## 来源与运行依赖

- 用户的整本漫画、提取页面及原始分格仍在 `assets/manga/`，没有改写或删除。
- `book-stage-lazy-validation-20261027/runs/9dd2d9296822/source/panels/` 仅保留 4 张被正式演示的计划直接引用的裁图。该目录里的验收、失败记录和重复书籍副本已经清理。保留原路径是为了不修改已有计划签名和来源记录。
- 保留所用的计划、关键帧、输入签名、当前视频任务状态、字幕、审查结论及用量摘要。已提交视频的任务 ID 仍可追踪。
- 早期 UI 测试后来追加的失败页、整本书副本和测试会话已移出；现有项目索引只登记保留的真实运行。
- `examples/creative-demo/` 是客户端演示所需的固定素材，仍完整保留。`results/simulations/` 中的旧回放可以删除，客户端会在用户主动体验时创建新的独立回放。

本次移出内容及修改前的项目索引临时保存在 `/tmp/mangaweaver-results-cleanup-20261107/`，包含恢复清单。此处不保存密钥、原始接口响应或截图式清理报告。
