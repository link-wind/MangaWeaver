"""将项目内画布对象解析为可复核的固定引用。"""
from pathlib import Path
from uuid import uuid4

from ..io import project_run, file_signature, read_json, signature


def objects(project, directory):
    from ..desktop import read_run
    project, directory = Path(project).resolve(), Path(directory).resolve()
    if not project_run(project, directory):
        raise ValueError('引用运行不属于当前项目')
    data = read_run(directory)
    records = {r['file']: r.get('data') for r in data['records']}
    plan = records.get('planning_draft.json') or records.get('planning_state.json') or records.get('production.json') or {}
    source = records.get('source/manifest.json') or {}
    page = data.get('book_page') or {}
    result = {}

    def add(identifier, label, stage, location, value=None, path=None):
        path = Path(path).resolve() if path else None
        if path and (not path.is_file() or path.suffix.lower() not in {'.jpg','.jpeg','.png','.webp','.mp4'}):
            raise ValueError(f'引用素材不可用：{label}')
        kind = 'image' if path and path.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'} else 'video' if path and path.suffix.lower() == '.mp4' else 'object'
        result[identifier] = {'node_id': identifier, 'label': label, 'stage': stage, 'location': location,
            'run': str(directory), 'page': page, 'kind': kind,
            'path': (str(path.relative_to(project)) if path.is_relative_to(project) else str(path)) if path else '',
            'signature': file_signature(path) if path else signature(value), 'value': value if not path else None}

    if data.get('original_page'):
        add('source', '整页漫画', 'script', 'all', path=data['original_page'])
    for panel in source.get('panels', []):
        add('panel:' + panel['panel_id'], panel['panel_id'], 'script', panel['panel_id'], path=panel['image'])
    if plan.get('script'):
        add('arrangement', '镜头规划', 'arrangement', 'all', {'script': plan['script'], 'shot_list': plan.get('shot_list')})
    for shot in (plan.get('shot_list') or {}).get('shots', []):
        add('shot:' + shot['shot_id'], shot['shot_id'], 'arrangement', shot['shot_id'], shot)
    for asset in plan.get('assets', []):
        add('frame:' + asset['keyframe_id'], asset['keyframe_id'], 'storyboard', asset['shot_id'] + ':' + asset['keyframe_id'], path=asset['image'])
    for name in ('final.mp4', 'preview.mp4'):
        if (directory / name).is_file():
            add('final', '动画预览', 'video', 'all', path=directory / name)
            break
    by_shot = {}
    for record in data['records']:
        if not record['file'].startswith('video/') or not record['file'].endswith('/tasks.json'):
            continue
        shot = record['file'].split('/')[1]
        for candidate in (record.get('data') or {}).get('candidates', {}).values():
            index = by_shot.get(shot, 0)
            by_shot[shot] = index + 1
            if candidate.get('status') == 'downloaded' and candidate.get('path'):
                add(f'video:{shot}:{index}', f'{shot} 视频', 'video', shot, path=candidate['path'])
    return result


def capture(project, directory, node_ids, purpose='reference'):
    if purpose not in {'target', 'reference'}:
        raise ValueError('未知引用用途')
    available = objects(project, directory)
    if not node_ids or len(node_ids) > 12:
        raise ValueError('请选择 1～12 个已有对象')
    if any(n not in available for n in node_ids):
        raise ValueError('该对象尚无可引用的内容，请刷新画布')
    return [dict(available[n], id=uuid4().hex, purpose=purpose) for n in dict.fromkeys(node_ids)]


def validate(project, references):
    if not isinstance(references, list) or len(references) > 12:
        raise ValueError('引用数量无效')
    result = []
    cache = {}
    identifiers = set()
    for ref in references:
        if not isinstance(ref, dict) or not isinstance(ref.get('id'), str) or len(ref['id']) > 64 or ref['id'] in identifiers:
            raise ValueError('引用标识无效或重复')
        identifiers.add(ref['id'])
        if ref.get('purpose') not in {'target', 'reference'}:
            raise ValueError('引用用途无效')
        if ref['run'] not in cache:
            cache[ref['run']] = objects(project, ref['run'])
        current = cache[ref['run']].get(ref['node_id'])
        if not current or any(current.get(k) != ref.get(k) for k in ('path', 'signature', 'kind', 'location')):
            raise ValueError(f"引用已变化或失效，请重选：{ref.get('label', '')}")
        result.append(dict(current, id=ref['id'], purpose=ref['purpose']))
    return result


def inputs(project, references):
    refs = validate(project, references)
    if any(r['kind'] == 'video' for r in refs):
        raise ValueError('当前视频引用仅支持查看；制作请指定镜头或关键画面，不能将视频直接作为修改或生成控制条件')
    return refs, [str(Path(project) / r['path']) for r in refs if r['purpose'] == 'reference' and r['kind'] == 'image']
