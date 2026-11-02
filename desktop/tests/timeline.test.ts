import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timeline} from '../src/lib/timeline';
import type {WorkflowTask,CanvasMessage,PendingRevision} from '../src/lib/types';

test('对话、任务和待处理修改保持顺序并去掉已接收修改的重复消息',()=>{
  const messages=[{id:'u1',role:'user',text:'规划',created_at:'2026-10-29T01:00:00Z'},
    {id:'r1',role:'user',text:'调整',created_at:'2026-10-29T01:02:00Z'}] as CanvasMessage[];
  const tasks=[{id:'t1',created_at:'2026-10-29T01:01:00Z'},
    {id:'child',parent_id:'t1',created_at:'2026-10-29T01:01:30Z'}] as WorkflowTask[];
  const requests=[{id:'r1',created_at:'2026-10-29T01:02:00Z'}] as PendingRevision[];
  assert.deepEqual(timeline(messages,tasks,requests).map(i=>[i.id,i.kind]),[['u1','message'],['t1','task'],['r1','revision']]);
});
