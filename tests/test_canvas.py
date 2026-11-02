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
    def test_input_bound_and_revision_has_no_paid_tasks(self):
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
            save_canvas({'run_dir': str(first), 'canvas': state})
            self.assertEqual(read_json(first / 'canvas.json')['positions'], state['positions'])
            changed = dict(state, prompt='偷偷改输入')
            with self.assertRaisesRegex(ValueError, '已绑定'):
                save_canvas({'run_dir': str(first), 'canvas': changed})
            # A real completed planning checkpoint can be reused; paid task IDs cannot.
            write_json(first / 'planning_state.json', plan)
            write_json(first / 'video/s001/s001_seg01/tasks.json', {'candidates': {'candidate_1': {'task_id': 'already-paid'}}})
            fork_canvas({'run_dir': str(second), 'from_run': str(first)})
            self.assertTrue((second / 'planning_state.json').exists())
            self.assertFalse((second / 'video').exists())
            self.assertFalse((second / 'production.json').exists())
            self.assertEqual(read_json(first / 'video/s001/s001_seg01/tasks.json')['candidates']['candidate_1']['task_id'], 'already-paid')

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
