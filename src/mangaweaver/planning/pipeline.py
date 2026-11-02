"""固定顺序的 Creator／Reviewer；通过阶段审查后才生成下游素材。"""
import logging
from pathlib import Path

from pydantic import BaseModel, Field

from ..events import emit
from ..io import read_json, signature, write_json
from ..preprocessing.character_description import describe
from ..schemas import DirectionPlan, Issue, ProductionPlan, ReviewReport, ShotList, SourceScript, VisualAsset
from . import arrangement_review, direction_review, script as script_agent, script_review
from . import shot_arrangement, shot_direction, storyboard, storyboard_review

log = logging.getLogger(__name__)


class PlanningDraft(BaseModel):
    """阶段检查点与实时画布产物；不能作为视频生成的 ProductionPlan。"""
    script: SourceScript
    shot_list: ShotList | None = None
    directions: list[DirectionPlan] = Field(default_factory=list)
    assets: list[VisualAsset] = Field(default_factory=list)
    reviews: list[ReviewReport] = Field(default_factory=list)


def _feedback(reports):
    return [i.model_dump() for r in reports if not r.accepted for i in r.issues]


def _affects(feedback, target, identifier=None, known_ids=()):
    for issue in feedback:
        if issue["target"] != target:
            continue
        location = issue["location"]
        if identifier is None or identifier in location or not any(k in location for k in known_ids):
            return True
    return False


def _draft(directory, run_dir, script, shots, directions, assets, reports, previous=None, paused=False, checkpoint=False):
    # 上游局部修订失败时，保留设计签名未改变、整镜已通过的视觉结果。
    # 不沿用失败序列，也不把旧设计图片绑定成新设计。
    if previous and shots:
        direction_map = {d.shot_id: d for d in directions}
        present = {(a.shot_id, a.keyframe_id) for a in assets}
        assets, reports = list(assets), list(reports)
        for shot in shots.shots:
            old_reports = [r for r in previous.reviews if r.scope == f"storyboard:{shot.shot_id}"]
            if not old_reports or not all(r.accepted for r in old_reports):
                continue
            direction = direction_map.get(shot.shot_id)
            if shot.type == "action" and direction is None:
                continue
            expected = signature({"script": signature(script), "shot": shot.model_dump(mode="json"),
                                  "direction": (direction or shot).model_dump(mode="json")})
            retained = [a for a in previous.assets if a.shot_id == shot.shot_id and a.plan_signature == expected
                        and (a.shot_id, a.keyframe_id) not in present]
            if retained:
                assets.extend(retained)
                reports.extend(old_reports)
    value = PlanningDraft(script=script, shot_list=shots, directions=directions, assets=assets, reviews=reports)
    write_json(directory / "draft.json", value)
    write_json(run_dir / "planning_draft.json", value)
    if checkpoint:
        from ..events import checkpoint as task_checkpoint
        task_checkpoint()
        log.info("已发布阶段产物")
        return value
    log.info("已保存阶段检查点，等待用户修改或继续" if paused else "本轮审查未通过，保存草案并反馈修订；不继续下游生成")
    return value


def _pause(stage, directory, run_dir, script, shots, directions, assets, reports, previous):
    result = _draft(directory, run_dir, script, shots, directions, assets, reports, previous, paused=True)
    write_json(run_dir / "planning_pause.json", {"after_stage": stage})
    emit(stage, status="paused", message="等待用户检查、修改或继续")
    return result


