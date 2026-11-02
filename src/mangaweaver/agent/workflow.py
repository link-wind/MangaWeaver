"""将现有专业工具接入固定任务层级，不复制创作／审查实现。"""
from pathlib import Path

from ..schemas import AgentAction, TaskBrief, TaskReport
from ..io import read_json, write_json
from ..run_lock import run_lock
from . import tasks
from .tools import execute, read_state
from .specialists import NeedsAnswer


def root(project, session, title, stage='', origin='conversation'):
    current = tasks.get(project, session.get('active_task_id'))
    if current and current.get('origin') == 'follow_up' and current['status'] == 'running' and session.get('turn_task_id') == current['id']:
        identifier = current['id']
        tasks.update(project, identifier, run=session.get('active_run', ''), page_id=session.get('active_page_id', ''),
                     book_id=session.get('active_book_id', ''), stage=stage)
    elif not current or current['status'] == 'completed' or current['run'] != session.get('active_run', ''):
        identifier = tasks.create(project, session, title, stage, origin=origin)
        session['active_task_id'] = identifier
    else:
        identifier = current['id']
    session['turn_task_id'] = identifier
    from .loop import save
    save(project, session)  # 长模型调用前保存活动任务，强制退出后仍有可恢复身份。
    return identifier


def finish(project, session, result):
    identifier = session.get('active_task_id')
    if not identifier:
        return
    if session.get('turn_task_id') != identifier:
        return  # 普通问答不能把上次失败或等待中的制作任务标记为完成。
    task = tasks.get(project, identifier)
    if not task:
        return
    status = result.get('status', 'completed')
    reason = result.get('reason', '')
    actions = []
    if status in {'blocked', 'needs_user'}:
        status = 'waiting_user'
        actions = [{'kind': 'grant', 'label': '允许并继续', 'scope': result.get('required_scope')}] if reason == 'scope_required' else [
            {'kind': 'resume', 'label': '处理待修改' if reason == 'pending_revision' else '继续原制作'}] if reason in {'pending_revision', 'revision_applied', 'video_downloaded'} else []
        if reason == 'dependency_missing':
            actions = [{'kind': 'stage', 'label': '运行前置阶段', 'stage': result.get('required_stage', 'script')}]
    elif status in {'failed', 'interrupted'}:
        actions = [{'kind': 'resume', 'label': '恢复任务'}]
        directory = Path(session.get('active_run') or task['run'])
        remote = [entry for path in directory.glob('video/*/*/tasks.json')
                  for entry in read_json(path).get('candidates', {}).values()]
        if remote and all(e.get('task_id') for e in remote) and any(e['status'] != 'downloaded' for e in remote):
            actions.insert(0, {'kind': 'download', 'label': '恢复原任务查询／下载'})
    tasks.update(project, identifier, status=status, reason=reason, summary=result.get('summary', ''), actions=actions,
                 run=session.get('active_run', task['run']), page_id=session.get('active_page_id', task['page_id']))
    if task.get('origin_request_id'):
        path = Path(project) / 'pending_requests' / f"{task['origin_request_id']}.json"
        item = read_json(path)
        item.update(status='applied' if status == 'completed' else 'claimed', summary=result.get('summary', ''), task_id=identifier)
        write_json(path, item)


def run_tool(project, session, action, request):
    stage = 'video' if action.tool in {'generate', 'resume'} else 'preprocess' if action.tool == 'preprocess_page' else action.arguments.stage
    if action.tool not in {'delegate', 'preprocess_page', 'generate', 'resume', 'produce'}:
        return execute(project, session, action, request)
    title = '恢复原视频任务' if action.tool == 'resume' else action.text or tasks.LABELS.get(stage, stage)
    identifier = root(project, session, title, stage,
                      'stage' if request['command'] == 'agent_run_stage' else 'conversation')
    request = dict(request)
    if 'references' not in request:
        request['references'] = tasks.get(project, identifier).get('references', [])
    targets = [r for r in request['references'] if r['purpose'] == 'target']
    if targets and any(r['run'] != session.get('active_run') for r in targets):
        return {'status': 'needs_user', 'reason': 'message_target', 'summary': '修改目标属于其他运行，请先选择该页或作为后续任务明确提出'}
    if targets and action.tool == 'delegate':
        if len(targets) == 1 and action.arguments.location == 'all':
            action.arguments.location = targets[0]['location']
        elif action.arguments.location not in {r['location'] for r in targets}:
            return {'status': 'needs_user', 'reason': 'message_target', 'summary': '委派目标与明确引用不一致，请明确本次修改范围'}
    tasks.update(project, identifier, status='running', actions=[], tool=action.tool,
                 arguments=action.arguments.model_dump(), permissions=session.get('permissions', []), references=request['references'])
    if action.tool == 'produce':
        return produce(project, session, action, request)
    return stage_tool(project, session, action, request, identifier, stage)


