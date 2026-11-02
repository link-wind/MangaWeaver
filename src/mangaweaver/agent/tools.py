"""固定工具直接调用现有业务，不让总 Agent 替代专业审查。"""
from pathlib import Path
from uuid import uuid4
from ..io import project_run, read_json, write_json
from ..run_lock import run_lock

STAGES = ['script', 'arrangement', 'direction', 'storyboard']
TOOLS = {
    'produce': '按用户明确的制作终点连续完成必要阶段；stage=preprocess/script/arrangement/direction/storyboard/video。不超出当前授权。',
    'create_run': '用户明确要求新运行时，为当前页面创建全新运行；保留旧产物，之后重新预处理。page 可指定文件页序。',
    'read_project': '读取当前运行的阶段、审查与来源摘要。',
    'read_pages': '读取当前书籍的页数和页面索引；page 可指定要查看的文件页序。',
    'select_page': '选择文件页序 page，创建该页画布。单页也调用，page=1；用户明确要求新运行时 new_run=true。',
    'preprocess_page': '对当前整页执行本地 MAGI 分格和 OCR；已有来源时只读取。',
    'delegate': '委派专业 Creator/Reviewer；stage、goal、location、revise。严格按 script→arrangement→direction→storyboard。',
    'revise_source': '校正指定 panel_id 的 OCR text，创建新来源与运行，保留旧版。',
    'generate': '按已通过计划生成视频；需要 video 授权和可用后端。',
    'resume': '只查询和下载已有视频任务，不重新提交。',
    'control_canvas': '视图操作 operation=select/focus/layout/open_details；node_ids 为当前可操作节点；layout 用 dx/dy 平移。',
}


def read_state(session):
    directory = session.get('active_run')
    if not directory:
        return {'status': 'completed', 'summary': '尚未选定漫画页'}
    from ..desktop import read_run
    data = read_run(directory)
    records = {r['file']: r.get('data') for r in data['records']}
    plan = records.get('planning_draft.json') or records.get('planning_state.json') or records.get('production.json') or {}
    source = records.get('source/manifest.json') or {}
    export = records.get('export.json') or {}
    final = Path(directory) / 'final.mp4'
    return {'status': 'completed', 'run': directory, 'has_source': bool(source),
            'has_production': 'production.json' in records,
            'final_video': {'path': str(final), 'actual_duration': export.get('actual_duration'),
                            'target_duration': export.get('target_duration')} if final.is_file() else None,
            'script_ready': bool(plan.get('script')), 'script': plan.get('script'), 'shot_list': plan.get('shot_list'),
            'directions': plan.get('directions', []), 'reviews': plan.get('reviews', []),
            'panels': [{'panel_id': p['panel_id'], 'text': p.get('text', '')} for p in source.get('panels', [])],
            'pause': records.get('planning_pause.json'), 'original_page': data['original_page']}


def book_for(project, session):
    identifier = session.get('active_book_id', '')
    if not identifier.startswith('book-') or '/' in identifier or '..' in identifier:
        raise ValueError('请先导入漫画')
    return read_json(project / 'sources' / identifier / 'book.json')


def new_run(project):
    project = Path(project).resolve()
    directory = project / 'runs' / uuid4().hex[:12]
    directory.mkdir(parents=True)
    path = project / 'project.json'
    data = read_json(path)
    data['runs'].append(str(directory.relative_to(project)))
    write_json(path, data)
    return directory


