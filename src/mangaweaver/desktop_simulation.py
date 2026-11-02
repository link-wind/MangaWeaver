"""仅用于客户端交互验收的本地演示，不创建模型客户端或远端任务。"""
import shutil
import subprocess
import time
from pathlib import Path

from .events import artifact, emit
from .io import read_json, write_json
from .run_lock import run_lock

FIXTURE = Path(__file__).resolve().parents[2] / 'examples/cross-panel'


def _ffmpeg(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *map(str, args)], check=True, capture_output=True)


def create(directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError('模拟任务必须使用新的空目录')
    page = directory / 'input/page.png'
    page.parent.mkdir()
    _ffmpeg('-i', FIXTURE/'images/entry.png', '-i', FIXTURE/'images/impact.png',
            '-i', FIXTURE/'images/reaction.png', '-filter_complex',
            '[0:v][1:v][2:v]vstack=inputs=3,scale=640:-1', '-frames:v', '1', page)
    write_json(directory/'simulation.json', {'step': 0, 'completed': False, 'label': '模拟任务', 'api_calls': 0})
    write_json(directory/'canvas.json', {'version': 1, 'page': str(page),
        'prompt': '模拟任务：分格 → 镜头规划 → 关键画面 → 视频预览。全程使用本地示例，不调用 API。',
        'draft': '', 'positions': {}, 'messages': []})
    return {'directory': str(directory)}


def run(directory, delay=2):
    """固定本地步骤，沿用同一 JSONL 事件与产物刷新通道；停止后从已完成步骤继续。"""
    directory = Path(directory).resolve()
    with run_lock(directory, 'simulate'):
        state = read_json(directory/'simulation.json')
        from .agent import tasks
        root_id = state.get('task_id')
        if not root_id:
            root_id = tasks.create(directory, {'active_run': str(directory)}, '模拟 · 漫画制作', 'video', origin='simulation')
            state['task_id'] = root_id
            write_json(directory/'simulation.json', state)
        tasks.update(directory, root_id, status='running', summary='本地预设演示 · 不调用模型')
        if state['completed']:
            return {'directory': str(directory), 'message': '模拟任务已完成，可从首页创建新的模拟任务'}
        fixture = read_json(FIXTURE/'production.json')
        source_path = directory/'source/manifest.json'
        draft_path = directory/'planning_draft.json'

        def panel(index):
            source = read_json(source_path) if source_path.exists() else {**fixture['source'], 'panels': []}
            entry = dict(fixture['source']['panels'][index])
            target = directory/'source/panels'/f"{entry['panel_id']}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(FIXTURE/entry['image'], target)
            entry['image'] = str(target)
            source['panels'] = [p for p in source['panels'] if p['panel_id'] != entry['panel_id']] + [entry]
            write_json(source_path, source)

        def planning(key):
            data = read_json(draft_path) if draft_path.exists() else {'source': read_json(source_path), 'assets': [], 'reviews': []}
            data[key] = fixture[key]
            write_json(draft_path, data)

        def frame(asset):
            target = directory/'frames'/f"{asset['keyframe_id']}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(FIXTURE/asset['image'], target)
            data = read_json(draft_path)
            data['assets'] = [a for a in data['assets'] if a['keyframe_id'] != asset['keyframe_id']] + [{**asset, 'image': str(target)}]
            write_json(draft_path, data)

        def video_state(shot, ready=False):
            folder = directory/'video'/shot['shot_id']/'simulation'
            folder.mkdir(parents=True, exist_ok=True)
            path = folder/'simulation.mp4'
            if ready:
                image = next(a['image'] for a in read_json(draft_path)['assets'] if a['shot_id'] == shot['shot_id'])
                _ffmpeg('-loop', '1', '-i', image, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                        '-t', shot['duration'], '-vf', 'scale=640:360', '-r', '24', '-c:v', 'libx264',
                        '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', path)
            write_json(folder/'tasks.json', {'simulated': True, 'candidates': {'local_example': {
                'status': 'downloaded' if ready else 'simulating', 'path': str(path), 'simulated': True}}})

        def assemble():
            from .generation.assembly import assemble as join
            paths = [directory/'video'/s['shot_id']/'simulation/simulation.mp4' for s in fixture['shot_list']['shots']]
            output = join(paths, directory/'.simulation-building.mp4')
            output = output.replace(directory/'simulation.mp4')
            artifact(output)

        steps = [('magi.load', '准备本地示例', lambda: None, {})]
        for i, p in enumerate(fixture['source']['panels']):
            steps.append(('magi.detect', f'分格 {i+1}/3', lambda i=i: panel(i), {'panel_id': p['panel_id']}))
        steps += [('magi.ocr', '读取示例文字', lambda: None, {}),
                  ('script', '整理来源脚本', lambda: planning('script'), {}),
                  ('arrangement', '编排 2 个镜头', lambda: planning('shot_list'), {}),
                  ('direction', '组织动作节奏', lambda: planning('directions'), {'shot_id': 's001'})]
        for a in fixture['assets']:
            steps.append(('storyboard', '展示示例关键画面', lambda a=a: frame(a), {'shot_id': a['shot_id'], 'keyframe_id': a['keyframe_id']}))
        for shot in fixture['shot_list']['shots']:
            steps += [('video.submitted', '建立本地预览任务', lambda s=shot: video_state(s), {'shot_id': shot['shot_id']}),
                      ('video.query', '制作本地静帧预览', lambda s=shot: video_state(s, True), {'shot_id': shot['shot_id']})]
        steps.append(('assembly', '合并本地预览（非 AI 成片）', assemble, {}))
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
        tasks.update(directory, root_id, status='completed', summary='模拟完成 · 视频是本地静帧预览，非 AI 成片')
    return {'directory': str(directory), 'message': '模拟完成；未调用模型，视频仅为本地示例静帧预览'}
