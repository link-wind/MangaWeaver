import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workingSet,type CanvasNode} from '../src/lib/canvas';
const node=(id:string,kind:string,location:string,status='ready',run='/page')=>({id,position:{x:0,y:0},data:{run,kind,location,status,image:kind==='frame'?'frame.png':undefined}} as CanvasNode);
test('工作取景优先退回镜头，只包含同页同镜头的关联产物',()=>{
 const nodes=[node('frame1','frame','s001:k0'),node('shot3','shot','s003'),node('frame3','frame','s003:k0'),node('video3','video','s003','rejected'),node('final','video','all'),node('other','frame','s003:k0','ready','/other')];
 assert.deepEqual(workingSet(nodes,'/page').map(n=>n.id),['shot3','frame3','video3']);
 assert.deepEqual(workingSet(nodes,'/page','frame1').map(n=>n.id),['frame1']);
 assert.deepEqual(workingSet([node('page','source','all')],'/page'),[]);
});
