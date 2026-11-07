"""跨镜头衔接参考：选取前一镜头最后画面并进入生成与审查输入。"""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from mangaweaver.planning import storyboard, storyboard_review
from mangaweaver.planning.pipeline import _previous_shot_final
from mangaweaver.schemas import (
    Character,
    Panel,
    PanelScript,
    ReviewReport,
    Shot,
    SourceManifest,
    SourceScript,
    VisualAsset,
)


def _source_and_script(directory):
    characters = [Character(character_id="a", description="角色A")]
    panels = []
    for i in range(1, 3):
        image = directory / f"p{i}.png"
        image.write_bytes(b"panel")
        panels.append(Panel(panel_id=f"p{i}", image=image, page_id="pg1"))
    source = SourceManifest(case_id="case1", panels=panels, characters=characters)
    script = SourceScript(case_id="case1", characters=characters, panels=[
        PanelScript(panel_id=f"p{i}", environment="室内", description=f"第{i}格") for i in range(1, 3)])
    return source, script


def _asset(root, shot_id, keyframe_id, time, name):
    image = root / name
    image.write_bytes(b"frame")
    return VisualAsset(keyframe_id=keyframe_id, shot_id=shot_id, time=time, image=image,
                       description="d", source_panel_ids=["p1"], plan_signature="ps", image_signature="is")


class PreviousShotFinalTests(unittest.TestCase):
    def _shots(self):
        return [Shot(shot_id="s1", source_panel_ids=["p1"], type="static", intent="i", description="d",
                     environment="e", camera="c", duration=4.0, rationale="r"),
                Shot(shot_id="s2", source_panel_ids=["p2"], type="static", intent="i", description="d",
                     environment="e", camera="c", duration=4.0, rationale="r")]

    def test_selects_last_anchor_of_previous_shot(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            assets = [_asset(root, "s1", "k1", 0.0, "a.png"), _asset(root, "s1", "k2", 6.0, "b.png")]
            self.assertEqual(_previous_shot_final(assets, self._shots(), "s2"), root / "b.png")

    def test_first_shot_and_missing_assets_return_none(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            assets = [_asset(root, "s1", "k1", 0.0, "a.png")]
            self.assertIsNone(_previous_shot_final(assets, self._shots(), "s1"))
            self.assertIsNone(_previous_shot_final([], self._shots(), "s2"))


class StoryboardPayloadTests(unittest.TestCase):
    """衔接参考进入生成请求与媒体列表，并保持输入签名联动。"""

    def test_create_includes_cross_shot_image(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            source, script = _source_and_script(root)
            cross = root / "prev.png"
            cross.write_bytes(b"previous-shot")
            shot = Shot(shot_id="s2", source_panel_ids=["p2"], type="static", intent="i", description="d",
                        environment="e", camera="c", duration=4.0, rationale="r")
            anchor = storyboard.anchors_for(shot, None)[0]
            captured = {}

            class LocalClient:
                config = SimpleNamespace(image_model="test", num_storyboards=1)

                def image(self, template, request, media, path):
                    captured["request"] = request
                    captured["media"] = list(media)
                    path.write_bytes(b"candidate")

            storyboard.create(LocalClient(), source, script, shot, None, anchor,
                              root / "storyboard" / "s2" / "k1", [], cross_shot_image=cross)
            self.assertEqual(captured["request"]["previous_shot_final_image"], "prev.png")
            self.assertIn(cross, captured["media"])

    def test_create_without_cross_shot_image_keeps_payload_none(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            source, script = _source_and_script(root)
            shot = Shot(shot_id="s2", source_panel_ids=["p2"], type="static", intent="i", description="d",
                        environment="e", camera="c", duration=4.0, rationale="r")
            anchor = storyboard.anchors_for(shot, None)[0]
            captured = {}

            class LocalClient:
                config = SimpleNamespace(image_model="test", num_storyboards=1)

                def image(self, template, request, media, path):
                    captured["request"] = request
                    captured["media"] = list(media)
                    path.write_bytes(b"candidate")

            storyboard.create(LocalClient(), source, script, shot, None, anchor,
                              root / "storyboard" / "s2" / "k1", [])
            self.assertIsNone(captured["request"]["previous_shot_final_image"])

    def test_review_receives_cross_shot_image(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            source, script = _source_and_script(root)
            cross = root / "prev.png"
            cross.write_bytes(b"previous-shot")
            shot = Shot(shot_id="s2", source_panel_ids=["p2"], type="static", intent="i", description="d",
                        environment="e", camera="c", duration=4.0, rationale="r")
            anchor = storyboard.anchors_for(shot, None)[0]
            candidate = _asset(root, "s2", "k1", 0.0, "candidate.png")
            captured = {}

            class LocalClient:
                def json_to(self, template, payload, schema, media, destination):
                    captured["payload"] = payload
                    captured["media"] = list(media)
                    return ReviewReport(winner_id="candidate_1", accepted=True, reason="ok")

            storyboard_review.select(LocalClient(), source, script, shot, None, anchor,
                                     {"candidate_1": candidate}, root / "reviews", [], cross_shot_image=cross)
            self.assertEqual(captured["payload"]["previous_shot_final_image"], "prev.png")
            self.assertIn(cross, captured["media"])


if __name__ == "__main__":
    unittest.main()
