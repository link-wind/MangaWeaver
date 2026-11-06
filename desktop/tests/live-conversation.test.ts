import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CreativeTimeline} from '../src/features/CreativeTimeline';
import {conversationEvent} from '../src/lib/conversation';
import type {AgentSession} from '../src/lib/types';

test('专业公开文字运行中进入对话流，完成后转入协作记录，旧轮不会冒充实时输出',()=>{
  let session={revision:0,messages:[],active_run:'',active_page_id:''} as AgentSession;
  let sequence=0;
  const event=(data:Record<string,unknown>)=>{session=conversationEvent(session,{event_id:String(++sequence),sequence,turn_id:'t',created_at:'2026-11-01',...data});};
  const render=()=>renderToStaticMarkup(createElement(CreativeTimeline,{session,messages:[],busy:true,stopping:false,onStop(){},onAction(){},onLocate(){},onWithdraw(){},onProcessRequest(){},onNewRequest(){},onDetails(){},hasSelection:false}));
  event({kind:'tool',block_id:'c',call_id:'c',tool:'delegate',status:'running'});
  event({kind:'text',block_id:'b',child_id:'child',parent_call_id:'c',role:'script.creator',status:'running',delta:'正在整理'});
  assert.match(render(),/class="stream-text"/);
  assert.match(render(),/正在整理/);
  event({kind:'text',block_id:'b',child_id:'child',parent_call_id:'c',status:'running',delta:'对白归属。'});
  assert.match(render(),/正在整理对白归属。/);
  event({kind:'text',block_id:'b',status:'completed'});
  event({kind:'tool',block_id:'c',status:'completed'});
  event({kind:'turn',status:'completed'});
  const completed=render();
  assert.doesNotMatch(completed,/class="stream-text"/);
  assert.doesNotMatch(completed,/正在整理对白归属。/);
  assert.equal(session.conversation?.[0].blocks.find(block=>block.id==='b')?.text,'正在整理对白归属。');
});

test('批量流式归并保持输入不变并忽略重复及其他分支事件',async()=>{
  const {conversationEvents}=await import('../src/lib/conversation');
  const session={revision:0,messages:[],active_run:'',active_page_id:'',conversation_meta:{branch_id:'main'},conversation:[]} as unknown as AgentSession;
  const base={turn_id:'t',created_at:'2026-11-03',kind:'text',block_id:'b',branch_id:'main'};
  const first={...base,event_id:'e1',sequence:1,delta:'甲'};
  const next=conversationEvents(session,[first,first,{...base,event_id:'other',sequence:2,branch_id:'other',delta:'错误'},{...base,event_id:'e2',sequence:3,delta:'乙'}]);
  assert.equal(next.conversation?.[0].blocks[0].text,'甲乙');
  assert.deepEqual(session.conversation,[]);
  assert.equal(next.conversation_sequence,3);
});

test('回复结束后才显示底部操作，新轮运行不影响已结束的历史回复',()=>{
  const messages=[
    {id:'u1',role:'user',text:'第一轮',created_at:'1'},
    {id:'u2',role:'user',text:'第二轮',created_at:'3'},
  ] as AgentSession['messages'];
  const session={revision:0,messages,active_run:'',active_page_id:'',conversation:[
    {id:'t1',created_at:'2',status:'completed',blocks:[{id:'b1',type:'text',text:'历史回复',status:'completed'}]},
    {id:'t2',created_at:'4',status:'running',blocks:[
      {id:'b2',type:'text',text:'文字已输出，工具仍在运行',status:'completed'},
      {id:'c2',type:'tool',tool:'delegate',text:'',status:'running'},
    ]},
  ]} as AgentSession;
  const render=(busy:boolean)=>renderToStaticMarkup(createElement(CreativeTimeline,{session,messages,busy,stopping:false,onStop(){},onAction(){},onLocate(){},onWithdraw(){},onProcessRequest(){},onNewRequest(){},onDetails(){},hasSelection:false}));
  const countActions=(html:string)=>(html.match(/class="message-actions"/g)||[]).length;
  assert.equal(countActions(render(true)),1);
  session.conversation![1].status='completed';
  session.conversation![1].blocks[1].status='completed';
  assert.equal(countActions(render(false)),2);
  session.conversation![1].status='interrupted';
  assert.equal(countActions(render(false)),2);
});

test('首段文字早于任务记录到达时也不显示回复底部操作',()=>{
  const messages=[{id:'a',role:'assistant',text:'正在准备本地演示。',created_at:'1'}] as AgentSession['messages'];
  const html=renderToStaticMarkup(createElement(CreativeTimeline,{messages,busy:true,stopping:false,onStop(){},onAction(){},onLocate(){},onWithdraw(){},onProcessRequest(){},onNewRequest(){},onDetails(){},hasSelection:false}));
  assert.match(html,/正在准备本地演示/);
  assert.doesNotMatch(html,/class="message-actions"/);
});
