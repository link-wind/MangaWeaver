from ..schemas import ReviewReport
from pydantic import Field
from .subtitles import HeardCue


class VideoReviewReport(ReviewReport):
    heard_cues: list[HeardCue] = Field(default_factory=list)


def select(client, plan, shot, candidates, destination, previous_video=None, segment=None, speech=None):
    sources = [p.image for p in plan.source.panels if p.panel_id in shot.source_panel_ids]
    frames = [a.image for a in plan.assets if a.shot_id == shot.shot_id]
    media = sources + frames + ([previous_video] if previous_video else []) + list(candidates.values())
    report = client.json_to("generation/video_review.txt", {
        "characters": [c.model_dump() for c in plan.script.characters],
        "source_images": [str(p) for p in sources],
        "keyframe_images": [str(p) for p in frames],
        "verified_panel_facts": [p.model_dump(mode="json") for p in plan.script.panels if p.panel_id in shot.source_panel_ids],
        "shot": shot.model_dump(mode="json"),
        "direction": next((d.model_dump(mode="json") for d in plan.directions if d.shot_id == shot.shot_id), None),
        "segment": segment.model_dump(mode="json") if segment else None,
        "speech_plan": speech.model_dump(mode="json") if speech else None,
        "planning_warnings": [i.model_dump() for r in plan.reviews if r.accepted for i in r.issues
                              if i.severity == "warning" and (shot.shot_id in i.location or r.scope.endswith(shot.shot_id))],
        "previous_video": str(previous_video) if previous_video else None,
        "candidates": [{"id": k, "video": str(v)} for k, v in candidates.items()],
    }, VideoReviewReport, media, destination, video=True)
    return report.winner(candidates), report
