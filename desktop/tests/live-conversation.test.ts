import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CreativeTimeline} from '../src/features/CreativeTimeline';
import {conversationEvent} from '../src/lib/conversation';
import type {AgentSession} from '../src/lib/types';

test('专业公开文字在完成前随事件显示，结束后保留在协作过程，旧轮不会冒充实时输出',()=>{
  let session={revision:0,messages:[],active_run:'',active_page_id:''} as AgentSession;
  let sequence=0;
  const event=(data:Record<string,unknown>)=>{session=conversationEvent(session,{event_id:String(++sequence),sequence,turn_id:'t',created_at:'2026-11-01',...data});};
  const render=()=>renderToStaticMarkup(createElement(CreativeTimeline,{session,messages:[],busy:true,stopping:false,onStop(){},onAction(){},onLocate(){},onWithdraw(){},onProcessRequest(){}}));
  event({kind:'tool',block_id:'c',call_id:'c',tool:'delegate',status:'running'});
  event({kind:'text',block_id:'b',child_id:'child',parent_call_id:'c',role:'script.creator',status:'running',delta:'正在整理'});
  assert.match(render(),/class="work-live"/);
  assert.match(render(),/正在整理/);
  event({kind:'text',block_id:'b',child_id:'child',parent_call_id:'c',status:'running',delta:'对白归属。'});
  assert.match(render(),/正在整理对白归属。/);
  event({kind:'text',block_id:'b',status:'completed'});
  event({kind:'tool',block_id:'c',status:'completed'});
  event({kind:'turn',status:'completed'});
  assert.doesNotMatch(render(),/class="work-live"/);
  assert.match(render(),/正在整理对白归属。/);
});
