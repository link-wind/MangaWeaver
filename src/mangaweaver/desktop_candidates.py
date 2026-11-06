"""桌面已有关键画面候选；复用正式计划校验，不调用模型或绕过审查。"""
from pathlib import Path
import re

from .io import file_signature, project_run, read_json, signature, write_json
from .run_lock import run_lock
from .schemas import ProductionPlan, ReviewReport, VisualAsset
from .generation.tasks import load_plan


def candidates(directory, keyframe):
    root = Path(directory).resolve()
    plan_path = root / 'production.json'
    plan = load_plan(plan_path) if plan_path.exists() else None
    # 草案可以预览，但只有完整、审查通过的正式计划允许受限采用。
    current_data = read_json(plan_path) if plan else next((read_json(root / n) for n in ['planning_draft.json', 'planning_state.json'] if (root / n).exists()), {})
    current = next((a for a in current_data.get('assets', []) if a['keyframe_id'] == keyframe), None)
    if current:
        current = {**current, 'image': str((root / current['image']).resolve())}
    selected_meta = Path(current['image']).with_suffix('.json') if current else None
    selected_context = read_json(selected_meta).get('input_signature') if selected_meta and selected_meta.is_file() else None
    items = []
    for path in sorted(root.glob('iter*/storyboard/*/*/candidate_*.json')):
        if not re.fullmatch(r'candidate_[0-9]+\.json', path.name):
            continue
        if not path.resolve().is_relative_to(root):
            continue
        value = read_json(path)
        asset = VisualAsset.model_validate(value['asset'])
        if asset.keyframe_id != keyframe:
            continue
        image = (root / asset.image).resolve()
        asset = asset.model_copy(update={'image': image})
        if image != path.with_suffix('.png').resolve() or not image.is_relative_to(root):
            continue
        iteration = path.relative_to(root).parts[0]
        review_dir = root / iteration / 'reviews/storyboard' / asset.shot_id / asset.keyframe_id
        reports = [ReviewReport.model_validate(read_json(p)) for p in sorted(review_dir.glob('compare_*.json'), key=lambda p: int(p.stem.split('_')[-1]))]
        report = reports[-1] if reports else None
        accepted = bool(reports and all(r.accepted for r in reports) and report.winner_id == path.stem)
        adopted = bool(current and Path(current['image']).resolve() == image and current['image_signature'] == asset.image_signature)
        reason = ''
        if not image.is_file() or file_signature(image) != asset.image_signature:
            reason = '图片缺失或已改变，需要重新审查'
        elif not plan or not plan.reviews or not all(r.accepted for r in plan.reviews):
            reason = '当前尚无完整、审查通过的正式计划'
        elif not selected_context or value.get('input_signature') != selected_context:
            reason = '来源或制作输入版本不一致，需显式修订'
        elif not reports or not all(r.accepted for r in reports) or report.winner_id != path.stem:
            reason = ('审查未选中此候选：' + report.reason) if report else '没有可核验的通过记录'
        elif not current or asset.plan_signature != current['plan_signature']:
            reason = '规划来源版本不一致'
        elif any(root.glob('video/*/*/tasks.json')) or (root / 'generation_tasks.json').exists() or (root / 'final.mp4').exists():
            reason = '已有视频任务，请在新修订运行中使用'
        elif next(s for s in plan.shot_list.shots if s.shot_id == asset.shot_id).type == 'action' and not adopted:
            reason = '动作镜头需重新完成整段关键画面序列审查'
        else:
            prepared = root / 'source/prepared.json'
            from .preprocessing.transcript import load_source
            if not prepared.exists() or signature(load_source(prepared)) != signature(plan.source):
                reason = '当前漫画来源已变化，需显式修订'
        items.append({'id': str(path.relative_to(root)), 'image': str(image), 'asset': asset.model_dump(mode='json'),
                      'version': iteration, 'accepted': accepted, 'revision': signature(value), 'current': adopted,
                      'can_adopt': not reason and not adopted, 'reason': reason,
                      'review': report.model_dump(mode='json') if report else None})
    return {'items': items, 'plan_revision': signature(read_json(plan_path)) if plan_path.exists() else None}


def adopt(request):
    root = Path(request['run_dir']).resolve()
    if not project_run(request['project'], root) or (root / 'EXPERIMENT.json').exists() or (root / 'simulation.json').exists():
        raise ValueError('只有当前项目的正式运行允许采用候选')
    with run_lock(root, 'adopt_candidate'):
        listing = candidates(root, request['keyframe'])
        from .desktop import EditConflict
        if listing['plan_revision'] != request.get('expected_revision'):
            raise EditConflict('编辑冲突：正式计划已变化，请重新读取候选')
        item = next((i for i in listing['items'] if i['id'] == request['candidate']), None)
        if item and item['revision'] != request.get('candidate_revision'):
            raise EditConflict('编辑冲突：候选记录已变化，请重新读取')
        if not item or not item['can_adopt']:
            raise ValueError(item['reason'] if item else '候选不存在')
        plan = load_plan(root / 'production.json')
        data = plan.model_dump(mode='json')
        data['assets'] = [item['asset'] if a['keyframe_id'] == request['keyframe'] else a for a in data['assets']]
        scope = 'storyboard:' + item['asset']['shot_id']
        data['reviews'] = [r for r in data['reviews'] if r.get('scope') != scope] + [{**item['review'], 'scope': scope}]
        result = ProductionPlan.model_validate(data)  # 原有来源、时间锚点与规划签名检查。
        # 同步当前正式检查点，恢复不得重新套用旧的 selected.json。
        previous = signature(plan)
        checkpoints = [p for p in root.glob('iter*/selected.json') if signature(load_plan(p)) == previous]
        for path in [*checkpoints, root / 'planning_state.json', root / 'production.json']:
            write_json(path, result)
        return {'message': '已采用通过审查的候选，未调用模型'}
