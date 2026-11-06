"""已复现执行边界的离线回归，不调用模型。"""
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mangaweaver import desktop
from mangaweaver.agent import tasks
from mangaweaver.io import read_json, signature, write_json
from mangaweaver.run_lock import run_lock


class ReviewFixTests(unittest.TestCase):
    def test_reentrant_lock_still_rejects_another_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with run_lock(root, 'agent'), run_lock(root, 'plan'):
                code = "from pathlib import Path;from mangaweaver.run_lock import run_lock\nwith run_lock(Path(__import__('sys').argv[1]),'competitor'):pass"
                result = subprocess.run([sys.executable, '-c', code, tmp], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('正在', result.stderr)
            with run_lock(root, 'next'):
                pass

    def test_legacy_submission_only_clears_the_read_canvas_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            run = project / 'runs/page'
            write_json(project / 'project.json', {'runs': ['runs/page']})
            path = write_json(run / 'canvas.json', {'draft': '修改停顿', 'positions': {}})
            old = signature(read_json(path))
            # 即使文本相同，其他字段的并发编辑也不能被旧快照写回覆盖。
            write_json(path, {'draft': '修改停顿', 'positions': {'source': {'x': 10, 'y': 20}}})
            request = {'command': 'submit_revision', 'project': tmp, 'run_dir': str(run),
                       'text': '修改停顿', 'expected_revision': old}
            tasks.submit(request)
            self.assertEqual(read_json(path)['draft'], '修改停顿')
            self.assertEqual(read_json(path)['positions']['source']['x'], 10)
            tasks.submit({**request, 'message_id': 'second', 'expected_revision': signature(read_json(path))})
            self.assertEqual(read_json(path)['draft'], '')

    def test_argparse_exit_has_a_failed_jsonl_event(self):
        from mangaweaver.cli import parser
        output = io.StringIO()
        def invalid(_):
            parser().parse_args(['plan', '--run-dir', '/tmp/unused', '--until-stage', 'invalid'])
        with patch('sys.stdin', io.StringIO(json.dumps({'command': 'invalid', 'request_id': 'offline'}) + '\n')), \
             patch('sys.stdout', output), patch('sys.stderr', io.StringIO()), \
             patch.object(desktop, 'dispatch', side_effect=invalid):
            self.assertEqual(desktop.main(), 1)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([event['type'] for event in events], ['started', 'failed'])
        self.assertIn('参数无效', events[-1]['data']['message'])
