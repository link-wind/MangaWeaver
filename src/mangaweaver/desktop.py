"""桌面薄入口：一条请求、JSONL 事件，业务复用 CLI 与原运行目录。"""
import contextlib
import importlib.util
import json
import logging
import os
import re
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from .config import Config
from .events import subscribe
from .io import read_json, write_json, signature
from .run_lock import run_lock


class EditConflict(ValueError):
    code = 'EDIT_CONFLICT'


def check_revision(request, path):
    if 'expected_revision' not in request:
        return  # 内部制作流程沿用原协议。
    current = signature(read_json(path)) if path.exists() else None
    if request['expected_revision'] != current:
        raise EditConflict('编辑冲突：文件已被其他入口修改，草稿已保留。请重新读取后再编辑。')


def redact(value):
    text = json.dumps(value, ensure_ascii=False, default=str)
    for name, secret in os.environ.items():
        if any(word in name.upper() for word in ('KEY', 'TOKEN', 'SECRET')) and len(secret) >= 8:
            text = text.replace(secret, '[REDACTED]')
    text = re.sub(r'sk-[A-Za-z0-9_-]{12,}', '[REDACTED]', text)
    return json.loads(text)


def environment(config):
    from .clients.minimax import MiniMax
    issue = None
    try:
        MiniMax(config)  # 构造与能力检查，不发请求。
    except (ValueError, ImportError) as exc:
        issue = str(exc)
    from .preprocessing.crop_panels import MAGI_MODEL, MAGI_REVISION, OCR_MODEL, OCR_REVISION, OCR_FILES
    required = ('torch', 'torchvision', 'transformers', 'numpy', 'shapely', 'timm', 'einops', 'matplotlib', 'scipy', 'networkx')
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    magi_weights = False
    if importlib.util.find_spec('huggingface_hub'):
        from huggingface_hub import try_to_load_from_cache
        cached = try_to_load_from_cache(MAGI_MODEL, 'model.safetensors', revision=MAGI_REVISION)
        ocr = try_to_load_from_cache(OCR_MODEL, OCR_FILES[0], revision=OCR_REVISION)
        magi_weights = isinstance(cached, str) and Path(cached).is_file() and isinstance(ocr, str) and all((Path(ocr).parent / name).is_file() for name in OCR_FILES)
    keys = {'gemini': 'GEMINI_API_KEY', 'kie': 'KIE_API_KEY', 'ciyuan': 'CIYUAN_API_KEY', 'huanling': 'HUANLING_API_KEY'}
    return {
        'python': sys.executable, 'ffmpeg': shutil.which('ffmpeg'), 'ffprobe': shutil.which('ffprobe'),
        'magi': not missing, 'magi_missing': missing, 'magi_weights': magi_weights,
        'local_ocr_provider': os.getenv('LOCAL_OCR_PROVIDER', 'magi'),
        'local_ocr_ready': all(importlib.util.find_spec(n) is not None for n in ('rapidocr', 'onnxruntime')) if os.getenv('LOCAL_OCR_PROVIDER') == 'rapidocr' else magi_weights,
        'config': {k: getattr(config, k) for k in ('model_provider', 'text_model', 'image_provider', 'image_model',
                    'video_provider', 'minimax_model', 'resolution', 'target_duration', 'huanling_text_api', 'huanling_text_transport')},
        'text_credential': bool(os.getenv(keys.get(config.model_provider, 'GEMINI_API_KEY'))),
        'video_blocker': issue,
    }


def original_page(directory, source=None, canvas=None):
    """只使用明确的整页来源，不把第一格当作整页。"""
    directory = Path(directory).resolve()
    source = source or {}
    panels = [Path(p['image']).resolve() for p in source.get('panels', [])]
    candidates = list((directory / 'input').glob('page.*'))
    if canvas and canvas.get('page'):
        candidate = Path(canvas['page']).resolve()
        if candidate not in panels:
            candidates.append(candidate)
    for folder in dict.fromkeys([directory / "source", *(p.parent for p in panels)]):
        for name, key in [('editor.json', 'page'), ('selection.json', 'original')]:
            metadata = folder / name
            if metadata.is_file():
                value = read_json(metadata).get(key)
                if isinstance(value, str):
                    candidates.append((folder / value).resolve())
    return next((str(p.resolve()) for p in candidates if p.is_file()), '')


