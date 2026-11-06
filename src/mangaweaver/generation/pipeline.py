"""视频候选与本地任务恢复；提交不自动重试，评审失败不默认选 A。"""
import logging
from pathlib import Path

from ..clients.minimax import MiniMax, validate_task
from ..events import emit
from ..io import file_signature, read_json, signature, write_json
from . import assembly, tasks, video_review, subtitles
from ..planning import dialogue
from ..schemas import ReviewRejected

log = logging.getLogger(__name__)


def run(config, plan, run_dir: Path, dry_run=False):
    emit("tasks")
    jobs = tasks.build(plan, run_dir / "video_frames")
    # 所有任务先检查，再发出任何付费提交，避免中途才发现时长不支持。
    for job in jobs:
        validate_task(job, config)
    write_json(run_dir / "generation_tasks.json", [j.model_dump(mode="json") for j in jobs])
    if dry_run:
        return jobs
    from ..clients import create
    client = MiniMax(config)
    reviewer = create(config)
    selected_shots = []
    selected_tracks = []
    previous_shot = None
    try:
        emit("dialogue")
        speech_plan = dialogue.prepare(reviewer, plan, jobs, run_dir / "dialogue")
        speech_map = {s.segment_id: s for s in speech_plan.segments}
        jobs = [j.model_copy(update={"prompt": dialogue.h3_prompt(plan, j, speech_map[j.segment_id])}) for j in jobs]
        write_json(run_dir / "generation_tasks.json", [j.model_dump(mode="json") for j in jobs])
        if any(s.cues for s in speech_plan.segments):
            import os
            from PIL import ImageFont
            font = os.getenv("SUBTITLE_FONT")
            if not font:
                raise ValueError("请配置 SUBTITLE_FONT，视频提交前需确认中文字幕字体可用")
            ImageFont.truetype(font, 36)
        from ..events import checkpoint
        checkpoint()
        # 所有独立片段先保存并提交任务 ID，让异步后端同时生成；评审仍按叙事顺序进行。
        submitted = {j.segment_id: _submit_candidates(client, config, j, run_dir) for j in jobs}
        for shot in plan.shot_list.shots:
            selected_segments = []
            segment_tracks = []
            previous_segment = None
            for job in [j for j in jobs if j.shot_id == shot.shot_id]:
                directory, state_path, state = submitted[job.segment_id]
                checkpoint()
                paths = {}
                for cid, entry in state["candidates"].items():
                    path = Path(entry["path"])
                    if entry["status"] == "downloaded":
                        assembly.probe(path)
                    else:
                        log.info("查询 H3 任务 %s", entry["task_id"])
                        emit("video.query", task_id=entry["task_id"], segment_id=job.segment_id, shot_id=job.shot_id)
                        result = client.poll(entry["task_id"])
                        entry["result"] = result
                        entry["status"] = "succeeded"
                        write_json(state_path, state)
                        client.download(result["content"]["url"], path)
                        assembly.probe(path)
                        entry["actual_duration"] = float(assembly.probe(path)["format"]["duration"])
                        entry["status"] = "downloaded"
                        write_json(state_path, state)
                    paths[cid] = path
                emit("video.review", segment_id=job.segment_id, shot_id=job.shot_id)
                selected, report = video_review.select(reviewer, plan, shot, paths, directory / "review.json",
                    previous_segment if shot.type == "action" else previous_shot, job, speech_map[job.segment_id])
                write_json(directory / "selected.json", {"video": str(selected), "review": report.model_dump(mode="json")})
                if not report.accepted:
                    raise ReviewRejected(f"视频段 {job.segment_id} 未通过：{report.reason}；保留候选供人工处理")
                selected_segments.append(selected)
                segment_tracks.append(subtitles.from_review(speech_map[job.segment_id], report, selected))
                previous_segment = selected
            shot_path = run_dir / "video" / shot.shot_id / "selected.mp4"
            assembly.assemble(selected_segments, shot_path, continuous=shot.type == "action")
            if shot.type == "action":
                _, report = video_review.select(reviewer, plan, shot, {"selected_shot": shot_path},
                    run_dir / "video" / shot.shot_id / "shot_review.json", previous_shot)
                if not report.accepted:
                    raise ReviewRejected(f"完整镜头 {shot.shot_id} 未通过接缝／节奏审查：{report.reason}")
            selected_shots.append(shot_path)
            selected_tracks.append(subtitles.combine(selected_segments, segment_tracks, continuous=shot.type == "action"))
            previous_shot = shot_path
        checkpoint()
        emit("assembly")
        clean = assembly.assemble(selected_shots, run_dir / "final_clean.mp4")
        track = subtitles.combine(selected_shots, selected_tracks)
        write_json(run_dir / "subtitles.json", [c.model_dump() for c in track])
        result = subtitles.export(clean, track, run_dir / "final.mp4")
        write_json(run_dir / "export.json", {"output": str(result.resolve()),
            "plan_signature": signature(plan), "target_duration": sum(j.target_duration for j in jobs),
            "actual_duration": float(assembly.probe(result)["format"]["duration"]),
            "clean_output": str(clean.resolve()), "subtitles": str(result.with_suffix(".srt").resolve()),
            "spoken_language": "Japanese", "subtitle_language": "Chinese",
            "shots": [s.shot_id for s in plan.shot_list.shots]})
        return result
    finally:
        reviewer.save_usage(run_dir / "video_review_usage.json")


def _submit_candidates(client, config, job, run_dir):
    directory = run_dir / "video" / job.shot_id / job.segment_id
    directory.mkdir(parents=True, exist_ok=True)
    job_signature = signature({"job": job.model_dump(mode="json"), "model": config.minimax_model,
        "resolution": config.resolution, "endpoint": config.minimax_base_url,
        "first": file_signature(job.first_frame), "last": file_signature(job.last_frame) if job.last_frame else None})
    state_path = directory / "tasks.json"
    state = read_json(state_path) if state_path.exists() else {"signature": job_signature, "request": {"model": config.minimax_model,
        "resolution": config.resolution, "mode": job.mode, "requested_duration": validate_task(job, config)}, "candidates": {}}
    if state["signature"] != job_signature:
        raise ValueError(f"{job.segment_id} 输入已改变，请使用新的运行目录，不复用旧任务")
    # 先提交全部候选再查询，沿用参考项目的异步组织。
    for i in range(config.num_video_candidates):
        cid = f"candidate_{i+1}"
        entry = state["candidates"].get(cid)
        if entry is None:
            entry = {"status": "submitting", "path": str((directory / f"{cid}.mp4").resolve())}
            state["candidates"][cid] = entry
            write_json(state_path, state)
            try:
                entry["task_id"] = client.submit(job)
                entry["status"] = "submitted"
            except Exception:
                # 状态保留为 submitting；重启不自动再付费提交。
                write_json(state_path, state)
                raise
            write_json(state_path, state)
            emit("video.submitted", task_id=entry["task_id"], segment_id=job.segment_id, shot_id=job.shot_id)
        if not entry.get("task_id"):
            raise ValueError(f"{job.segment_id}/{cid} 上次提交结果不明，请在平台核对 task_id 后补入 tasks.json")
    return directory, state_path, state
