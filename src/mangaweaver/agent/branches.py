"""显式对话分叉；仅保存会话，不重放工具或回滚实际产物。"""
from pathlib import Path
from uuid import uuid4

from ..io import read_json,write_json
from . import conversation,tasks


def change(project,session,request):
    meta=conversation.index(project)
    folder=Path(project)/'agent_sessions'
    folder.mkdir(exist_ok=True)
    old_id=meta['branch_id']
    active=tasks.get(project,session.get('active_task_id'))
    if active and active['status'] in {'running','queued'}:
        # 孤立的 running 同样要求显式停止，不能因读取历史悄悄取消。
        raise ValueError('请先停止或完成当前任务再切换分支')
    write_json(folder/f'branch-{old_id}.json',session)
    if request['command']=='agent_fork':
        messages=session['messages']
        position=next((i for i,m in enumerate(messages) if m['id']==request.get('message_id') and m['role']=='user'),None)
        if position is None:
            raise ValueError('找不到可分叉的用户消息，请刷新后选择')
        identifier=uuid4().hex
        branch={'id':identifier,'name':f'方案 {len(meta["branches"])}','parent_id':old_id,
                'fork_message':messages[position]['id'],'created_at':tasks.now(),
                'inherited_turns':list(dict.fromkeys(m['turn_id'] for m in messages[:position] if m.get('turn_id')))}
        meta['branches'].append(branch)
        # 旧产物通过真实运行引用查看，历史调用结果不是新分支的可执行队列。
        session={**session,'branch_id':identifier,'messages':messages[:position],'tool_results':[],
                 'pending':None,'permissions':[],'active_task_id':None,'turn_task_id':None,
                 'turn_references':[],'context_summary':None,'conversation_turn':None,'context_stats':None}
    else:
        identifier=request.get('branch_id')
        if not any(b['id']==identifier for b in meta['branches']):
            raise ValueError('分支不存在')
        if identifier==old_id:
            return session
        session=read_json(folder/f'branch-{identifier}.json')
    meta['branch_id']=identifier
    write_json(folder/f'branch-{identifier}.json',session)
    write_json(folder/'index.json',meta)
    return session
