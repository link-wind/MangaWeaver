import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnParts,readableSummary,taskOwnsError,runOrigin,workSummary} from '../src/lib/presentation';
import type {AgentSession,ConversationBlock,ConversationTurn,WorkflowTask,RunData,TaskActivity} from '../src/lib/types';

test('父工具与专业事件归为同一任务，保留公开回复顺序与原始参数',()=>{
  const blocks:ConversationBlock[]=[
    {id:'before',type:'text',text:'开始编排'},
    {id:'call',type:'tool',text:'',call_id:'c1',tool:'delegate',arguments:{dry_run:false,iteration:0}},
    {id:'child',type:'text',text:'需要确认配色',child_id:'s1',parent_call_id:'c1'},
    {id:'question',type:'question',text:'背景选什么颜色？',child_id:'s1',parent_call_id:'c1'},
    {id:'after',type:'text',text:'等待你的选择'},
  ];
  const turn={id:'t',status:'waiting_user',created_at:'',blocks} as ConversationTurn;
  const task={id:'task',call_id:'c1',parent_id:''} as WorkflowTask;
  const parts=turnParts(turn,[task]);
  assert.deepEqual(parts.map(p=>p.kind),['text','work','text']);
  assert.equal(parts[1].kind,'work');
  if(parts[1].kind==='work'){
    assert.equal(parts[1].task,task);
    assert.deepEqual(parts[1].blocks.map(b=>b.id),['call','child','question']);
    assert.deepEqual(parts[1].root?.arguments,{dry_run:false,iteration:0});
  }
});

test('技术超时生成短说明，内容审查中的时长问题保留原意',()=>{
  assert.equal(readableSummary('curl: (28) Operation timed out after 120000 milliseconds'),'模型请求超时，进度已保留。');
  assert.equal(readableSummary('镜头动作超时，需要缩短停顿。'),'镜头动作超时，需要缩短停顿。');
  assert.equal(readableSummary('HTTP 503 上游账号耗尽'),'模型服务暂不可用，进度已保留。');
});

test('仅有对应失败任务事实时合并异常，不吞掉独立文件错误',()=>{
  const error='模型请求 HTTP 503 上游账号耗尽，已保留运行结果';
  const task={status:'failed',summary:error,activities:[]} as unknown as WorkflowTask;
  assert.equal(taskOwnsError(error,[task]),true);
  assert.equal(taskOwnsError('无法读取漫画文件',[task]),false);
  assert.equal(taskOwnsError(error,[{...task,status:'completed'}]),false);
});

test('任务页码依据确切运行映射，多书与未知来源不继承当前页或目录数字',()=>{
  const session={active_page_id:'page012',book:{id:'b1',pages:[{id:'page010',number:10},{id:'page012',number:12}]},page_runs:{'b1:page010':'/r/ten','other:page012':'/r/page012'}} as unknown as AgentSession;
  assert.equal(runOrigin('/r/ten',session),'文件第 10 页');
  assert.equal(runOrigin('/r/page012',session),'运行 · page012');
  assert.equal(runOrigin(undefined,session),'历史运行');
  const runs=[{directory:'/other/known',book_page:{book_id:'other',page_id:'page002',number:2}},{directory:'/r/standalone'}] as RunData[];
  assert.equal(runOrigin('/other/known',session,runs),'其他漫画 · 文件第 2 页');
  assert.equal(runOrigin('/r/standalone',session,runs),'独立运行 · standalone');
});

test('短结论只采用最新审查事实，新创作和异常不继承旧通过，也不编造问题数量',()=>{
  const review={actor:'script.reviewer',role:'reviewer',accepted:true,status:'completed'} as TaskActivity;
  assert.equal(workSummary('completed',[review],'完整审查依据'),'审查通过');
  assert.equal(workSummary('completed',[review],'模拟完成 · 本地静帧预览，非 AI 成片',true),'模拟完成 · 本地静帧预览，非 AI 成片');
  assert.equal(workSummary('running',[review,{...review,actor:'script.creator',role:'creator',accepted:undefined,status:'running'}],''),'脚本创作中');
  assert.equal(workSummary('completed',[],'任务完成'),'任务完成');
  assert.equal(workSummary('completed',[{...review,accepted:false}],'退回'),'需要修订');
  assert.equal(workSummary('failed',[review],'请求超时'),'模型请求超时，进度已保留。');
});
