import type {RunData} from './types';
import {currentPlan,sourceData} from './data';

export const runStageNames = {preprocess:'漫画分格',script:'来源脚本',arrangement:'镜头编排',direction:'演出方案',storyboard:'关键画面',video:'视频成片'};
export type RunStage = keyof typeof runStageNames;
export function nextRunStage(run:RunData|null):RunStage {
  if(!sourceData(run))return 'preprocess';
  const plan=currentPlan(run);
  const failed=(stage:string)=>plan?.reviews?.some((r:any)=>r.scope.split(':')[0]===stage&&!r.accepted);
  if(!plan?.script||failed('script'))return 'script';
  if(!plan.shot_list||failed('arrangement'))return 'arrangement';
  if(plan.shot_list.shots.some((s:any)=>s.type==='action'&&!plan.directions?.some((d:any)=>d.shot_id===s.shot_id))||failed('direction'))return 'direction';
  if(!run?.records.some(r=>r.file==='production.json')||failed('storyboard'))return 'storyboard';
  return 'video';
}
