"""一次请求运行至回答、用户问题或画布回执；下一请求加载会话继续。"""
from pathlib import Path
from pydantic import ValidationError
from uuid import uuid4
from ..io import read_json, write_json
from ..schemas import AgentAction
from ..run_lock import run_lock
from ..events import emit
from .tools import TOOLS, read_state, book_for
from .workflow import run_tool as execute, finish
from . import tasks, conversation


def load_session(project):
    path = Path(project) / 'session.json'
    return read_json(path) if path.exists() else {
        'version': 1, 'revision': 0, 'messages': [], 'tool_results': [], 'goal': '',
        'active_run': '', 'active_book_id': '', 'active_page_id': '', 'pending': None, 'permissions': []}


def save(project, session):
    session['revision'] += 1
    from ..desktop import redact
    write_json(Path(project) / 'session.json', redact(session))


def add_message(session, role, text):
    journal = conversation.current()
    extra = {'turn_id': journal.turn_id} if journal else {}
    if session.get('active_run'):
        extra.update(run=session['active_run'], page_id=session.get('active_page_id', ''))
    if journal and role == 'assistant' and text != getattr(journal, 'last_text', None):
        journal.event('text', block_id=uuid4().hex, delta=text, status='completed')
    message={**extra, 'id': uuid4().hex, 'role': role, 'text': text,
             'target': 'all', 'stage': 'agent', 'status': 'completed', 'created_at': tasks.now()}
    session['messages'].append(message)
    if journal and role=='user':
        journal.event('user',message=message)


