"""画布绑定与阶段暂停的关键边界；不请求模型。"""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mangaweaver.config import Config
from mangaweaver.desktop import start_canvas, save_canvas, fork_canvas
from mangaweaver.generation.tasks import load_plan
from mangaweaver.io import read_json, write_json
from mangaweaver.planning import pipeline
from mangaweaver.schemas import ReviewReport

ROOT = Path(__file__).resolve().parents[1]


class CanvasWorkflowTest(unittest.TestCase):
    def test_book_workspace_view_preserves_page_identity_and_finite_viewports(self):
        from mangaweaver.desktop import validate_view
        view = {'workspace': {'mode': 'page', 'page_id': 'page0094'},
                'page_views': {'page0094': {'viewport': {'x': -120, 'y': 56, 'zoom': 0.7},
                                          'selected': '/page94::frame:s003_k0'}},
                'composer': {'text': '保持双人近景', 'page_id': 'page0094', 'run': '/page94'}}
        result = validate_view(view)
        self.assertEqual(result['workspace'], view['workspace'])
        self.assertEqual(result['page_views'], view['page_views'])
        self.assertEqual(result['composer']['page_id'], 'page0094')
        view['page_views']['page0094']['viewport']['zoom'] = float('nan')
        with self.assertRaises(ValueError):
            validate_view(view)

    def test_input_bound_and_revision_has_no_paid_tasks(self):
        import shutil
        plan = load_plan(ROOT / 'examples/cross-panel/production.json')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first, second = root / 'first', root / 'revision'
            first.mkdir(); second.mkdir()
            manifest = write_json(root / 'source.json', plan.source)
            state = start_canvas({'run_dir': str(first), 'manifest': str(manifest), 'prompt': '保持角色对视，动作前留出停顿'})
            source = read_json(first / 'source/manifest.json')
            self.assertEqual(source['creative_brief'], state['prompt'])
            state['positions'] = {'source': {'x': 12.5, 'y': 30}}
            state['view'] = {'hidden_nodes': ['shot:s001']}
            save_canvas({'run_dir': str(first), 'canvas': state})
            self.assertEqual(read_json(first / 'canvas.json')['positions'], state['positions'])
            self.assertNotIn('hidden_nodes', read_json(first / 'canvas.json')['view'])
            changed = dict(state, prompt='偷偷改输入')
            with self.assertRaisesRegex(ValueError, '已绑定'):
                save_canvas({'run_dir': str(first), 'canvas': changed})
            # A real completed planning checkpoint can be reused; paid task IDs cannot.
            for index, asset in enumerate(plan.assets):
                image = first / 'images' / f'frame{index}.png'
                image.parent.mkdir(exist_ok=True)
                shutil.copyfile(asset.image, image)
                asset.image = image
            write_json(first / 'planning_state.json', plan)
            write_json(first / 'video/s001/s001_seg01/tasks.json', {'candidates': {'candidate_1': {'task_id': 'already-paid'}}})
            fork_canvas({'run_dir': str(second), 'from_run': str(first)})
            self.assertTrue((second / 'planning_state.json').exists())
            self.assertFalse((second / 'video').exists())
            self.assertFalse((second / 'production.json').exists())
            retained = read_json(second / 'planning_state.json')['assets']
            shutil.rmtree(first / 'images')
            from mangaweaver.io import file_signature
            self.assertTrue(all(Path(a['image']).is_relative_to(second.resolve()) and file_signature(a['image']) == a['image_signature'] for a in retained))
            self.assertEqual(read_json(first / 'video/s001/s001_seg01/tasks.json')['candidates']['candidate_1']['task_id'], 'already-paid')

    def test_edit_revision_rejects_external_change_and_first_create_race(self):
        from mangaweaver.desktop import read_run, EditConflict
        from mangaweaver.io import signature
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            state = {'version': 1, 'page': '', 'prompt': '', 'draft': '甲'}
            saved = save_canvas({'run_dir': temp, 'canvas': state, 'expected_revision': None})
            baseline = read_run(root)['canvas_revision']
            self.assertEqual(baseline, saved['revision'])
            external = {**read_json(root/'canvas.json'), 'draft': '外部修改'}
            write_json(root/'canvas.json', external)
            with self.assertRaises(EditConflict):
                save_canvas({'run_dir': temp, 'canvas': {**state, 'draft': '本地草稿'}, 'expected_revision': baseline})
            with self.assertRaises(EditConflict):
                save_canvas({'run_dir': temp, 'canvas': state, 'expected_revision': None})
            self.assertEqual(signature(read_json(root/'canvas.json')), signature(external))

    def test_source_edit_checks_exact_read_snapshot(self):
        from mangaweaver.desktop import read_source, revise_source, EditConflict
        plan = load_plan(ROOT/'examples/cross-panel/production.json')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = write_json(root/'source/manifest.json', plan.source)
            snapshot = read_source(path)
            changed = read_json(path)
            changed['panels'][0]['text'] = '外部对白'
            write_json(path, changed)
            with self.assertRaises(EditConflict):
                revise_source({'project': temp, 'source': str(path), 'expected_revision': snapshot['revision'],
                               'panels': snapshot['source']['panels']})
            self.assertFalse((root/'sources').exists())

    def test_candidate_adoption_preserves_review_and_submitted_task_boundary(self):
        import shutil
        from mangaweaver.desktop_candidates import candidates, adopt
        from mangaweaver.io import file_signature
        plan = load_plan(ROOT/'examples/cross-panel/production.json')
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp)
            root = project/'runs/sample'
            write_json(project/'project.json', {'runs': ['runs/sample']})
            asset = next(a for a in plan.assets if a.shot_id == 's002')
            folder = root/'iter0/storyboard'/asset.shot_id/asset.keyframe_id
            folder.mkdir(parents=True)
            images = []
            for n in (1, 2):
                image = folder/f'candidate_{n}.png'
                shutil.copyfile(asset.image, image)
                new_asset = asset.model_copy(update={'image': image, 'image_signature': file_signature(image)})
                write_json(image.with_suffix('.json'), {'input_signature': 'same-input', 'asset': new_asset.model_dump(mode='json')})
                images.append(new_asset)
            for suffix in ['task', 'response', 'failed', 'input']:
                write_json(folder / f'candidate_1.{suffix}.json', {'status': 'completed'})
            data = plan.model_dump(mode='json')
            data['assets'] = [images[0].model_dump(mode='json') if a['keyframe_id'] == asset.keyframe_id else a for a in data['assets']]
            write_json(root/'production.json', data)
            write_json(root/'planning_state.json', data)
            write_json(root/'iter0/selected.json', data)
            write_json(root/'source/prepared.json', plan.source)
            review = root/'iter0/reviews/storyboard'/asset.shot_id/asset.keyframe_id/'compare_1.json'
            write_json(review, ReviewReport(accepted=True, winner_id='candidate_2', reason='本地审查样例'))
            listing = candidates(root, asset.keyframe_id)
            self.assertEqual(len(listing['items']), 2)
            target = next(i for i in listing['items'] if not i['current'])
            self.assertTrue(target['can_adopt'])
            request = {'project': temp, 'run_dir': str(root), 'keyframe': asset.keyframe_id,
                       'candidate': target['id'], 'candidate_revision': target['revision'], 'expected_revision': listing['plan_revision']}
            write_json(root/'video/s002/s002_seg01/tasks.json', {'candidates': {'candidate_1': {'task_id': 'submitted'}}})
            with self.assertRaisesRegex(ValueError, '已有视频任务'):
                adopt(request)
            (root/'video/s002/s002_seg01/tasks.json').unlink()
            adopt(request)
            self.assertEqual(next(a for a in load_plan(root/'production.json').assets if a.keyframe_id == asset.keyframe_id).image, images[1].image.resolve())
            self.assertEqual(read_json(root/'production.json'), read_json(root/'iter0/selected.json'))
            write_json(review, ReviewReport(accepted=False, winner_id='candidate_1', reason='颜色错误', issues=[{'target':'storyboard','location':asset.keyframe_id,'evidence':'颜色错误','suggestion':'修正配色','severity':'blocking'}]))
            self.assertFalse(any(i['can_adopt'] for i in candidates(root, asset.keyframe_id)['items']))

    def test_pause_prevents_downstream_and_can_continue(self):
        plan = load_plan(ROOT / 'examples/cross-panel/production.json')
        report = ReviewReport(accepted=True, winner_id='candidate_1', reason='fixture accepted')
        client = SimpleNamespace(config=Config(iterations=1), save_usage=lambda _: None)
        directions = {d.shot_id: d for d in plan.directions}
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(pipeline, 'describe', return_value=plan.source), \
             patch.object(pipeline.script_agent, 'create', return_value={'candidate_1': plan.script}), \
             patch.object(pipeline.script_review, 'select', return_value=(plan.script, [report])), \
             patch.object(pipeline.shot_arrangement, 'create', return_value={'candidate_1': plan.shot_list}) as arrange, \
             patch.object(pipeline.arrangement_review, 'select', return_value=(plan.shot_list, report)), \
             patch.object(pipeline.shot_direction, 'create', return_value={}), \
             patch.object(pipeline.direction_review, 'select', side_effect=lambda c,s,sc,shot,*args:(directions[shot.shot_id],report)), \
             patch.object(pipeline.storyboard, 'create', side_effect=AssertionError('pause must not generate image')):
            root = Path(temp)
            first = pipeline.run(client, plan.source, root, pause_after='script')
            self.assertIsNone(first.shot_list)
            arrange.assert_not_called()
            self.assertEqual(read_json(root/'planning_pause.json')['after_stage'], 'script')
            second = pipeline.run(client, plan.source, root, from_stage='arrangement', pause_after='arrangement')
            self.assertEqual(len(second.shot_list.shots), len(plan.shot_list.shots))
            third = pipeline.run(client, plan.source, root, from_stage='direction', pause_after='direction')
            self.assertEqual(len(third.directions), len(plan.directions))
            self.assertFalse((root/'production.json').exists())

    def test_local_ocr_assigns_cross_panel_text_once(self):
        from mangaweaver.preprocessing.transcript import assign_blocks
        from mangaweaver.schemas import Panel
        panels = [Panel(panel_id='p001', page_id='page001', image=Path('a.png'), bbox=[100, 0, 200, 100]),
                  Panel(panel_id='p002', page_id='page001', image=Path('b.png'), bbox=[0, 0, 100, 100])]
        assign_blocks(panels, [[80, 10, 140, 50], [20, 10, 50, 40], [300, 0, 330, 20]],
                      ['跨格对白', '第二格', '页外杂字'], [0, 1, 2])
        self.assertEqual([p.text for p in panels], ['跨格对白', '第二格'])
        self.assertTrue(all(p.uncertainties for p in panels))

    def test_empty_brief_keeps_legacy_serialization(self):
        raw = read_json(ROOT/'examples/cross-panel/source.json')
        from mangaweaver.schemas import SourceManifest
        source = SourceManifest.model_validate(raw)
        self.assertNotIn('creative_brief', source.model_dump(mode='json'))
