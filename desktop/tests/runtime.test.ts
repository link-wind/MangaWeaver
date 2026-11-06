import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graph, canvasState, type CanvasNode} from '../src/lib/canvas';
import {executionRecords, mergeEvents, nodeProgress} from '../src/lib/runtime';
import type {EngineEvent, RunData} from '../src/lib/types';
const event = (type: EngineEvent['type'], stage:string, data:any={}, id=stage):EngineEvent => ({version:1,request_id:'run-operation',run_dir:'/run',type,stage,data,id});
test('real events reveal nodes progressively and preserve failure without fabricating future cards', () => {
  const run: RunData = {directory:'/run',original_page:'/page.png',experimental:false,media:[],records:[]};
  const state = canvasState(run);
  assert.deepEqual(graph(run,state).nodes.map(n => n.id), ['source']);
  const events = [event('started','plan'),event('stage','script')];
  assert.equal(graph(run,state,events,true).nodes.find(n => n.id === 'arrangement')?.data.progress, 'running');
  events.push(event('failed','script',{message:'渠道不可用'},'terminal'));
  const failed = graph(run,state,events,false);
  assert.equal(failed.nodes.find(n => n.id === 'arrangement')?.data.progress, 'failed');
  assert.ok(!failed.nodes.some(n => ['shot','frame','video'].includes(n.data.kind)));
  const records = executionRecords(events);
  assert.equal(records.find(r => r.label === '来源脚本')?.status, 'failed');
  assert.equal(records.find(r => r.label === '项目运行')?.message, '渠道不可用');
  assert.equal(mergeEvents(events,events).length,events.length);
  events.push(event('stage','canvas.delete',{status:'completed'},'deleted'));
  assert.deepEqual(graph(run,state,events,false).nodes.map(n=>n.id),['source']);
});
test('interrupted history does not keep spinning or hide blocked Agent tools', () => {
  const events = [event('started','agent_message'),event('stage','agent.tool',{tool:'delegate',call_id:'a',status:'running'})];
  assert.equal(executionRecords(events).at(-1)?.status,'interrupted');
  events.push(event('stage','agent.tool',{tool:'delegate',call_id:'a',status:'blocked'},'blocked'));
  events.push(event('completed','agent.tool',{},'terminal'));
  assert.equal(executionRecords(events).find(r => r.label === '项目运行')?.status,'blocked');
  assert.equal(executionRecords(events).filter(r => r.label === '专业任务').length,1);
  const stopped=[event('started','plan'),event('stage','script'),event('failed','script',{status:'interrupted',message:'已停止'},'terminal')];
  assert.ok(executionRecords(stopped).every(r=>r.status==='interrupted'));
});
test('simulation starts with only a page and never labels a segment as the final preview', () => {
  const run: RunData = {directory:'/demo',simulation:{step:0,completed:false,label:'模拟任务',api_calls:0},original_page:'/demo/input/page.png',experimental:false,records:[],media:['/demo/video/s001/simulation/simulation.mp4']};
  assert.deepEqual(graph(run,canvasState(run)).nodes.map(n => n.id),['source']);
  run.media.push('/demo/simulation.mp4');
  assert.equal(graph(run,canvasState(run)).nodes.find(n => n.id === 'final')?.data.title,'模拟预览');
});
test('parallel submitted video remains running while a different shot is polled', () => {
  const node = {id:'video:s002:0',data:{kind:'video',location:'s002',status:'waiting',detail:{task_id:'remote-2',status:'submitted'}}} as CanvasNode;
  const events = [event('stage','video.query',{shot_id:'s001',segment_id:'s001_seg01'})];
  assert.equal(nodeProgress(node,events,true),'running');
  assert.equal(nodeProgress(node,events,false),'waiting');
});

test('professional reviewer progress survives task snapshot events and targets its keyframe',()=>{
  const node={id:'frame:k001',data:{kind:'frame',location:'s001:k001',status:'ready'}} as CanvasNode;
  const events=[event('stage','professional',{professional_stage:'storyboard',target:'k001',role:'Reviewer',status:'running'}),
    event('stage','workflow.task',{task:{id:'task-1',status:'running'}},'snapshot')];
  assert.equal(nodeProgress(node,events,true),'running');
  assert.equal(nodeProgress({...node,id:'frame:k002'},events,true),'completed');
});
