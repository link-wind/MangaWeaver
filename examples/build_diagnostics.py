"""生成原创线条示意素材与人工计划；用于协议验证，不代表 AI 生成质量。"""
from pathlib import Path

from PIL import Image, ImageDraw

from mangaweaver.io import file_signature, signature, write_json
from mangaweaver.schemas import (
    Anchor, Character, DirectionPlan, Panel, PanelScript, ProductionPlan,
    ReviewReport, Shot, ShotList, SourceManifest, SourceScript, VisualAsset,
)

ROOT = Path(__file__).resolve().parent


def draw(path, moment):
    image = Image.new("RGB", (1280, 720), "#faf8f2")
    canvas = ImageDraw.Draw(image)
    canvas.line((80, 560, 1200, 560), fill="#444444", width=4)
    for x, color in [(270, "#2765ad"), (950, "#b44040")]:
        canvas.ellipse((x-32, 245, x+32, 309), outline=color, width=8)
        canvas.line((x, 310, x, 440, x-65, 550), fill=color, width=8)
        canvas.line((x, 440, x+65, 550), fill=color, width=8)
        arm = (x+110, 345) if x == 270 else (x-95, 345)
        canvas.line((x, 340, *arm), fill=color, width=8)
    ball_x = {"entry": 360, "impact": 620, "exit": 850}[moment]
    canvas.ellipse((ball_x-25, 320, ball_x+25, 370), fill="#e59b36", outline="#333333", width=3)
    canvas.text((70, 65), f"ORIGINAL DIAGNOSTIC DRAWING - {moment.upper()}", fill="#333333", font_size=28)
    canvas.text((70, 115), "Not model-generated animation or quality evidence", fill="#555555", font_size=22)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def reaction(path):
    image = Image.new("RGB", (1280, 720), "#faf8f2")
    d = ImageDraw.Draw(image)
    d.ellipse((530, 150, 750, 370), outline="#39764d", width=10)
    d.ellipse((585, 235, 600, 250), fill="#333333")
    d.ellipse((680, 235, 695, 250), fill="#333333")
    d.arc((600, 275, 680, 330), 0, 180, fill="#333333", width=5)
    d.line((640, 370, 640, 620), fill="#39764d", width=12)
    d.text((65, 65), "ORIGINAL DIAGNOSTIC DRAWING - REACTION", fill="#333333", font_size=28)
    image.save(path)


def build(case, cross_panel):
    directory = ROOT / case
    for moment in ("entry", "impact", "exit"):
        draw(directory / "images" / f"{moment}.png", moment)
    characters = [Character(character_id="C1", description="蓝衣传球者，在画面左侧"),
                  Character(character_id="C2", description="红衣接球者，在画面右侧")]
    source_panels = [Panel(panel_id="p001", page_id="page001", image=Path("images/impact.png"),
                          text="", uncertainties=["单格画面不能直接确定动作入点"])]
    if cross_panel:
        reaction(directory / "images" / "reaction.png")
        characters.append(Character(character_id="C3", description="绿衣旁观者"))
        source_panels = [Panel(panel_id=f"p{i:03d}", page_id="page001", image=Path(f"images/{name}.png"))
                         for i, name in enumerate(("entry", "impact", "reaction"), 1)]
    source = SourceManifest(case_id=case, panels=source_panels, characters=characters)
    descriptions = ["球在左右两个人物之间的半空中"]
    if cross_panel:
        descriptions = ["左侧人物准备向右侧传球", "球在左右人物之间的半空中", "旁观者注视场内"]
    script = SourceScript(case_id=case, characters=characters, panels=[
        PanelScript(panel_id=p.panel_id, environment="空旷球场", description=description,
                    facts=[description], inferences=["球的位移可组织为一次传球"] if i < 2 else [],
                    character_ids=["C3"] if i == 2 else ["C1", "C2"])
        for i, (p, description) in enumerate(zip(source_panels, descriptions, strict=True))])
    action_sources = ["p001", "p002"] if cross_panel else ["p001"]
    action = Shot(shot_id="s001", source_panel_ids=action_sources, type="action", duration=8,
                  intent="展现一次传球的连续过程", description="从准备传球发展到球飞至接球者手前",
                  environment="球场", camera="固定侧面全景", character_ids=["C1", "C2"],
                  rationale="将原漫画的半空瞬间放在动作中段；跨格时把准备与飞行归为同一事件")
    anchors = [
        Anchor(keyframe_id="k001", time=0, role="entry", description="球仍在传球者手边",
               source_panel_ids=["p001"] if cross_panel else [], inferred=not cross_panel),
        Anchor(keyframe_id="k002", time=4, role="source_moment", description="球位于双方之间的半空中",
               source_panel_ids=["p002"] if cross_panel else ["p001"]),
        Anchor(keyframe_id="k003", time=8, role="exit", description="球到达接球者伸出的双手前", inferred=True),
    ]
    direction = DirectionPlan(shot_id="s001", entry="传球者尚未出手", source_moment="半空中的球位于 4 秒",
                              exit="接球者手前，暂不添加后续事件", rhythm="准备—飞行—到手前；示例每段 4 秒仅为后端协议验证",
                              anchors=anchors)
    shots = [action]
    assets = []
    for anchor, moment in zip(anchors, ("entry", "impact", "exit"), strict=True):
        path = Path(f"images/{moment}.png")
        assets.append(VisualAsset(keyframe_id=anchor.keyframe_id, shot_id="s001", time=anchor.time,
            image=path, description=anchor.description, source_panel_ids=anchor.source_panel_ids,
            plan_signature=signature({"script": signature(script), "shot": action.model_dump(mode="json"), "direction": direction.model_dump(mode="json")}),
            image_signature=file_signature(directory / path)))
    if cross_panel:
        static = Shot(shot_id="s002", source_panel_ids=["p003"], type="static", duration=4,
                      intent="保留反应停顿", description="旁观者注视球场，轻微呼吸",
                      environment="球场边缘", camera="固定近景", character_ids=["C3"],
                      rationale="表情反应无需重建主要动作，走单首帧路线")
        shots.append(static)
        assets.append(VisualAsset(keyframe_id="s002_start", shot_id="s002", time=0,
            image=Path("images/reaction.png"), description=static.description, source_panel_ids=["p003"],
            plan_signature=signature({"script": signature(script), "shot": static.model_dump(mode="json"), "direction": static.model_dump(mode="json")}),
            image_signature=file_signature(directory / "images/reaction.png")))
    plan = ProductionPlan(source=source, script=script, shot_list=ShotList(case_id=case, shots=shots),
                          directions=[direction], assets=assets, reviews=[ReviewReport(scope="manual_diagnostic",
                          winner_id="manual_example", accepted=True,
                          reason="人工编写的协议诊断样例；没有调用模型，不作为视觉质量通过证据")])
    write_json(directory / "source.json", source)
    write_json(directory / "expected_shots.json", plan.shot_list)
    write_json(directory / "expected_direction.json", direction)
    write_json(directory / "production.json", plan)


if __name__ == "__main__":
    build("key-moment", False)
    build("cross-panel", True)
    print("已更新两份原创协议诊断样例；未调用任何模型。")
