"""桌面模型设置：现有环境配置的本地编辑入口，不创建模型客户端。"""
import base64
import hashlib
import io
import json
import os
import re
import tempfile
import time
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests
from dotenv import dotenv_values
from dotenv.parser import parse_stream
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError

from .config import Config
from .run_lock import run_lock

DIRECTORY_KEY = "MANGAWEAVER_MODEL_SETTINGS"
KINDS = ("text", "image", "video")
PROVIDERS = [
    {"id": "huanling", "name": "幻灵", "kinds": ["text", "image", "video"], "base_url": "https://ai.huanling.icu", "editable_base": True},
    {"id": "gemini", "name": "Google Gemini", "kinds": ["text", "image"], "base_url": "https://generativelanguage.googleapis.com", "editable_base": False},
    {"id": "kie", "name": "Kie.ai", "kinds": ["text", "image"], "base_url": "https://api.kie.ai", "editable_base": True},
    {"id": "ciyuan", "name": "词元", "kinds": ["text", "image"], "base_url": "https://www.gpt345.com", "editable_base": True},
    {"id": "minimax", "name": "MiniMax", "kinds": ["video"], "base_url": "https://api.minimax.io", "editable_base": True},
]
KEYS = {
    "huanling": {"text": "HUANLING_API_KEY", "image": "HUANLING_IMAGE_API_KEY", "video": "HUANLING_VIDEO_API_KEY"},
    "gemini": {"text": "GEMINI_API_KEY", "image": "GEMINI_API_KEY"},
    "kie": {"text": "KIE_API_KEY", "image": "KIE_API_KEY"},
    "ciyuan": {"text": "CIYUAN_API_KEY", "image": "CIYUAN_IMAGE_API_KEY"},
    "minimax": {"video": "MINIMAX_API_KEY"},
}
BASES = {"huanling": "huanling_base_url", "kie": "kie_base_url", "ciyuan": "ciyuan_base_url", "minimax": "minimax_base_url"}
PREFERENCES = (
    "target_duration", "image_size", "image_quality", "resolution", "num_scripts", "num_shot_plans",
    "num_directions", "num_storyboards", "num_video_candidates", "iterations",
    "poll_interval", "poll_timeout", "video_upload_provider", "huanling_text_api",
    "huanling_text_transport", "huanling_image_transport", "huanling_video_transport",
)
MODEL_NAMES = {"gemini-3.8-flash": "Gemini 3.8 Flash", "gpt-image-2": "GPT Image 2",
               "MiniMax-H3-Lite": "MiniMax H3 Lite", "MiniMax-H3": "MiniMax H3"}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=100)


class Channel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(max_length=1000)
    models: list[Model] = Field(default_factory=list, max_length=50)
    credential_set: bool = False
    api_key: SecretStr | None = None


class Service(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=64)
    provider: str
    name: str = Field(min_length=1, max_length=80)
    channels: dict[str, Channel]


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: str = ""
    model: str = ""


class TaskModels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Selection
    image: Selection
    review: str
    video: Selection


