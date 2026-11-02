"""跨阶段 JSON 契约：来源格、镜头、关键帧与生成段各有独立身份。"""
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

ID = str


def unique(values, label):
    if len(values) != len(set(values)):
        raise ValueError(f"{label} 包含重复 ID")


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Character(Model):
    character_id: ID
    description: str


class CharacterList(Model):
    characters: list[Character] = Field(min_length=1)


class Panel(Model):
    panel_id: ID = Field(pattern=r"^[A-Za-z0-9_-]+$")
    image: Path
    page_id: str
    text: str = ""
    uncertainties: list[str] = Field(default_factory=list)
    bbox: list[int] | None = None


class SourceManifest(Model):
    case_id: str = Field(pattern=r"^[A-Za-z0-9_-]+$")
    panels: list[Panel] = Field(min_length=1)
    reference_images: list[Path] = Field(default_factory=list)
    characters: list[Character] = Field(default_factory=list)
    transcript: str = ""
    creative_brief: str = ""

    @model_serializer(mode="wrap")
    def serialize_brief(self, handler):
        data = handler(self)
        if not self.creative_brief:
            data.pop("creative_brief", None)  # 保持旧来源快照与签名不变。
        return data

    @model_validator(mode="after")
    def ids(self):
        unique([p.panel_id for p in self.panels], "来源格")
        unique([c.character_id for c in self.characters], "角色")
        return self

    @property
    def images(self):
        return [p.image for p in self.panels]


class Dialogue(Model):
    speaker_id: str | None = None
    text: str


class PanelScript(Model):
    panel_id: ID
    environment: str
    description: str
    facts: list[str] = Field(default_factory=list)
    inferences: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    dialogue: list[Dialogue] = Field(default_factory=list)
    character_ids: list[str] = Field(default_factory=list)


class SourceScript(Model):
    case_id: str
    characters: list[Character]
    panels: list[PanelScript] = Field(min_length=1)

    def check_source(self, source: SourceManifest):
        if self.case_id != source.case_id:
            raise ValueError("来源脚本与输入 case_id 不同")
        if [p.panel_id for p in self.panels] != [p.panel_id for p in source.panels]:
            raise ValueError("来源脚本必须按原顺序完整覆盖输入漫画格")
        char_ids = {c.character_id for c in self.characters}
        if source.characters and char_ids != {c.character_id for c in source.characters}:
            raise ValueError("来源脚本必须保留已确定的角色 ID")
        unique([c.character_id for c in self.characters], "角色")
        for panel in self.panels:
            if not set(panel.character_ids) <= char_ids:
                raise ValueError(f"{panel.panel_id} 引用了未知角色")
            if any(d.speaker_id is not None and d.speaker_id not in char_ids for d in panel.dialogue):
                raise ValueError(f"{panel.panel_id} 对白引用未知角色")
        return self


class Shot(Model):
    shot_id: ID = Field(pattern=r"^[A-Za-z0-9_-]+$")
    source_panel_ids: list[str] = Field(min_length=1)
    type: Literal["static", "action"]
    intent: str
    description: str
    environment: str
    camera: str
    duration: float = Field(gt=0)
    rationale: str
    character_ids: list[str] = Field(default_factory=list)
    transition: Literal["cut"] = "cut"


class ShotList(Model):
    case_id: str
    shots: list[Shot] = Field(min_length=1)

    def check_source(self, script: SourceScript):
        unique([s.shot_id for s in self.shots], "镜头")
        if self.case_id != script.case_id:
            raise ValueError("镜头清单与来源脚本 case_id 不同")
        order = {p.panel_id: i for i, p in enumerate(script.panels)}
        char_ids = {c.character_id for c in script.characters}
        covered = set()
        last = -1
        for shot in self.shots:
            unique(shot.source_panel_ids, f"{shot.shot_id} 来源")
            if not set(shot.source_panel_ids) <= set(order):
                raise ValueError(f"{shot.shot_id} 引用了未知来源格")
            if not set(shot.character_ids) <= char_ids:
                raise ValueError(f"{shot.shot_id} 引用了未知角色")
            indices = [order[p] for p in shot.source_panel_ids]
            if indices != sorted(indices) or min(indices) < last:
                raise ValueError(f"{shot.shot_id} 改变了原作事件顺序")
            last = min(indices)
            covered.update(shot.source_panel_ids)
        if covered != set(order):
            raise ValueError(f"编排未覆盖来源格：{set(order) - covered}")
        return self


