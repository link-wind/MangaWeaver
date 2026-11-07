"""按 OCR 词框对裁格做去字遮罩，给关键帧生成提供无文字参考。"""
from pathlib import Path

from PIL import Image, ImageDraw

from ..schemas import Panel

PADDING = 2


def mask_panel(panel: Panel, directory: Path) -> Path | None:
    """词框外扩 2px 填白；无词框返回 None，生图沿用原图。"""
    if not panel.text_boxes:
        return None
    with Image.open(panel.image) as im:
        canvas = im.convert("RGB").copy()
    draw = ImageDraw.Draw(canvas)
    for x1, y1, x2, y2 in panel.text_boxes:
        draw.rectangle([max(0, x1 - PADDING), max(0, y1 - PADDING),
                        min(canvas.width, x2 + PADDING), min(canvas.height, y2 + PADDING)], fill="white")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{panel.panel_id}.png"
    canvas.save(path)
    return path
