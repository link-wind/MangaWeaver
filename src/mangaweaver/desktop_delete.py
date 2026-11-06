"""画布删除：受限清理当前运行的派生产物，原始输入始终保留。"""
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
import re

from .io import file_signature, project_run, read_json, signature, write_json
from .run_lock import run_lock


def _plan(root, node_ids, scope):
    from .desktop import original_page

    records = {str(p.relative_to(root)): read_json(p) for p in root.rglob('*.json')
               if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root)
               and p.stat().st_size <= 10_000_000}
    current = next((records[n] for n in ('planning_draft.json', 'production.json', 'planning_state.json') if n in records), {})
    source = records.get('source/manifest.json', records.get('source/prepared.json', current.get('source', {})))
    panels = {p['panel_id']: p for p in source.get('panels', [])}
    shots = {s['shot_id']: s for s in (current.get('shot_list') or {}).get('shots', [])}
    assets = {a['keyframe_id']: a for a in current.get('assets', [])}
    video = []
    for name, record in sorted(records.items()):
        if name.startswith('video/') and name.endswith('/tasks.json'):
            shot = Path(name).parts[1]
            for candidate, entry in record.get('candidates', {}).items():
                index = sum(item[0] == shot for item in video)
                video.append((shot, f'video:{shot}:{index}', name, candidate, entry))

    remove_panels, remove_shots, remove_frames, video_shots = set(), set(), set(), set()
    video_nodes = set()
    clear_plan = clear_source = clear_final = dirty_plan = False
    for node in node_ids:
        if node == 'source':
            clear_source = clear_plan = True
        elif node == 'group:panel':
            if scope == 'node':
                clear_source = True
            clear_plan = True
        elif node.startswith('panel:') and node[6:] in panels:
            if scope == 'node':
                remove_panels.add(node[6:])
                clear_plan = True
            else:
                dirty_plan = True
        elif node == 'arrangement':
            if scope == 'node':
                clear_plan = True
            else:
                remove_shots.update(shots)
        elif node == 'group:shot' or node.startswith('shot:') and node[5:] in shots:
            selected = set(shots) if node == 'group:shot' else {node[5:]}
            if scope == 'node':
                remove_shots.update(selected)
            else:
                remove_frames.update(k for k, a in assets.items() if a['shot_id'] in selected)
                video_shots.update(selected)
        elif node == 'group:frame' or node.startswith('frame:') and node[6:] in assets:
            selected = set(assets) if node == 'group:frame' else {node[6:]}
            video_shots.update(assets[k]['shot_id'] for k in selected)
            if scope == 'node':
                remove_frames.update(selected)
        elif node == 'group:video':
            if scope == 'node':
                video_shots.update(v[0] for v in video)
            clear_final = True
        elif node == 'final':
            if scope == 'node':
                clear_final = True
        elif node in {v[1] for v in video}:
            if scope == 'node':
                video_nodes.add(node)
            clear_final = True
        else:
            raise ValueError(f'节点已变化或不支持删除，请刷新：{node}')
    if clear_source:
        remove_panels.update(panels)
    if clear_plan:
        remove_shots.update(shots)
    remove_frames.update(k for k, a in assets.items() if a['shot_id'] in remove_shots)
    video_shots.update(remove_shots)
    video_shots.update(assets[k]['shot_id'] for k in remove_frames)
    changed_plan = clear_plan or dirty_plan or bool(remove_shots or remove_frames)
    clear_final |= changed_plan or bool(video_shots or video_nodes)

    def source_path(value):
        path = Path(value)
        return path.resolve() if path.is_absolute() else (root / 'source' / path).resolve()

    protected = {source_path(p) for p in [original_page(root, source, records.get('canvas.json')),
                 records.get('canvas.json', {}).get('page'),
                 *source.get('reference_images', [])] if p}
    # input/ 是绑定的原始漫画副本；外部素材和项目素材库从不作为删除目标。
    protected.update(p.resolve() for p in (root / 'input').rglob('*') if p.is_file())
    # 导入单格也可能是原始素材；仅 source/panels/ 中的预处理裁图属于派生产物。
    protected.update(source_path(p['image']) for p in panels.values()
                     if not source_path(p['image']).is_relative_to(root / 'source/panels'))
    deletes, updates = set(), {}

    def add(path):
        path = root / path
        if path.is_dir() and not path.is_symlink():
            for child in path.rglob('*'):
                if child.is_file():
                    add(child)
            return
        if not path.is_file():
            return
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('产物路径超出当前运行，不能删除')
        path = path.resolve()
        if path.resolve() not in protected and path != root / '.run.lock':
            deletes.add(str(path.relative_to(root)))

    def glob(pattern):
        for path in root.glob(pattern):
            add(path)

    if clear_source or remove_panels:
        for key in remove_panels:
            image = Path(panels[key]['image'])
            image = image if image.is_absolute() else root / 'source' / image
            if image.resolve().is_relative_to(root):
                add(image)
        if clear_source or remove_panels == set(panels):
            add('source')
            add('preprocessing.json')
        else:
            # 来源清单是剩余分格的输入真相；修改它后保留分格不可与旧签名混用，
            # 因此同时撤销来源签名、角色与下游，后续需显式重新规划。
            for name in ('source/manifest.json', 'source/prepared.json'):
                if name in records:
                    value = deepcopy(records[name])
                    value['panels'] = [p for p in value.get('panels', []) if p['panel_id'] not in remove_panels]
                    value['transcript'] = '\n\n'.join(p.get('text', '') for p in value['panels'])
                    updates[name] = value
            if 'source/editor.json' in records:
                value = deepcopy(records['source/editor.json'])
                if 'panels' in value:
                    value['panels'] = [p for index, p in enumerate(value['panels'])
                                       if p.get('panel_id', list(panels)[index] if index < len(panels) else '') not in remove_panels]
                    updates['source/editor.json'] = value
            add('source/input_signature.json')
            add('source/characters.json')
    if clear_plan:
        glob('iter*')
        for name in ('production.json', 'planning_state.json', 'planning_draft.json', 'planning_start.json',
                     'revision_base.json', 'planning_pause.json', 'source/characters.json', 'source/prepared.json'):
            add(name)
            updates.pop(name, None)
    elif changed_plan:
        # 不让旧完整检查点或候选将已删结果在下一次恢复时重新带回来。
        value = deepcopy(current)
        value.pop('source', None)
        if remove_shots:
            remaining = [s for s in shots.values() if s['shot_id'] not in remove_shots]
            value['shot_list'] = {**current['shot_list'], 'shots': remaining} if remaining else None
        value['directions'] = [d for d in value.get('directions', []) if d['shot_id'] not in remove_shots]
        value['assets'] = [a for a in value.get('assets', []) if a['keyframe_id'] not in remove_frames]
        affected = remove_shots | {assets[k]['shot_id'] for k in remove_frames}
        value['reviews'] = [r for r in value.get('reviews', []) if r.get('scope') not in
                            ({f'storyboard:{s}' for s in affected} | {f'direction:{s}' for s in remove_shots})
                            and not (remove_shots and r.get('scope') == 'arrangement')]
        target = 'script' if dirty_plan else 'arrangement' if remove_shots else 'storyboard'
        value['reviews'].append({'scope': target, 'accepted': False, 'winner_id': 'deleted',
            'reason': '生成结果已由用户永久删除，需要显式重跑并重新审查',
            'issues': [{'target': target, 'location': 'all', 'severity': 'blocking',
                        'evidence': '对应生成结果已删除', 'suggestion': '重新生成并完成审查'}]})
        updates['planning_draft.json'] = value
        for name in ('production.json', 'planning_state.json', 'revision_base.json', 'planning_pause.json', 'planning_start.json'):
            add(name)
        glob('iter*/selected.json')
        glob('iter*/draft.json')
        for shot in remove_shots:
            glob(f'iter*/storyboard/{shot}')
            glob(f'iter*/reviews/storyboard/{shot}')
            glob(f'iter*/direction/{shot}')
            glob(f'iter*/direction/{shot}.*')
            glob(f'iter*/reviews/direction/{shot}*')
        if remove_shots:
            glob('iter*/arrangement')
            glob('iter*/reviews/arrangement')
        for key in remove_frames:
            shot = assets[key]['shot_id']
            glob(f'iter*/storyboard/{shot}/{key}')
            glob(f'iter*/reviews/storyboard/{shot}/{key}')
            glob(f'iter*/reviews/storyboard/{shot}/sequence*')
            image = Path(assets[key]['image'])
            if not image.is_absolute():
                image = root / image
            if image.resolve().is_relative_to(root):
                add(image)
                add(image.with_suffix('.json'))
    for shot in video_shots:
        add(root / 'video' / shot)
        glob(f'video_frames/{shot}*')
    if clear_plan:
        add(root / 'video')
        add(root / 'video_frames')
    for shot, node, name, candidate, entry in video:
        if node in video_nodes and shot not in video_shots:
            # 一个 tasks.json 含多个候选；只移除所选候选和共享采用/审查结果。
            value = deepcopy(updates.get(name, records[name]))
            value['candidates'].pop(candidate, None)
            if value['candidates']:
                updates[name] = value
            else:
                add(name)
                updates.pop(name, None)
            path = Path(entry.get('path', ''))
            if path.is_absolute() and path.resolve().is_relative_to(root):
                add(path)
            glob(str(Path(name).parent / f'{candidate}.*'))
            for suffix in ('selected.json', 'review.json', 'review.input.json'):
                add(Path(name).parent / suffix)
            add(root / 'video' / shot / 'selected.mp4')
            add(root / 'video' / shot / 'shot_review.json')
    if video_shots or video_nodes or changed_plan:
        # 合并任务表与对白是整段共享记录，不能继续代表完整运行。
        add('generation_tasks.json')
        add('dialogue')
    if clear_final:
        for pattern in ('final*', 'preview*', 'subtitles*', 'export.json', 'video_review.json',
                        'visual_inspection.json', 'audio_audit.json', 'TEST_REPORT.json'):
            glob(pattern)
    for name in deletes:
        updates.pop(name, None)
    files = sorted(deletes)
    # 文件内容签名防止确认期间产物变化；预览本身不写入任何文件。
    snapshot = [(str(p.relative_to(root)), file_signature(p)) for p in sorted(root.rglob('*'))
                if p.is_file() and not p.is_symlink() and p.name != '.run.lock' and p.resolve().is_relative_to(root)]
    return {'run_dir': str(root), 'files': files, 'updates': updates,
            'remote_tasks': sum(bool(v[4].get('task_id')) for v in video if v[0] in video_shots or v[1] in video_nodes),
            'revision': signature(snapshot)}


