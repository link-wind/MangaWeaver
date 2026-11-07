import {
Activity,
ArrowRight,
ChevronDown,
Clapperboard,
Command,
FileJson,
Film,
FolderOpen,
ImagePlus,
Layers,
PanelLeftClose,
PanelLeftOpen,
PanelTop,
Plus,
RefreshCw,
Square
} from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { usePanelRef } from 'react-resizable-panels';
import { toast } from 'sonner';
import { Dialog } from './components/controls';
import { Disclosure } from './components/Disclosure';
import { Media } from './components/Media';
import { Alert,AlertDescription } from './components/ui/alert';
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from './components/ui/alert-dialog';
import { Button } from "./components/ui/button";
import { ResizableHandle,ResizablePanel,ResizablePanelGroup } from './components/ui/resizable';
import { Tabs,TabsContent,TabsList,TabsTrigger } from './components/ui/tabs';
import { AppToaster } from './components/ui/toaster';
import { CanvasWorkspace } from "./features/CanvasWorkspace";
import { EnvironmentSettings } from "./features/EnvironmentSettings";
import { Generation } from "./features/Generation";
import { MaterialLibrary,MaterialPicker } from "./features/MaterialLibrary";
import { Planning } from "./features/Planning";
import { ProjectSidebar } from "./features/ProjectSidebar";
import { Results } from "./features/Results";
import { SourceEditor,SourceView } from "./features/SourceEditor";
import { WorkspaceHome } from "./features/WorkspaceHome";
import { emptyView } from "./lib/bookCanvas";
import { canvasState,graph,stageNames,wholePage,type Stage } from "./lib/canvas";
import { CanvasSaveQueue } from "./lib/canvasSave";
import { conversationEvents } from './lib/conversation';
import { currentPlan,filename,sourceData,taskEntries } from "./lib/data";
import { usePanelWidth } from './lib/panelWidth';
import { taskOwnsError } from "./lib/presentation";
import { runStageNames,type RunStage } from "./lib/runStages";
import type {
AgentContext,AgentSession,
Book,
CanvasCommand,
CanvasReference,
CanvasState,CanvasView,
EngineEvent,
MangaMaterial,
MessageOptions,
PanelEdit,
Project,
RunData,
RunPreview,
WorkflowTask,
} from "./lib/types";

