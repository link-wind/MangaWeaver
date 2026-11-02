import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationEvent} from '../src/lib/conversation';
import type {AgentSession} from '../src/lib/types';

test('对话文字按块归并，已恢复事件和其他分支事件不重复应用',()=>{
  let session={revision:0,messages:[],active_run:'',active_page_id:'',conversation_meta:{version:1,session_id:'s',branch_id:'main',branches:[]}} as AgentSession;
  const event={event_id:'1',sequence:1,branch_id:'main',turn_id:'t',kind:'text',block_id:'b',delta:'漫画',status:'running',created_at:'2026-11-01'};
  session=conversationEvent(session,event);
  session=conversationEvent(session,event);
  session=conversationEvent(session,{...event,event_id:'2',sequence:2,delta:'动画'});
  assert.equal(session.conversation?.[0].blocks[0].text,'漫画动画');
  session=conversationEvent(session,{...event,event_id:'3',sequence:3,branch_id:'other',delta:'错误'});
  assert.equal(session.conversation?.[0].blocks[0].text,'漫画动画');
  session=conversationEvent(session,{...event,event_id:'4',sequence:4,kind:'turn',status:'failed',message:'断流'});
  assert.equal(session.conversation?.[0].status,'failed');
  assert.equal(session.conversation?.[0].blocks[0].status,'running'); // 未被伪造为完成。
});
