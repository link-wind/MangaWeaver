import type {CanvasMessage, PendingRevision, WorkflowTask} from './types';

export const statusNames:Record<string,string> = {queued:'等待处理',running:'执行中',completed:'已完成',waiting_user:'需要处理',
  submitted:'已提交',succeeded:'已完成',success:'已完成',pending:'等待中',processing:'生成中',downloaded:'已下载',blocked:'未通过',cancelled:'已取消',failed:'执行失败',interrupted:'已中断',claimed:'已接收',answered:'已回答',applied:'已应用',withdrawn:'已撤回',needs_decision:'需要决定'};
export const actorNames:Record<string,string> = {script:'脚本',arrangement:'编排',direction:'演出',storyboard:'关键画面',
  dialogue:'对白',video:'视频',characters:'角色',coordinator:'创作 Agent',tool:'执行工具'};
export function actorName(actor?:string){
  if(!actor)return '创作 Agent';
  const [stage,role]=actor.split('.');
  return (actorNames[stage]||stage)+(role==='creator'?' Creator':role==='reviewer'?' Reviewer':'');
}
export function timeline(messages:CanvasMessage[],tasks:WorkflowTask[],pending:PendingRevision[]){
  const pendingIds=new Set(pending.flatMap(p=>[p.id,p.id+'-answer']));
  const items=[...messages.filter(m=>!pendingIds.has(m.id)).map((message,index)=>({id:message.id,time:message.created_at||'',index,kind:'message' as const,message})),
    ...tasks.filter(t=>!t.parent_id).map((task,index)=>({id:task.id,time:task.created_at,index:messages.length+index,kind:'task' as const,task})),
    ...pending.map((request,index)=>({id:request.id,time:request.created_at,index:messages.length+tasks.length+index,kind:'revision' as const,request}))];
  return items.sort((a,b)=>a.time.localeCompare(b.time)||a.index-b.index);
}
