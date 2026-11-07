"""跨格事件识别、分类与镜头编排。"""
from ..schemas import ShotList, check_total_duration, segment_duration_rule


def create(client, source, script, directory, previous=None, feedback=()):
    candidates = {}
    for i in range(client.config.num_shot_plans):
        cid = f"candidate_{i+1}"
        value = client.json_to("planning/arrangement/create.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
            "source_script": script.model_dump(mode="json"),
            "previous": previous.model_dump(mode="json") if previous else None,
            "feedback": feedback,
            "backend_limits": {"model": client.config.minimax_model, "resolution": client.config.resolution, "segment_duration_seconds": segment_duration_rule()},
            "target_duration_seconds": client.config.target_duration or None,
        }, ShotList, source.images + source.reference_images, directory / f"{cid}.json")
        check_total_duration(value, client.config.target_duration)
        candidates[cid] = value.check_source(script)
    return candidates