def stage_tool(project, session, action, request, parent, stage):
    input_run = request.get('_revision_base_run') if action.arguments.revise else None
    state = read_state({**session, 'active_run':input_run}) if input_run else read_state(session)
    from .stages import completed
    resuming = request.get('_resume_child')
    child = tasks.get(project, resuming) if resuming else None
    if child and child['parent_id'] == parent and child['stage'] == stage:
        child_id = child['id']
        tasks.update(project, child_id, status='running', actions=[])
    else:
        child_id = tasks.create(project, session, '查询／下载原视频' if action.tool == 'resume' else tasks.LABELS[stage], stage, parent_id=parent,
                                target=action.arguments.location, input_version=tasks.version(session['active_run']) if session.get('active_run') else '')
    tasks.update(project, parent, child_id=child_id)
    from .references import inputs
    from .messages import receive, MessageBoundary
    from ..events import assignment
    try:
        refs, media = inputs(project, request.get('references') or [])
    except (ValueError, OSError) as exc:
        tasks.update(project, child_id, status='waiting_user', reason='reference_invalid', summary=str(exc))
        return {'status':'needs_user', 'reason':'reference_invalid', 'summary':str(exc)}
    brief = TaskBrief(parent_id=parent, stage=stage, goal=action.arguments.goal or tasks.get(project, parent)['title'],
        run=input_run or session.get('active_run', ''), input_version=tasks.version(input_run or session['active_run']) if session.get('active_run') else '',
        target=action.arguments.location, permissions=session.get('permissions', []), references=refs,
        constraints=['保留原作事件、人物关系与确切对白', '彩色二维动画，配色一致；日语配音与中文字幕', '仅修改任务目标，其他对象保持原有内容'],
        expected_output=tasks.LABELS[stage] + '产物及原专业审查结论')
    if child and child.get('brief'):
        brief = TaskBrief.model_validate(child['brief'])
    tasks.update(project, child_id, brief=brief.model_dump(mode='json'))
    try:
        from .specialists import bind as specialist_scope
        with assignment(brief.model_dump(mode='json'), media), specialist_scope(project,session,child_id,request), tasks.track(project, child_id, lambda: receive(project, session, request, parent)):
            receive(project, session, request, parent)
            if stage == 'video' and action.tool != 'resume' and not state.get('has_production'):
                result = {'status': 'blocked', 'summary': '请先完成关键画面及其审查', 'reason': 'dependency_missing', 'required_stage': 'storyboard'}
            elif stage == 'direction' and state.get('shot_list') and not any(s['type'] == 'action' for s in state['shot_list']['shots']):
                result = {'status': 'completed', 'summary': '本页均为静态镜头，无需动作演出'}
            elif state.get('run') and not refs and not action.arguments.revise and action.tool != 'resume' and completed(state, stage):
                result = {'status': 'completed', 'summary': '复用已通过产物', 'reused': True}
            elif stage == 'video' and any(r['purpose'] == 'reference' for r in refs) and action.tool != 'resume':
                result = {'status': 'blocked', 'reason': 'reference_unsupported', 'summary': '不能将任意画布参考直接用作 H3 控制输入，请明确采用规划关键帧'}
            else:
                result = execute(project, session, action, request)
            if result['status'] == 'completed':
                from ..events import checkpoint
                checkpoint()
        if result['status'] == 'needs_user' and not result.get('reason'):
            result.update(reason='scope_required', required_scope='video' if stage == 'video' else 'images' if stage == 'storyboard' else 'planning')
        elif result['status'] == 'blocked' and not result.get('reason'):
            if result.get('issues'):
                result['reason'] = 'review_exhausted'
            else:
                result.update(reason='dependency_missing', required_stage='preprocess' if not state.get('has_source') else
                              'script' if not state.get('script_ready') else 'arrangement' if not state.get('shot_list') else 'direction')
    except MessageBoundary as exc:
        result = exc.result
    except NeedsAnswer as exc:
        result = {'status':'needs_user','reason':'specialist_question','summary':str(exc),
                  'child_session_id':exc.child['id'],'question_id':exc.question['id']}
    except tasks.RevisionBoundary:
        result = {'status': 'needs_user', 'reason': 'pending_revision', 'summary': '检查点已保存，正在接收修改'}
    except KeyboardInterrupt:
        tasks.update(project, child_id, status='interrupted', summary='本地执行已停止；远端任务可能仍在运行')
        finish(project, session, {'status': 'interrupted', 'summary': '本地执行已停止，进度已保留'})
        raise
    except Exception as exc:
        result = {'status': 'failed', 'reason': 'execution_error', 'summary': str(exc)}
        if '未通过' in str(exc):
            result.update(status='blocked', reason='review_exhausted')
    tasks.update(project, child_id, status='waiting_user' if result['status'] in {'blocked', 'needs_user'} else result['status'],
                 reason=result.get('reason', ''), summary=result['summary'], reused=result.get('reused', False),
                 run=session.get('active_run', ''), artifacts=result.get('artifacts', []))
    child = tasks.get(project, child_id)
    artifacts = list(dict.fromkeys(result.get('artifacts', []) + [a['artifact'] for a in child['activities'] if a.get('artifact') and Path(a['artifact']).is_file()]))
    if result.get('reused') and session.get('active_run'):
        artifacts += [str(Path(session['active_run']) / name) for name in ['production.json', 'planning_draft.json', 'source/manifest.json'] if (Path(session['active_run']) / name).is_file()]
    reviews = [a for a in child['activities'] if 'accepted' in a]
    if result.get('reused'):
        reviews = [r for r in state.get('reviews', []) if r.get('scope', '').split(':')[0] == stage]
    report = TaskReport(status=result['status'], summary=result['summary'], artifacts=artifacts,
        reviews=reviews, reused=result.get('reused', False), reason=result.get('reason', ''),
        next_receiver=(child.get('handoffs') or [{}])[-1].get('receiver', 'coordinator') if result['status'] != 'completed' else 'coordinator')
    tasks.update(project, child_id, report=report.model_dump(mode='json'))
    if result.get('reason') == 'pending_revision':
        return consume_revision(project, session, request, parent)
    return result


