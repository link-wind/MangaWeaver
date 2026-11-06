"""仅用于客户端交互验收的本地演示，不创建模型客户端或远端任务。"""
import shutil
import subprocess
import time
from pathlib import Path

from .events import artifact, emit
from .io import read_json, write_json
from .run_lock import run_lock

FIXTURE = Path(__file__).resolve().parents[2] / 'examples/cross-panel'
CREATIVE_FIXTURE = FIXTURE.parent / 'creative-demo'


def _ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *map(str, args)], check=True, capture_output=True)


def create(directory, creative=False):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError('模拟任务必须使用新的空目录')
    page = directory / ('input/page.jpg' if creative else 'input/page.png')
    page.parent.mkdir()
    if creative:
        fixture = read_json(CREATIVE_FIXTURE/'production.json')
        shutil.copyfile(CREATIVE_FIXTURE/fixture['page'], page)
    else:
        _ffmpeg('-i', FIXTURE/'images/entry.png', '-i', FIXTURE/'images/impact.png',
                '-i', FIXTURE/'images/reaction.png', '-filter_complex',
                '[0:v][1:v][2:v]vstack=inputs=3,scale=640:-1', '-frames:v', '1', page)
    write_json(directory/'simulation.json', {'step': 0, 'completed': False, 'label': '创作演示' if creative else '模拟任务',
                                            'preset': 'creative' if creative else 'cross-panel', 'api_calls': 0})
    if creative:
        write_json(directory/'project.json', {'version': 1, 'name': '创作演示 · 第 94 页', 'runs': ['.'], 'sources': [], 'pages': []})
    from .agent.tasks import now
    write_json(directory/'canvas.json', {'version': 1, 'page': str(page),
        'prompt': '本地预设演示：漫画分格 → 镜头编排 → 关键画面 → 视频审查 → 历史预览，不调用 API。',
        'draft': '', 'positions': {}, 'messages': [
            {'id': 'demo-request', 'role': 'user', 'text': '将这一页做成彩色动画，保留对话里的停顿，日语配音和中文字幕。',
             'created_at': now(), 'references': [
                 {'id': 'demo-page', 'node_id': 'source', 'label': '第 094 页', 'purpose': 'reference',
                  'run': str(directory), 'kind': 'image', 'path': str(page.relative_to(directory)), 'signature': 'local-demo',
                  'location': 'all', 'stage': 'script'}]},
            {'id': 'demo-plan', 'role': 'assistant', 'text': '正在准备本地演示，不调用模型。', 'created_at': now()}
        ] if creative else []})
    return {'directory': str(directory)}