class Anchor(Model):
    keyframe_id: ID = Field(pattern=r"^[A-Za-z0-9_-]+$")
    time: float = Field(ge=0)
    role: Literal["entry", "source_moment", "beat", "exit"]
    description: str
    source_panel_ids: list[str] = Field(default_factory=list)
    inferred: bool = False


class DirectionPlan(Model):
    shot_id: str
    entry: str
    source_moment: str
    exit: str
    rhythm: str
    anchors: list[Anchor] = Field(min_length=2)

    def check_shot(self, shot: Shot):
        if shot.type != "action" or self.shot_id != shot.shot_id:
            raise ValueError("演出方案必须对应当前动作镜头")
        unique([a.keyframe_id for a in self.anchors], "关键帧")
        times = [a.time for a in self.anchors]
        if times[0] != 0 or abs(times[-1] - shot.duration) > 1e-6:
            raise ValueError(f"{shot.shot_id} 锚点必须覆盖 0 到镜头时长")
        if any(b <= a for a, b in zip(times, times[1:])):
            raise ValueError(f"{shot.shot_id} 锚点时间必须严格递增")
        if not any(a.source_panel_ids for a in self.anchors):
            raise ValueError("至少一个关键画面需要明确关联原漫画瞬间")
        for anchor in self.anchors:
            if not set(anchor.source_panel_ids) <= set(shot.source_panel_ids):
                raise ValueError(f"{anchor.keyframe_id} 引用了当前镜头之外的来源格")
        return self


class VisualAsset(Model):
    keyframe_id: str
    shot_id: str
    time: float = Field(ge=0)
    image: Path
    description: str
    source_panel_ids: list[str]
    plan_signature: str
    image_signature: str


class Issue(Model):
    target: Literal["script", "arrangement", "direction", "storyboard", "video"]
    location: str
    severity: Literal["warning", "blocking"]
    evidence: str
    suggestion: str


class ReviewReport(Model):
    scope: str = ""
    winner_id: str
    accepted: bool
    reason: str
    issues: list[Issue] = Field(default_factory=list)

    @model_validator(mode="after")
    def coherent(self):
        if not self.accepted and not self.issues:
            raise ValueError("未通过时必须提供可定位的修订问题")
        if self.accepted and any(i.severity == "blocking" for i in self.issues):
            raise ValueError("存在阻断问题时不能 accepted=true")
        return self

    def winner(self, candidates: dict):
        if self.winner_id not in candidates:
            raise ValueError(f"评审选择了不存在的候选：{self.winner_id}")
        return candidates[self.winner_id]