def read_run(directory):
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ValueError('运行目录不存在，请重新定位')
    records = []
    names = {'production.json', 'planning_state.json', 'planning_draft.json', 'prepared.json', 'manifest.json',
             'selected.json', 'draft.json', 'review.json', 'shot_review.json', 'tasks.json', 'generation_tasks.json',
             'video_review.json', 'visual_inspection.json', 'TEST_REPORT.json', 'EXPERIMENT.json', 'export.json',
             'preview_export.json', 'subtitles.json', 'preview_subtitles.json', 'selected_track.json',
             'scene_selected.json', 'scene_review.json', 'audio_audit.json', 'canvas.json', 'planning_pause.json', 'preprocessing.json'}
    for path in sorted(directory.rglob('*.json')):
        if path.name not in names or not path.resolve().is_relative_to(directory) or path.stat().st_size > 10_000_000:
            continue
        try:
            value = read_json(path)
            records.append({'file': str(path.relative_to(directory)), 'data': value, 'revision': signature(value)})
        except (ValueError, OSError):
            records.append({'file': str(path.relative_to(directory)), 'error': '无法读取该记录'})
    media = [str(p.resolve()) for p in sorted(directory.rglob('*'))
             if p.is_file() and p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.mp4', '.srt'}
             and p.resolve().is_relative_to(directory)]
    source = next((r.get('data') for r in records if r['file'] == 'source/manifest.json'), {})
    canvas = next((r.get('data') for r in records if r['file'] == 'canvas.json'), {})
    page = original_page(directory, source, canvas)
    from .events import read_log
    from .agent.tasks import load as load_tasks
    return {'workflow': load_tasks(directory) if (directory / 'simulation.json').exists() else None,
            'book_page': read_json(directory / 'input/book.json') if (directory / 'input/book.json').exists() else None,
            'simulation': read_json(directory / 'simulation.json') if (directory / 'simulation.json').exists() else None,
            'events': read_log(directory), 'directory': str(directory), 'original_page': page, 'experimental': (directory / 'EXPERIMENT.json').exists(),
            'records': records, 'media': media,
            'canvas_revision': next((r.get('revision') for r in records if r['file'] == 'canvas.json'), None)}


def read_source(path):
    from .preprocessing.transcript import load_source
    value = read_json(Path(path))
    source = load_source(Path(path), value)
    editor_path = Path(path).parent / 'editor.json'
    editor = read_json(editor_path) if editor_path.is_file() else None
    if editor:
        editor['page'] = str((editor_path.parent / editor['page']).resolve())
    return {'source': source.model_dump(mode='json'), 'editor': editor, 'revision': signature(value)}


def revise_source(request):
    path = Path(request['source']).resolve()
    with run_lock(path.parent.parent if path.parent.name == 'source' else path.parent, 'revise_source'):
        check_revision(request, path)
        return _revise_source(request)


def _revise_source(request):
    from .preprocessing.transcript import load_source
    source = load_source(Path(request['source']))
    updates = request['panels']
    if [p['panel_id'] for p in updates] != [p.panel_id for p in source.panels]:
        raise ValueError('修订必须保留来源格身份与顺序')
    project = Path(request['project']).resolve()
    version = project / 'sources' / uuid4().hex[:12]
    version.mkdir(parents=True)
    panels = []
    for panel, update in zip(source.panels, updates, strict=True):
        target = version / (panel.panel_id + panel.image.suffix)
        shutil.copyfile(panel.image, target)
        panels.append(panel.model_copy(update={'image': target, 'text': str(update['text'])}))
    result = source.model_copy(update={'panels': panels, 'transcript': '\n\n'.join(f'{p.panel_id}\n{p.text}' for p in panels)})
    manifest = write_json(version / 'manifest.json', result)
    load_source(manifest)
    return {'manifest': str(manifest), 'panels': len(panels)}


def save_source(request):
    if request.get('base_source'):
        path = Path(request['base_source']).resolve()
        with run_lock(path.parent.parent if path.parent.name == 'source' else path.parent, 'save_source'):
            check_revision(request, path)
            return _save_source(request)
    return _save_source(request)


