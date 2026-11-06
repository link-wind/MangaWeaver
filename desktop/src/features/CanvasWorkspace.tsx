import {
Background,
BackgroundVariant,
Handle,
MiniMap,
Panel,
Position,
ReactFlow,
applyNodeChanges,
type NodeChange,
type NodeProps,
type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
ArrowLeft,
ArrowRight,
Check,
ChevronDown,
ChevronRight,
Clapperboard,
FileText,
Image,
ImagePlus,
Layers,
LoaderCircle,
Map,
MessageSquare,
Minus,
MoreHorizontal,
Network,
PanelRightClose,
PanelRightOpen,
Play,
Plus,
Scan,
Search,
SlidersHorizontal,
Square,
Trash2
} from "lucide-react";
import { useEffect,useMemo,useRef,useState } from "react";
import { usePanelRef } from 'react-resizable-panels';
import { ActionMenu,Select,ToggleGroup,Tooltip } from "../components/controls";
import { Media } from "../components/Media";
import { AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle } from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from "../components/ui/button";
import { ButtonGroup } from '../components/ui/button-group';
import { Checkbox } from '../components/ui/checkbox';
import { Command,CommandEmpty,CommandInput,CommandItem,CommandList } from '../components/ui/command';
import { ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuLabel,ContextMenuSeparator,ContextMenuTrigger } from '../components/ui/context-menu';
import { DropdownMenuItem as Item } from "../components/ui/dropdown-menu";
import { Popover,PopoverContent,PopoverTrigger } from '../components/ui/popover';
import { Progress } from '../components/ui/progress';
import { ResizableHandle,ResizablePanel,ResizablePanelGroup } from '../components/ui/resizable';
import { SelectItem } from "../components/ui/select";
import { Separator } from '../components/ui/separator';
import { Tabs,TabsContent } from '../components/ui/tabs';
import { ToggleGroupItem } from "../components/ui/toggle-group";
import {
stageNames,
wholePage,
workingSet,
type CanvasNode,
type Stage
} from "../lib/canvas";
import { sourceData } from "../lib/data";
import type { AgentContext,AgentSession,CanvasCommand,CanvasState,CanvasView,EngineEvent,RunData } from "../lib/types";

import { agentGraph,type AgentNode,type AgentStage } from "../lib/agentGraph";
import { bookGraph,emptyView,groupKey,nodeKey,type PageBranch } from "../lib/bookCanvas";
import type { DeletePreview,DeleteSelection } from "../lib/canvasActions";
import { validateCanvasCommand } from "../lib/canvasCommands";
import { runOrigin } from "../lib/presentation";
import { nextRunStage,runStageNames,type RunStage } from "../lib/runStages";
import { mergeEvents } from "../lib/runtime";
import type { CanvasReference,MessageOptions,WorkflowTask } from "../lib/types";
import { BookPicker } from "./BookPicker";
import { BookOverview } from "./BookOverview";
import { Input } from "../components/ui/input";
import { CandidateHistory } from "./CandidateHistory";
import { CreativeComposer } from "./CreativeComposer";
import { CreativeTimeline } from "./CreativeTimeline";

