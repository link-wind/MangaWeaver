import type {AgentSession,CanvasMessage,ConversationTurn,WorkflowTask} from './types';

export type PageStatus='未开始'|'制作中'|'需处理'|'已有成片'|'已有进度';
export function pageStatus(session:AgentSession,pageId:string):PageStatus {
  const run=session.book&&session.page_runs?.[`${session.book.id}:${pageId}`];
  if(!run)return '未开始';
  const tasks=(session.workflow?.tasks||[]).filter(task=>task.run===run&&!task.parent_id);
  const latest=tasks.at(-1);
  if(latest&&['running','queued'].includes(latest.status))return '制作中';
  if(latest&&['failed','interrupted','waiting_user','needs_user'].includes(latest.status))return '需处理';
  const stored=session.page_status?.[run];
  if(stored==='已有成片')return '已有成片';
  if(stored&&/失败|修订|需处理|中断/.test(stored))return '需处理';
  if(stored==='待处理')return '未开始';
  return '已有进度';
}
/** 任务、引用和同一轮请求共同界定范围；未知归属保留为项目级消息。 */
export function pageConversation(session:AgentSession,messages:CanvasMessage[],pageId?:string) {
  if(!pageId||!session.book)return {session,messages};
  const run=session.page_runs?.[`${session.book.id}:${pageId}`];
  const allTasks=session.workflow?.tasks||[];
  const belongs=(task:WorkflowTask)=>!!run&&task.run===run||task.page_id===pageId;
  const allowedTurns=new Set<string>(),otherTurns=new Set<string>();
  const classify=(id:string|undefined,match:boolean)=>{if(id)(match?allowedTurns:otherTurns).add(id);};
  for(const message of messages){
    const refs=message.references||[];
    if(refs.length)classify(message.turn_id,refs.some(ref=>ref.page?.page_id===pageId||!!run&&ref.run===run));
    else if(message.run||message.page_id)classify(message.turn_id,message.page_id===pageId||!!run&&message.run===run);
  }
  const turnRuns=(turn:ConversationTurn)=>allTasks.filter(task=>turn.blocks.some(block=>block.call_id&&block.call_id===task.call_id));
  for(const turn of session.conversation||[]){
    const tasks=turnRuns(turn);
    if(tasks.length)classify(turn.id,tasks.some(belongs));
  }
  const allowed=(id?:string)=>!id||allowedTurns.has(id)||!otherTurns.has(id);
  const filtered=messages.filter(message=>allowed(message.turn_id)&&
    (!(message.run||message.page_id)||message.page_id===pageId||!!run&&message.run===run)&&
    (!(message.references?.length)||message.references.some(ref=>ref.page?.page_id===pageId||!!run&&ref.run===run)));
  return {messages:filtered,session:{...session,conversation:session.conversation?.filter(turn=>allowed(turn.id)),
    workflow:session.workflow?{...session.workflow,tasks:allTasks.filter(belongs)}:undefined,
    pending_requests:session.pending_requests?.filter(request=>!request.run||request.run===run)}};
}
