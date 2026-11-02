"""直接封装 Gemini 多模态 JSON、图像及视频评审请求。"""
from ..events import professional_call
import json
import logging
import mimetypes
import os
import time
from pathlib import Path

from google import genai
from google.genai import types
from pydantic import BaseModel

from ..config import Config
from ..io import prompt, write_json
from .json_output import parse_json

log = logging.getLogger(__name__)


def _curl_post(url, body, headers, timeout=180):
    """系统 TLS 传输；凭据通过 stdin，不进入进程参数或临时文件。"""
    import subprocess
    settings = "url = " + json.dumps(url) + "\n"
    for key, value in headers.items():
        settings += "header = " + json.dumps(key + ": " + value) + "\n"
    settings += "data = " + json.dumps(json.dumps(body, ensure_ascii=False), ensure_ascii=False) + "\n"
    result = subprocess.run(["curl", "--silent", "--show-error", "--max-time", str(timeout), "--config", "-", "--write-out", "\n%{http_code}"],
                            input=settings, text=True, capture_output=True, timeout=timeout+10)
    if result.returncode:
        raise RuntimeError(f"curl 文本请求失败（{result.returncode}），未自动切换传输方式")
    response_text, status = result.stdout.rsplit("\n", 1)
    return int(status), response_text


class Gemini:
    def __init__(self, config: Config):
        self.config = config
        self.image_client = None
        if config.model_provider == "huanling":
            key = os.getenv("HUANLING_API_KEY")
            if not key:
                raise ValueError("请配置 HUANLING_API_KEY")
            self.client = genai.Client(api_key=key, http_options=types.HttpOptions(
                base_url=config.huanling_base_url.rstrip("/"), timeout=180000,
                retry_options=types.HttpRetryOptions(attempts=1)))
            from .gpt_image import GPTImage
            self.image_client = GPTImage(config)
        elif os.getenv("GOOGLE_CLOUD_PROJECT"):
            self.client = genai.Client(vertexai=True, project=os.environ["GOOGLE_CLOUD_PROJECT"],
                                       location=os.getenv("GOOGLE_CLOUD_LOCATION", "global"))
        elif os.getenv("GEMINI_API_KEY"):
            self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        else:
            raise ValueError("请在环境或 --env-file 中配置 GEMINI_API_KEY 或 GOOGLE_CLOUD_PROJECT")
        self.calls = 0
        self.usage = []
        self.attempts = []
        self.last_json_text = ""

    def _call(self, **kwargs):
        # 仅重试明确的限流／服务端错误；错误最终抛出，不返回默认候选。
        attempts = 5 if self.config.model_provider == "huanling" else 3
        for attempt in range(attempts):
            started = time.monotonic()
            try:
                result = self.client.models.generate_content(**kwargs)
                self.attempts.append({"model": kwargs["model"], "attempt": attempt + 1,
                    "status": "success", "elapsed_seconds": round(time.monotonic()-started, 2)})
                self.calls += 1
                if result.usage_metadata:
                    self.usage.append(result.usage_metadata.model_dump(mode="json"))
                return result
            except genai.errors.APIError as exc:
                self.attempts.append({"model": kwargs["model"], "attempt": attempt + 1,
                    "http_status": exc.code, "elapsed_seconds": round(time.monotonic()-started, 2)})
                if exc.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                    raise RuntimeError(f"Gemini {kwargs['model']} 在第 {attempt+1}/{attempts} 次请求失败：{exc}") from exc
                delay = min(5 * 2 ** attempt, 30)
                log.warning("Gemini %s 请求 HTTP %s，第 %s/%s 次；%s 秒后重试同一模型",
                            kwargs["model"], exc.code, attempt+1, attempts, delay)
                time.sleep(delay)

    def _parts(self, payload, media):
        parts = []
        for index, item in enumerate(media, start=1):
            path = Path(item)
            mime = mimetypes.guess_type(path.name)[0]
            if not mime:
                raise ValueError(f"未知媒体类型：{path}")
            parts.append(types.Part.from_text(text=f"素材 {index}: {path}"))
            parts.append(types.Part.from_bytes(data=path.read_bytes(), mime_type=mime))
        parts.append(types.Part.from_text(text=json.dumps(payload, ensure_ascii=False, default=str)))
        return parts

    def json(self, template: str, payload, schema: type[BaseModel], media=(), video=False):
        self.last_json_text = ""
        if self.config.model_provider == "huanling" and self.config.huanling_text_api == "compatible" and not video:
            return self._compatible_json(template, payload, schema, media, video)
        if self.config.model_provider == "huanling" and self.config.huanling_text_api not in {"native", "compatible"}:
            raise ValueError("HUANLING_TEXT_API 请选择 native 或 compatible")
        if self.config.model_provider == "huanling" and self.config.huanling_text_transport == "curl":
            return self._native_curl_json(template, payload, schema, media, video)
        parts = self._parts(payload, media)
        instruction = prompt(template)
        if self.config.model_provider == "huanling":
            # 渠道可能忽略 response_schema；沿用 Kie 的提示约束和本地严格校验。
            instruction += ("\n仅返回一个 JSON 对象，不要 Markdown 代码围栏或额外解释。"
                "严格遵守以下 JSON Schema：\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False))
        result = self._call(
            model=self.config.video_review_model if video else self.config.text_model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                system_instruction=instruction, response_mime_type="application/json",
                response_schema=None if self.config.model_provider == "huanling" else schema,
            ),
        )
        if not result.text:
            raise RuntimeError(f"{template} 未返回 JSON")
        self.last_json_text = result.text
        return parse_json(result.text, schema)

    def stream_json(self, template, payload, schema, media=(), on_text=None, video=False):
        """真实增量；回调只含公开 text，返回值仍经完整 Schema 校验。"""
        from .streaming import PublicText, StreamHTTPError, curl_events, request_events
        import base64
        self.last_json_text = ''
        public = PublicText()
        instruction = prompt(template) + ('\n只输出一个 JSON 对象。若有 text 字段，请先输出 text，'
            '仅填写面向用户的简短说明，不输出隐藏思考。遵守 Schema：\n'
            + json.dumps(schema.model_json_schema(), ensure_ascii=False))
        if 'result' in schema.model_fields and 'action' in schema.model_fields:
            instruction += ('\n本次专业会话使用上述动作封装，原提示词的产物放在 submit 动作的 result 内。'
                'text 只写公开的当前说明；产物尚未校验和保存，不提前宣称已保存或已通过审查。')
        model = self.config.video_review_model if video else self.config.text_model
        if self.config.model_provider != 'huanling':
            finished = False
            stream = self.client.models.generate_content_stream(model=model,
                contents=[types.Content(role='user', parts=self._parts(payload, media))],
                config=types.GenerateContentConfig(system_instruction=instruction,
                    response_mime_type='application/json', response_schema=schema))
            try:
                for chunk in stream:
                    for candidate in chunk.candidates or []:
                        finished = finished or str(candidate.finish_reason or '').split('.')[-1] == 'STOP'
                        for part in candidate.content.parts if candidate.content else []:
                            if part.text and not part.thought:
                                self.last_json_text += part.text
                                delta = public.feed(part.text)
                                if delta and on_text:
                                    on_text(delta)
                    if chunk.usage_metadata:
                        self.usage.append(chunk.usage_metadata.model_dump(mode='json'))
            finally:
                if hasattr(stream, 'close'):
                    stream.close()
            if not finished:
                raise ValueError('模型流未正常结束，部分动作未执行')
        else:
            compatible = self.config.huanling_text_api == 'compatible' and not video
            parts = []
            for item in media:
                path = Path(item)
                mime = mimetypes.guess_type(path.name)[0]
                encoded = base64.b64encode(path.read_bytes()).decode()
                if compatible:
                    if not mime or not mime.startswith('image/'):
                        raise ValueError('兼容流式入口只支持图像，视频需显式选择 native')
                    parts.append({'type':'image_url', 'image_url':{'url':f'data:{mime};base64,{encoded}'}})
                else:
                    parts.append({'text':f'素材 {path.name}'})
                    parts.append({'inlineData':{'mimeType':mime,'data':encoded}})
            text = json.dumps(payload, ensure_ascii=False, default=str)
            base = self.config.huanling_base_url.rstrip('/')
            headers = {'Content-Type':'application/json'}
            if compatible:
                parts.append({'type':'text','text':text})
                body = {'model':model, 'stream':True, 'messages':[{'role':'system','content':instruction},
                    {'role':'user','content':parts}], 'response_format':{'type':'json_object'}, 'max_tokens':8192}
                url = base + '/v1/chat/completions'
                headers['Authorization'] = 'Bearer ' + os.environ['HUANLING_API_KEY']
            else:
                parts.append({'text':text})
                body = {'contents':[{'role':'user','parts':parts}], 'systemInstruction':{'parts':[{'text':instruction}]},
                    'generationConfig':{'responseMimeType':'application/json', 'responseJsonSchema':schema.model_json_schema(), 'maxOutputTokens':8192}}
                url = base + '/v1beta/models/' + model + ':streamGenerateContent?alt=sse'
                headers['x-goog-api-key'] = os.environ['HUANLING_API_KEY']
            transport = curl_events if self.config.huanling_text_transport == 'curl' else request_events
            for attempt in range(5):
                started = time.monotonic()
                finished = False
                try:
                    events = transport(url, body, headers, timeout=300 if video else 180)
                    try:
                        for event in events:
                            if event.get('error'):
                                raise ValueError('渠道在流中返回错误，部分动作未执行')
                            if compatible:
                                choices = event.get('choices') or []
                                choice = choices[0] if choices else {}
                                delta = choice.get('delta', {}).get('content') or ''
                                reason = choice.get('finish_reason')
                                usage = event.get('usage')
                            else:
                                candidates = event.get('candidates') or []
                                candidate = candidates[0] if candidates else {}
                                delta = ''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
                                reason = candidate.get('finishReason')
                                usage = event.get('usageMetadata')
                            self.last_json_text += delta
                            addition = public.feed(delta)
                            if addition and on_text:
                                on_text(addition)
                            if usage:
                                self.usage.append(usage)
                            if reason:
                                if reason not in {'STOP', 'stop'}:
                                    raise ValueError(f'模型流未完整结束（{reason}），部分动作未执行')
                                finished = True
                                break
                    finally:
                        events.close()
                    if not finished:
                        raise ValueError('模型流在完成标记前中断，部分动作未执行')
                    self.attempts.append({'model':model,'stream':True,'attempt':attempt+1,'status':'success',
                        'elapsed_seconds':round(time.monotonic()-started,3)})
                    break
                except StreamHTTPError as exc:
                    self.attempts.append({'model':model,'stream':True,'attempt':attempt+1,'http_status':exc.status})
                    if self.last_json_text or exc.status not in {429,500,502,503,504} or attempt == 4:
                        raise
                    time.sleep(min(5 * 2**attempt,30))
        self.calls += 1
        return parse_json(self.last_json_text, schema)

    def _native_curl_json(self, template, payload, schema, media, video=False):
        import base64
        parts = []
        for item in media:
            path = Path(item)
            parts.append({"text": f"素材 {path.name}"})
            parts.append({"inlineData": {"mimeType": mimetypes.guess_type(path.name)[0], "data": base64.b64encode(path.read_bytes()).decode()}})
        parts.append({"text": json.dumps(payload, ensure_ascii=False, default=str)})
        instruction = prompt(template) + "\n仅返回 JSON 对象，遵守以下 Schema：\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        model = self.config.video_review_model if video else self.config.text_model
        body = {"contents": [{"role": "user", "parts": parts}], "systemInstruction": {"parts": [{"text": instruction}]},
                "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": schema.model_json_schema(), "maxOutputTokens": 8192}}
        url = self.config.huanling_base_url.rstrip("/") + "/v1beta/models/" + model + ":generateContent"
        for attempt in range(5):
            started = time.monotonic()
            try:
                status, text = _curl_post(url, body, {"x-goog-api-key": os.environ["HUANLING_API_KEY"], "Content-Type": "application/json"},
                                          timeout=300 if video else 180)
            except RuntimeError as exc:
                self.attempts.append({"model": model, "api": "native", "transport": "curl", "attempt": attempt+1,
                                     "elapsed_seconds": round(time.monotonic()-started, 2), "error": str(exc)})
                raise
            self.attempts.append({"model": model, "api": "native", "transport": "curl", "attempt": attempt+1, "http_status": status,
                                  "elapsed_seconds": round(time.monotonic()-started,2)})
            if status in (429,500,502,503,504) and attempt < 4:
                time.sleep(min(5 * 2**attempt,30))
                continue
            if not 200 <= status < 300:
                raise RuntimeError(f"Gemini 原生接口 HTTP {status}，未自动切换模型")
            result = json.loads(text)
            if not result.get("candidates"):
                raise ValueError("Gemini 原生接口未返回候选")
            candidate = result["candidates"][0]
            self.calls += 1
            self.usage.append(result.get("usageMetadata", {}))
            self.attempts[-1]['finish_reason'] = candidate.get('finishReason')
            self.last_json_text = "".join(p.get("text", "") for p in candidate.get("content", {}).get("parts", []) if not p.get("thought"))
            return parse_json(self.last_json_text, schema)

    def _compatible_json(self, template, payload, schema, media, video):
        """显式选择同渠道兼容文本接口，不进行接口或模型自动降级。"""
        import base64
        import requests
        content = []
        for item in media:
            path = Path(item)
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if not mime.startswith("image/"):
                raise ValueError("兼容文本接口目前仅验证图像输入；视频评审需显式使用 native 接口")
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()}})
        content.append({"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)})
        instruction = prompt(template) + "\n仅返回单个 JSON 对象，遵守以下 Schema：\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        model = self.config.video_review_model if video else self.config.text_model
        for attempt in range(5):
            started = time.monotonic()
            body = {"model": model, "messages": [{"role": "system", "content": instruction}, {"role": "user", "content": content}],
                    "response_format": {"type": "json_object"}, "max_tokens": 8192}
            url = self.config.huanling_base_url.rstrip("/") + "/v1/chat/completions"
            if self.config.huanling_text_transport == "curl":
                status_code, response_text = _curl_post(url, body, {"Authorization": "Bearer " + os.environ["HUANLING_API_KEY"], "Content-Type": "application/json"})
            elif self.config.huanling_text_transport == "requests":
                response = requests.post(url, headers={"Authorization": "Bearer " + os.environ["HUANLING_API_KEY"]}, json=body, timeout=180)
                status_code, response_text = response.status_code, response.text
            else:
                raise ValueError("HUANLING_TEXT_TRANSPORT 请选择 requests 或 curl")
            self.attempts.append({"model": model, "api": "compatible", "attempt": attempt+1, "http_status": status_code,
                                  "elapsed_seconds": round(time.monotonic()-started, 2)})
            if status_code in (429,500,502,503,504) and attempt < 4:
                time.sleep(min(5 * 2**attempt,30))
                continue
            if not 200 <= status_code < 300:
                raise RuntimeError(f"Gemini 兼容接口 HTTP {status_code}，未自动切换模型")
            result = json.loads(response_text)
            if not result.get("choices"):
                raise ValueError("Gemini 兼容接口缺少 choices")
            self.attempts[-1]["finish_reason"] = result["choices"][0].get("finish_reason")
            self.calls += 1
            self.usage.append(result.get("usage", {}))
            self.last_json_text = result["choices"][0]["message"]["content"]
            return parse_json(self.last_json_text, schema)

    @professional_call
    def image(self, template: str, payload, media, destination: Path):
        if self.image_client:
            return self.image_client.image(template, payload, media, destination)
        parts = self._parts(payload, media)
        parts.append(types.Part.from_text(text=prompt(template)))
        result = self._call(
            model=self.config.image_model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"],
                    image_config=types.ImageConfig(aspect_ratio="16:9", image_size="1K")),
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        # 保存为真正的 PNG，避免模型返回 JPEG 数据但文件扩展名为 PNG。
        from io import BytesIO
        from PIL import Image
        for part in result.parts or []:
            if part.inline_data and part.inline_data.data:
                with Image.open(BytesIO(part.inline_data.data)) as im:
                    im.convert("RGB").save(destination, format="PNG")
                return destination
        raise RuntimeError(f"图像模型没有返回图片：{result.text or template}")

    def close(self):
        self.client.close()

    def save_usage(self, path: Path):
        write_json(path, {"successful_calls": self.calls, "usage": self.usage,
                         "attempts": self.attempts,
                         "image_usage": self.image_client.usage if self.image_client else []})

    @professional_call
    def json_to(self, template, payload, schema, media, destination, video=False):
        from ..io import cached_json, file_signature
        inputs = {"provider": self.config.model_provider,
                  "text_api": self.config.huanling_text_api if self.config.model_provider == "huanling" else "native",
                  "endpoint": self.config.huanling_base_url if self.config.model_provider == "huanling" else "google",
                  "schema": schema.model_json_schema(), "template": prompt(template), "payload": payload,
                  "model": self.config.video_review_model if video else self.config.text_model,
                  "media": [{"name": Path(p).name, "sha256": file_signature(p)} for p in media]}
        def produce():
            try:
                from ..agent.specialists import run
                return run(self, template, payload, schema, media, destination, video=video)
            except ValueError:
                write_json(Path(destination).with_suffix(".failed.json"), {"text": self.last_json_text})
                raise
        return cached_json(destination, inputs, produce, schema)