function ArtifactNode({ data, selected }: NodeProps<CanvasNode>) {
  const status = data.progress === "running" ? "running"
    : data.status === "rejected" ? "rejected"
    : data.progress === "failed" ? "failed"
    : data.status === "ready" ? "ready" : data.progress || "waiting";
  const statusLabel = {
    running: "执行中",
    completed: "已完成",
    failed: "需处理",
    ready: "已完成",
    rejected: "需修订",
    waiting: "待生成",
  }[status];
  if (data.kind === "book") return <article className="canvas-book-card">
    <Handle type="source" position={Position.Right}/>
    <div className="canvas-book-head"><Layers size={16}/><div><strong>{data.title}</strong><small>{data.subtitle}</small></div>
      <Button variant="ghost" size="sm" className="node-fold nodrag nopan" aria-label={data.collapsed?"展开书籍":"收起书籍"} onClick={data.onToggle}>{data.collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</Button></div>
    {!data.collapsed && data.book && <BookPicker book={data.book} busy={!!data.busy} selectedPage={data.activePage} onOpen={data.onOpenPages!} onLoad={data.onLoadPages!} pageRuns={data.pageRuns}/>}
  </article>;
  const shots=(data.detail as {shot_list?:{shots:{shot_id:string;intent:string;duration:number;source_panel_ids:string[]}[]}}|undefined)?.shot_list?.shots;
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
    <article className={`canvas-card ${data.image || data.video ? "media-first" : "text-node"} ${data.kind === "group" ? "group-card" : ""} ${data.kind === "group" && !data.collapsed ? "expanded-group" : ""} ${data.kind === "source" ? "page-card" : ""} ${data.image || data.video ? "visual-card" : ""} ${selected ? "selected" : ""}`}>
      <Progress className={`node-progress absolute inset-x-0 top-0 h-0.5 rounded-none ${data.progress || "waiting"}`} value={data.progress==='completed'?100:data.progress==='running'?undefined:0} aria-hidden="true"/>
      <Handle type="target" position={Position.Left} />
      <div className="canvas-card-head">
        <span>
          <Icon size={14} />
          <span className="canvas-card-title">{data.title}</span>{data.kind === "group" && <small>{data.subtitle}</small>}
        </span>
        {data.kind === "page" && <Checkbox className="nodrag nopan page-run-check" aria-label={data.pageNumber?`选择第 ${data.pageNumber} 页用于运行`:'选择独立运行'} checked={!!data.picked} onClick={e=>e.stopPropagation()} onCheckedChange={data.onPick}/>}
        {data.onRunStage && (selected||data.kind==="group") && <Button variant="ghost" size="sm" className="node-fold nodrag nopan" disabled={data.busy} title={`仅执行${data.runLabel}`} aria-label={`仅执行${data.runLabel}`} onClick={e=>{e.stopPropagation();data.onRunStage!();}}><Play size={13}/></Button>}
        {data.onToggle && <Button variant="ghost" size="sm" className="node-fold nodrag nopan" aria-label={`${data.collapsed?"展开":"收起"}${data.title}`} onClick={e=>{e.stopPropagation();data.onToggle!();}}>{data.collapsed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</Button>}
        <Badge variant="secondary" aria-label={`${data.title} · ${statusLabel}`} className={`node-status border-0 bg-transparent px-0 ${status} ${["ready","completed"].includes(status)?"sr-only":""}`}>
          {status === "running" && <LoaderCircle size={12} className="runtime-spin" />}
          {(status === "completed" || status === "ready") && <Check size={12} />}
          {statusLabel}
        </Badge>
      </div>
      {data.kind !== "group" && data.subtitle && <div className="canvas-card-subtitle"><span>{data.subtitle}</span></div>}
      {data.kind === "group" && data.collapsed && !!data.previews?.length && <div className="group-previews">{data.previews.map((path,i)=><Media key={i} path={path} alt="组内预览"/>)}</div>}
      {data.image && (
        <div className="node-media-anchor">
          {data.kind === "panel" && <Handle type="target" position={Position.Top} id="reading-in" />}
          <div className="node-media">
            <Media path={data.image} revision={data.mediaRevision} alt={data.title} />
          </div>
          {data.kind === "panel" && <Handle type="source" position={Position.Bottom} id="reading-out" />}
        </div>
      )}
      {data.video && (
        <div className="node-video nodrag nopan">
          <Media path={data.video} video compact compactLabel={`播放 ${data.title}`} />
        </div>
      )}
      {data.kind==='arrangement'&&!!shots?.length&&<div className="node-shot-table">{shots.map((shot,i)=><div key={shot.shot_id}><small>{String(i+1).padStart(2,'0')}</small><span>{shot.intent}<small>{shot.source_panel_ids.join(' → ')}</small></span><small>{shot.duration}s</small></div>)}</div>}
      {!data.image && !data.video && !(data.kind==='arrangement'&&shots?.length) && (data.kind !== "group" || data.collapsed) && <p>{(data.kind==="shot"?data.text.split("\n")[0]:data.text.slice(0,90))}{data.kind!=="shot"&&data.text.length>90?"…":""}</p>}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}
function AgentOrchestrationNode({data}:NodeProps<AgentNode>) {
  if(data.kind==="stage") return <article className="agent-stage">
    <Handle type="target" position={Position.Left}/>
    <div className="agent-stage-head"><strong>{data.title}</strong><small>{data.subtitle}</small></div>
    <p className="agent-stage-gate">{data.text}</p>
    <Handle type="source" position={Position.Right}/>
    <Handle type="source" position={Position.Bottom} id="down"/>
  </article>;
  const creator=data.kind==="creator";
  return <article className={`agent-role ${data.kind}`}>
    {creator?<Handle type="target" position={Position.Top} id="in"/>:<Handle type="target" position={Position.Left} id="forward"/>}
    <div className="agent-role-head"><strong>{data.title}</strong><span>{data.subtitle}</span></div>
    <div className="agent-role-list">{data.roles.map(role=><span key={role}>{role}</span>)}</div>
    {creator?<><Handle type="source" position={Position.Right} id="forward"/><Handle type="target" position={Position.Bottom} id="loop-in"/></>
      :<Handle type="source" position={Position.Bottom} id="loop-out"/>}
  </article>;
}
const nodeTypes = { artifact: ArtifactNode, agent: AgentOrchestrationNode };
function nodeAccessibilityLabel(node: CanvasNode) {
  const progress = {
    running: "执行中",
    completed: "已完成",
    failed: "执行失败，需要处理",
    waiting: "等待执行",
  }[node.data.progress || "waiting"];
  const type = ["book", "group"].includes(node.data.kind)
    ? "使用节点内的按钮展开或切换视图"
    : "按 Enter 或空格打开详情，Shift+F10 打开节点菜单";
  const page = node.data.pageNumber ? `第 ${node.data.pageNumber} 页，` : "";
  return `${page}${node.data.title}，${node.data.subtitle}，${progress}。${type}`;
}
type Props = {
  onRefresh:()=>Promise<void>;
  onDelete:(selections:DeleteSelection[],revision:string)=>Promise<void>;
  projectReady: boolean;
  projectPath?: string;
  onOpenProject: () => void;
  session?: AgentSession | null;
  canvasCommand: CanvasCommand | null;
  onMessage: (text: string, options:MessageOptions) => Promise<void>;
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
  textModel?: string;
  onHome: () => void;
  onState: (state: CanvasState) => Promise<void>;
  registerFlush: (flush:()=>Promise<void>)=>()=>void;
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
  onRunPages:(stage:RunStage,pages:number[])=>void;
  execution?:{run:string;index:number;total:number}|null;
  onLoadPages: (pages:number[]) => Promise<void>;
  onActivate: (path:string) => Promise<boolean>;
  onGenerate: (dry: boolean) => void;
  onDetails: (tab: string) => void;
  onExport: (path: string) => void;
};
export function CanvasWorkspace(props: Props) {
  const [highlightTask,setHighlightTask]=useState("");
  const [viewMode,setViewMode]=useState<"artifacts"|"architecture">("artifacts");
  const [harness,setHarness]=useState<AgentStage[]|null>(null);
  useEffect(()=>{
    if(viewMode!=="architecture"||harness)return;
    let live=true;
    void window.manga.run("read_agent_harness")
      .then(result=>{if(live)setHarness(Array.isArray(result?.stages)?result.stages as AgentStage[]:[]);})
      .catch(()=>{if(live)setHarness([]);});
    return()=>{live=false;};
  },[viewMode,harness]);
  const agentModel=useMemo(()=>agentGraph(harness||[]),[harness]);
  const [search,setSearch]=useState(''),[searchOpen,setSearchOpen]=useState(false),[searchError,setSearchError]=useState('');
  const [localCommand,setLocalCommand]=useState<CanvasCommand|null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [stageSize,setStageSize]=useState({width:0,height:0});
  const processed = useRef<string>("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const conversationPanel=usePanelRef();
  const allEvents = useMemo(() => mergeEvents(props.session?.events, props.run?.events, props.events)
    .filter(e => !e.run_dir || !props.run || e.run_dir === props.run.directory), [props.session?.events, props.run?.events, props.events, props.run?.directory]);
  const [foldView,setFoldView]=useState<CanvasView>(props.view||emptyView());
  const viewDirty=useRef(false), latestView=useRef(foldView);
  latestView.current=foldView;
  const book=props.session?.book;
  const pageId=props.view?.workspace?.page_id;
  const currentPage=book?.pages.find(page=>page.id===pageId);
  const overview=!!book&&props.view?.workspace?.mode!=='page';
  const pageKey=currentPage?.id||props.run?.directory||'';
  const executingTask=[...(props.session?.workflow?.tasks||[])].reverse().find(task=>task.status==='running'&&task.run);
  const execution=props.execution||(executingTask?{run:executingTask.run,index:1,total:1}:null);
  const timelineBusy=props.busy&&(!book||overview||execution?.run===props.run?.directory);
  const [pickedPages,setPickedPages]=useState<number[]>([]);
  const [pageJump,setPageJump]=useState('');
  useEffect(()=>setPageJump(''),[pageId]);
  const [pickedRuns,setPickedRuns]=useState<string[]>([]);
  useEffect(()=>{
    if(props.session?.book){const paths=new Set(Object.values(props.session.page_runs||{}));setPickedRuns(old=>old.filter(path=>paths.has(path)));}
  },[props.session?.page_runs]);
  function changeView(update:(previous:CanvasView)=>CanvasView) {viewDirty.current=true;const value=update(latestView.current);latestView.current=value;setFoldView(value);}
  useEffect(()=>{
    const previous=latestView.current.workspace,next=props.view?.workspace;
    if(previous?.page_id!==next?.page_id||previous?.mode!==next?.mode){viewDirty.current=false;setFoldView(props.view||emptyView());}
    else if(!viewDirty.current)setFoldView(props.view||emptyView());
  },[props.view]);
  useEffect(()=>{
    if((props.busy&&!book)||!viewDirty.current)return;
    const value=foldView;
    const timer=setTimeout(()=>{void props.onView(value).then(()=>{if(latestView.current===value)viewDirty.current=false;}).catch(()=>{});},220);
    return()=>clearTimeout(timer);
  },[foldView,props.busy]);
  const model = useMemo(()=>{
    const book=props.session?.book;
    const directory=props.run?.directory||`preview:${currentPage?.id||'page'}`;
    const branches:PageBranch[]=[{directory,number:currentPage?.number,thumbnail:currentPage?.thumbnail,run:props.run,state:props.state}];
    const result=bookGraph(branches,directory,foldView,allEvents,props.busy,book,true);
    result.nodes=result.nodes.map(n=>({...n,ariaLabel:nodeAccessibilityLabel(n),data:{...n.data,
      pageRuns:props.session?.page_runs,
      busy:props.busy||!props.projectReady||!!props.run?.experimental||!!props.run?.simulation,
      ...((n.data.kind==='source'||n.data.kind==='arrangement'||n.data.kind==='group'||n.id.endsWith('::final')||n.id==='final')&&n.data.run&&props.run?(()=>{
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
    return {...result,branches};
  },[props.run,props.state,props.otherRuns,props.session?.book,props.session?.page_runs,props.session?.active_page_id,foldView,allEvents,props.busy,props.projectReady,pickedRuns,currentPage?.id]);
  const [nodes, setNodes] = useState<CanvasNode[]>(model.nodes),
    [selected, setSelected] = useState<string | null>(props.view?.page_views?.[pageKey]?.selected||null),
    [rightPanel,setRightPanel] = useState<"chat"|"detail">("chat"),
    [rightPanelOpen,setRightPanelOpen] = useState(()=>window.innerWidth>1100),
    [showMap, setShowMap] = useState(false),
    [showEdges, setShowEdges] = useState(true),
    [zoomPercent, setZoomPercent] = useState(100),
    [draft, setDraft] = useState(props.view?.composer?.text||props.state.draft);
  const renderNodes:CanvasNode[]=viewMode==="architecture"?(agentModel.nodes as unknown as CanvasNode[]):nodes;
  const renderEdges=viewMode==="architecture"?agentModel.edges:model.edges;
  const details=rightPanel==="detail";
  const setDetails=(value:boolean)=>{
    if(value)setRightPanelOpen(true);
    setRightPanel(value?"detail":"chat");
  };
  const [flowReady,setFlowReady]=useState(false);
  const autoOverview=useRef(true), lastOverview=useRef("");
  useEffect(()=>{
    if(viewMode!=="architecture"||!flowReady||!agentModel.nodes.length)return;
    const frame=requestAnimationFrame(()=>{void flowRef.current?.fitView({padding:.18,duration:220});});
    return()=>cancelAnimationFrame(frame);
  },[viewMode,flowReady,agentModel.nodes.length]);
  useEffect(()=>{
    if(viewMode==="artifacts"){autoOverview.current=true;lastOverview.current="";}
  },[viewMode]);
  const suggestedStage=nextRunStage(props.run);
  const [references,setReferences]=useState<CanvasReference[]>(props.view?.composer?.references||props.state.draft_references||[]);
  const [delivery,setDelivery]=useState<'steer'|'follow_up'>(props.view?.composer?.delivery||props.state.draft_delivery||'steer');
  const [referenceError,setReferenceError]=useState('');
  const [nodeMenu,setNodeMenu]=useState<{node:CanvasNode;trigger:HTMLElement|null}|null>(null);
  const menuFocus=useRef<'node'|'composer'|'dialog'>('node');
  const [removal,setRemoval]=useState<{node:CanvasNode;scope:'node'|'downstream';selections:DeleteSelection[];preview?:DeletePreview}|null>(null);
  const [removing,setRemoving]=useState(false),[removalError,setRemovalError]=useState('');
  const [draftNode,setDraftNode]=useState(props.view?.composer?.node||props.state.draft_node||'');
  const draftPage=useRef({page_id:props.view?.composer?.page_id||'',run:props.view?.composer?.run||''});
  useEffect(()=>{
    const stage=stageRef.current;
    if(!stage)return;
    const update=()=>setStageSize(previous=>{
      const toolbar=stage.querySelector<HTMLElement>('.canvas-commandbar');
      if(toolbar)stage.style.setProperty('--canvas-toolbar-height',`${toolbar.offsetHeight}px`);
      const width=Math.round(stage.clientWidth),height=Math.round(stage.clientHeight);
      return previous.width===width&&previous.height===height?previous:{width,height};
    });
    update();
    const observer=new ResizeObserver(update);
    observer.observe(stage);
    const toolbar=stage.querySelector<HTMLElement>('.canvas-commandbar');
    if(toolbar)observer.observe(toolbar);
    return()=>observer.disconnect();
  },[]);
  async function addReference(purpose:'target'|'reference',targets?:CanvasNode[]){
    setReferenceError('');
    if(!props.run){setReferenceError("请先开始这一页的制作，再引用生成对象");return;}
    if(!props.projectReady){setReferenceError('请先打开项目，再添加引用');return;}
    try{
      const picked=(targets||nodes.filter(n=>n.selected)).filter(n=>n.data.run&&(n.data.baseId||n.data.kind==='page'));
      if(!picked.length)throw new Error('请先在画布选中一个已有对象');
      const captured:CanvasReference[]=[];
      for(const directory of new Set(picked.map(n=>n.data.run!))){
        const result=await window.manga.run('capture_references',{run_dir:directory,
          node_ids:picked.filter(n=>n.data.run===directory).map(n=>n.data.baseId||'source'),purpose});
        captured.push(...result.references);
      }
      dirty.current=true;draftVersion.current++;
      setReferences(old=>[...old.filter(r=>!captured.some(c=>c.run===r.run&&c.node_id===r.node_id&&c.purpose===r.purpose)),...captured]);
    }catch(error){setReferenceError((error as Error).message);}
  }
  const [runTarget,setRunTarget]=useState<RunStage>(suggestedStage);
  useEffect(()=>setRunTarget(suggestedStage),[props.run?.directory,suggestedStage]);
  const stateRef = useRef(props.state),
    dirty = useRef(false);
  const draftContext=useRef({draft_node:draftNode,draft_references:references,draft_delivery:delivery});
  draftContext.current={draft_node:draftNode,draft_references:references,draft_delivery:delivery};
  const draftVersion=useRef(0),latestDraft=useRef(draft);
  latestDraft.current=draft;
  const [saveStatus,setSaveStatus]=useState('');
  const pendingSave=useRef<Promise<void>|null>(null);
  async function saveDraft(){
    if(pendingSave.current)await pendingSave.current;
    if(!dirty.current)return;
    const version=draftVersion.current;
    setSaveStatus('正在保存…');
    const pending=book?(async()=>{
      const value={...latestView.current,composer:{text:latestDraft.current,node:draftContext.current.draft_node,references:draftContext.current.draft_references,delivery:draftContext.current.draft_delivery,...draftPage.current}};
      changeView(()=>value);await props.onView(value);
      if(latestView.current===value)viewDirty.current=false;
    })():props.onState({...stateRef.current,draft:latestDraft.current,...draftContext.current});
    pendingSave.current=pending;
    try{
      await pending;
      if(version===draftVersion.current){dirty.current=false;setSaveStatus('草稿已保存');}
    }catch(e){setSaveStatus('保存失败 · 草稿保留');throw e;}
    finally{if(pendingSave.current===pending)pendingSave.current=null;}
  }
  const flushRef=useRef(async()=>{});
  flushRef.current=async()=>{
    await saveDraft();
    if(viewDirty.current){const value=latestView.current;await props.onView(value);if(latestView.current===value)viewDirty.current=false;}
  };
  useEffect(()=>props.registerFlush(()=>flushRef.current()),[]);
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
    if(book)return;
    dirty.current=false;draftVersion.current++;latestDraft.current=props.state.draft;
    setDraft(props.state.draft);setDraftNode(props.state.draft_node||'');setReferences(props.state.draft_references||[]);
    setDelivery(props.state.draft_delivery||'steer');setSaveStatus('');setSelected(props.state.draft_node||null);setDetails(false);
  },[props.run?.directory]);
  useEffect(() => {
    if(!book&&!dirty.current)setDraft(props.state.draft);
  },[props.state.draft]);
  useEffect(() => {
    if(props.busy||!dirty.current)return;
    const timer=setTimeout(()=>{void saveDraft().catch(()=>{});},600);
    return()=>clearTimeout(timer);
  },[draft,references,delivery,draftNode,props.busy]);
  useEffect(() => {
    const actual=model.logical.filter(n=>n.data.run===props.run?.directory);
    props.onContext({run:props.run?.directory,selected:nodes.filter(n=>n.selected&&n.data.run===props.run?.directory&&n.data.baseId).map(n=>n.data.baseId!),
      nodes:actual.map(n=>({id:n.data.baseId!,title:n.data.title,kind:n.data.kind,location:n.data.location,stage:n.data.stage}))});
  },[nodes,props.run?.directory]);
  useEffect(() => {
    const command=props.canvasCommand||localCommand;
    if(command===localCommand&&command?.run!==props.run?.directory)return;
    const report=(command:CanvasCommand,result:{status:string;summary:string})=>{
      if(command===localCommand){setLocalCommand(null);if(result.status==='failed')setSearchError(result.summary);}
      else props.onCanvasResult(command,result);
    };
    if(!command||!flowRef.current||processed.current===command.call_id)return;
    const actual=model.logical.filter(n=>n.data.run===props.run?.directory).map(n=>({...n,id:n.data.baseId!}));
    try {validateCanvasCommand(command,props.run?.directory,actual);} catch(error){processed.current=command.call_id;report(command,{status:"failed",summary:(error as Error).message});return;}
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
        report(command,{status:"completed",summary:"画布操作完成"});
      }catch(error){report(command,{status:"failed",summary:(error as Error).message});}
    })();
  },[props.canvasCommand,localCommand,nodes,props.run?.directory]);
  const inputPage = wholePage(props.run, props.state);
  const node = nodes.find((n) => n.id === selected),
    hasSource = !!sourceData(props.run);
  const overviewNodes=useMemo(()=>{
    const path=props.run?.directory;
    if(!path)return [];
    const runNodes=nodes.filter(n=>n.data.run===path&&n.data.kind!=='group');
    const chosen:CanvasNode[]=[];
    const add=(node?:CanvasNode)=>{if(node&&!chosen.some(item=>item.id===node.id))chosen.push(node);};
    add(nodes.find(n=>n.id===selected));
    add(nodes.find(n=>n.id===`page:${path}`));
    for(const kind of ['source','panel','arrangement','shot','frame','video'] as const)
      add(runNodes.find(n=>n.data.kind===kind));
    add(runNodes.find(n=>n.data.kind==='video'&&(n.data.baseId==='final'||n.id.endsWith('::final')||n.id==='final')));
    return chosen;
  },[nodes,props.run?.directory,selected]);
  const workingNodes=workingSet(nodes,props.run?.directory||"",selected);
  const workingSignature=workingNodes.map(n=>n.id).join('|');
  const overviewSignature=overviewNodes.map(n=>n.id).join('|');
  async function fitOverview(duration=220){
    if(!overviewNodes.length)return false;
    return !!(await flowRef.current?.fitView({
      nodes:overviewNodes,padding:.08,minZoom:.15,maxZoom:.85,duration,
    }));
  }
  // 节点和文字统一随视口缩放，远景仍保留真实关系，不切换成另一套展示形态。
  function applyZoom(zoom:number){
    setZoomPercent(Math.round(zoom*100));
  }
  useEffect(()=>{
    const path=props.run?.directory;
    autoOverview.current=true;lastOverview.current="";
    if(!path)return;
  },[props.run?.directory]);
  useEffect(()=>{
    const path=props.run?.directory;
    const signature=`${path}:${stageSize.width}x${stageSize.height}:${overviewSignature}:${workingSignature}`;
    if(overview||viewMode!=='artifacts'||latestView.current.page_views?.[pageKey]?.viewport||!flowReady||!path||!stageSize.width||!autoOverview.current||lastOverview.current===signature)return;
    if(!overviewNodes.length||!overviewNodes.some(n=>n.measured?.width))return;
    const frame=requestAnimationFrame(()=>{void (workingNodes.length?flowRef.current!.fitView({nodes:workingNodes,padding:.16,minZoom:.35,maxZoom:.85,duration:180}):fitOverview(180)).then(ok=>{if(ok&&autoOverview.current)lastOverview.current=signature;});});
    return()=>cancelAnimationFrame(frame);
  },[flowReady,props.run?.directory,stageSize.width,stageSize.height,overviewSignature,workingSignature,overview,pageKey]);
  const restoredPage=useRef('');
  useEffect(()=>{
    if(overview||!flowReady||!pageKey||restoredPage.current===pageKey)return;
    const saved=latestView.current.page_views?.[pageKey];
    restoredPage.current=pageKey;setSelected(saved?.selected||null);setDetails(false);
    setNodes(previous=>previous.map(node=>({...node,selected:node.id===saved?.selected})));
    if(saved?.viewport){autoOverview.current=false;void flowRef.current?.setViewport(saved.viewport);}
    else{autoOverview.current=true;lastOverview.current='';void flowRef.current?.setViewport({x:35,y:95,zoom:0.68});}
  },[pageKey,flowReady,overview]);
  function rememberPage(){
    if(!pageKey||overview||viewMode!=='artifacts'||!flowRef.current)return;
    const viewport=flowRef.current.getViewport();
    changeView(previous=>({...previous,page_views:{...previous.page_views,[pageKey]:{viewport,selected}}}));
  }
  useEffect(()=>{
    if(!pageKey||overview)return;
    changeView(previous=>({...previous,page_views:{...previous.page_views,[pageKey]:{...previous.page_views?.[pageKey],selected}}}));
  },[selected]);
  function move(changes: NodeChange<CanvasNode>[]) {
    setNodes((nodes) => applyNodeChanges(changes, nodes));
  }
  function savePositions(_:unknown, dragged:CanvasNode) {
    changeView(v=>({...v,positions:{...v.positions,...Object.fromEntries(nodes.map(n=>[n.id,n.id===dragged.id?dragged.position:n.position]))}}));
  }
  async function send() {
    if(!draft.trim())return;
    const text=draft.trim(),requestContext={...draftPage.current},version=draftVersion.current;
    let captured=references;
    try{
      const bound=model.logical.find(node=>node.id===draftNode);
      if(props.run&&bound?.data.run&&bound.data.baseId&&!captured.some(ref=>ref.purpose==='target')){
        const result=await window.manga.run('capture_references',{run_dir:bound.data.run,node_ids:[bound.data.baseId],purpose:'target'});
        captured=[...captured,...result.references];
      }
      const explicit=captured.find(ref=>ref.purpose==='target');
      const options={delivery,references:captured,...requestContext,...(explicit?{run:explicit.run,page_id:explicit.page?.page_id}: {})};
      if(version!==draftVersion.current)return;
      latestDraft.current='';setDraft('');setReferences([]);setDraftNode('');setDelivery('steer');setReferenceError('');draftPage.current={page_id:'',run:''};dirty.current=true;draftVersion.current++;
      if(!book&&!props.busy)await props.onState({...stateRef.current,draft:'',draft_node:'',draft_references:[],draft_delivery:'steer'});
      await props.onMessage(text,options);
    }catch(error){
      if(!latestDraft.current){setDraft(text);latestDraft.current=text;setReferences(captured);draftPage.current=requestContext;dirty.current=true;draftVersion.current++;}
      setReferenceError((error as Error).message);
    }
  }
  const knownRuns=props.run?[props.run,...props.otherRuns.filter(r=>r.directory!==props.run!.directory)]:props.otherRuns;
  const referenceImages=Object.fromEntries(references.flatMap(reference=>{
    if(reference.kind!=='video')return [];
    const shot=reference.node_id.split(':')[1];
    const frame=model.logical.find(candidate=>candidate.data.run===reference.run&&candidate.data.image&&candidate.data.baseId?.startsWith(`frame:${shot}_`));
    return frame?.data.image?[[reference.id,frame.data.image]]:[];
  }));
  const searchNodes=model.logical.filter(n=>`${n.data.pageNumber?`第 ${n.data.pageNumber} 页`:''} ${n.data.title} ${n.data.subtitle} ${stageNames[n.data.stage]}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0,30);
  async function locateSearch(n:CanvasNode){
    setSearchError('');
    if(!n.data.run||!n.data.baseId)return;
    if(n.data.run!==props.run?.directory){if(props.busy){setSearchError('请等待或停止当前任务后切页');return;}if(!await props.onActivate(n.data.run)){setSearchError('页面未能切换，请检查保存状态后重试');return;}}
    setLocalCommand({kind:'canvas',call_id:crypto.randomUUID(),revision:0,run:n.data.run,operation:'focus',node_ids:[n.data.baseId],dx:0,dy:0});
    setSearchOpen(false);
  }
  function selectNode(node:CanvasNode){
    if(node.data.run&&node.data.run!==props.run?.directory){if(props.busy)return;void props.onActivate(node.data.run);}
    if(node.data.kind==="book"||node.data.kind==="group")return;
    setNodes(previous=>previous.map(item=>({...item,selected:item.id===node.id})));
    setSelected(node.id);setDetails(true);
  }
  function selectAgentNode(node:CanvasNode){
    const task=[...(props.session?.workflow?.tasks||[])].reverse().find(candidate=>candidate.stage===node.data.stage);
    if(task){setDetails(false);setHighlightTask(task.parent_id||task.id);}
  }
  function selectNodeWithKeyboard(event:React.KeyboardEvent<HTMLDivElement>){
    const contextKey=event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey);
    if(!contextKey&&!["Enter"," "].includes(event.key)||event.defaultPrevented||event.nativeEvent.isComposing)return;
    const target=event.target as HTMLElement;
    if(target.closest("button,input,textarea,select,a,summary"))return;
    const wrapper=target.closest<HTMLElement>(".react-flow__node[data-id]");
    if(!wrapper||wrapper!==target)return;
    const node=nodes.find(item=>item.id===wrapper.dataset.id);
    if(!node)return;
    event.preventDefault();event.stopPropagation();
    if(contextKey){
      const bounds=wrapper.getBoundingClientRect();
      wrapper.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:bounds.left+16,clientY:bounds.top+16}));
    }else selectNode(node);
  }
  function openNodeMenu(node:CanvasNode,trigger:HTMLElement|null){
    menuFocus.current='node';setNodeMenu({node,trigger});
  }
  async function requestRemoval(node:CanvasNode,scope:'node'|'downstream'){
    const selections:DeleteSelection[]=node.data.kind==='book'
      ? model.branches.map(branch=>({run_dir:branch.directory,node_ids:['source'],scope}))
      : [{run_dir:node.data.run!,node_ids:[node.data.kind==='page'?'source':node.data.kind==='group'?`group:${node.id.split(':').at(-1)}`:node.data.baseId||node.id],scope}];
    const request={node,scope,selections};
    menuFocus.current='dialog';setRemovalError('');setRemoval(request);
    try{
      await flushRef.current();
      const preview:DeletePreview=await window.manga.run('preview_canvas_delete',{selections});
      setRemoval(current=>current===request?{...request,preview}:current);
    }catch(error){setRemovalError((error as Error).message);}
    finally{viewDirty.current=false;}
  }
  async function confirmRemoval(){
    if(!removal?.preview||removing||props.busy)return;
    setRemoving(true);setRemovalError('');
    try{
      await props.onDelete(removal.selections,removal.preview.revision);
      setSelected(null);setDetails(false);
      const runs=new Set(removal.selections.map(s=>s.run_dir));
      setReferences(previous=>previous.filter(ref=>!runs.has(ref.run)));
      setDraftNode('');dirty.current=true;draftVersion.current++;
      closeRemoval();
    }catch(error){setRemovalError((error as Error).message);}
    finally{setRemoving(false);}
  }
  function closeRemoval(){
    const identifier=removal?.node.id;
    setRemoval(null);
    requestAnimationFrame(()=>{
      const target=identifier?workspaceRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(identifier)}"]`):null;
      (target||workspaceRef.current?.querySelector<HTMLElement>('.canvas-overview-button'))?.focus();
    });
  }
  function referenceFromMenu(node:CanvasNode,purpose:'target'|'reference'){
    menuFocus.current='composer';setRightPanelOpen(true);setRightPanel('chat');
    void addReference(purpose,[node]);
  }
  function showOverview(){
    autoOverview.current=false;lastOverview.current="";
    void fitOverview().then(ok=>{if(ok)lastOverview.current=overviewSignature;});
  }
  function toggleRightPanel(){
    autoOverview.current=true;lastOverview.current="";
    setRightPanelOpen(open=>!open);
  }
  return (
    <div className="canvas-workspace" ref={workspaceRef}>
      {removal&&<AlertDialog open onOpenChange={open=>{if(!open&&!removing)closeRemoval();}}><AlertDialogContent className="canvas-delete-dialog w-[min(640px,calc(100vw-32px))] sm:max-w-none max-h-[85vh] overflow-auto" onEscapeKeyDown={e=>{if(removing)e.preventDefault();}}>
        <AlertDialogTitle>{removal.scope==='node'?'永久删除生成结果？':'永久删除下游产物？'}</AlertDialogTitle>
        <p>{removal.scope==='node'?`清理「${removal.node.data.title}」对应的生成结果及依赖它的下游产物。`:`清理「${removal.node.data.title}」之后的生成结果，保留当前阶段的上游信息。`}</p>
        <AlertDialogDescription>原始漫画页、整本漫画和素材库文件保留。生成图片、视频、本地任务与审查记录按下面的范围永久清除，无法恢复。</AlertDialogDescription>
        {removal.preview?<><p>将删除 {removal.preview.file_count} 个文件，更新 {removal.preview.record_count} 份关联记录。</p>
          <details><summary>查看清理范围</summary><div className="canvas-delete-files">
            {removal.preview.runs.map(run=><div key={run.run_dir}><strong>{run.run_dir.split('/').at(-1)}</strong>{run.files.map(file=><div key={file}>{file}</div>)}{run.records.map(file=><div key={file}>更新：{file}</div>)}</div>)}
            <div>保留：原始漫画页、整本漫画与素材库文件</div>
          </div></details>
          {!!removal.preview.remote_tasks&&<p className="environment-hint">包含 {removal.preview.remote_tasks} 个已提交的远端任务记录。删除本地记录不会取消远端任务，之后无法从本地继续查询这些任务。</p>}
        </>:!removalError&&<p role="status">正在核对产物…</p>}
        {removalError&&<p className="environment-error" role="alert">{removalError}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={removing}>取消</AlertDialogCancel><Button variant="destructive" disabled={props.busy||removing||!removal.preview||!removal.preview.file_count&&!removal.preview.record_count} onClick={()=>void confirmRemoval()}>{removing?'正在删除…':'永久删除'}</Button></AlertDialogFooter>
      </AlertDialogContent></AlertDialog>}
      <ResizablePanelGroup orientation="horizontal" id="canvas-layout" className="min-h-0 flex-1">
      <ResizablePanel id="stage" minSize={326}>
      <ContextMenu onOpenChange={open=>{if(!open)setNodeMenu(null);}}><ContextMenuTrigger asChild onContextMenu={event=>{if(!(event.target as HTMLElement).closest('.react-flow__node'))event.preventDefault();}}>
      <section className="canvas-stage" ref={stageRef}>
        <div className="canvas-commandbar">
          <div className="canvas-navigation">
            <Tooltip label="返回首页">
              <Button size="icon" variant="ghost" aria-label="返回首页" onClick={props.onHome}>
                <ArrowLeft size={16} />
              </Button>
            </Tooltip>
            {book&&<><Button variant="ghost" size="sm" onClick={()=>{rememberPage();changeView(previous=>({...previous,workspace:{mode:'overview',page_id:pageId}}));}}>全书</Button>
              {!overview&&<form className="page-canvas-navigation" onSubmit={event=>{event.preventDefault();const number=Number(pageJump);if(Number.isInteger(number)&&number>=1&&number<=book.page_count){props.onSelectPage(number);setPageJump('');}}}>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="上一页漫画" disabled={!currentPage||currentPage.number<=1} onClick={()=>props.onSelectPage(currentPage!.number-1)}><ArrowLeft size={13}/></Button>
                <Input aria-label="跳转文件页" inputMode="numeric" placeholder={`第 ${currentPage?.number||'—'} 页`} value={pageJump} onChange={event=>setPageJump(event.target.value)}/>
                <Button type="submit" variant="ghost" size="icon-sm" aria-label="打开指定页" disabled={!pageJump.trim()}><ChevronRight size={13}/></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="下一页漫画" disabled={!currentPage||currentPage.number>=book.page_count} onClick={()=>props.onSelectPage(currentPage!.number+1)}><ArrowRight size={13}/></Button>
              </form>}</>}
            {!overview&&<ToggleGroup value={viewMode} onValueChange={next=>setViewMode(next as "artifacts"|"architecture")} label="画布视图" className="canvas-view-toggle">
              <ToggleGroupItem value="artifacts">画布</ToggleGroupItem>
              <ToggleGroupItem value="architecture">协作图</ToggleGroupItem>
            </ToggleGroup>}
            {props.run?.simulation && <span className="simulation-label">本地演示 · 不调用模型</span>}
            {!overview&&<Popover open={searchOpen} onOpenChange={setSearchOpen}><Tooltip label="搜索节点"><PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label="搜索已加载节点"><Search size={15}/></Button></PopoverTrigger></Tooltip>
              <PopoverContent align="start" className="w-80 max-w-[calc(100vw-32px)] p-0"><Command shouldFilter={false}><CommandInput aria-label="节点名称或页码" placeholder="搜索名称、页码或阶段" value={search} onValueChange={setSearch}/><CommandList><CommandEmpty>已加载内容中没有匹配节点。</CommandEmpty>{searchNodes.map(n=><CommandItem key={n.id} value={n.id} onSelect={()=>void locateSearch(n)}><span>{n.data.title}</span><small className="ml-auto">{n.data.pageNumber?`第 ${n.data.pageNumber} 页 · `:''}{stageNames[n.data.stage]}</small></CommandItem>)}</CommandList></Command><p className="m-0 border-t px-3 py-2 text-xs text-muted-foreground">仅搜索已加载的页面与节点</p></PopoverContent>
            </Popover>}
            {!overview&&<Tooltip label="显示全流程总览"><Button size="sm" variant="ghost" className="canvas-overview-button" aria-label="显示全流程总览" onClick={showOverview}><Scan size={14}/></Button></Tooltip>}
            <Tooltip label={rightPanelOpen?"收起右侧工作区":"展开右侧工作区"}><Button size="icon" variant="ghost" aria-label={rightPanelOpen?"收起右侧工作区":"展开右侧工作区"} aria-pressed={rightPanelOpen} onClick={toggleRightPanel}>{rightPanelOpen?<PanelRightClose size={15}/>:<PanelRightOpen size={15}/>}</Button></Tooltip>
          </div>
          <div className="canvas-run-controls">
            <span className="run-scope">{props.busy&&execution?`${runOrigin(execution.run,props.session)} · ${execution.index}/${execution.total}`:overview?(pickedPages.length?`所选 ${pickedPages.length} 页`:'全书'):currentPage?`第 ${currentPage.number} 页`:props.run?.simulation?'本地演示':'当前页'}</span>
            {props.busy&&execution&&<Button size="sm" variant="ghost" onClick={()=>void props.onActivate(execution.run)}>查看运行页</Button>}
            {!props.run?.simulation && <Select className="w-28 shrink-0 border-0 bg-muted py-0 leading-4 shadow-none" label="制作终点" disabled={props.busy||!props.projectReady} value={runTarget} onValueChange={value=>setRunTarget(value as RunStage)}>
              {Object.entries(runStageNames).map(([stage,label])=><SelectItem key={stage} value={stage}>{label}</SelectItem>)}
            </Select>}
            {(!overview||props.busy)&&<Button variant={props.busy ? "outline" : "default"} className="leading-4 bg-[#2b2c32] text-white hover:bg-[#41424a]"
              disabled={(!props.busy&&overview&&!pickedPages.length)||props.stopping||(!props.busy&&!props.projectReady&&!props.run?.simulation)||(!props.busy && (!!props.run?.experimental || props.run?.simulation?.completed || (!inputPage && !props.session?.book)))}
              title={props.run?.simulation ? "本地模拟任务；停止后可继续，完成后可从首页重新体验" : props.busy ? "停止本地执行，已提交的远端任务可能仍在运行" : `制作至${runStageNames[runTarget]}，完成后暂停`}
              onClick={props.busy ? props.onStop : ()=>overview?props.onRunPages(runTarget,pickedPages):props.onRun(runTarget,undefined,'until')}>
              {props.busy ? <Square size={13} /> : <Play size={13} />} {props.stopping?'正在停止…':props.busy ? "停止" : props.run?.simulation?.completed ? "已完成" : props.run?.simulation ? "继续演示" : pickedRuns.length ? `制作所选 ${pickedRuns.length} 项` : "继续制作"}
            </Button>}
            <ActionMenu label="画布更多操作" trigger={<MoreHorizontal size={17}/>}>
              <Item onSelect={()=>{autoOverview.current=true;lastOverview.current="";if(workingNodes.length)void flowRef.current?.fitView({nodes:workingNodes,padding:.16,minZoom:.35,maxZoom:.85,duration:220});}}>返回当前镜头</Item>
              {book&&<Item onSelect={()=>changeView(previous=>({...previous,workspace:{mode:'overview',page_id:pageId}}))}>全书总览</Item>}
              <Item disabled={!!props.run?.simulation} onSelect={props.onSource}>检查分格</Item>
              <Item disabled={!node} onSelect={()=>setDetails(true)}>节点详情</Item>
              <Item onSelect={()=>props.onDetails('planning')}>镜头规划</Item>
              <Item onSelect={()=>props.onDetails('generation')}>视频任务</Item>
              <Item onSelect={()=>props.onDetails('results')}>视频结果</Item>
            </ActionMenu>
          </div>
        </div>
        {searchError&&<p className="node-search-error" role="alert">{searchError}</p>}
        {props.session?.book&&<BookOverview visible={overview} session={props.session} selected={pickedPages} onSelected={setPickedPages} onOpen={props.onSelectPage} onLoad={props.onLoadPages} onProduce={pages=>props.onRunPages(runTarget,pages)} busy={props.busy} ready={props.projectReady}/>}
        <div className="page-flow-surface" hidden={overview}>
        <ReactFlow<CanvasNode>
          onInit={instance => {flowRef.current = instance;applyZoom(instance.getZoom());setFlowReady(true);}}
          onMove={(_,viewport)=>applyZoom(viewport.zoom)}
          onMoveEnd={rememberPage}
          nodes={renderNodes}
          edges={showEdges?renderEdges:[]}
          nodeTypes={nodeTypes}
          onNodesChange={viewMode==="architecture"?undefined:move}
          onNodeDragStop={viewMode==="architecture"?undefined:savePositions}
          onNodeClick={viewMode==="architecture"?(_,n)=>selectAgentNode(n):(_,n)=>selectNode(n)}
          onNodeContextMenu={viewMode==="architecture"?undefined:(event,node)=>{openNodeMenu(node,(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node'));}}
          onNodeDoubleClick={viewMode==="architecture"?undefined:(_,n)=>{if(!props.busy||n.data.run===props.run?.directory)selectNode(n);}}
          onKeyDown={viewMode==="architecture"?undefined:selectNodeWithKeyboard}
          onMoveStart={event=>{if(event){setNodeMenu(null);autoOverview.current=false;lastOverview.current="";}}}
          ariaLabelConfig={{
            'node.a11yDescription.default':'按 Enter 或空格打开节点详情。节点内按钮可单独操作。',
            'controls.zoomIn.ariaLabel':'放大','controls.zoomOut.ariaLabel':'缩小','controls.fitView.ariaLabel':'适应画布'
          }}
          zoomOnDoubleClick={false}
          nodesDraggable={viewMode==="artifacts"&&!props.busy}
          elementsSelectable={viewMode==="artifacts"}
          onPaneClick={() => {
            setDetails(false);
            setSelected(null);
            setNodeMenu(null);
          }}
          nodesConnectable={false}
          elevateEdgesOnSelect={false}
          onlyRenderVisibleElements
          deleteKeyCode={null}
          defaultViewport={props.view?.page_views?.[pageKey]?.viewport||{x:35,y:95,zoom:0.68}}
          minZoom={0.15}
          maxZoom={1.6}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e4e4e9" />
          <Panel position="bottom-left" className="canvas-control-panel">
            <ButtonGroup className="canvas-control-card" role="toolbar" aria-label="画布视图工具">
              <Tooltip label="缩小"><Button variant="ghost" size="sm" className="canvas-control" type="button" aria-label="缩小"
                onClick={()=>void flowRef.current?.zoomOut({duration:160})}><Minus size={14}/></Button></Tooltip>
              <Tooltip label="重置为 100%"><Button variant="ghost" size="sm" className="canvas-control canvas-zoom-value" type="button"
                aria-label={`当前缩放 ${zoomPercent}%，重置为 100%`}
                onClick={()=>void flowRef.current?.zoomTo(1,{duration:160})}>{zoomPercent}%</Button></Tooltip>
              <Tooltip label="放大"><Button variant="ghost" size="sm" className="canvas-control" type="button" aria-label="放大"
                onClick={()=>void flowRef.current?.zoomIn({duration:160})}><Plus size={14}/></Button></Tooltip>
              <Separator orientation="vertical" className="mx-2 h-4 self-center"/>
              <Tooltip label="适应画布"><Button variant="ghost" size="sm" className="canvas-control" type="button" aria-label="适应画布"
                onClick={()=>void flowRef.current?.fitView({padding:.12,duration:220})}><Scan size={14}/></Button></Tooltip>
              <Tooltip label={showMap?'隐藏地图':'显示地图'}><Button variant="ghost" size="sm" className="canvas-control" type="button"
                aria-label={showMap?'隐藏地图':'显示地图'} aria-pressed={showMap}
                onClick={()=>setShowMap(value=>!value)}><Map size={14}/></Button></Tooltip>
              <Tooltip label={showEdges?'隐藏连线':'显示连线'}><Button variant="ghost" size="sm" className="canvas-control" type="button"
                aria-label={showEdges?'隐藏连线':'显示连线'} aria-pressed={showEdges}
                onClick={()=>setShowEdges(value=>!value)}><Network size={14}/></Button></Tooltip>
            </ButtonGroup>
          </Panel>
          {showMap && <MiniMap
            className="canvas-minimap"
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(n) =>
              n.data.status === "waiting" ? "#e4e4e7" : "#b9b9c2"
            }
            maskColor="#f8f8f8bb"
            style={{bottom:52}}
          />}
        </ReactFlow>
        </div>
        {viewMode==="artifacts"&&props.busy&&!props.run&&!props.session?.book&&<div className="canvas-importing"><LoaderCircle size={20} className="runtime-spin"/><span>{allEvents.some(e=>e.stage.startsWith('book.'))?'正在加载前 10 页…':'正在准备画布…'}</span></div>}
        {viewMode==="artifacts"&&!overview&&!hasSource && !props.busy && !props.run?.experimental && !props.run?.simulation && !!inputPage && (
          <div className="canvas-source-hint">
            <Image size={17} />
            <div>
              <strong>确认分格后开始创作</strong>
            </div>
            <Button size="sm" onClick={book&&!props.run?()=>props.onRun("preprocess"):props.onSource}>
              {book&&!props.run?"开始分格":"检查分格"}
              <ArrowRight size={13} />
            </Button>
          </div>
        )}

      </section>
      </ContextMenuTrigger>
      {nodeMenu&&<ContextMenuContent aria-label="节点操作" onContextMenu={event=>event.preventDefault()} onCloseAutoFocus={event=>{
          event.preventDefault();
          if(menuFocus.current==='composer')requestAnimationFrame(()=>workspaceRef.current?.querySelector<HTMLTextAreaElement>('.canvas-reply textarea')?.focus());
          else if(menuFocus.current==='node'&&nodeMenu.trigger?.isConnected)nodeMenu.trigger.focus();
        }}>
          <ContextMenuLabel>{nodeMenu.node.data.title}</ContextMenuLabel>
          <ContextMenuItem disabled={!props.run||!props.projectReady||!!props.run?.simulation||!nodeMenu.node.data.run||!(nodeMenu.node.data.baseId||nodeMenu.node.data.kind==='page')} onSelect={()=>referenceFromMenu(nodeMenu.node,'target')}><MessageSquare size={14}/>添加到对话</ContextMenuItem>
          <ContextMenuItem disabled={!props.run||!props.projectReady||!!props.run?.simulation||!nodeMenu.node.data.run||!(nodeMenu.node.data.baseId||nodeMenu.node.data.kind==='page')} onSelect={()=>referenceFromMenu(nodeMenu.node,'reference')}><ImagePlus size={14}/>用作参考</ContextMenuItem>
          <ContextMenuItem disabled={['book','group'].includes(nodeMenu.node.data.kind)||(props.busy&&nodeMenu.node.data.run!==props.run?.directory)} onSelect={()=>selectNode(nodeMenu.node)}><SlidersHorizontal size={14}/>查看详情</ContextMenuItem>
          {nodeMenu.node.data.onToggle&&<ContextMenuItem onSelect={nodeMenu.node.data.onToggle}><Layers size={14}/>{nodeMenu.node.data.collapsed?'展开':'收起'}节点</ContextMenuItem>}
          <ContextMenuSeparator/>
          <ContextMenuItem variant="destructive" disabled={!props.run||props.busy||removing||!props.projectReady} onSelect={()=>requestRemoval(nodeMenu.node,'node')}><Trash2 size={14}/>删除节点</ContextMenuItem>
          <ContextMenuItem variant="destructive" disabled={!props.run||props.busy||removing||!props.projectReady||(nodeMenu.node.data.baseId||nodeMenu.node.id)==='final'} onSelect={()=>requestRemoval(nodeMenu.node,'downstream')}><Trash2 size={14}/>删除后续节点</ContextMenuItem>
        </ContextMenuContent>}
      </ContextMenu>
      </ResizablePanel>
      {rightPanelOpen&&<><ResizableHandle aria-label="调整对话宽度" onDoubleClick={()=>conversationPanel.current?.resize(360)} onKeyDown={e=>{if(e.key==='Home'){e.preventDefault();conversationPanel.current?.resize(360);}}}/>
      <ResizablePanel id="conversation" panelRef={conversationPanel} defaultSize={props.chatWidth} minSize={280} maxSize={640} groupResizeBehavior="preserve-pixel-size" onResize={size=>props.onChatWidth(Math.round(size.inPixels))}>
      <aside className="canvas-conversation h-full w-full"><Tabs value={rightPanel} onValueChange={value=>setRightPanel(value as "chat"|"detail")} className="h-full min-h-0 gap-0">
        <TabsContent value="chat" forceMount className="creative-panel">
        {!props.projectReady&&!props.run?.simulation&&<div className="project-required"><span>本地记录 · 打开项目后可编辑</span><Button variant="ghost" size="sm" onClick={props.onOpenProject}>打开项目</Button></div>}
        <CreativeTimeline pageId={overview?undefined:pageId} runs={knownRuns} session={props.run?.simulation?{revision:0,messages:props.state.messages,active_run:props.run.directory,active_page_id:"",workflow:props.run.workflow}:props.session} messages={props.run?.simulation?props.state.messages:props.session?.messages||props.state.messages}
          busy={props.busy} replyBusy={timelineBusy} stopping={props.stopping} onStop={props.onStop} onAction={props.onTaskAction}
          onLocate={props.onLocateTask} onWithdraw={props.onWithdraw} onProcessRequest={props.onProcessRequest} onReference={props.run?.simulation?undefined:props.onReference} highlight={highlightTask} onConversationAction={props.run?.simulation?undefined:props.onConversationAction}
          onNewRequest={()=>requestAnimationFrame(()=>workspaceRef.current?.querySelector<HTMLTextAreaElement>('.canvas-reply textarea')?.focus())} onDetails={()=>setDetails(true)} hasSelection={!!node}/>
        <CreativeComposer model={props.run?.simulation?'本地演示':props.textModel||props.run?.records.find(record=>record.file==='config.json')?.data?.text_model} saveStatus={saveStatus} canSave={dirty.current&&!props.busy} onSave={()=>void saveDraft().catch(()=>{})} target={book&&draftPage.current.page_id?`第 ${book.pages.find(page=>page.id===draftPage.current.page_id)?.number||'?'} 页${draftNode?' · 已引用节点':''}`:draftNode?`草稿目标 · ${model.logical.find(n=>n.id===draftNode)?.data.title||draftNode}`:node?node.data.title:"当前漫画页"}
          permission={props.permission} onPermission={props.onPermission} draft={draft}
          onDraft={value=>{if(!draft){setDraftNode(selected||'');draftPage.current={page_id:overview?'':pageId||'',run:overview?'':props.run?.directory||''};}setDraft(value);latestDraft.current=value;dirty.current=true;draftVersion.current++;setSaveStatus("尚未保存");}} onSend={send} busy={props.busy}
          delivery={delivery} onDelivery={value=>{setDelivery(value);dirty.current=true;draftVersion.current++;}} references={references} onRemoveReference={id=>{setReferences(old=>old.filter(r=>r.id!==id));dirty.current=true;draftVersion.current++;}}
          onAddReference={addReference} referenceError={referenceError} referenceImages={referenceImages} projectPath={props.projectPath}
          disabled={!props.projectReady||!!props.run?.simulation||!!props.run?.experimental} simulation={!!props.run?.simulation}/>
        </TabsContent>
        <TabsContent value="detail" forceMount className="inspector-panel">
        <header className="right-panel-heading"><span><PanelRightClose size={16}/>节点详情</span><Button variant="ghost" size="icon-sm" aria-label="返回创作" onClick={()=>setDetails(false)}><ArrowLeft size={15}/></Button></header>
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
            <Badge variant="secondary">{node.data.subtitle}</Badge>
            <h3 className="detail-section-title">{{source:'整页来源',panel:'分格与对白',arrangement:'镜头编排',shot:'镜头节奏',frame:'关键画面',video:'视频结果',script:'来源脚本',page:'页面',book:'漫画书籍',group:'阶段概览'}[node.data.kind]}</h3>
            <p className="node-detail-copy">{node.data.text}</p>
            {node.data.image && (
              <Media path={node.data.image} revision={node.data.mediaRevision} alt={node.data.title} />
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
            {node.data.kind==='frame'&&node.data.image&&node.data.run&&<CandidateHistory key={node.id} run={node.data.run} keyframe={node.data.title} busy={props.busy} onAdopt={props.onRefresh}/>}
            {node.data.detail != null && (
              <details className="details">
                <summary>技术详情</summary>
                <pre>{JSON.stringify(node.data.detail, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
        </TabsContent>
        </Tabs>
      </aside>
      </ResizablePanel></>}
      </ResizablePanelGroup>
    </div>
  );
}
