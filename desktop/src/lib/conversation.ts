import type {AgentSession,ConversationTurn} from './types';

// 仅按持久化事件身份归并；重放不能触发工具执行。
export function conversationEvent(session:AgentSession,event:any):AgentSession {
  return conversationEvents(session,[event]);
}

export function conversationEvents(session:AgentSession,events:any[]):AgentSession {
  let current=session, turns:ConversationTurn[]|undefined;
  for(const event of events){
    if(current.conversation_meta && event.branch_id!==current.conversation_meta.branch_id)continue;
    if(event.sequence<=(current.conversation_sequence||0))continue;
    const seen=(current as AgentSession & {_conversationSeen?:string[]})._conversationSeen||[];
    if(seen.includes(event.event_id))continue;
    turns ??= structuredClone(session.conversation||[]);
    const messages=event.kind==='user'&&!current.messages.some(m=>m.id===event.message.id)?[...current.messages,event.message]:current.messages;
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
    current={...current,messages,conversation:turns,conversation_sequence:event.sequence,
      ...(event.kind==='context'&&event.stats?{context_stats:event.stats}:{}),
      _conversationSeen:[...seen.slice(-3999),event.event_id]} as AgentSession;
  }
  return current;
}

export const conversationStatus:Record<string,string>={running:'进行中',completed:'已完成',waiting:'等待回执',waiting_user:'等待回答',
  failed:'失败',interrupted:'已中断',needs_user:'需要回答',answered:'已回答',blocked:'未通过',limited:'达到上限'};