def run(client, source, run_dir: Path, from_stage=None, instruction="", pause_after=None, location="all"):
    if pause_after not in (None, "script", "arrangement", "direction", "storyboard"):
        raise ValueError("未知阶段暂停位置")
    emit("characters")
    source = describe(client, source, run_dir / "source" / "characters.json")
    write_json(run_dir / "source" / "prepared.json", source)
    emit("characters", status="completed")
    previous = None
    feedback = [Issue(target="script", location="all", severity="blocking", evidence="用户补充创作要求", suggestion=instruction).model_dump()] if instruction and not from_stage else []
    start_path = run_dir / "planning_start.json"
    start = read_json(start_path)["iteration"] if start_path.exists() else 0
    if from_stage:
        draft_path = run_dir / "planning_draft.json"
        state_path = run_dir / "planning_state.json"
        if draft_path.exists():
            previous = PlanningDraft.model_validate(read_json(draft_path))
        elif state_path.exists():
            previous = ProductionPlan.model_validate(read_json(state_path))
        else:
            raise ValueError("显式重跑阶段需要已有规划草案或 planning_state.json")
        feedback = _feedback(previous.reviews)
        targets = [i for i in feedback if i["target"] == from_stage and (location == "all" or i["location"] == location)]
        if targets:
            for issue in targets:
                issue["suggestion"] += "\n" + (instruction or "保留已通过部分，修订此问题")
        else:
            feedback.append(Issue(target=from_stage, location=location, severity="blocking",
                evidence="显式开始阶段修订", suggestion=instruction or "按已有审查反馈修订指定阶段，保留正确内容").model_dump())
        existing = [int(p.name[4:]) for p in run_dir.glob("iter*") if p.name[4:].isdigit()]
        start = max(existing, default=-1) + 1
        write_json(start_path, {"iteration": start})
        write_json(run_dir / "revision_base.json", previous)
        (run_dir / "production.json").unlink(missing_ok=True)
        (run_dir / "planning_pause.json").unlink(missing_ok=True)
    elif (run_dir / "revision_base.json").exists():
        previous = PlanningDraft.model_validate(read_json(run_dir / "revision_base.json"))
        first_feedback = run_dir / f"iter{start}" / "feedback_in.json"
        feedback = read_json(first_feedback) if first_feedback.exists() else _feedback(previous.reviews)
    try:
        for iteration in range(start, start + client.config.iterations):
            directory = run_dir / f"iter{iteration}"
            state_path = directory / "selected.json"
            if state_path.exists():
                previous = ProductionPlan.model_validate(read_json(state_path))
                write_json(run_dir / "planning_state.json", previous)
                feedback = _feedback(previous.reviews)
                if all(r.accepted for r in previous.reviews):
                    (run_dir / "planning_draft.json").unlink(missing_ok=True)
                    write_json(run_dir / "production.json", previous)
                    return previous
                continue
            if (directory / "draft.json").exists():
                previous = PlanningDraft.model_validate(read_json(directory / "draft.json"))
                write_json(run_dir / "planning_draft.json", previous)
                feedback = _feedback(previous.reviews)
                if feedback:
                    continue
                # 阶段中断只留下已通过的检查点，不应消耗一次内容修订轮次。
                # 恢复原反馈以保持未完成请求的输入签名，已提交图片仍由客户端防重。
                incoming = directory / "feedback_in.json"
                feedback = read_json(incoming) if incoming.exists() else []
            directory.mkdir(parents=True, exist_ok=True)
            log.info("规划轮次 %s", iteration)
            write_json(directory / "feedback_in.json", feedback)
            reports = []
            emit("script", iteration=iteration)
            script_changed = previous is None or _affects(feedback, "script")
            if script_changed:
                candidates = script_agent.create(client, source, directory / "script", previous.script if previous else None, feedback)
                script, reviews = script_review.select(client, source, candidates, directory / "reviews" / "script")
            else:
                script = previous.script
                reviews = [r for r in previous.reviews if r.scope == "script"]
            reports.extend(r.model_copy(update={"scope": "script"}) for r in reviews)
            write_json(directory / "script" / "selected.json", script)
            if any(not r.accepted for r in reports):
                previous = _draft(directory, run_dir, script, None, [], [], reports, previous)
                feedback = _feedback(reports)
                continue
            emit("script", status="completed")
            _draft(directory, run_dir, script, None, [], [], reports, previous, checkpoint=True)
            if pause_after == "script":
                return _pause("script", directory, run_dir, script, None, [], [], reports, previous)
            emit("arrangement", iteration=iteration)
            arrangement_changed = script_changed or previous.shot_list is None or _affects(feedback, "arrangement")
            if arrangement_changed:
                candidates = shot_arrangement.create(client, source, script, directory / "arrangement",
                    previous.shot_list if previous else None, feedback)
                shots, report = arrangement_review.select(client, source, script, candidates,
                    directory / "reviews" / "arrangement.json")
                reports.append(report.model_copy(update={"scope": "arrangement"}))
            else:
                shots = previous.shot_list
                reports.extend(r for r in previous.reviews if r.scope == "arrangement")
            write_json(directory / "arrangement" / "selected.json", shots)
            if any(not r.accepted for r in reports):
                previous = _draft(directory, run_dir, script, shots, [], [], reports, previous)
                feedback = _feedback(reports)
                continue
            emit("arrangement", status="completed")
            _draft(directory, run_dir, script, shots, [], [], reports, previous, checkpoint=True)
            if pause_after == "arrangement":
                return _pause("arrangement", directory, run_dir, script, shots, [], [], reports, previous)
            emit("direction", iteration=iteration)
            directions = []
            old_directions = {d.shot_id: d for d in previous.directions} if previous else {}
            old_shots = {s.shot_id: s for s in previous.shot_list.shots} if previous and previous.shot_list else {}
            all_ids = [s.shot_id for s in shots.shots]
            for shot in shots.shots:
                if shot.type != "action":
                    continue
                changed = script_changed or shot.shot_id not in old_shots or signature(old_shots[shot.shot_id]) != signature(shot)
                if changed or shot.shot_id not in old_directions or _affects(feedback, "direction", shot.shot_id, all_ids):
                    candidates = shot_direction.create(client, source, script, shot,
                        directory / "direction" / shot.shot_id, old_directions.get(shot.shot_id), feedback)
                    direction, report = direction_review.select(client, source, script, shot, candidates,
                        directory / "reviews" / "direction" / f"{shot.shot_id}.json")
                    reports.append(report.model_copy(update={"scope": f"direction:{shot.shot_id}"}))
                else:
                    direction = old_directions[shot.shot_id]
                    reports.extend(r for r in previous.reviews if r.scope == f"direction:{shot.shot_id}")
                directions.append(direction)
                write_json(directory / "direction" / f"{shot.shot_id}.json", direction)
            if any(not r.accepted for r in reports):
                previous = _draft(directory, run_dir, script, shots, directions, [], reports, previous)
                feedback = _feedback(reports)
                continue
            emit("direction", status="completed")
            _draft(directory, run_dir, script, shots, directions, [], reports, previous, checkpoint=True)
            if pause_after == "direction":
                return _pause("direction", directory, run_dir, script, shots, directions, [], reports, previous)
            direction_map = {d.shot_id: d for d in directions}
            emit("storyboard", iteration=iteration)
            assets = []
            for shot in shots.shots:
                direction = direction_map.get(shot.shot_id)
                anchors = storyboard.anchors_for(shot, direction)
                old_assets = [a for a in previous.assets if a.shot_id == shot.shot_id] if previous else []
                old_reviews = [r for r in previous.reviews if r.scope == f"storyboard:{shot.shot_id}"] if previous else []
                changed = script_changed or shot.shot_id not in old_shots or signature(old_shots[shot.shot_id]) != signature(shot)
                direction_changed = direction is not None and (shot.shot_id not in old_directions or signature(old_directions[shot.shot_id]) != signature(direction))
                if (not changed and not direction_changed and not _affects(feedback, "storyboard", shot.shot_id, all_ids)
                        and {a.keyframe_id for a in old_assets} == {a.keyframe_id for a in anchors}
                        and old_reviews and all(r.accepted for r in old_reviews)):
                    assets.extend(old_assets)
                    reports.extend(old_reviews)
                    continue
                previous_images, shot_assets = [], []
                for anchor in anchors:
                    # 草案只保存已通过的画面；同一设计下可复用正确的前缀帧。
                    old_asset = next((a for a in old_assets if a.keyframe_id == anchor.keyframe_id), None)
                    if (old_asset and not changed and not direction_changed
                            and not _affects(feedback, "storyboard", anchor.keyframe_id,
                                [a.keyframe_id for a in anchors])):
                        shot_assets.append(old_asset)
                        previous_images.append(old_asset.image)
                        reports.extend(r for r in old_reviews if r.accepted)
                        continue
                    emit("storyboard", status="running", shot_id=shot.shot_id, keyframe_id=anchor.keyframe_id)
                    candidates = storyboard.create(client, source, script, shot, direction, anchor,
                        directory / "storyboard" / shot.shot_id / anchor.keyframe_id, previous_images, feedback)
                    asset, visual_reviews = storyboard_review.select(client, source, script, shot, direction, anchor, candidates,
                        directory / "reviews" / "storyboard" / shot.shot_id / anchor.keyframe_id, previous_images)
                    reports.extend(r.model_copy(update={"scope": f"storyboard:{shot.shot_id}"}) for r in visual_reviews)
                    if not all(r.accepted for r in visual_reviews):
                        break
                    shot_assets.append(asset)
                    previous_images.append(asset.image)
                    _draft(directory, run_dir, script, shots, directions, assets + shot_assets, reports, previous, checkpoint=True)
                    emit("storyboard", status="completed", shot_id=shot.shot_id, keyframe_id=anchor.keyframe_id)
                assets.extend(shot_assets)
                if any(not r.accepted for r in reports):
                    break
                if direction:
                    report = storyboard_review.review_sequence(client, source, script, shot, direction, shot_assets,
                        directory / "reviews" / "storyboard" / shot.shot_id / "sequence.json")
                    reports.append(report.model_copy(update={"scope": f"storyboard:{shot.shot_id}"}))
                    if not report.accepted:
                        break
            if any(not r.accepted for r in reports):
                previous = _draft(directory, run_dir, script, shots, directions, assets, reports, previous)
                feedback = _feedback(reports)
                continue
            selected = ProductionPlan(source=source, script=script, shot_list=shots,
                directions=directions, assets=assets, reviews=reports)
            write_json(state_path, selected)
            write_json(run_dir / "planning_state.json", selected)
            (run_dir / "planning_draft.json").unlink(missing_ok=True)
            write_json(run_dir / "production.json", selected)
            (run_dir / "planning_pause.json").unlink(missing_ok=True)
            return selected
        reasons = [r.reason for r in previous.reviews if not r.accepted]
        raise ValueError("已达规划轮次上限，仍有未通过项目：" + "；".join(reasons))
    finally:
        client.save_usage(run_dir / "planning_usage.json")
