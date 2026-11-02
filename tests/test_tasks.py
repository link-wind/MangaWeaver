"""只验证容易出错的映射与时间协议，不模拟模型质量。"""
import unittest
from pathlib import Path

from pydantic import ValidationError

from mangaweaver.clients.minimax import payload, validate_task
from mangaweaver.config import Config
from mangaweaver.generation.tasks import build, load_plan
from mangaweaver.schemas import ProductionPlan

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


class TaskProtocolTests(unittest.TestCase):
    def test_source_moment_is_internal_boundary(self):
        plan = load_plan(EXAMPLES / "key-moment/production.json")
        left, right = build(plan)
        self.assertEqual((left.start_time, left.end_time, right.end_time), (0, 4, 8))
        self.assertEqual(left.last_frame, right.first_frame)
        self.assertEqual(left.source_panel_ids, ["p001"])
        request = payload(left, Config())
        self.assertEqual((request["model"], request["resolution"]), ("MiniMax-H3-Lite", "480P"))
        self.assertEqual([c.get("role") for c in request["content"]][1:],
                         ["first_frame", "last_frame"])

    def test_cross_panel_action_and_static_routes(self):
        jobs = build(load_plan(EXAMPLES / "cross-panel/production.json"))
        self.assertEqual([j.mode for j in jobs], ["first_last_frame", "first_last_frame", "first_frame"])
        self.assertEqual(jobs[0].source_panel_ids, ["p001", "p002"])
        self.assertIsNone(jobs[-1].last_frame)
        self.assertEqual(sum(j.target_duration for j in jobs), 12)
        short = jobs[0].model_copy(update={"target_duration": 2.0, "end_time": 2.0})
        with self.assertRaisesRegex(ValueError, "4～15"):
            validate_task(short, Config())

    def test_missing_anchor_and_stale_plan_are_rejected(self):
        plan = load_plan(EXAMPLES / "key-moment/production.json")
        missing = plan.model_dump(mode="json")
        missing["assets"].pop(1)
        with self.assertRaisesRegex(ValidationError, "缺失锚点"):
            ProductionPlan.model_validate(missing)
        stale = plan.model_dump(mode="json")
        stale["shot_list"]["shots"][0]["camera"] = "另一机位"
        with self.assertRaisesRegex(ValidationError, "旧版本方案"):
            ProductionPlan.model_validate(stale)


if __name__ == "__main__":
    unittest.main()
