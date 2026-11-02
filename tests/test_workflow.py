"""检查任务身份、修改版本和续接边界；本地预设不代表真实模型验收。"""
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mangaweaver.agent import tasks, workflow
from mangaweaver.agent.loop import handle, load_session
from mangaweaver.events import emit, professional_call
from mangaweaver.io import write_json, read_json
from mangaweaver.schemas import AgentAction, ReviewReport


class WorkflowTests(unittest.TestCase):
    def project(self, root):
        root = Path(root).resolve()
        run = root / 'runs/page012'
        run.mkdir(parents=True)
        write_json(root/'project.json', {'runs':['runs/page012']})
        session = load_session(root)
        session.update(active_run=str(run), active_page_id='page012', permissions=['planning'])
        write_json(root/'session.json', session)
        return root, run, session

    def test_creator_review_records_keep_rejection_and_real_artifact(self):
        class LocalClient:
            @professional_call
            def json_to(self, template, payload, schema, media, destination):
                report = ReviewReport(accepted=False, winner_id='a', reason='本地预设：节奏过慢', issues=[{'target':'arrangement','location':'s002','severity':'blocking','evidence':'本地：停顿过长','suggestion':'调整时间'}])
                write_json(destination, report)
                return report
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            parent = workflow.root(project, session, '本地协议检查')
            child = tasks.create(project, session, '编排', 'arrangement', parent_id=parent)
            destination = run/'iter1/reviews/arrangement.json'
            with tasks.track(project, child):
                LocalClient().json_to('planning/arrangement/review.txt', {'shot':{'shot_id':'s002'}}, ReviewReport, [], destination)
            activity = tasks.get(project, child)['activities'][0]
            self.assertEqual(activity['status'], 'completed')
            self.assertFalse(activity['accepted'])
            self.assertEqual(activity['iteration'], 1)
            self.assertEqual(activity['target'], 's002')
            self.assertEqual(activity['artifact'], str(destination))
            self.assertEqual(tasks.get(project, child)['status'], 'running')

    def test_until_target_and_single_stage_share_task_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            state={'run':str(run),'has_source':True,'script_ready':False,'has_production':False,
                   'shot_list':None,'directions':[],'reviews':[]}
            stages=[]
            def local_stage(project, session, action, request):
                stage=action.arguments.stage
                stages.append(stage)
                state['script_ready']=True
                state['reviews'].append({'scope':stage,'accepted':True})
                if stage=='arrangement':state['shot_list']={'shots':[]}
                return {'status':'completed','summary':'本地预设完成'}
            with patch.object(workflow,'read_state',return_value=state),patch.object(workflow,'execute',side_effect=local_stage):
                result=workflow.run_tool(project,session,AgentAction(kind='call_tool',tool='produce',arguments={'stage':'arrangement'}),{'command':'agent_message'})
            self.assertEqual(stages,['script','arrangement'])
            self.assertEqual(result['status'],'completed')
            children=[t for t in tasks.load(project)['tasks'] if t['parent_id']]
            self.assertEqual({t['parent_id'] for t in children},{session['active_task_id']})
            self.assertNotIn('storyboard', stages)

    def test_pending_revision_withdraw_and_version_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            parent=workflow.root(project, session, '本地修改检查')
            result=tasks.submit({'command':'submit_revision','project':str(project),'run_dir':str(run),'task_id':parent,'text':'第二镜头停顿短一些'})
            item=result['pending_requests'][0]
            tasks.submit({'command':'withdraw_revision','project':str(project),'request_id_to_withdraw':item['id']})
            self.assertEqual(tasks.inbox(project)[0]['status'],'withdrawn')
            tasks.submit({'command':'submit_revision','project':str(project),'run_dir':str(run),'task_id':parent,'text':'修改节奏'})
            tasks.update(project,parent,content_revision=1)
            result=workflow.consume_revision(project,session,{},parent)
            self.assertEqual(result['reason'],'version_conflict')
            self.assertEqual(tasks.inbox(project)[1]['status'],'needs_decision')

    def test_internal_batch_has_no_fake_continue_message_and_stop_blocks_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            client=SimpleNamespace(stream_json=lambda *a,**kw:AgentAction(kind='call_tool',tool='read_project'),save_usage=lambda _:None)
            result=handle({'command':'agent_message','project':str(project),'text':'检查当前项目'},client)
            pending=result['pending']
            self.assertEqual(pending['kind'],'batch')
            self.assertEqual(result['turn_decisions'],8)
            self.assertEqual(len(result['messages']),1)
            tasks.interrupt(project)
            with self.assertRaisesRegex(ValueError,'不能自动续接'):
                handle({'command':'agent_next_batch','project':str(project),'task_id':pending['task_id'],'revision':pending['revision']},client)

    def test_original_video_download_action_does_not_submit(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            parent=workflow.root(project,session,'恢复视频','video')
            write_json(run/'video/s001/seg01/tasks.json',{'candidates':{'a':{'task_id':'remote-original','status':'submitted'}}})
            workflow.finish(project,session,{'status':'failed','summary':'下载失败'})
            task=tasks.get(project,parent)
            self.assertEqual(task['actions'][0]['kind'],'download')
            with patch.object(workflow,'stage_tool',return_value={'status':'completed','summary':'已下载'}) as tool:
                result=workflow.resume(project,session,{'task_id':parent,'task_revision':task['revision'],'resume_mode':'download'})
                self.assertEqual(tool.call_args.args[2].tool,'resume')
                self.assertEqual(result['reason'],'video_downloaded')

    def test_status_question_does_not_complete_a_blocked_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            parent = workflow.root(project, session, '未完成的制作')
            workflow.finish(project, session, {'status':'blocked','reason':'review_exhausted','summary':'审查未通过'})
            write_json(project/'session.json', session)
            client = SimpleNamespace(stream_json=lambda *a,**kw:AgentAction(kind='reply',text='上次审查未通过'),save_usage=lambda _:None)
            handle({'command':'agent_message','project':str(project),'text':'现在什么状态'},client)
            self.assertEqual(tasks.get(project,parent)['status'],'waiting_user')

    def test_scope_failure_before_fork_does_not_fake_an_applied_revision(self):
        with tempfile.TemporaryDirectory() as tmp:
            project, run, session = self.project(tmp)
            parent = workflow.root(project, session, '修改权限检查')
            tasks.submit({'command':'submit_revision','project':str(project),'run_dir':str(run),'task_id':parent,
                          'stage':'storyboard','text':'改变构图'})
            with patch.object(workflow,'read_state',return_value={'script_ready':True}),patch.object(workflow,'stage_tool',return_value={
                    'status':'needs_user','reason':'scope_required','summary':'需要生图权限','required_scope':'images'}):
                result = workflow.consume_revision(project,session,{},parent)
            item = tasks.inbox(project)[0]
            self.assertEqual(item['status'],'claimed')
            self.assertNotIn('revision_run',item)
            self.assertEqual(tasks.get(project,parent)['content_revision'],0)
            workflow.finish(project,session,result)
            task = tasks.get(project,parent)
            with patch.object(workflow,'consume_revision',return_value={'status':'completed','summary':'本地预设'}) as consume:
                workflow.resume(project,session,{'task_id':parent,'task_revision':task['revision'],'grant_scope':'images'})
                self.assertIn('images',session['permissions'])
                self.assertEqual(consume.call_args.kwargs['claimed']['id'],item['id'])
