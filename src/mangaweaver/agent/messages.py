"""活动执行器串行理解收件；不另起制作或会话写入者。"""
from pathlib import Path

from ..io import read_json, write_json
from ..run_lock import run_lock
from ..schemas import MessageDecision
from . import tasks
from .references import validate


class MessageBoundary(tasks.RevisionBoundary):
    def __init__(self, result):
        self.result = result


def queued(project, delivery):
    return [r for r in tasks.inbox(project) if r['status'] == 'queued' and r.get('delivery', 'steer') == delivery]


def attach(session, item):
    if not any(m['id'] == item['id'] for m in session['messages']):
        session['messages'].append({'id': item['id'], 'role': 'user', 'text': item['text'],
            'created_at': item['created_at'], 'stage': 'agent', 'target': 'all', 'status': 'completed',
            'references': item.get('references', []), 'delivery': item.get('delivery', 'steer')})


def reconcile(project, session):
    for item in tasks.inbox(project):
        if item['status'] not in {'answered', 'applied', 'claimed'}:
            continue  # 尚未接收的后续要求不能作为当前模型的新指令。
        attach(session, item)
        if item['status'] == 'answered' and not any(m['id'] == item['id'] + '-answer' for m in session['messages']):
            session['messages'].append({'id': item['id'] + '-answer', 'role': 'assistant', 'text': item['summary'],
                'created_at': item.get('answered_at', item['created_at']), 'stage': 'agent', 'target': 'all', 'status': 'completed'})


def receive(project, session, request, parent):
    from .tools import read_state
    from .loop import save
    for item in queued(project, 'steer'):
        if item.get('parent_id') and item['parent_id'] != parent:
            continue
        if item.get('branch_id','main') != session.get('branch_id','main'):
            continue
        path = Path(project) / 'pending_requests' / f"{item['id']}.json"
        task = tasks.get(project, parent)
        if item.get('intent') == 'revision':
            raise tasks.RevisionBoundary()
        try:
            refs = validate(project, item.get('references', []))
            if item['run'] != session.get('active_run', '') or item.get('content_revision', 0) != task.get('content_revision', 0):
                raise ValueError('消息所属页面或内容版本已变化，请重新指定目标')
            session['turn_decisions'] = session.get('turn_decisions', 0) + 1
            if session['turn_decisions'] > 32:
                raise ValueError('本次协调达到总决策上限，请检查后调整要求')
            client = request.get('_coordinator_client')
            owned = client is None
            if owned:
                from ..clients import create
                from ..config import Config
                client = create(Config.load(Path(request['env_file']) if request.get('env_file') else None))
            state = read_state(session)
            # 修订中的脚本检查点可能暂未发布镜头；保留任务书所绑定的输入对象身份。
            child = tasks.get(project, task.get('child_id')) or {}
            brief = child.get('brief') or {}
            baseline = []
            if brief.get('run') and brief['run'] != session.get('active_run') and tasks.version(brief['run']) == brief.get('input_version'):
                from .references import objects
                baseline = list(objects(project, brief['run']).values())
            try:
                try:
                    decision = client.json('agent/message.md', {'message': item['text'], 'delivery': item['delivery'],
                        'context': item['context'], 'references': refs, 'task': task, 'state': state,
                        'input_objects': baseline}, MessageDecision,
                        [str(Path(project) / r['path']) for r in refs if r['kind'] == 'image' and r['purpose'] == 'reference'])
                except ValueError as exc:
                    raise RuntimeError(f'消息模型响应失败：{exc}') from exc
            finally:
                if owned:
                    client.save_usage(Path(project) / 'message_usage.json')
                    if hasattr(client, 'close'):
                        client.close()
            item['intent'] = decision.intent
            item['summary'] = decision.text
            if decision.intent == 'stop':
                item.update(status='answered', summary='已停止本地执行，远端任务可能仍在运行')
                with run_lock(path.parent, 'pending_request'):
                    if read_json(path)['status'] == 'withdrawn':
                        continue
                    write_json(path, item)
                raise KeyboardInterrupt()
            if decision.intent == 'question':
                item.update(status='answered', answered_at=tasks.now())
            elif decision.intent == 'revision':
                targets = [r for r in refs if r['purpose'] == 'target']
                if targets and any(r['run'] != item['run'] for r in targets):
                    raise ValueError('修改目标不属于当前任务页面，请作为后续任务明确提出')
                location = targets[0]['location'] if len(targets) == 1 else decision.location
                if targets and location not in {r['location'] for r in targets}:
                    raise ValueError('修改位置超出明确引用的目标，请说明本次范围')
                known = {n['location'] for n in item['context'].get('nodes', [])} | {r['location'] for r in targets}
                known.update(p['panel_id'] for p in state.get('panels', []))
                known.update(s['shot_id'] for s in (state.get('shot_list') or {}).get('shots', []))
                current_locations = {p['panel_id'] for p in state.get('panels', [])} | {s['shot_id'] for s in (state.get('shot_list') or {}).get('shots', [])}
                known.update(n['location'] for n in baseline)
                if not decision.stage or not location or location not in known | {'all'}:
                    raise ValueError('请明确需要修改的镜头或阶段')
                # all 必须有真实全页目标；局部选中不能被扩大成全页。
                selected = [n for n in item['context'].get('nodes', []) if n['id'] in item['context'].get('selected', [])]
                if location == 'all' and (targets or selected) and not any(n['location'] == 'all' for n in targets + selected):
                    raise ValueError('局部目标不能扩大为整页修改，请明确目标')
                item.update(stage=decision.stage, location=location)
                if location not in current_locations and location in {n['location'] for n in baseline}:
                    item.update(revision_base_run=brief['run'], revision_base_version=brief['input_version'])
                with run_lock(path.parent, 'pending_request'):
                    if read_json(path)['status'] == 'withdrawn':
                        continue
                    write_json(path, item)
                attach(session, item)
                save(project, session)
                raise tasks.RevisionBoundary()
            else:
                item.update(status='needs_decision', summary=decision.text or '请明确本次目标和制作范围')
        except ValueError as exc:
            item.update(status='needs_decision', summary=str(exc))
        with run_lock(path.parent, 'pending_request'):
            # 理解期间用户可撤回，撤回优先，不覆盖其记录。
            if read_json(path)['status'] == 'withdrawn':
                continue
            write_json(path, item)
        reconcile(project, session)
        save(project, session)
        from .conversation import current
        if current():
            current().event('delivery',block_id=item['id'],status=item['status'],text=item.get('summary') or '消息已接收',
                            target_task=parent,child_id=item.get('child_session_id'))
        if item['status'] == 'needs_decision':
            raise MessageBoundary({'status': 'needs_user', 'reason': 'message_target', 'summary': item['summary']})