def _save_source(request):
    from PIL import Image
    from .preprocessing.transcript import load_source
    from .schemas import Panel, SourceManifest
    project = Path(request['project']).resolve()
    if not (project / 'project.json').is_file():
        raise ValueError('请先打开项目')
    version = project / 'sources' / uuid4().hex[:12]
    version.mkdir(parents=True)
    page = Path(request['page']).resolve()
    panels = []
    with Image.open(page) as original:
        image = original.convert('RGB')
        image.save(version / 'page.png')
        for i, entry in enumerate(request['panels'], 1):
            bbox = entry['bbox']
            if len(bbox) != 4 or any(type(n) is not int for n in bbox):
                raise ValueError('裁图坐标必须为四个整数')
            x1, y1, x2, y2 = bbox
            if not (0 <= x1 < x2 <= image.width and 0 <= y1 < y2 <= image.height):
                raise ValueError('分格矩形超出页面或面积为空')
            name = f'p{i:03}.png'
            image.crop(tuple(bbox)).save(version / name)
            speaker = str(entry.get('speaker', '')).strip()
            text = str(entry.get('text', ''))
            panels.append(Panel(panel_id=f'p{i:03}', page_id='page001', image=Path(name), bbox=bbox,
                                text=(f'{speaker}：{text}' if speaker else text)))
    source = SourceManifest(case_id='case', panels=panels)
    manifest = write_json(version / 'manifest.json', source)
    load_source(manifest)
    write_json(version / 'editor.json', {'page': 'page.png', 'panels': request['panels']})
    return {'manifest': str(manifest), 'page': str(version / 'page.png'), 'panels': len(panels)}


def resume_downloads(config, run_dir):
    """恢复只查已知任务并下载；不调用生成、台词翻译或评审。"""
    from .clients.minimax import MiniMax
    from .events import emit
    paths = sorted(run_dir.glob('video/*/*/tasks.json'))
    if not paths:
        raise ValueError('没有可恢复的正式任务记录；实验任务仅供查看')
    states = [(p, read_json(p)) for p in paths]
    for _, state in states:
        if any(not e.get('task_id') for e in state['candidates'].values()):
            raise ValueError('存在提交结果不明的任务，请先在平台核查；不会自动重交')
    pending = [(p, state, e) for p, state in states for e in state['candidates'].values() if e['status'] != 'downloaded']
    if not pending:
        return {'message': '已有任务均已下载；恢复未产生任何网络请求'}
    client = MiniMax(config)
    for path, state, entry in pending:
        emit('video.query', task_id=entry['task_id'])
        result = client.poll(entry['task_id'])
        entry.update(result=result, status='succeeded')
        write_json(path, state)
        target = Path(entry['path']).resolve()
        if not target.is_relative_to(run_dir):
            raise ValueError('任务下载目标必须在原运行目录内')
        client.download(result['content']['url'], target)
        entry['status'] = 'downloaded'
        write_json(path, state)
    return {'message': '已恢复下载；如需继续评审与剪辑，请显式执行生成流程'}


def validate_view(value):
    from pydantic import BaseModel, ConfigDict, Field
    from typing import Literal
    class Viewport(BaseModel):
        model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
        x: float
        y: float
        zoom: float = Field(ge=0.15, le=1.6)
    class PageView(BaseModel):
        model_config = ConfigDict(extra='forbid')
        viewport: Viewport | None = None
        selected: str | None = None
    class Workspace(BaseModel):
        model_config = ConfigDict(extra='forbid')
        mode: Literal['overview', 'page']
        page_id: str | None = None
    class View(BaseModel):
        model_config = ConfigDict(extra='forbid')
        collapsed_groups: list[str] = Field(default_factory=list)
        collapsed_pages: list[str] = Field(default_factory=list)
        book_collapsed: bool = False
        positions: dict[str, dict[str, float]] = Field(default_factory=dict)
        workspace: Workspace | None = None
        page_views: dict[str, PageView] = Field(default_factory=dict)
        composer: dict = Field(default_factory=dict)
    # 旧版隐藏仅为视图状态；不再应用，也不将它解释为产物删除。
    data = View.model_validate({k: v for k, v in value.items() if k != 'hidden_nodes'}).model_dump()
    for field in ('workspace', 'page_views', 'composer'):
        if field not in value:
            data.pop(field, None)
    for point in data['positions'].values():
        if set(point) != {'x', 'y'} or not all(__import__('math').isfinite(n) for n in point.values()):
            raise ValueError('画布位置无效')
    return data


