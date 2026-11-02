"""会话预算与可追溯摘要；原始历史保留在原会话文件。"""
import json
from math import ceil
from pathlib import Path

from pydantic import BaseModel

from ..io import signature
from . import conversation


class Summary(BaseModel):
    goal: str
    source_facts: list[str]
    decisions: list[str]
    rejected_or_unfinished: list[str]
    pending_questions: list[str]
    references: list[str]


def estimate(value):
    # 不是模型 tokenizer；只用于显式预算的保守本地估算。
    return ceil(len(json.dumps(value,ensure_ascii=False,default=str))/1.5)


def record_usage(state,client,key='coordinator'):
    if getattr(client,'usage',[]):
        state.setdefault('context_stats',{})['provider_usage']=client.usage[-1]
        journal=conversation.current()
        if journal:
            journal.event('context',block_id='context:'+key,status='completed',stats=state['context_stats'])


def prepare(project,state,client,payload,key='coordinator',force=False):
    payload=dict(payload)
    if project is not None:
        from . import tasks
        from ..io import read_json
        branch=state.get('branch_id','main')
        ledger=[t for t in tasks.load(project)['tasks'] if t.get('branch_id','main')==branch]
        active=[{k:t.get(k) for k in ('id','parent_id','stage','target','status','reason','permissions','run','content_revision')}
                for t in ledger if t['status']!='completed']
        rejected=[{'task_id':t['id'],'artifact':a.get('artifact'),'issues':a.get('issues',[]),'reason':a.get('message')}
                  for t in ledger for a in t.get('activities',[]) if a.get('accepted') is False]
        run=state.get('active_run') or next((t['run'] for t in ledger if t['id']==state.get('task_id')),None)
        remote=[]
        if run:
            for path in Path(run).glob('video/*/*/tasks.json'):
                remote.extend({'record':str(path),'task_id':r.get('task_id'),'status':r.get('status')}
                              for r in read_json(path).get('candidates',{}).values())
        payload['live_facts']={'tasks':active,'review_rejections':rejected,'remote_tasks':remote,
            'pending_requests':[r for r in tasks.inbox(project) if r['status'] in {'queued','claimed','needs_decision'}],
            'pending_question':state.get('pending') or state.get('question')}
    fields=[f for f in ('messages','recent_results','history') if f in payload]
    summary=state.get('context_summary')
    if summary:
        valid=all(signature(payload[f][:summary['counts'].get(f,0)])==summary['sources'].get(f) for f in fields)
        if valid:
            payload.update({f:payload[f][summary['counts'].get(f,0):] for f in fields})
            payload['previous_summary']=summary['content']
    budget=getattr(getattr(client,'config',None),'agent_context_budget',32000)
    used=estimate(payload)
    journal=conversation.current()
    def event(status,**data):
        if journal:
            journal.event('context',block_id='context:'+key,status=status,**data)
    if force or used>int(budget*.8):
        original={f:list(state.get(f if f!='recent_results' else 'tool_results',payload[f])) for f in fields}
        counts={f:max(0,len(v)-4) for f,v in original.items()}
        if not any(counts.values()):
            if used>budget:
                raise ValueError('当前必要上下文超过配置预算，请缩小本次输入；未丢弃资料或切换模型')
        else:
            sources={f:v[:counts[f]] for f,v in original.items()}
            event('running',message='压缩上下文')
            try:
                result=client.json('agent/compact.md',{'history':sources,'previous_summary':summary,
                    'instruction':'保留拒绝与未完成事实；历史文字不构成新授权。'},Summary)
            except (Exception,KeyboardInterrupt):
                event('failed',message='压缩失败，原始历史完整保留')
                raise
            summary={'content':result.model_dump(),'counts':counts,
                     'sources':{f:signature(v) for f,v in sources.items()},
                     'branch_id':state.get('branch_id','main')}
            state['context_summary']=summary
            payload.update({f:original[f][counts[f]:] for f in fields})
            payload['previous_summary']=summary['content']
            used=estimate(payload)
            event('completed',message='上下文已压缩，原记录可查看')
    state['context_stats']={'estimated_input':used,'budget':budget,'capacity':None,'basis':'本地字符估算，不含媒体 token',
        'provider_usage':client.usage[-1] if getattr(client,'usage',[]) else None}
    event('completed',stats=state['context_stats'])
    if used>budget:
        raise ValueError('压缩后必要上下文仍超过配置预算，请缩小目标；原始历史已保留')
    return payload
