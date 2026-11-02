from ..schemas import ReviewReport


def select(client, source, script, candidates, destination):
    report = client.json_to("planning/arrangement/review.txt", {
            **({"creative_brief": source.creative_brief} if source.creative_brief else {}),
        "source_script": script.model_dump(mode="json"),
        "backend_limits": {"model": client.config.minimax_model, "resolution": client.config.resolution,
            "segment_duration_seconds": "4..15 integer"},
        "target_duration_seconds": client.config.target_duration or None,
        "candidates": [{"id": key, "value": value.model_dump(mode="json")} for key, value in candidates.items()],
    }, ReviewReport, source.images + source.reference_images, destination)
    return report.winner(candidates).check_source(script), report
