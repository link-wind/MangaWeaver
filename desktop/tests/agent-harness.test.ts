import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentGraph,type AgentStage} from '../src/lib/agentGraph';

const stages:AgentStage[]=[
  {id:'preprocess',label:'漫画分格',creators:[],reviewers:[],gate:'分格完成',on_fail:'',requires:[]},
  {id:'script',label:'来源脚本',creators:['script.creator','dialogue.creator'],reviewers:['script.reviewer','dialogue.reviewer'],gate:'脚本通过',on_fail:'',requires:['preprocess']},
  {id:'video',label:'视频成片',creators:['video.generator'],reviewers:['video.reviewer'],gate:'成片通过',on_fail:'',requires:['script']},
];

test('architecture graph keeps stage order, roles and feedback loops without dangling edges',()=>{
  const {nodes,edges}=agentGraph(stages);
  const ids=new Set(nodes.map(n=>n.id));
  assert.deepEqual(nodes.filter(n=>n.data.kind==='stage').map(n=>n.data.title),['漫画分格','来源脚本','视频成片']);
  assert.ok(nodes.find(n=>n.id==='creator:script')?.data.roles.includes('dialogue.creator'));
  assert.ok(nodes.find(n=>n.id==='reviewer:script')?.data.roles.includes('script.reviewer'));
  assert.equal(nodes.find(n=>n.id==='stage:preprocess')?.data.subtitle,'流程入口');
  assert.ok(edges.some(e=>e.id==='seq:script>video'&&e.source==='stage:script'&&e.target==='stage:video'));
  assert.ok(edges.some(e=>e.id==='forward:script'&&e.sourceHandle==='forward'));
  assert.ok(edges.some(e=>e.id==='loop:script'&&e.source==='reviewer:script'&&e.target==='creator:script'&&e.animated===true));
  assert.ok(edges.every(e=>ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target));
  const columns=nodes.filter(n=>n.data.kind==='stage').map(n=>n.position.x);
  assert.deepEqual(columns,[...columns].sort((a,b)=>a-b));
});

test('stage without agents renders only the stage and its sequential edge',()=>{
  const {nodes,edges}=agentGraph([stages[0]]);
  assert.deepEqual(nodes.map(n=>n.id),['stage:preprocess']);
  assert.deepEqual(edges,[]);
});
