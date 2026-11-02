"""可选阶段事件；CLI 默认无订阅者。"""
from contextvars import ContextVar
from contextlib import contextmanager

_sink = ContextVar('event_sink', default=None)
_run = ContextVar('event_run', default=None)
_observer = ContextVar('task_observer', default=None)
_boundary = ContextVar('task_boundary', default=None)
_professional_active = ContextVar('professional_active', default=False)
_assignment = ContextVar('assignment', default=None)


@contextmanager
def assignment(brief, media):
    token = _assignment.set((brief, media))
    try:
        yield
    finally:
        _assignment.reset(token)


def professional_inputs(template, payload, media):
    current = _assignment.get()
    if not current or 'task_brief' in payload:
        return payload, list(media)
    brief, references = current
    parts = template.split('/')
    stage = parts[1] if parts[0] == 'planning' else 'video' if parts[0] == 'generation' else ''
    if stage != brief['stage']:
        return payload, list(media)
    # 这些数据进入真实请求与既有缓存签名，资料不能扩大工具权限。
    original = list(map(str, media))
    return {**payload, 'task_brief': brief}, original + [p for p in references if p not in original]


def emit(stage, **data):
    if _run.get() and 'run_dir' not in data:
        data['run_dir'] = _run.get()
    observer = _observer.get()
    if observer:
        observer(stage, data)
    sink = _sink.get()
    if sink:
        sink('stage', stage, data)
    if stage != 'conversation':
        from .agent.conversation import progress
        progress(stage, data)


@contextmanager
def observe(callback, checkpoint=None):
    token = _observer.set(callback)
    boundary_token = _boundary.set(checkpoint)
    try:
        yield
    finally:
        _observer.reset(token)
        _boundary.reset(boundary_token)


def checkpoint():
    callback = _boundary.get()
    if callback:
        callback()


def professional_call(fn):
    """在现有模型封装的文件落盘边界发布角色记录，不改变请求或缓存。"""
    from functools import wraps
    from pathlib import Path
    from uuid import uuid4

    @wraps(fn)
    def traced(self, template, payload, *args, **kwargs):
        if not _professional_active.get():
            if 'media' in kwargs:
                payload, kwargs['media'] = professional_inputs(template, payload, kwargs['media'])
            elif args:
                index = 1 if fn.__name__ == 'json_to' else 0
                values = list(args)
                payload, values[index] = professional_inputs(template, payload, values[index])
                args = tuple(values)
        if not _observer.get() or _professional_active.get():
            return fn(self, template, payload, *args, **kwargs)
        parts = template.split('/')
        stage = parts[1] if parts[0] == 'planning' else 'video' if parts[0] == 'generation' else 'characters'
        role = 'Reviewer' if 'review' in template else 'Creator'
        destination = kwargs.get('destination') or args[-1]
        destination = Path(destination)
        target = ((payload.get('anchor') or {}).get('keyframe_id') or
                  (payload.get('segment') or {}).get('segment_id') or
                  (payload.get('shot') or {}).get('shot_id') or payload.get('panel_id') or 'all')
        iteration = next((int(p[4:]) for p in destination.parts if p.startswith('iter') and p[4:].isdigit()), 0)
        data = dict(activity_id=uuid4().hex, actor=f'{stage}.{role.lower()}', role=role, professional_stage=stage,
                    target=target, iteration=iteration, artifact=str(destination.resolve()), template=template)
        reused = destination.exists()
        emit('professional', status='running', **data)
        token = _professional_active.set(True)
        try:
            result = fn(self, template, payload, *args, **kwargs)
        except (Exception, KeyboardInterrupt) as exc:
            emit('professional', status='interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed',
                 message=str(exc) or '本地执行已停止', **data)
            raise
        finally:
            _professional_active.reset(token)
        details = {}
        if hasattr(result, 'accepted'):
            details = dict(accepted=result.accepted, message=result.reason,
                           issues=[i.model_dump() for i in result.issues])
        emit('professional', status='completed', reused=reused, **data, **details)
        return result
    return traced


def artifact(path):
    sink = _sink.get()
    if sink:
        sink("artifact", "artifact", {"path": str(path), "run_dir": _run.get()})


@contextmanager
def subscribe(sink):
    token = _sink.set(sink)
    try:
        yield
    finally:
        _sink.reset(token)

@contextmanager
def bind_run(directory):
    token = _run.set(str(directory))
    try:
        yield
    finally:
        _run.reset(token)


def read_log(directory):
    import json
    from pathlib import Path
    path = Path(directory) / 'runtime_events.jsonl'
    if not path.exists():
        return []
    with path.open('rb') as stream:
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(max(0, size - 1_000_000))
        lines = stream.read().splitlines()
    if size > 1_000_000:
        lines = lines[1:]
    events = []
    for line in lines[-500:]:
        try:
            events.append(json.loads(line))
        except (ValueError, UnicodeDecodeError):
            continue  # 中断产生的最后半行不代表完成事件。
    return events
