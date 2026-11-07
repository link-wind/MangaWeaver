## 1. 导出配置

- [x] 1.1 Config 增加 export_resolution（默认 source）与取值校验
- [x] 1.2 assembly 目标画布按配置推导：source 跟随首段实际尺寸，档位按 16:9 推导
- [x] 1.3 生成收尾与 assemble 命令传入配置；.env.example 补充说明

## 2. 用量汇总

- [x] 2.1 新增 usage 汇总：模型调用、词元、每段视频提交次数与请求时长，写 usage_summary.json
- [x] 2.2 CLI usage 子命令，只读不加运行锁

## 3. 验证

- [x] 3.1 单元测试：目标尺寸推导、配置校验、汇总统计、真实 ffmpeg 双档位组装
- [x] 3.2 全量 Python 测试回归通过
