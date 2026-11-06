import {BookOpen,Copy,GitFork,History,LoaderCircle,MoreHorizontal,Network,Pencil,Plus,Sparkles} from 'lucide-react';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {AgentCollaborationSummary,AgentReviewFeedback} from '../components/AgentCollaborationSummary';
import {AgentTraceTree} from '../components/AgentTraceTree';
import {ActionMenu,Select} from '../components/controls';
import {Disclosure} from '../components/Disclosure';
import {Button} from '../components/ui/button';
import {DropdownMenuItem} from '../components/ui/dropdown-menu';
import {Popover,PopoverContent,PopoverTrigger} from '../components/ui/popover';
import {SelectItem} from '../components/ui/select';
import {Textarea} from '../components/ui/textarea';
import {liveWorkText,readableSummary,referenceLabel,roleLabel,runOrigin,taskOwnsError,turnParts} from '../lib/presentation';
import {conversationStatus} from '../lib/conversation';
import {pageConversation} from '../lib/bookWorkspace';
import {statusNames,timeline} from '../lib/timeline';
import {collaborationStages,traceRoots,type TraceNote} from '../lib/trace';
import type {AgentSession,CanvasMessage,CanvasReference,ConversationTurn,RunData,WorkflowTask} from '../lib/types';

type View='chat'|'collab';
type Props={session?:AgentSession|null;messages:CanvasMessage[];busy:boolean;replyBusy?:boolean;stopping:boolean;runs?:RunData[];pageId?:string;
  onStop:()=>void;onAction:(task:WorkflowTask,action:WorkflowTask['actions'][number])=>void;
  onLocate:(task:WorkflowTask,target?:string)=>void;onWithdraw:(id:string)=>void;onProcessRequest:(id:string)=>void;highlight?:string;
  onConversationAction?:(command:string,params?:Record<string,unknown>)=>void;
  onReference?:(reference:CanvasReference)=>void;onNewRequest:()=>void;onDetails:()=>void;hasSelection:boolean};
type Part={kind:'text';id:string;text:string;status?:string}|{kind:'task';task:WorkflowTask}|{kind:'question';id:string;text:string;role?:string}|{kind:'error';text:string};
type TimelineItem=ReturnType<typeof timeline>[number]|{kind:'turn';id:string;time:string;index:number;turn:ConversationTurn};
type ChatItem={kind:'reply';id:string;parts:Part[];running:boolean;request?:CanvasMessage}|Exclude<TimelineItem,{kind:'task'}|{kind:'turn'}>;

function References({items,onReference}:{items?:CanvasReference[];onReference?:Props['onReference']}) {
  if(!items?.length)return null;
  return <div className="user-references">{items.map(reference=><button key={reference.id} className="user-reference" disabled={!onReference}
    onClick={()=>onReference?.(reference)} title={referenceLabel(reference)}><BookOpen size={12}/><span>{referenceLabel(reference)}</span></button>)}</div>;
}

function partsForTurn(turn:ConversationTurn,tasks:WorkflowTask[],busy:boolean):Part[] {
  const parts:Part[]=[];
  for(const part of turnParts(turn,tasks)) {
    if(part.kind==='text') {parts.push({kind:'text',...part.block});continue;}
    const live=liveWorkText(part,busy&&turn.status==='running');
    if(live)parts.push({kind:'text',...live});
    if(part.task)parts.push({kind:'task',task:part.task});
    for(const block of part.blocks)if(block.type==='child'&&block.status==='waiting_user')parts.push({kind:'question',id:block.id,text:block.text,role:block.role});
  }
  if(turn.message&&!taskOwnsError(turn.message,tasks))parts.push({kind:'error',text:turn.message});
  if(!parts.length&&busy&&turn.status==='running')parts.push({kind:'text',id:turn.id,text:'',status:'running'});
  return parts;
}

