"""视频提交前准备日语台词与时间安排，沿用有限 Creator／Reviewer。"""
from pydantic import Field

from ..io import write_json
from ..schemas import Model, ReviewReport, unique


class SpeechCue(Model):
    cue_id: str
    panel_id: str
    dialogue_index: int = Field(ge=0)
    speaker_id: str
    japanese: str = Field(min_length=1)
    subtitle_zh: str = Field(min_length=1)
    delivery: str = Field(pattern=r"^(spoken|voiceover|singing)$")
    voice_en: str = Field(min_length=1)
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class SegmentSpeech(Model):
    segment_id: str
    description_en: str = Field(min_length=1)
    soundscape_en: str = Field(min_length=1)
    cues: list[SpeechCue] = Field(default_factory=list)


class SpeechPlan(Model):
    segments: list[SegmentSpeech]

    def check(self, plan, jobs):
        unique([s.segment_id for s in self.segments], "声音生成段")
        if {s.segment_id for s in self.segments} != {j.segment_id for j in jobs}:
            raise ValueError("声音计划必须恰好覆盖所有视频生成段")
        job_map = {j.segment_id: j for j in jobs}
        panels = {p.panel_id: p for p in plan.script.panels}
        seen, cue_ids, voices = set(), [], {}
        for segment in self.segments:
            job = job_map[segment.segment_id]
            previous_end = 0
            for cue in segment.cues:
                if cue.panel_id not in job.source_panel_ids:
                    raise ValueError(f"{cue.cue_id} 对白不属于该生成段来源")
                lines = panels[cue.panel_id].dialogue
                if cue.dialogue_index >= len(lines):
                    raise ValueError(f"{cue.cue_id} 引用不存在的原作对白")
                original = lines[cue.dialogue_index]
                if original.speaker_id is None or cue.speaker_id != original.speaker_id:
                    raise ValueError(f"{cue.cue_id} 对白说话人不确定或不一致，需修订来源脚本")
                if cue.subtitle_zh != original.text:
                    raise ValueError(f"{cue.cue_id} 中文字幕必须沿用已审查原文")
                if not previous_end <= cue.start < cue.end <= job.target_duration:
                    raise ValueError(f"{cue.cue_id} 台词时间重叠或超出片段")
                previous_end = cue.end
                reference = (cue.panel_id, cue.dialogue_index)
                if reference in seen:
                    raise ValueError(f"{cue.cue_id} 重复分配原作对白")
                seen.add(reference)
                cue_ids.append(cue.cue_id)
                if cue.speaker_id in voices and voices[cue.speaker_id] != cue.voice_en:
                    raise ValueError("同一角色的声线描述必须一致")
                voices[cue.speaker_id] = cue.voice_en
                if any(mark in cue.japanese for mark in ("<", ">", "[", "]")):
                    raise ValueError("日语台词不能包含提示词控制标记")
        unique(cue_ids, "台词 ID")
        expected = {(p.panel_id, i) for p in plan.script.panels for i in range(len(p.dialogue))}
        if seen != expected:
            raise ValueError("声音计划遗漏原作对白；需调整镜头时长或显式修改改编方案")
        return self


def prepare(client, plan, jobs, directory):
    feedback = []
    for iteration in range(client.config.iterations):
        folder = directory / f"iter{iteration}"
        payload = {"script": plan.script.model_dump(mode="json"),
                   "shots": plan.shot_list.model_dump(mode="json"),
                   "directions": [d.model_dump(mode="json") for d in plan.directions],
                   "planning_warnings": [i.model_dump() for r in plan.reviews if r.accepted
                                         for i in r.issues if i.severity == "warning"],
                   "segments": [j.model_dump(mode="json") for j in jobs], "feedback": feedback}
        result = client.json_to("planning/dialogue/create.txt", payload, SpeechPlan,
                                plan.source.images + plan.source.reference_images, folder / "candidate.json")
        result.check(plan, jobs)
        report = client.json_to("planning/dialogue/review.txt", {**payload,
            "candidate_id": "speech_plan", "speech_plan": result.model_dump(mode="json")},
            ReviewReport, plan.source.images + plan.source.reference_images, folder / "review.json")
        if report.winner_id != "speech_plan":
            raise ValueError("对白评审选择了不存在的候选")
        if report.accepted:
            write_json(directory / "selected.json", result)
            return result
        feedback = [i.model_dump() for i in report.issues]
    raise ValueError("日语对白／翻译审查未通过：" + report.reason)


def h3_prompt(plan, job, segment):
    if job.last_frame:
        header = ("How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; "
                  f"Picture 2 (from Shot 1) aligns with the {job.target_duration:.2f}-second mark of the target video.")
    else:
        header = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."
    speakers = {c.character_id: f"S{i+1}" for i, c in enumerate(plan.script.characters)}
    description = "[Shot 1] Full-color 2D animation. " + segment.description_en
    for cue in segment.cues:
        voice = cue.voice_en.rstrip(".")
        speaker = f"The character {cue.speaker_id}, with {voice} ({speakers[cue.speaker_id]})"
        if cue.delivery == "voiceover":
            speech = f"{speaker} says in an off-screen voiceover: <d>[Japanese] {cue.japanese}</d> while the character's lips remain completely closed."
        elif cue.delivery == "singing":
            speech = f"{speaker} sings unaccompanied: <d>[Japanese] {cue.japanese}</d> with lip movements synchronized to these Japanese lyrics."
        else:
            speech = f"{speaker} says: <d>[Japanese] {cue.japanese}</d> with lip movements synchronized to this Japanese line."
        description += f" Between {cue.start:.2f} and {cue.end:.2f} seconds, {speech}"
    description += ((" All spoken words and lyrics are exactly the Japanese lines specified above. " if segment.cues else
                     " This segment has no intelligible speech or sung words. ")
                    + "During the remaining moments the characters react naturally with only the specified non-verbal sounds and ambience. "
                    "The frame stays free of text, speech bubbles and burned-in subtitles; subtitles are added in post-production.")
    return (f"{header}\n\nintegrated_multimodal_description: {description}\n\n"
            f"overall_soundscape: {segment.soundscape_en}\n\nnon_diegetic_music: N/A")
