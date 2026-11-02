from ..schemas import ReviewReport


def select(client, source, script, shot, candidates, destination):
    media = [p.image for p in source.panels if p.panel_id in shot.source_panel_ids] + source.reference_images
    report = client.json_to("planning/direction/review.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
        "shot": shot.model_dump(mode="json"),
        "verified_panel_facts": [p.model_dump(mode="json") for p in script.panels if p.panel_id in shot.source_panel_ids],
        "source_image_order": [p.panel_id for p in source.panels if p.panel_id in shot.source_panel_ids],
        "backend_limits": {"model": client.config.minimax_model, "resolution": client.config.resolution,
            "segment_duration_seconds": "4..15 integer"},
        "scene_target_duration_seconds": client.config.target_duration or None,
        "candidates": [{"id": key, "value": value.model_dump(mode="json")} for key, value in candidates.items()],
    }, ReviewReport, media, destination)
    return report.winner(candidates).check_shot(shot), report
