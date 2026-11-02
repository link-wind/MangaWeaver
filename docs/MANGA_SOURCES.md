# 漫画素材下载来源

核对日期：2026-10-23。这里整理下载与实验素材入口，不自动注册、购买或下载整套漫画。

| 来源 | 内容与获取方式 | 对当前项目的用途 |
| --- | --- | --- |
| [Pepper&Carrot](https://www.peppercarrot.com/en/webcomics/peppercarrot.html) | 彩色奇幻漫画，有中文等版本；章节页面提供 Sources and license、高分辨率及下载资源 | 适合先选一页／连续 3～5 格验证画面、跨格编排和角色一致性 |
| [Manga109-s](https://huggingface.co/datasets/hal-utokyo/Manga109-s) | 日漫数据集，含 87 本漫画及标注，需 Hugging Face 登录并申请同意许可 | 更贴近黑白日漫，适合分格、角色、文本和动作编排实验；不是无需条件的自由素材库 |
| [Comic Book Plus](https://comicbookplus.com/?cbplus=sitemap) | 历史漫画与连环画；站点说明免费注册登录后可下载 | 可找冒险、运动或动作片段；以各条目说明为准 |
| [Digital Comic Museum](https://digitalcomicmuseum.com/login.php) | 历史美漫档案；站点说明注册会员可免费下载 | 适合清晰分格和连续动作的小样本 |

优先试验素材建议为 [Pepper&Carrot 第 31 话 The Fight](https://www.peppercarrot.com/en/webcomic/ep31_The-Fight.html)，先人工挑选一段完整的小事件，而不是处理整话。其[许可说明](https://www.peppercarrot.com/en/philosophy/index.html)采用 CC BY 4.0，要求保留相关作者署名、许可链接并注明改动；作者鼓励电影、游戏等改编用途。选用翻译版时一并保留该版本的署名。

Manga109-s 官方页面列明允许的实验和成果使用、引用与再分发条件。申请前阅读完整数据集许可，下载许可不等同于可以随意公开原漫画或将整套数据再分发。普通项目可优先查看 Manga109-s；完整 Manga109 当前学术申请要求学术机构邮箱。

Comic Book Plus 和 Digital Comic Museum 的下载说明已通过其自身索引／搜索缓存核对，但本次抓取首页返回 403；尚未实测登录后的下载，也未核验任何具体漫画条目的权利状态。

下载后先在本地准备 JPEG／PNG，按阅读顺序写入 `SourceManifest`，再交给 `preprocess --manifest`。CBZ 通常可作为 ZIP 解压取得页面，CBR 需要相应解包工具。实际测试只需要一页或连续少量漫画格。