class Document(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str
    services: list[Service] = Field(max_length=20)
    tasks: TaskModels
    preferences: dict


def _env_name(field):
    return {"resolution": "MINIMAX_RESOLUTION", "iterations": "NUM_ITERATIONS"}.get(field, field.upper())


def _profile_key(service, kind):
    return f"MW_SERVICE_{service.upper().replace('-', '_')}_{kind.upper()}_KEY"


def _revision(path):
    return hashlib.sha256(path.read_bytes() if path.exists() else b"").hexdigest()


def _config(values):
    # 与Config.load同一字段类型；不将设置进程的草稿写入环境。
    return Config.from_values(values)


def _load(path):
    values = {k: v for k, v in dotenv_values(path, interpolate=False).items() if v is not None}
    effective = {**values, **os.environ}
    cfg = _config(effective)
    raw = values.get(DIRECTORY_KEY)
    try:
        data = json.loads(raw) if raw else None
    except ValueError:
        raise ValueError("模型服务目录无法读取，请检查环境文件中的模型设置字段") from None
    if data is None:
        data = {"services": [], "tasks": {}, "preferences": {}}
    try:
        services = [Service.model_validate(s).model_dump(exclude={"channels": {"__all__": {"api_key"}}}) for s in data["services"]]
    except (ValidationError, KeyError, TypeError):
        raise ValueError("模型服务目录格式无效，未修改配置文件") from None
    if not services:
        for provider in PROVIDERS:
            services.append({"id": provider["id"], "provider": provider["id"], "name": provider["name"], "channels": {
                kind: {"base_url": getattr(cfg, BASES.get(provider["id"], ""), provider["base_url"]),
                       "models": [], "credential_set": False} for kind in provider["kinds"]}})
    secrets = {}
    for service in services:
        for kind, channel in service["channels"].items():
            secrets[(service["id"], kind)] = effective.get(
                _profile_key(service["id"], kind), effective.get(KEYS[service["provider"]][kind], "") if raw is None else "")
            channel["credential_set"] = bool(secrets[(service["id"], kind)])
    tasks = deepcopy(data.get("tasks", {}))
    for kind, provider, model_id in (
        ("text", cfg.model_provider, cfg.text_model),
        ("image", cfg.image_provider or cfg.model_provider, cfg.image_model),
        ("video", cfg.video_provider, cfg.minimax_model),
    ):
        previous = tasks.get(kind, {}).get("service", "")
        service = next((s for s in services if s["id"] == previous and s["provider"] == provider and kind in s["channels"]), None)
        if service is None:
            service = next((s for s in services if s["provider"] == provider and kind in s["channels"]), None)
        if service is None:
            raise ValueError(f"现有{kind}厂商不受设置页支持，请先检查环境文件")
        channel = service["channels"][kind]
        base_field = "minimax_base_url" if kind == "video" else BASES.get(provider)
        if base_field:
            channel["base_url"] = getattr(cfg, base_field)
        secret = effective.get(KEYS[provider][kind], "")
        secrets[(service["id"], kind)] = secret
        vertex = provider == "gemini" and bool(effective.get("GOOGLE_CLOUD_PROJECT"))
        channel["credential_set"] = bool(secret) or vertex
        if not any(m["id"] == model_id for m in channel["models"]):
            channel["models"].append({"id": model_id, "name": MODEL_NAMES.get(model_id, model_id)})
        tasks[kind] = {"service": service["id"] if channel["credential_set"] else "", "model": model_id if channel["credential_set"] else ""}
    tasks["review"] = cfg.video_review_model
    if tasks["text"]["service"]:
        channel = next(s for s in services if s["id"] == tasks["text"]["service"])["channels"]["text"]
        if not any(m["id"] == cfg.video_review_model for m in channel["models"]):
            channel["models"].append({"id": cfg.video_review_model, "name": MODEL_NAMES.get(cfg.video_review_model, cfg.video_review_model)})
    document = {"revision": _revision(path), "services": services, "tasks": tasks,
                "preferences": {key: getattr(cfg, key) for key in PREFERENCES}}
    overrides = [key for key in values if key != DIRECTORY_KEY and key in os.environ and values[key] != os.environ[key]
                 and (key in {_env_name(f) for f in Config.__dataclass_fields__} or key.endswith("_API_KEY"))]
    return document, values, secrets, overrides


def read(path):
    data, _, _, overrides = _load(Path(path))
    return {**data, "providers": PROVIDERS,
            "warnings": ["有同名进程环境变量覆盖本地文件，保存前请移除覆盖：" + "、".join(overrides)] if overrides else []}


def _prepare(path, request):
    current, values, secrets, overrides = _load(path)
    try:
        doc = Document.model_validate(request)
    except ValidationError:
        raise ValueError("设置格式无效，请检查连接名称、模型条目和参数类型") from None
    if doc.revision != current["revision"]:
        raise ValueError("设置已被其他入口修改，草稿已保留。请重新读取后再保存")
    if overrides:
        raise ValueError("存在覆盖本地配置的进程环境变量，请先移除覆盖后保存")
    ids = set()
    clean = doc.model_dump(exclude={"services": {"__all__": {"channels": {"__all__": {"api_key"}}}}})
    for service in doc.services:
        provider = next((p for p in PROVIDERS if p["id"] == service.provider), None)
        if not provider or service.id in ids or not service.name.strip():
            raise ValueError("厂商、连接ID或连接名称无效")
        ids.add(service.id)
        if set(service.channels) != set(provider["kinds"]):
            raise ValueError(f"{service.name}的接口类型与现有适配器不符")
        for kind, channel in service.channels.items():
            url = urlsplit(channel.base_url)
            if url.scheme not in ("https", "http") or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError(f"{service.name}接口地址须为无凭据、查询参数和片段的HTTP(S)地址")
            if not provider["editable_base"] and channel.base_url.rstrip("/") != provider["base_url"]:
                raise ValueError("Google Gemini当前使用官方接口地址")
            if len({m.id for m in channel.models}) != len(channel.models) or any(not m.id.strip() or not m.name.strip() for m in channel.models):
                raise ValueError(f"{service.name}模型ID重复或为空")
            for model in channel.models:
                if any(ord(c) < 32 for c in model.id + model.name):
                    raise ValueError("模型名称和ID不能包含控制字符")
            secret = channel.api_key.get_secret_value() if channel.api_key else ""
            if secret:
                if secret != secret.strip() or len(secret) > 4096 or any(ord(c) < 33 for c in secret):
                    raise ValueError("API Key包含空白、控制字符或长度不合法")
                secrets[(service.id, kind)] = secret
            values[_profile_key(service.id, kind)] = secrets.get((service.id, kind), "")
    selected = {}
    for kind in KINDS:
        choice = getattr(doc.tasks, kind)
        if not choice.service:
            if choice.model:
                raise ValueError("选择模型前请先选择服务")
            if current["tasks"][kind]["service"]:
                raise ValueError("已有任务请显式选择替代服务，不支持清空后隐式沿用")
            continue
        service = next((s for s in doc.services if s.id == choice.service), None)
        if not service or kind not in service.channels:
            raise ValueError("所选服务不支持对应任务")
        channel = service.channels[kind]
        if not any(m.id == choice.model for m in channel.models):
            raise ValueError(f"{service.name}的任务模型不在可用模型目录中")
        if not secrets.get((service.id, kind)) and not (service.provider == "gemini" and os.getenv("GOOGLE_CLOUD_PROJECT", values.get("GOOGLE_CLOUD_PROJECT"))):
            raise ValueError(f"请先为{service.name}的{kind}接口配置API Key")
        selected[kind] = (service, channel)
    text_provider = selected["text"][0].provider if "text" in selected else values.get("MODEL_PROVIDER", Config().model_provider)
    image_provider = selected["image"][0].provider if "image" in selected else values.get("IMAGE_PROVIDER") or text_provider
    allowed = {"huanling": {"huanling"}, "gemini": {"gemini"}, "kie": {"kie", "ciyuan"}, "ciyuan": {"ciyuan"}}
    if image_provider not in allowed.get(text_provider, set()):
        raise ValueError("所选创作与生图服务组合不受当前客户端支持，请选择匹配厂商")
    if "text" in selected:
        channel = selected["text"][1]
        if not any(m.id == doc.tasks.review for m in channel.models):
            raise ValueError("视频审查模型须来自创作服务的模型目录")
    if set(doc.preferences) != set(PREFERENCES):
        raise ValueError("生成偏好字段不完整或包含未支持的参数")
    for key, value in doc.preferences.items():
        if isinstance(value, (dict, list, bool)) or value is None:
            raise ValueError("生成参数类型无效")
        values[_env_name(key)] = str(value)
    for kind, (service, channel) in selected.items():
        values[{"text": "MODEL_PROVIDER", "image": "IMAGE_PROVIDER", "video": "VIDEO_PROVIDER"}[kind]] = service.provider
        values[{"text": "TEXT_MODEL", "image": "IMAGE_MODEL", "video": "MINIMAX_MODEL"}[kind]] = getattr(doc.tasks, kind).model
        base_field = "minimax_base_url" if kind == "video" else BASES.get(service.provider)
        if base_field:
            values[_env_name(base_field)] = channel.base_url.rstrip("/")
        values[KEYS[service.provider][kind]] = secrets.get((service.id, kind), "")
    # 共享字段不能被后写入的另一任务悄悄覆盖。
    if "text" in selected and "image" in selected and text_provider == image_provider:
        left, right = selected["text"], selected["image"]
        if left[1].base_url.rstrip("/") != right[1].base_url.rstrip("/"):
            raise ValueError("当前适配器的文本与图像接口须使用相同地址")
        if text_provider in {"kie", "gemini"} and secrets.get((left[0].id, "text")) != secrets.get((right[0].id, "image")):
            raise ValueError("当前适配器的文本与图像须使用相同API Key")
    values["VIDEO_REVIEW_MODEL"] = doc.tasks.review
    try:
        cfg = _config(values)
    except (ValueError, TypeError):
        raise ValueError("生成参数无效，请检查正数、整数、协议和传输方式") from None
    if not __import__("math").isfinite(cfg.target_duration) or not all(__import__("math").isfinite(n) for n in (cfg.poll_interval, cfg.poll_timeout)):
        raise ValueError("时长与查询参数必须为有限数值")
    if cfg.image_quality not in {"low", "medium", "high", "auto"} or not re.fullmatch(r"[1-9]\d{1,4}x[1-9]\d{1,4}", cfg.image_size):
        raise ValueError("图像尺寸使用宽x高，质量请选择low、medium、high或auto")
    if cfg.video_upload_provider not in {"kie", "uguu"}:
        raise ValueError("素材上传方式只支持Kie或uguu")
    if "video" in selected:
        standard = cfg.video_provider == "huanling"
        if cfg.minimax_model != ("MiniMax-H3" if standard else "MiniMax-H3-Lite"):
            raise ValueError("当前渠道视频型号不受支持，请显式选择支持的H3型号，不自动更换")
        if cfg.resolution not in ({"768P", "2K"} if standard else {"480P", "768P"}):
            raise ValueError("当前视频型号与分辨率不匹配，请在生成偏好中显式修改")
    values[DIRECTORY_KEY] = json.dumps({k: clean[k] for k in ("services", "tasks")}, ensure_ascii=False, separators=(",", ":"))
    return values


def _redact(value, secret):
    text = str(value)
    return text.replace(secret, "[REDACTED]") if secret else text


def _remote_message(response, secret):
    fallback = _redact(response.text[:1200], secret).strip()
    try:
        value = response.json()
    except ValueError:
        return fallback or "接口未返回错误说明"
    if isinstance(value, dict):
        error = value.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("msg")
            if message:
                return _redact(message, secret)[:1200]
        if isinstance(error, str):
            return _redact(error, secret)[:1200]
        for key in ("message", "msg", "detail"):
            if value.get(key):
                return _redact(value[key], secret)[:1200]
    return fallback or "接口未返回错误说明"


def _request_json(method, url, secret, label, *, headers=None, payload=None, timeout=120):
    try:
        response = requests.request(
            method, url, headers=headers or {}, json=payload,
            timeout=timeout, allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"{label}连接失败：{_redact(exc, secret)[:1200]}") from None
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f"{label} HTTP {response.status_code}: {_remote_message(response, secret)}")
    try:
        data = response.json()
    except ValueError:
        raise RuntimeError(f"{label}返回的不是 JSON，请检查接口地址与模型类型") from None
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"{label}返回错误：{_remote_message(response, secret)}")
    return response, data