def run(directory, delay=2):
    """固定本地步骤，沿用同一 JSONL 事件与产物刷新通道；停止后从已完成步骤继续。"""
    directory = Path(directory).resolve()
    with run_lock(directory, 'simulate'):
        state = read_json(directory/'simulation.json')
        creative = state.get('preset') == 'creative'
        fixture_root = CREATIVE_FIXTURE if creative else FIXTURE
        from .agent import tasks
        root_id = state.get('task_id')
        if not root_id:
            root_id = tasks.create(directory, {'active_run': str(directory)}, '模拟 · 漫画制作', 'video', origin='simulation')
            state['task_id'] = root_id
            write_json(directory/'simulation.json', state)
        tasks.update(directory, root_id, status='running', summary='本地预设演示 · 不调用模型')
        if state['completed']:
            return {'directory': str(directory), 'message': '模拟任务已完成，可从首页创建新的模拟任务'}
        state['paused'] = False
        fixture = read_json(fixture_root/'production.json')
        source_path = directory/'source/manifest.json'
        draft_path = directory/'planning_draft.json'

        def panel(index):
            source = read_json(source_path) if source_path.exists() else {**fixture['source'], 'panels': []}
            entry = dict(fixture['source']['panels'][index])
            target = directory/'source/panels'/f"{entry['panel_id']}{Path(entry['image']).suffix}"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fixture_root/entry['image'], target)
            entry['image'] = str(target)
            source['panels'] = [p for p in source['panels'] if p['panel_id'] != entry['panel_id']] + [entry]
            write_json(source_path, source)

        def planning(key):
            data = read_json(draft_path) if draft_path.exists() else {'source': read_json(source_path), 'assets': [], 'reviews': []}
            data[key] = fixture[key]
            write_json(draft_path, data)

        def frame(asset):
            target = directory/'frames'/f"{asset['keyframe_id']}{Path(asset['image']).suffix}"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fixture_root/asset['image'], target)
            data = read_json(draft_path)
            data['assets'] = [a for a in data['assets'] if a['keyframe_id'] != asset['keyframe_id']] + [{**asset, 'image': str(target)}]
            write_json(draft_path, data)

        def video_state(shot, ready=False):
            folder = directory/'video'/shot['shot_id']/'simulation'
            folder.mkdir(parents=True, exist_ok=True)
            path = folder/'simulation.mp4'
            if ready:
                if creative:
                    shutil.copyfile(fixture_root/fixture['videos'][shot['shot_id']], path)
                else:
                    image = next(a['image'] for a in read_json(draft_path)['assets'] if a['shot_id'] == shot['shot_id'])
                    _ffmpeg('-loop', '1', '-i', image, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                            '-t', shot['duration'], '-vf', 'scale=640:360', '-r', '24', '-c:v', 'libx264',
                            '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path)
            write_json(folder/'tasks.json', {'simulated': True, 'candidates': {'local_example': {
                'status': 'downloaded' if ready else 'simulating', 'path': str(path), 'simulated': True}}})

        def assemble():
            if creative:
                output = directory/'simulation.mp4'
                shutil.copyfile(fixture_root/fixture['preview'], output)
                artifact(output)
                message('demo-finished', '演示完成。可以播放历史预览，或切换到“协作”查看 Creator／Reviewer 的交接和修订过程。'
                        '镜头 03 的问题仍保留；本次只回放已有素材，没有实际重生成，也没有调用模型。')
                return
            from .generation.assembly import assemble as join
            paths = [directory/'video'/s['shot_id']/'simulation/simulation.mp4' for s in fixture['shot_list']['shots']]
            output = join(paths, directory/'.simulation-building.mp4')
            output = output.replace(directory/'simulation.mp4')
            artifact(output)

        def message(identifier, text):
            """沿用画布消息与产物刷新，逐段呈现预设公开回复，不伪装模型输出。"""
            from .agent.tasks import now
            canvas = read_json(directory/'canvas.json')
            messages = canvas.setdefault('messages', [])
            item = next((m for m in messages if m['id'] == identifier), None)
            if item is None:
                item = {'id': identifier, 'role': 'assistant', 'text': '', 'created_at': now()}
                messages.append(item)
            for end in range(16, len(text)+16, 16):
                item['text'] = text[:end]
                write_json(directory/'canvas.json', canvas)
                artifact(directory/'canvas.json')
                time.sleep(delay / 8)

        def review_video():
            from uuid import uuid4
            for shot in fixture['shot_list']['shots']:
                target = shot['shot_id']
                for role in ('Creator', 'Reviewer'):
                    rejected = target == 's003' and role == 'Reviewer'
                    emit('professional', status='completed', activity_id=uuid4().hex,
                         actor=f'video.{role.lower()}', role=role, professional_stage='video',
                         target=target, iteration=0, simulated=True,
                         message='本地预设审查：1 项需修订' if rejected else '本地预设：展示已有视频',
                         **({'accepted': not rejected, 'issues': [{
                             'target': 'video', 'location': 's003/00:00.7',
                             'evidence': '【本地预设反馈】镜头 03 在 00:00.7 发生了意外硬切，入间被挤出画面，打断了道歉时的表情和口型。',
                             'suggestion': '保持双人近景，完整呈现入间的道歉，不在中途切换机位。'
                         }] if rejected else []} if role == 'Reviewer' else {}))
            plan = read_json(draft_path)
            plan['reviews'] = [{'scope': 'video', 'accepted': False, 'issues': [
                {'target': 'video', 'location': 's003', 'evidence': '本地预设：00:00.7 意外硬切', 'suggestion': '保持双人近景。'}]}]
            write_json(draft_path, plan)
            write_json(directory/'preview_export.json', {'status': 'not_approved', 'simulated': True,
                'rejected_segments': ['s003'], 'review_sources': {'s003': {'report': {
                    'accepted': False, 'reason': '本地预设：00:00.7 意外硬切'}}}})
            message('demo-review', '本地演示在审查处暂停。你可以展开协作、定位镜头 03 或查看过程。'
                    '点击右上角“继续演示”将展示已有的整页视频预览；该预览保留原问题，不会冒充修订通过。')

        steps = [('magi.load', '准备本地示例', lambda: None, {})]
        for i, p in enumerate(fixture['source']['panels']):
            steps.append(('magi.detect', f"分格 {i+1}/{len(fixture['source']['panels'])}", lambda i=i: panel(i), {'panel_id': p['panel_id']}))
        steps += [('magi.ocr', '读取示例文字', lambda: None, {}),
                  ('script', '整理来源脚本', lambda: planning('script'), {}),
                  ('arrangement', f"编排 {len(fixture['shot_list']['shots'])} 个镜头", lambda: planning('shot_list'), {}),
                  ('direction', '组织动作节奏', lambda: planning('directions'), {'shot_id': 's001'})]
        for a in fixture['assets']:
            steps.append(('storyboard', '展示示例关键画面', lambda a=a: frame(a), {'shot_id': a['shot_id'], 'keyframe_id': a['keyframe_id']}))
        for shot in fixture['shot_list']['shots']:
            steps += [('video.submitted', '建立本地预览任务', lambda s=shot: video_state(s), {'shot_id': shot['shot_id']}),
                      ('video.query', '载入已有视频片段' if creative else '制作本地静帧预览', lambda s=shot: video_state(s, True), {'shot_id': shot['shot_id']})]
        if creative:
            steps.append(('video.review', '回放视频审查反馈', review_video, {'shot_id': 's003'}))
        steps.append(('assembly', '展示历史预览' if creative else '合并本地预览（非 AI 成片）', assemble, {}))
        if creative and state['step'] == 0:
            message('demo-plan', '这是**本地预设演示**，不调用付费模型。这一页是同一场景的连续对话，'
                    '我会保留 **6 格内容**，编排为 **4 个镜头**，让情绪有展开的空间。接下来会逐步展示分格、编排、画面和视频。')
        for index in range(state['step'], len(steps)):
            stage, label, action, target = steps[index]
            child = tasks.create(directory, {'active_run': str(directory)}, f'模拟 · {label}', stage.split('.')[0], parent_id=root_id, origin='simulation')
            try:
                with tasks.track(directory, child):
                    emit(stage, status='running', message=f'模拟 · {label}', **target)
                    time.sleep(delay)
                    if stage == 'video.query' and state.get('scenario') == 'failure' and not state.get('failure_seen'):
                        state['failure_seen'] = True
                        write_json(directory/'simulation.json', state)
                        raise ValueError('模拟执行失败：用于检查保留进度与恢复，不涉及远端请求')
                    action()
                    if stage in {'script','arrangement','direction','storyboard'}:
                        from uuid import uuid4
                        for iteration in range(2 if stage == 'arrangement' else 1):
                            for role in ['Creator','Reviewer']:
                                identifier = uuid4().hex
                                rejected = stage == 'arrangement' and iteration == 0 and role == 'Reviewer'
                                data = dict(activity_id=identifier, actor=f'{stage}.{role.lower()}', role=role,
                                    professional_stage=stage, target=target.get('keyframe_id') or target.get('shot_id') or 'all',
                                    iteration=iteration, simulated=True)
                                emit('professional', status='running', **data)
                                time.sleep(delay / 3)
                                emit('professional', status='completed', **data,
                                    **({'accepted': not rejected, 'message': '模拟审查：停顿过长，退回编排修订' if rejected else '模拟审查：通过',
                                        'issues': [{'location':'s001','target':'arrangement','evidence':'模拟：停顿过长','suggestion':'模拟：重新分配时间'}] if rejected else []} if role == 'Reviewer' else {'message':'本地预设候选，非模型生成'}))
            except (Exception, KeyboardInterrupt) as exc:
                status = 'interrupted' if isinstance(exc, KeyboardInterrupt) else 'failed'
                tasks.update(directory, child, status=status, summary=str(exc) or '模拟已停止')
                tasks.update(directory, root_id, status=status, summary=str(exc) or '模拟已停止，可继续运行')
                raise
            tasks.update(directory, child, status='completed', summary='模拟步骤已完成')
            state.update(step=index+1, completed=index+1 == len(steps))
            write_json(directory/'simulation.json', state)
            artifact(directory/'simulation.json')
            emit(stage, status='completed', message=f'模拟 · {label}', **target)
            if creative and stage == 'video.review':
                state['paused'] = True
                write_json(directory/'simulation.json', state)
                tasks.update(directory, root_id, status='waiting_user', summary='本地预设演示暂停于审查反馈；点击继续演示查看历史预览')
                artifact(directory/'simulation.json')
                return {'directory': str(directory), 'paused': True, 'message': '演示已暂停，可查看审查反馈，再点击继续演示'}
        tasks.update(directory, root_id, status='completed', summary='演示完成 · 已有素材回放，非本次生成' if creative else '模拟完成 · 视频是本地静帧预览，非 AI 成片')
    return {'directory': str(directory), 'message': '演示完成；历史素材回放，未调用模型' if creative else '模拟完成；未调用模型，视频仅为本地示例静帧预览'}
