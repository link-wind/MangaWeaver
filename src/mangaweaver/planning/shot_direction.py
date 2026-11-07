"""动作镜头的镜头内时间设计，非身体运动求解。"""
from ..schemas import DirectionPlan, segment_duration_rule


def create(client, source, script, shot, directory, previous=None, feedback=()):
    candidates = {}
    media = [p.image for p in source.panels if p.panel_id in shot.source_panel_ids] + source.reference_images
    for i in range(client.config.num_directions):
        cid = f"candidate_{i+1}"
        result = client.json_to("planning/direction/create.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
            "shot": shot.model_dump(mode="json"), "script": script.model_dump(mode="json"),
            "previous": previous.model_dump(mode="json") if previous else None,
            "feedback": feedback,
            "backend_limits": {"model": client.config.minimax_model, "resolution": client.config.resolution, "segment_duration_seconds": segment_duration_rule()},
        }, DirectionPlan, media, directory / f"{cid}.json")
        candidates[cid] = result.check_shot(shot)
    return candidates
