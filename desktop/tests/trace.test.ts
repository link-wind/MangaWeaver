import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteRoleChain,roleChain,traceArtifacts,traceReviews,traceRoots,traceTask} from '../src/lib/trace';
import type {TaskActivity,WorkflowTask} from '../src/lib/types';

function activity(values:Partial<TaskActivity>&{id:string;created_at:string}):TaskActivity{
  return {actor:'script.creator',role:'creator',target:'script',professional_stage:'script',iteration:0,status:'completed',...values} as TaskActivity;
}

test('连续同角色归并为一轮，角色切换保留 Creator／Reviewer 回路',()=>{
  const steps=roleChain([
    activity({id:'a1',created_at:'1',actor:'script.creator',role:'creator',iteration:0}),
    activity({id:'a2',created_at:'2',actor:'script.creator',role:'creator',iteration:1}),
    activity({id:'r1',created_at:'3',actor:'script.reviewer',role:'reviewer',iteration:1,accepted:false,issues:[{target:'script',location:'p1',evidence:'缺少手臂',suggestion:'补全'}]}),
    activity({id:'a3',created_at:'4',actor:'script.creator',role:'creator',iteration:2}),
    activity({id:'r2',created_at:'5',actor:'script.reviewer',role:'reviewer',iteration:2,accepted:true}),
  ]);
  assert.deepEqual(steps.map(step=>[step.actor,step.rounds,step.accepted]),[
    ['script.creator',2,undefined],
    ['script.reviewer',1,false],
    ['script.creator',1,undefined],
    ['script.reviewer',1,true],
  ]);
  assert.equal(steps[1].issues.length,1);
});

test('子任务按 parent_id 归属父任务，根任务只返回顶层',()=>{
  const parent={id:'p',parent_id:'',created_at:'1',activities:[]} as unknown as WorkflowTask;
  const child={id:'c',parent_id:'p',created_at:'2',activities:[]} as unknown as WorkflowTask;
  const other={id:'o',parent_id:'',created_at:'0',activities:[]} as unknown as WorkflowTask;
  const tree=traceTask(parent,[parent,child,other]);
  assert.deepEqual(tree.children.map(node=>node.task.id),['c']);
  assert.deepEqual(traceRoots([parent,child,other]).map(node=>node.task.id),['o','p']);
});

test('产物合并 report 与活动产物，去重',()=>{
  const task={id:'t',parent_id:'',created_at:'1',activities:[
    activity({id:'a1',created_at:'1',artifact:'frames/1.png'}),
    activity({id:'a2',created_at:'2',artifact:'frames/1.png'}),
  ],report:{artifacts:['frames/2.png']}} as unknown as WorkflowTask;
  assert.deepEqual(traceArtifacts(task),['frames/2.png','frames/1.png']);
  assert.deepEqual(traceReviews(task),[]);
});

test('公开说明在缺少任务活动时补出角色链，不做审查判断',()=>{
  const chain=noteRoleChain([{role:'script.creator',text:'整理'},{role:'script.creator',text:'补全'},{role:'script.reviewer',text:'检查',status:'running'}]);
  assert.deepEqual(chain.map(step=>[step.actor,step.rounds,step.accepted]),[['script.creator',2,undefined],['script.reviewer',1,undefined]]);
});
