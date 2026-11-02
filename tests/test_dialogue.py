"""检查对白来源、分段时间和 H3 端点标记，不模拟生成质量。"""
import unittest
from types import SimpleNamespace
from pathlib import Path

from mangaweaver.planning.dialogue import SpeechPlan, SegmentSpeech, SpeechCue, h3_prompt
from mangaweaver.schemas import Dialogue, Character, VideoTask


class DialogueTests(unittest.TestCase):
    def setUp(self):
        self.plan = SimpleNamespace(script=SimpleNamespace(
            characters=[Character(character_id="c1", description="老人")],
            panels=[SimpleNamespace(panel_id="p1", dialogue=[Dialogue(speaker_id="c1", text="去学校吧！")])]))
        self.job = VideoTask(segment_id="s1_seg01", shot_id="s1", source_panel_ids=["p1"],
            mode="first_frame", first_keyframe_id="k0", first_frame=Path("first.png"),
            target_duration=10, prompt="draft", start_time=0, end_time=10)
        self.cue = SpeechCue(cue_id="d1", panel_id="p1", dialogue_index=0, speaker_id="c1",
            japanese="学校に行こう！", subtitle_zh="去学校吧！", delivery="spoken",
            voice_en="a warm elderly voice", start=1, end=3)
        self.segment = SegmentSpeech(segment_id="s1_seg01", description_en="The man smiles.",
            soundscape_en="Quiet room tone.", cues=[self.cue])

    def test_provenance_and_no_duplicate_or_cross_boundary_speech(self):
        SpeechPlan(segments=[self.segment]).check(self.plan, [self.job])
        for bad in [self.cue.model_copy(update={"speaker_id":"other"}),
                    self.cue.model_copy(update={"subtitle_zh":"新增台词"}),
                    self.cue.model_copy(update={"end":11})]:
            with self.assertRaises(ValueError):
                SpeechPlan(segments=[self.segment.model_copy(update={"cues":[bad]})]).check(self.plan,[self.job])
        with self.assertRaises(ValueError):
            SpeechPlan(segments=[self.segment.model_copy(update={"cues":[self.cue,self.cue]})]).check(self.plan,[self.job])

    def test_japanese_voiceover_and_first_last_frame_format(self):
        segment = self.segment.model_copy(update={"cues":[self.cue.model_copy(update={"delivery":"voiceover"})]})
        job = self.job.model_copy(update={"mode":"first_last_frame","last_frame":Path("last.png"),"last_keyframe_id":"k1"})
        prompt = h3_prompt(self.plan,job,segment)
        self.assertIn("10.00-second mark",prompt.splitlines()[0])
        self.assertIn("(S1) says in an off-screen voiceover",prompt)
        self.assertIn("<d>[Japanese] 学校に行こう！</d>",prompt)
        self.assertIn("lips remain completely closed",prompt)
        self.assertIn("non_diegetic_music: N/A",prompt)
        self.assertNotIn("去学校吧",prompt)
        sung = self.segment.model_copy(update={"cues":[self.cue.model_copy(update={"delivery":"singing"})]})
        self.assertIn("sings unaccompanied: <d>[Japanese]", h3_prompt(self.plan,job,sung))
        silent = self.segment.model_copy(update={"cues":[]})
        self.assertIn("no intelligible speech or sung words", h3_prompt(self.plan,job,silent))
