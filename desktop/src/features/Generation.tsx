import { useState } from 'react';
import { Layers, Play, RefreshCw } from 'lucide-react';
import { Disclosure } from '../components/Disclosure';
import { StatusBadge } from '../components/StatusBadge';
import { Alert,AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Item } from '../components/ui/item';
import { filename,taskEntries } from '../lib/data';
import { statusNames } from '../lib/timeline';
import type { RunData } from '../lib/types';

const segmentOf=(file:string)=>file.replace(/\/tasks.json$/,'').split('/').pop()||'';

export function Generation({run,busy,blocker,onGenerate,onResume,onPlanning,onRedo,onAssemble}:{
  run:RunData|null;busy:boolean;blocker?:string;
  onGenerate:(dry:boolean)=>void;onResume:()=>void;onPlanning:()=>void;
  onRedo:(segment:string,feedback:string)=>void;onAssemble:()=>void}){
  const tasks=taskEntries(run),plan=run?.records.some(r=>r.file==='production.json');
  const available=!!run&&!run.experimental&&!run.simulation;
  const payload=run?.records.find(r=>r.file==='generation_tasks.json');
  const [redoSegment,setRedoSegment]=useState<string|null>(null);
  const [feedback,setFeedback]=useState('');
  return <div className="specialist-page generation-page">
    <div className="section-heading"><div><h2>视频任务</h2><p>{tasks.length?`${tasks.length} 个候选任务`:'规划通过后，可预览并提交视频任务。'}</p></div><div className="row">
      <Button size="sm" disabled={busy||!plan||!available} onClick={()=>onGenerate(true)}>预览任务</Button>
      <Button size="sm" disabled={busy||!plan||!available} onClick={onAssemble}><Layers size={14}/>重组装成片</Button>
      <Button size="sm" variant="default" disabled={busy||!plan||!available||!!blocker} onClick={()=>onGenerate(false)}><Play size={14}/>生成视频 · 付费</Button>
    </div></div>
    {!plan&&<div className="inline-guidance"><span>尚无通过审查的规划。</span><Button size="sm" variant="ghost" onClick={onPlanning}>查看规划</Button></div>}
    {blocker&&<Alert><AlertDescription>{blocker}</AlertDescription></Alert>}
    {run?.experimental&&<p className="inline-guidance">历史实验只读，不提交正式制作。</p>}
    {redoSegment&&<div className="inline-guidance">
      <span>重提 {redoSegment} 会作废该段未通过候选并重新提交（付费）。</span>
      <Input value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="交给视频评审的修订反馈（可留空）"/>
      <Button size="sm" variant="default" disabled={busy} onClick={()=>{onRedo(redoSegment,feedback);setRedoSegment(null);setFeedback('');}}>确认重提 · 付费</Button>
      <Button size="sm" variant="ghost" onClick={()=>{setRedoSegment(null);setFeedback('');}}>取消</Button>
    </div>}
    <div className="section-heading"><h3>任务记录</h3><div className="row">
      <Button size="sm" disabled={busy||!tasks.length||!available} onClick={onResume}><RefreshCw size={14}/>查询并下载</Button>
    </div></div>
    <div className="generation-task-list">{tasks.map((task:any,i:number)=>{
      const segment=segmentOf(task.file);
      return <Item variant="outline" key={`${task.file}/${task.id}`} className="generation-task-row">
      <div><strong>{task.file.replace(/\/tasks.json$/,'').split('/').slice(-2).join(' · ')}</strong><small>候选 {task.id}</small></div>
      <StatusBadge status={task.status}>{statusNames[task.status]||task.status}</StatusBadge>
      {available&&tasks.findIndex(t=>segmentOf(t.file)===segment)===i&&
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>{setRedoSegment(segment);setFeedback('');}}>重提此段 · 付费</Button>}
      <Disclosure  title={<>任务详情</>}><dl><dt>远端 ID</dt><dd>{task.task_id||'尚无任务 ID，请核查提交结果'}</dd></dl><pre>{JSON.stringify(task,null,2)}</pre></Disclosure>
    </Item>;})}
    </div>
    {!tasks.length&&<div className="specialist-empty">暂无视频任务。预览任务不会调用视频生成；评审未通过的段可用"重提此段"作废候选并重新提交。</div>}
    {payload&&<Disclosure className="details" title={<>生成提示词与原始任务 · {filename(payload.file)}</>}><pre>{JSON.stringify(payload.data,null,2)}</pre></Disclosure>}
  </div>;
}
