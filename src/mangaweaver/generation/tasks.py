"""将镜头计划编译成首帧或相邻首尾帧任务；不在切镜之间插值。"""
from pathlib import Path

from ..io import file_signature, read_json, write_json
from ..schemas import ProductionPlan, VideoTask


def load_plan(path: Path):
    path = path.resolve()
    data = read_json(path)
    for panel in data["source"]["panels"]:
        panel["image"] = str((path.parent / panel["image"]).resolve())
    data["source"]["reference_images"] = [str((path.parent / p).resolve()) for p in data["source"].get("reference_images", [])]
    for asset in data["assets"]:
        asset["image"] = str((path.parent / asset["image"]).resolve())
    return ProductionPlan.model_validate(data)


def build(plan: ProductionPlan, frame_dir: Path | None = None):
    if not plan.reviews or not all(r.accepted for r in plan.reviews):
        raise ValueError("计划没有完成评审或仍有未通过项，不能提交生成")
    directions = {d.shot_id: d for d in plan.directions}
    for asset in plan.assets:
        if file_signature(asset.image) != asset.image_signature:
            raise ValueError(f"关键画面已改变：{asset.image}，请重新审查")
    tasks = []
    for shot in plan.shot_list.shots:
        assets = sorted([a for a in plan.assets if a.shot_id == shot.shot_id], key=lambda a: a.time)
        characters = [c.model_dump() for c in plan.script.characters if c.character_id in shot.character_ids]
        base = (f"彩色二维动画镜头 {shot.shot_id}，保持人物、服饰、画风和场景。表达目的：{shot.intent}。"
                f"环境：{shot.environment}。机位：{shot.camera}。内容：{shot.description}。"
                f"人物参考描述：{characters}。全程保持已确认的角色配色、场景色调与彩色关键帧风格，不转为黑白、不局部褪色或无故变色。不渲染文字、气泡、字幕，不添加新事件或自行切镜。")

        if shot.type == "static":
            tasks.append(VideoTask(segment_id=f"{shot.shot_id}_seg01", shot_id=shot.shot_id,
                source_panel_ids=shot.source_panel_ids, mode="first_frame", first_keyframe_id=assets[0].keyframe_id, first_frame=assets[0].image,
                target_duration=shot.duration, prompt=base + "维持主要构图，允许克制的局部表演和指定运镜，不展开额外主要动作。",
                start_time=0, end_time=shot.duration))
        else:
            direction = directions[shot.shot_id]
            for i, (left, right) in enumerate(zip(assets, assets[1:]), start=1):
                tasks.append(VideoTask(segment_id=f"{shot.shot_id}_seg{i:02d}", shot_id=shot.shot_id,
                    source_panel_ids=shot.source_panel_ids, mode="first_last_frame",
                    first_keyframe_id=left.keyframe_id, last_keyframe_id=right.keyframe_id, first_frame=left.image,
                    last_frame=right.image, target_duration=right.time-left.time,
                    prompt=base + f"本段从「{left.description}」发展至「{right.description}」。"
                                 f"整个镜头节奏：{direction.rhythm}。首尾画面是时间端点而非普通风格参考。",
                    start_time=left.time, end_time=right.time))
    if frame_dir is not None:
        tasks = [_align_frame_height(task, frame_dir) for task in tasks]
    return tasks


def _align_frame_height(task, frame_dir):
    """仅补齐渠道返回的 1 像素高度差；原始评审图片保持不变。"""
    if task.last_frame is None:
        return task
    from PIL import Image
    with Image.open(task.first_frame) as first, Image.open(task.last_frame) as last:
        if first.size == last.size:
            return task
        if first.width != last.width or abs(first.height - last.height) != 1:
            raise ValueError(f"{task.segment_id} 首尾帧尺寸不一致；仅支持补齐1像素高度差，不裁切或缩放构图")
        height = max(first.height, last.height)
        field = "first_frame" if first.height < height else "last_frame"
        source = getattr(task, field)
        image = (first if field == "first_frame" else last).convert("RGB")
        canvas = Image.new("RGB", (image.width, height))
        canvas.paste(image, (0, 0))
        canvas.paste(image.crop((0, image.height-1, image.width, image.height)), (0, image.height))
        output = frame_dir / task.shot_id / f"{task.segment_id}_{field}.png"
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, format="PNG")
        write_json(output.with_suffix(".source.json"), {"source": str(source),
            "source_signature": file_signature(source), "operation": "repeat_bottom_row_1px",
            "output_size": list(canvas.size), "output_signature": file_signature(output)})
        return task.model_copy(update={field: output.resolve()})
