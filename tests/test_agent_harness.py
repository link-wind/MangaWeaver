"""声明式编排清单与画布架构视图的最小映射测试；不请求模型，也不覆盖执行门禁。"""
import unittest

from mangaweaver.agent.harness import STAGES
from mangaweaver.agent import stages, tasks
from mangaweaver.desktop import dispatch


class AgentHarnessTest(unittest.TestCase):
    def test_stage_order_roles_and_requires(self):
        ids = [stage["id"] for stage in STAGES]
        self.assertEqual(ids, ["preprocess", "script", "arrangement", "direction", "storyboard", "video"])
        for index, stage in enumerate(STAGES):
            self.assertEqual(stage["requires"], [ids[index - 1]] if index else [])
            for key in ("id", "label", "creators", "reviewers", "gate", "on_fail", "requires"):
                self.assertIn(key, stage)
            self.assertTrue(stage["gate"].strip())

    def test_reviewable_stages_have_creator_and_reviewer(self):
        for stage in STAGES:
            if stage["id"] == "preprocess":
                self.assertEqual(stage["creators"], [])
                self.assertEqual(stage["reviewers"], [])
                continue
            self.assertTrue(stage["creators"], stage["id"])
            self.assertTrue(stage["reviewers"], stage["id"])

    def test_stage_labels_derive_from_manifest(self):
        expected = {stage["id"]: stage["label"] for stage in STAGES}
        self.assertEqual(stages.LABELS, expected)
        self.assertEqual({key: tasks.LABELS[key] for key in expected}, expected)

    def test_read_agent_harness_is_static_and_does_not_touch_run(self):
        result = dispatch({"command": "read_agent_harness"})
        self.assertEqual(result["stages"], STAGES)


if __name__ == "__main__":
    unittest.main()
