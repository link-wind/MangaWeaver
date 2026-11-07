## 1. 词框与遮罩

- [x] 1.1 Panel 增加 text_boxes 与 masked_image 可选字段；load_source 解析并校验去字文件存在
- [x] 1.2 extract_local 把页面级 OCR 框裁剪进相交格坐标并持久化
- [x] 1.3 新增 mask_text 模块：按词框外扩 2px 填白生成去字参考，写入 source/masked/
- [x] 1.4 预处理入口接入遮罩生成；storyboard.create 来源媒体改用去字参考

## 2. 验证

- [x] 2.1 单元测试：词框裁剪、遮罩填白、无词框回退原图、生成媒体使用去字参考
- [x] 2.2 全量 Python 测试回归通过
- [ ] 2.3 真实页面验证遮罩观感与文字泄漏抑制（需用户执行，计入下一轮实机验收）
