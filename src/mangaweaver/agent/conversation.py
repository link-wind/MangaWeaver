"""项目对话日志。单个执行器追加，界面重放只读，不重放工具。"""
import json
import shutil
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from uuid import uuid4

from ..io import read_json, write_json
from .tasks import now

_current = ContextVar('conversation', default=None)
_call = ContextVar('conversation_call', default=None)


def current():
    return _current.get()


def call_id():
    return _call.get()


def index(project):
    path = Path(project) / 'agent_sessions/index.json'
    if path.exists():
        data = read_json(path)
        if data.get('version') != 1:
            raise ValueError('会话格式版本不受支持，请使用匹配客户端')
        return data
    return {'version':1, 'session_id':uuid4().hex, 'branch_id':'main',
            'branches':[{'id':'main','name':'主对话','parent_id':None,'fork_message':None,'created_at':now()}]}


def records(project):
    path = Path(project) / 'conversation.jsonl'
    if not path.exists():
        return []
    result = []
    with path.open(encoding='utf-8') as handle:
        for line in handle:
            try:
                result.append(json.loads(line))
            except ValueError:
                if not line.endswith('\n'):
                    break  # 强制退出后的尾部不能被当作完整事件。
                raise ValueError('会话日志中间记录损坏，请保留文件后检查') from None
    return result


def view(project):
    meta = index(project)
    branch=next(b for b in meta['branches'] if b['id']==meta['branch_id'])
    inherited=set(branch.get('inherited_turns',[]))
    events = [e for e in records(project) if e['branch_id'] == meta['branch_id'] or e['turn_id'] in inherited]
    turns = {}
    for event in events:
        identifier = event['turn_id']
        turn = turns.setdefault(identifier, {'id':identifier,'created_at':event['created_at'], 'blocks':[], 'status':'running'})
        if event['kind'] == 'turn':
            turn.update(status=event['status'])
        elif event.get('block_id'):
            block = next((b for b in turn['blocks'] if b['id'] == event['block_id']), None)
            if block is None:
                if not turn['blocks']:
                    turn['created_at']=event['created_at']
                block = {'id':event['block_id'], 'type':event['kind'],'text':''}
                turn['blocks'].append(block)
            if 'delta' in event:
                block['text'] += event['delta']
            block.update({k:v for k,v in event.items() if k not in {'delta','kind','block_id'}})
    # 问题状态也可由原专业会话中的确切回答证实，旧问题不会一直显示待确认。
    for turn in turns.values():
        for block in turn['blocks']:
            if block['type']!='child' or block.get('status')!='waiting_user':
                continue
            child_path=Path(project)/'agent_sessions'/f'{block["id"]}.json'
            if not child_path.is_file():
                continue
            child=read_json(child_path)
            answer=next((h for h in reversed(child.get('history',[])) if h.get('kind')=='user_answer'),None)
            if answer:
                block.update(status='answered',result={'summary':'已回答：'+answer['text']})
                if turn['status']=='waiting_user':
                    turn['status']='answered'
    return {'conversation':list(turns.values()), 'conversation_meta':meta,
            'conversation_sequence':max((e['sequence'] for e in records(project)),default=0)}


class Journal:
    def __init__(self, project, session, request):
        self.project = Path(project)
        self.session = session
        self.meta = index(project)
        path = self.project / 'agent_sessions/index.json'
        if not path.exists():
            for name in ('session','tasks'):
                old = self.project / f'{name}.json'
                if old.exists():
                    shutil.copyfile(old, self.project / f'{name}.pre-runtime.json')
            write_json(path,self.meta)
        existing = records(project)
        self.sequence = existing[-1]['sequence'] if existing else 0
        # 分批协调和画布回执属于同一轮；用户重发是新一轮与新尝试。
        continuation = request['command'] in {'agent_continue','agent_next_batch'}
        self.turn_id = session.get('conversation_turn') if continuation else None
        self.turn_id = self.turn_id or uuid4().hex
        self.attempt_id = uuid4().hex
        self.branch_id = self.meta['branch_id']
        session['conversation_turn'] = self.turn_id
        session['branch_id'] = self.branch_id

    def event(self, kind, **data):
        from ..desktop import redact
        from ..events import emit
        self.sequence += 1
        event = redact({'event_id':uuid4().hex,'sequence':self.sequence,'session_id':self.meta['session_id'],
            'branch_id':self.branch_id,'turn_id':self.turn_id,'attempt_id':self.attempt_id,
            'parent_call_id':_call.get(),'created_at':now(),'kind':kind,**data})
        # 丢弃强制退出留下的最后半行，下一次追加不能粘到残行末尾。
        path = self.project / 'conversation.jsonl'
        if path.exists():
            with path.open('rb+') as stream:
                stream.seek(0,2)
                size=stream.tell()
                if size:
                    stream.seek(-1,2)
                    if stream.read(1) != b'\n':
                        stream.seek(0)
                        raw=stream.read()
                        stream.truncate(raw.rfind(b'\n')+1)
        with path.open('a',encoding='utf-8') as stream:
            stream.write(json.dumps(event,ensure_ascii=False)+'\n')
            stream.flush()
        emit('conversation', event=event)
        return event


@contextmanager
def bind(project, session, request):
    journal=Journal(project,session,request)
    token=_current.set(journal)
    journal.event('turn',status='running')
    try:
        yield journal
    except (Exception,KeyboardInterrupt) as exc:
        journal.event('turn',status='interrupted' if isinstance(exc,KeyboardInterrupt) else 'failed',message=str(exc) or '本地执行已停止')
        raise
    else:
        pending=session.get('pending') or {}
        status='waiting' if pending.get('kind') in {'canvas','batch'} else 'waiting_user' if pending else 'completed'
        journal.event('turn',status=status)
    finally:
        _current.reset(token)


@contextmanager
def call(identifier):
    token=_call.set(identifier)
    try:
        yield
    finally:
        _call.reset(token)


def progress(stage,data):
    journal=current()
    if journal and _call.get() and not stage.startswith(('conversation','agent.','workflow.')):
        journal.event('tool',block_id=_call.get(),call_id=_call.get(),status='running',
                      progress={'stage':stage,**data})


def action(client, template, payload, schema, media=()):
    journal=current()
    if not journal:
        return client.json(template,payload,schema,media)
    if not hasattr(client,'stream_json'):
        raise ValueError('当前配置客户端尚不支持真实流式，请实现该渠道入口；未自动换模型')
    block=uuid4().hex
    journal.event('text',block_id=block,status='running')
    pieces=[]
    def receive(delta):
        pieces.append(delta)
        journal.event('text',block_id=block,delta=delta,status='running')
    try:
        result=client.stream_json(template,payload,schema,media,
            on_text=receive)
        published=''.join(pieces)
        if not result.text.startswith(published):
            raise ValueError('流式公开文字与最终动作不一致，未执行工具')
        if result.text!=published:
            journal.event('text',block_id=block,delta=result.text[len(published):],status='running')
    except (Exception,KeyboardInterrupt) as exc:
        journal.event('text',block_id=block,status='interrupted' if isinstance(exc,KeyboardInterrupt) else 'failed')
        raise
    journal.event('text',block_id=block,status='completed')
    from .context import record_usage
    record_usage(journal.session,client)
    journal.last_text = result.text
    return result
