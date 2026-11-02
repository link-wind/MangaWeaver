import type {AgentSession,ConversationTurn} from './types';

// 仅按持久化事件身份归并；重放不能触发工具执行。
export function conversationEvent(session:AgentSession,event:any):AgentSession {
  if(session.conversation_meta && event.branch_id!==session.conversation_meta.branch_id)return session;
  if(event.sequence<=(session.conversation_sequence||0))return session;
  const seen=(session as AgentSession & {_conversationSeen?:string[]})._conversationSeen||[];
  if(seen.includes(event.event_id))return session;
  const turns=structuredClone(session.conversation||[]);
  const messages=event.kind==='user'&&!session.messages.some(m=>m.id===event.message.id)?[...session.messages,event.message]:session.messages;
  let turn=turns.find(t=>t.id===event.turn_id);
  if(!turn){turn={id:event.turn_id,created_at:event.created_at,status:'running',blocks:[]};turns.push(turn);}
  if(event.kind==='turn'){turn.status=event.status;turn.message=event.message;}
  else if(event.block_id){
    let block=turn.blocks.find(b=>b.id===event.block_id);
    if(!block){if(!turn.blocks.length)turn.created_at=event.created_at;block={id:event.block_id,type:event.kind,text:''};turn.blocks.push(block);}
    const {delta,kind,block_id,...data}=event;
    Object.assign(block,data);
    if(delta)block.text+=delta;
  }
  return {...session,messages,conversation:turns,conversation_sequence:event.sequence,
    ...(event.kind==='context'&&event.stats?{context_stats:event.stats}:{}),
    _conversationSeen:[...seen.slice(-3999),event.event_id]} as AgentSession;
}

export const conversationStatus:Record<string,string>={running:'进行中',completed:'已完成',waiting:'等待回执',waiting_user:'等待回答',
  failed:'失败',interrupted:'已中断',needs_user:'需要回答',answered:'已回答',blocked:'未通过',limited:'达到上限'};
