"""Kie.ai Gemini 对话、文件上传与异步参考图生图，沿用阶段客户端接口。"""
from ..events import professional_call
import json
import mimetypes
import os
import time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

from ..io import cached_json, file_signature, prompt, read_json, signature, write_json
from .json_output import parse_json


class Kie:
    def __init__(self, config):
        self.config = config
        self.key = os.getenv("KIE_API_KEY")
        if not self.key:
            raise ValueError("请配置 KIE_API_KEY")
        self.base = config.kie_base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self.key}"})
        self.uploads = {}
        self.usage = []
        self.last_json_text = ""
        self.image_client = None
        if config.image_provider == "ciyuan":
            from .ciyuan import Ciyuan
            self.image_client = Ciyuan(config)
        elif config.image_provider not in ("", "kie"):
            raise ValueError(f"未知生图供应商：{config.image_provider}")

    def _request(self, method, url, **kwargs):
        response = self.session.request(method, url, timeout=kwargs.pop("timeout", 180), **kwargs)
        response.raise_for_status()
        data = response.json()
        # Kie 可能用 HTTP 200 表达业务错误，不能只看 HTTP 状态。
        if data.get("code", 200) != 200 or data.get("success") is False:
            message = str(data.get("msg", "未知业务错误")).replace(self.key, "[REDACTED]")
            raise RuntimeError(f"Kie API 错误 {data.get('code')}: {message[:500]}")
        return data

    def balance(self):
        return self._request("GET", f"{self.base}/api/v1/chat/credit")["data"]

    def upload(self, path):
        path = Path(path)
        digest = file_signature(path)
        mime = mimetypes.guess_type(path.name)[0]
        if not mime or not mime.startswith(("image/", "video/")):
            raise ValueError(f"Kie 媒体类型不支持：{path}")
        key = (digest, mime)
        if key in self.uploads and time.monotonic() - self.uploads[key][1] < 3600:
            return self.uploads[key][0]
        # 文档指定的上传域名；24 小时临时素材，不当作长期存储。
        with path.open("rb") as source:
            data = self._request("POST", self.config.kie_upload_url,
                files={"file": (digest + path.suffix, source, mime)},
                data={"uploadPath": "mangaweaver", "fileName": digest + path.suffix})
        url = data["data"]["downloadUrl"]
        self.uploads[key] = (url, time.monotonic())
        return url

    def _parts(self, payload, media):
        parts = []
        for index, path in enumerate(media, 1):
            parts.extend([{"type": "text", "text": f"素材 {index}: {Path(path)}"},
                          {"type": "image_url", "image_url": {"url": self.upload(path)}}])
        # Kie 的图片、视频均使用 image_url 包装；保留完整视频输入。
        parts.append({"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)})
        return parts

    def json(self, template, payload, schema, media=(), video=False):
        self.last_json_text = ""
        model = self.config.video_review_model if video else self.config.text_model
        instruction = (prompt(template) + "\n仅返回一个 JSON 对象，不要 Markdown 代码围栏或额外解释。"
                       "严格遵守以下 JSON Schema：\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False))
        result = self._request("POST", f"{self.base}/{model}/v1/chat/completions", json={
            "model": model, "stream": False, "reasoning_effort": "low",
            "messages": [{"role": "system", "content": instruction},
                         {"role": "user", "content": self._parts(payload, media)}],
        })
        self.usage.append({"kind": "video_review" if video else "json", "model": model,
            "usage": result.get("usage"), "credits_consumed": result.get("credits_consumed")})
        text = result["choices"][0]["message"]["content"]
        self.last_json_text = text
        # 文档未承诺原生 responseSchema；使用提示约束＋Pydantic 严格校验，不自动修复。
        return parse_json(text, schema)

    @professional_call
    def json_to(self, template, payload, schema, media, destination, video=False):
        media = list(media)
        inputs = {"provider": "kie", "endpoint": self.base, "template": prompt(template),
            "schema": schema.model_json_schema(), "payload": payload,
            "model": self.config.video_review_model if video else self.config.text_model,
            "media": [{"path": str(p), "sha256": file_signature(p)} for p in media]}
        def produce():
            try:
                return self.json(template, payload, schema, media, video)
            except ValueError:
                write_json(Path(destination).with_suffix(".failed.json"), {"text": self.last_json_text})
                raise
        return cached_json(destination, inputs, produce, schema)

    @professional_call
    def image(self, template, payload, media, destination):
        if self.image_client:
            return self.image_client.image(template, payload, media, destination)
        destination = Path(destination)
        media = list(media)
        fingerprint = signature({"endpoint": self.base, "model": self.config.image_model,
            "template": prompt(template), "payload": payload, "media": [file_signature(p) for p in media]})
        state_path = destination.with_suffix(".task.json")
        state = read_json(state_path) if state_path.exists() else None
        if state and state["signature"] != fingerprint:
            raise ValueError(f"Kie 生图输入已变化，请显式重跑：{destination}")
        if state is None:
            image_urls = [self.upload(p) for p in media]
            state = {"signature": fingerprint, "model": self.config.image_model, "status": "submitting"}
            write_json(state_path, state)
            result = self._request("POST", f"{self.base}/api/v1/jobs/createTask", json={
                "model": self.config.image_model, "input": {
                    "prompt": prompt(template) + "\n" + json.dumps(payload, ensure_ascii=False, default=str),
                    "image_input": image_urls, "aspect_ratio": "16:9", "resolution": "1K", "output_format": "png"}})
            state.update(task_id=result["data"]["taskId"], status="submitted")
            write_json(state_path, state)
        if not state.get("task_id"):
            raise ValueError(f"Kie 上次生图提交结果不明，请先核对平台并补入 task_id：{state_path}")
        deadline = time.monotonic() + self.config.poll_timeout
        while time.monotonic() < deadline:
            result = self._request("GET", f"{self.base}/api/v1/jobs/recordInfo", params={"taskId": state["task_id"]})["data"]
            state["status"] = result["state"]
            write_json(state_path, state)
            if result["state"] == "success":
                urls = json.loads(result["resultJson"])["resultUrls"]
                if len(urls) != 1:
                    raise ValueError("Kie 生图必须返回一张关键画面")
                # 下载服务不携带平台 Authorization；不保存临时下载 URL。
                response = requests.get(urls[0], timeout=120)
                response.raise_for_status()
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix(".partial.png")
                with Image.open(BytesIO(response.content)) as im:
                    if abs(im.width / im.height - 16 / 9) > .025:
                        raise ValueError("Kie 返回画面不是所需 16:9，不自动裁切")
                    im.convert("RGB").save(temporary, format="PNG")
                temporary.replace(destination)
                state.update(status="downloaded", credits_consumed=result.get("creditsConsumed"))
                write_json(state_path, state)
                self.usage.append({"kind": "image", "task_id": state["task_id"],
                    "model": self.config.image_model, "credits_consumed": result.get("creditsConsumed")})
                return destination
            if result["state"] == "fail":
                raise RuntimeError(f"Kie 生图失败 {result.get('failCode')}: {str(result.get('failMsg'))[:500]}")
            if result["state"] not in ("waiting", "queuing", "generating"):
                raise RuntimeError(f"Kie 未知任务状态：{result['state']}")
            time.sleep(self.config.poll_interval)
        raise TimeoutError(f"Kie 生图查询超时，task_id 已保存：{state_path}")

    def save_usage(self, path):
        write_json(path, {"provider": "kie", "successful_calls": len(self.usage), "usage": self.usage,
                         "image_usage": self.image_client.usage if self.image_client else []})