def save_canvas(request):
    from pydantic import BaseModel, ConfigDict, Field
    from typing import Literal

    class Message(BaseModel):
        model_config = ConfigDict(extra="forbid")
        id: str
        role: Literal["user", "assistant"]
        text: str = Field(max_length=20000)
        target: str = "all"
        stage: str = "script"
        status: Literal["draft", "submitted", "completed", "failed"] = "draft"
        created_at: str = ""
        references: list[dict] = Field(default_factory=list)
        run: str = ""
        page_id: str = ""
        turn_id: str = ""
        delivery: Literal["steer", "follow_up"] = "steer"

    class Canvas(BaseModel):
        model_config = ConfigDict(extra="forbid")
        version: Literal[1] = 1
        page: str = ""
        prompt: str = Field(default="", max_length=20000)
        draft: str = Field(default="", max_length=20000)
        draft_node: str = ''
        draft_references: list[dict] = Field(default_factory=list)
        draft_delivery: Literal['steer', 'follow_up'] = 'steer'
        draft_page_id: str = ''
        draft_run: str = ''
        positions: dict[str, dict[str, float]] = Field(default_factory=dict)
        messages: list[Message] = Field(default_factory=list)
        view: dict = Field(default_factory=dict)

    run_dir = Path(request['run_dir']).resolve()
    data = Canvas.model_validate(request['canvas'])
    data.view = validate_view(data.view)
    for position in data.positions.values():
        if set(position) != {"x", "y"} or not all(__import__('math').isfinite(n) for n in position.values()):
            raise ValueError("画布位置无效")
    path = run_dir / 'canvas.json'
    with run_lock(run_dir, 'save_canvas'):
        check_revision(request, path)
        if path.exists():
            previous = read_json(path)
            if previous['page'] != data.page or previous['prompt'] != data.prompt:
                raise ValueError('初始漫画和提示词已绑定；请通过节点反馈修订，或创建新运行更换输入')
        write_json(path, data)
    return {**data.model_dump(mode='json'), **({'revision': signature(data.model_dump(mode='json'))} if 'expected_revision' in request else {})}


def start_canvas(request):
    from .preprocessing.transcript import load_source
    from .cli import _record_source
    run_dir = Path(request['run_dir']).resolve()
    prompt = str(request.get('prompt', '')).strip()
    if len(prompt) > 20000:
        raise ValueError('提示词不能超过 20000 字符')
    if (run_dir / 'canvas.json').exists() or (run_dir / 'source/manifest.json').exists():
        raise ValueError('该运行已有输入，请创建新运行')
    page = str(Path(request['page']).resolve()) if request.get('page') else ''
    if page:
        original = Path(page)
        target = run_dir / 'input' / ('page' + original.suffix.lower())
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        page = str(target)
    if request.get('manifest'):
        source = load_source(Path(request['manifest']))
        source = source.model_copy(update={'creative_brief': prompt})
        with run_lock(run_dir, 'start_canvas'):
            _record_source(run_dir, source)
        page = page or original_page(run_dir, source.model_dump(mode='json'))
    elif not page or not Path(page).is_file():
        raise ValueError('请先选择漫画页或来源清单')
    result = save_canvas({'run_dir': str(run_dir), 'canvas': {
        'version': 1, 'page': page, 'prompt': prompt, 'draft': '', 'positions': {},
        'messages': [{'id': uuid4().hex, 'role': 'user', 'text': prompt or '请将这页漫画改编为彩色动画。',
                      'stage': 'script', 'target': 'all', 'status': 'submitted'}],
    }})
    if request.get('from_run'):
        metadata = Path(request['from_run']) / 'input/book.json'
        if metadata.is_file():
            write_json(run_dir / 'input/book.json', read_json(metadata))
    return result


