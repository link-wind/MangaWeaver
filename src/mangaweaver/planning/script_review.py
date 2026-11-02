"""沿用角色与逐格分别评审、组合来源脚本的方式。"""
from ..schemas import ReviewReport, SourceScript


def select(client, source, candidates, directory):
    character_report = client.json_to("planning/script/characters_review.txt", {
        "candidates": [{"id": k, "characters": v.model_dump(mode="json")["characters"]} for k, v in candidates.items()]
    }, ReviewReport, source.images + source.reference_images, directory / "characters.json")
    selected = character_report.winner(candidates)
    reports = [character_report]
    panels = []
    for panel in source.panels:
        choices = {key: next(p for p in script.panels if p.panel_id == panel.panel_id) for key, script in candidates.items()}
        report = client.json_to("planning/script/panel_review.txt", {
            "panel_id": panel.panel_id, "characters": [c.model_dump() for c in selected.characters],
            "source_transcript": source.transcript,
            "panel_image": str(panel.image),
            "context_images": [str(p) for p in source.reference_images],
            "candidates": [{"id": key, "value": p.model_dump()} for key, p in choices.items()],
        }, ReviewReport, [panel.image] + source.reference_images, directory / f"{panel.panel_id}.json")
        panels.append(report.winner(choices))
        reports.append(report)
    script = SourceScript(case_id=source.case_id, characters=selected.characters, panels=panels)
    return script.check_source(source), reports
