"""真实本地 HTTP：参考图传输与失败下载恢复，不调用付费模型。"""
import json
import os
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch

from PIL import Image

from mangaweaver.clients.gpt_image import GPTImage
from mangaweaver.clients.gemini import Gemini
from mangaweaver.config import Config
from mangaweaver.events import assignment


class ImageResumeTests(unittest.TestCase):
    def test_resume_download_without_paid_resubmit(self):
        posts, downloads = [], []
        png = BytesIO()
        Image.new('RGB', (160, 90), 'blue').save(png, format='PNG')

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                posts.append(self.rfile.read(int(self.headers['Content-Length'])))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'data': [{'url': f'http://127.0.0.1:{self.server.server_port}/asset'}]}).encode())

            def do_GET(self):
                downloads.append(self.headers.get('Authorization'))
                self.send_response(503 if len(downloads) == 1 else 200)
                self.end_headers()
                self.wfile.write(png.getvalue())

            def log_message(self, *args):
                pass

        server = HTTPServer(('127.0.0.1', 0), Handler)
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with TemporaryDirectory() as folder, patch.dict(os.environ, HUANLING_IMAGE_API_KEY='local-test-key'):
                root = Path(folder)
                reference = root / '参考, semi; quote".png'
                reference.write_bytes(png.getvalue())
                output = root / 'output.png'
                client = GPTImage(Config(huanling_base_url=f'http://127.0.0.1:{server.server_port}', image_model='test'))
                gateway = Gemini.__new__(Gemini)
                gateway.image_client = client
                args = ('planning/storyboard/create.txt', {'instruction': '中文\n"quoted" @<literal> $()'}, [reference, reference], output)
                brief = {'stage':'storyboard','goal':'依照指定参考构图','references':[{'purpose':'reference','path':str(reference)}]}
                with assignment(brief, [str(reference)]):
                    with self.assertRaisesRegex(RuntimeError, '可恢复原图片下载'):
                        gateway.image(*args)
                    self.assertEqual(json.loads(output.with_suffix('.task.json').read_text())['status'], 'received')
                    self.assertEqual(gateway.image(*args), output)
                    gateway.image(*args)
                with assignment({**brief,'goal':'不同的参考要求'}, [str(reference)]):
                    with self.assertRaisesRegex(ValueError, '输入已变化'):
                        gateway.image(*args)
                self.assertEqual(len(posts), 1)
                self.assertEqual(posts[0].count(png.getvalue()), 2)
                self.assertIn('中文'.encode(), posts[0])
                self.assertIn('依照指定参考构图'.encode(), posts[0])
                self.assertEqual(downloads, [None, None])
                with Image.open(output) as image:
                    self.assertEqual(image.size, (160, 90))
        finally:
            server.shutdown()
            server.server_close()
