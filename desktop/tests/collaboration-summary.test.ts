import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentCollaborationSummary,AgentReviewFeedback} from '../src/components/AgentCollaborationSummary';
import type {WorkflowTask,TaskActivity} from '../src/lib/types';
const activity=(accepted:boolean,id:string)=>({id,created_at:id,actor:'script.reviewer',role:'reviewer',status:'completed',accepted,messages:[],issues:[{evidence:'旧轮缺少手臂',suggestion:'补齐'}]} as unknown as TaskActivity);
const task=(id:string,parent:string|null,activities:TaskActivity[]=[])=>({id,parent_id:parent,title:id,stage:'script',created_at:id,status:'completed',activities,actions:[],summary:''} as unknown as WorkflowTask);
const html=(root:WorkflowTask,tasks:WorkflowTask[])=>renderToStaticMarkup(createElement(AgentCollaborationSummary,{task:root,tasks,busy:false,onLocate(){},onAction(){},onInspect(){}}));
test('摘要使用父子真实角色，已通过的新审查不会继续展示旧轮退回原因',()=>{
 const root=task('a',null),child=task('b','a',[activity(false,'1'),activity(true,'2')]);
 const output=html(root,[root,child]);assert.match(output,/脚本审查/);assert.match(output,/通过/);assert.doesNotMatch(output,/旧轮缺少手臂|需修订/);
 const rejected=task('b','a',[activity(false,'1')]);
 const review=renderToStaticMarkup(createElement(AgentReviewFeedback,{task:root,roots:[root],tasks:[root,rejected],busy:false,onLocate(){},onAction(){},onInspect(){}}));
 assert.match(review,/旧轮缺少手臂/);
});
test('确定性工具子任务不被计为多个 Agent',()=>{
 const root=task('a',null);assert.doesNotMatch(html(root,[root,task('b','a'),task('c','a')]),/组 Agent/);
});
test('分目标审查不被其他目标的通过覆盖，反馈在协作折叠之外',()=>{
 const root=task('a',null);
 const first={...activity(false,'1'),role:'Reviewer',target:'s001'};
 const second={...activity(true,'2'),role:'Reviewer',target:'s002'};
 const child=task('b','a',[first,second]);
 const summary=html(root,[root,child]);
 const review=renderToStaticMarkup(createElement(AgentReviewFeedback,{task:root,tasks:[root,child],busy:false,onLocate(){},onAction(){},onInspect(){}}));
 assert.match(summary,/1 项需修订/);
 assert.doesNotMatch(summary,/旧轮缺少手臂/);
 assert.match(review,/旧轮缺少手臂/);
 assert.doesNotMatch(review,/<details/);
});
