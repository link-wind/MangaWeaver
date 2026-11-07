"""来源清单导入及 MAGI 原始文字提取。"""
import tempfile
from pathlib import Path

from ..io import read_json
from ..schemas import SourceManifest


def load_source(path: Path, value=None):
    path = path.resolve()
    source = SourceManifest.model_validate(read_json(path) if value is None else value)
    for panel in source.panels:
        panel.image = (path.parent / panel.image).resolve()
        if panel.masked_image is not None:
            panel.masked_image = (path.parent / panel.masked_image).resolve()
    source.reference_images = [(path.parent / p).resolve() for p in source.reference_images]
    for panel in source.panels:
        if panel.masked_image is not None and not panel.masked_image.is_file():
            raise FileNotFoundError(f"去字参考缺失：{panel.masked_image}，请重新预处理或清除该字段")
    for p in source.images + source.reference_images:
        if not p.is_file():
            raise FileNotFoundError(f"来源图像不存在：{p}")
    return source


def extract(model, images, detections):
    import torch
    with torch.no_grad():
        ocr = model.predict_ocr(images, [d["texts"] for d in detections])
    text = []
    with tempfile.TemporaryDirectory() as temp:
        for i, (result, words) in enumerate(zip(detections, ocr, strict=True)):
            path = Path(temp) / f"page{i+1}.txt"
            model.generate_transcript_for_single_image(result, words, filename=str(path))
            text.append(f"页面 page{i+1:03d}\n" + path.read_text(encoding="utf-8"))
    return "\n\n".join(text)


def clip_text_boxes(panels, boxes):
    """把页面级 OCR 框裁剪进相交格的裁剪坐标；跨格气泡在每格内各自遮罩。"""
    for panel in panels:
        if not panel.bbox:
            continue
        px1, py1, px2, py2 = panel.bbox
        for x1, y1, x2, y2 in boxes:
            rx1, ry1 = max(x1, px1) - px1, max(y1, py1) - py1
            rx2, ry2 = min(x2, px2) - px1, min(y2, py2) - py1
            if rx2 > rx1 and ry2 > ry1:
                panel.text_boxes.append([round(rx1), round(ry1), round(rx2), round(ry2)])


def assign_blocks(panels, boxes, texts, order):
    """按阅读顺序归入相交最多的一格；跨格气泡仍须审查，不重复写入。"""
    groups = [[] for _ in panels]
    for index in order:
        x1, y1, x2, y2 = boxes[index]
        overlaps = [max(0, min(x2, p.bbox[2]) - max(x1, p.bbox[0])) *
                    max(0, min(y2, p.bbox[3]) - max(y1, p.bbox[1])) for p in panels]
        if overlaps and max(overlaps) > 0 and texts[index].strip():
            groups[overlaps.index(max(overlaps))].append(texts[index].strip())
    for panel, lines in zip(panels, groups, strict=True):
        panel.text = "\n".join(lines)
        if lines:
            panel.uncertainties.append("本地 OCR 草稿，需核对文字、跨格气泡归属及说话人")


def extract_local(model, images, panels):
    from rapidocr import RapidOCR
    engine = RapidOCR(params={"Global.log_level": "warning",
                              "EngineConfig.onnxruntime.intra_op_num_threads": 4,
                              "EngineConfig.onnxruntime.inter_op_num_threads": 1})
    transcript = []
    for page_index, image in enumerate(images, start=1):
        result = engine(image)
        page_panels = [p for p in panels if p.page_id == f"page{page_index:03d}"]
        if result.txts is not None and result.boxes is not None:
            boxes = [[float(box[:, 0].min()), float(box[:, 1].min()),
                      float(box[:, 0].max()), float(box[:, 1].max())] for box in result.boxes]
            _, orders = model.sort_panels_and_text_bboxes_in_reading_order([[p.bbox for p in page_panels]], [boxes])
            assign_blocks(page_panels, boxes, result.txts, orders[0])
            clip_text_boxes(page_panels, boxes)
        transcript.append(f"页面 page{page_index:03d} · 本地 OCR 草稿\n" +
                          "\n\n".join(f"{p.panel_id}\n{p.text}" for p in page_panels))
    return "\n\n".join(transcript)
