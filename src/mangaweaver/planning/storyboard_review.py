"""成对比较视觉候选，保留每次意见；最终检查整个关键帧序列。"""
from ..schemas import ReviewReport


def select(client, source, script, shot, direction, anchor, candidates, directory, previous_images, cross_shot_image=None):
    sources = [p.image for p in source.panels if p.panel_id in shot.source_panel_ids] + source.reference_images
    continuity = [cross_shot_image] if cross_shot_image else []
    keys = list(candidates)
    current = keys[0]
    reports = []
    # 只有一个候选时也检查其可用性，不把缺少比较当作自动通过。
    pairs = keys[1:] or [current]
    for i, challenger in enumerate(pairs):
        ids = list(dict.fromkeys([current, challenger]))
        report = client.json_to("planning/storyboard/review.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
            "characters": [c.model_dump() for c in script.characters],
            "shot": shot.model_dump(mode="json"),
            "direction": direction.model_dump(mode="json") if direction else None,
            "anchor": anchor.model_dump(mode="json"),
            "source_images": [p.name for p in sources],
            "previous_shot_final_image": cross_shot_image.name if cross_shot_image else None,
            "previous_images": [p.name for p in previous_images],
            "candidates": [{"id": k, "image": str(candidates[k].image)} for k in ids],
        }, ReviewReport, sources + continuity + previous_images + [candidates[k].image for k in ids], directory / f"compare_{i+1}.json")
        report.winner({k: candidates[k] for k in ids})
        current = report.winner_id
        reports.append(report)
    return candidates[current], reports


def review_sequence(client, source, script, shot, direction, assets, destination):
    sources = [p.image for p in source.panels if p.panel_id in shot.source_panel_ids] + source.reference_images
    report = client.json_to("planning/storyboard/sequence_review.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
        "characters": [c.model_dump() for c in script.characters],
        "shot": shot.model_dump(mode="json"), "direction": direction.model_dump(mode="json"),
        "candidate_id": "selected_sequence", "assets": [a.model_dump(mode="json") for a in assets],
    }, ReviewReport, sources + [a.image for a in assets], destination)
    if report.winner_id != "selected_sequence":
        raise ValueError("序列评审必须引用 selected_sequence")
    return report
