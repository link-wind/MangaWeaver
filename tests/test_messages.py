"""消息归属、引用与真实请求边界；不验证模型质量。"""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mangaweaver.agent import messages, references, tasks, workflow
from mangaweaver.agent.loop import load_session, handle
from mangaweaver.events import assignment, professional_call
from mangaweaver.io import read_json, write_json
from mangaweaver.schemas import AgentAction, MessageDecision, ReviewReport


class MessageTests(unittest.TestCase):
    def setup_project(self, tmp):
        root = Path(tmp).resolve()
        run = root / 'runs/page001'
        (run / 'input').mkdir(parents=True)
        (run / 'input/page.png').write_bytes(b'local-image-fixture')
        write_json(root / 'project.json', {'runs': ['runs/page001']})
        session = load_session(root)
        session.update(active_run=str(run), permissions=['planning'])
        parent = workflow.root(root, session, '当前页编排', 'arrangement')
        return root, run, session, parent

    def submit(self, root, run, parent, text, **extra):
        return tasks.submit({'command': 'submit_message', 'project': str(root), 'run_dir': str(run),
            'task_id': parent, 'text': text, 'permissions': ['planning'], **extra})['pending_requests'][-1]

    def test_status_answer_and_follow_up_stay_out_of_current_instructions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, run, session, parent = self.setup_project(tmp)
            tasks.update(root, parent, status='completed')
            current = workflow.root(root, session, '刚开始的新任务', 'arrangement')
            before = len(tasks.load(root)['tasks'])
            item = self.submit(root, run, parent, '现在做到哪了？', message_id='status1')
            self.assertEqual(item['status'], 'answered')
            self.assertEqual(item['parent_id'], current)
            self.assertIn('刚开始的新任务', item['summary'])
            self.submit(root, run, parent, '稍后规划下一页', delivery='follow_up', message_id='later1')
            self.submit(root, run, parent, '重复传输不同文本也不能执行两次', delivery='follow_up', message_id='later1')
            messages.reconcile(root, session)
            self.assertNotIn('稍后规划下一页', [m['text'] for m in session['messages']])
            self.assertEqual(len(tasks.inbox(root)), 2)
            self.assertEqual(len(tasks.load(root)['tasks']), before)
            self.assertEqual(tasks.get(root, current)['status'], 'running')

    def test_question_boundary_is_read_only_and_revision_has_fixed_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, run, session, parent = self.setup_project(tmp)
            self.submit(root, run, parent, '解释一下为什么需要编排')
            client = SimpleNamespace(json=lambda *a: MessageDecision(intent='question', text='本地协议预设回答'))
            messages.receive(root, session, {'_coordinator_client': client}, parent)
            self.assertEqual(tasks.inbox(root)[0]['status'], 'answered')
            self.assertEqual(tasks.get(root, parent)['status'], 'running')
            self.submit(root, run, parent, '修改这里')
            client.json = lambda *a: MessageDecision(intent='needs_user', text='请明确镜头')
            with self.assertRaises(messages.MessageBoundary):
                messages.receive(root, session, {'_coordinator_client': client}, parent)
            self.assertEqual(tasks.inbox(root)[-1]['status'], 'needs_decision')
            self.assertEqual(len(list((root / 'runs').iterdir())), 1)
            # 修订暂时只发布脚本时，第二镜头仍可由固定输入基线识别。
            write_json(run/'planning_draft.json', {'shot_list':{'shots':[{'shot_id':'s002'}]}})
            child = tasks.create(root, session, '编排修订', 'arrangement', parent_id=parent,
                brief={'run':str(run),'input_version':tasks.version(run)})
            tasks.update(root, parent, child_id=child)
            current = root/'runs/revision';current.mkdir()
            session['active_run'] = str(current)
            self.submit(root, current, parent, '第二镜头停顿短一点')
            client.json = lambda *a: MessageDecision(intent='revision', text='调整节奏', stage='arrangement', location='s002')
            with self.assertRaises(tasks.RevisionBoundary) as received:
                messages.receive(root, session, {'_coordinator_client':client}, parent)
            self.assertNotIsInstance(received.exception, messages.MessageBoundary)
            self.assertEqual(tasks.inbox(root)[-1]['location'], 's002')
            self.assertEqual(tasks.inbox(root)[-1]['revision_base_run'], str(run))
            # 理解期间撤回的原文不能再次进入总 Agent 的制作上下文。
            pending = self.submit(root, current, parent, '撤回此条引导')
            def withdrawn(*args):
                tasks.submit({'command':'withdraw_message','project':str(root),'request_id_to_withdraw':pending['id']})
                return MessageDecision(intent='question', text='不应接收的回答')
            client.json = withdrawn
            # 上一条已经进入修订分支，本项仅检查新的独立收件。
            path = root/'pending_requests'/f"{tasks.inbox(root)[-2]['id']}.json"
            item = read_json(path);item['status']='claimed';write_json(path,item)
            messages.receive(root, session, {'_coordinator_client':client}, parent)
            self.assertFalse(any(m['text']=='撤回此条引导' for m in session['messages']))

    def test_follow_up_new_task_once_and_stop_prevents_auto_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, run, session, parent = self.setup_project(tmp)
            self.submit(root, run, parent, '后续本地任务', delivery='follow_up', message_id='later1')
            tasks.interrupt(root)
            self.assertIsNone(messages.ready(root, session))
            tasks.update(root, parent, status='completed')
            request = {'message_id': 'later1', 'task_id': parent}
            messages.claim_follow_up(root, session, request)
            self.assertNotEqual(session['active_task_id'], parent)
            following = session['active_task_id']
            another = root/'runs/page002';another.mkdir()
            session['active_run'] = str(another)
            self.assertEqual(workflow.root(root, session, '下一页规划', 'arrangement'), following)
            self.assertEqual(tasks.get(root, parent)['title'], '当前页编排')
            with self.assertRaises(ValueError):
                messages.claim_follow_up(root, session, request)
            self.assertEqual(len(tasks.load(root)['tasks']), 2)

    def test_reference_is_verified_by_content_and_cannot_escape_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, run, session, parent = self.setup_project(tmp)
            refs = references.capture(root, run, ['source'], 'reference')
            self.assertEqual(references.validate(root, refs)[0]['signature'], refs[0]['signature'])
            (run / 'input/page.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, '失效'):
                references.validate(root, refs)
            with self.assertRaisesRegex(ValueError, '不属于'):
                references.capture(root, root.parent, ['source'])

    def test_professional_input_contains_reference_before_cache_and_report_keeps_rejection(self):
        captured = []
        class Client:
            @professional_call
            def json_to(self, template, payload, schema, media, destination):
                captured.append((payload, media))
                result = ReviewReport(accepted=False, winner_id='a', reason='本地预设退回', issues=[
                    {'target':'arrangement','location':'s002','severity':'blocking','evidence':'本地预设对白密集','suggestion':'调整停顿'}])
                write_json(destination, result)
                return result
        with tempfile.TemporaryDirectory() as tmp:
            root, run, session, parent = self.setup_project(tmp)
            child = tasks.create(root, session, '编排', 'arrangement', parent_id=parent)
            ref = str(run / 'input/page.png')
            brief = {'stage': 'arrangement', 'goal': '只修改第二镜头'}
            with assignment(brief, [ref]), tasks.track(root, child):
                Client().json_to('planning/arrangement/review.txt', {}, ReviewReport, [], run / 'review.json')
            self.assertEqual(captured[0][0]['task_brief'], brief)
            self.assertEqual(captured[0][1], [ref])
            entry = tasks.get(root, child)
            self.assertFalse(entry['activities'][0]['accepted'])
            self.assertEqual(entry['handoffs'][0]['receiver'], 'arrangement.creator')
