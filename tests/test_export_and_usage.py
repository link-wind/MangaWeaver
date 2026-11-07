"""导出分辨率配置与用量汇总：画布推导、配置校验与只读统计。"""
import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from mangaweaver.config import Config
from mangaweaver.generation.assembly import assemble
from mangaweaver.generation.usage import summarize
from mangaweaver.io import read_json


def _clip(path: Path, size="640x360"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={size}:d=0.3",
                    "-f", "lavfi", "-i", "sine=frequency=440:d=0.3", "-shortest",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)],
                   check=True, capture_output=True)


class ExportResolutionTests(unittest.TestCase):
    def test_source_follows_segment_size(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            _clip(root / "a.mp4")
            assemble([root / "a.mp4"], root / "out.mp4")
            video = next(s for s in _probe(root / "out.mp4")["streams"] if s["codec_type"] == "video")
            self.assertEqual((video["width"], video["height"]), (640, 360))

    def test_explicit_tier_upscales_to_target(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            _clip(root / "a.mp4")
            assemble([root / "a.mp4"], root / "out.mp4", export_resolution="720P")
            video = next(s for s in _probe(root / "out.mp4")["streams"] if s["codec_type"] == "video")
            self.assertEqual((video["width"], video["height"]), (1280, 720))

    def test_invalid_export_resolution_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "EXPORT_RESOLUTION"):
            Config.from_values({"EXPORT_RESOLUTION": "4K"})

    def test_default_is_source(self):
        self.assertEqual(Config().export_resolution, "source")


class UsageSummaryTests(unittest.TestCase):
    def test_aggregates_calls_and_video_submissions(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "planning_usage.json").write_text(json.dumps(
                {"successful_calls": 3, "usage": [{"totalTokenCount": 100}], "image_usage": [{"totalTokenCount": 50}]}), encoding="utf-8")
            segment = root / "video" / "s001" / "s001_seg01"
            segment.mkdir(parents=True)
            (segment / "tasks.json").write_text(json.dumps(
                {"request": {"model": "MiniMax-H3-Lite", "resolution": "480P", "requested_duration": 4.0},
                 "candidates": {"candidate_1": {"task_id": "T1", "status": "submitted"}},
                 "superseded": [{"task_id": "T0", "round": 1}]}), encoding="utf-8")
            summary = summarize(root)
            self.assertEqual(summary["model_calls"], 3)
            self.assertEqual(summary["total_tokens"], 150)
            video = summary["video"]["segments"][0]
            self.assertEqual(video["total_submissions"], 2)
            self.assertEqual(video["submitted_seconds"], 8.0)
            self.assertEqual(summary["video"]["total_submissions"], 2)
            self.assertTrue((root / "usage_summary.json").is_file())

    def test_empty_run_yields_zeroes(self):
        with TemporaryDirectory() as temp:
            summary = summarize(Path(temp))
            self.assertEqual(summary["model_calls"], 0)
            self.assertEqual(summary["video"]["total_submissions"], 0)


def _probe(path: Path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


if __name__ == "__main__":
    unittest.main()
