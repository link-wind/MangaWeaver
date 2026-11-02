"""参考 MAGI 的检测、阅读排序接口；重依赖仅在自动预处理时加载。"""
from pathlib import Path

from PIL import Image

from ..schemas import Panel
from ..events import emit

MAGI_MODEL = "ragavsachdeva/magi"
MAGI_REVISION = "15ad498ad45093ad3b833d625728220c6309ad99"
OCR_MODEL = "microsoft/trocr-base-printed"
OCR_REVISION = "93450be3f1ed40a930690d951ef3932687cc1892"
OCR_FILES = ["preprocessor_config.json", "config.json", "generation_config.json", "merges.txt",
             "special_tokens_map.json", "tokenizer_config.json", "vocab.json"]


def load_magi(device: str | None = None):
    import torch
    from transformers import AutoConfig, AutoModel
    from huggingface_hub import snapshot_download, try_to_load_from_cache
    chosen = device or ("cuda" if torch.cuda.is_available() else "cpu")
    if chosen == "cpu":
        torch.set_num_threads(min(4, torch.get_num_threads()))
    emit("magi.load", status="running", device=chosen)
    cached_model = try_to_load_from_cache(MAGI_MODEL, "model.safetensors", revision=MAGI_REVISION)
    model_local = isinstance(cached_model, str) and Path(cached_model).is_file()
    config = AutoConfig.from_pretrained(MAGI_MODEL, revision=MAGI_REVISION,
        trust_remote_code=True, local_files_only=model_local)
    cached_ocr = try_to_load_from_cache(OCR_MODEL, OCR_FILES[0], revision=OCR_REVISION)
    if isinstance(cached_ocr, str) and all((Path(cached_ocr).parent / name).is_file() for name in OCR_FILES):
        config.ocr_pretrained_processor_path = str(Path(cached_ocr).parent)
    else:
        config.ocr_pretrained_processor_path = snapshot_download(OCR_MODEL, revision=OCR_REVISION, allow_patterns=OCR_FILES)
    # MAGI checkpoint 已含骨干权重，避免构造模型时再下载 ImageNet 权重。
    config.detection_model_config.use_pretrained_backbone = False
    model = AutoModel.from_pretrained(MAGI_MODEL, revision=MAGI_REVISION,
        trust_remote_code=True, use_safetensors=True, config=config, local_files_only=model_local).to(chosen).eval()
    emit("magi.load", status="completed", device=chosen)
    return model


def detect(pages: list[Path], output: Path, device: str | None = None):
    import numpy as np
    import torch
    if not pages:
        raise ValueError("至少需要一页漫画")
    model = load_magi(device)
    images, gray = [], []
    for page in pages:
        with Image.open(page) as im:
            images.append(im.convert("RGB").copy())
            gray.append(np.asarray(im.convert("L").convert("RGB")))
    emit("magi.detect", status="running", pages=len(pages))
    with torch.no_grad():
        detections = model.predict_detections_and_associations(gray, panel_detection_threshold=0.2)
    panels = []
    output.mkdir(parents=True, exist_ok=True)
    for page_index, (image, result) in enumerate(zip(images, detections, strict=True), start=1):
        boxes = result["panels"]
        if len(boxes) == 0:
            raise ValueError(f"页面 {pages[page_index-1]} 未检测到漫画格，请人工分格后导入")
        indices, _ = model.sort_panels_and_text_bboxes_in_reading_order([boxes], [result["texts"]])
        for i in indices[0]:
            raw = [int(v) for v in boxes[i]]
            bbox = [max(0, min(image.width, raw[0])), max(0, min(image.height, raw[1])),
                    max(0, min(image.width, raw[2])), max(0, min(image.height, raw[3]))]
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                raise ValueError(f"MAGI 返回无效裁框：{raw}")
            panel_id = f"p{len(panels)+1:03d}"
            path = (output / f"{panel_id}.png").resolve()
            image.crop(tuple(bbox)).save(path)
            panels.append(Panel(panel_id=panel_id, image=path, page_id=f"page{page_index:03d}", bbox=bbox))
    emit("magi.detect", status="completed", panels=len(panels))
    return panels, model, gray, detections
