"""永久删除的范围映射与来源保护；仅临时离线样例，不请求模型。"""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from mangaweaver.desktop_delete import handle
from mangaweaver.io import read_json, write_json
from mangaweaver.planning.pipeline import PlanningDraft
from mangaweaver.run_lock import run_lock

FIXTURE = Path(__file__).resolve().parents[1] / 'examples/cross-panel/production.json'


class CanvasDeleteTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.root = self.project / 'runs/a'
        write_json(self.project / 'project.json', {'runs': ['runs/a', 'runs/b']})
        plan = deepcopy(read_json(FIXTURE))
        original = self.root / 'input/page.png'
        original.parent.mkdir(parents=True)
        original.write_bytes(b'original-page')
        write_json(self.root / 'canvas.json', {'version': 1, 'page': str(original)})
        for panel in plan['source']['panels']:
            image = self.root / 'source/panels' / f"{panel['panel_id']}.png"
            image.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(b'crop')
            panel['image'] = str(image)
        for asset in plan['assets']:
            image = self.root / 'iter0/storyboard' / asset['shot_id'] / asset['keyframe_id'] / 'candidate_1.png'
            image.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(b'generated')
            asset['image'] = str(image)
            write_json(image.with_suffix('.json'), {'asset': asset})
        for shot in plan['shot_list']['shots']:
            clip = self.root / 'video' / shot['shot_id'] / 'seg1/candidate_1.mp4'
            clip.parent.mkdir(parents=True)
            clip.write_bytes(b'video')
            write_json(clip.parent / 'tasks.json', {'candidates': {'candidate_1': {
                'path': str(clip), 'task_id': 'remote-' + shot['shot_id'], 'status': 'downloaded'}}})
        for name in ('production.json', 'planning_state.json', 'iter0/selected.json'):
            write_json(self.root / name, plan)
        write_json(self.root / 'source/manifest.json', plan['source'])
        write_json(self.root / 'source/prepared.json', plan['source'])
        for name in ('final.mp4', 'final_clean.mp4', 'final.srt'):
            (self.root / name).write_bytes(b'final')
        self.other = self.project / 'runs/b/final.mp4'
        self.other.parent.mkdir(parents=True)
        self.other.write_bytes(b'other-page')
        self.plan = plan

    def request(self, node, scope='node'):
        return {'project': str(self.project), 'selections': [
            {'run_dir': str(self.root), 'node_ids': [node], 'scope': scope}]}

    def delete(self, request):
        preview = handle(request)
        return handle({**request, 'expected_revision': preview['revision']}, delete=True)

    def test_frame_removes_all_candidates_video_and_export_but_preserves_other_frames(self):
        asset = self.plan['assets'][0]
        other = next(a for a in self.plan['assets'] if a['shot_id'] != asset['shot_id'])
        image = Path(asset['image'])
        (image.parent / 'candidate_2.png').write_bytes(b'other-candidate')
        result = self.delete(self.request('frame:' + asset['keyframe_id']))
        self.assertGreater(result['remote_tasks'], 0)
        self.assertFalse(image.exists())
        self.assertFalse(image.parent.exists())
        self.assertFalse((self.root / 'video' / asset['shot_id']).exists())
        self.assertFalse((self.root / 'final.mp4').exists())
        self.assertFalse((self.root / 'production.json').exists())
        self.assertFalse((self.root / 'iter0/selected.json').exists())
        draft = PlanningDraft.model_validate(read_json(self.root / 'planning_draft.json'))
        self.assertNotIn(asset['keyframe_id'], [a.keyframe_id for a in draft.assets])
        self.assertTrue(Path(other['image']).exists())
        self.assertTrue((self.root / 'video' / other['shot_id'] / 'seg1/tasks.json').exists())
        self.assertEqual((self.root / 'input/page.png').read_bytes(), b'original-page')
        self.assertEqual(self.other.read_bytes(), b'other-page')

    def test_downstream_of_shot_keeps_shot_and_direction(self):
        shot = self.plan['shot_list']['shots'][0]['shot_id']
        self.delete(self.request('shot:' + shot, 'downstream'))
        draft = PlanningDraft.model_validate(read_json(self.root / 'planning_draft.json'))
        self.assertIn(shot, [s.shot_id for s in draft.shot_list.shots])
        self.assertEqual([d.model_dump(mode='json') for d in draft.directions], self.plan['directions'])
        self.assertFalse(any(a.shot_id == shot for a in draft.assets))
        self.assertTrue((self.root / 'source/manifest.json').exists())

    def test_column_and_panel_deletion_preserve_original_and_other_page(self):
        self.delete(self.request('group:frame'))
        self.assertFalse((self.root / 'iter0/storyboard').exists())
        self.assertEqual(read_json(self.root / 'planning_draft.json')['assets'], [])
        write_json(self.root / 'planning_draft.json', self.plan)
        self.delete(self.request('panel:p001'))
        self.assertFalse((self.root / 'source/panels/p001.png').exists())
        self.assertTrue((self.root / 'source/panels/p002.png').exists())
        self.assertFalse((self.root / 'planning_draft.json').exists())
        self.assertFalse((self.root / 'production.json').exists())
        self.assertEqual([p['panel_id'] for p in read_json(self.root / 'source/manifest.json')['panels']], ['p002', 'p003'])
        self.delete(self.request('source'))
        self.assertTrue((self.root / 'input/page.png').exists())
        self.assertTrue(self.other.exists())
        self.assertFalse((self.root / 'source').exists())

    def test_preview_cancel_conflict_lock_and_external_source_never_delete(self):
        request = self.request('source')
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        preview = handle(request)  # 关闭弹窗即不发 delete 命令。
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        (self.root / 'final.mp4').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, '范围已变化'):
            handle({**request, 'expected_revision': preview['revision']}, delete=True)
        self.assertTrue((self.root / 'production.json').exists())
        # 独立线程的执行仍须被锁拒绝，同一调用链现在允许合法重入。
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        ready, release = Event(), Event()
        def generating():
            with run_lock(self.root, 'generating'):
                ready.set()
                release.wait(5)
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(generating)
            self.assertTrue(ready.wait(5))
            try:
                with self.assertRaisesRegex(ValueError, '正在'):
                    handle({**request, 'expected_revision': preview['revision']}, delete=True)
            finally:
                release.set()
                running.result()
        outside = self.project / 'original.png'
        outside.write_bytes(b'original-outside-run')
        canvas = read_json(self.root / 'canvas.json')
        canvas['page'] = str(outside)
        write_json(self.root / 'canvas.json', canvas)
        source = read_json(self.root / 'source/manifest.json')
        source['panels'][0]['image'] = str(outside)
        write_json(self.root / 'source/manifest.json', source)
        self.delete(request)
        self.assertEqual(outside.read_bytes(), b'original-outside-run')
        self.assertEqual((self.root / 'input/page.png').read_bytes(), b'original-page')
