## Purpose

成片导出分辨率可配置：默认跟随生成素材实际分辨率，避免低分辨率素材被强制上采样；显式档位按 16:9 推导统一画布。

## ADDED Requirements

### Requirement: 导出分辨率配置

系统 MUST 提供 `EXPORT_RESOLUTION` 配置，取值为 source（默认）或 480P／720P／1080P；组装目标画布 MUST 按配置推导：source 跟随首个片段实际尺寸，显式档位按 16:9 推导并取偶。

#### Scenario: 默认不放大

- **WHEN** 480P 素材以默认配置组装成片
- **THEN** 导出画布为素材实际尺寸，不强制放大到 720P。

#### Scenario: 显式档位

- **WHEN** 配置 720P 后组装
- **THEN** 导出画布为 1280×720，片段按比例缩放并补边。

### Requirement: 配置随运行快照

生成与 assemble 命令 MUST 使用运行目录 config.json 记录的同一配置；缺少新字段的旧运行取默认值。

#### Scenario: 旧运行重组装

- **WHEN** 对不含 export_resolution 的旧运行执行 assemble
- **THEN** 按默认 source 推导画布。
