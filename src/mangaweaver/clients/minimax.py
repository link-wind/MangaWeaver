"""MiniMax H3 Lite V2：真实首帧／首尾帧角色，无参考图模式替代。"""
import base64
import mimetypes
import json
import subprocess
import time
from pathlib import Path

import requests
from PIL import Image

from ..config import Config
from ..schemas import VideoTask


def validate_task(task: VideoTask, config: Config):
    standard = config.video_provider == "huanling" and config.minimax_model == "MiniMax-H3"
    if config.minimax_model != "MiniMax-H3-Lite" and not standard:
        raise ValueError("当前支持 H3 Lite，或本次明确指定的幻灵标准 H3；不会自动替换模型")
    duration = task.target_duration
    if not duration.is_integer() or not 4 <= duration <= 15:
        raise ValueError(f"{task.segment_id} 目标时长 {duration}s 不符合 H3 的 4～15 整数秒；请修改演出计划")
    resolutions = ("768P", "2K") if standard else ("480P", "768P")
    if config.resolution not in resolutions:
        raise ValueError(f"{config.minimax_model} 分辨率必须为 {resolutions}")
    sizes = []
    for path in [task.first_frame] + ([task.last_frame] if task.last_frame else []):
        if path.stat().st_size > 30 * 1024 * 1024:
            raise ValueError(f"图像超过 H3 单文件限制：{path}")
        with Image.open(path) as im:
            w, h = im.size
        if not (256 <= w <= 5760 and 256 <= h <= 5760 and 0.4 <= w / h <= 2.5):
            raise ValueError(f"H3 图像尺寸不受支持：{path} ({w}×{h})")
        if abs(w / h - 16 / 9) > .025:
            raise ValueError(f"关键帧必须预先制作成 16:9：{path}，不自动裁切改动构图")
        sizes.append((w, h))
    if len(set(sizes)) > 1:
        raise ValueError(f"{task.segment_id} 首尾帧尺寸不一致")
    return int(duration)


def data_uri(path: Path):
    mime = mimetypes.guess_type(path.name)[0]
    if mime not in ("image/png", "image/jpeg", "image/webp"):
        raise ValueError(f"当前本地图像输入仅接受 PNG/JPEG/WEBP：{path}")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def payload(task: VideoTask, config: Config):
    duration = validate_task(task, config)
    content = [{"type": "text", "text": task.prompt},
               {"type": "image_url", "image_url": {"url": data_uri(task.first_frame)}, "role": "first_frame"}]
    if task.last_frame:
        content.append({"type": "image_url", "image_url": {"url": data_uri(task.last_frame)}, "role": "last_frame"})
    result = {"model": config.minimax_model, "content": content, "duration": duration,
              "resolution": config.resolution, "ratio": "adaptive"}
    import json
    if len(json.dumps(result).encode()) > 64 * 1024 * 1024:
        raise ValueError(f"{task.segment_id} 请求超过 H3 的 64MB 限制")
    return result