def handle(request, client=None):
    project = Path(request['project']).resolve()
    if not (project / 'project.json').is_file():
        raise ValueError('请先创建或打开项目')
    if request['command'] == 'read_session':
        return load_session(project)
    with run_lock(project, 'agent'):
        session = load_session(project)
        if request['command'] in {'agent_fork','agent_switch_branch'}:
            from .branches import change
            session=change(project,session,request)
            save(project,session)
            return session
        with conversation.bind(project, session, request):
            if request['command']=='agent_compact':
                from ..config import Config
                from ..clients import create
                from .context import prepare
                client=create(Config.load(Path(request['env_file']) if request.get('env_file') else None))
                try:
                    prepare(project,session,client,{'messages':session['messages'], 'recent_results':session['tool_results'],
                        'goal':session['goal'],'permissions':session['permissions']},force=True)
                    save(project,session)
                    return session
                finally:
                    client.save_usage(project/'agent_compact_usage.json')
                    client.close()
            if request['command'] == 'agent_answer':
                from .specialists import answer
                request = answer(project,session,request)
            from .messages import reconcile, claim_follow_up
            reconcile(project, session)
            if request['command'] == 'agent_follow_up':
                request = claim_follow_up(project, session, request)
            if request.get('project_scope'):
                session.update(active_run='', active_page_id='')
            if request.get('run_dir') and request['command'] not in {'agent_continue', 'agent_resume_task', 'agent_next_batch'}:
                session['active_run'] = request['run_dir']
                metadata = Path(request['run_dir']) / 'input/book.json'
                if metadata.is_file():
                    page = read_json(metadata)
                    session.update(active_book_id=page['book_id'], active_page_id=page['page_id'])
                old = Path(request['run_dir']) / 'canvas.json'
                if old.exists():
                    data = read_json(old)
                    ids = {m['id'] for m in session['messages']}
                    session['messages'].extend(m for m in data.get('messages', []) if m['id'] not in ids)
                    session['goal'] = data.get('prompt') or session['goal']
            if request['command'] == 'agent_resume_task' and (session.get('pending') or {}).get('kind') == 'batch':
                task = tasks.get(project, request.get('task_id'))
                if not task or task['id'] != session.get('active_task_id') or task['revision'] != request.get('task_revision'):
                    raise ValueError('任务版本已改变，请刷新后恢复')
                tasks.update(project, task['id'], status='queued')
                request = {**request, 'command': 'agent_next_batch', 'revision': session['pending']['revision']}
            if request['command'] == 'agent_resume_task':
                from .workflow import resume
                result = resume(project, session, request)
                finish(project, session, result)
                session['pending'] = None if result['status'] == 'completed' else {'kind': 'user', 'question': result['summary'], 'child_session_id':result.get('child_session_id'), 'question_id':result.get('question_id')}
                save(project, session)
                return session
            if request['command'] == 'agent_run_stage':
                from .stages import LABELS, run_stage
                stage = request.get('stage')
                if stage not in LABELS:
                    raise ValueError('未知制作阶段')
                session['permissions'] = [] if stage == 'preprocess' else ['planning', 'images', 'video'] if stage == 'video' else ['planning', 'images'] if stage == 'storyboard' else ['planning']
                if request.get('operation') == 'resume':
                    session['permissions'] = []
                session['pending'] = None
                session.pop('active_task_id', None)
                save(project, session)
                try:
                    result = run_stage(project, session, request)
                except KeyboardInterrupt:
                    session['pending'] = {'kind': 'interrupted', 'stage': stage}
                    add_message(session, 'assistant', f'{LABELS[stage]}已停止，进度已保存；点击运行可继续。')
                    save(project, session)
                    raise
                except Exception as exc:
                    finish(project, session, {'status':'failed', 'summary': str(exc)})
                    add_message(session, 'assistant', f'{LABELS[stage]}执行失败：{exc}')
                    save(project, session)
                    raise
                finish(project, session, result)
                if result['status'] != 'completed':
                    session['pending'] = {'kind': 'user', 'question': result['summary'], 'child_session_id':result.get('child_session_id'), 'question_id':result.get('question_id')}
                save(project, session)
                return session
            if request['command'] in {'agent_select_page', 'agent_open_pages'}:
                if request['command'] == 'agent_open_pages':
                    pages = request.get('pages')
                    book = book_for(project, session)
                    if not isinstance(pages, list) or not pages or any(type(n) is not int or not 1 <= n <= book['page_count'] for n in pages):
                        raise ValueError('请选择有效的文件页序')
                    active_number = int(session.get('active_page_id', '').removeprefix('page') or pages[0])
                    if active_number not in pages:
                        active_number = pages[0]
                    for number in dict.fromkeys(pages):
                        execute(project, session, AgentAction(kind='call_tool', tool='select_page', arguments={'page': number}), request)
                    execute(project, session, AgentAction(kind='call_tool', tool='select_page', arguments={'page': active_number}), request)
                    session['pending'] = None
                    save(project, session)
                    return session
                number = request.get('page_number')
                if type(number) is not int:
                    raise ValueError('页码必须为整数')
                result = execute(project, session, AgentAction(kind='call_tool', tool='select_page', arguments={'page': number}), request)
                add_message(session, 'user', f'选择文件第 {number} 页')
                add_message(session, 'assistant', result['summary'])
                session['pending'] = None
                save(project, session)
                return session
            if request['command'] == 'agent_next_batch':
                pending = session.get('pending') or {}
                if pending.get('kind') != 'batch' or pending.get('task_id') != request.get('task_id') or pending.get('revision') != request.get('revision'):
                    raise ValueError('任务续接已过期')
                task = tasks.get(project, request.get('task_id'))
                if not task or task['status'] != 'queued':
                    raise ValueError('任务已停止或发生变化，不能自动续接')
                session['turn_steps'] = 0
                session['pending'] = None
            elif request['command'] == 'agent_continue':
                pending = session.get('pending') or {}
                if pending.get('kind') != 'canvas' or pending.get('call_id') != request.get('call_id') or pending.get('revision') != request.get('revision'):
                    raise ValueError('画布回执已过期')
                if request.get('run_dir') != pending.get('run'):
                    raise ValueError('画布页面已切换')
                conversation.current().event('tool', block_id=pending['call_id'], call_id=pending['call_id'], tool='control_canvas', status=(request.get('result') or {}).get('status','failed'), result=request.get('result'))
                session['tool_results'].append({'tool': 'control_canvas', 'call_id': pending['call_id'], 'result': request.get('result')})
                session['pending'] = None
            else:
                text = str(request.get('text', '')).strip()
                if len(text) > 20000:
                    raise ValueError('消息过长')
                if not text and not request.get('attachment'):
                    raise ValueError('请输入要求或添加漫画')
                if (session.get('pending') or {}).get('kind') == 'interrupted':
                    add_message(session, 'assistant', '上次执行中断；将先读取已保存的结果，不自动重新提交视频。')
                session['pending'] = None
                session['turn_steps'] = 0
                session['turn_decisions'] = 0
                session['turn_task_id'] = None
                previous_task = tasks.get(project, session.get('active_task_id'))
                if previous_task and previous_task['status'] == 'completed':
                    session.pop('active_task_id', None)
                if not request.get('_follow_up'):
                    add_message(session, 'user', text or '打开这个漫画，帮我选择要改编的页面。')
                    session['messages'][-1].update(references=request.get('references') or [])
                else:
                    session['turn_task_id'] = session['active_task_id']
                from .references import validate
                request['references'] = validate(project, request.get('references') or [])
                canvas_path = Path(session.get('active_run') or project) / 'canvas.json'
                if canvas_path.exists():
                    canvas = read_json(canvas_path)
                    if canvas.get('draft', '').strip() == text:
                        canvas['draft'] = ''
                        write_json(canvas_path, canvas)
                if not session['goal']:
                    session['goal'] = text
                permissions = request.get('permissions', [])
                if any(p not in {'planning', 'images', 'video'} for p in permissions):
                    raise ValueError('制作授权无效')
                session['permissions'] = permissions
                if request.get('attachment'):
                    from ..preprocessing.import_manga import import_manga
                    book = import_manga(project, request['attachment'])
                    session.update(active_book_id=book['id'], active_page_id='', active_run='', goal=text)
                    session['tool_results'].append({'tool': 'import_manga', 'result': {'status': 'completed', 'name': book['name'], 'page_count': book['page_count']}})
            save(project, session)
            if request.get('attachment'):
                emit('book.ready', book_id=session['active_book_id'], message='首批页面已加载，可在画布中浏览')
            if client is None:
                from ..config import Config
                from ..clients import create
                client = create(Config.load(Path(request['env_file']) if request.get('env_file') else None))
            if request['command'] in {'agent_next_batch', 'agent_continue'}:
                request['references'] = session.get('turn_references', [])
            else:
                session['turn_references'] = request.get('references', [])
            try:
                request['_coordinator_client'] = client
                for _ in range(max(0, 8 - session.get('turn_steps', 0))):
                    session['turn_steps'] = session.get('turn_steps', 0) + 1
                    session['turn_decisions'] = session.get('turn_decisions', 0) + 1
                    if session['turn_decisions'] > 32:
                        result = {'status':'needs_user', 'reason':'decision_limit', 'summary':'本次协调已达到总决策上限，请检查任务目标和现有结果后再调整要求'}
                        finish(project, session, result)
                        session['pending'] = {'kind':'user','question':result['summary']}
                        save(project, session)
                        return session
                    emit('agent.thinking', message='理解需求与工具结果', run_dir=session.get('active_run'))
                    state = read_state(session)
                    book = book_for(project, session) if session['active_book_id'] else None
                    # 新建页面后前端尚未刷新，补充来自真实来源的节点标识。
                    context = dict(request.get('context') or {})
                    if context.get('run') != session.get('active_run'):
                        context = {'selected': [], 'nodes': []}
                    if state.get('run'):
                        real_nodes = [{'id': 'source', 'title': '整页漫画', 'kind': 'source', 'location': 'all', 'stage': 'script'}]
                        if state.get('script_ready') or state.get('shot_list'):
                            real_nodes.append({'id': 'arrangement', 'title': '镜头规划', 'kind': 'arrangement', 'location': 'all', 'stage': 'arrangement'})
                        real_nodes += [{'id': 'panel:' + p['panel_id'], 'title': p['panel_id'], 'kind': 'panel', 'location': p['panel_id'], 'stage': 'script'} for p in state.get('panels', [])]
                        real_nodes += [{'id': 'shot:' + p['shot_id'], 'title': p['shot_id'], 'kind': 'shot', 'location': p['shot_id'], 'stage': 'arrangement'} for p in (state.get('shot_list') or {}).get('shots', [])]
                        known = {n['id'] for n in real_nodes}
                        real_nodes += [n for n in context.get('nodes', []) if n['id'] not in known]
                        context['nodes'] = real_nodes
                        context['run'] = state['run']
                        request['context'] = context
                    payload = {'messages': session['messages'], 'goal': session['goal'],
                               'permissions': session['permissions'], 'state': state,
                               'book': {k: book[k] for k in ['id', 'name', 'page_count']} if book else None,
                               'context': request.get('context', {}), 'references': request.get('references', []), 'tools': TOOLS,
                               'recent_results': session['tool_results']}
                    media = []
                    # 只读取选定页或用户请求查看的单页，绝不上传整本文件。
                    if state.get('original_page'):
                        media = [state['original_page']]
                    media += [str(project / r['path']) for r in request.get('references', []) if r['kind'] == 'image' and r['purpose'] == 'reference']
                    recent = session['tool_results'][-1:]
                    if recent and recent[0].get('tool') == 'read_pages':
                        media = [p['image'] for p in recent[0]['result'].get('pages', [])][:1]
                    from .context import prepare
                    payload = prepare(project, session, client, payload)
                    save(project,session)
                    try:
                        action = conversation.action(client, 'agent/system.md', payload, AgentAction, media)
                    except ValidationError:
                        from ..desktop import redact
                        write_json(project / 'agent.failed.json', redact({'text': client.last_json_text}))
                        raise ValueError('Agent 未返回有效动作，已保留工具结果和原始响应；未继续执行。') from None
                    if action.kind in {'reply', 'ask_user'}:
                        finish(project, session, {'status':'needs_user' if action.kind == 'ask_user' else 'completed', 'reason':'missing_input' if action.kind == 'ask_user' else '', 'summary':action.text})
                        add_message(session, 'assistant', action.text)
                        if action.kind == 'ask_user':
                            session['pending'] = {'kind': 'user', 'question': action.text}
                        save(project, session)
                        return session
                    call_id = uuid4().hex
                    session['pending'] = {'kind': 'interrupted', 'call_id': call_id, 'tool': action.tool, 'arguments': action.arguments.model_dump()}
                    save(project, session)
                    conversation.current().event('tool', block_id=call_id, call_id=call_id, tool=action.tool, arguments=action.arguments.model_dump(), status='running', run=session.get('active_run'))
                    emit('agent.tool', tool=action.tool, call_id=call_id, status='running', message=action.text or action.tool, run_dir=session.get('active_run'))
                    try:
                        with conversation.call(call_id):
                            result = execute(project, session, action, request)
                    except ValidationError as exc:
                        result = {"status": "failed", "summary": "模型未返回有效的结构化结果，已保留阶段记录，未继续下游制作。", "error": str(exc)[:1000]}
                    except Exception as exc:
                        result = {'status': 'failed', 'summary': str(exc)}
                    conversation.current().event('tool', block_id=call_id, call_id=call_id, status='waiting' if result.get('status') == 'canvas' else result.get('status'), result=result)
                    emit('agent.tool', tool=action.tool, call_id=call_id, status=result.get('status'), message=result.get('summary', action.tool), run_dir=session.get('active_run'))
                    if result.get('status') == 'canvas':
                        session['pending'] = {**result, 'kind': 'canvas', 'call_id': call_id, 'revision': session['revision'] + 1}
                        save(project, session)
                        return session
                    session['tool_results'].append({'tool': action.tool, 'arguments': action.arguments.model_dump(), 'call_id': call_id, 'result': result})
                    session['pending'] = None
                    save(project, session)
                    if result.get('status') in {'failed', 'needs_user', 'blocked'}:
                        add_message(session, 'assistant', result['summary'])
                        finish(project, session, result)
                        session['pending'] = {'kind': 'user', 'question': result['summary'], 'child_session_id':result.get('child_session_id'), 'question_id':result.get('question_id')}
                        save(project, session)
                        return session
                from .workflow import root
                identifier = root(project, session, '创作协调')
                tasks.update(project, identifier, status='queued', summary='正在衔接下一批步骤', decision_count=session.get('turn_decisions', 0))
                session['pending'] = {'kind':'batch', 'task_id':identifier, 'revision':session['revision'] + 1}
                save(project, session)
                return session
            except (Exception, KeyboardInterrupt) as exc:
                finish(project, session, {'status':'interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed', 'summary':str(exc) or '本地执行已停止'})
                save(project, session)
                raise
            finally:
                client.save_usage(project / 'agent_usage.json')
                if hasattr(client, 'close'):
                    client.close()
