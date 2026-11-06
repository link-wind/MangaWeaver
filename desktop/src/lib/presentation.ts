import type {AgentSession,ConversationBlock,ConversationTurn,WorkflowTask,RunData,TaskActivity,CanvasReference} from './types';

/** 页码只来自相同运行的确切映射，不使用当前页或目录名猜测。 */
export function runOrigin(run:string|undefined,session?:AgentSession|null,runs:RunData[]=[]){
  if(!run)return '历史运行';
  const book=session?.book;
  const page=book?.pages.find(p=>session?.page_runs?.[`${book.id}:${p.id}`]===run);
  if(page)return `文件第 ${page.number} 页`;
  const known=runs.find(r=>r.directory===run);
  if(known?.simulation)return '本地示例';
  if(known?.book_page)return `${book&&known.book_page.book_id!==book.id?'其他漫画 · ':''}文件第 ${known.book_page.number} 页`;
  const name=run.split('/').filter(Boolean).at(-1)||run;
  return known?`独立运行 · ${name}`:`运行 · ${name}`;
}

export function workSummary(status:string,activities:TaskActivity[],raw:string,simulation=false){
  if(simulation)return readableSummary(raw);
  const last=activities.at(-1);
  const review=last&&/reviewer|审查/.test(last.actor+' '+last.role);
  if(['waiting_user','needs_user'].includes(status))return '等待你的确认后继续。';
  if(review&&last.accepted===false&&!['failed','interrupted'].includes(status))
    return '需要修订'+(last.issues?.length?` · ${last.issues.length} 项问题`:'');
  if(status==='completed'&&review&&last.accepted===true)return '审查通过';
  if(status==='running'&&last?.status==='running')return `${roleLabel(last.actor)||'任务'}中`;
  return readableSummary(raw);
}

export const toolNames:Record<string,string>={read_project:'读取项目',read_pages:'查看漫画',select_page:'选择页面',create_run:'创建运行',
  preprocess_page:'漫画分格',delegate:'专业任务',produce:'分阶段制作',generate:'视频生成',control_canvas:'调整画布',resume:'恢复原任务',
  read_sources:'读取来源',read_feedback:'读取审查反馈'};
export function roleLabel(role?:string){
  const [stage,kind]=(role||'').split('.');
  const names:Record<string,string>={script:'脚本',arrangement:'镜头编排',direction:'演出',storyboard:'关键画面',video:'视频',characters:'角色',dialogue:'对白'};
  return (names[stage]||stage)+(kind==='creator'?'创作':kind==='reviewer'?'审查':'');
}
export function readableSummary(text:string){
  if(/已有产物输入不同/.test(text))return '当前输入与已有产物不一致，请使用新运行或显式重跑。';
  if(/curl.*\b28\b|(?:request|connection|operation|read)\s+(?:timed?\s*out|timeout)|(?:请求|连接|模型响应)超时|TimeoutError/i.test(text))return '模型请求超时，进度已保留。';
  if(/HTTP\s*(429|50[0234])|上游账号耗尽/i.test(text))return '模型服务暂不可用，进度已保留。';
  if(/curl.*请求失败|connection|network/i.test(text))return '模型连接失败，进度已保留。';
  const stages:Record<string,string>={script:'来源脚本',arrangement:'镜头编排',direction:'演出方案',storyboard:'关键画面',video:'视频'};
  return text.replace(/\b(script|arrangement|direction|storyboard|video)\b/g,k=>stages[k]).split('\n')[0].slice(0,150);
}
export type TurnPart={kind:'text';block:ConversationBlock}|{kind:'work';id:string;blocks:ConversationBlock[];root?:ConversationBlock;task?:WorkflowTask};
export function liveWorkText(part:Extract<TurnPart,{kind:'work'}>,active:boolean){
  if(!active)return;
  const block=part.blocks.filter(b=>b.type==='text'&&b.child_id).at(-1);
  const end=part.blocks.filter(b=>b.type==='child'||b.type==='delivery').at(-1);
  const status=part.task?.status||part.root?.status||end?.status;
  return block&&(status==='running'||block.status==='running')?block:undefined;
}
export function turnParts(turn:ConversationTurn,tasks:WorkflowTask[]):TurnPart[]{
  const result:TurnPart[]=[];
  const groups=new Map<string,Extract<TurnPart,{kind:'work'}>>();
  const rootCalls=new Set(turn.blocks.filter(b=>b.type==='tool'&&!b.child_id&&!b.parent_call_id).map(b=>b.call_id||b.id));
  for(const block of turn.blocks){
    if(block.type==='context'||(block.type==='text'&&!block.text))continue;
    if(block.type==='text'&&!block.child_id){result.push({kind:'text',block});continue;}
    const parent=block.parent_call_id&&rootCalls.has(block.parent_call_id)?block.parent_call_id:undefined;
    const standalone=block.type==='tool'&&!block.child_id&&!parent;
    const key=parent||(standalone?(block.call_id||block.id):'professional');
    let part=groups.get(key);
    if(!part){part={kind:'work',id:key,blocks:[]};groups.set(key,part);result.push(part);}
    part.blocks.push(block);
    if(standalone){part.root=block;part.task=tasks.find(t=>!t.parent_id&&t.call_id===key);}
  }
  return result;
}

export function taskOwnsError(error:string,tasks:WorkflowTask[]){
  if(!error)return false;
  return tasks.some(t=>['failed','interrupted','waiting_user'].includes(t.status)&&
    [t.summary,...t.activities.map(a=>a.message||'')].some(message=>message&&message.length>12&&
      (error.includes(message)||message.includes(error))));
}

export function referenceLabel(ref:CanvasReference){
  return `${ref.page?.number?`第 ${ref.page.number} 页 · `:''}${ref.label}`;
}