def execute(project, session, action, request):
    from ..desktop import dispatch, start_canvas, fork_canvas
    a = action.arguments
    tool = action.tool
    if tool == 'create_run':
        if not session.get('active_book_id'):
            state = read_state(session)
            if not state.get('original_page'):
                raise ValueError('没有可用于新运行的整页漫画')
            directory = new_run(project)
            start_canvas({'run_dir': str(directory), 'page': state['original_page'], 'prompt': session.get('goal', '')})
            session['active_run'] = str(directory)
            return {'status': 'completed', 'run': str(directory), 'summary': '已为当前页创建新运行'}
        number = a.page or int(session.get('active_page_id', '').removeprefix('page') or 0)
        return execute(project, session, action.model_copy(update={'tool': 'select_page', 'arguments': a.model_copy(update={'page': number, 'new_run': True})}), request)
    if tool == 'read_project':
        return read_state(session)
    if tool == 'read_pages':
        book = book_for(project, session)
        if a.page is not None and not 1 <= a.page <= book['page_count']:
            raise ValueError(f"文件页序应在 1～{book['page_count']}")
        if a.page is not None:
            from ..preprocessing.import_manga import load_pages
            book = load_pages(project, book['id'], [a.page])
        return {'status': 'completed', 'page_count': book['page_count'],
                'pages': [p for p in book['pages'] if p['number'] == a.page] if a.page else [],
                'summary': 'page 参数指定文件页序后可查看该页'}
    if tool == 'select_page':
        from .pages import page_runs
        book = book_for(project, session)
        if a.page is None or not 1 <= a.page <= book['page_count']:
            raise ValueError(f"请指定文件页序 1～{book['page_count']}")
        from ..preprocessing.import_manga import load_pages
        book = load_pages(project, book['id'], [a.page])
        page = book['pages'][a.page - 1]
        session['page_runs'] = page_runs(project, session)
        key = f"{book['id']}:{page['id']}"
        if key in session['page_runs'] and not a.new_run:
            directory = session['page_runs'][key]
            if not Path(directory).is_dir():
                raise ValueError('该页原运行已不存在，请显式创建新运行')
            session.update(active_page_id=page['id'], active_run=directory)
            return {'status': 'completed', 'summary': f"已打开文件第 {a.page} 页的已有进度", 'run': directory}
        directory = new_run(project)
        start_canvas({'run_dir': str(directory), 'page': page['image'], 'prompt': session.get('goal', '')})
        write_json(directory / 'input/book.json', {'book_id': book['id'], 'page_id': page['id'], 'number': page['number']})
        session.update(active_page_id=page['id'], active_run=str(directory))
        session['page_runs'][key] = str(directory)
        from ..events import emit
        emit('page.selected', status='completed', run_dir=str(directory), page=a.page)
        return {'status': 'completed', 'run': str(directory), 'summary': f"已选择文件第 {a.page} 页"}
    directory = Path(session.get('active_run') or '')
    if not session.get('active_run'):
        return {'status': 'blocked', 'summary': '请先选择漫画页'}
    state = read_state(session)
    if tool == 'delegate' and a.revise and request.get('_revision_base_run'):
        baseline = Path(request['_revision_base_run']).resolve()
        if not project_run(project, baseline):
            raise ValueError('修订输入不属于当前项目')
        directory = baseline
        state = read_state({**session, 'active_run':str(baseline)})
    if tool == 'control_canvas':
        nodes = request.get('context', {}).get('nodes', [])
        ids = {n['id'] for n in nodes}
        if not a.node_ids or any(n not in ids for n in a.node_ids):
            raise ValueError('画布目标不存在，请先读取当前节点')
        return {'status': 'canvas', 'operation': a.operation, 'node_ids': a.node_ids,
                'dx': a.dx, 'dy': a.dy, 'run': str(directory)}
    if tool == 'preprocess_page':
        if state['has_source']:
            return {**state, 'summary': '已有分格来源，未重复执行'}
        dispatch({'command': 'preprocess', 'run_dir': str(directory), 'page': state['original_page'], 'env_file': request.get('env_file')})
        return {**read_state(session), 'summary': '本地分格已完成，OCR 仍为待校对草稿'}
    required = 'video' if tool == 'generate' else 'images' if tool == 'delegate' and a.stage == 'storyboard' else 'planning'
    if tool not in {'resume', 'revise_source'} and required not in session.get('permissions', []):
        return {'status': 'needs_user', 'summary': f'需要 {required} 制作授权，请在输入框选择允许的制作范围后发送继续'}
    if tool == 'revise_source':
        from ..desktop import revise_source
        from ..preprocessing.transcript import load_source
        source_path = directory / 'source/manifest.json'
        source = load_source(source_path)
        if a.panel_id not in {p.panel_id for p in source.panels}:
            raise ValueError('漫画格不存在')
        updates = [{'panel_id': p.panel_id, 'text': a.text if p.panel_id == a.panel_id else p.text} for p in source.panels]
        result = revise_source({'project': str(project), 'source': str(source_path), 'panels': updates})
        current = new_run(project)
        start_canvas({'run_dir': str(current), 'page': state['original_page'], 'manifest': result['manifest'], 'prompt': session.get('goal', '')})
        from .pages import bind_revision
        bind_revision(directory, current, session)
        session['active_run'] = str(current)
        return {'status': 'completed', 'summary': '已创建校正来源的新版本', 'artifacts': [result['manifest']]}
    if tool == 'delegate':
        if a.stage not in STAGES:
            raise ValueError('专业委派只支持脚本、编排、演出和关键画面阶段')
        if not state['has_source']:
            return {'status': 'blocked', 'summary': '缺少分格来源，请先执行 preprocess_page'}
        stage = a.stage
        if request.get('references') and not a.revise:
            from .stages import completed
            if completed(state, stage):
                return {'status': 'blocked', 'reason': 'explicit_revision', 'summary': '已有阶段产物；采用新的引用请明确修订该阶段，旧结果保持原版本'}
        if stage != 'script' and not state['script_ready']:
            return {'status': 'blocked', 'summary': '缺少来源脚本，请先委派 script'}
        if stage in {'direction', 'storyboard'} and not state['shot_list']:
            return {'status': 'blocked', 'summary': '缺少镜头编排，请先委派 arrangement'}
        if stage == 'storyboard' and state['shot_list'] and any(s['type'] == 'action' for s in state['shot_list']['shots']) and not state['directions']:
            return {'status': 'blocked', 'summary': '动作镜头缺少演出，请先委派 direction'}
        if a.location != 'all':
            targets = {p['panel_id'] for p in state['panels']} | {s['shot_id'] for s in (state['shot_list'] or {}).get('shots', [])}
            if a.location.split(':')[0] not in targets:
                if not any(a.location == a0['keyframe_id'] for a0 in (read_json(directory / 'planning_draft.json') if (directory / 'planning_draft.json').exists() else read_json(directory / 'production.json')).get('assets', [])):
                    raise ValueError('修订位置不属于当前来源或计划')
        if a.revise:
            if not state['script_ready']:
                raise ValueError('当前没有可修订的规划')
            current = new_run(project)
            fork_canvas({'from_run': str(directory), 'run_dir': str(current)})
            from .pages import bind_revision
            bind_revision(directory, current, session)
            directory = current
            session['active_run'] = str(current)
            # 修订目录身份先落盘，停止后才能继续同一修订而非再次 fork。
            from .loop import save
            save(project, session)
            if request.get('_pending_revision_id'):
                from . import tasks
                path = project / 'pending_requests' / f"{request['_pending_revision_id']}.json"
                with run_lock(path.parent, 'revision_run'):
                    item = read_json(path)
                    item['revision_run'] = str(current)
                    write_json(path, item)
                tasks.update(project, session['active_task_id'], run=str(current))
        try:
            dispatch({'command': 'plan', 'run_dir': str(directory), 'until_stage': stage,
                      'from_stage': stage if a.revise else None, 'location': a.location,
                      'feedback': a.goal, 'env_file': request.get('env_file')})
        except ValueError as exc:
            if not str(exc).startswith('已达规划轮次上限'):
                raise
            result = read_state(session)
            return {'status': 'blocked', 'summary': str(exc), 'issues': [r for r in result['reviews'] if not r['accepted']],
                    'artifacts': [str(directory)], 'state': result}
        result = read_state(session)
        reviews = [r for r in result['reviews'] if r.get('scope', '').split(':')[0] == stage]
        no_action = stage == 'direction' and not any(s['type'] == 'action' for s in (result['shot_list'] or {}).get('shots', []))
        passed = bool(reviews) and all(r['accepted'] for r in reviews) or no_action
        return {'status': 'completed' if passed else 'blocked', 'summary': f'{stage} 已通过审查' if passed else '阶段未通过审查',
                'issues': [r for r in reviews if not r['accepted']], 'artifacts': [str(directory)], 'state': result}
    if tool in {'generate', 'resume'}:
        dispatch({'command': tool, 'run_dir': str(directory), 'env_file': request.get('env_file')})
        return {'status': 'completed', 'summary': '制作流程执行完成' if tool == 'generate' else '已查询原有任务', 'artifacts': [str(directory)]}
    raise ValueError('未知工具')
