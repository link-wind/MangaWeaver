import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {bookGraph,emptyView,groupKey,nodeKey} from '../src/lib/bookCanvas';
import {canvasState} from '../src/lib/canvas';
import {pageRange} from '../src/features/BookPicker';
import {nextRunStage} from '../src/lib/runStages';
import type {AgentSession,Book,RunData} from '../src/lib/types';
import {pageConversation,pageStatus} from '../src/lib/bookWorkspace';
const fixture=JSON.parse(readFileSync(resolve('../examples/cross-panel/production.json'),'utf8'));
function run(directory:string):RunData{return {directory,original_page:'/page.png',experimental:false,records:[{file:'production.json',data:fixture}],media:[]};}
const book:Book={id:'book-test',name:'示例',page_count:2,pages:[1,2].map(n=>({id:`page${n}`,number:n,image:'/page.png',thumbnail:'/thumb.png'}))};
test('semantic groups redirect edges, retain logical identity and avoid cross-page collisions',()=>{
  const a=run('/a'),b=run('/b'),view=emptyView();
  const branches=[{directory:'/a',number:1,run:a,state:canvasState(a)},{directory:'/b',number:2,run:b,state:canvasState(b)}];
  view.collapsed_groups=[groupKey('/a','panel'),groupKey('/a','frame')];
  view.positions[nodeKey('/a','shot:s001',book)]={x:123,y:456};
  const folded=bookGraph(branches,'/a',view,[],false,book);
  const ids=new Set(folded.nodes.map(n=>n.id));
  assert.equal(ids.size,folded.nodes.length);
  assert.ok(!ids.has(nodeKey('/a','panel:p001',book)));
  assert.ok(ids.has(nodeKey('/b','panel:p001',book)));
  assert.ok(folded.logical.some(n=>n.id===nodeKey('/a','panel:p001',book)));
  assert.ok(folded.edges.some(e=>e.source===groupKey('/a','panel')&&e.target===nodeKey('/a','arrangement',book)));
  assert.ok(folded.edges.every(e=>ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target));
  assert.deepEqual(folded.nodes.find(n=>n.id===nodeKey('/a','shot:s001',book))?.position,{x:123,y:456});
  view.collapsed_pages=['/a'];
  const pageFolded=bookGraph(branches,'/b',view,[],false,book);
  assert.deepEqual(pageFolded.nodes.filter(n=>n.data.run==='/a').map(n=>n.id),['page:/a']);
  assert.ok(pageFolded.nodes.some(n=>n.id===nodeKey('/b','shot:s001',book)));
  view.collapsed_pages=[];view.collapsed_groups=[];
  assert.ok(bookGraph(branches,'/a',view,[],false,book).nodes.some(n=>n.id===nodeKey('/a','panel:p001',book)));
});
test('page ranges are explicit file order and reject malformed or out-of-book targets',()=>{
  assert.deepEqual(pageRange('2-4,8，3',10),[2,3,4,8]);
  assert.throws(()=>pageRange('0-2',10));assert.throws(()=>pageRange('4-2',10));assert.throws(()=>pageRange('1,11',10));assert.throws(()=>pageRange('2.5',10));
});
test('single-page projection excludes the book, page wrappers and every other run',()=>{
  const a=run('/a'),b=run('/b'),view=emptyView();
  view.collapsed_pages=['/a'];
  view.positions[nodeKey('/a','shot:s001',book)]={x:123,y:456};
  const projected=bookGraph([{directory:'/a',run:a},{directory:'/b',run:b}],'/a',view,[],false,book,true);
  assert.ok(projected.nodes.length);
  assert.ok(projected.nodes.every(node=>node.data.run==='/a'&&!['page','book'].includes(node.data.kind)));
  assert.ok(projected.logical.every(node=>node.data.run==='/a'));
  assert.deepEqual(projected.nodes.find(node=>node.data.baseId==='shot:s001')?.position,{x:123,y:456});
});
test('page state and conversation follow exact run identity while project messages remain visible',()=>{
  const session={revision:1,book,messages:[],active_run:'/b',active_page_id:'page2',page_runs:{'book-test:page1':'/a','book-test:page2':'/b'},
    page_status:{'/a':'已有成片'},workflow:{version:1,revision:1,tasks:[
      {id:'a',run:'/a',page_id:'page1',status:'completed',call_id:'ca'},
      {id:'b',run:'/b',page_id:'page2',status:'running',call_id:'cb'}
    ]},conversation:[{id:'ta',blocks:[{type:'tool',call_id:'ca'}]},{id:'tb',blocks:[{type:'tool',call_id:'cb'}]}]} as unknown as AgentSession;
  const messages=[
    {id:'project',text:'全书要求'},
    {id:'a',run:'/a',page_id:'page1',turn_id:'ta'},
    {id:'b',run:'/b',page_id:'page2',turn_id:'tb'}
  ] as AgentSession['messages'];
  assert.equal(pageStatus(session,'page1'),'已有成片');
  assert.equal(pageStatus(session,'page2'),'制作中');
  const filtered=pageConversation(session,messages,'page1');
  assert.deepEqual(filtered.messages.map(message=>message.id),['project','a']);
  assert.deepEqual(filtered.session.conversation?.map(turn=>turn.id),['ta']);
  assert.deepEqual(filtered.session.workflow?.tasks.map(task=>task.id),['a']);
  assert.equal(pageConversation(session,messages).messages,messages);
});
test('next stage advances beyond panels and respects rejected planning',()=>{
  const r=run('/a');
  r.records=[];
  assert.equal(nextRunStage(r),'preprocess');
  r.records.push({file:'source/manifest.json',data:fixture.source});
  assert.equal(nextRunStage(r),'script');
  r.records.push({file:'production.json',data:fixture});
  assert.equal(nextRunStage(r),'video');
  r.records=[{file:'source/manifest.json',data:fixture.source},{file:'planning_draft.json',data:{script:fixture.script,reviews:[{scope:'script',accepted:false}]}}];
  assert.equal(nextRunStage(r),'script');
  r.records[1].data={script:fixture.script,shot_list:fixture.shot_list,directions:fixture.directions,reviews:[]};
  assert.equal(nextRunStage(r),'storyboard');
});
