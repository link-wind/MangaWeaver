"""逐个制作指定时间角色的视觉锚点；原作图始终作为参考。"""
from ..io import file_signature, read_json, signature, write_json, prompt
from ..schemas import Anchor, VisualAsset


def anchors_for(shot, direction):
    if direction:
        return direction.anchors
    return [Anchor(keyframe_id=f"{shot.shot_id}_start", time=0, role="entry",
                   description=shot.description, source_panel_ids=shot.source_panel_ids)]


def create(client, source, script, shot, direction, anchor, directory, previous_images, feedback=(), cross_shot_image=None):
    candidates = {}
    selected_plan = {"script": signature(script), "shot": shot.model_dump(mode="json"),
                     "direction": (direction or shot).model_dump(mode="json")}
    plan_signature = signature(selected_plan)
    media = [(p.masked_image or p.image) for p in source.panels if p.panel_id in shot.source_panel_ids] + source.reference_images
    if cross_shot_image:
        media.append(cross_shot_image)
    media += previous_images
    character_ids = set(shot.character_ids) or {c for p in script.panels if p.panel_id in shot.source_panel_ids for c in p.character_ids}
    request = {**({"creative_brief": source.creative_brief} if source.creative_brief else {}), "shot": selected_plan["shot"],
               "direction": direction.model_dump(mode="json", exclude={"anchors"}) if direction else None,
               "anchor": anchor.model_dump(mode="json"),
               "characters": [c.model_dump() for c in script.characters if c.character_id in character_ids],
               "previous_keyframe_images": [p.name for p in previous_images],
               "previous_shot_final_image": cross_shot_image.name if cross_shot_image else None, "feedback": feedback}
    from ..events import professional_inputs
    request, media = professional_inputs('planning/storyboard/create.txt', request, media)
    context = signature({"request": request, "model": client.config.image_model,
                         "template": prompt("planning/storyboard/create.txt"),
                         "media": [file_signature(p) for p in media]})
    directory.mkdir(parents=True, exist_ok=True)
    for i in range(client.config.num_storyboards):
        cid = f"candidate_{i+1}"
        path = (directory / f"{cid}.png").resolve()
        metadata = directory / f"{cid}.json"
        if metadata.exists():
            record = read_json(metadata)
            if record["input_signature"] != context or not path.exists():
                raise ValueError(f"旧分镜输入不一致或图片缺失：{path}，请显式重跑分镜")
            asset = VisualAsset.model_validate(record["asset"])
            if file_signature(path) != asset.image_signature:
                raise ValueError(f"分镜已被修改：{path}，请重新审查")
        else:
            client.image("planning/storyboard/create.txt", request, media, path)
            asset = VisualAsset(keyframe_id=anchor.keyframe_id, shot_id=shot.shot_id, time=anchor.time,
                image=path, description=anchor.description, source_panel_ids=anchor.source_panel_ids,
                plan_signature=plan_signature, image_signature=file_signature(path))
            write_json(metadata, {"input_signature": context, "asset": asset.model_dump(mode="json")})
        candidates[cid] = asset
    return candidates