def _message_text(response):
    for key in ("x-request-id", "request-id"):
        if response.headers.get(key):
            return f"，请求 {response.headers[key]}"
    return ""


def _selected_for_test(path, request):
    try:
        doc = Document.model_validate(request["settings"])
    except ValidationError:
        raise ValueError("设置格式无效，请先检查当前连接、模型条目和参数") from None
    service_id = str(request.get("service") or "")
    kind = str(request.get("kind") or "")
    model_id = str(request.get("model") or "")
    if kind not in KINDS:
        raise ValueError("未知接口类型")
    service = next((item for item in doc.services if item.id == service_id), None)
    if not service:
        raise ValueError("找不到要测试的模型服务")
    provider = next((item for item in PROVIDERS if item["id"] == service.provider), None)
    channel = service.channels.get(kind)
    if not provider or kind not in provider["kinds"] or not channel:
        raise ValueError("当前服务不支持所选接口类型")
    if not any(model.id == model_id for model in channel.models):
        raise ValueError("所选模型不在当前接口的模型目录中")
    target = urlsplit(channel.base_url)
    if target.scheme not in ("https", "http") or not target.hostname or target.username or target.password or target.query or target.fragment:
        raise ValueError("测试前请填写无凭据、查询参数和片段的 HTTP(S) 接口地址")
    if not provider["editable_base"] and channel.base_url.rstrip("/") != provider["base_url"]:
        raise ValueError("Google Gemini 当前使用官方接口地址")
    _, _, secrets, _ = _load(path)
    entered = channel.api_key.get_secret_value() if channel.api_key else ""
    secret = entered or secrets.get((service.id, kind), "")
    if not secret:
        raise ValueError(f"请先输入或保存{provider['name']}的 API Key")
    return doc, service, provider, channel, model_id, secret


