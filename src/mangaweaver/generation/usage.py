"""只读用量汇总：模型调用、词元与视频提交次数；不调用模型，金额以平台账单为准。"""
from pathlib import Path

from ..io import read_json, write_json


def summarize(run_dir: Path):
    model_calls, tokens, usage_files = 0, 0, []
    for path in sorted(run_dir.glob("*_usage.json")):
        data = read_json(path)
        calls = int(data.get("successful_calls", 0))
        counted = sum(int(u.get("totalTokenCount", 0) or 0)
                      for u in [*data.get("usage", []), *data.get("image_usage", [])])
        usage_files.append({"file": path.name, "successful_calls": calls, "total_tokens": counted})
        model_calls += calls
        tokens += counted
    videos = []
    for state_path in sorted(run_dir.glob("video/*/*/tasks.json")):
        state = read_json(state_path)
        request = state.get("request", {})
        active = sum(1 for c in state.get("candidates", {}).values() if c.get("task_id"))
        superseded = len(state.get("superseded", []))
        duration = float(request.get("requested_duration") or 0)
        videos.append({"segment_id": state_path.parent.name, "model": request.get("model"),
                       "resolution": request.get("resolution"), "requested_duration": duration,
                       "active_candidates": active, "superseded_submissions": superseded,
                       "total_submissions": active + superseded,
                       "submitted_seconds": duration * (active + superseded)})
    summary = {"model_calls": model_calls, "total_tokens": tokens, "usage_files": usage_files,
               "video": {"segments": videos, "total_submissions": sum(v["total_submissions"] for v in videos),
                         "total_submitted_seconds": sum(v["submitted_seconds"] for v in videos)},
               "note": "视频按提交次数计费，金额以平台账单为准；此处只记录次数与请求时长"}
    write_json(run_dir / "usage_summary.json", summary)
    return summary