def handle(request, *, delete=False):
    project = Path(request['project']).resolve()
    selections = request.get('selections', [])
    if not selections or len(selections) > 100:
        raise ValueError('请选择当前项目中的节点')
    roots = [Path(s['run_dir']).resolve() for s in selections]
    if len(set(roots)) != len(roots) or any(not project_run(project, p) for p in roots):
        raise ValueError('只能删除当前项目运行中的生成结果')
    for selection, root in zip(selections, roots):
        if not root.is_dir() or (root / 'EXPERIMENT.json').exists() or (root / 'simulation.json').exists():
            raise ValueError('只支持正式运行的产物删除；实验或模拟运行不能使用此操作')
        if selection.get('scope') not in ('node', 'downstream') or not selection.get('node_ids'):
            raise ValueError('删除范围无效')
        if any(not re.fullmatch(r'[A-Za-z0-9_:-]+', n) for n in selection['node_ids']):
            raise ValueError('节点标识无效')
    with ExitStack() as stack:
        # 项目锁覆盖签名检查和清理，避免与 Agent 的正式运行交叉。
        stack.enter_context(run_lock(project, 'delete_canvas_nodes'))
        if delete:
            for root in sorted(roots):
                stack.enter_context(run_lock(root, 'delete_canvas_nodes'))
        plans = [_plan(root, s['node_ids'], s['scope']) for root, s in zip(roots, selections)]
        revision = signature(plans)
        summary = {'revision': revision, 'file_count': sum(len(p['files']) for p in plans),
                   'record_count': sum(len(p['updates']) for p in plans),
                   'remote_tasks': sum(p['remote_tasks'] for p in plans),
                   'runs': [{'run_dir': p['run_dir'], 'files': p['files'], 'records': list(p['updates'])} for p in plans]}
        if not delete:
            return summary
        if request.get('expected_revision') != revision:
            raise ValueError('删除范围已变化，请关闭弹窗后重新确认')
        for plan in plans:
            root = Path(plan['run_dir'])
            try:
                # 先撤销完整计划再清文件，部分失败也不能继续用旧计划生成。
                for name in sorted(plan['files'], key=lambda n: n != 'production.json'):
                    (root / name).unlink()
                for name, value in plan['updates'].items():
                    write_json(root / name, value)
                for folder in sorted(root.rglob('*'), key=lambda p: len(p.parts), reverse=True):
                    if folder.is_dir() and not folder.is_symlink() and not any(folder.iterdir()):
                        folder.rmdir()
                from .events import emit
                emit('canvas.delete', status='completed', run_dir=str(root), message='已永久清理生成结果，原始漫画保留')
            except OSError as exc:
                raise ValueError(f'部分产物清理失败，请刷新检查剩余文件：{exc}') from exc
        return {**summary, 'message': '已永久删除生成结果；原始漫画素材保留'}
