import {ArrowRight,Check,ChevronDown,ChevronRight,Film,Focus,LoaderCircle,Network,TriangleAlert} from 'lucide-react';
import {roleLabel,readableSummary} from '../lib/presentation';
import {statusNames} from '../lib/timeline';
import {collaborationStages} from '../lib/trace';
import type {WorkflowTask} from '../lib/types';
import {Button} from './ui/button';

type Props = {task:WorkflowTask; roots?:WorkflowTask[]; tasks:WorkflowTask[]; busy:boolean;
  onLocate:(task:WorkflowTask,target?:string)=>void;
  onAction:(task:WorkflowTask,action:WorkflowTask['actions'][number])=>void;
  onInspect:(id?:string)=>void};

export function AgentCollaborationSummary({task,roots=[task],tasks,busy}:Props) {
  const rows=collaborationStages(roots,tasks);
  const passed=rows.filter(row=>row.reviews.length&&row.reviews.every(review=>review.accepted===true)&&row.task.status==='completed').length;
  const rejected=rows.some(row=>row.rejected.length);
  const overall=roots.find(root=>['failed','interrupted','waiting_user'].includes(root.status))||roots.at(-1)||task;
  const status=!busy&&overall.status==='running'?'interrupted':overall.status;
  return <details className="collaboration-summary" open>
    <summary><Network size={13}/><span>{rows.length?`${rows.length} 组 Agent 协作`:task.title}</span>
      <small>{passed?`${passed} 个阶段通过`:rejected?'需修订':statusNames[status]||status}</small><ChevronDown size={12}/></summary>
    <div className="collaboration-summary-body">
      {rows.map(row=>{
        const running=busy&&row.task.status==='running';
        const returned=!!row.rejected.length;
        const rowStatus=!busy&&row.task.status==='running'?'interrupted':row.task.status;
        const complete=rowStatus==='completed';
        const creators:Record<string,string>={script:'脚本创作',arrangement:'镜头编排',direction:'镜头演出',storyboard:'关键画面',video:'视频生成'};
        const reviewers:Record<string,string>={arrangement:'编排审查',storyboard:'画面审查'};
        return <div className={`collaboration-stage-row ${returned?'needs-revision':''}`} key={`${row.task.run}:${row.stage}`}>
          {running?<LoaderCircle size={12} className="runtime-spin"/>:returned||rowStatus==='failed'?<TriangleAlert size={12}/>:complete?<Check size={12}/>:<Network size={12}/>}
          <span className="collaboration-stage-roles">{row.roles.map((actor,index)=><span key={actor}>{index>0&&<ArrowRight size={10}/>}<span>{(actor.endsWith('.creator')?creators[row.stage]:reviewers[row.stage])||roleLabel(actor)}</span></span>)}</span>
          <small>{running?'执行中':returned?`${row.rejected.reduce((count,review)=>count+(review.issues?.length||1),0)} 项需修订`:complete?'完成':statusNames[rowStatus]||rowStatus}</small>
        </div>;
      })}
      {!rows.length&&task.summary&&<p>{readableSummary(task.summary)}</p>}
    </div>
  </details>;
}

export function AgentReviewFeedback({task,roots=[task],tasks,onLocate,onInspect}:Props) {
  const rows=collaborationStages(roots,tasks);
  const rejected=rows.flatMap(row=>row.rejected.map(review=>({review,task:row.task}))).sort((first,second)=>first.review.created_at.localeCompare(second.review.created_at)).at(-1);
  if(!rejected)return null;
  const {review,task:reviewTask}=rejected;
  const evidence=review.issues?.map(issue=>issue.evidence).filter(Boolean).join('；')||review.message||'审查退回，待修订。';
  const suggestions=[...new Set(review.issues?.map(issue=>issue.suggestion).filter(Boolean)||[])];
  const issue=review.issues?.find(issue=>issue.target||issue.location);
  const target=issue?.location?.match(/\bs\d{3}\b/i)?.[0]||issue?.target||review.target||'';
  const targetLabel=/^s\d+$/i.test(target)?`镜头 ${String(Number(target.slice(1))).padStart(2,'0')}`:target==='all'?'相关画面':target||'产物';
  const heading=review.actor==='video.reviewer'?'视频审查反馈':`${roleLabel(review.actor).replace(/审查$/,'')}审查反馈`;
  return <section className="conversation-review" aria-label={heading}>
    <div className="review-heading"><Film size={13}/><span>{heading}</span><span className="role">Reviewer</span></div>
    <p className="review-body">{evidence.split(/(\b\d{2}:\d{2}(?:\.\d+)?\b)/).map((part,index)=>/^\d{2}:\d{2}/.test(part)?<button className="time-reference" key={index} onClick={()=>onLocate(reviewTask,target)}>{part}</button>:part)}</p>
    <div className="review-actions"><Button variant="ghost" size="sm" className="locate-button" onClick={()=>onLocate(reviewTask,target)}><Focus size={12}/>定位{targetLabel}</Button>
      <Button variant="ghost" size="sm" className="muted-action" onClick={()=>onInspect(reviewTask.id)}>查看过程<ChevronRight size={12}/></Button></div>
    {!!suggestions.length&&<p className="review-recommendation">建议只修改相关片段：<strong>{suggestions.join('；')}</strong></p>}
  </section>;
}