def _api_base(provider, value):
    base = value.rstrip("/")
    return base.removesuffix("/v1") if provider["id"] in {"huanling", "gemini", "ciyuan"} else base


def _test_text(doc, provider, channel, model_id, secret):
    base = _api_base(provider, channel.base_url)
    model_path = quote(model_id, safe="@._-")
    headers = {"Content-Type": "application/json"}
    if provider["id"] in {"huanling", "gemini", "ciyuan"} and (
        provider["id"] != "huanling" or doc.preferences.get("huanling_text_api") != "compatible"
    ):
        headers["x-goog-api-key"] = secret
        response, data = _request_json(
            "POST", f"{base}/v1beta/models/{model_path}:generateContent", secret, "文本接口",
            headers=headers,
            payload={
                "contents": [{"role": "user", "parts": [{"text": "Reply with OK."}]}],
                "generationConfig": {"maxOutputTokens": 16},
            },
            timeout=60,
        )
        if not data.get("candidates"):
            raise RuntimeError("文本接口已响应，但没有返回候选结果")
        return "模型可用，已返回文本结果" + _message_text(response)
    if provider["id"] == "huanling":
        url = f"{base}/v1/chat/completions"
    else:
        url = f"{base}/{model_path}/v1/chat/completions"
    headers["Authorization"] = f"Bearer {secret}"
    response, data = _request_json(
        "POST", url, secret, "文本接口", headers=headers,
        payload={
            "model": model_id, "stream": False, "max_tokens": 16,
            "messages": [{"role": "user", "content": "Reply with OK."}],
        },
        timeout=60,
    )
    if not data.get("choices"):
        raise RuntimeError("文本接口已响应，但没有返回候选结果")
    return "模型可用，已返回文本结果" + _message_text(response)


