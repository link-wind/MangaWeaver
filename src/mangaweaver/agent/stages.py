"""显式阶段按钮：直接复用专业工具，不增加模型决策或另一套制作流程。"""
from pathlib import Path
from uuid import uuid4
from ..events import emit
from ..schemas import AgentAction
from .tools import read_state
from .workflow import run_tool as execute
from .harness import STAGES

LABELS = {stage['id']: stage['label'] for stage in STAGES}


def completed(state, stage):
    # 各分支对应 harness.STAGES 中的 gate，展示清单只描述不驱动，执行真相保持在这里。
    if stage == 'preprocess':
        return state['has_source']  # gate: 整页已分格并识别文字
    if stage == 'storyboard':
        return state['has_production']  # gate: 关键画面已生成
    if stage == 'video':
        return (Path(state['run']) / 'final.mp4').is_file()  # gate: 视频成片已生成
    reviews = [r for r in state['reviews'] if r.get('scope', '').split(':')[0] == stage]
    present = state['script_ready'] if stage == 'script' else bool(state['shot_list']) if stage == 'arrangement' else bool(state['directions'])
    if stage == 'direction' and state['shot_list'] and not any(s['type'] == 'action' for s in state['shot_list']['shots']):
        return True  # gate: 无动作镜头时自动通过
    return present and bool(reviews) and all(r['accepted'] for r in reviews)


def run_stage(project, session, request):
    stage = request.get('stage')
    if stage not in LABELS:
        raise ValueError('未知制作阶段')
    if not session.get('active_run'):
        raise ValueError('请先展开并选择漫画页')
    operation = request.get('operation', 'stage')
    if operation not in {'stage', 'until', 'revise', 'resume'}:
        raise ValueError('未知阶段操作')
    tool = 'produce' if operation == 'until' else 'resume' if operation == 'resume' else 'preprocess_page' if stage == 'preprocess' else 'generate' if stage == 'video' else 'delegate'
    call_id = uuid4().hex
    emit('agent.tool', tool=tool, call_id=call_id, status='running', message=f'运行{LABELS[stage]}', run_dir=session['active_run'])
    action = AgentAction(kind='call_tool', tool=tool, arguments={'stage': stage,
        'revise': operation == 'revise', 'goal': str(request.get('feedback', '')), 'location': str(request.get('location') or 'all')})
    from .conversation import current,call
    journal=current()
    if journal:
        journal.event('tool',block_id=call_id,call_id=call_id,tool=tool,status='running',arguments=action.arguments.model_dump(),run=session['active_run'])
    with call(call_id):
        result = execute(project, session, action, request)
    if journal:
        journal.event('tool',block_id=call_id,call_id=call_id,status=result['status'],result=result)
    emit('agent.tool', tool=tool, call_id=call_id, status=result['status'], message=result['summary'], run_dir=session['active_run'])
    session['tool_results'].append({'tool': tool, 'arguments': action.arguments.model_dump(), 'call_id': call_id, 'result': result})
    return result