function groupReplies(items:TimelineItem[],tasks:WorkflowTask[],busy:boolean):ChatItem[] {
  const grouped:ChatItem[]=[];
  for(const item of items) {
    if(item.kind==='revision'||(item.kind==='message'&&item.message.role==='user')) {grouped.push(item);continue;}
    const parts:Part[]=item.kind==='turn'?partsForTurn(item.turn,tasks,busy):item.kind==='task'?[{kind:'task',task:item.task}]:[{kind:'text',id:item.id,text:item.message.text}];
    if(!parts.length)continue;
    const running=busy&&(item.kind==='turn'?['running','queued','waiting'].includes(item.turn.status):item.kind==='task'?['running','queued'].includes(item.task.status):false);
    const previous=grouped.at(-1);
    if(previous?.kind==='reply'){previous.parts.push(...parts);previous.running ||= running;}
    else grouped.push({kind:'reply',id:item.id,parts,running,request:previous?.kind==='message'?previous.message:undefined});
  }
  // 首段文字可能早于 turn／task 记录到达；只影响当前回复，不隐藏历史操作。
  const latest=grouped.at(-1);
  if(busy&&latest?.kind==='reply')latest.running=true;
  return grouped;
}

function Reply({item,props,tasks,onInspect}:{item:Extract<ChatItem,{kind:'reply'}>;props:Props;tasks:WorkflowTask[];onInspect:(id:string)=>void}) {
  const roots=[...new Map(item.parts.flatMap(part=>part.kind==='task'?[[part.task.id,part.task] as const]:[])).values()];
  const seen=new Set<string>();
  let renderedWork=false;
  const content:ReactNode[]=[];
  for(const part of item.parts) {
    if(part.kind==='text') {
      if(part.text&&seen.has(part.text.trim()))continue;
      seen.add(part.text.trim());
      content.push(<div className="stream-text" key={part.id}><p>{part.text?part.text.split(/(\*\*[^*]+\*\*)/).map((text,index)=>text.startsWith('**')&&text.endsWith('**')?<strong key={index}>{text.slice(2,-2)}</strong>:text):<span className="reply-working"><LoaderCircle size={12} className="runtime-spin"/>正在处理</span>}</p>
        {['failed','interrupted'].includes(part.status||'')&&<small>{conversationStatus[part.status!]}</small>}</div>);
    } else if(part.kind==='task'&&!renderedWork) {
      renderedWork=true;
      const shared={task:roots[0],roots,tasks,busy:props.busy,onLocate:props.onLocate,onAction:props.onAction,onInspect:(id?:string)=>onInspect(id||roots[0].id)};
      content.push(<div className="reply-collaboration" key="collaboration"><AgentCollaborationSummary {...shared}/><AgentReviewFeedback {...shared}/></div>);
    } else if(part.kind==='question') {
      content.push(<div className="professional-question" key={part.id}><small>{roleLabel(part.role)} · 需要确认</small><p>{part.text}</p></div>);
    } else if(part.kind==='error') {
      content.push(<div className="conversation-error" key="error"><p>{readableSummary(part.text)}</p><details><summary>查看原因</summary><pre>{part.text}</pre></details></div>);
    }
  }
  const copy=item.parts.flatMap(part=>part.kind==='text'?[part.text]:[]).join('\n\n');
  const user=item.request;
  return <section className="assistant-message" aria-label="创作助手回复">{content}{!item.running&&<div className="message-actions">
    <Button variant="ghost" size="icon-sm" title="复制回复" aria-label="复制回复" disabled={!copy} onClick={()=>void navigator.clipboard.writeText(copy)}><Copy size={12}/></Button>
    {!!roots.length&&<Button variant="ghost" size="icon-sm" title="查看协作过程" aria-label="查看协作过程" onClick={()=>onInspect(roots[0].id)}><Network size={12}/></Button>}
    <ActionMenu label="回复更多操作" trigger={<MoreHorizontal size={12}/>} size="icon-sm">
      {roots.flatMap(root=>root.actions.map(action=><DropdownMenuItem key={`${root.id}-${action.kind}`} disabled={props.busy} onSelect={()=>props.onAction(root,action)}>{action.label}</DropdownMenuItem>))}
      <DropdownMenuItem disabled={props.busy||!user||!props.onConversationAction} onSelect={()=>props.onConversationAction?.('agent_fork',{message_id:user?.id,text:user?.text,submit:true})}><GitFork size={13}/>重新回答并创建分支</DropdownMenuItem>
    </ActionMenu>
  </div>}</section>;
}

