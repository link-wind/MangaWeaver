import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentTraceTree} from '../src/components/AgentTraceTree';
import {traceTask} from '../src/lib/trace';
import type {TaskActivity,WorkflowTask} from '../src/lib/types';

function activity(values:Partial<TaskActivity>&{id:string;created_at:string}):TaskActivity{
  return {actor:'script.creator',role:'creator',target:'script',professional_stage:'script',iteration:0,status:'completed',...values} as TaskActivity;
}

test('协作树显示角色链、退回结论与公开说明',()=>{
  const task={id:'t',parent_id:null,origin:'stage',title:'来源脚本',stage:'script',run:'/r',target:'script',
    status:'completed',reason:'',summary:'来源脚本完成',created_at:'1',updated_at:'2',revision:1,actions:[],activities:[
      activity({id:'a',created_at:'1'}),
      activity({id:'r',created_at:'2',actor:'script.reviewer',role:'reviewer',accepted:false,issues:[{target:'script',location:'p1',evidence:'缺少前景手臂',suggestion:'补全'}]}),
    ]} as unknown as WorkflowTask;
  const html=renderToStaticMarkup(createElement(AgentTraceTree,{
    root:traceTask(task,[task]),busy:false,notes:[{role:'script.reviewer',text:'需要补全前景手臂',status:'completed'}],onLocate(){},
  }));
  assert.match(html,/脚本创作/);
  assert.match(html,/脚本审查/);
  assert.match(html,/退回/);
  assert.match(html,/需要修订/);
  assert.match(html,/需要补全前景手臂/);
});
