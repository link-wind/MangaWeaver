import {useEffect,useRef,useState} from 'react';
import {Check,ChevronDown,LoaderCircle,CircleAlert,ArrowUpRight} from 'lucide-react';
import type {AgentSession,CanvasMessage,WorkflowTask,CanvasReference,ConversationTurn,ConversationBlock,RunData} from '../lib/types';
import {actorName,statusNames,timeline} from '../lib/timeline';
import {conversationStatus} from '../lib/conversation';
import {turnParts,readableSummary,roleLabel,toolNames,taskOwnsError,runOrigin,workSummary,liveWorkText,type TurnPart} from '../lib/presentation';
import {useDetailsMenus} from '../lib/useDetailsMenus';

type Props={session?:AgentSession|null;messages:CanvasMessage[];busy:boolean;stopping:boolean;
  runs?:RunData[];
  onStop:()=>void;onAction:(task:WorkflowTask,action:WorkflowTask['actions'][number])=>void;
  onLocate:(task:WorkflowTask,target?:string)=>void;onWithdraw:(id:string)=>void;onProcessRequest:(id:string)=>void;highlight?:string;
  onConversationAction?:(command:string,params?:Record<string,unknown>)=>void;
  onReference?:(reference:CanvasReference)=>void;};
function References({items,onReference}:{items?:CanvasReference[];onReference?:Props['onReference']}){
  if(!items?.length)return null;
  return <div className="message-references">{items.map(ref=><button key={ref.id} className="reference-chip" title={`${ref.run} · ${ref.signature.slice(0,8)}`} onClick={()=>onReference?.(ref)}><small>{ref.purpose==='target'?'目标':'参考'}</small>{ref.label}<ArrowUpRight size={11}/></button>)}</div>;
}
function Status({status}:{status:string}){
  return <span className={`work-status ${status}`}>{status==='running'?<LoaderCircle size={12} className="runtime-spin"/>:status==='completed'?<Check size={12}/>:['failed','blocked','waiting_user','needs_user'].includes(status)?<CircleAlert size={12}/>:null}{conversationStatus[status]||statusNames[status]||status}</span>;
}
function WorkCard({part,props,active=false}:{part:Extract<TurnPart,{kind:'work'}>;props:Props;active?:boolean}){
  const task=part.task,children=task?(props.session?.workflow?.tasks.filter(t=>t.parent_id===task.id)||[]):[];
  const activities=[...(task?.activities||[]),...children.flatMap(t=>t.activities)].sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const roles=[...new Set([...activities.map(a=>a.actor),...part.blocks.map(b=>b.role).filter((r):r is string=>!!r)])];
  const end=part.blocks.filter(b=>b.type==='child'||b.type==='delivery').at(-1);
  let status=task?.status||part.root?.status||end?.status||'running';
  if(!props.busy&&status==='running')status='interrupted';
  const title=task?.title||toolNames[part.root?.tool||'']|| (end?.type==='delivery'?'补充要求':'专业协作');
  const rawSummary=task?.summary||part.root?.result?.summary||end?.result?.summary||end?.text||'';
  const question=part.blocks.find(b=>b.type==='child'&&b.status==='waiting_user');
  const summary=question?'等待你的确认后继续。':workSummary(status,activities,rawSummary,task?.origin==='simulation');
  const steps=part.blocks.filter(b=>b.type==='child');
  const publicTexts=part.blocks.filter(b=>b.type==='text'&&b.child_id&&b.text);
  const publicNotes=publicTexts.filter(b=>!activities.some(a=>a.message===b.text)&&(activities.length||!steps.some(s=>s.result?.summary===b.text)));
  const live=liveWorkText(part,active);
  const hasCollaboration=activities.length>0||steps.length>0||children.length>0;
  const hasProcess=hasCollaboration||publicTexts.length>0||!!rawSummary&&(rawSummary.length>100||rawSummary.includes('\n')||rawSummary!==summary);
  const origin=runOrigin(task?.run,props.session,props.runs);
  return <article id={task?`task-${task.id}`:undefined} className={`work-card ${status} ${props.highlight===task?.id?'highlighted':''}`}>
    {(task||hasCollaboration)&&<div className="work-origin">{task?.run?<button title={task.run} disabled={props.busy} onClick={()=>props.onLocate(task)}>{origin}<ArrowUpRight size={11}/></button>:<span>{origin}</span>}</div>}
    <header><strong>{title}</strong><Status status={status}/></header>
    {roles.length>0&&<div className="work-roles">{roles.slice(-2).map((role,i)=><span key={role}>{i>0&&<span aria-hidden="true">→</span>}{roleLabel(role)||actorName(role)}</span>)}{roles.length>2&&<span>共 {roles.length} 个角色</span>}</div>}
    {live?<div className="work-live" aria-live="polite"><small>{roleLabel(live.role)} · 公开说明</small><p>{live.text||'等待模型返回公开文字…'}</p></div>:summary&&<p className="work-summary">{summary}</p>}
    {hasProcess&&<details className="work-process"><summary>{hasCollaboration?'协作过程':'完整说明'}<ChevronDown size={12}/></summary><div className="work-steps">
      {activities.length?activities.map(a=><section key={a.id} className="work-step"><div><b>{roleLabel(a.actor)||actorName(a.actor)}</b><small>{Number.isInteger(a.iteration)&&a.iteration>=0&&`第 ${a.iteration+1} 轮 · `}{a.reused?'复用':a.accepted===false?'退回修订':a.accepted===true?'审查通过':conversationStatus[a.status]||statusNames[a.status]||a.status}</small></div>
        {a.message&&<p>{a.message}</p>}{a.target!=='all'&&task&&<button className="task-link" disabled={props.busy} onClick={()=>props.onLocate(task,a.target)}>{a.target}<ArrowUpRight size={11}/></button>}
        {!!a.issues?.length&&<ul className="review-issues">{a.issues.map((issue,i)=><li key={i}>{issue.evidence}<small>{issue.suggestion}</small></li>)}</ul>}
      </section>):steps.map(b=><section key={b.id} className="work-step"><div><b>{roleLabel(b.role)}</b><small>{conversationStatus[b.status||'']||b.status}</small></div>{b.result?.summary&&<p>{b.result.summary}</p>}</section>)}
      {children.filter(c=>!c.activities.length).map(c=><section key={c.id} className="work-step"><div><b>{c.title}</b><small>{statusNames[c.status]||c.status}</small></div>{c.summary&&<p>{readableSummary(c.summary)}</p>}</section>)}
      {publicNotes.map(b=><section className="work-step" key={b.id}><b>{roleLabel(b.role)} · 公开说明</b><p>{b.text}</p></section>)}
      {rawSummary&&!activities.some(a=>a.message===rawSummary)&&(activities.length>0||!steps.some(b=>b.result?.summary===rawSummary))&&!publicNotes.some(b=>b.text===rawSummary)&&<p className="work-evidence">{rawSummary}</p>}
    </div></details>}
    <footer>{task?.actions.map(action=><button key={action.kind} className="work-action" disabled={props.busy} onClick={()=>props.onAction(task,action)}>{action.label}</button>)}
      {task?.run&&<button className="task-link" disabled={props.busy} onClick={()=>props.onLocate(children.at(-1)||task)}>查看画布<ArrowUpRight size={12}/></button>}
      <details className="work-technical"><summary>技术详情</summary><pre>{JSON.stringify({tool:part.root?.tool,arguments:part.root?.arguments,result:part.root?.result,task,
        children,events:part.blocks},null,2)}</pre></details>
    </footer>
  </article>;
}
function Questions({blocks}:{blocks:ConversationBlock[]}){
  return <>{blocks.filter(b=>b.type==='child'&&b.status==='waiting_user').map(b=><div className="professional-question" key={b.id}><small>{roleLabel(b.role)} · 需要确认</small><p>{b.text}</p></div>)}</>;
}
function Turn({turn,props,tasks}:{turn:ConversationTurn;props:Props;tasks:WorkflowTask[]}){
  const parts=turnParts(turn,tasks),hasWork=parts.some(p=>p.kind==='work');
  const text=new Set<string>();
  return <article className="conversation-turn"><header><b>创作 Agent</b>{props.busy&&turn.status==='running'&&<small><LoaderCircle size={11} className="runtime-spin"/>处理中</small>}</header>
    {parts.map(part=>{
      if(part.kind==='work')return <div key={part.id}><WorkCard part={part} props={props} active={props.busy&&turn.status==='running'&&turn.id===props.session?.conversation?.filter(t=>t.status==='running').at(-1)?.id}/><Questions blocks={part.blocks}/></div>;
      if(text.has(part.block.text.trim()))return null;text.add(part.block.text.trim());
      return <div className="stream-text" key={part.block.id}><p>{part.block.text}</p>{['failed','interrupted'].includes(part.block.status||'')&&!hasWork&&<small>{conversationStatus[part.block.status!]}</small>}</div>;
    })}
    {turn.message&&!taskOwnsError(turn.message,tasks)&&<div className="conversation-error"><p>{readableSummary(turn.message)}</p><details><summary>查看原因</summary><pre>{turn.message}</pre></details></div>}
  </article>;
}
export function CreativeTimeline(props:Props){
  const history=useRef<HTMLDivElement>(null),follow=useRef(true);
  const controls=useDetailsMenus<HTMLDivElement>();
  const [editing,setEditing]=useState<string|null>(null),[editText,setEditText]=useState('');
  const tasks=props.session?.workflow?.tasks||[],turns=props.session?.conversation||[];
  const turnIds=new Set(turns.map(t=>t.id)),calls=new Set(turns.flatMap(t=>t.blocks.filter(b=>b.type==='tool').map(b=>b.call_id)));
  const visibleTasks=tasks.filter(t=>(!t.call_id||!calls.has(t.call_id))&&!(t.origin==='follow_up'&&t.status==='completed'&&!t.activities.length));
  const messages=props.messages.filter(m=>(!m.turn_id||!turnIds.has(m.turn_id))&&!(m.role==='assistant'&&taskOwnsError(m.text,tasks)));
  const base=timeline(messages,visibleTasks,props.session?.pending_requests||[]);
  const items=[...base,...turns.filter(t=>t.blocks.some(b=>b.type!=='context')||t.message).map((turn,index)=>({id:turn.id,time:turn.created_at,index:base.length+index,kind:'turn' as const,turn}))].sort((a,b)=>a.time.localeCompare(b.time)||a.index-b.index);
  const active=tasks.find(t=>t.id===props.session?.active_task_id);
  const contextNotice=turns.flatMap(t=>t.blocks).filter(b=>b.type==='context'&&b.message).at(-1);
  const usage=props.session?.context_stats?.provider_usage as Record<string,number>|undefined;
  const actualInput=usage?.promptTokenCount??usage?.prompt_token_count??usage?.input_tokens??usage?.prompt_tokens;
  const actualOutput=usage?.candidatesTokenCount??usage?.candidates_token_count??usage?.output_tokens??usage?.completion_tokens;
  const replies=new Set([...props.messages.filter(m=>m.role==='assistant').map(m=>m.text),...turns.flatMap(t=>t.blocks.filter(b=>b.type==='text').map(b=>b.text))]);
  useEffect(()=>{if(follow.current&&history.current?.offsetParent)history.current.scrollTop=history.current.scrollHeight;},[items.length,props.session?.workflow?.revision,props.session?.conversation]);
  useEffect(()=>{if(props.highlight){const target=document.getElementById(`task-${props.highlight}`);if(target&&history.current)history.current.scrollTop+=target.getBoundingClientRect().top-history.current.getBoundingClientRect().top-20;}},[props.highlight]);
  return <>
    {props.session?.conversation_meta&&<div ref={controls} className="conversation-controls"><select aria-label="项目对话分支" value={props.session.conversation_meta.branch_id} disabled={props.busy} onChange={e=>props.onConversationAction?.('agent_switch_branch',{branch_id:e.target.value})}>{props.session.conversation_meta.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <details data-menu><summary>会话设置<ChevronDown size={11}/></summary><div className="context-popover">
        {contextNotice&&<p>{!props.busy&&contextNotice.status==='running'?'压缩已中断，原记录保留':contextNotice.message}</p>}
        {props.session.context_stats&&<p>上下文约 {Math.round(props.session.context_stats.estimated_input/100)/10}k<small>{props.session.context_stats.basis} · 预算 {props.session.context_stats.budget}</small></p>}
        {typeof actualInput==='number'&&<p>渠道用量：输入 {actualInput}{typeof actualOutput==='number'?` · 输出 ${actualOutput}`:''}</p>}
        <button disabled={props.busy} onClick={()=>props.onConversationAction?.('agent_compact')}>压缩历史</button>
      </div></details></div>}
    <div className="conversation-history" ref={history} onScroll={()=>{const el=history.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;}}>
      {!items.length&&<p className="creative-empty">添加漫画，告诉我想怎样改编。</p>}
      {items.map(item=>item.kind==='turn'?<Turn key={item.id} turn={item.turn} props={props} tasks={tasks}/>:item.kind==='message'?<div key={item.id} className={`conversation-message ${item.message.role}`}>
        <div className="message-author"><b>{item.message.role==='user'?'你':'创作 Agent'}</b></div><p>{item.message.role==='assistant'&&/执行失败|SSLError|HTTPSConnectionPool|已有产物输入不同/.test(item.message.text)?readableSummary(item.message.text):item.message.text}</p>{item.message.role==='assistant'&&/执行失败|SSLError|HTTPSConnectionPool|已有产物输入不同/.test(item.message.text)&&<details><summary>查看原因</summary><pre className="historical-error">{item.message.text}</pre></details>}<References items={item.message.references} onReference={props.onReference}/>
        {item.message.role==='user'&&props.onConversationAction&&(editing===item.id?<div className="history-edit"><textarea aria-label="编辑历史要求" value={editText} onChange={e=>setEditText(e.target.value)}/><div><button disabled={props.busy||!editText.trim()} onClick={()=>{props.onConversationAction?.('agent_fork',{message_id:item.id,text:editText,submit:true});setEditing(null);}}>发送新方案</button><button onClick={()=>setEditing(null)}>取消</button></div></div>:<div className="message-actions"><button disabled={props.busy} onClick={()=>{setEditing(item.id);setEditText(item.message.text);}}>编辑</button><button disabled={props.busy} onClick={()=>props.onConversationAction?.('agent_fork',{message_id:item.id,text:item.message.text,submit:true})}>重新回答</button></div>)}
      </div>:item.kind==='task'?<WorkCard key={item.id} part={{kind:'work',id:item.id,blocks:[],task:item.task}} props={props}/>:<article key={item.id} className={`pending-revision ${item.request.status}`}><small>{statusNames[item.request.status]||item.request.status} · {item.request.delivery==='follow_up'?'稍后处理':'补充要求'}</small><p>{item.request.text}</p><References items={item.request.references} onReference={props.onReference}/>{item.request.summary&&!replies.has(item.request.summary)&&<p className="request-answer">{readableSummary(item.request.summary)}</p>}
        {item.request.status==='queued'&&<div className="queue-actions"><button className="task-link" onClick={()=>props.onWithdraw(item.request.id)}>撤回</button>{!props.busy&&active?.status==='completed'&&item.request.delivery==='follow_up'&&<button className="task-link" onClick={()=>props.onProcessRequest(item.request.id)}>开始处理</button>}</div>}</article>)}
      {!!props.session?.events?.length&&!tasks.length&&<details className="historical-events"><summary>历史运行记录</summary>{props.session.events.filter(e=>e.type==='stage'&&e.data?.message).map((e,i)=><p key={e.id||i}>{e.data.message}</p>)}</details>}
    </div>
  </>;
}
