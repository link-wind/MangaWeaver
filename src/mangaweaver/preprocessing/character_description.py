"""角色准备及第一阶段入口，已有来源无需重复 OCR。"""
from pathlib import Path

from ..io import write_json
from ..schemas import CharacterList, SourceManifest


def describe(client, source: SourceManifest, destination: Path):
    if source.characters:
        return source
    references = source.reference_images or source.images
    result = client.json_to("preprocessing/characters.txt", {"case_id": source.case_id,
        "reference_order": [p.name for p in references]}, CharacterList, references, destination)
    return source.model_copy(update={"characters": result.characters})


def run(pages, run_dir: Path, case_id: str, reference_images=(), device=None, ocr_backend="magi"):
    if ocr_backend not in {"magi", "rapidocr"}:
        raise ValueError("LOCAL_OCR_PROVIDER 只能为 magi 或 rapidocr")
    from .crop_panels import detect, MAGI_REVISION
    from .transcript import extract
    from ..events import emit
    panels, model, images, detections = detect([Path(p).resolve() for p in pages], run_dir / "source" / "panels", device)
    emit("magi.ocr", status="running")
    if ocr_backend == "rapidocr":
        from .transcript import extract_local
        transcript = extract_local(model, images, panels)
    else:
        transcript = extract(model, images, detections)
    emit("magi.ocr", status="completed")
    source = SourceManifest(case_id=case_id, panels=panels, transcript=transcript,
                            reference_images=[Path(p).resolve() for p in reference_images])
    # 角色描述在 plan 中调用所选模型；自动预处理不隐式增加生成费用。
    # 显式保存整页与裁框，桌面可返回原页检查自动分格。
    if len(pages) == 1:
        write_json(run_dir / "source" / "editor.json", {"page": str(Path(pages[0]).resolve()),
            "panels": [{"bbox": p.bbox, "text": p.text, "speaker": ""} for p in panels]})
    write_json(run_dir / "source" / "preprocessing.json", {"detector": "magi", "revision": MAGI_REVISION,
        "ocr_provider": ocr_backend, "panels": len(panels), "pages": [str(Path(p).resolve()) for p in pages]})
    write_json(run_dir / "source" / "manifest.json", source)
    return source
