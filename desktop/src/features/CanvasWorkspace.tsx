import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  type ReactFlowInstance,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import {
  ArrowRight,
  ArrowLeft,
  Map,
  Check,
  Clapperboard,
  FileText,
  Image,
  Layers,
  MessageSquare,
  MousePointer2,
  PanelRightClose,
  Play,
  Send,
  Square,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  CircleAlert,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { Button } from "../components/ui/button";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import { Media } from "../components/Media";
import {
  graph,
  canvasState,
  wholePage,
  nextStage,
  stageNames,
  type CanvasNode,
  type Stage,
} from "../lib/canvas";
import type { AgentContext, AgentSession, CanvasCommand, CanvasState, CanvasView, EngineEvent, RunData } from "../lib/types";
import { currentPlan, sourceData, taskEntries } from "../lib/data";

import { validateCanvasCommand } from "../lib/canvasCommands";
import { mergeEvents } from "../lib/runtime";
import {bookGraph,emptyView,groupKey,nodeKey,type PageBranch} from "../lib/bookCanvas";
import {CreativeTimeline} from "./CreativeTimeline";
import {CreativeComposer} from "./CreativeComposer";
import type {WorkflowTask,CanvasReference,MessageOptions} from "../lib/types";
import { BookPicker } from "./BookPicker";
import {nextRunStage,runStageNames,type RunStage} from "../lib/runStages";
import {runOrigin} from "../lib/presentation";
import {useDetailsMenus} from "../lib/useDetailsMenus";

function ArtifactNode({ data, selected }: NodeProps<CanvasNode>) {
  if (data.kind === "book") return <article className="canvas-book-card">
    <Handle type="source" position={Position.Right}/>
    <div className="canvas-book-head"><Layers size={16}/><div><strong>{data.title}</strong><small>{data.subtitle}</small></div>
      <button className="node-fold nodrag nopan" aria-label={data.collapsed?"展开书籍":"收起书籍"} onClick={data.onToggle}>{data.collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</button></div>
    {!data.collapsed && data.book && <BookPicker book={data.book} busy={!!data.busy} selectedPage={data.activePage} onOpen={data.onOpenPages!} onLoad={data.onLoadPages!} pageRuns={data.pageRuns}/>}
  </article>;
  const Icon = {
    book: Layers,
    group: Layers,
    page: FileText,
    source: Image,
    panel: Image,
    script: FileText,
    arrangement: Layers,
    shot: Clapperboard,
    frame: Image,
    video: Play,
  }[data.kind];
  return (
    <article className={`canvas-card ${data.kind === "group" && !data.collapsed ? "expanded-group" : ""} ${data.kind === "source" ? "page-card" : ""} ${data.image || data.video ? "visual-card" : ""} ${selected ? "selected" : ""}`}>
      <div className={`node-progress ${data.progress || "waiting"}`} role="progressbar"
        aria-label={`${data.title} · ${{running:"执行中",completed:"已完成",failed:"执行失败",waiting:"等待执行"}[data.progress || "waiting"]}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.progress === "completed" ? 100 : undefined}>
        <span />
      </div>
      <Handle type="target" position={Position.Left} />
      {data.kind === "panel" && <Handle type="target" position={Position.Top} id="reading-in" />}
      <div className="canvas-card-head">
        <span>
          <Icon size={14} />
          {data.title}{data.kind === "group" && <small>{data.subtitle}</small>}
        </span>
        {data.kind === "page" && <input type="checkbox" className="nodrag nopan page-run-check" aria-label={data.pageNumber?`选择第 ${data.pageNumber} 页用于运行`:'选择独立运行'} checked={!!data.picked} onClick={e=>e.stopPropagation()} onChange={data.onPick}/>}
        {data.onRunStage && <button className="node-fold nodrag nopan" disabled={data.busy} title={`仅执行${data.runLabel}`} aria-label={`仅执行${data.runLabel}`} onClick={e=>{e.stopPropagation();data.onRunStage!();}}><Play size={13}/></button>}
        {data.onToggle && <button className="node-fold nodrag nopan" aria-label={`${data.collapsed?"展开":"收起"}${data.title}`} onClick={e=>{e.stopPropagation();data.onToggle!();}}>{data.collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</button>}
        <span className={`node-status ${data.status}`}>
          {data.progress === "running" ? <LoaderCircle size={12} className="runtime-spin" /> : data.progress === "failed" ? "需处理" : data.status === "ready" ? (
            <Check size={12} />
          ) : data.status === "rejected" ? (
            "需修订"
          ) : (
            "待生成"
          )}
        </span>
      </div>
      {data.kind !== "group" && <div className="canvas-card-subtitle">{data.subtitle}</div>}
      {data.kind === "group" && data.collapsed && !!data.previews?.length && <div className="group-previews">{data.previews.map((path,i)=><Media key={i} path={path} alt="组内预览"/>)}</div>}
      {data.image && (
        <div className="node-media">
          <Media path={data.image} alt={data.title} />
        </div>
      )}
      {data.video && (
        <div className="node-video nodrag nopan">
          <Media path={data.video} video />
        </div>
      )}
      {!data.image && !data.video && (data.kind !== "group" || data.collapsed) && <p>{data.text}</p>}
      <Handle type="source" position={Position.Right} />
      {data.kind === "panel" && <Handle type="source" position={Position.Bottom} id="reading-out" />}
    </article>
  );
}
const nodeTypes = { artifact: ArtifactNode };
type Props = {
  projectReady: boolean;
  onOpenProject: () => void;
  session?: AgentSession | null;
  canvasCommand: CanvasCommand | null;
  onMessage: (text: string, options:MessageOptions) => void;
  onConversationAction:(command:string,params?:Record<string,unknown>)=>void;
  onReference:(reference:CanvasReference)=>void;
  onTaskAction:(task:WorkflowTask,action:WorkflowTask['actions'][number])=>void;
  onLocateTask:(task:WorkflowTask,target?:string)=>void;
  onWithdraw:(id:string)=>void;
  onProcessRequest:(id:string)=>void;
  onContext: (context: AgentContext) => void;
  onCanvasResult: (command: CanvasCommand, result: {status: string; summary: string}) => void;
  onSelectPage: (number: number) => void;
  permission: string;
  onPermission: (value: string) => void;
  run: RunData | null;
  state: CanvasState;
  chatWidth: number;
  onChatWidth: (width: number) => void;
  busy: boolean;
  stopping: boolean;
  events: EngineEvent[];
  videoBlocker?: string;
  onHome: () => void;
  onState: (state: CanvasState) => void;
  onContinue: (stage: Stage) => void;
  onFeedback: (stage: Stage, text: string, location: string) => void;
  onSource: () => void;
  onPreprocess: () => void;
  onStop: () => void;
  onRun: (stage:RunStage, runs?:string[], operation?:'stage'|'until') => void;
  otherRuns: RunData[];
  view?: CanvasView;
  onView: (view:CanvasView) => Promise<void>;
  onOpenPages: (pages:number[]) => void;
  onLoadPages: (pages:number[]) => Promise<void>;
  onActivate: (path:string) => void;
  onGenerate: (dry: boolean) => void;
  onDetails: (tab: string) => void;
  onExport: (path: string) => void;
};
export function CanvasWorkspace(props: Props) {
  const [highlightTask,setHighlightTask]=useState("");
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const processed = useRef<string>("");
  const workspaceRef = useDetailsMenus<HTMLDivElement>();
  const tabsRef=useRef<HTMLDivElement>(null);
  const allEvents = useMemo(() => mergeEvents(props.session?.events, props.run?.events, props.events)
    .filter(e => !e.run_dir || !props.run || e.run_dir === props.run.directory), [props.session?.events, props.run?.events, props.events, props.run?.directory]);
  const runEvents = useMemo(() => allEvents.filter(e => e.run_dir === props.run?.directory), [allEvents, props.run?.directory]);
  const [foldView,setFoldView]=useState<CanvasView>(props.view||emptyView());
  const viewDirty=useRef(false), latestView=useRef(foldView);
  latestView.current=foldView;
  const [pickedRuns,setPickedRuns]=useState<string[]>([]);
  useEffect(()=>{
    if(props.session?.book){const paths=new Set(Object.values(props.session.page_runs||{}));setPickedRuns(old=>old.filter(path=>paths.has(path)));}
  },[props.session?.page_runs]);
  function changeView(update:(previous:CanvasView)=>CanvasView) {viewDirty.current=true;setFoldView(update);}
  useEffect(()=>{if(!viewDirty.current)setFoldView(props.view||emptyView());},[props.view]);
  useEffect(()=>{
    if(props.busy||!viewDirty.current)return;
    const value=foldView;
    const timer=setTimeout(()=>{void props.onView(value).then(()=>{if(latestView.current===value)viewDirty.current=false;}).catch(()=>{});},220);
    return()=>clearTimeout(timer);
  },[foldView,props.busy]);
  const model = useMemo(()=>{
    const book=props.session?.book;
    const indexed=book ? Object.entries(props.session?.page_runs||{}).filter(([key])=>key.startsWith(book.id+":")) : [];
    const branches:PageBranch[]=book ? indexed.map(([key,path])=>{
      const page=book.pages.find(p=>key===`${book.id}:${p.id}`);
      const run=path===props.run?.directory?props.run:props.otherRuns.find(r=>r.directory===path);
      return {directory:path,number:page?.number,thumbnail:page?.thumbnail,caption:props.session?.page_status?.[path],run,state:path===props.run?.directory?props.state:canvasState(run||null)};
    }).sort((a,b)=>(a.number||0)-(b.number||0)) : [{directory:props.run?.directory||"",run:props.run,state:props.state}];
    if(book && props.run && !branches.some(b=>b.directory===props.run!.directory)) {
      const page=book.pages.find(p=>p.id===props.run!.book_page?.page_id);
      branches.push({directory:props.run.directory,number:page?.number,thumbnail:page?.thumbnail,run:props.run,state:props.state});
    }
    const result=bookGraph(branches,props.run?.directory||"",foldView,allEvents,props.busy,book);
    result.nodes=result.nodes.map(n=>({...n,data:{...n.data,
      pageRuns:props.session?.page_runs,
      busy:props.busy||!props.projectReady||!!props.run?.experimental||!!props.run?.simulation,
      ...((n.data.kind==='source'||n.data.kind==='arrangement'||n.data.kind==='group'||n.id.endsWith('::final')||n.id==='final')&&n.data.run?(()=>{
        const target:RunStage=n.data.kind==='source'?'preprocess':n.data.kind==='arrangement'?'arrangement':n.data.groupKey?.endsWith(':panel')?'script':n.data.groupKey?.endsWith(':shot')?'direction':n.data.groupKey?.endsWith(':frame')?'storyboard':'video';
        return {runLabel:runStageNames[target],onRunStage:()=>props.onRun(target,[n.data.run!])};
      })():{}),
      ...(n.data.kind==="book"?{busy:props.busy,onLoadPages:props.onLoadPages,activePage:props.run?.book_page?.page_id||props.session?.active_page_id,onOpenPages:(pages:number[])=>{
        const paths=pages.map(number=>props.session?.page_runs?.[`${book!.id}:${book!.pages[number-1].id}`]);
        changeView(v=>({...v,collapsed_pages:v.collapsed_pages.filter(path=>!paths.includes(path))}));
        props.onOpenPages(pages);
      },onToggle:()=>changeView(v=>({...v,book_collapsed:!v.book_collapsed}))}:{}),
      ...(n.data.kind==="group"?{onToggle:()=>changeView(v=>({...v,collapsed_groups:v.collapsed_groups.includes(n.id)?v.collapsed_groups.filter(id=>id!==n.id):[...v.collapsed_groups,n.id]}))}:{}),
      ...(n.data.kind==="page"?{picked:pickedRuns.includes(n.data.run!),onPick:()=>setPickedRuns(old=>old.includes(n.data.run!)?old.filter(p=>p!==n.data.run):[...old,n.data.run!]),
        onToggle:()=>changeView(v=>({...v,collapsed_pages:v.collapsed_pages.includes(n.data.run!)?v.collapsed_pages.filter(p=>p!==n.data.run):[...v.collapsed_pages,n.data.run!]}))}:{}),
    }}));
    return result;
  },[props.run,props.state,props.otherRuns,props.session?.book,props.session?.page_runs,props.session?.active_page_id,foldView,allEvents,props.busy,props.projectReady,pickedRuns]);
  const [nodes, setNodes] = useState<CanvasNode[]>(model.nodes),
    [selected, setSelected] = useState<string | null>(null),
    [rightPanel,setRightPanel] = useState<"chat"|"detail">("chat"),
    [showMap, setShowMap] = useState(false),
    [draft, setDraft] = useState(props.state.draft),
    [stage, setStage] = useState<Stage>("script");
  const details=rightPanel==="detail";
  const setDetails=(value:boolean)=>setRightPanel(value?"detail":"chat");
  const [flowReady,setFlowReady]=useState(false);
  const fittedRun=useRef("");
  const suggestedStage=nextRunStage(props.run);
  const [references,setReferences]=useState<CanvasReference[]>([]);
  const [delivery,setDelivery]=useState<'steer'|'follow_up'>('steer');
  const [referenceError,setReferenceError]=useState('');
  async function addReference(purpose:'target'|'reference'){
    setReferenceError('');
    if(!props.projectReady){setReferenceError('请先打开项目，再添加引用');return;}
    try{
      const picked=nodes.filter(n=>n.selected&&n.data.run&&(n.data.baseId||n.data.kind==='page'));
      if(!picked.length)throw new Error('请先在画布选中一个已有对象');
      const captured:CanvasReference[]=[];
      for(const directory of new Set(picked.map(n=>n.data.run!))){
        const result=await window.manga.run('capture_references',{run_dir:directory,
          node_ids:picked.filter(n=>n.data.run===directory).map(n=>n.data.baseId||'source'),purpose});
        captured.push(...result.references);
      }
      setReferences(old=>[...old.filter(r=>!captured.some(c=>c.run===r.run&&c.node_id===r.node_id&&c.purpose===r.purpose)),...captured]);
    }catch(error){setReferenceError((error as Error).message);}
  }
  const [runTarget,setRunTarget]=useState<RunStage>(suggestedStage);
  useEffect(()=>setRunTarget(suggestedStage),[props.run?.directory,suggestedStage]);
  const stateRef = useRef(props.state),
    dirty = useRef(false);
  const draftRun=useRef(props.run?.directory), draftCache=useRef(new globalThis.Map<string,string>());
  const draftOnLeave=useRef({draft,state:props.state,save:props.onState});
  draftOnLeave.current={draft,state:props.state,save:props.onState};
  useEffect(()=>()=>{if(dirty.current){const value=draftOnLeave.current;value.save({...value.state,draft:value.draft});}},[]);
  stateRef.current = props.state;
  useEffect(() => {
    setNodes((previous) =>
      model.nodes.map((n) => ({
        ...n,
        selected: previous.find(p => p.id === n.id)?.selected ?? n.id===selected,
        position:
          foldView.positions[n.id] || previous.find((p) => p.id === n.id)?.position ||
          props.state.positions[n.id] ||
          n.position,
      })),
    );
  }, [model]);
  useEffect(()=>{
    const path=props.run?.directory;
    if(path!==draftRun.current){
      if(draftRun.current&&dirty.current)draftCache.current.set(draftRun.current,draft);
      const cached=path?draftCache.current.get(path):undefined;
      dirty.current=cached!==undefined;
      setDraft(cached??props.state.draft);
      draftRun.current=path;
      if(nodes.find(n=>n.id===selected)?.data.run!==path){setSelected(null);setDetails(false);}
      setNodes(previous=>previous.map(n=>n.data.run===path?n:{...n,selected:false}));
    }
  },[props.run?.directory]);
  useEffect(() => {
    if (!dirty.current) setDraft(props.state.draft);
  }, [props.state.draft]);
  useEffect(() => {
    if (props.busy || !dirty.current) return;
    const timer = setTimeout(() => {
      props.onState({ ...stateRef.current, draft });
      dirty.current = false;
      if(props.run?.directory)draftCache.current.delete(props.run.directory);
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, props.busy, props.run?.directory]);
  useEffect(() => {
    const actual=model.logical.filter(n=>n.data.run===props.run?.directory);
    props.onContext({run:props.run?.directory,selected:nodes.filter(n=>n.selected&&n.data.run===props.run?.directory&&n.data.baseId).map(n=>n.data.baseId!),
      nodes:actual.map(n=>({id:n.data.baseId!,title:n.data.title,kind:n.data.kind,location:n.data.location,stage:n.data.stage}))});
  },[nodes,props.run?.directory]);
  useEffect(() => {
    const command=props.canvasCommand;
    if(!command||!flowRef.current||processed.current===command.call_id)return;
    const actual=model.logical.filter(n=>n.data.run===props.run?.directory).map(n=>({...n,id:n.data.baseId!}));
    try {validateCanvasCommand(command,props.run?.directory,actual);} catch(error){processed.current=command.call_id;props.onCanvasResult(command,{status:"failed",summary:(error as Error).message});return;}
    const chosenIds=command.node_ids.map(id=>nodeKey(command.run,id,props.session?.book));
    if(chosenIds.some(id=>!nodes.some(n=>n.id===id))){
      const groups=actual.filter(n=>command.node_ids.includes(n.id)).map(n=>groupKey(command.run,n.data.kind));
      changeView(v=>({...v,collapsed_pages:v.collapsed_pages.filter(p=>p!==command.run),collapsed_groups:v.collapsed_groups.filter(p=>!groups.includes(p))}));
      return;
    }
    processed.current=command.call_id;
    void(async()=>{
      try{
        const chosen=nodes.filter(n=>chosenIds.includes(n.id));
        if(command.operation==="layout") {
          const value={...latestView.current,positions:{...latestView.current.positions,...Object.fromEntries(chosen.map(n=>[n.id,{x:n.position.x+command.dx,y:n.position.y+command.dy}]))}};
          changeView(()=>value);
          await props.onView(value);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
          if(chosen.some(n=>{const actual=flowRef.current!.getNode(n.id)?.position, expected=value.positions[n.id];return !actual||actual.x!==expected.x||actual.y!==expected.y;}))throw new Error("画布位置尚未更新，未确认成功");
        } else {
          setNodes(previous=>previous.map(n=>({...n,selected:chosenIds.includes(n.id)})));
          setSelected(chosen[0].id);
          if(command.operation==="open_details")setDetails(true);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
          if(command.operation!=="select" && !await flowRef.current!.fitView({nodes:chosen,padding:0.3,duration:250}))throw new Error("节点尚未完成布局，未确认定位成功");
        }
        props.onCanvasResult(command,{status:"completed",summary:"画布操作完成"});
      }catch(error){props.onCanvasResult(command,{status:"failed",summary:(error as Error).message});}
    })();
  },[props.canvasCommand,nodes,props.run?.directory]);
  const inputPage = wholePage(props.run, props.state);
  const node = nodes.find((n) => n.id === selected),
    target = node?.data.location || "all",
    hasSource = !!sourceData(props.run),
    plan = currentPlan(props.run),
    next = nextStage(props.run),
    complete = !!props.run?.records.find((r) => r.file === "production.json"),
    hasVideo = taskEntries(props.run).length > 0;
  const pause = props.run?.records.find((r) => r.file === "planning_pause.json")
    ?.data?.after_stage;
  const last = allEvents.filter(e => e.type !== "artifact").at(-1);
  useEffect(()=>{
    const path=props.run?.directory;
    if(!flowReady||!path||fittedRun.current===path)return;
    const runNodes=nodes.filter(n=>n.data.run===path&&n.data.kind!=='group');
    const current=runNodes.filter(n=>n.id===selected||n.data.baseId==='final');
    if(!current.length)current.push(...runNodes.filter(n=>n.data.kind==='source'));
    if(!current.length&&runNodes.length)current.push(runNodes[0]);
    if(!current.length||!current.some(n=>n.measured?.width))return;
    const frame=requestAnimationFrame(()=>{void flowRef.current?.fitView({nodes:current,padding:.18,minZoom:.65,maxZoom:1,duration:180}).then(ok=>{if(ok)fittedRun.current=path;});});
    return()=>cancelAnimationFrame(frame);
  },[flowReady,props.run?.directory,nodes.some(n=>n.data.run===props.run?.directory&&!!n.measured?.width)]);
  function move(changes: NodeChange<CanvasNode>[]) {
    setNodes((nodes) => applyNodeChanges(changes, nodes));
  }
  function savePositions(_:unknown, dragged:CanvasNode) {
    changeView(v=>({...v,positions:{...v.positions,...Object.fromEntries(nodes.map(n=>[n.id,n.id===dragged.id?dragged.position:n.position]))}}));
  }
  function send() {
    if (!draft.trim()) return;
    const text = draft.trim();
    dirty.current = false;
    if(props.run?.directory)draftCache.current.delete(props.run.directory);
    setDraft("");
    props.onMessage(text,{delivery,references});
    setReferences([]);setDelivery('steer');setReferenceError('');
  }
  const knownRuns=props.run?[props.run,...props.otherRuns.filter(r=>r.directory!==props.run!.directory)]:props.otherRuns;
  const targetRun=node?.data.run||props.run?.directory;
  const targetOrigin=targetRun?runOrigin(targetRun,props.session,knownRuns):'未选择页面';
  function tabKey(e:React.KeyboardEvent<HTMLDivElement>){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    const tabs=Array.from(tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')||[]);
    if(!tabs.length)return;
    e.preventDefault();
    const current=tabs.findIndex(t=>t===document.activeElement);
    const index=e.key==='Home'?0:e.key==='End'?tabs.length-1:(current+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
    tabs[index].click();tabs[index].focus();
  }
  return (
    <div className="canvas-workspace" ref={workspaceRef}>
      <aside className="canvas-conversation" style={{ width: props.chatWidth }}>
        <div ref={tabsRef} className="right-panel-tabs" role="tablist" aria-label="右侧工作区" onKeyDown={tabKey}>
          <button id="creative-tab" role="tab" tabIndex={!details?0:-1} aria-selected={!details} aria-controls="creative-panel" title="项目级创作对话" onClick={()=>setRightPanel('chat')}><MessageSquare size={14}/>创作{props.session?.pending?.kind==='user'&&<span className="question-dot" title="有待回答的问题"/>}</button>
          <button id="inspector-tab" role="tab" tabIndex={details?0:-1} aria-selected={details} aria-controls="inspector-panel" disabled={!node} onClick={()=>setRightPanel('detail')}><SlidersHorizontal size={14}/>详情</button>
          {props.run?.simulation&&<small>本地示例</small>}
        </div>
        <div id="creative-panel" className="creative-panel" role="tabpanel" aria-labelledby="creative-tab" hidden={details}>
        {!props.projectReady&&!props.run?.simulation&&<div className="project-required"><span>本地记录 · 打开项目后可编辑</span><button onClick={props.onOpenProject}>打开项目</button></div>}
        <CreativeTimeline runs={knownRuns} session={props.run?.simulation?{revision:0,messages:props.state.messages,active_run:props.run.directory,active_page_id:"",workflow:props.run.workflow}:props.session} messages={props.session?.messages||props.state.messages}
          busy={props.busy} stopping={props.stopping} onStop={props.onStop} onAction={props.onTaskAction}
          onLocate={props.onLocateTask} onWithdraw={props.onWithdraw} onProcessRequest={props.onProcessRequest} onReference={props.onReference} highlight={highlightTask} onConversationAction={props.onConversationAction}/>
        <CreativeComposer target={node?`${targetOrigin} · ${node.data.title}`:targetOrigin}
          permission={props.permission} onPermission={props.onPermission} draft={draft}
          onDraft={value=>{setDraft(value);dirty.current=true;}} onSend={send} busy={props.busy}
          delivery={delivery} onDelivery={setDelivery} references={references} onRemoveReference={id=>setReferences(old=>old.filter(r=>r.id!==id))}
          onAddReference={addReference} referenceError={referenceError}
          disabled={!props.projectReady||!!props.run?.simulation||!!props.run?.experimental} simulation={!!props.run?.simulation}/>
        </div>
        <div id="inspector-panel" className="inspector-panel" role="tabpanel" aria-labelledby="inspector-tab" hidden={!details}>
        {details && node && (
          <div className="inspector-content">
            <div className="row">
              <strong>{node.data.title}</strong>
              <Button
                variant="ghost"
                size="icon"
                title="返回创作"
                onClick={() => setDetails(false)}
              >
                <PanelRightClose size={15} />
              </Button>
            </div>
            <span className="tag">{node.data.subtitle}</span>
            <p>{node.data.text}</p>
            {node.data.image && (
              <Media path={node.data.image} alt={node.data.title} />
            )}
            {node.data.video && (
              <>
                <Media path={node.data.video} video />
                <Button
                  size="sm"
                  onClick={() => props.onExport(node.data.video!)}
                >
                  导出已有视频
                </Button>
              </>
            )}
            <Button
              size="sm"
              onClick={() => {
                setStage(node.data.stage);
                setDetails(false);
                requestAnimationFrame(()=>document
                  .querySelector<HTMLTextAreaElement>(
                    '[aria-label="画布修改要求"]',
                  )
                  ?.focus());
              }}
            >
              修改此节点
            </Button>
            {props.session?.workflow?.tasks.some(t=>t.run===node.data.run)&&<Button size="sm" variant="ghost" onClick={()=>{
              const task=[...(props.session?.workflow?.tasks||[])].reverse().find(t=>t.run===node.data.run&&(t.target===node.data.location||t.activities.some(a=>a.target===node.data.location)||t.stage===node.data.stage));
              if(task){setDetails(false);setHighlightTask(task.parent_id||task.id);}
            }}>查看协作记录</Button>}
            {node.data.detail != null && (
              <details className="details">
                <summary>技术详情</summary>
                <pre>{JSON.stringify(node.data.detail, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
        </div>
      </aside>
      <PanelResizeHandle label="调整对话宽度" width={props.chatWidth} min={280} initial={360} direction={-1}
        max={() => Math.min(640, (workspaceRef.current?.clientWidth || window.innerWidth - 220) - 326)}
        onChange={props.onChatWidth} />
      <section className="canvas-stage">
        <div className="canvas-commandbar">
          <div className="canvas-navigation">
            <Button size="icon" variant="ghost" title="返回首页" onClick={props.onHome}>
              <ArrowLeft size={16} />
            </Button>
            <span>画布</span>
            {props.run?.simulation && <span className="simulation-label">模拟任务</span>}
          </div>
          <div className="row canvas-run-controls">
            <span className="run-scope">{pickedRuns.length?`所选 ${pickedRuns.length} 页`:props.run?.book_page?.number?`文件第 ${props.run.book_page.number} 页`:props.session?.active_page_id?`文件第 ${Number(props.session.active_page_id.replace('page',''))} 页`:'当前页'}</span>
            {!props.run?.simulation && <label className="run-target"><span>做到</span><select className="canvas-run-stage" aria-label="制作终点" disabled={props.busy||!props.projectReady||!props.run} value={runTarget} onChange={e=>setRunTarget(e.target.value as RunStage)}>
              {Object.entries(runStageNames).map(([stage,label])=><option key={stage} value={stage}>{label}</option>)}
            </select></label>}
            <Button variant={props.busy ? "outline" : "default"} size="sm"
              disabled={props.stopping||(!props.busy&&!props.projectReady&&!props.run?.simulation)||(!props.busy && (!!props.run?.experimental || props.run?.simulation?.completed || (!inputPage && !props.session?.book)))}
              title={props.run?.simulation ? "本地模拟任务；停止后可继续，完成后可从首页重新体验" : props.busy ? "停止本地执行，已提交的远端任务可能仍在运行" : `制作至${runStageNames[runTarget]}，完成后暂停`}
              onClick={props.busy ? props.onStop : ()=>props.onRun(runTarget,pickedRuns.length?pickedRuns:undefined,'until')}>
              {props.busy ? <Square size={13} /> : <Play size={13} />} {props.stopping?'正在停止…':props.busy ? "停止" : props.run?.simulation?.completed ? "已完成" : pickedRuns.length ? `制作所选 ${pickedRuns.length} 项` : "开始制作"}
            </Button>
            <details data-menu className="canvas-more"><summary aria-label="画布更多操作" title="画布更多操作"><MoreHorizontal size={17}/></summary><div className="workbench-menu">
              {props.session?.book&&<button onClick={()=>{flowRef.current?.fitView({nodes:nodes.filter(n=>n.data.kind==='book'),padding:0.3,maxZoom:1,duration:220});}}>查看书籍</button>}
              <button disabled={!!props.run?.simulation} onClick={props.onSource}>检查分格</button>
              <button disabled={!node} onClick={()=>setDetails(true)}>节点详情</button>
              <button onClick={()=>props.onDetails('planning')}>完整规划</button>
              {complete&&!props.busy&&<button onClick={()=>props.onGenerate(true)}>预览生成任务</button>}
              <button aria-pressed={showMap} onClick={()=>setShowMap(!showMap)}>{showMap?'收起小地图':'显示小地图'}</button>
            </div></details>
          </div>
        </div>
        <ReactFlow<CanvasNode>
          onInit={instance => {flowRef.current = instance;setFlowReady(true);}}
          nodes={nodes}
          edges={model.edges}
          nodeTypes={nodeTypes}
          onNodesChange={move}
          onNodeDragStop={savePositions}
          onNodeClick={(_, n) => {
            if(n.data.run && n.data.run !== props.run?.directory){if(props.busy)return;props.onActivate(n.data.run);}
            if(n.data.kind === "book" || n.data.kind === "group")return;
            setSelected(n.id);
            setStage(n.data.stage);
          }}
          onNodeDoubleClick={(_,n)=>{if(n.data.kind!=="book"&&n.data.kind!=="group"&&(!props.busy||n.data.run===props.run?.directory)){setSelected(n.id);setDetails(true);}}}
          ariaLabelConfig={{'controls.zoomIn.ariaLabel':'放大','controls.zoomOut.ariaLabel':'缩小','controls.fitView.ariaLabel':'适应画布'}}
          zoomOnDoubleClick={false}
          nodesDraggable={!props.busy}
          onPaneClick={() => {
            setDetails(false);
            setSelected(null);
          }}
          nodesConnectable={false}
          onlyRenderVisibleElements
          deleteKeyCode={null}
          defaultViewport={props.session?.book?{x:550,y:95,zoom:0.78}:{ x: 35, y: 95, zoom: 0.68 }}
          minZoom={0.15}
          maxZoom={1.6}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: false }}
        >
          <Controls showInteractive={false} aria-label="画布缩放" />
          {showMap && <MiniMap
            position="top-right"
            pannable
            zoomable
            nodeColor={(n) =>
              n.data.status === "waiting" ? "#e4e4e7" : "#b9b9c2"
            }
            maskColor="#f8f8f8bb"
          />}
        </ReactFlow>
        {props.busy&&!props.run&&!props.session?.book&&<div className="canvas-importing"><LoaderCircle size={20} className="runtime-spin"/><span>{allEvents.some(e=>e.stage.startsWith('book.'))?'正在加载前 10 页…':'正在准备画布…'}</span></div>}
        {!hasSource && !props.busy && !props.run?.experimental && !props.run?.simulation && !!inputPage && (
          <div className="canvas-source-hint">
            <Image size={17} />
            <div>
              <strong>确认分格后开始创作</strong>
            </div>
            <Button size="sm" onClick={props.onSource}>
              检查分格
              <ArrowRight size={13} />
            </Button>
          </div>
        )}

      </section>
    </div>
  );
}
