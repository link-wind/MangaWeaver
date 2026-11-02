"""局部规划失败不能丢掉已通过素材，也不能混用变更设计的素材。"""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from mangaweaver.generation.tasks import load_plan
from mangaweaver.planning.pipeline import _draft
from mangaweaver.schemas import ReviewReport


class PlanningRetentionTests(unittest.TestCase):
    def test_keep_only_approved_unchanged_shots_after_direction_failure(self):
        plan = load_plan(Path(__file__).resolve().parents[1] / "examples/cross-panel/production.json")
        plan.reviews = [ReviewReport(scope=f"storyboard:{s.shot_id}", winner_id="candidate_1",
                                     accepted=True, reason="fixture") for s in plan.shot_list.shots]
        directions = [d.model_copy(update={"entry": d.entry + " changed"}) for d in plan.directions]
        static_ids = {s.shot_id for s in plan.shot_list.shots if s.type == "static"}
        with TemporaryDirectory() as temp:
            root = Path(temp)
            saved = _draft(root/"iter", root, plan.script, plan.shot_list, directions, [], [], plan)
            self.assertEqual({a.shot_id for a in saved.assets}, static_ids)
            self.assertTrue(all(r.accepted for r in saved.reviews))
            changed_script = plan.script.model_copy(deep=True)
            changed_script.characters[0].description += " changed"
            invalid = _draft(root/"iter2", root, changed_script, plan.shot_list, directions, [], [], plan)
            self.assertEqual(invalid.assets, [])