def fork_canvas(request):
    from .preprocessing.transcript import load_source
    from .cli import _record_source
    previous = Path(request['from_run']).resolve()
    current = Path(request['run_dir']).resolve()
    if previous == current or any(current.iterdir()):
        raise ValueError('修订目标必须是新的空运行目录')
    state_file = next((previous / name for name in ['planning_draft.json', 'planning_state.json', 'production.json'] if (previous / name).exists()), None)
    if state_file is None:
        raise ValueError('没有可复用的规划检查点')
    prepared = previous / 'source/prepared.json'
    source = load_source(prepared if prepared.exists() else previous / 'source/manifest.json')
    data = read_json(state_file)
    if data.get('source'):
        data['source'] = source.model_dump(mode='json')
    canvas = read_json(previous / 'canvas.json') if (previous / 'canvas.json').exists() else {
        'version': 1, 'page': original_page(previous, source.model_dump(mode='json')), 'prompt': source.creative_brief,
        'draft': '', 'positions': {}, 'messages': [],
    }
    with run_lock(current, 'fork_canvas'):
        from .io import file_signature
        for index, asset in enumerate(data.get('assets', []), 1):
            image = (previous / asset['image']).resolve()
            if file_signature(image) != asset['image_signature']:
                raise ValueError(f"保留关键画面已改变，请先重新审查：{image.name}")
            target = current / 'retained' / f'frame_{index:04d}{image.suffix.lower()}'
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(image, target)
            asset['image'] = str(target)
        _record_source(current, source)
        write_json(current / ('planning_draft.json' if state_file.name == 'planning_draft.json' else 'planning_state.json'), data)
        if (previous / 'input/book.json').is_file():
            write_json(current / 'input/book.json', read_json(previous / 'input/book.json'))
    return save_canvas({'run_dir': str(current), 'canvas': canvas})