def _test_image(doc, provider, channel, model_id, secret):
    base = _api_base(provider, channel.base_url)
    headers = {"Content-Type": "application/json"}
    if provider["id"] == "huanling":
        headers["Authorization"] = f"Bearer {secret}"
        response, data = _request_json(
            "POST", f"{base}/v1/images/generations", secret, "图像接口",
            headers=headers,
            payload={
                "model": model_id,
                "prompt": "A plain light gray rectangle on a white background, no text.",
                "size": str(doc.preferences.get("image_size", "1024x1024")),
                "quality": str(doc.preferences.get("image_quality", "low")),
                "n": 1,
            },
            timeout=240,
        )
        if not data.get("data"):
            raise RuntimeError("图像接口已响应，但没有返回图像")
        return "模型可用，已生成测试图像" + _message_text(response)
    if provider["id"] in {"gemini", "ciyuan"}:
        headers["x-goog-api-key"] = secret
        model_path = quote(model_id, safe="@._-")
        response, data = _request_json(
            "POST", f"{base}/v1beta/models/{model_path}:generateContent", secret, "图像接口",
            headers=headers,
            payload={
                "contents": [{"role": "user", "parts": [{"text": "生成纯白色背景，不带文字。"}]}],
                "generationConfig": {
                    "responseModalities": ["TEXT", "IMAGE"],
                    "imageConfig": {"aspectRatio": "16:9", "imageSize": "1K"},
                },
            },
            timeout=240,
        )
        parts = [part for candidate in data.get("candidates", [])
                 for part in candidate.get("content", {}).get("parts", [])]
        if not any(part.get("inlineData") or part.get("inline_data") for part in parts):
            raise RuntimeError("图像接口已响应，但没有返回图像")
        return "模型可用，已生成测试图像" + _message_text(response)
    headers["Authorization"] = f"Bearer {secret}"
    response, data = _request_json(
        "POST", f"{base}/api/v1/jobs/createTask", secret, "图像任务接口",
        headers=headers,
        payload={
            "model": model_id,
            "input": {
                "prompt": "A plain light gray rectangle on a white background, no text.",
                "aspect_ratio": "16:9", "resolution": "1K", "output_format": "png",
            },
        },
        timeout=60,
    )
    task_id = data.get("data", {}).get("taskId")
    if not task_id:
        raise RuntimeError("图像任务接口未返回 taskId")
    return f"接口已受理，测试任务 {task_id}" + _message_text(response)


