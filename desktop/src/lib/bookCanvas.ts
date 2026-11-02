import type {Edge} from '@xyflow/react';
import {graph, canvasState, type CanvasNode, type Card} from './canvas';
import type {Book, CanvasState, CanvasView, EngineEvent, RunData} from './types';

export const emptyView = ():CanvasView => ({collapsed_groups:[],collapsed_pages:[],book_collapsed:false,positions:{}});
export const columns:Record<string,string> = {panel:'漫画分镜',shot:'镜头',frame:'关键画面',video:'视频片段'};
export const groupKey = (run:string, kind:string) => `${run}::group:${kind}`;
export const nodeKey = (run:string, id:string, book?:Book) => book ? `${run}::${id}` : id;
export type PageBranch = {directory:string;number?:number;thumbnail?:string;caption?:string;run?:RunData|null;state?:CanvasState};
function summary(nodes:CanvasNode[]): Pick<Card,'status'|'progress'> {
  const progress = nodes.some(n=>n.data.progress==='running') ? 'running' : nodes.some(n=>n.data.progress==='failed') ? 'failed' : nodes.length && nodes.every(n=>n.data.progress==='completed') ? 'completed' : 'waiting';
  return {progress,status:progress==='failed'?'rejected':progress==='completed'?'ready':'waiting'};
}
/** 纯视图投影：保留原业务节点，折叠只重定向显示连线。 */
export function bookGraph(branches:PageBranch[], active:string, view:CanvasView, events:EngineEvent[], busy:boolean, book?:Book) {
  const nodes:CanvasNode[]=[], edges:Edge[]=[], logical:CanvasNode[]=[];
  let top=0;
  for (const branch of branches) {
    const directory=branch.directory;
    const raw = graph(branch.run||null, branch.state||canvasState(branch.run||null), events.filter(e=>e.run_dir===directory), busy && events.at(-1)?.run_dir===directory);
    const prefix=(id:string)=>nodeKey(directory,id,book);
    const offset={x:book?370:0,y:book?top+90:0};
    const pageId=`page:${directory}`;
    const pageCollapsed=!!book && view.collapsed_pages.includes(directory);
    for (const n of raw.nodes) logical.push({...n,id:prefix(n.id),data:{...n.data,run:directory,baseId:n.id,pageNumber:branch.number}});
    const aggregate=summary(raw.nodes);
    const pageStatus=aggregate.progress==='running'||aggregate.progress==='failed'?aggregate:
      branch.caption==='已有成片'||branch.run?.media.some(p=>p===`${directory}/final.mp4`)?{status:'ready' as const,progress:'completed' as const}:{status:'waiting' as const,progress:'waiting' as const};
    if (book) nodes.push({id:pageId,type:'artifact',position:view.positions[pageId]||{x:0,y:top+90},data:{
      kind:'page',title:branch.number?`第 ${branch.number} 页`:'独立运行',subtitle:`${directory===active?'当前 · ':''}${branch.caption || (branch.run?'已展开':'展开查看进度')}`,text:branch.run ? `${raw.nodes.length} 个内容节点` : '展开查看已有进度',
      image:branch.thumbnail,run:directory,stage:'script',location:'all',collapsed:pageCollapsed,...pageStatus,pageNumber:branch.number,
    }});
    if (pageCollapsed) {top+=310;continue;}
    const groups=new Map<string,CanvasNode[]>();
    for (const n of raw.nodes) if (columns[n.data.kind] && n.id!=='final') {
      const members=groups.get(n.data.kind)||[]; members.push(n);groups.set(n.data.kind,members);
    }
    const redirect=new Map<string,string>();
    for (const [kind,members] of groups) {
      const key=groupKey(directory,kind), collapsed=view.collapsed_groups.includes(key);
      const x=members[0].position.x+offset.x, y=Math.min(...members.map(n=>n.position.y))+offset.y-72;
      nodes.push({id:key,type:'artifact',position:view.positions[key]||{x,y},data:{kind:'group',title:columns[kind],subtitle:`${members.length} 项`,
        text:`${members.filter(n=>n.data.progress==='completed').length} / ${members.length} 已完成`,stage:members[0].data.stage,location:'all',run:directory,
        groupKey:key,collapsed,members:members.map(n=>n.id),previews:members.flatMap(n=>n.data.image?[n.data.image]:[]).slice(0,3),...summary(members)}});
      if (collapsed) for (const n of members) redirect.set(n.id,key);
    }
    for (const n of raw.nodes) if (!redirect.has(n.id)) nodes.push({...n,id:prefix(n.id),
      position:view.positions[prefix(n.id)]||{x:n.position.x+offset.x,y:n.position.y+offset.y},data:{...n.data,run:directory,baseId:n.id,pageNumber:branch.number}});
    const seen=new Set<string>();
    for (const edge of raw.edges) {
      const source=redirect.get(edge.source)||prefix(edge.source), target=redirect.get(edge.target)||prefix(edge.target);
      if (source===target||seen.has(`${source}>${target}`)) continue;
      seen.add(`${source}>${target}`);
      edges.push({...edge,id:`${source}>${target}`,source,target,
        sourceHandle:redirect.has(edge.source)?undefined:edge.sourceHandle,targetHandle:redirect.has(edge.target)?undefined:edge.targetHandle});
    }
    if (book && raw.nodes.some(n=>n.id==='source')) edges.push({id:`${pageId}:source`,source:pageId,target:prefix('source'),type:'smoothstep'});
    const branchNodes=nodes.filter(n=>n.data.run===directory);
    top=Math.max(top+620,...branchNodes.map(n=>n.position.y+(n.data.kind==='source'?550:n.data.kind==='group'&&!n.data.collapsed?50:290)))+160;
  }
  if (book) {
    nodes.unshift({id:`book:${book.id}`,type:'artifact',position:view.positions[`book:${book.id}`]||{x:-650,y:0},data:{kind:'book',title:book.name,subtitle:`${book.page_count} 页 · 文件页序`,text:'',book,
      collapsed:view.book_collapsed,stage:'script',location:'all',status:'ready',progress:'completed'}});
    for (const n of nodes.filter(n=>n.data.kind==='page')) edges.push({id:`book:${n.id}`,source:`book:${book.id}`,target:n.id,type:'smoothstep'});
  }
  const ids=new Set(nodes.map(n=>n.id));
  return {nodes,edges:edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),logical};
}
