# H3 日语对白与中文字幕

本项目输出彩色二维动画、日语配音与中文字幕。中文漫画台词不是可直接照读的 H3 配音稿。

## 输入与审核

原有脚本和分镜 Creator／Reviewer 保持不变。规划完成后、H3 提交前，`planning/dialogue.py` 使用同一 Gemini 客户端与有限 Creator／Reviewer 准备台词：

- 保留原格 `panel_id`、`dialogue_index`、`speaker_id`，每句恰好分配给一个视频段。
- `japanese` 为审查后的日语译文，不声称是找回的原作日文；`subtitle_zh` 沿用已审查中文原文。
- `spoken` 配合口型，`voiceover` 为内心独白/画外音并保持嘴唇闭合，`singing` 为明确唱词并按相同日语标记无伴奏演唱。非语言笑声、喘气留在环境/动作声音说明中，不扩写新台词。
- 同一人物使用一致声线描述与稳定 S 编号；分配段内开始/结束时间，不跨段重复对白。
- 英文镜头说明和环境声遵守已选镜头、动作时间与配色。未知颜色仍为有标注的改编选择。

## H3 提示词

参考官方指南，首行描述首帧／首尾帧与时间端点，随后为三个文本字段（不是新的 API JSON 参数）：

- `integrated_multimodal_description`：画面过程、角色表演，以及带说话人、语言和精确台词的 `<d>[Japanese] ...</d>`。
- `overall_soundscape`：环境、动作声与非语言声音；不重复台词。
- `non_diegetic_music: N/A`：当前不逐段生成背景音乐。

H3 只演绎已经审查的日文，不进行临场翻译。英文描述不是强制 API 语法，而是按官方指南组织提示词；渠道是否完整遵循仍以真实结果判断。首尾帧模式不混入 reference_audio，官方 API 将两类输入设为互斥，不据此承诺固定声线复现。

## 实际声音与字幕

视频 Reviewer 输入完整视频和计划台词，检查日语、说话人、增漏词、独白口型与声画同步；为被选视频返回 `heard_cues`，包含实际听到的日文和开始/结束时间，不能把计划时间冒充实际听辨。

中文字幕在后期添加，H3 原生画面不绘制字幕。按实际视频时长和同一边界去重区间合并字幕，导出 `final.srt`、无字幕有声 `final_clean.mp4` 与带字幕 `final.mp4`。使用 Pillow 生成透明字幕层再叠加，适配本机不含 libass 的 FFmpeg；没有新增字幕服务或 TTS。

设置 `SUBTITLE_FONT` 为本机可读的中文字体路径，例如 macOS 的 `/System/Library/Fonts/Supplemental/Arial Unicode.ttf`。字幕路径和字体的可用性需在付费视频提交前确认。

自动听辨并不是精确 ASR 或最终人工听感验收；不能仅因有音轨、字幕或可播放文件就声称对白正确。

## 官方资料

核对日期：2026-10-24。

- [MiniMax H3 模型说明及支持语言](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [首帧／首尾帧与对白提示词指南](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
- [视频生成 V2 API 与输入互斥规则](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)

## 公开关键帧上传

幻灵 V2 需要公开 HTTPS 图片。`VIDEO_UPLOAD_PROVIDER` 显式选择 `kie` 或 `uguu`，不因配额错误自动切换。Uguu 匿名上传已生成关键帧，不接收模型 Key，返回链接后下载核对原图 SHA256，缓存相同内容且未临近3小时过期的地址。已有 H3 task_id 继续查询，不因上传器改变重复收费。实测 Kie 在本页第三段上传时达到免费配额；前两段任务保留，第三段确认未到视频 POST 后显式恢复。Uguu规则参见 https://uguu.se/ 和 https://uguu.se/api 。
