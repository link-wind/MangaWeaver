import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from mangaweaver.desktop import read_run, save_source, resume_downloads
from mangaweaver.config import Config
from mangaweaver.io import write_json
from mangaweaver.run_lock import run_lock


class DesktopBoundaryTest(unittest.TestCase):
    def test_simulation_stops_resumes_and_cannot_generate(self):
        import shutil
        from unittest.mock import patch
        from mangaweaver.desktop import dispatch
        from mangaweaver.desktop_simulation import create, run
        if not shutil.which('ffmpeg'):
            self.skipTest('simulation requires local FFmpeg')
        with tempfile.TemporaryDirectory() as temp, patch('socket.socket.connect', side_effect=AssertionError('模拟任务不可联网')):
            root = Path(temp)
            create(root)
            with patch('mangaweaver.desktop_simulation.time.sleep', side_effect=[None, None, KeyboardInterrupt]):
                with self.assertRaises(KeyboardInterrupt):
                    run(root)
            interrupted = read_run(root)
            self.assertEqual(interrupted['simulation']['step'], 2)
            self.assertFalse(interrupted['simulation']['completed'])
            self.assertEqual(len(json.loads((root/'source/manifest.json').read_text())['panels']), 1)
            run(root, delay=0)
            finished = read_run(root)
            self.assertTrue(finished['simulation']['completed'])
            self.assertTrue((root/'simulation.mp4').is_file())
            self.assertFalse((root/'production.json').exists())
            for command in ('generate', 'plan', 'resume', 'preprocess', 'agent_message'):
                with self.assertRaisesRegex(ValueError, '模拟任务'):
                    dispatch({'command': command, 'run_dir': temp})

    def test_runtime_events_stream_and_reopen_without_rewriting_history(self):
        import sys
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            request = {'request_id': 'local-import', 'command': 'preprocess', 'run_dir': temp,
                       'manifest': str(root / 'examples/cross-panel/source.json'), 'env_file': '/dev/null'}
            child = subprocess.Popen([sys.executable, '-m', 'mangaweaver.desktop'], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            child.stdin.write(json.dumps(request) + '\n')
            child.stdin.close()
            events = []
            for line in child.stdout:
                event = json.loads(line)
                events.append(event)
                if event['type'] == 'artifact':
                    self.assertTrue(Path(event['data']['path']).exists())
            child.wait(timeout=20)
            child.stdout.close()
            child.stderr.close()
            self.assertEqual(child.returncode, 0)
            self.assertTrue(any(e['type'] == 'artifact' for e in events))
            self.assertEqual(len({e['id'] for e in events}), len(events))
            self.assertTrue(all(e['timestamp'] and Path(e['run_dir']).resolve() == directory.resolve() for e in events))
            log = directory / 'runtime_events.jsonl'
            history = log.read_bytes()
            self.assertEqual(read_run(directory)['events'][-1]['type'], 'completed')
            self.assertEqual(log.read_bytes(), history)
            self.assertNotIn('events', json.loads(history.splitlines()[-1])['data'])

    def test_source_crop_order_and_old_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json(root / 'project.json', {'version': 1})
            page = root / 'page.png'
            Image.new('RGB', (100, 100)).save(page)
            request = {'project': str(root), 'page': str(page), 'panels': [
                {'bbox': [50, 0, 100, 100], 'text': '你好', 'speaker': 'A'},
                {'bbox': [0, 0, 50, 100], 'text': '再见'}]}
            one, two = save_source(request), save_source(request)
            self.assertNotEqual(one['manifest'], two['manifest'])
            source = json.loads(Path(one['manifest']).read_text())
            self.assertEqual([p['bbox'][0] for p in source['panels']], [50, 0])
            self.assertEqual(source['panels'][0]['text'], 'A：你好')
            self.assertTrue(Path(one['manifest']).is_file())

    def test_lock_cross_process(self):
        with tempfile.TemporaryDirectory() as temp:
            with run_lock(Path(temp), 'test'):
                result = subprocess.run([__import__('sys').executable, '-c',
                    'from mangaweaver.run_lock import run_lock; from pathlib import Path; '
                    f'\nwith run_lock(Path({temp!r}), "other"): pass'], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            with run_lock(Path(temp), 'again'):
                pass

    def test_resume_downloaded_or_unknown_never_submits(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            task = root / 'video/s001/s001_seg01/tasks.json'
            write_json(task, {'candidates': {'candidate_1': {'task_id': 'existing', 'status': 'downloaded'}}})
            self.assertIn('未产生任何网络请求', resume_downloads(Config(), root)['message'])
            write_json(task, {'candidates': {'candidate_1': {'status': 'submitting'}}})
            with self.assertRaisesRegex(ValueError, '不明'):
                resume_downloads(Config(), root)

    def test_historical_mapping(self):
        root = Path(__file__).resolve().parents[1]
        history = root / 'results/iruma-dialogue-page094-ja-20s-6panels'
        if not history.is_dir():
            self.skipTest('local historical results not installed')
        data = read_run(history)
        production = next(r['data'] for r in data['records'] if r['file'] == 'production.json')
        self.assertEqual(len(production['source']['panels']), 6)
        self.assertTrue(any(len(s['source_panel_ids']) > 1 for s in production['shot_list']['shots']))
        self.assertTrue(any(p.endswith('preview.mp4') for p in data['media']))
