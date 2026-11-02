"""只验证流边界、持久化及分支隔离；不代表付费渠道或客户端验收。"""
import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from pydantic import BaseModel

from mangaweaver.clients.streaming import PublicText,curl_events,StreamTransportError,StreamHTTPError
from mangaweaver.agent import conversation,branches,tasks
from mangaweaver.agent.context import prepare,Summary
from mangaweaver.io import read_json,write_json


class RuntimeTests(unittest.TestCase):
    def test_stream_transport_failure_keeps_curl_cause_instead_of_http_zero(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                if self.path=='/timeout':
                    time.sleep(.3)
                    return
                if self.path=='/http-error':
                    self.send_response(503);self.end_headers();return
                if self.path=='/interim':
                    self.send_response_only(103);self.end_headers()
                payload=b'data: {"delta":"partial"}\n\n'
                if self.path=='/interim':payload+=b'data: [DONE]\n\n'
                self.send_response(200)
                self.send_header('Content-Type','text/event-stream')
                self.send_header('Content-Length',str(len(payload)) if self.path=='/interim' else '10000')
                self.end_headers()
                self.wfile.write(payload);self.wfile.flush()
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base=f'http://127.0.0.1:{server.server_port}'
            with self.assertRaises(StreamTransportError) as caught:
                list(curl_events(base+'/timeout',{}, {},timeout=.1))
            self.assertEqual(caught.exception.code,28)
            self.assertIn('未收到完整的 HTTP 响应头',str(caught.exception))
            stream=curl_events(base+'/truncated',{}, {})
            self.assertEqual(next(stream),{'delta':'partial'})
            with self.assertRaises(StreamTransportError) as caught:
                list(stream)
            self.assertEqual(caught.exception.code,18)
            self.assertIn('响应流未完整接收',str(caught.exception))
            with self.assertRaises(StreamHTTPError) as caught:
                list(curl_events(base+'/http-error',{}, {}))
            self.assertEqual(caught.exception.status,503)
            self.assertEqual(list(curl_events(base+'/interim',{}, {})),[{'delta':'partial'}])
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_specialist_question_returns_to_same_session_without_resetting_steps(self):
        from mangaweaver.agent import specialists
        class Candidate(BaseModel):
            value:str
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);write_json(p/'project.json',{'runs':[]})
            s={'revision':0,'messages':[],'tool_results':[],'permissions':['planning'],'branch_id':'main'}
            parent=tasks.create(p,s,'父任务');child_task=tasks.create(p,s,'脚本','script',parent_id=parent,brief={'input_version':'v1'})
            steps=iter(['ask_user','read_feedback','submit'])
            def respond(template,payload,schema,media,**kwargs):
                action=next(steps)
                return schema(action=action,text='请确定配色' if action=='ask_user' else '继续',
                              result=Candidate(value='经回答修订') if action=='submit' else None)
            client=SimpleNamespace(config=SimpleNamespace(agent_context_budget=32000),usage=[],stream_json=respond)
            with specialists.bind(p,s,child_task,{}):
                with self.assertRaises(specialists.NeedsAnswer) as raised:
                    specialists.run(client,'planning/script/create.txt',{'feedback':['原审查拒绝']},Candidate,[],p/'candidate.json')
                question=raised.exception
                s['pending']={'child_session_id':question.child['id']}
                with self.assertRaisesRegex(ValueError,'过期'):
                    specialists.answer(p,s,{'question_id':'wrong','text':'蓝色'})
                specialists.answer(p,s,{'question_id':question.question['id'],'text':'蓝色'})
                result=specialists.run(client,'planning/script/create.txt',{'feedback':['原审查拒绝']},Candidate,[],p/'candidate.json')
            saved=read_json(p/'agent_sessions'/f'{question.child["id"]}.json')
            self.assertEqual(saved['steps'],3)
            self.assertEqual(result.value,'经回答修订')
            self.assertTrue(any(h.get('kind')=='user_answer' for h in saved['history']))

    def test_public_string_every_split_and_nested_fields(self):
        value={'kind':'reply','arguments':{'text':'不是公开说明'},'text':'你好\n"漫画"\\动画 😀'}
        raw=json.dumps(value,ensure_ascii=True)
        for split in range(len(raw)+1):
            parser=PublicText()
            actual=parser.feed(raw[:split])+parser.feed(raw[split:])
            self.assertEqual(actual,value['text'])
        parser=PublicText()
        self.assertEqual(parser.feed('{"text":"部分'), '部分')
        self.assertEqual(parser.feed('\\u4e'), '')

    def test_actual_http_sse_has_incremental_delivery_and_no_content_fallback(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type','text/event-stream' if self.path=='/sse' else 'application/json')
                self.end_headers()
                if self.path!='/sse':
                    self.wfile.write(b'{"text":"not streaming"}');return
                self.wfile.write(b'data: {"delta":"first"}\n\n');self.wfile.flush()
                time.sleep(.15)
                self.wfile.write(b'data: {"delta":"last"}\n\ndata: [DONE]\n\n');self.wfile.flush()
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            url=f'http://127.0.0.1:{server.server_port}'
            stream=curl_events(url+'/sse',{}, {'Content-Type':'application/json'})
            self.assertEqual(next(stream),{'delta':'first'})
            first=time.monotonic()
            self.assertEqual(next(stream),{'delta':'last'})
            self.assertGreater(time.monotonic()-first,.08)
            self.assertEqual(list(stream),[])
            with self.assertRaisesRegex(ValueError,'SSE'):
                list(curl_events(url+'/json',{},{}))
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_log_recovery_and_branch_do_not_replay_or_mutate_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);write_json(p/'project.json',{'runs':['.']})
            session={'messages':[],'tool_results':[],'revision':0,'active_run':str(p),'permissions':['video']}
            with conversation.bind(p,session,{'command':'agent_message'}) as journal:
                journal.event('text',block_id='b',delta='部分',status='running')
            with (p/'conversation.jsonl').open('a') as file:file.write('{"half":')
            session['messages']=[{'id':'u','role':'user','text':'旧要求'},{'id':'a','role':'assistant','text':'部分','turn_id':journal.turn_id}]
            artifact=p/'remote.json';write_json(artifact,{'task_id':'original','status':'submitted'})
            before=artifact.read_bytes()
            changed=branches.change(p,session,{'command':'agent_fork','message_id':'u'})
            self.assertEqual(changed['permissions'],[])
            self.assertEqual(changed['tool_results'],[])
            self.assertEqual(conversation.view(p)['conversation'],[])
            restored=branches.change(p,changed,{'command':'agent_switch_branch','branch_id':'main'})
            self.assertEqual(restored['messages'],session['messages'])
            self.assertEqual(artifact.read_bytes(),before)
            with conversation.bind(p,restored,{'command':'agent_message'}) as next_journal:
                next_journal.event('text',block_id='c',delta='新',status='completed')
            self.assertEqual(len(conversation.records(p)),6)

    def test_compaction_keeps_original_history_and_actual_permissions(self):
        messages=[{'id':str(i),'role':'user','text':'审查拒绝，remote-original 仍在运行。'*150} for i in range(8)]
        state={'messages':messages,'tool_results':[],'branch_id':'main'}
        client=SimpleNamespace(config=SimpleNamespace(agent_context_budget=2000),usage=[],
            json=lambda *a:Summary(goal='动画',source_facts=[],decisions=[],rejected_or_unfinished=['审查拒绝'],pending_questions=[],references=['remote-original']))
        # 近期输入也是预算的一部分；仍放不下就明确停止，不能继续裁剪。
        with self.assertRaisesRegex(ValueError,'仍超过'):
            prepare(None,state,client,{'messages':messages,'recent_results':[],'permissions':[]},force=True)
        self.assertEqual(state['messages'],messages)
        self.assertIn('审查拒绝',state['context_summary']['content']['rejected_or_unfinished'])

    def test_branch_queue_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);write_json(p/'project.json',{'runs':[]})
            session={'messages':[{'id':'u','role':'user','text':'原要求'}],'tool_results':[],'permissions':[]}
            with conversation.bind(p,session,{'command':'agent_message'}):pass
            tasks.submit({'command':'submit_message','project':str(p),'text':'旧分支后续','delivery':'follow_up'})
            child=branches.change(p,session,{'command':'agent_fork','message_id':'u'})
            self.assertEqual(tasks.inbox(p),[])
            branches.change(p,child,{'command':'agent_switch_branch','branch_id':'main'})
            self.assertEqual(len(tasks.inbox(p)),1)
