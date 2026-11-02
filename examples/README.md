# 两个协议诊断案例

本目录素材由 `build_diagnostics.py` 用 Pillow 原创绘制，允许随本项目使用、修改和分发。它们是线条示意，不是第三方漫画，也不是模型生成的分镜或动画。`production.json` 由人工编写，并明确标记为人工协议检查；不用它证明模型评审质量。

| 案例 | 来源与编排 | 预期任务 |
| --- | --- | --- |
| `key-moment` | 原格只表现球在半空中；补充入点、出点，将原瞬间放在 4 秒 | `k001→k002`、`k002→k003`，各 4 秒 |
| `cross-panel` | 准备和球在半空两格合成动作镜头，再接旁观者的静态反应格 | 两个 4 秒首尾帧段，再接一个 4 秒单首帧段 |

每例包含：`source.json`（导入清单）、`expected_shots.json`（期望编排）、`expected_direction.json`（时间锚点）、`production.json`（人工视觉计划）及 `images/`。

图片路径均相对 JSON 所在目录。关键帧签名绑定来源脚本、镜头和演出方案，图片签名绑定实际文件；修改示例后可在仓库根目录重新运行：

```sh
.venv/bin/python examples/build_diagnostics.py
```

本地检查命令见根目录 README。去掉 `--dry-run` 将真的提交付费生成并调用视频评审，前提是配置相应凭据；真实效果验收尚未完成。