def ready(project, session):
    task = tasks.get(project, session.get('active_task_id'))
    pending = queued(project, 'follow_up')
    steer = queued(project, 'steer')
    if task and task['status'] == 'completed' and not session.get('pending') and not steer and pending:
        return {'kind': 'follow_up', 'request_id': pending[0]['id'], 'task_id': task['id']}
    return session.get('pending')


def claim_follow_up(project, session, request):
    current = ready(project, session) or {}
    if current.get('kind') != 'follow_up' or current.get('request_id') != request.get('message_id') or current.get('task_id') != request.get('task_id'):
        raise ValueError('后续要求已变化，请刷新后显式处理')
    path = Path(project) / 'pending_requests' / f"{current['request_id']}.json"
    with run_lock(path.parent, 'pending_request'):
        item = read_json(path)
        if item['status'] != 'queued':
            raise ValueError('后续要求已接收或已撤回')
        validate(project, item.get('references', []))
        # 当前任务正常完成后的短暂窗口内先固定新任务，重连不重复创建。
        session.pop('active_task_id', None)
        session['active_run'] = item['run']
        session['permissions'] = item['permissions']
        if item.get('page'):
            session.update(active_page_id=item['page']['page_id'], active_book_id=item['page']['book_id'])
        attach(session, item)
        identifier = tasks.create(project, session, item['text'][:100], origin='follow_up', origin_request_id=item['id'])
        session['active_task_id'] = identifier
        session['turn_task_id'] = identifier
        item.update(status='claimed', task_id=identifier)
        write_json(path, item)
    return {**request, 'text': item['text'], 'run_dir': item['run'], 'permissions': item['permissions'],
            'references': item.get('references', []), 'context': item['context'], '_follow_up': item}
