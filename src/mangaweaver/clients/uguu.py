"""显式 Uguu 临时图片上传；不接收或转发任何模型 API Key。"""
import hashlib
import mimetypes
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

from ..io import file_signature, read_json, write_json


class Uguu:
    def upload(self, path):
        path = Path(path)
        digest = file_signature(path)
        record = path.with_suffix('.uguu.json')
        if record.exists():
            saved = read_json(record)
            if saved['source_signature'] == digest and saved['expires_at'] > time.time() + 300:
                return saved['url']
        mime = mimetypes.guess_type(path.name)[0]
        if mime not in ('image/png', 'image/jpeg', 'image/webp'):
            raise ValueError('Uguu 当前仅上传视频所需的 PNG/JPEG/WEBP 关键帧')
        with path.open('rb') as file:
            response = requests.post('https://uguu.se/upload',
                files={'files[]': (digest[:16]+path.suffix, file, mime)}, timeout=120)
        response.raise_for_status()
        data = response.json()
        files = data.get('files', [])
        if not data.get('success') or len(files) != 1:
            raise RuntimeError(f'Uguu 图片上传失败：{str(data)[:500]}')
        url = files[0]['url']
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not (parsed.hostname == 'uguu.se' or (parsed.hostname or '').endswith('.uguu.se')):
            raise ValueError('Uguu 返回非预期图片域名')
        downloaded = requests.get(url, timeout=60)
        downloaded.raise_for_status()
        if hashlib.sha256(downloaded.content).hexdigest() != digest:
            raise ValueError('公开图片内容与已审查关键帧不一致，停止视频提交')
        write_json(record, {'provider': 'uguu', 'source_signature': digest, 'url': url,
            'uploaded_at': time.time(), 'expires_at': time.time()+3*3600})
        return url
