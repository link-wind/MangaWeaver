"""段级重提与仅重组装：归档语义、反馈回流与拒绝路径。"""
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from mangaweaver.generation.pipeline import export_from_disk, job_signature
from mangaweaver.generation.redo import redo_segment
from mangaweaver.generation.tasks import build, load_plan
from mangaweaver.config import Config
from mangaweaver.io import read_json
from mangaweaver.schemas import ReviewReport

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


class SubmitClient:
    def __init__(self):
        self.submitted = []

    def submit(self, job):
        self.submitted.append(job.segment_id)
        return f"T-{len(self.submitted)}"


class RedoSegmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = Config()
        self.plan = load_plan(EXAMPLES / "cross-panel/production.json")
        self.job = next(j for j in build(self.plan, self.root / "video_frames") if j.segment_id == "s001_seg01")
        self.directory = self.root / "video" / "s001" / "s001_seg01"
        self.directory.mkdir(parents=True)
        self.state = {"signature": job_signature(self.job, self.config),
                      "request": {"model": "MiniMax-H3-Lite", "resolution": "480P", "mode": "first_last_frame",
                                  "requested_duration": 4.0},
                      "candidates": {"candidate_1": {"status": "downloaded", "task_id": "T1",
                                                     "path": str(self.directory / "candidate_1.mp4")}}}
        (self.directory / "candidate_1.mp4").write_bytes(b"video")
        (self.directory / "tasks.json").write_text(json.dumps(self.state), encoding="utf-8")
        (self.directory / "review.json").write_text('{"winner_id":"candidate_1","accepted":false,"reason":"冲击不足"}', encoding="utf-8")
        (self.directory / "review.input.json").write_text('{"signature":"old"}', encoding="utf-8")
        (self.directory / "selected.json").write_text('{"video":"candidate_1.mp4","review":{}}', encoding="utf-8")

    def _redo(self, feedback="加强击中瞬间的受力表现"):
        return redo_segment(self.config, self.plan, self.root, "s001_seg01", feedback, client=SubmitClient())

    def test_redo_archives_and_resubmits(self):
        result = self._redo()
        state = read_json(self.directory / "tasks.json")
        self.assertTrue((self.directory / "candidate_1.rejected-1.mp4").is_file())
        self.assertFalse((self.directory / "candidate_1.mp4").exists())
        self.assertEqual(state["superseded"][0]["task_id"], "T1")
        self.assertEqual(state["redo_round"], 1)
        self.assertFalse((self.directory / "review.json").exists())
        self.assertTrue((self.directory / "review.rejected-1.json").is_file())
        self.assertFalse((self.directory / "review.input.json").exists())
        self.assertTrue((self.directory / "selected.rejected-1.json").is_file())
        redo = read_json(self.directory / "redo.json")
        self.assertEqual(redo["feedback"], "加强击中瞬间的受力表现")
        self.assertIn("T-1", [c["task_id"] for c in state["candidates"].values()])
        self.assertEqual(result["superseded"], 1)

    def test_second_redo_increments_round(self):
        self._redo()
        # 模拟一轮失败后再次重提。
        state_path = self.directory / "tasks.json"
        state = read_json(state_path)
        for entry in state["candidates"].values():
            Path(entry["path"]).write_bytes(b"video2")
            entry["task_id"] = "T-1"
            entry["status"] = "downloaded"
        (self.directory / "review.json").write_text("{}", encoding="utf-8")
        (self.directory / "review.input.json").write_text('{"signature":"new"}', encoding="utf-8")
        redo_segment(self.config, self.plan, self.root, "s001_seg01", "", client=SubmitClient())
        self.assertTrue((self.directory / "candidate_1.rejected-2.mp4").is_file())
        self.assertEqual(len(read_json(state_path)["superseded"]), 2)

    def test_redo_refuses_unknown_segment(self):
        with self.assertRaisesRegex(ValueError, "没有视频段"):
            redo_segment(self.config, self.plan, self.root, "missing", client=SubmitClient())

    def test_redo_refuses_segment_without_submission(self):
        with self.assertRaisesRegex(ValueError, "尚无提交记录"):
            redo_segment(self.config, self.plan, self.root, "s002_seg01", client=SubmitClient())

    def test_redo_refuses_changed_input(self):
        self.state["signature"] = "tampered"
        (self.directory / "tasks.json").write_text(json.dumps(self.state), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "输入已改变"):
            self._redo()


class ReviewFeedbackTests(unittest.TestCase):
    def test_select_payload_carries_redo_feedback(self):
        from mangaweaver.generation import video_review

        class LocalClient:
            def json_to(self, template, payload, schema, media, destination, video=False):
                self.payload = payload
                return ReviewReport(winner_id="candidate_1", accepted=True, reason="ok")

        plan = load_plan(EXAMPLES / "cross-panel/production.json")
        shot = plan.shot_list.shots[0]
        candidate = EXAMPLES / "cross-panel/entry.png"
        reviewer = LocalClient()
        video_review.select(reviewer, plan, shot, {"candidate_1": candidate}, Path("review.json"),
                            segment=plan.directions[0], feedback="加强冲击")
        self.assertEqual(reviewer.payload["redo_feedback"], "加强冲击")
        video_review.select(reviewer, plan, shot, {"candidate_1": candidate}, Path("review.json"),
                            segment=plan.directions[0])
        self.assertIsNone(reviewer.payload["redo_feedback"])


class ExportFromDiskTests(unittest.TestCase):
    def test_missing_speech_plan_is_rejected(self):
        with TemporaryDirectory() as temp:
            plan = load_plan(EXAMPLES / "cross-panel/production.json")
            with self.assertRaisesRegex(ValueError, "对白计划"):
                export_from_disk(plan, Path(temp))


if __name__ == "__main__":
    unittest.main()