def _dispatch(request):
    command = request['command']
    if command == 'read_agent_harness':
        from .agent.harness import STAGES
        return {'stages': STAGES}
    if command == 'import_material':
        from .preprocessing.import_manga import import_manga
        return import_manga(request['project'], request['source'])
    if command == 'create_simulation':
        from .desktop_simulation import create
        return create(request['run_dir'], creative=request.get('creative', False))
    if request.get('run_dir') and (Path(request['run_dir']) / 'simulation.json').exists():
        if command == 'simulate':
            from .desktop_simulation import run
            return run(request['run_dir'])
        if command not in {'read_run', 'save_canvas'}:
            raise ValueError('模拟任务仅用于本地界面测试，不能调用正式制作或创作 Agent')
    elif command == 'simulate':
        raise ValueError('请从首页创建模拟任务，不可在正式运行中执行模拟')
    if command == 'save_book_view':
        from .agent.pages import view_path
        value = validate_view(request['view'])
        write_json(view_path(request['project'], request['book_id']), value)
        return value
    if command == 'load_book_pages':
        from .preprocessing.import_manga import load_pages
        book_id = request.get('book_id')
        if not isinstance(book_id, str) or not book_id.startswith('book-') or '/' in book_id or '..' in book_id:
            raise ValueError('无效书籍')
        # 缓存解页不修改会话或生产产物，使用书目录锁，允许制作期间浏览。
        with run_lock(Path(request['project']) / 'sources' / book_id, command):
            return load_pages(request['project'], book_id, request['pages'])
    if command == 'interrupt_workflow':
        from .agent.tasks import interrupt
        return interrupt(request['project'])
    if command == 'capture_references':
        from .agent.references import capture
        return {'references': capture(request['project'], request['run_dir'], request['node_ids'], request.get('purpose', 'reference'))}
    if command in {'submit_message', 'withdraw_message', 'submit_revision', 'withdraw_revision'}:
        from .agent.tasks import submit
        return submit(request)
    if command in {'agent_answer', 'agent_compact', 'agent_fork', 'agent_switch_branch', 'agent_follow_up', 'agent_resume_task', 'agent_next_batch', 'agent_message', 'agent_continue', 'agent_select_page', 'agent_open_pages', 'agent_run_stage', 'read_session'}:
        from .agent.loop import handle
        result = handle(request)
        from .events import read_log
        from .agent.tasks import view as task_view
        from .agent.conversation import view as conversation_view
        result = {**result, **task_view(request['project'], result), **conversation_view(request['project']), 'events': read_log(request['project'])}
        result['events']=[e for e in result['events'] if e.get('branch_id','main')==result.get('branch_id','main')]
        if command != 'read_session':
            from .agent.messages import ready
            result['pending'] = ready(request['project'], result)
        if result.get('active_book_id'):
            from .agent.tools import book_for
            from .agent.pages import page_runs, read_view
            indexed = page_runs(Path(request['project']), result)
            summaries = {}
            for path in indexed.values():
                folder = Path(path)
                summaries[path] = next((label for name, label in [('final.mp4', '已有成片'), ('production.json', '规划已完成'),
                    ('planning_draft.json', '规划中'), ('source/manifest.json', '分格已完成')] if (folder / name).is_file()), '待处理')
            result = {**result, 'book': book_for(Path(request['project']), result),
                      'page_runs': indexed, 'page_status': summaries,
                      'book_view': read_view(request['project'], result['active_book_id'])}
        return result
    if command == 'fork_canvas':
        return fork_canvas(request)
    if command == 'start_canvas':
        return start_canvas(request)
    if command == 'save_canvas':
        return save_canvas(request)
    if command in {'preview_canvas_delete', 'delete_canvas_nodes'}:
        from .desktop_delete import handle
        return handle(request, delete=command == 'delete_canvas_nodes')
    if command == 'read_candidates':
        from .desktop_candidates import candidates
        return candidates(request['run_dir'], request['keyframe'])
    if command == 'adopt_candidate':
        from .desktop_candidates import adopt
        return adopt(request)
    if command == 'read_run':
        return read_run(request['run_dir'])
    if command == 'read_source':
        return read_source(request['source'])
    if command == 'save_source':
        return revise_source(request) if request.get('source') else save_source(request)
    config = Config.load(Path(request['env_file']) if request.get('env_file') else None)
    if command == 'environment':
        return environment(config)
    if command not in {'preprocess', 'plan', 'generate', 'resume', 'redo', 'assemble'}:
        raise ValueError('未知桌面命令')
    from .cli import parser, execute
    run_dir = Path(request['run_dir']).resolve()
    if (run_dir / 'EXPERIMENT.json').exists():
        raise ValueError('历史实验只读；没有正式生成入口')
    if command == 'resume':
        from .cli import _record_config
        with run_lock(run_dir, command):
            _record_config(run_dir, config)
            return resume_downloads(config, run_dir)
    argv = [command, '--run-dir', str(run_dir)]
    if command == 'preprocess':
        if request.get('manifest'):
            argv += ['--manifest', request['manifest']]
        else:
            argv += ['--page', request['page']]
    elif command == 'plan':
        if any(run_dir.glob('video/*/*/tasks.json')):
            raise ValueError('已有视频任务；修改规划请创建新运行，旧任务保持绑定旧计划')
        if request.get('source'):
            argv += ['--source', request['source']]
        if request.get('from_stage'):
            argv += ['--from-stage', request['from_stage'], '--feedback', request.get('feedback', '')]
        else:
            argv += ['--resume']
            if request.get('feedback'):
                argv += ['--feedback', request['feedback']]
    elif command == 'redo':
        argv += ['--segment', request.get('segment', ''), '--feedback', request.get('feedback', '')]
    elif request.get('dry_run'):
        argv += ['--dry-run']
    if command == 'plan':
        pause = run_dir / 'planning_pause.json'
        if pause.exists() and not request.get('from_stage'):
            stages = ['script', 'arrangement', 'direction', 'storyboard']
            last = read_json(pause)['after_stage']
            next_stage = stages[min(stages.index(last) + 1, 3)]
            argv += ['--from-stage', next_stage]
        if request.get('until_stage'):
            argv += ['--until-stage', request['until_stage']]
        if request.get('location'):
            argv += ['--location', request['location']]
    args = parser().parse_args(argv)
    with run_lock(run_dir, command):
        if command == 'preprocess' and (run_dir / 'canvas.json').is_file():
            from .preprocessing.transcript import load_source
            from .cli import _record_source
            if args.manifest:
                source = load_source(args.manifest)
                source = source.model_copy(update={'creative_brief': read_json(run_dir / 'canvas.json').get('prompt', '')})
                _record_source(run_dir, source)
                args.manifest = run_dir / 'source/manifest.json'
        execute(args, config, run_dir)
        if command == 'preprocess' and (run_dir / 'canvas.json').is_file() and not args.manifest:
            from .preprocessing.transcript import load_source
            source = load_source(run_dir / 'source/manifest.json')
            source = source.model_copy(update={'creative_brief': read_json(run_dir / 'canvas.json').get('prompt', '')})
            # 自动预处理在同一原子操作内首次绑定 brief；尚无规划与生成。
            (run_dir / 'source/input_signature.json').unlink(missing_ok=True)
            from .cli import _record_source
            _record_source(run_dir, source)
        from .events import artifact
        for name in ("source/manifest.json", "production.json", "generation_tasks.json", "final.mp4"):
            if (run_dir / name).exists():
                artifact(run_dir / name)
    return {'directory': str(run_dir)}


