"""词元 Gemini 原生多模态 JSON 与参考图生图；使用独立密钥，不自动换模型。"""
from ..events import professional_call
import base64
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


class Ciyuan:
    def __init__(self, config):
        self.config = config
        self.key = os.getenv("CIYUAN_IMAGE_API_KEY")
        self.base = config.ciyuan_base_url.rstrip("/").removesuffix("/v1")
        self.usage = []
        self.text_key = os.getenv("CIYUAN_API_KEY")
        self.last_json_text = ""

    def json(self, template, payload, schema, media=(), video=False):
        if not self.text_key:
            raise ValueError("请配置规划／评审用的 CIYUAN_API_KEY")
        self.last_json_text = ""
        model = self.config.video_review_model if video else self.config.text_model
        parts = []
        for index, item in enumerate(media, 1):
            path = Path(item)
            mime = mimetypes.guess_type(path.name)[0]
            if not mime or not mime.startswith(("image/", "video/")):
                raise ValueError(f"词元媒体类型不支持：{path}")
            parts.extend([{"text": f"素材 {index}: {path.name}"}, {"inlineData": {
                "mimeType": mime, "data": base64.b64encode(path.read_bytes()).decode()}}])
        parts.append({"text": json.dumps(payload, ensure_ascii=False, default=str)})
        started = time.monotonic()
        response = requests.post(f"{self.base}/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": self.text_key}, timeout=180, allow_redirects=False,
            json={"systemInstruction": {"parts": [{"text": prompt(template)}]},
                  "contents": [{"role": "user", "parts": parts}],
                  "generationConfig": {"responseMimeType": "application/json",
                      "responseJsonSchema": schema.model_json_schema(),
                      "thinkingConfig": {"thinkingLevel": "low"}, "maxOutputTokens": 8192}})
        if response.status_code != 200:
            message = response.text[:1500].replace(self.text_key, "[REDACTED]")
            raise RuntimeError(f"词元 JSON 请求失败 HTTP {response.status_code}: {message}")
        result = response.json()
        self.usage.append({"kind": "video_review" if video else "json", "model": model,
            "model_version": result.get("modelVersion"), "usage": result.get("usageMetadata"),
            "request_id": response.headers.get("x-request-id"),
            "elapsed_seconds": round(time.monotonic() - started, 2)})
        self.last_json_text = "".join(part.get("text", "")
            for candidate in result.get("candidates", [])
            for part in candidate.get("content", {}).get("parts", []) if not part.get("thought"))
        return parse_json(self.last_json_text, schema)

    @professional_call
    def json_to(self, template, payload, schema, media, destination, video=False):
        media = list(media)
        context = {"provider": "ciyuan", "endpoint": self.base, "template": prompt(template),
            "schema": schema.model_json_schema(), "payload": payload,
            "model": self.config.video_review_model if video else self.config.text_model,
            "media": [{"path": str(p), "sha256": file_signature(p)} for p in media]}
        def produce():
            try:
                return self.json(template, payload, schema, media, video)
            except ValueError:
                write_json(Path(destination).with_suffix(".failed.json"), {"text": self.last_json_text})
                raise
        return cached_json(destination, context, produce, schema)

    def save_usage(self, path):
        write_json(path, {"provider": "ciyuan", "successful_calls": len(self.usage), "usage": self.usage})

    @professional_call
    def image(self, template, payload, media, destination):
        if not self.key:
            raise ValueError("请配置 CIYUAN_IMAGE_API_KEY")
        destination = Path(destination)
        media = list(media)
        fingerprint = signature({"provider": "ciyuan", "endpoint": self.base,
            "model": self.config.image_model, "template": prompt(template), "payload": payload,
            "media": [file_signature(p) for p in media]})
        state_path = destination.with_suffix(".task.json")
        if state_path.exists():
            state = read_json(state_path)
            if state["signature"] != fingerprint:
                raise ValueError(f"词元生图输入已变化，请显式重跑：{destination}")
            if state["status"] == "downloaded" and destination.exists():
                if file_signature(destination) != state["image_signature"]:
                    raise ValueError(f"词元图片已被修改：{destination}")
                return destination
            raise ValueError(f"词元上次请求未完成，请先核对账单与记录，不自动重复收费：{state_path}")
        parts = []
        for index, item in enumerate(media, 1):
            path = Path(item)
            parts.extend([{"text": f"参考图 {index}: {path.name}"}, {"inlineData": {
                "mimeType": mimetypes.guess_type(path.name)[0] or "image/png",
                "data": base64.b64encode(path.read_bytes()).decode()}}])
        parts.append({"text": prompt(template) + "\n" + json.dumps(payload, ensure_ascii=False, default=str)})
        state = {"signature": fingerprint, "model": self.config.image_model, "status": "submitting"}
        write_json(state_path, state)
        started = time.monotonic()
        response = requests.post(f"{self.base}/v1beta/models/{self.config.image_model}:generateContent",
            headers={"x-goog-api-key": self.key}, timeout=300, allow_redirects=False,
            json={"contents": [{"role": "user", "parts": parts}], "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {"aspectRatio": "16:9", "imageSize": "1K"}}})
        state.update(http_status=response.status_code, request_id=response.headers.get("x-request-id"),
                     elapsed_seconds=round(time.monotonic() - started, 2))
        if response.status_code != 200:
            state.update(status="failed", error=response.text[:1500].replace(self.key, "[REDACTED]"))
            write_json(state_path, state)
            raise RuntimeError(f"词元生图失败 HTTP {response.status_code}: {state['error']}")
        result = response.json()
        state.update(status="received", usage=result.get("usageMetadata"), model_version=result.get("modelVersion"))
        write_json(state_path, state)
        images = [part.get("inlineData") or part.get("inline_data")
                  for candidate in result.get("candidates", [])
                  for part in candidate.get("content", {}).get("parts", [])
                  if part.get("inlineData") or part.get("inline_data")]
        if len(images) != 1:
            raise ValueError(f"词元生图需返回一张图片，实际 {len(images)} 张：{state_path}")
        temporary = destination.with_suffix(".partial.png")
        with Image.open(BytesIO(base64.b64decode(images[0]["data"]))) as image:
            if abs(image.width / image.height - 16 / 9) > .025:
                raise ValueError("词元返回画面不是所需 16:9，不自动裁切")
            image.convert("RGB").save(temporary, format="PNG")
        temporary.replace(destination)
        state.update(status="downloaded", image_signature=file_signature(destination))
        write_json(state_path, state)
        self.usage.append(state)
        return destination
