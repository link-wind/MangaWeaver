"""幻灵 OpenAI 兼容 GPT Image：参考图编辑、单次提交与结果保存。"""
import base64
import json
import mimetypes
import os
import subprocess
import time
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

import requests
from PIL import Image

from ..io import file_signature, prompt, read_json, signature, write_json


def _curl_image(url, key, parameters, media):
    """沿用文本接口的 stdin 配置传递凭据，multipart 保留所有参考图。"""
    settings = 'url = ' + json.dumps(url) + '\n'
    settings += 'header = ' + json.dumps('Authorization: Bearer ' + key) + '\n'
    if media:
        for name, value in parameters.items():
            settings += 'form-string = ' + json.dumps(f'{name}={value}', ensure_ascii=False) + '\n'
        for path in media:
            filename = str(path.resolve()).replace('\\', '\\\\').replace('"', '\\"')
            value = f'image[]=@"{filename}";type={mimetypes.guess_type(path.name)[0] or "image/png"}'
            settings += 'form = ' + json.dumps(value, ensure_ascii=False) + '\n'
    else:
        settings += 'header = "Content-Type: application/json"\n'
        settings += 'data = ' + json.dumps(json.dumps(parameters, ensure_ascii=False), ensure_ascii=False) + '\n'
    result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '300', '--config', '-',
        '--write-out', '\n%{http_code}\n%header{x-request-id}'], input=settings, text=True,
        capture_output=True, timeout=310)
    if result.returncode:
        raise RuntimeError(f'GPT Image curl 请求失败（{result.returncode}），请核对平台记录，不自动重新提交')
    body, status, request_id = result.stdout.rsplit('\n', 2)
    response = requests.Response()
    response.status_code = int(status)
    response._content = body.encode('utf-8')
    response.headers['x-request-id'] = request_id
    return response


def _curl_download(url):
    """只下载已生成的公开图片，不向 CDN 附带模型凭据。"""
    with TemporaryDirectory() as folder:
        target = Path(folder) / 'image'
        result = subprocess.run(['curl', '--silent', '--show-error', '--location', '--max-time', '120',
            '--config', '-', '--output', str(target), '--write-out', '%{http_code}'],
            input='url = ' + json.dumps(url, ensure_ascii=False) + '\n',
            text=True, capture_output=True, timeout=130)
        if result.returncode or result.stdout != '200':
            raise RuntimeError(f'GPT Image 下载失败（curl {result.returncode}，HTTP {result.stdout}），可恢复原图片下载')
        return target.read_bytes()


class GPTImage:
    def __init__(self, config):
        self.config = config
        self.base = config.huanling_base_url.rstrip("/").removesuffix("/v1")
        self.key = os.getenv("HUANLING_IMAGE_API_KEY")
        self.usage = []

    def image(self, template, payload, media, destination):
        if not self.key:
            raise ValueError("请配置 HUANLING_IMAGE_API_KEY")
        destination = Path(destination)
        media = list(map(Path, media))
        parameters = {"model": self.config.image_model,
            "prompt": prompt(template) + "\n" + json.dumps(payload, ensure_ascii=False, default=str),
            "size": self.config.image_size, "quality": self.config.image_quality, "n": 1}
        fingerprint = signature({"provider": "huanling", "endpoint": self.base,
            "parameters": parameters, "media": [file_signature(p) for p in media]})
        state_path = destination.with_suffix(".task.json")
        response_path = destination.with_suffix(".response.json")
        if state_path.exists():
            state = read_json(state_path)
            if state["signature"] != fingerprint:
                raise ValueError(f"GPT Image 输入已变化，请使用新运行目录：{destination}")
            if state["status"] == "downloaded" and destination.exists() and file_signature(destination) == state["image_signature"]:
                return destination
            if state['status'] != 'received' or not response_path.exists():
                raise ValueError(f"上次生图结果未确认或文件变化，请核对平台记录，不自动重复提交：{state_path}")
            result = read_json(response_path)
        else:
            route = "/v1/images/edits" if media else "/v1/images/generations"
            state = {"signature": fingerprint, "status": "submitting", "model": self.config.image_model,
                 "endpoint": self.base + route, "size": self.config.image_size, "quality": self.config.image_quality,
                 "transport": self.config.huanling_image_transport}
            write_json(state_path, state)
            started = time.monotonic()
            headers = {"Authorization": f"Bearer {self.key}"}
            if self.config.huanling_image_transport == 'curl':
                response = _curl_image(self.base + route, self.key, parameters, media)
            else:
                with ExitStack() as stack:
                    if media:
                        files = [("image[]", (p.name, stack.enter_context(p.open("rb")), mimetypes.guess_type(p.name)[0] or "image/png")) for p in media]
                        response = requests.post(self.base + route, headers=headers, data=parameters,
                            files=files, timeout=300, allow_redirects=False)
                    else:
                        response = requests.post(self.base + route, headers=headers, json=parameters,
                            timeout=300, allow_redirects=False)
            state.update(http_status=response.status_code, elapsed_seconds=round(time.monotonic()-started, 2),
                     request_id=response.headers.get("x-request-id"))
            if response.status_code != 200:
                state.update(status="failed", error=response.text[:1500].replace(self.key, "[REDACTED]"))
                write_json(state_path, state)
                raise RuntimeError(f"GPT Image HTTP {response.status_code}: {state['error']}")
            result = response.json()
            write_json(response_path, result)
            state.update(status="received", usage=result.get("usage"))
            write_json(state_path, state)
        images = result.get("data", [])
        if len(images) != 1:
            raise ValueError(f"GPT Image 需返回一张图片，实际 {len(images)} 张：{state_path}")
        if images[0].get("b64_json"):
            content = base64.b64decode(images[0]["b64_json"])
        elif images[0].get("url"):
            # 图片 CDN 不携带 API Key。
            if self.config.huanling_image_transport == 'curl':
                content = _curl_download(images[0]['url'])
            else:
                download = requests.get(images[0]["url"], timeout=120)
                download.raise_for_status()
                content = download.content
        else:
            raise ValueError(f"GPT Image 未返回图片数据：{state_path}")
        with Image.open(BytesIO(content)) as image:
            if abs(image.width/image.height - 16/9) > .025:
                raise ValueError("GPT Image 结果不为所需 16:9，不自动裁切")
            state["dimensions"] = list(image.size)
            temporary = destination.with_suffix(".partial.png")
            image.convert("RGB").save(temporary, format="PNG")
        temporary.replace(destination)
        state.update(status="downloaded", image_signature=file_signature(destination))
        write_json(state_path, state)
        self.usage.append(state)
        return destination
