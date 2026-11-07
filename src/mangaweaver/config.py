"""运行参数；凭据留在环境中，不写入配置快照。"""
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    model_provider: str = "kie"
    kie_base_url: str = "https://api.kie.ai"
    kie_upload_url: str = "https://kieai.redpandaai.co/api/file-stream-upload"
    text_model: str = "gemini-3.1-pro"
    image_model: str = "nano-banana-pro"
    image_provider: str = ""
    ciyuan_base_url: str = "https://www.gpt345.com"
    huanling_base_url: str = "https://ai.huanling.icu"
    huanling_text_api: str = "native"
    huanling_text_transport: str = "requests"
    huanling_image_transport: str = "curl"
    huanling_video_transport: str = "curl"
    image_size: str = "1536x864"
    image_quality: str = "low"
    video_provider: str = "minimax"
    video_upload_provider: str = "kie"
    target_duration: float = 0.0
    video_review_model: str = "gemini-3.1-pro"
    minimax_base_url: str = "https://api.minimax.io"
    minimax_model: str = "MiniMax-H3-Lite"
    resolution: str = "480P"
    export_resolution: str = "source"
    num_scripts: int = 1
    num_shot_plans: int = 1
    num_directions: int = 1
    num_storyboards: int = 1
    num_video_candidates: int = 1
    iterations: int = 2
    poll_interval: float = 10
    poll_timeout: float = 1800
    agent_context_budget: int = 32000

    @classmethod
    def load(cls, env_file: Path | None = None):
        load_dotenv(env_file or Path.cwd() / ".env", override=False)
        values = {}
        for name, field in cls.__dataclass_fields__.items():
            key = {"resolution": "MINIMAX_RESOLUTION", "iterations": "NUM_ITERATIONS"}.get(name, name.upper())
            value = os.getenv(key)
            if value:
                default = field.default
                values[name] = type(default)(value)
        cfg = cls(**values)
        for name in ("num_scripts", "num_shot_plans", "num_directions", "num_storyboards", "num_video_candidates", "iterations"):
            if getattr(cfg, name) < 1:
                raise ValueError(f"{name} 必须至少为 1")
        if cfg.poll_interval <= 0 or cfg.poll_timeout <= 0:
            raise ValueError("查询间隔与超时必须大于 0")
        if cfg.huanling_text_api not in {"native", "compatible"} or cfg.huanling_text_transport not in {"requests", "curl"}:
            raise ValueError("幻灵文本接口或传输方式无效")
        if cfg.huanling_image_transport not in {"requests", "curl"}:
            raise ValueError("幻灵图片传输方式请选择 requests 或 curl")
        if cfg.huanling_video_transport not in {"requests", "curl"}:
            raise ValueError("幻灵视频传输方式请选择 requests 或 curl")
        if cfg.target_duration < 0:
            raise ValueError("TARGET_DURATION 不能为负数")
        if cfg.export_resolution not in {"source", "480P", "720P", "1080P"}:
            raise ValueError("EXPORT_RESOLUTION 只能为 source、480P、720P 或 1080P")
        if cfg.agent_context_budget < 2000:
            raise ValueError('AGENT_CONTEXT_BUDGET 至少为 2000；这是本地输入预算，不表示模型容量')
        return cfg

    def snapshot(self):
        return asdict(self)