def _test_video(doc, provider, channel, model_id, secret):
    base = channel.base_url.rstrip("/")
    with io.BytesIO() as frame:
        from PIL import Image
        Image.new("RGB", (512, 288), "#e8e8e8").save(frame, format="PNG", optimize=True)
        first_frame = "data:image/png;base64," + base64.b64encode(frame.getvalue()).decode("ascii")
    response, data = _request_json(
        "POST", f"{base}/v2/video_generation", secret, "视频接口",
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
        payload={
            "model": model_id,
            "content": [
                {"type": "text", "text": "The frame gently brightens once. Keep the composition stable and do not add text."},
                {"type": "image_url", "image_url": {"url": first_frame}, "role": "first_frame"},
            ],
            "duration": 4,
            "resolution": str(doc.preferences.get("resolution", "480P")),
            "ratio": "adaptive",
        },
        timeout=120,
    )
    task_id = data.get("task_id")
    if not task_id:
        raise RuntimeError("视频接口未返回 task_id")
    return f"接口已受理，测试任务 {task_id}" + _message_text(response)


def test_model_settings(path, request):
    """使用当前草稿发起一次真实请求；不保存设置，也不自动重试。"""
    started = time.monotonic()
    doc, _, provider, channel, model_id, secret = _selected_for_test(path, request)
    kind = request["kind"]
    if kind == "text":
        message = _test_text(doc, provider, channel, model_id, secret)
    elif kind == "image":
        message = _test_image(doc, provider, channel, model_id, secret)
    else:
        message = _test_video(doc, provider, channel, model_id, secret)
    return {
        "ok": True, "provider": provider["id"], "kind": kind, "model": model_id,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "message": message, "billable_submission": kind in {"image", "video"},
    }


def _write(path, values):
    # 使用dotenv解析器保留注释、未知字段和多行值；整份文件一次替换。
    original = path.read_text() if path.exists() else ""
    before = dotenv_values(stream=io.StringIO(original), interpolate=False)
    values = {key: value for key, value in values.items() if value != before.get(key)}
    remaining = dict(values)
    pieces = []
    def assignment(key, value):
        quoted = str(value).replace("\\", "\\\\").replace("'", "\\'")
        return f"{key}='{quoted}'\n"
    for binding in parse_stream(io.StringIO(original)):
        if binding.key in values:
            if binding.key in remaining:
                pieces.append(assignment(binding.key, remaining.pop(binding.key)))
        else:
            pieces.append(binding.original.string)
    text = "".join(pieces)
    if text and not text.endswith("\n"):
        text += "\n"
    text += "".join(assignment(k, v) for k, v in remaining.items())
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def handle(request):
    path = Path(request.get("env_file") or ".env").resolve()
    if request["command"] == "read_model_settings":
        return read(path)
    if request["command"] == "test_model_settings":
        return test_model_settings(path, request)
    with run_lock(path.parent, "model_settings"):
        values = _prepare(path, request["settings"])
        if request["command"] == "check_model_settings":
            return {"message": "本地配置检查通过，尚未验证接口；未调用模型"}
        _write(path, values)
    return read(path)
