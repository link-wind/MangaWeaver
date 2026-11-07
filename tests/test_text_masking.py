"""OCR 词框遮罩：词框裁剪、去字参考生成与生图媒体替换。"""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from PIL import Image

from mangaweaver.planning import storyboard
from mangaweaver.preprocessing.mask_text import mask_panel
from mangaweaver.preprocessing.transcript import clip_text_boxes
from mangaweaver.schemas import Character, Panel, PanelScript, Shot, SourceManifest, SourceScript


class ClipTextBoxesTests(unittest.TestCase):
    def test_box_clipped_into_panel_coordinates(self):
        panel = Panel(panel_id="p1", image=Path("x.png"), page_id="page001", bbox=[10, 20, 60, 70])
        clip_text_boxes([panel], [[20.0, 30.0, 80.0, 90.0]])
        self.assertEqual(panel.text_boxes, [[10, 10, 50, 50]])

    def test_disjoint_box_is_skipped(self):
        panel = Panel(panel_id="p1", image=Path("x.png"), page_id="page001", bbox=[10, 20, 60, 70])
        clip_text_boxes([panel], [[70.0, 0.0, 90.0, 10.0]])
        self.assertEqual(panel.text_boxes, [])

    def test_cross_panel_box_clipped_in_both(self):
        panels = [Panel(panel_id="p1", image=Path("a.png"), page_id="page001", bbox=[0, 0, 50, 50]),
                  Panel(panel_id="p2", image=Path("b.png"), page_id="page001", bbox=[50, 0, 100, 50])]
        clip_text_boxes(panels, [[40.0, 10.0, 60.0, 20.0]])
        self.assertEqual(panels[0].text_boxes, [[40, 10, 50, 20]])
        self.assertEqual(panels[1].text_boxes, [[0, 10, 10, 20]])


class MaskPanelTests(unittest.TestCase):
    def _panel(self, root, text_boxes=()):
        image = root / "p001.png"
        Image.new("RGB", (100, 80), "black").save(image)
        return Panel(panel_id="p001", image=image, page_id="page001", bbox=[0, 0, 100, 80],
                     text_boxes=list(text_boxes))

    def test_masks_text_regions_white(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            panel = self._panel(root, text_boxes=[[10, 10, 40, 30]])
            masked = mask_panel(panel, root / "masked")
            self.assertTrue(masked.is_file())
            with Image.open(masked) as im:
                self.assertEqual(im.getpixel((25, 20)), (255, 255, 255))
                self.assertEqual(im.getpixel((3, 3)), (0, 0, 0))

    def test_no_boxes_returns_none(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertIsNone(mask_panel(self._panel(root), root / "masked"))


class StoryboardMaskedMediaTests(unittest.TestCase):
    """关键帧生成优先使用去字参考；审查与阅读链路不在本测试范围。"""

    def test_create_prefers_masked_reference(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            original = root / "p2.png"
            Image.new("RGB", (60, 40), "black").save(original)
            masked = root / "masked" / "p2.png"
            masked.parent.mkdir(parents=True)
            Image.new("RGB", (60, 40), "white").save(masked)
            characters = [Character(character_id="a", description="角色A")]
            source = SourceManifest(case_id="case1",
                                    panels=[Panel(panel_id="p2", image=original, page_id="pg1", masked_image=masked)],
                                    characters=characters)
            script = SourceScript(case_id="case1", characters=characters,
                                  panels=[PanelScript(panel_id="p2", environment="e", description="d")])
            shot = Shot(shot_id="s2", source_panel_ids=["p2"], type="static", intent="i", description="d",
                        environment="e", camera="c", duration=4.0, rationale="r")
            anchor = storyboard.anchors_for(shot, None)[0]
            captured = {}

            class LocalClient:
                config = SimpleNamespace(image_model="test", num_storyboards=1)

                def image(self, template, request, media, path):
                    captured["media"] = list(media)
                    path.write_bytes(b"candidate")

            storyboard.create(LocalClient(), source, script, shot, None, anchor, root / "out", [])
            self.assertIn(masked, captured["media"])
            self.assertNotIn(original, captured["media"])


if __name__ == "__main__":
    unittest.main()
