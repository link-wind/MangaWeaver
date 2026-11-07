"""段级候选作废重提；显式付费动作，轮询与评审沿用 generate 恢复。"""
from pathlib import Path

from ..io import read_json, write_json
from .pipeline import _submit_candidates, job_signature
from .tasks import build


def redo_segment(config, plan, run_dir: Path, segment_id: str, feedback: str = "", client=None):
    job = next((j for j in build(plan, run_dir / "video_frames") if j.segment_id == segment_id), None)
    if job is None:
        raise ValueError(f"计划中没有视频段 {segment_id}")
    directory = run_dir / "video" / job.shot_id / job.segment_id
    state_path = directory / "tasks.json"
    if not state_path.exists():
        raise ValueError(f"{segment_id} 尚无提交记录，无需重提；请先生成视频")
    state = read_json(state_path)
    if state["signature"] != job_signature(job, config):
        raise ValueError(f"{segment_id} 输入已改变，请使用新的运行目录，不复用旧任务")
    round_no = int(state.get("redo_round", 0)) + 1
    superseded = state.get("superseded", [])
    for cid, entry in state["candidates"].items():
        path = Path(entry["path"])
        if path.exists():
            path.replace(path.with_name(f"{path.stem}.rejected-{round_no}{path.suffix}"))
        superseded.append({"candidate": cid, "task_id": entry.get("task_id"), "status": entry.get("status"),
                           "round": round_no})
    state["candidates"] = {}
    state["redo_round"] = round_no
    state["superseded"] = superseded
    write_json(state_path, state)
    _archive_review(directory, round_no)
    if client is None:
        from ..clients.minimax import MiniMax
        client = MiniMax(config)
    _submit_candidates(client, config, job, run_dir)
    write_json(directory / "redo.json", {"feedback": feedback, "round": round_no})
    return {"message": f"已作废旧候选并重新提交 {segment_id}（第 {round_no} 轮）；请运行生成以查询、评审与继续",
            "segment_id": segment_id, "round": round_no, "superseded": len(superseded)}


def _archive_review(directory: Path, round_no: int):
    """移走失败评审与其输入签名，让恢复时按新载荷全新评审。"""
    review = directory / "review.json"
    if review.exists():
        review.replace(directory / f"review.rejected-{round_no}.json")
        metadata = directory / "review.input.json"
        if metadata.exists():
            metadata.replace(directory / f"review.rejected-{round_no}.input.json")
    selected = directory / "selected.json"
    if selected.exists():
        selected.replace(directory / f"selected.rejected-{round_no}.json")
    # 镜头接缝审查以组装后的镜头视频为输入，重提后随之归档。
    for name in ("shot_review.json", "shot_review.input.json"):
        source = directory.parent / name
        if source.exists():
            source.replace(directory.parent / f"{source.stem}.rejected-{round_no}{source.suffix}")
