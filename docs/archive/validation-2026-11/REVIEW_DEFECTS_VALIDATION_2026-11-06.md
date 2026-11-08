# 审查缺陷修复与验收

日期：2026-11-06
OpenSpec：`fix-reviewed-engine-and-desktop-defects`

## 修复范围

以审查中已核实的问题为边界，保留现有 Python 阶段、Creator／Reviewer、JSONL 子进程和文件存储机制。参考 Manga2Animate 固定提交 `29543daacbf58c609c360bad840649b0de6b4866`；桌面锁、IPC 与关闭流程为本项目增量。

| 问题 | 最小修复与验证 |
| --- | --- |
| 候选状态文件被当作正式候选 | 完整匹配 `candidate_<数字>.json`，排除 task／response sidecar；候选检查覆盖混合文件目录 |
| 原地 Agent 自锁 | 同进程、线程、上下文与目录的调用链可重入；独立进程与线程仍竞争 flock |
| 草稿并发清理覆盖编辑 | 清理持运行锁，比较提交版本与文本；缺少版本或繁忙时保留草稿 |
| argparse 静默退出 | SystemExit 转为 JSONL failed；验证实际参数解析失败 |
| 模型解析被当作用户决策 | 模型响应失败进入执行错误；真正需要用户决策的路径保留 |
| 依赖“未通过”文案分类 | ReviewRejected 明确传递审查耗尽，普通执行错误继续失败 |
| 幻灵缺 Key 指错变量 | 明确提示 HUANLING_VIDEO_API_KEY |
| fork 仍依赖旧关键画面 | 哈希校验后复制到新运行 retained，保留审查来源，不复制视频任务；删除旧图后新图可用 |
| 客户端可能无限等待关闭 | 保存等待增加 3 秒上限；渲染故障与 before-quit 处理退出，活动任务提示保留 |
| 事件转发碰到已销毁窗口 | 检查窗口与 webContents；事件发送失败不终止本地制作 |
| 正常完成与停止竞态 | 已收到的终态优先；离线进程验证完成后停止仍返回已保存结果 |
| 协议错误遗留子进程 | 终止进程组；离线进程验证其子进程退出 |
| 清单越权授权 | hydrateRun 引用经已授权目录／文件及 realpath 检查；覆盖越界与符号链接 |
| 零字节媒体误报404 | 获取媒体时明确报错；已授权空文件 GET 返回422 |
| 死代码与一次性脚本 | 删除 accordion 与索引改写脚本，开启 noUnusedLocals 并清理死变量／导入 |
| 构建依赖漏洞 | 定向 minimatch override，重新 npm ci；本次 npm audit 为0 |

## 客户端验收发现的额外缺陷

第一次点击“体验演示”后，画布自动保存拒绝消息的 `created_at` 与 `references`，导致演示未启动。已按现有前端 CanvasMessage 协议补齐消息元数据字段，继续严格禁止未定义字段，没有改为放任任意字段。

在已有创作演示测试中加入“创建演示 → 保存画布 → 保留引用与时间 → 运行”的检查。修复后通过客户端继续演示，未再出现此验证错误。

## 自动检查

| 命令 | 结果 |
| --- | --- |
| `.venv/bin/python -m unittest discover -s tests` | 61项通过 |
| `desktop/` 下 `npm test` | 42项通过 |
| `desktop/` 下 `npm run pack` | TypeScript、Vite、Electron构建与macOS arm64打包通过 |
| `desktop/` 下 `npm audit --json` | 0个漏洞 |
| `openspec validate fix-reviewed-engine-and-desktop-defects --strict` | 通过 |
| `openspec validate --specs --strict` | 28个主规格通过 |
| `git diff --check` | 通过 |

提交前检查当前已跟踪与待提交文件，没有发现实际 `.env`、私钥文件或符合扫描规则的硬编码 Key；`results/` 与构建产物保持忽略。该检查是文件名与常见密钥模式扫描。

## 实际客户端

通过应用接口查看已打包客户端，确认页面来自安装包内 `app.asar/dist/index.html`，不依赖 Vite 开发服务。

- 退出旧进程，确认进程结束后启动新包。
- 从首页点击“体验演示”，进入独立本地运行 `results/simulations/5216c32c-3f21-415b-ad90-b299c97ea69b`。
- 观察分格、公开回复和协作活动逐步出现。
- 点击停止，看到“已停止本地执行，进度已保留，可继续运行”。
- 点击继续演示，恢复执行，进入视频审查预设暂停。
- 再次继续，看到“演示完成；历史素材回放，未调用模型”及5组协作记录。
- Cmd+Q 正常退出；最终重建后重新打开安装包，首页成功加载并留在前台。

全程不调用付费模型。审查暂停是演示中的预设结果，不表示本次新视频通过审查。关闭超时和渲染崩溃分支依据代码检查；本次没有人为破坏渲染进程来进行实机故障注入。

## OpenSpec 与版本保存

13个任务均完成的历史变更已同步主规格并归档到 `openspec/changes/archive/2026-11-06-*`。

以下历史变更仍有未验收事项，保持未完成，不以本轮修复代替原有验收：

- `implement-mangaweaver-mvp`：37/43
- `refine-creative-workbench`：22/24
- `refine-workbench-visual-design`：8/10
- `standardize-desktop-ui-components`：43/44，鼠标连续拖动仍需原场景验收
- `unify-desktop-creation-experience`：18/19

本轮将此前未提交的最终工作台成果与缺陷修复保存为本地实现提交，随后单独提交 OpenSpec 规格与本验收记录。既有界面迭代不全部归因于本轮。不推送远端。

实现提交：`d0782cc`（保存桌面工作台并修复审查发现的执行边界）。

## 最终安装包

`/Users/linkwind/Code/MangaWeaver/desktop/release/mac-arm64/MangaWeaver.app`

`Contents/Resources/app.asar` SHA-256：

```text
f8e3001142eea631f9bd98b81f12f3a07284d7a75b7cc50ed938c018d9e4eba2
```

应用继续使用设置中指定的本地 Python 环境及项目源码。Python修复已保存到当前项目；安装包不包含独立Python运行时。构建仍提示现有单包体积较大、默认图标和未签名，这些不属于本次审查缺陷。
