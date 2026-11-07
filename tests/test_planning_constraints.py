"""规划期时间与对白约束：违规在关键画面费用支出前被拒绝。"""
import unittest

from mangaweaver.schemas import (
    Anchor,
    Character,
    Dialogue,
    DirectionPlan,
    Panel,
    PanelScript,
    Shot,
    ShotList,
    SourceManifest,
    SourceScript,
    check_total_duration,
    dialogue_speaker_issues,
    segment_duration_rule,
)


def _source_and_script():
    characters = [Character(character_id="a", description="角色A")]
    panels = [Panel(panel_id=f"p{i}", image=f"p{i}.png", page_id="pg1") for i in range(1, 5)]
    source = SourceManifest(case_id="case1", panels=panels, characters=characters)
    script = SourceScript(case_id="case1", characters=characters, panels=[
        PanelScript(panel_id=f"p{i}", environment="室内", description=f"第{i}格") for i in range(1, 5)])
    return source, script


def _shot(shot_id, panel_ids, duration=8.0, kind="static"):
    return Shot(shot_id=shot_id, source_panel_ids=panel_ids, type=kind, intent="i", description="d",
                environment="e", camera="c", duration=duration, rationale="r")


class ShotOrderTests(unittest.TestCase):
    """顺序游标取前一镜头最大来源格索引：拒绝交错与嵌套，保留共享格接续。"""

    def setUp(self):
        self.script = _source_and_script()[1]

    def test_interleaved_panel_coverage_is_rejected(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1", "p3"]), _shot("s2", ["p2", "p4"])])
        with self.assertRaisesRegex(ValueError, "改变了原作事件顺序"):
            shots.check_source(self.script)

    def test_nested_panel_coverage_is_rejected(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1", "p4"]), _shot("s2", ["p2", "p3"])])
        with self.assertRaisesRegex(ValueError, "改变了原作事件顺序"):
            shots.check_source(self.script)

    def test_backjump_is_still_rejected(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p3", "p4"]), _shot("s2", ["p1", "p2"])])
        with self.assertRaisesRegex(ValueError, "改变了原作事件顺序"):
            shots.check_source(self.script)

    def test_shared_panel_continuation_is_allowed(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1", "p2"], 4.0), _shot("s2", ["p2", "p3"], 4.0),
                                                 _shot("s3", ["p3", "p4"], 4.0)])
        self.assertIs(shots.check_source(self.script), shots)


class SegmentDurationTests(unittest.TestCase):
    """静态镜头时长即单段时长，动作镜头相邻锚点差即段长，都必须是 4～15 整数秒。"""

    def setUp(self):
        self.script = _source_and_script()[1]

    def test_static_duration_outside_backend_limits_is_rejected(self):
        for duration in (3.0, 4.5, 16.0):
            shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1"], duration)])
            with self.assertRaisesRegex(ValueError, "整数秒"):
                shots.check_source(self.script)

    def test_static_duration_within_limits_is_accepted(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1"], 5.0), _shot("s2", ["p2"], 4.0),
                                                 _shot("s3", ["p3"], 4.0), _shot("s4", ["p4"], 4.0)])
        self.assertIs(shots.check_source(self.script), shots)

    def test_action_anchor_gap_outside_limits_is_rejected(self):
        shot = _shot("s1", ["p1"], 12.0, "action")
        plan = DirectionPlan(shot_id="s1", entry="e", source_moment="m", exit="x", rhythm="r", anchors=[
            Anchor(keyframe_id="k1", time=0.0, role="entry", description="d", source_panel_ids=["p1"]),
            Anchor(keyframe_id="k2", time=5.5, role="source_moment", description="d", source_panel_ids=["p1"]),
            Anchor(keyframe_id="k3", time=12.0, role="exit", description="d", source_panel_ids=["p1"])])
        with self.assertRaisesRegex(ValueError, "相邻关键帧间隔"):
            plan.check_shot(shot)

    def test_action_anchor_gaps_within_limits_are_accepted(self):
        shot = _shot("s1", ["p1"], 12.0, "action")
        plan = DirectionPlan(shot_id="s1", entry="e", source_moment="m", exit="x", rhythm="r", anchors=[
            Anchor(keyframe_id="k1", time=0.0, role="entry", description="d", source_panel_ids=["p1"]),
            Anchor(keyframe_id="k2", time=4.0, role="source_moment", description="d", source_panel_ids=["p1"]),
            Anchor(keyframe_id="k3", time=12.0, role="exit", description="d", source_panel_ids=["p1"])])
        self.assertIs(plan.check_shot(shot), plan)


class SpeakerAttributionTests(unittest.TestCase):
    """待配音对白必须有确定说话人，未确定项转为阻断问题。"""

    def test_unresolved_speaker_becomes_blocking_issue(self):
        script = _source_and_script()[1]
        script.panels[0].dialogue = [Dialogue(text="你好", speaker_id=None)]
        issues = dialogue_speaker_issues(script)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].target, "script")
        self.assertEqual(issues[0].severity, "blocking")
        self.assertIn("p1", issues[0].location)

    def test_attributed_speaker_passes(self):
        script = _source_and_script()[1]
        script.panels[0].dialogue = [Dialogue(text="你好", speaker_id="a")]
        self.assertEqual(dialogue_speaker_issues(script), [])


class TotalDurationTests(unittest.TestCase):
    def test_total_mismatch_is_rejected(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1"], 8.0), _shot("s2", ["p2"], 8.0)])
        with self.assertRaisesRegex(ValueError, "总时长"):
            check_total_duration(shots, 12.0)

    def test_total_match_and_unset_target_pass(self):
        shots = ShotList(case_id="case1", shots=[_shot("s1", ["p1"], 8.0), _shot("s2", ["p2"], 4.0)])
        check_total_duration(shots, 12.0)
        check_total_duration(shots, 0.0)
        check_total_duration(shots, None)

    def test_rule_text_matches_constants(self):
        self.assertEqual(segment_duration_rule(), "4..15 integer")


if __name__ == "__main__":
    unittest.main()