def produce(project, session, action, request):
    parent = session['active_task_id']
    target = action.arguments.stage
    tasks.update(project, parent, stage=target, title='制作至' + tasks.LABELS[target], policy='until')
    for stage in tasks.ORDER[:tasks.ORDER.index(target) + 1]:
        tool = 'preprocess_page' if stage == 'preprocess' else 'generate' if stage == 'video' else 'delegate'
        child_action = AgentAction(kind='call_tool', tool=tool, arguments={'stage': stage})
        result = stage_tool(project, session, child_action, request, parent, stage)
        if result['status'] != 'completed':
            return result
    return {'status': 'completed', 'summary': f"已完成{tasks.LABELS[target]}，到达本次制作终点"}


def consume_revision(project, session, request, parent, claimed=None):
    folder = Path(project) / 'pending_requests'
    with run_lock(folder, 'claim_revision'):
        item = claimed or next((r for r in tasks.inbox(project) if r['status'] == 'queued' and r.get('delivery', 'steer') == 'steer' and r.get('intent', 'revision') == 'revision' and r['run'] == session.get('active_run')), None)
        if not item:
            return {'status': 'needs_user', 'reason': 'pending_revision', 'summary': '修改已撤回，可恢复原任务'}
        path = folder / f"{item['id']}.json"
        # 输出产物会改变文件签名：使用提交时的任务版本与运行身份识别用户基线。
        task = tasks.get(project, parent)
        if not claimed and ((item.get('parent_id') and item['parent_id'] != parent) or item.get('content_revision', 0) != task.get('content_revision', 0)):
            item.update(status='needs_decision', summary='修改所属任务已改变，请重新选择版本后发送')
            write_json(path, item)
            return {'status': 'needs_user', 'reason': 'version_conflict', 'summary': item['summary']}
        item.update(status='claimed', accepted_version=tasks.version(item['run']))
        write_json(path, item)
    context = item['context']
    selected = context.get('selected', [])
    node = next((n for n in context.get('nodes', []) if n['id'] in selected), None)
    stage = item['stage']
    if stage not in {'script', 'arrangement', 'direction', 'storyboard'}:
        item.update(status='needs_decision', summary='请选择脚本、编排、演出或关键画面的修改目标')
        write_json(path, item)
        return {'status': 'needs_user', 'reason': 'version_conflict', 'summary': item['summary']}
    if not read_state(session).get('script_ready'):
        item.update(status='needs_decision', summary='尚无可修订的镜头规划，请完成来源脚本后重新提交修改')
        write_json(path, item)
        return {'status': 'needs_user', 'reason': 'missing_input', 'summary': item['summary']}
    from .loop import add_message
    if not any(m['id'] == item['id'] for m in session['messages']):
        add_message(session, 'user', item['text'])
        session['messages'][-1].update(id=item['id'], created_at=item['created_at'])
    tasks.update(project, parent, pending_revision_id=item['id'])
    if item.get('revision_run'):
        session['active_run'] = item['revision_run']
    baseline = item.get('revision_base_run')
    if baseline and tasks.version(baseline) != item.get('revision_base_version'):
        item.update(status='needs_decision', summary='修订输入版本已改变，请重选目标')
        write_json(path, item)
        return {'status':'needs_user','reason':'version_conflict','summary':item['summary']}
    revision = AgentAction(kind='call_tool', tool='delegate', arguments={'stage': stage, 'revise': not bool(item.get('revision_run')),
        'goal': item['text'], 'location': item.get('location') or (node.get('location', 'all') if node else 'all')})
    result = stage_tool(project, session, revision, {**request, '_resume_child': task.get('child_id') if claimed else None,
                        '_pending_revision_id': item['id'], '_revision_base_run':baseline,
                        'references': item.get('references', [])}, parent, stage)
    recoverable = result['status'] == 'failed' or result.get('reason') == 'scope_required'
    saved = read_json(path)
    if saved.get('revision_run'):
        item['revision_run'] = saved['revision_run']
    item.update(status='applied' if result['status'] == 'completed' else 'claimed' if recoverable else 'needs_decision',
                summary=result['summary'])
    new_version = bool(item.get('revision_run') and not item.get('version_recorded'))
    if new_version:
        item['version_recorded'] = True
    write_json(path, item)
    tasks.update(project, parent, run=session.get('active_run', task['run']), content_revision=task.get('content_revision', 0)+int(new_version),
                 pending_revision_id=item['id'] if recoverable else None)
    with run_lock(folder, 'revision_conflicts'):
        for other in tasks.inbox(project):
            if new_version and other['status'] == 'queued' and other.get('delivery', 'steer') == 'steer' and other['run'] == item['run']:
                other.update(status='needs_decision', summary='已有修改形成新版本，请查看新版本后重新提交此要求')
                write_json(folder / f"{other['id']}.json", other)
    return result if result['status'] != 'completed' else {'status': 'needs_user', 'reason': 'revision_applied',
        'summary': '修改已应用并通过审查，检查后可继续原制作目标'}


