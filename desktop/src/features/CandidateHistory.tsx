import { useEffect,useState } from 'react';
import { Disclosure } from '../components/Disclosure';
import { Media } from '../components/Media';
import { Button } from '../components/ui/button';

type Candidate={id:string;image:string;version:string;revision:string;current:boolean;accepted:boolean;can_adopt:boolean;reason:string;asset:{plan_signature:string;image_signature:string};review?:{accepted:boolean;reason:string}|null};
export function CandidateHistory({run,keyframe,busy,onAdopt}:{run:string;keyframe:string;busy:boolean;onAdopt:()=>Promise<void>}){
  const [data,setData]=useState<{items:Candidate[];plan_revision:string|null}|null>(null),[chosen,setChosen]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
  useEffect(()=>{let active=true;window.manga.run('read_candidates',{run_dir:run,keyframe}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[run,keyframe]);
  const item=data?.items.find(i=>i.id===chosen)||data?.items.find(i=>i.current)||data?.items[0];
  async function adopt(){
    if(!item?.can_adopt)return;
    setWorking(true);setError('');
    try{await window.manga.run('adopt_candidate',{run_dir:run,keyframe,candidate:item.id,candidate_revision:item.revision,expected_revision:data!.plan_revision});setData(await window.manga.run('read_candidates',{run_dir:run,keyframe}));await onAdopt();}
    catch(e){setError((e as Error).message);}finally{setWorking(false);}
  }
  return <Disclosure className="candidate-history" title={<>已有候选{data?` · ${data.items.length}`:''}</>}>
    {error&&<p role="alert">{error}</p>}
    {!data?<p>正在读取…</p>:!item?<p>没有保留的候选记录。</p>:<>
      <div className="candidate-thumbnails" aria-label="关键画面候选">{data.items.map((candidate,index)=><Button variant="ghost" size="sm" className="h-auto shrink-0 flex-col border p-1" key={candidate.id} aria-label={`预览候选 ${index+1}${candidate.current?'，当前采用':''}`} aria-pressed={item.id===candidate.id} onClick={()=>setChosen(candidate.id)}><Media path={candidate.image} revision={candidate.asset.image_signature} alt={`候选 ${index+1}`}/><span>{index+1}{candidate.current?' · 当前':''}</span></Button>)}</div>
      <Media path={item.image} revision={item.asset.image_signature} alt="候选预览"/>
      <p>{item.current?'当前采用':'仅预览'} · {item.accepted?'审查选中':item.review?'未获选中':'未审查'}</p>
      {item.review?.reason&&<p>{item.review.reason}</p>}
      <small>来源版本 {item.asset.plan_signature.slice(0,10)}</small>
      {item.reason&&<p className="candidate-reason">{item.reason}</p>}
      {!item.current&&<Button variant="ghost" size="sm" className="candidate-adopt" disabled={busy||working||!item.can_adopt} onClick={()=>void adopt()}>{working?'正在采用…':'采用此候选'}</Button>}
    </>}
  </Disclosure>;
}