def dispatch(request):
    from .events import bind_run
    if request.get('run_dir') and request.get('command') not in {'agent_message', 'agent_continue', 'agent_select_page', 'read_session'}:
        with bind_run(Path(request['run_dir']).resolve()):
            return _dispatch(request)
    return _dispatch(request)


def main():
    output = sys.stdout
    request = {}
    stage = 'starting'
    sequence = 0
    current_run = None

    def send(kind, current=None, data=None):
        nonlocal stage, sequence, current_run
        from datetime import datetime, timezone
        stage = current or stage
        sequence += 1
        payload = redact(data or {})
        current_run = payload.pop("run_dir", None) or current_run or request.get("run_dir")
        actual_run = current_run
        event = {'version': 1, 'request_id': request.get('request_id'), 'run_dir': actual_run,
                 'id': f"{request.get('request_id')}:{sequence}", 'timestamp': datetime.now(timezone.utc).isoformat(),
                 'type': kind, 'stage': stage, 'data': payload}
        from .agent.conversation import current as current_conversation
        if current_conversation():
            event['branch_id']=current_conversation().branch_id
        if request.get('command') in {'simulate', 'preprocess', 'plan', 'generate', 'resume', 'agent_message', 'agent_continue', 'agent_select_page', 'agent_run_stage', 'load_book_pages'} or (request.get('command') == 'delete_canvas_nodes' and current == 'canvas.delete'):
            folders = {str(p) for p in [actual_run, request.get('project')] if p}
            for folder in folders:
                target = Path(folder) / 'runtime_events.jsonl'
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('a', encoding='utf-8') as stream:
                    # 完成结果仍通过协议返回；日志只保留状态，避免把产物与历史递归写入。
                    stored = {**event, 'data': ({'message': payload.get('message', '')} if kind == 'completed' else payload)}
                    stream.write(json.dumps(stored, ensure_ascii=False) + '\n')
        output.write(json.dumps(event, ensure_ascii=False) + '\n')
        output.flush()
    try:
        request = json.loads(sys.stdin.readline())
        if request.get('command','').startswith('agent_') and request.get('conversation_protocol') != 1:
            raise ValueError('客户端不支持当前会话协议，请更新客户端后继续；未写入会话')
        send('started', request.get('command', 'starting'))
        # 人类输出和日志绝不混入 stdout 协议；不转发未经脱敏的诊断给页面。
        with contextlib.redirect_stdout(sys.stderr), subscribe(send):
            logging.basicConfig(level=logging.WARNING)
            result = dispatch(request)
        send('completed', data=result)
        return 0
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        message = '命令参数无效，请检查输入和制作阶段' if isinstance(exc, SystemExit) else '模拟任务已停止，可点击运行继续' if request.get('command') == 'simulate' and isinstance(exc, KeyboardInterrupt) else str(exc) or '本地执行已停止；远端任务可能仍在运行'
        send('failed', data={'code': getattr(exc, 'code', None), 'message': message, 'status': 'interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
