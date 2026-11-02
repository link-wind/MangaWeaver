"""固定专业角色的小型会话；最终提交继续使用原产物 Schema。"""
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import create_model

from ..io import read_json, write_json, signature
from . import conversation, tasks

_scope=ContextVar('specialist_scope',default=None)


@contextmanager
def bind(project, session, task_id, request):
    token=_scope.set((Path(project),session,task_id,request))
    try:
        yield
    finally:
        _scope.reset(token)


class NeedsAnswer(Exception):
    def __init__(self, child, question):
        self.child=child
        self.question=question
        super().__init__(question['text'])


def run(client,template,payload,schema,media,destination,video=False):
    scope=_scope.get()
    if not scope or not template.startswith(('planning/','generation/')):
        return client.json(template,payload,schema,media,video=video)
    project,session,task_id,request=scope
    task=tasks.get(project,task_id)
    role=template.split('/')[1]+('.reviewer' if 'review' in template else '.creator')
    target=((payload.get('anchor') or {}).get('keyframe_id') or (payload.get('shot') or {}).get('shot_id')
            or (payload.get('segment') or {}).get('segment_id') or payload.get('panel_id')
            or ('characters' if 'characters_review' in template else task['target']))
    key=signature({'task':task_id,'branch':session.get('branch_id','main'),'role':role,'target':target,
                   'template':template,
                   'input':task.get('brief',{}).get('input_version')})[:32]
    path=project/'agent_sessions'/f'{key}.json'
    child=read_json(path) if path.exists() else {'id':key,'parent_task':task['parent_id'],'task_id':task_id,
        'branch_id':session.get('branch_id','main'),'role':role,'target':target,'history':[],
        'steps':0,'created_at':tasks.now(),'input_version':task.get('brief',{}).get('input_version')}
    if child.get('question') and not child['question'].get('answer'):
        raise NeedsAnswer(child,child['question'])
    # 相同角色能看到自己的旧提交及实际反馈；候选提交仍按原 destination 缓存。
    invocation=signature({'template':template,'payload':payload,'destination':str(destination)})
    if child.get('invocation')!=invocation:
        child['history'].append({'kind':'task','invocation':invocation,'payload':payload,'template':template})
        child['invocation']=invocation
    child.update(status='running',artifact=str(Path(destination).resolve()))
    write_json(path,child)
    journal=conversation.current()
    if journal:
        journal.event('child',block_id=key,child_id=key,role=role,status='running',target=target)
    envelope=create_model(f'{schema.__name__}Submission',
        text=(str,''),action=(Literal['read_sources','read_feedback','ask_user','submit'],...),
        result=(schema|None,None))
    # 每次专业调用最多 6 次动作，整个会话上限不随反馈／恢复清零。
    try:
        for _ in range(6):
            from ..events import checkpoint
            checkpoint()
            if child['steps']>=32:
                child['status']='limited'
                raise ValueError('专业会话已达到行动上限，请检查目标；不会自动重置轮次')
            child['steps']+=1
            write_json(path,child)
            from .context import prepare
            inputs=prepare(project,child,client,{'task':payload,'history':child['history'],
                'role':role,'allowed_actions':['read_sources','read_feedback','ask_user','submit'],
                'contract':'沿用当前专业提示词完成任务。只可读取本次资料、反馈或提出确切缺失信息；最终使用 submit，result 严格填写原产物。Reviewer 保留真实拒绝与依据，不能替 Creator 创作。'},key)
            write_json(path,child)
            block=uuid4().hex
            if journal:
                journal.event('text',block_id=block,child_id=key,role=role,status='running')
            if not hasattr(client,'stream_json'):
                raise ValueError('当前专业模型客户端不支持真实流式，未切换模型')
            pieces=[]
            def receive_text(delta):
                pieces.append(delta)
                if journal:
                    journal.event('text',block_id=block,child_id=key,role=role,delta=delta,status='running')
            action=client.stream_json(template,inputs,envelope,media,video=video,
                on_text=receive_text)
            published=''.join(pieces)
            if not action.text.startswith(published):
                raise ValueError('专业公开文字与最终提交不一致，未执行动作')
            if journal and action.text!=published:
                journal.event('text',block_id=block,child_id=key,role=role,delta=action.text[len(published):],status='running')
            from .context import record_usage
            record_usage(child,client,key)
            if journal:
                journal.event('text',block_id=block,status='completed',child_id=key,role=role)
            child['history'].append({'kind':'action','action':action.action,'text':action.text,
                'result':action.result.model_dump(mode='json') if action.result else None})
            write_json(path,child)
            if action.action=='submit':
                if action.result is None:
                    raise ValueError('专业提交缺少结果，未保存为有效产物')
                child.update(status='completed',question=None)
                write_json(path,child)
                if journal:
                    journal.event('child',block_id=key,child_id=key,role=role,status='completed',
                        result={'summary':action.text or '专业结果已提交，继续原产物校验及审查'})
                return action.result
            if action.result is not None:
                raise ValueError('非提交动作不能携带候选结果')
            if action.action=='ask_user':
                if not action.text.strip():
                    raise ValueError('专业提问缺少问题正文')
                child.update(status='waiting_user',question={'id':uuid4().hex,'text':action.text,
                    'branch_id':child['branch_id'],'input_version':child['input_version'],
                    'turn_id':journal.turn_id if journal else None})
                write_json(path,child)
                if journal:
                    journal.event('child',block_id=key,child_id=key,role=role,status='waiting_user',text=action.text)
                raise NeedsAnswer(child,child['question'])
            result=({'source':payload.get('source'), 'task_brief':payload.get('task_brief'),
                     'media':[str(p) for p in media]} if action.action=='read_sources' else
                    {k:payload[k] for k in payload if 'feedback' in k or k in {'previous','reviews','candidates'}})
            call=uuid4().hex
            if journal:
                journal.event('tool',block_id=call,call_id=call,child_id=key,tool=action.action,status='completed',
                    result={'summary':'已读取本次任务资料' if action.action=='read_sources' else '已读取原审查反馈'})
            child['history'].append({'kind':'tool_result','tool':action.action,'result':result})
            write_json(path,child)
        child['status']='limited'
        raise ValueError('专业调用达到本次行动上限，已保留会话，未继续下游')
    except NeedsAnswer:
        raise
    except (Exception,KeyboardInterrupt) as exc:
        if child.get('status')!='limited':
            child['status']='interrupted' if isinstance(exc,KeyboardInterrupt) else 'failed'
        write_json(path,child)
        if journal:
            journal.event('child',block_id=key,child_id=key,role=role,status=child['status'],result={'summary':str(exc) or '本地执行已停止'})
        raise