const tabs = [
  { id: "source", label: "分格与对白", icon: PanelTop },
  { id: "planning", label: "规划", icon: Layers },
  { id: "generation", label: "视频任务", icon: Activity },
  { id: "results", label: "视频结果", icon: Film },
];
const phase: Record<string, string> = {
  preprocess: "预处理",
  plan: "规划",
  generate: "生成",
  resume: "恢复",
  characters: "角色准备",
  script: "来源脚本",
  arrangement: "镜头编排",
  direction: "动作演出",
  storyboard: "关键画面",
  tasks: "构建任务",
  dialogue: "对白准备",
  "video.query": "查询视频",
  "video.review": "视频审查",
  "video.submitted": "已提交视频",
  assembly: "合成导出",
};
export default function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [pendingDemo,setPendingDemo]=useState('');
  const [sidebarWidth, setSidebarWidth] = usePanelWidth("mangaweaver.sidebar-width", 192, 176, 420);
  const [chatWidth, setChatWidth] = usePanelWidth("mangaweaver.chat-width", 382, 280, 640);
  const [view, setView] = useState<"home" | "materials" | "library" | "workbench" | "canvas">(
      "home",
    ),
    [inputPage, setInputPage] = useState(""),
    [inputPrompt, setInputPrompt] = useState(""),
    [canvas, setCanvas] = useState<CanvasState>(canvasState(null)),
    [collapsed, setCollapsed] = useState(false),
    [tab, setTab] = useState("planning"),
    [project, setProject] = useState<Project | null>(null),
    [runPath, setRunPathState] = useState(""),
    [run, setRun] = useState<RunData | null>(null),
    [page, setPage] = useState(""),
    [manifest, setManifest] = useState(""),
    [imported, setImported] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [environment, setEnvironment] = useState<any>(null),
    [events, setEvents] = useState<EngineEvent[]>([]),
    [logs, setLogs] = useState(false),
    [localRuns, setLocalRuns] = useState<string[]>([]),
    [previews, setPreviews] = useState<RunPreview[]>([]),
    [scanning, setScanning] = useState(false),
    [configOpen, setConfigOpen] = useState(false);
  useEffect(()=>{contentRef.current?.scrollTo({top:0,left:0});},[view,tab,runPath]);
  const [inputMaterial,setInputMaterial]=useState<MangaMaterial|null>(null);
  const [selectingMaterial,setSelectingMaterial]=useState(false);
  const [liveCommand, setLiveCommand] = useState<CanvasCommand | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [agentContext, setAgentContext] = useState<AgentContext>({selected:[], nodes:[]});
  const [permission, setPermission] = useState("none");
  const [bookView,setBookView]=useState<CanvasView>(emptyView);
  const [otherRuns,setOtherRuns]=useState<RunData[]>([]);
  const viewWrites=useRef(Promise.resolve());
  const canvasValues=useRef(new Map<string,CanvasState>());
  const activeBook=useRef(agentSession?.book?.id);activeBook.current=agentSession?.book?.id;
  const saves=useRef(new CanvasSaveQueue((path,state,revision)=>window.manga.run('save_canvas',{run_dir:path,canvas:state,expected_revision:revision})));
  const editorFlush=useRef<null|(()=>Promise<void>)>(null);
  const [editorEpoch,setEditorEpoch]=useState(0);
  const registerFlush=(flush:()=>Promise<void>)=>{editorFlush.current=flush;return()=>{if(editorFlush.current===flush)editorFlush.current=null;};};
  async function flushEdits(){await editorFlush.current?.();await viewWrites.current;await saves.current.flush();}
  async function navigate(next:typeof view){await attempt(async()=>{await flushEdits();setConfigOpen(false);setView(next);});}
  const [reloadConfirm,setReloadConfirm]=useState(false);
  const sidebarPanel=usePanelRef();
  async function reloadEdits(){setReloadConfirm(true);}
  async function confirmReload(){
    setReloadConfirm(false);
    await attempt(async()=>{
      if(imported?.source){const data=await window.manga.run('read_source',{source:manifest});setImported(data);}
      if(runPath){const data:RunData=await window.manga.run('read_run',{run_dir:runPath});saves.current.read(data,true);canvasValues.current.set(runPath,canvasState(data));viewWrites.current=Promise.resolve();setRun(data);setCanvas(canvasState(data));}
      setEditorEpoch(n=>n+1);
    });
  }
  const flushOnClose=useRef(flushEdits);flushOnClose.current=flushEdits;
  useEffect(()=>window.manga.onCloseRequested(async()=>{
    try{await flushOnClose.current();return true;}catch(e){setError((e as Error).message);return false;}
  }),[]);
  const stopped=useRef(false);
  const [stopping,setStopping]=useState(false);
  const [referencePreview,setReferencePreview]=useState<{reference:CanvasReference;path:string}|null>(null);
  const sessionRevision=useRef(0);
  useEffect(()=>{setOtherRuns([]);},[agentSession?.book?.id]);
  useEffect(()=>{if(run)setOtherRuns(previous=>[...previous.filter(r=>r.directory!==run.directory),run]);},[run]);
  const browseSequence=useRef(0);
  const sessionRef=useRef(agentSession);sessionRef.current=agentSession;
  const bookViewRef=useRef(bookView);bookViewRef.current=bookView;
  const [execution,setExecution]=useState<{run:string;index:number;total:number}|null>(null);
  async function persistView(value:CanvasView) {
    try {
    const book=agentSession?.book;
    if(book) {
      viewWrites.current=viewWrites.current.catch(()=>{}).then(async()=>{await window.manga.run('save_book_view',{book_id:book.id,view:value});});
      await viewWrites.current;
      if(activeBook.current===book.id){bookViewRef.current=value;setBookView(value);}
    }else if(runPath){
      const path=runPath;
      viewWrites.current=viewWrites.current.catch(()=>{}).then(async()=>{
        const state={...(canvasValues.current.get(path)||canvas),view:value};
        canvasValues.current.set(path,state);
        await saves.current.save(path,state);
      });
      await viewWrites.current;
      if(active.current.runPath===path)setCanvas(previous=>({...previous,view:value}));
    }
    }catch(e){setError((e as Error).message);throw e;}
  }
  async function openPages(pages:number[]) { if(pages.length)await selectBookPage(pages[0]); }
  async function loadBookPages(pages:number[]) {
    const book=sessionRef.current?.book;
    if(!book||!pages.length)return;
    const loaded:Book=await window.manga.run('load_book_pages',{book_id:book.id,pages});
    setAgentSession(previous=>previous?.book?.id===loaded.id?{...previous,book:loaded}:previous);
  }
  async function activateRun(path:string) {
    if(path===active.current.runPath)return true;
    const session=sessionRef.current,book=session?.book;
    const page=book?.pages.find(p=>session?.page_runs?.[`${book.id}:${p.id}`]===path);
    if(page)await selectBookPage(page.number);
    return active.current.runPath===path;
  }
  async function stopRun() {
    if(stopping)return;
    stopped.current=true;setStopping(true);setLiveCommand(null);
    try{await window.manga.stop();if(project){const data=await window.manga.run('interrupt_workflow');setAgentSession(previous=>previous?{...previous,...data}:previous);}setNotice('已停止本地执行，进度已保留，可继续运行。');}
    finally{setStopping(false);}
  }
  const active = useRef({runPath, project: project?.path});
  active.current.project = project?.path;
  function setRunPath(path: string) { active.current.runPath = path; setRunPathState(path); }
  const source = sourceData(run),
    last = events[events.length - 1];
  const resolveRef = (path: string) =>
    path.startsWith("/") ? path : `${project?.path}/${path}`;
  async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      setError("");
      return await action();
    } catch (e) {
      const message=(e as Error).message;
      if(stopped.current&&message.includes('本地执行已停止'))setNotice('已停止本地执行，进度已保留。');
      else setError(message);
    }
  }
  async function refresh(path = runPath) {
    if (path) {
      const data = await window.manga.run("read_run", { run_dir: path });
      saves.current.read(data);
      if(!canvasValues.current.has(path))canvasValues.current.set(path,canvasState(data));
      if (active.current.runPath === path) {
        setRun(data);
        setCanvas(canvasState(data));
      }
    }
  }
  async function openRun(path: string) {
    if(busy)return;
    setBusy(true);
    await attempt(async()=>{
      await flushEdits();
      const opened=await window.manga.openRunProject(path);
      const saved:AgentSession=await window.manga.run('read_session');
      setProject(opened);sessionRef.current=null;sessionRevision.current=0;setEvents([]);setLiveCommand(null);
      setLocalRuns(opened.runs.map(ref=>ref==='.'?opened.path:ref.startsWith('/')?ref:`${opened.path}/${ref}`));
      setPage('');setImported(null);setTab('planning');
      const page=saved.book?.pages.find(p=>saved.page_runs?.[`${saved.book!.id}:${p.id}`]===path);
      await applyAgentResult({...saved,active_run:path,active_page_id:page?.id||''});
    });
    setBusy(false);
  }
  useEffect(() => {
    void attempt(async () =>
      setEnvironment(await window.manga.run("environment")),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let streamTimer:ReturnType<typeof setTimeout>|undefined;
    let streamEvents:any[]=[];
    function flushStream(){
      const batch=streamEvents;streamEvents=[];streamTimer=undefined;
      if(batch.length)setAgentSession(previous=>conversationEvents(previous||{revision:0,messages:[],active_run:'',active_page_id:''},batch));
    }
    let reading = false, queued = false, disposed = false;
    async function refreshLive() {
      if (reading) { queued = true; return; }
      const path = active.current.runPath;
      if (!path) return;
      reading = true;
      try {
        const data = await window.manga.run("read_run", {run_dir:path});
        saves.current.read(data);
        if (!disposed && active.current.runPath === path) {
          setRun(data);
          // 保留正在输入的草稿与拖动位置；实时刷新只更新真实产物。
          setCanvas(previous => ({...canvasState(data), draft:previous.draft, draft_node:previous.draft_node, draft_references:previous.draft_references, draft_delivery:previous.draft_delivery, positions:previous.positions}));
        }
      } catch { /* 原运行的失败事件提供诊断，下一次产物事件仍可刷新。 */ }
      finally { reading = false; if (queued && !disposed) { queued = false; void refreshLive(); } }
    }
    const unsubscribe = window.manga.onEvent(e => {
      setEvents(previous => [...previous.slice(-499), e]);
      if(e.type==='stage'&&e.stage==='conversation'){
        streamEvents.push(e.data.event);
        if(!streamTimer)streamTimer=setTimeout(flushStream,50);
      }
      if(['completed','failed'].includes(e.type)){clearTimeout(streamTimer);flushStream();}
      if(e.type==='stage'&&e.stage==='workflow.task'){
        setAgentSession(previous=>previous?{...previous,active_task_id:!e.data.task.parent_id?e.data.task.id:previous.active_task_id,workflow:{version:1,revision:e.data.workflow_revision,
          tasks:[...(previous.workflow?.tasks||[]).filter(t=>t.id!==e.data.task.id),e.data.task].sort((a,b)=>a.created_at.localeCompare(b.created_at))}}:previous);
      }
      if(e.type==='stage'&&e.stage==='book.ready'){
        void window.manga.run('read_session').then(async(data:AgentSession)=>{
          if(data.book?.id===e.data.book_id&&data.revision>sessionRevision.current)await applyAgentResult(data);
        }).catch(error=>setError((error as Error).message));
      }
      const projectPath = active.current.project;
      if(e.run_dir&&projectPath&&e.run_dir.startsWith(projectPath+'/runs/')&&e.run_dir!==active.current.runPath){
        setLocalRuns(paths=>[...new Set([...paths,e.run_dir!])]);
      }
      if (e.run_dir === active.current.runPath && ["stage","artifact","completed","failed"].includes(e.type)) {
        clearTimeout(timer);
        timer = setTimeout(() => void refreshLive(), 200);
      }
    });
    return () => { disposed = true; clearTimeout(timer); clearTimeout(streamTimer); unsubscribe(); };
  }, []);
  async function selectProject(action: "open" | "create") {
    await attempt(async () => {
      await flushEdits();
      const p = await window.manga.project(action);
      if (p) {
        sessionRevision.current=0;
        setEvents([]);
        setProject(p);sessionRef.current=null;
        const saved = await window.manga.run("read_session");
        setAgentSession(saved);
        setLiveCommand(null);
        setLocalRuns(
          p.runs.map((r) => (r.startsWith("/") ? r : `${p.path}/${r}`)),
        );
        setPage("");
        setImported(null);
        setRun(null);
        setRunPath("");
        setNotice(`已打开项目：${p.name}`);
        setView(action === "open" ? "library" : "home");
        if (saved.book || saved.active_run) await applyAgentResult(saved);
      }
    });
  }
  async function scanRuns(chooseDirectory = false) {
    setScanning(true);
    try {
      await attempt(async () => {
        const entries = await window.manga.scanRuns(chooseDirectory);
        setPreviews(previous => chooseDirectory
          ? [...new Map([...previous, ...entries].map(item => [item.directory, item])).values()].sort((a, b) => b.updated - a.updated)
          : entries);
        setLocalRuns(previous => chooseDirectory
          ? [...new Set([...entries.map(item => item.directory), ...previous])]
          : entries.map(item => item.directory));
      });
    } finally { setScanning(false); }
  }
  useEffect(() => {
    if (view === "home" || view === "library") void scanRuns();
  }, [view, project?.path]);
  async function attach() {
    await attempt(async () => {
      const path = await window.manga.attach();
      if (path) {
        setLocalRuns((p) => [...new Set([...p, path])]);
        await openRun(path);
      }
    });
  }
  async function newRun() {
    return attempt(async () => {
      await flushEdits();
      const path = await window.manga.newRun();
      setLocalRuns((p) => [...p, path]);
      setRunPath(path);
      setRun(null);
      setView("workbench");
      setNotice("新运行已创建，可从当前来源开始预处理。");
      return path;
    });
  }
  async function execute(
    command: string,
    params: Record<string, unknown> = {},
  ) {
    if (busy) return;
    stopped.current=false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await flushEdits();
      const path = runPath || (await newRun());
      if(stopped.current)return;
      if (!path) throw new Error("请先创建项目与运行");
      if(project&&!params.dry_run&&['plan','generate','resume'].includes(command)){
        let data=await window.manga.run('agent_run_stage',{run_dir:path,
          stage:command==='plan'?params.from_stage||params.until_stage||'storyboard':'video',
          operation:command==='resume'?'resume':params.from_stage?'revise':command==='plan'&&!params.until_stage?'until':'stage',
          feedback:params.feedback,location:params.location});
        data=await continueAgent(data);
        await applyAgentResult(data);
        if(data.pending){setNotice('任务需要处理，请查看右侧任务卡片。');return;}
      }else {
        const result=await window.manga.run(command, { run_dir: path, ...params });
        if(command==='simulate'){
          setNotice(result.message||'本地演示结束，未调用模型。');
          await refresh(path);
          return;
        }
      }
      setNotice(
        command === "simulate"
          ? "模拟任务已完成，全程未调用 API。"
          : command === "resume"
          ? "恢复操作结束；未重新提交生成任务。"
          : params.dry_run
            ? "任务预览已完成，未调用模型。"
            : "阶段执行完成。",
      );
      await refresh(path);
      if (command === "preprocess") {
        setPage("");
        setImported(null);
        setView("canvas");
      }
    } catch (e) {
      if(stopped.current)setNotice('已停止本地执行，进度已保留。');else setError((e as Error).message);
      if (runPath) await refresh().catch(()=>{});
    } finally {
      setBusy(false);
    }
  }
  async function chooseSource(path: string) {
    await flushEdits();
    const owner=active.current.project,directory=active.current.runPath;
    const data = await window.manga.run("read_source", { source: path });
    if(active.current.project!==owner||active.current.runPath!==directory)return;
    setManifest(path);setImported(data);
    if (data.editor) setPage(data.editor.page);
    else setPage("");
    setTab("source");
    setView("workbench");
    setNotice("已选择来源清单，可用于新运行。");
  }
  async function saveSource(panels: PanelEdit[]) {
    setBusy(true);
    const owner=project?.path;
    try{
      const base=imported?.source?manifest:run?.records.some(r=>r.file==='source/manifest.json')?`${runPath}/source/manifest.json`:undefined;
      const revision=imported?.revision??run?.records.find(r=>r.file==='source/manifest.json')?.revision;
      if(base&&!revision)throw new Error('请重新读取来源快照后再编辑');
      const result = await window.manga.run("save_source", { page, panels,base_source:base,expected_revision:revision });
      if(active.current.project!==owner)return;
      setManifest(result.manifest);setImported(null);
      setProject(p=>p?{...p,sources:[...p.sources,result.manifest]}:p);
      if(runPath)await acceptSource(result.manifest);
      else setNotice(`已保存 ${result.panels} 格新来源版本。`);
    }catch(e){setError((e as Error).message);throw e;}
    finally{setBusy(false);}
  }
  async function reviseSource(panels:any[]){
    setBusy(true);
    const owner=project?.path,path=runPath;
    try{
      const origin=imported?.source?manifest:`${path}/source/manifest.json`;
      const revision=imported?.revision??run?.records.find(r=>r.file==='source/manifest.json')?.revision;
      if(!revision)throw new Error('请重新读取来源快照后再编辑');
      const result=await window.manga.run('save_source',{source:origin,expected_revision:revision,panels});
      if(active.current.project===owner&&active.current.runPath===path)await acceptSource(result.manifest);
    }catch(e){setError((e as Error).message);throw e;}
    finally{setBusy(false);}
  }
  async function beginImport() {
    await attempt(async () => {
      const path = await window.manga.choosePage();
      if (path) {setInputPage(path);setInputMaterial(null);}
    });
  }
  async function ensureProject() {
    if (project) return project;
    const selected = await window.manga.project("create");
    if (!selected) throw new Error("尚未选择项目保存位置");
    setProject(selected);
    setLocalRuns([]);
    return selected;
  }
  async function createCanvas(
    sourceManifest?: string,
    originalPage = inputPage,
    brief = inputPrompt,
  ) {
    await ensureProject();
    const directory = await window.manga.newRun();
    const previousPage=sourceManifest?run?.book_page:undefined;
    const data = await window.manga.run("start_canvas", {
      run_dir: directory,
      from_run: previousPage?run?.directory:undefined,
      page: originalPage,
      manifest: sourceManifest,
      prompt: brief,
    });
    setLocalRuns((paths) => [...new Set([...paths, directory])]);
    setRunPath(directory);
    setCanvas(data);
    setView("canvas");
    setPage(data.page);
    await refresh(directory);
    if(previousPage&&agentSession?.book?.id===previousPage.book_id){
      await applyAgentResult(await window.manga.run('agent_select_page',{page_number:previousPage.number}),false,false);
    }
    return directory;
  }
  function permissions() {
    return permission === "video" ? ["planning","images","video"] : permission === "images" ? ["planning","images"] : permission === "planning" ? ["planning"] : [];
  }
  async function applyAgentResult(data: AgentSession, live = false, flush = true) {
    const sameBook=!!data.book&&data.book.id===sessionRef.current?.book?.id;
    if(flush&&!sameBook&&data.active_run!==active.current.runPath)await flushEdits();
    sessionRevision.current=data.revision;
    setAgentSession(data);sessionRef.current=data;
    setLiveCommand(live && data.pending?.kind === "canvas" ? data.pending as CanvasCommand : null);
    if(sameBook){
      const pageId=bookViewRef.current.workspace?.page_id;
      const viewedRun=pageId&&data.page_runs?.[`${data.book!.id}:${pageId}`];
      if(viewedRun&&viewedRun!==active.current.runPath)setRunPath(viewedRun);
      if(active.current.runPath)await refresh(active.current.runPath);
      // 用户明确的 Agent 画布指令才切页，专业任务事件只更新后台状态。
      if(live&&data.pending?.kind==='canvas')await activateRun((data.pending as CanvasCommand).run);
      return;
    }
    const nextView={...emptyView(),...data.book_view};
    if(data.book&&!nextView.workspace)nextView.workspace={mode:'overview'};
    setBookView(nextView);bookViewRef.current=nextView;
    let path=data.active_run;
    if(data.book){
      const pageId=nextView.workspace?.page_id;
      path=pageId?data.page_runs?.[`${data.book.id}:${pageId}`]||'':'';
      if(!path){
        const page=data.book.pages.find(p=>p.id===pageId);
        setRunPath('');setRun(null);setCanvas(canvasState(null,page?.image||''));setView('canvas');return;
      }
    }
    if(path){setRunPath(path);setLocalRuns(paths=>[...new Set([...paths,path])]);await refresh(path);}
    else{setRunPath('');setRun(null);setCanvas(canvasState(null));}
    setView('canvas');
  }
  async function continueAgent(data:AgentSession):Promise<AgentSession>{
    while(['batch','follow_up'].includes(data.pending?.kind||'')&&!stopped.current){
      await applyAgentResult(data);
      const pending=data.pending as {kind:string;task_id?:string;revision?:number;request_id?:string};
      data=await window.manga.run(pending.kind==='batch'?'agent_next_batch':'agent_follow_up',{
        task_id:pending.task_id,revision:pending.revision,message_id:pending.request_id,context:agentContext});
    }
    return data;
  }
  async function conversationAction(command:string,params:Record<string,unknown>={}) {
    if(busy)return;
    setBusy(true);
    let success=false;
    await attempt(async()=>{
      await flushEdits();
      const data=await window.manga.run(command,params);
      await applyAgentResult(data);
      if(command==='agent_fork')setPermission('none');
      success=true;
    });
    setBusy(false);
    if(success&&command==='agent_fork'&&params.submit)await messageAgent(String(params.text||''),'',false,undefined,true);
  }
  async function messageAgent(text: string, attachment = "", fromHome = false, options?:MessageOptions, readOnly=false) {
    if(['停止','停止执行','停止本地执行'].includes(text.trim().replace(/[。！!]+$/,''))){await attempt(stopRun);return;}
    if (busy) {
      try{
        const target=options?.run??runPath;
        if(options?.page_id&&!target)throw new Error('该页尚未开始制作，请等待当前任务结束后发送；草稿会保留。');
        const activeTask=agentSession?.workflow?.tasks.find(task=>task.id===agentSession.active_task_id);
        const data=await window.manga.run('submit_message',{message_id:crypto.randomUUID().replaceAll('-',''),run_dir:target||undefined,text,context:target===agentContext.run?agentContext:{run:target,selected:[],nodes:[]},
          delivery:options?.delivery||'steer',references:options?.references||[],task_id:activeTask?.run===target?activeTask.id:undefined,permissions:permissions()});
        setAgentSession(previous=>previous?{...previous,pending_requests:data.pending_requests}:previous);
      }catch(e){setError((e as Error).message);throw e;}
      return;
    }
    stopped.current=false;
    setBusy(true);
    let completed = false;
    let failure:Error|undefined;
    try{await (async () => {
      await ensureProject();
      if(stopped.current)return;
      if(fromHome){
        setView('canvas');setEvents([]);setNotice('');
        if(attachment){sessionRevision.current=0;setAgentSession(null);setRunPath('');setRun(null);setCanvas(canvasState(null));setLiveCommand(null);}
      }
      const pending=agentSession?.pending;
      let target=options?.run??(!attachment&&!fromHome?runPath:'');
      if(options?.page_id&&!target&&agentSession?.book){
        const page=agentSession.book.pages.find(p=>p.id===options.page_id);
        if(!page)throw new Error('草稿引用的页面已不存在');
        const prepared:AgentSession=await window.manga.run('agent_select_page',{page_number:page.number});
        target=prepared.active_run;await applyAgentResult(prepared);
      }
      const pendingBelongs=!agentSession?.book||!!target&&target===agentSession.active_run;
      const questionId=!readOnly&&pendingBelongs&&pending&&'question_id' in pending?pending.question_id:undefined;
      let data = await window.manga.run(questionId&&!attachment?"agent_answer":"agent_message", {text,question_id:questionId, attachment:attachment || undefined,
        run_dir: !attachment && !fromHome ? target || undefined : undefined,
        project_scope:!!agentSession?.book&&!target&&!options?.page_id&&!attachment,
        context:target===agentContext.run?agentContext:{run:target,selected:[],nodes:[]}, permissions:readOnly?[]:permissions(),references:options?.references||[]});
      data=await continueAgent(data);
      await applyAgentResult(data, !stopped.current);
      completed = true;
    })();}catch(e){failure=e as Error;setError(failure.message);}
    // 即便模型请求失败，本地导入与已有工具结果仍可查看。
    try {
      if (!completed) {
        const saved = await window.manga.run("read_session");
        if (saved.book || saved.active_run) await applyAgentResult(saved);
      }
    } catch { /* 原请求错误保持在界面 */ }
    setBusy(false);
    if(failure)throw failure;
  }
  async function canvasResult(command: CanvasCommand, result: {status:string; summary:string}) {
    setLiveCommand(null);
    if(command.call_id.startsWith('local:')){if(result.status!=='completed')setError(result.summary);return;}
    if(stopped.current)return;
    setBusy(true);
    await attempt(async () => {
      let data = await window.manga.run("agent_continue", {call_id:command.call_id, revision:command.revision,
        run_dir:command.run, result, context:agentContext});
      data=await continueAgent(data);
      await applyAgentResult(data, !stopped.current);
    });
    setBusy(false);
  }
  async function taskAction(task:WorkflowTask,action:WorkflowTask['actions'][number]) {
    if(busy)return;
    if(action.kind==='stage'){await runProject(action.stage as RunStage,[task.run]);return;}
    stopped.current=false;setBusy(true);
    await attempt(async()=>{
      let data=await window.manga.run('agent_resume_task',{task_id:task.id,task_revision:task.revision,
        grant_scope:action.kind==='grant'?action.scope:undefined,resume_mode:action.kind==='download'?'download':undefined,context:agentContext});
      data=await continueAgent(data);
      await applyAgentResult(data,!stopped.current);
    });
    setBusy(false);
  }
  async function withdrawRevision(id:string){
    await attempt(async()=>{const data=await window.manga.run('withdraw_revision',{request_id_to_withdraw:id});
      setAgentSession(previous=>previous?{...previous,pending_requests:data.pending_requests}:previous);});
  }
  async function processRequest(id:string){
    if(busy)return;
    stopped.current=false;setBusy(true);
    await attempt(async()=>{
      let data=await window.manga.run('agent_follow_up',{message_id:id,task_id:agentSession?.active_task_id});
      data=await continueAgent(data);
      await applyAgentResult(data,!stopped.current);
    });
    setBusy(false);
  }
  async function openReference(reference:CanvasReference){
    await attempt(async()=>{
      const checked=await window.manga.run('capture_references',{run_dir:reference.run,node_ids:[reference.node_id],purpose:reference.purpose});
      const actual=checked.references[0] as CanvasReference;
      if(actual.signature!==reference.signature||actual.path!==reference.path)throw new Error('该引用内容已变化，请查看原版本或重新选择');
      if(actual.kind==='image'||actual.kind==='video'){
        setReferencePreview({reference:actual,path:resolveRef(actual.path)});return;
      }
      await flushEdits();
      const current:RunData=await window.manga.run('read_run',{run_dir:reference.run});
      const state=canvasState(current),node=graph(current,state).nodes.find(n=>n.id===reference.node_id);
      if(!node)throw new Error('原产物仍保留，但该版本没有可定位的画布节点');

      saves.current.read(current);await revealRunPage(reference.run);setRunPath(reference.run);setRun(current);setCanvas(state);setView('canvas');
      setLiveCommand({kind:'canvas',call_id:'local:'+crypto.randomUUID(),revision:0,run:reference.run,
        operation:'open_details',node_ids:[node.id],dx:0,dy:0});
    });
  }
  async function locateTask(task:WorkflowTask,target?:string){
    await attempt(async()=>{
      await flushEdits();
      const current:RunData=await window.manga.run('read_run',{run_dir:task.run});
      const state=canvasState(current);
      const nodes=graph(current,state).nodes;
      const wanted=target||task.target;
      const exact=nodes.find(n=>task.stage==='video'&&n.data.kind==='video'&&(n.id===wanted||n.data.location===wanted))||
        nodes.find(n=>n.id===wanted||n.data.location===wanted||n.id===`frame:${wanted}`);
      const node=exact||(!target||target==='all'?(nodes.find(n=>task.stage==='video'?n.id==='final':n.data.stage===task.stage)||nodes[0]):undefined);
      if(!node)throw new Error('该版本尚无对应画布产物');
      saves.current.read(current);await revealRunPage(task.run);setRunPath(task.run);setRun(current);setCanvas(state);setView('canvas');
      setLiveCommand({kind:'canvas',call_id:'local:'+crypto.randomUUID(),revision:0,run:task.run,
        operation:'open_details',node_ids:[node.id],dx:0,dy:0});
    });
  }
  async function revealRunPage(path:string){
    const session=sessionRef.current,book=session?.book;
    const page=book?.pages.find(page=>session?.page_runs?.[`${book.id}:${page.id}`]===path);
    if(page){const value={...bookViewRef.current,workspace:{mode:'page' as const,page_id:page.id}};bookViewRef.current=value;await persistView(value);}
  }
  async function selectBookPage(number: number) {
    const sequence=++browseSequence.current;
    await attempt(async()=>{
      await flushEdits();
      const session=sessionRef.current,book=session?.book;
      if(!book||number<1||number>book.page_count)return;
      let selected=book.pages[number-1];
      if(selected.loaded===false){await loadBookPages([number]);}
      if(sequence!==browseSequence.current||activeBook.current!==book.id)return;
      const path=session.page_runs?.[`${book.id}:${selected.id}`]||'';
      const current:RunData|null=path?await window.manga.run('read_run',{run_dir:path}):null;
      if(sequence!==browseSequence.current)return;
      if(current){saves.current.read(current);canvasValues.current.set(path,canvasState(current));}
      setRunPath(path);setRun(current);setCanvas(canvasValues.current.get(path)||canvasState(current,selected.image));
      const next={...bookViewRef.current,workspace:{mode:'page' as const,page_id:selected.id}};
      setBookView(next);bookViewRef.current=next;await persistView(next);setView('canvas');
    });
  }
  async function produceRuns(paths:string[],stage:RunStage,operation:'stage'|'until'){
    for(const [index,path] of paths.entries()){
      if(stopped.current)break;
      setExecution({run:path,index:index+1,total:paths.length});
      let data:AgentSession=await window.manga.run('agent_run_stage',{run_dir:path,stage,operation});
      data=await continueAgent(data);await applyAgentResult(data);
      if(stopped.current)break;
      if(data.pending){setNotice(`${runStageNames[stage]}需要处理，后续页面未启动。`);break;}
    }
  }
  async function runBookPages(stage:RunStage,pages:number[]){
    if(busy||!project||!pages.length)return;
    stopped.current=false;setBusy(true);setError('');setNotice('');
    try{
      await flushEdits();
      const data:AgentSession=await window.manga.run('agent_open_pages',{pages});
      await applyAgentResult(data);
      const paths=pages.map(number=>data.page_runs![`${data.book!.id}:${data.book!.pages[number-1].id}`]);
      await produceRuns(paths,stage,'until');
    }catch(e){if(stopped.current)setNotice('已停止本地执行，后续页面未启动。');else setError((e as Error).message);}
    finally{setBusy(false);setExecution(null);}
  }
  async function runProject(stage:RunStage,targets?:string[],operation:'stage'|'until'='stage') {
    if(busy||run?.experimental)return;
    if(run?.simulation){await execute('simulate');return;}
    if(!project){setNotice('请先打开项目，再运行制作。');return;}
    const pageId=bookViewRef.current.workspace?.page_id;
    if(!targets?.length&&!runPath&&agentSession?.book&&pageId){
      const page=agentSession.book.pages.find(p=>p.id===pageId);
      if(page)await runBookPages(stage,[page.number]);return;
    }
    const paths=targets?.length?[...new Set(targets)]:runPath?[runPath]:[];
    if(!paths.length)return;
    if(paths.some(path=>!(path.startsWith(project.path+'/runs/')||(path===project.path&&project.runs.includes('.'))))){setNotice('当前记录不属于已打开项目，请打开所属项目后制作。');return;}
    stopped.current=false;setBusy(true);setError('');setNotice('');
    try{await flushEdits();await produceRuns(paths,stage,operation);}
    catch(e){
      if(stopped.current){setNotice('已停止本地执行，进度已保留。');await applyAgentResult(await window.manga.run('read_session'));}
      else setError((e as Error).message);
      await refresh(active.current.runPath).catch(()=>{});
    }finally{setBusy(false);setExecution(null);}
  }
  async function startCanvas() {
    await messageAgent(inputPrompt || "打开这个漫画，选择需要改编的页面。", inputPage, true);
    setInputPage("");setInputMaterial(null);
  }
  async function createSimulation() {
    if (busy) return;
    setBusy(true);
    await attempt(async () => {
      await flushEdits();
      const path = await window.manga.createSimulation();
      setAgentSession(null);
      setLiveCommand(null);
      setEvents([]);
      setNotice("");
      await openRun(path);
      setPendingDemo(path);
    });
    setBusy(false);
  }
  useEffect(()=>{
    if(!pendingDemo||busy||runPath!==pendingDemo||!run?.simulation)return;
    setPendingDemo('');
    void execute('simulate');
  },[pendingDemo,busy,runPath,run?.simulation]);
  async function persistCanvas(state: CanvasState) {
    const path=runPath;
    canvasValues.current.set(path,state);
    if(active.current.runPath===path)setCanvas(state);
    if(!path)return;
    try{await saves.current.save(path,state);}catch(e){setError((e as Error).message);throw e;}
  }
  async function continueCanvas(stage: Stage) {
    await execute("plan", { until_stage: stage });
  }
  async function reviseCanvas(stage: Stage, text: string, location: string) {
    if (busy || !runPath) return;
    setBusy(true);
    setError("");
    let directory = runPath,
      state = { ...canvas, draft: "" };
    const message = {
      id: crypto.randomUUID(),
      role: "user" as const,
      text,
      stage,
      target: location,
      status: "submitted" as const,
    };
    try {
      await flushEdits();
      if (taskEntries(run).length) {
        await ensureProject();
        directory = await window.manga.newRun();
        state = await window.manga.run("fork_canvas", {
          run_dir: directory,
          from_run: runPath,
        });
        saves.current.read(await window.manga.run('read_run',{run_dir:directory}));
        setRunPath(directory);
        setLocalRuns((paths) => [...paths, directory]);
      }
      state = { ...state, draft: "", messages: [...state.messages, message] };
      setCanvas(state);
      await saves.current.save(directory,state);
      await window.manga.run("plan", {
        run_dir: directory,
        from_stage: currentPlan(run)?.script ? stage : undefined,
        until_stage: stage,
        location,
        feedback: text,
      });
      state = {
        ...state,
        messages: state.messages.map((m) =>
          m.id === message.id ? { ...m, status: "completed" as const } : m,
        ),
      };
      await saves.current.save(directory,state);
      await refresh(directory);
      setNotice(`${stageNames[stage]}修订已保存，请检查后继续。`);
    } catch (e) {
      setError((e as Error).message);
      state = {
        ...state,
        messages: state.messages.map((m) =>
          m.id === message.id ? { ...m, status: "failed" as const } : m,
        ),
      };
      setCanvas(state);
      await saves.current.save(directory,state)
        .catch(() => {});
      await refresh(directory).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function acceptSource(path: string) {
    if (
      runPath &&
      !sourceData(run) &&
      run?.records.some((r) => r.file === "canvas.json")
    ) {
      await window.manga.run("preprocess", {
        run_dir: runPath,
        manifest: path,
      });
      await refresh(runPath);
      setView("canvas");
      setNotice("分格已确认，可开始理解漫画。");
    } else {
      await createCanvas(
        path,
        canvas.page || page,
        canvas.prompt || inputPrompt,
      );
      setNotice("已创建使用新来源的画布；原运行保持不变。");
    }
  }
  const ownedTaskError=view==='canvas'&&taskOwnsError(error,(agentSession?.workflow?.tasks||[]).filter(t=>
    t.run===runPath||t.id===agentSession?.active_task_id||t.parent_id===agentSession?.active_task_id));
  const taskNotice=view==='canvas'&&notice.includes('需要处理，后续页面未启动')&&!!agentSession?.pending;
  const bannerError=ownedTaskError?'':error;
  const transientNotice=/^(已打开项目：|已保存 \d+ 格|已导出选定文件|新运行已创建|阶段执行完成|模拟任务已完成|任务预览已完成|恢复操作结束|已选择来源清单|分格已确认|已创建使用新来源的画布)/.test(notice);
  const bannerMessage=bannerError||(!transientNotice&&!taskNotice?notice:'');
  useEffect(()=>{
    if(transientNotice)toast(notice,{id:'workspace-notice'});
    else toast.dismiss('workspace-notice');
  },[notice,transientNotice]);
  return (
    <div className={`app ${["home","library","materials"].includes(view)?"global-mode":""} ${collapsed ? "sidebar-collapsed" : ""} ${view === "canvas" ? "canvas-mode" : ""}`}>
      <AppToaster/>
      <header className="titlebar">
        <div className="traffic-space" />
        <Button variant="ghost" size="sm"
          className="sidebar-toggle"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={() => {
            if(collapsed)sidebarPanel.current?.expand();
            else sidebarPanel.current?.collapse();
            setCollapsed(!collapsed);
          }}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </Button>
        <div className="brand">
          <Clapperboard size={19} />
          <b>MangaWeaver</b>
          <span>STUDIO</span>
        </div>

      </header>
      <ResizablePanelGroup orientation="horizontal" className="app-body" id="workspace-layout">
        <ResizablePanel id="directory" panelRef={sidebarPanel} defaultSize={sidebarWidth} collapsible collapsedSize={64} minSize={176} maxSize={420} groupResizeBehavior="preserve-pixel-size" onResize={size=>{if(!collapsed&&size.inPixels>=176)setSidebarWidth(Math.round(size.inPixels));}}>
        <aside className="sidebar h-full w-full">
          <ProjectSidebar project={project} session={agentSession} runPath={runPath} runs={localRuns} previews={previews} view={view} busy={busy}
            onMaterials={()=>void navigate("materials")}
            settingsOpen={configOpen} onSettings={()=>void attempt(async()=>{await flushEdits();setConfigOpen(true);})}
            onHome={()=>void navigate("home")} onLibrary={()=>void navigate("library")}
            onCreate={()=>selectProject('create')} onOpen={()=>selectProject('open')} onAttach={attach} onNewRun={newRun}
            onOpenRun={openRun} onPage={n=>openPages([n])} onBookOverview={()=>void attempt(async()=>{await flushEdits();await persistView({...bookViewRef.current,workspace:{...bookViewRef.current.workspace,mode:'overview'}});setView('canvas');})} bookView={bookView}
            onPageFile={path=>void attempt(async()=>{await flushEdits();setPage(resolveRef(path));setTab("source");setView("workbench");})}
            onSourceFile={path=>void attempt(()=>chooseSource(resolveRef(path)))}/>

        </aside>
        </ResizablePanel>
        {!collapsed&&<ResizableHandle aria-label="调整目录宽度" onDoubleClick={()=>sidebarPanel.current?.resize(192)} onKeyDown={event=>{if(event.key==='Home'){event.preventDefault();sidebarPanel.current?.resize(192);}}}/>}
        <ResizablePanel id="workbench" minSize={view==='canvas'?606:340}>
        <Tabs asChild value={tab} onValueChange={value=>void attempt(async()=>{await flushEdits();setTab(value);})} className="gap-0"><main className="main">
          <div className="toolbar">
            <div className="breadcrumb">
              {view === "workbench" && runPath && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void navigate("canvas")}
                >
                  返回画布
                </Button>
              )}
              {view === "home"
                ? "开始创作"
                : view === "materials"
                  ? "素材库"
                : view === "library"
                  ? "成片库"
                  : view === "canvas"
                    ? "创作画布"
                    : "工作台"}{" "}
              {view === "workbench" && (
                <>
                  <span>/</span>
                  {tabs.find((t) => t.id === tab)?.label}
                </>
              )}
              <span>/</span>
              <strong>
                {view !== "workbench" ? project?.name || "本地创作空间" : run?.book_page?.number?`第 ${run.book_page.number} 页` : runPath?filename(runPath):"尚未选择运行"}
              </strong>
            </div>
            <div className="row">
              <Button
                variant="ghost"
                size="sm"
                disabled={!runPath || busy}
                onClick={() => attempt(() => refresh())}
              >
                <RefreshCw size={14} />
                刷新
              </Button>
              {busy ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={stopping}
                  onClick={() => attempt(stopRun)}
                >
                  <Square size={13} />
                  {stopping?'正在停止…':'停止本地执行'}
                </Button>
              ) : (
                <span className="ready">
                  <span className="connection-dot online" />
                  就绪
                </span>
              )}
            </div>
          </div>
          {view === "workbench" && (
            <TabsList variant="line" className="stage-navigation w-full justify-start" aria-label="创作阶段">
              {tabs.map(t => (
                <TabsTrigger key={t.id} value={t.id}>
                  <t.icon size={17} />
                  <span>{t.label}</span>

                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {bannerMessage && (
            <Alert variant={bannerError?"destructive":"default"}
              className="flex items-center gap-3 rounded-none border-x-0"
              role={bannerError ? "alert" : "status"}
            >
              <AlertDescription className="min-w-0 flex-1">{bannerMessage.replace(/^Error invoking remote method [^:]+: Error: /, "").replace(/^\[EDIT_CONFLICT\] /, "")}</AlertDescription>
              {bannerError&&/EDIT_CONFLICT|保存失败|读取画布快照/.test(error)&&<Button variant="ghost" size="sm" onClick={()=>void reloadEdits()}>重新读取</Button>}
              <Button variant="ghost" size="sm"
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                ×
              </Button>
            </Alert>
          )}
          {selectingMaterial&&<MaterialPicker busy={busy} onBack={()=>setSelectingMaterial(false)} onSelect={async item=>{const path=await window.manga.selectMaterial(item.id);setInputPage(path);setInputMaterial(item);setSelectingMaterial(false);}}/>}
          {configOpen && <EnvironmentSettings environment={environment} busy={busy} onBack={()=>setConfigOpen(false)} onUpdate={setEnvironment}/>}
          <div
            ref={contentRef}
            className={`content ${view === "canvas" ? "canvas-content" : view !== "workbench" ? "workspace-content" : "specialist-content"}`}
          >
            {view === "materials" && <MaterialLibrary busy={busy} selecting={false} onBack={()=>setView('home')} onSelect={async item=>{const path=await window.manga.selectMaterial(item.id);setInputPage(path);setInputMaterial(item);setView('home');}}/>}
            {(view === "home" || view === "library") && (
              <WorkspaceHome
                library={view === "library"}
                onLibrary={()=>setView("library")}
                projectName={project?.name}
                runs={localRuns}
                previews={previews}
                scanning={scanning}
                onScan={scanRuns}
                current={run}
                busy={busy}
                inputPage={inputPage}
                inputLabel={inputMaterial?.name} inputCover={inputMaterial?.cover}
                onMaterials={()=>setSelectingMaterial(true)}
                prompt={inputPrompt}
                onPrompt={setInputPrompt}
                onRemovePage={() => {setInputPage("");setInputMaterial(null);}}
                onStart={startCanvas}
                onSimulate={createSimulation}
                onImport={beginImport}
                onSource={() =>
                  attempt(async () => {
                    const file = await window.manga.importSource();
                    if (file) await chooseSource(file);
                  })
                }
                onAttach={attach}
                onCreate={() => selectProject("create")}
                onOpenProject={() => selectProject("open")}
                onOpenRun={openRun}
                onContinue={()=>setView("canvas")}
              />
            )}
            {view === "canvas" && (
              <CanvasWorkspace
                projectPath={project?.path}
                onRefresh={()=>refresh()}
                onDelete={async(selections,revision)=>{
                  setBusy(true);
                  try{
                    await flushEdits();
                    await window.manga.run('delete_canvas_nodes',{selections,expected_revision:revision});
                  }finally{
                    try{
                    const paths=selections.map(s=>s.run_dir);
                    const data:RunData[]=await Promise.all(paths.map(run_dir=>window.manga.run('read_run',{run_dir})));
                    setOtherRuns(previous=>[...previous.filter(r=>!paths.includes(r.directory)),...data]);
                    for(const item of data){
                      saves.current.read(item,true);
                      canvasValues.current.set(item.directory,canvasState(item));
                      if(item.directory===active.current.runPath){setRun(item);setCanvas(canvasState(item));}
                    }
                    }finally{setBusy(false);}
                  }
                }}
                projectReady={!!project&&(!runPath||(runPath.startsWith(project.path+'/runs/')||(runPath===project.path&&project.runs.includes('.'))))}
                onOpenProject={()=>selectProject("open")}
                key={`${agentSession?.book?.id || runPath}:${editorEpoch}`}
                registerFlush={registerFlush}
                run={run}
                otherRuns={otherRuns}
                view={agentSession?.book ? bookView : canvas.view}
                onView={persistView}
                onOpenPages={openPages}
                onRunPages={runBookPages}
                execution={execution}
                onLoadPages={loadBookPages}
                onActivate={activateRun}
                session={agentSession}
                onMessage={(text,options)=>messageAgent(text,'',false,options)}
                onConversationAction={conversationAction}
                onReference={openReference}
                onTaskAction={taskAction}
                onLocateTask={locateTask}
                onWithdraw={withdrawRevision}
                onProcessRequest={processRequest}
                onContext={setAgentContext}
                onCanvasResult={canvasResult}
                onSelectPage={selectBookPage}
                canvasCommand={liveCommand}
                permission={permission}
                onPermission={setPermission}
                state={canvas}
                chatWidth={chatWidth}
                onChatWidth={setChatWidth}
                onHome={() => void navigate("home")}
                busy={busy}
                events={events}
                stopping={stopping}
                videoBlocker={environment?.video_blocker}
                textModel={environment?.config?.text_model}
                onState={persistCanvas}
                onPreprocess={() => execute("preprocess", { page: wholePage(run, canvas) })}
                onContinue={continueCanvas}
                onFeedback={reviseCanvas}
                onSource={() => void attempt(async()=>{
                  await flushEdits();
                  const source = sourceData(run);
                  const originalPage = canvas.page.includes("/input/page.");
                  setPage(!source || originalPage ? canvas.page : "");
                  setImported(
                    source && originalPage
                      ? {
                          editor: {
                            panels: source.panels
                              .map((p: any) => ({
                                bbox: p.bbox,
                                text: p.text || "",
                                speaker: "",
                              }))
                              .filter(
                                (p: any) =>
                                  Array.isArray(p.bbox) && p.bbox.length === 4,
                              ),
                          },
                        }
                      : null,
                  );
                  setTab("source");
                  setView("workbench");
                })}
                onRun={runProject}
                onStop={() => attempt(stopRun)}
                onGenerate={(dry) => execute("generate", { dry_run: dry })}
                onDetails={tab=>void attempt(async()=>{await flushEdits();setTab(tab);setView("workbench");})}
                onExport={(path) =>
                  attempt(() => window.manga.exportFile(path))
                }
              />
            )}
            {view === "workbench" && (
              <TabsContent value={tab} className="m-0">
                {tab === "source" &&
                  (page ? (
                    <SourceEditor
                      key={`${page}:${editorEpoch}`}
                      registerFlush={registerFlush}
                      page={page}
                      initial={imported?.editor?.panels || []}
                      busy={busy}
                      onSave={saveSource}
                      onAuto={() => execute("preprocess", { page })}
                    />
                  ) : imported?.source || source ? (
                    <SourceView
                      key={`${manifest || runPath}:${editorEpoch}`}
                      source={imported?.source || source}
                      registerFlush={registerFlush}
                      busy={busy}
                      onRevise={project?reviseSource:undefined}
                    />
                  ) : (
                    <div className="empty-work">
                      <h1>
                        导入漫画页
                      </h1>
                      <p>
                        导入页面，检查分格与对白，
                        <br />
                        为后续镜头编排保留可靠的来源。
                      </p>
                      <Button
                        variant="default"
                        disabled={!project || busy}
                        onClick={() =>
                          attempt(async () => {
                            const p = await window.manga.importPage();
                            if (p) {
                              setPage(p);
                              setImported(null);
                              setProject(
                                project
                                  ? { ...project, pages: [...project.pages, p] }
                                  : null,
                              );
                            }
                          })
                        }
                      >
                        <ImagePlus size={16} />
                        导入漫画页
                      </Button>
                      <Button
                        onClick={() =>
                          attempt(async () => {
                            const p = await window.manga.importSource();
                            if (p) await chooseSource(p);
                          })
                        }
                      >
                        <FileJson size={16} />
                        导入来源清单
                      </Button>
                    </div>
                  ))}
                {tab === "planning" &&
                  (run ? (
                    <Planning
                      key={run.directory}
                      run={run}
                      busy={busy}
                      onFeedback={(stage, feedback) =>
                        execute("plan", { from_stage: stage, feedback })
                      }
                    />
                  ) : (
                    <div className="empty-work">
                      <h1>
                        查看镜头规划
                      </h1>
                      <p>
                        检查原作、编排镜头、审阅关键画面。
                        <br />
                        让每一次生成都有清楚的来处。
                      </p>
                      <div className="row">
                        <Button variant="default" onClick={attach}>
                          <FolderOpen size={16} />
                          打开已有运行 <ArrowRight size={16} />
                        </Button>
                        <Button onClick={() => selectProject("create")}>
                          <Plus size={16} />
                          新建项目
                        </Button>
                      </div>
                      <div className="intro-stages">
                        {["素材理解", "镜头编排", "关键画面", "动画生成"].map(
                          (label, i) => (
                            <div key={label}>

                              <span>{label}</span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                {tab === "generation" && <Generation run={run} busy={busy} blocker={environment?.video_blocker} onGenerate={dry=>execute("generate",{dry_run:dry})} onResume={()=>execute("resume")} onPlanning={()=>void attempt(async()=>{await flushEdits();setTab('planning');})} onRedo={(segment,feedback)=>execute("redo",{segment,feedback})} onAssemble={()=>execute("assemble")}/>
                {tab === "results" &&
                  (run ? (
                    <Results
                      key={run.directory}
                      run={run}
                      onExport={(path) =>
                        attempt(async () => {
                          if (await window.manga.exportFile(path))
                            setNotice("已导出选定文件；审查状态不变。");
                        })
                      }
                    />
                  ) : (
                    <div className="empty">
                      <Film size={32} />
                      <h2>你的放映室</h2>
                      <p>打开已有运行，查看视频、声音、字幕和审查结果。</p>
                      <Button onClick={attach}>打开运行</Button>
                    </div>
                  ))}
              </TabsContent>
            )}
          </div>
          <footer className="statusbar">
            <Button variant="ghost" size="sm" onClick={() => setLogs(!logs)}>
              <Command size={12} />
              {busy
                ? phase[last?.stage] || last?.stage || "执行中"
                : "本地引擎"}
              <ChevronDown size={12} />
            </Button>
          </footer>
          {logs && (
            <div className="event-log">
              <div className="row">
                <strong>结构化执行记录</strong>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLogs(false)}
                >
                  收起
                </Button>
              </div>
              {events.length ? (
                events.map((e, i) => (
                  <Disclosure key={i} title={<><span>{phase[e.stage] || e.stage}</span><small>{typeof e.data?.message==='string'?e.data.message:e.type}</small></>}><pre>{JSON.stringify(e.data,null,2)}</pre></Disclosure>
                ))
              ) : (
                <p>没有活动操作。打开结果不会触发模型调用。</p>
              )}
            </div>
          )}
        </main></Tabs>
        </ResizablePanel>
        {referencePreview&&<Dialog title="引用预览" className="reference-preview w-[min(900px,calc(100vw-64px))] sm:max-w-none" onClose={()=>setReferencePreview(null)}>
          <strong>{referencePreview.reference.label} · 原版本</strong>
          <Media path={referencePreview.path} video={referencePreview.reference.kind==='video'} alt={referencePreview.reference.label}/>
        </Dialog>}
        <AlertDialog open={reloadConfirm} onOpenChange={setReloadConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle><AlertDialogDescription>重新读取本地产物后，当前未保存的分格、对白和画布修改会被替换。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={()=>void confirmReload()}>重新读取</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </ResizablePanelGroup>
    </div>
  );
}