class MiniMax:
    def __init__(self, config: Config):
        import os
        if config.video_provider not in ("minimax", "huanling"):
            raise ValueError(f"未知视频供应商：{config.video_provider}")
        if config.video_provider == "huanling" and config.minimax_model != "MiniMax-H3":
            raise ValueError("幻灵仅支持标准 MiniMax-H3；本次需显式选择该模型及 768P，不自动改用标准版")
        key = os.getenv("HUANLING_VIDEO_API_KEY" if config.video_provider == "huanling" else "MINIMAX_API_KEY")
        if not key:
            raise ValueError("请配置 MINIMAX_API_KEY")
        self.config = config
        self.session = requests.Session()
        self.key = key
        self.session.headers.update({"Authorization": f"Bearer {key}"})
        self.base = config.minimax_base_url.rstrip("/")
        self.curl = config.video_provider == 'huanling' and config.huanling_video_transport == 'curl'
        self.uploader = None
        if config.video_provider == "huanling":
            # 上传方式显式选择，不自动切换模型或生成渠道。
            if config.video_upload_provider == "kie":
                from dataclasses import replace
                from .kie import Kie
                self.uploader = Kie(replace(config, image_provider=""))
            elif config.video_upload_provider == "uguu":
                from .uguu import Uguu
                self.uploader = Uguu()
            else:
                raise ValueError(f"未知素材上传方式：{config.video_upload_provider}")

    def _curl_json(self, path, body=None):
        settings = 'url = ' + json.dumps(self.base + path) + '\n'
        settings += 'header = ' + json.dumps('Authorization: Bearer ' + self.key) + '\n'
        if body is not None:
            settings += 'header = "Content-Type: application/json"\n'
            settings += 'data = ' + json.dumps(json.dumps(body, ensure_ascii=False), ensure_ascii=False) + '\n'
        result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '120', '--config', '-',
            '--write-out', '\n%{http_code}'], input=settings, text=True, capture_output=True, timeout=130)
        if result.returncode:
            raise RuntimeError(f'H3 curl 请求失败（{result.returncode}），请核对原任务记录，不自动重新提交')
        content, status = result.stdout.rsplit('\n', 1)
        if status != '200':
            raise RuntimeError(f'H3 HTTP {status}: {content[:1500].replace(self.key, "[REDACTED]")}')
        return json.loads(content)

    def submit(self, task: VideoTask):
        request = payload(task, self.config)
        if self.uploader:
            request["content"][1]["image_url"]["url"] = self.uploader.upload(task.first_frame)
            if task.last_frame:
                request["content"][2]["image_url"]["url"] = self.uploader.upload(task.last_frame)
        # POST 不自动重试，以免网络超时后产生重复计费任务。
        if self.curl:
            data = self._curl_json('/v2/video_generation', request)
        else:
            response = self.session.post(f"{self.base}/v2/video_generation", json=request, timeout=120)
            if response.status_code != 200:
                raise RuntimeError(f"H3 创建 HTTP {response.status_code}: {response.text[:1500].replace(self.key, '[REDACTED]')}")
            response.raise_for_status()
            data = response.json()
        if not data.get("task_id"):
            raise RuntimeError("H3 创建接口未返回 task_id；请核对平台任务后再显式重试")
        return str(data["task_id"])

    def poll(self, task_id: str):
        deadline = time.monotonic() + self.config.poll_timeout
        while time.monotonic() < deadline:
            if self.curl:
                task = self._curl_json(f'/v2/query/video_generation/{task_id}')['task']
            else:
                response = self.session.get(f"{self.base}/v2/query/video_generation/{task_id}", timeout=60)
                response.raise_for_status()
                task = response.json()["task"]
            status = task["status"]
            if status == "succeeded":
                return task
            if status in ("failed", "cancelled"):
                raise RuntimeError(f"H3 任务 {task_id} {status}: {task.get('error', {})}")
            if status not in ("queued", "running"):
                raise RuntimeError(f"H3 未知任务状态：{status}")
            time.sleep(self.config.poll_interval)
        raise TimeoutError(f"H3 任务 {task_id} 查询超时，可通过同一运行目录继续查询")

    def download(self, url: str, destination: Path):
        from urllib.parse import urlsplit
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".part")
        target, origin = urlsplit(url), urlsplit(self.base)
        # 幻灵结果是同源受保护的 content 接口；外部 CDN 不携带 API Key。
        protected = (self.config.video_provider == "huanling" and target.scheme == origin.scheme == "https"
            and target.netloc == origin.netloc and target.path.startswith("/v2/video_generation/")
            and target.path.endswith("/content"))
        headers = {"Authorization": f"Bearer {self.key}"} if protected else {}
        if self.curl:
            settings = 'url = ' + json.dumps(url) + '\n'
            for name, value in headers.items():
                settings += 'header = ' + json.dumps(name + ': ' + value) + '\n'
            args = ['curl', '--silent', '--show-error', '--max-time', '120', '--config', '-',
                    '--output', str(temporary), '--write-out', '%{http_code}']
            # 受保护接口不跟随跳转；外部 CDN 下载始终不携带模型凭据。
            if not protected:
                args.append('--location')
            result = subprocess.run(args, input=settings, text=True, capture_output=True, timeout=130)
            if result.returncode or result.stdout != '200':
                raise RuntimeError(f'H3 下载失败（curl {result.returncode}，HTTP {result.stdout}），可查询原任务恢复')
            temporary.replace(destination)
            return destination
        with requests.get(url, headers=headers, timeout=120, stream=True) as response:
            response.raise_for_status()
            with temporary.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
        temporary.replace(destination)
        return destination