def answer(project,session,request):
    pending=session.get('pending') or {}
    key=str(pending.get('child_session_id',''))
    if not key.isalnum():
        raise ValueError('没有待回答的专业问题')
    path=Path(project)/'agent_sessions'/f'{key}.json'
    child=read_json(path)
    question=child.get('question') or {}
    if question.get('id')!=request.get('question_id') or question.get('branch_id')!=session.get('branch_id','main'):
        raise ValueError('问题已过期或属于其他分支，请回到原会话')
    task=tasks.get(project,child['task_id'])
    if task.get('brief',{}).get('input_version')!=question.get('input_version'):
        raise ValueError('专业问题输入版本已变化，请重新指定目标')
    text=str(request.get('text','')).strip()
    if not text or len(text)>20000:
        raise ValueError('请输入有效回答')
    question['answer']=text
    child['history'].append({'kind':'user_answer','question_id':question['id'],'text':text})
    write_json(path,child)
    from .loop import add_message,save
    add_message(session,'user',text)
    save(project,session)
    journal=conversation.current()
    if journal:
        original_turn=question.get('turn_id') or next((e['turn_id'] for e in reversed(conversation.records(project))
            if e.get('child_id')==key and e.get('status')=='waiting_user'),None)
        if original_turn:
            journal.event('child',turn_id=original_turn,block_id=key,child_id=key,role=child['role'],
                          status='answered',text=question['text'],result={'summary':'已回答：'+text})
            journal.event('turn',turn_id=original_turn,status='answered')
    parent=tasks.get(project,child['parent_task'])
    return {**request,'command':'agent_resume_task','task_id':parent['id'],'task_revision':parent['revision']}