class ProductionPlan(Model):
    source: SourceManifest
    script: SourceScript
    shot_list: ShotList
    directions: list[DirectionPlan]
    assets: list[VisualAsset]
    reviews: list[ReviewReport] = Field(default_factory=list)

    @model_validator(mode="after")
    def check(self):
        self.script.check_source(self.source)
        self.shot_list.check_source(self.script)
        unique([d.shot_id for d in self.directions], "演出镜头")
        unique([(a.shot_id, a.keyframe_id) for a in self.assets], "视觉素材")
        direction_map = {d.shot_id: d for d in self.directions}
        assets = {(a.shot_id, a.keyframe_id): a for a in self.assets}
        shot_ids = {s.shot_id for s in self.shot_list.shots}
        action_ids = {s.shot_id for s in self.shot_list.shots if s.type == "action"}
        if set(direction_map) != action_ids:
            raise ValueError("动作演出方案必须恰好覆盖动作镜头")
        if any(a.shot_id not in shot_ids for a in self.assets):
            raise ValueError("视觉素材引用未知镜头")
        for shot in self.shot_list.shots:
            if shot.type == "static":
                current = [a for a in self.assets if a.shot_id == shot.shot_id]
                if len(current) != 1 or current[0].time != 0:
                    raise ValueError(f"{shot.shot_id} 必须有一张起始分镜")
                expected = shot
            else:
                expected = direction_map[shot.shot_id].check_shot(shot)
                expected_ids = {a.keyframe_id for a in expected.anchors}
                if {a.keyframe_id for a in self.assets if a.shot_id == shot.shot_id} != expected_ids:
                    raise ValueError(f"{shot.shot_id} 存在多余或缺失锚点素材")
                current = [assets[(shot.shot_id, a.keyframe_id)] for a in expected.anchors]
                if any(a.source_panel_ids != b.source_panel_ids for a, b in zip(current, expected.anchors)):
                    raise ValueError(f"{shot.shot_id} 素材与演出来源映射不同")
                if [a.time for a in current] != [a.time for a in expected.anchors]:
                    raise ValueError(f"{shot.shot_id} 素材与演出时间不同")
            from .io import signature
            for asset in current:
                if asset.plan_signature != signature({"script": signature(self.script), "shot": shot.model_dump(mode="json"), "direction": expected.model_dump(mode="json")}):
                    raise ValueError(f"{shot.shot_id} 画面属于旧版本方案，请显式重跑分镜")
        return self


class VideoTask(Model):
    segment_id: str
    shot_id: str
    source_panel_ids: list[str]
    mode: Literal["first_frame", "first_last_frame"]
    first_keyframe_id: str
    last_keyframe_id: str | None = None
    first_frame: Path
    last_frame: Path | None = None
    target_duration: float = Field(gt=0)
    prompt: str = Field(min_length=1)
    start_time: float = Field(ge=0)
    end_time: float = Field(gt=0)

    @model_validator(mode="after")
    def coherent(self):
        if (self.last_frame is None) != (self.last_keyframe_id is None):
            raise ValueError("尾帧 ID 与图像必须同时提供")
        if (self.mode == "first_last_frame") != (self.last_frame is not None):
            raise ValueError("首尾帧任务必须有尾帧，静态任务不能有尾帧")
        if abs(self.end_time - self.start_time - self.target_duration) > 1e-6:
            raise ValueError("生成段时间范围与目标时长不一致")
        return self


class AgentArguments(Model):
    """有限工具参数；文件路径由项目索引解析。"""
    page: int | None = None
    new_run: bool = False
    stage: Literal['preprocess', 'script', 'arrangement', 'direction', 'storyboard', 'video'] = 'script'
    goal: str = ''
    location: str = 'all'
    revise: bool = False
    operation: Literal['select', 'focus', 'layout', 'open_details'] = 'focus'
    node_ids: list[str] = Field(default_factory=list)
    dx: float = 0
    dy: float = 0
    panel_id: str = ''
    text: str = ''


class AgentAction(Model):
    kind: Literal['reply', 'ask_user', 'call_tool']
    text: str = Field(default='', max_length=20000)
    tool: Literal['read_project', 'read_pages', 'select_page', 'create_run', 'preprocess_page', 'delegate',
                  'revise_source', 'generate', 'resume', 'control_canvas', 'produce'] = 'read_project'
    arguments: AgentArguments = Field(default_factory=AgentArguments)


class MessageDecision(Model):
    intent: Literal['question', 'revision', 'task', 'stop', 'needs_user']
    text: str = Field(max_length=20000)
    stage: Literal['script', 'arrangement', 'direction', 'storyboard'] | None = None
    location: str = ''


class TaskBrief(Model):
    parent_id: str
    stage: str
    goal: str
    run: str
    input_version: str
    target: str
    permissions: list[str]
    references: list[dict] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    expected_output: str


class TaskReport(Model):
    status: str
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    reviews: list[dict] = Field(default_factory=list)
    reused: bool = False
    reason: str = ''
    next_receiver: str = ''