export function CreativeTimeline(input:Props) {
  const [scope,setScope]=useState('page');
  const scoped=input.session?pageConversation(input.session,input.messages,scope==='page'?input.pageId:undefined):null;
  const props=scoped?{...input,...scoped}:input;
  const history=useRef<HTMLDivElement>(null),follow=useRef(true);
  const [following,setFollowing]=useState(true),[view,setView]=useState<View>('chat'),[inspected,setInspected]=useState('');
  const [editing,setEditing]=useState<string|null>(null),[editText,setEditText]=useState('');
  const tasks=props.session?.workflow?.tasks||[],turns=props.session?.conversation||[];
  function inspectTask(id:string){setInspected(id);setView('collab');}
  const turnIds=new Set(turns.map(turn=>turn.id)),calls=new Set(turns.flatMap(turn=>turn.blocks.filter(block=>block.type==='tool').map(block=>block.call_id)));
  const visibleTasks=tasks.filter(task=>(!task.call_id||!calls.has(task.call_id))&&!(task.origin==='follow_up'&&task.status==='completed'&&!task.activities.length));
  const messages=props.messages.filter(message=>!(message.role==='assistant'&&((message.turn_id&&turnIds.has(message.turn_id))||taskOwnsError(message.text,tasks))));
  const base=timeline(messages,visibleTasks,props.session?.pending_requests||[]);
  const items:TimelineItem[]=[...base,...turns.filter(turn=>turn.blocks.some(block=>block.type!=='context')||turn.message).map((turn,index)=>({id:turn.id,time:turn.created_at,index:base.length+index,kind:'turn' as const,turn}))].sort((first,second)=>first.time.localeCompare(second.time)||first.index-second.index);
  const chatItems=groupReplies(items,tasks,props.replyBusy??props.busy);
  const trees=traceRoots(tasks.filter(task=>!(task.origin==='follow_up'&&task.status==='completed'&&!task.activities.length)));
  const agentCount=collaborationStages(trees.map(tree=>tree.task),tasks).length;
  const taskContext=new Map<string,string>(),publicNotes=new Map<string,TraceNote[]>();
  for(const turn of turns) {
    const request=props.messages.find(message=>message.role==='user'&&message.turn_id===turn.id)?.text;
    for(const part of turnParts(turn,tasks)) {
      if(part.kind!=='work'||!part.task)continue;
      if(request)taskContext.set(part.task.id,request);
      const notes=part.blocks.filter(block=>block.type==='text'&&block.child_id&&block.text.trim()).map(block=>({role:block.role,text:block.text,status:block.status}));
      if(notes.length)publicNotes.set(part.task.id,notes);
    }
  }
  const active=tasks.find(task=>task.id===props.session?.active_task_id);
  const contextNotice=turns.flatMap(turn=>turn.blocks).filter(block=>block.type==='context'&&block.message).at(-1);
  const usage=props.session?.context_stats?.provider_usage as Record<string,number>|undefined;
  const actualInput=usage?.promptTokenCount??usage?.prompt_token_count??usage?.input_tokens??usage?.prompt_tokens;
  const actualOutput=usage?.candidatesTokenCount??usage?.candidates_token_count??usage?.output_tokens??usage?.completion_tokens;
  const replies=new Set([...props.messages.filter(message=>message.role==='assistant').map(message=>message.text),...turns.flatMap(turn=>turn.blocks.filter(block=>block.type==='text').map(block=>block.text))]);
  useEffect(()=>{if(follow.current&&view==='chat'&&history.current?.offsetParent)history.current.scrollTop=history.current.scrollHeight;},[items.length,props.session?.workflow?.revision,props.session?.conversation,view]);
  useEffect(()=>{if(props.highlight)setView('collab');},[props.highlight]);
  useEffect(()=>{
    if(!(inspected||props.highlight)||view!=='collab')return;
    const target=document.getElementById(`trace-${inspected||props.highlight}`);
    if(target&&history.current)history.current.scrollTop+=target.getBoundingClientRect().top-history.current.getBoundingClientRect().top-16;
  },[props.highlight,inspected,view]);
  return <>
    <header className="right-panel-heading"><span><Sparkles size={17}/>创作助手{props.session?.pending?.kind==='user'&&<span className="question-dot" title="有待回答的问题"/>}</span>
      <div className="assistant-header-tools">
        <Button variant="ghost" size="icon-sm" title="输入新要求" aria-label="输入新要求" onClick={()=>{setView('chat');props.onNewRequest();}}><Plus size={16}/></Button>
        <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon-sm" title="会话历史" aria-label="会话历史"><History size={16}/></Button></PopoverTrigger>
          <PopoverContent align="end" className="conversation-history-menu w-64">
            {props.session?.conversation_meta?<><span className="text-xs text-muted-foreground">对话分支</span><Select label="项目对话分支" value={props.session.conversation_meta.branch_id} disabled={props.busy} onValueChange={value=>props.onConversationAction?.('agent_switch_branch',{branch_id:value})}>{props.session.conversation_meta.branches.map(branch=><SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>)}</Select></>:<p>当前项目尚无对话分支。</p>}
            {contextNotice&&<p>{!props.busy&&contextNotice.status==='running'?'压缩已中断，原记录保留':contextNotice.message}</p>}
            {props.session?.context_stats&&<p>上下文约 {Math.round(props.session.context_stats.estimated_input/100)/10}k<small>{props.session.context_stats.basis} · 预算 {props.session.context_stats.budget}</small></p>}
            {typeof actualInput==='number'&&<p>渠道用量：输入 {actualInput}{typeof actualOutput==='number'?` · 输出 ${actualOutput}`:''}</p>}
          </PopoverContent>
        </Popover>
        <ActionMenu label="创作助手更多操作" trigger={<MoreHorizontal size={16}/>} size="icon-sm">
          <DropdownMenuItem disabled={!props.hasSelection} onSelect={props.onDetails}>节点详情</DropdownMenuItem>
          <DropdownMenuItem disabled={props.busy||!props.session?.conversation_meta} onSelect={()=>props.onConversationAction?.('agent_compact')}>压缩对话历史</DropdownMenuItem>
          {props.busy&&<DropdownMenuItem disabled={props.stopping} onSelect={props.onStop}>{props.stopping?'正在停止':'停止当前任务'}</DropdownMenuItem>}
        </ActionMenu>
      </div>
    </header>
    <div className="conversation-controls"><div className="conversation-view-switch" role="tablist" aria-label="对话视图">
      <button role="tab" aria-selected={view==='chat'} className={view==='chat'?'active':''} onClick={()=>setView('chat')}>对话</button>
      <button role="tab" aria-selected={view==='collab'} className={view==='collab'?'active':''} onClick={()=>setView('collab')}>协作{agentCount>0&&<span className="collaboration-count">{agentCount}</span>}</button>
    </div>{input.session?.book&&input.pageId&&<Select className="conversation-page-scope" label="对话页面范围" value={scope} onValueChange={setScope}><SelectItem value="page">当前页</SelectItem><SelectItem value="book">全书</SelectItem></Select>}</div>
    <div className="conversation-history" data-view={view} ref={history} onClickCapture={event=>{if((event.target as Element).closest('summary,[data-slot=collapsible-trigger],[data-slot=trace-collapsible-trigger]')){follow.current=false;setFollowing(false);}}} onScroll={()=>{const element=history.current;if(element){follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<70;setFollowing(follow.current);}}}>
      {view==='chat'?<>
        {!!chatItems.length&&<div className="conversation-context-divider">{input.session?.book?(input.pageId&&scope==='page'?`第 ${input.session.book.pages.find(page=>page.id===input.pageId)?.number} 页创作`:'全书创作'):'本页创作'}</div>}
        {!chatItems.length&&<p className="creative-empty">已有产物已载入。这里尚无创作对话，可以选中镜头后提出修改要求。</p>}
        {chatItems.map(item=>item.kind==='reply'?<Reply key={item.id} item={item} props={props} tasks={tasks} onInspect={inspectTask}/>:item.kind==='message'?<section key={item.id} className="user-message" aria-label="你的要求">
          {item.message.run&&input.session?.book&&<small className="message-page-origin">{runOrigin(item.message.run,input.session,props.runs)}</small>}<References items={item.message.references} onReference={props.onReference}/><div className="user-message-text">{item.message.text}</div>
          {props.onConversationAction&&(editing===item.id?<div className="history-edit"><Textarea aria-label="编辑历史要求" value={editText} onChange={event=>setEditText(event.target.value)}/><div><Button variant="ghost" size="sm" disabled={props.busy||!editText.trim()} onClick={()=>{props.onConversationAction?.('agent_fork',{message_id:item.id,text:editText,submit:true});setEditing(null);}}>发送新方案</Button><Button variant="ghost" size="sm" onClick={()=>setEditing(null)}>取消</Button></div></div>:<div className="user-message-actions"><Button variant="ghost" size="icon-sm" aria-label="编辑要求" disabled={props.busy} onClick={()=>{setEditing(item.id);setEditText(item.message.text);}}><Pencil size={12}/></Button><Button variant="ghost" size="icon-sm" aria-label="重新回答要求" disabled={props.busy} onClick={()=>props.onConversationAction?.('agent_fork',{message_id:item.id,text:item.message.text,submit:true})}><GitFork size={12}/></Button></div>)}
        </section>:<details key={item.id} className={`pending-revision ${item.request.status}`} open={item.request.status==='queued'}><summary>{item.request.status==='queued'?'等待送达':statusNames[item.request.status]||item.request.status} · {item.request.delivery==='follow_up'?'本轮结束后处理':'引导当前任务'}</summary><p>{item.request.text}</p><References items={item.request.references} onReference={props.onReference}/>{item.request.summary&&!replies.has(item.request.summary)&&<p>{readableSummary(item.request.summary)}</p>}
          {item.request.status==='queued'&&<div className="queue-actions"><Button variant="ghost" size="sm" onClick={()=>props.onWithdraw(item.request.id)}>撤回</Button>{!props.busy&&active?.status==='completed'&&item.request.delivery==='follow_up'&&<Button variant="ghost" size="sm" onClick={()=>props.onProcessRequest(item.request.id)}>开始处理</Button>}</div>}
        </details>)}
        {!!props.session?.events?.length&&!tasks.length&&<Disclosure className="historical-events" title={<>历史运行记录</>}>{props.session.events.filter(event=>event.type==='stage'&&event.data?.message).map((event,index)=><p key={event.id||index}>{event.data.message}</p>)}</Disclosure>}
      </>:<>
        {!trees.length&&<p className="creative-empty">还没有协作记录，运行一次创作后这里会显示 Creator／Reviewer 过程。</p>}
        {trees.map(root=><AgentTraceTree key={root.task.id} root={root} busy={props.busy} highlight={inspected||props.highlight} context={taskContext.get(root.task.id)} notes={publicNotes.get(root.task.id)||[]} origin={task=>runOrigin(task.run,props.session,props.runs)} onLocate={props.onLocate} onAction={props.onAction}/>)}
      </>}
    </div>
    {!following&&view==='chat'&&<Button variant="ghost" size="sm" className="conversation-latest" onClick={()=>{follow.current=true;setFollowing(true);if(history.current)history.current.scrollTop=history.current.scrollHeight;}}>回到最新消息</Button>}
  </>;
}