def resume(project, session, request):
    task = tasks.get(project, request.get('task_id'))
    if not task or task.get('parent_id') or task['id'] != session.get('active_task_id'):
        raise ValueError('任务已过期，请刷新任务记录')
    if task.get('branch_id','main')!=session.get('branch_id','main'):
        raise ValueError('任务属于其他分支，请回到原会话恢复')
    if request.get('task_revision') != task['revision']:
        raise ValueError('任务版本已改变，请刷新后操作')
    session['active_run'] = task['run']
    session['permissions'] = task['permissions']
    session['turn_task_id'] = task['id']
    if request.get('resume_mode') == 'download':
        result = stage_tool(project, session, AgentAction(kind='call_tool', tool='resume'), request, task['id'], 'video')
        if result['status'] == 'completed':
            return {'status': 'needs_user', 'reason': 'video_downloaded', 'summary': '原任务查询／下载已完成；继续制作将评审并剪辑，不重复提交已有任务'}
        return result
    if request.get('grant_scope'):
        if task['reason'] != 'scope_required':
            raise ValueError('此任务不需要扩展制作范围')
        scope = request['grant_scope']
        allowed = {'planning': ['planning'], 'images': ['planning', 'images'], 'video': ['planning', 'images', 'video']}
        if scope not in allowed:
            raise ValueError('制作范围无效')
        session['permissions'] = allowed[scope]
        tasks.update(project, task['id'], permissions=session['permissions'])
    claimed = next((r for r in tasks.inbox(project) if r['id'] == task.get('pending_revision_id') and r['status'] == 'claimed'), None)
    if claimed:
        return consume_revision(project, session, request, task['id'], claimed=claimed)
    if task['reason'] in {'review_exhausted', 'version_conflict'}:
        return {'status': 'needs_user', 'reason': task['reason'], 'summary': '请查看问题并提交明确修改，不自动重置修订轮次'}
    from .messages import receive, MessageBoundary
    try:
        receive(project, session, request, task['id'])
    except MessageBoundary as exc:
        return exc.result
    except tasks.RevisionBoundary:
        return consume_revision(project, session, request, task['id'])
    action = AgentAction(kind='call_tool', tool=task.get('tool', 'produce'), arguments=task.get('arguments', {'stage': task['stage']}))
    # 计划修订只在首次 fork；中断恢复继续该修订运行，不再次 fork。
    if action.arguments.revise:
        action.arguments.revise = False
    return run_tool(project, session, action, {**request, '_resume_child': task.get('child_id')})
