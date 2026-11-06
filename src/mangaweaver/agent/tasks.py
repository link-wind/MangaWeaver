"""项目内的薄任务账本。单个执行器写快照，本地修改使用独立收件文件。"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ..events import emit, observe
from ..io import project_run, read_json, write_json, file_signature, signature
from ..run_lock import run_lock
from .harness import LABELS as STAGE_LABELS

LABELS = {**STAGE_LABELS, 'characters': '角色资料', 'dialogue': '日语对白', 'assembly': '剪辑导出'}
LABELS.update({'magi.load': '加载本地分格模型', 'magi.detect': '检测漫画分格', 'magi.ocr': '识别漫画文字',
               'video.submitted': '视频已提交', 'video.query': '等待远端视频', 'video.review': '视频审查', 'tasks': '准备视频任务'})
ORDER = ['preprocess', 'script', 'arrangement', 'direction', 'storyboard', 'video']


def now():
    return datetime.now(timezone.utc).isoformat()


def load(project):
    path = Path(project) / 'tasks.json'
    return read_json(path) if path.exists() else {'version': 1, 'revision': 0, 'tasks': []}


def persist(project, data, task=None):
    from ..desktop import redact
    data['revision'] += 1
    write_json(Path(project) / 'tasks.json', redact(data))
    if task:
        emit('workflow.task', task=redact(task), workflow_revision=data['revision'], run_dir=task.get('run'))


def create(project, session, title, stage='', parent_id=None, origin='conversation', **extra):
    from .conversation import call_id
    data = load(project)
    task = {'id': uuid4().hex, 'call_id':call_id(), 'branch_id':session.get('branch_id','main'), 'parent_id': parent_id, 'origin': origin, 'title': title,
            'created_at': now(), 'updated_at': now(), 'run': session.get('active_run', ''),
            'page_id': session.get('active_page_id', ''), 'book_id': session.get('active_book_id', ''),
            'message_id': session.get('messages', [{}])[-1].get('id') if session.get('messages') else None,
            'stage': stage, 'target': 'all', 'permissions': session.get('permissions', []),
            'status': 'running', 'reason': '', 'summary': '', 'activities': [], 'actions': [],
            'decision_count': 0, 'revision': 0, **extra}
    task['content_revision'] = 0
    data['tasks'].append(task)
    persist(project, data, task)
    return task['id']


def get(project, identifier):
    return next((t for t in load(project)['tasks'] if t['id'] == identifier), None)


def update(project, identifier, **changes):
    data = load(project)
    task = next(t for t in data['tasks'] if t['id'] == identifier)
    task.update(changes, updated_at=now(), revision=task.get('revision', 0) + 1)
    persist(project, data, task)
    return task


def version(directory):
    directory = Path(directory)
    names = ['source/manifest.json', 'planning_draft.json', 'planning_state.json', 'production.json']
    return signature({n: file_signature(directory / n) for n in names if (directory / n).is_file()})


def inbox(project):
    folder = Path(project) / 'pending_requests'
    if not folder.exists():
        return []
    from .conversation import index
    branch=index(project)['branch_id']
    return sorted([r for p in folder.glob('*.json') if (r:=read_json(p)).get('branch_id','main')==branch], key=lambda r: (r['created_at'], r['id']))


def submit(request):
    project = Path(request['project'])
    if not (project / 'project.json').is_file():
        raise ValueError('请先打开项目')
    folder = project / 'pending_requests'
    with run_lock(folder, 'pending_request'):
        if request['command'] in {'withdraw_revision', 'withdraw_message'}:
            identifier = str(request.get('request_id_to_withdraw', ''))
            if not identifier.isalnum():
                raise ValueError('修改标识无效')
            path = folder / f'{identifier}.json'
            item = read_json(path)
            from .conversation import index
            if item.get('branch_id','main') != index(project)['branch_id']:
                raise ValueError('要求属于其他分支，请回到原会话处理')
            if item['status'] != 'queued':
                raise ValueError('该修改已接收或已撤回，不能撤回')
            item['status'] = 'withdrawn'
        else:
            text = str(request.get('text', '')).strip()
            if not text or len(text) > 20000:
                raise ValueError('请输入有效的修改要求')
            directory = Path(request['run_dir']).resolve() if request.get('run_dir') else None
            if directory and not project_run(project, directory):
                raise ValueError('修改页面不属于当前项目')
            identifier = str(request.get('message_id') or uuid4().hex)
            if not identifier.isalnum() or len(identifier) > 64:
                raise ValueError('消息标识无效')
            path = folder / f'{identifier}.json'
            if path.exists():
                return {'pending_requests': inbox(project)}
            legacy = request['command'] == 'submit_revision'
            delivery = request.get('delivery', 'steer')
            if delivery not in {'steer', 'follow_up'}:
                raise ValueError('消息送达方式无效')
            from .references import validate, objects
            references = validate(project, request.get('references') or [])
            context = request.get('context') or {}
            if not legacy and directory:
                available = objects(project, directory)
                context = {'run': str(directory), 'selected': [n for n in context.get('selected', []) if n in available],
                           'nodes': [dict(id=n, title=v['label'], kind=v['kind'], location=v['location'], stage=v['stage']) for n, v in available.items()]}
            permissions = request.get('permissions') or []
            if any(p not in {'planning', 'images', 'video'} for p in permissions):
                raise ValueError('制作授权无效')
            from .conversation import index
            branch=index(project)['branch_id']
            item = {'id': identifier, 'branch_id':branch, 'created_at': now(), 'status': 'queued', 'text': text,
                    'run': str(directory) if directory else '', 'base_version': version(directory) if directory else '',
                    'delivery': delivery, 'intent': 'revision' if legacy else 'pending', 'references': references,
                    'context': context, 'stage': request.get('stage') or ('arrangement' if legacy else ''),
                    'parent_id': request.get('task_id'), 'permissions': request.get('permissions') or []}
            parent = get(project, item['parent_id']) if item['parent_id'] else next((t for t in reversed(load(project)['tasks']) if not t['parent_id'] and t['run'] == str(directory) and t.get('branch_id','main')==branch), None)
            if parent and parent.get('branch_id','main')!=branch:
                raise ValueError('消息任务属于其他分支，请回到对应会话')
            if not legacy:
                active = next((t for t in reversed(load(project)['tasks']) if not t['parent_id'] and t['run'] == item['run'] and t['status'] in {'running', 'queued'} and t.get('branch_id','main')==branch), None)
                if active:
                    parent = active  # 客户端可能尚未接收到刚开始的父任务事件。
            if parent:
                item.update(parent_id=parent['id'], content_revision=parent.get('content_revision', 0))
                child_id=parent.get('child_id')
                item['child_task_id']=child_id
                sessions=project/'agent_sessions'
                active_children=[c for p in sessions.glob('*.json') if not p.name.startswith(('index','branch-'))
                                 and (c:=read_json(p)).get('task_id')==child_id and c.get('status')=='running']
                if active_children:
                    item['child_session_id']=active_children[-1]['id']
            if item['stage'] and item['stage'] not in ORDER:
                raise ValueError('未知修改阶段')
            metadata = directory / 'input/book.json' if directory else None
            item['page'] = read_json(metadata) if metadata and metadata.exists() else None
            if not legacy and delivery == 'steer' and text.rstrip('？?。！!') in {'现在做到哪了', '现在什么状态', '现在进度', '查看进度'}:
                item.update(intent='question', status='answered', answered_at=now(), summary=progress(project, item.get('parent_id')))
            path = folder / f"{item['id']}.json"
        from ..desktop import redact
        write_json(path, redact(item))
        if request['command'] == 'submit_revision' and 'expected_revision' in request:
            from ..run_lock import RunBusy
            canvas_path = directory / 'canvas.json'
            try:
                with run_lock(directory, 'clear_submitted_draft'):
                    if canvas_path.exists():
                        from ..io import signature
                        canvas = read_json(canvas_path)
                        if signature(canvas) == request['expected_revision'] and canvas.get('draft', '').strip() == text:
                            canvas['draft'] = ''
                            write_json(canvas_path, canvas)
            except RunBusy:
                pass  # 已收件；制作占用时保留草稿，不能阻塞或撤销用户要求。
    return {'pending_requests': inbox(project)}


def progress(project, identifier=None):
    task = get(project, identifier) if identifier else None
    if not task:
        return '当前没有活动制作任务。'
    child = get(project, task.get('child_id')) or task
    states = {'running':'执行中','queued':'等待处理','completed':'已完成','waiting_user':'需要处理','failed':'执行失败','interrupted':'已中断'}
    return f"{task['title']}：{child.get('summary') or states.get(child['status'], child['status'])}。" + ('本地已停止，需明确恢复。' if task['status'] == 'interrupted' else '')


class RevisionBoundary(Exception):
    pass


@contextmanager
def track(project, identifier, receive=None):
    """只记录本次专业工具的真实事件，阶段状态不靠事件顺序猜测。"""
    def record(stage, event):
        if stage in {'workflow.task','conversation'}:
            return
        task = get(project, identifier)
        if event.get('run_dir'):
            task['run'] = event['run_dir']
        if stage == 'professional':
            entries = task['activities']
            entry = next((x for x in entries if x['id'] == event['activity_id']), None)
            if not entry:
                entry = {'id': event['activity_id'], 'created_at': now()}
                entries.append(entry)
            entry.update(event, updated_at=now())
            update(project, identifier, run=task['run'], activities=entries, actor=event['actor'],
                   summary=event.get('message') or ('复用已有产物' if event.get('reused') else
                       '审查中' if event['role'] == 'Reviewer' and event['status'] == 'running' else
                       '创作中' if event['status'] == 'running' else '已保存结果'))
            if event.get('status') == 'completed' and event.get('accepted') is False:
                handoffs = task.get('handoffs', [])
                targets = {i['target'] for i in event.get('issues', []) if i.get('target') in ORDER}
                receiver = next(iter(targets)) + '.creator' if len(targets) == 1 else 'coordinator'
                handoffs.append({'id': event['activity_id'], 'sender': event['actor'],
                    'receiver': receiver, 'kind': 'feedback',
                    'summary': event.get('message', ''), 'issues': event.get('issues', []),
                    'artifact': event.get('artifact'), 'iteration': event.get('iteration', 0)})
                update(project, identifier, handoffs=handoffs)
        elif not stage.startswith('agent.'):
            update(project, identifier, run=task['run'], current_stage=stage,
                   summary=event.get('message') or LABELS.get(stage) or stage,
                   actor='tool' if stage.startswith(('magi.', 'video.')) or stage in {'tasks', 'assembly'} else task.get('actor', 'coordinator'))

    def boundary():
        task = get(project, identifier)
        parent = get(project, task.get('parent_id'))
        if parent and parent['status'] == 'interrupted':
            raise KeyboardInterrupt()
        if receive:
            receive()
        elif any(r['status'] == 'queued' and r.get('delivery', 'steer') == 'steer' and r['run'] == task['run'] for r in inbox(project)):
            raise RevisionBoundary('进度已保存，先处理待修改要求')

    with observe(record, boundary):
        yield


def interrupt(project):
    with run_lock(Path(project), 'interrupt_workflow'):
        data = load(project)
        for task in data['tasks']:
            if task['status'] in {'running', 'queued'}:
                task.update(status='interrupted', reason='interrupted', summary='本地执行已停止，进度已保留',
                            revision=task['revision']+1, actions=[] if task['parent_id'] else [{'kind': 'resume', 'label': '恢复任务'}])
        persist(project, data)
    return {'workflow': data}


def view(project, session):
    """只读恢复不改快照；孤立 running 以待恢复展示，不能伪装已完成。"""
    data = load(project)
    data['tasks']=[t for t in data['tasks'] if t.get('branch_id','main')==session.get('branch_id','main')]
    active = session.get('active_task_id')
    lock = Path(project) / '.run.lock'
    # 非阻塞锁能判断当前是否有实际写入者；不能仅凭进程号推断成功。
    import fcntl
    busy = False
    if lock.exists():
        with lock.open('r') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(handle, fcntl.LOCK_UN)
            except BlockingIOError:
                busy = True
    if not busy:
        for task in data['tasks']:
            if task['status'] in {'running', 'queued'}:
                task.update(status='interrupted', reason='interrupted', summary='执行已中断，进度待恢复',
                            actions=[{'kind': 'resume', 'label': '恢复任务'}] if task['id'] == active else [])
    return {'workflow': data, 'pending_requests': inbox(project)}
