import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  FolderOpen,
  Plus,
  ImagePlus,
  ArrowRight,
  RefreshCw,
  Play,
  Square,
  FileJson,
  ChevronDown,
  Layers,
  Film,
  PanelTop,
  Command,
  Activity,
  PenLine,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { PanelResizeHandle, usePanelWidth } from "./components/PanelResizeHandle";
import { SourceEditor, SourceView } from "./features/SourceEditor";
import { Planning } from "./features/Planning";
import { CanvasWorkspace } from "./features/CanvasWorkspace";
import { graph, canvasState, wholePage, stageNames, type Stage } from "./lib/canvas";
import {emptyView} from "./lib/bookCanvas";
import {runStageNames,type RunStage} from "./lib/runStages";
import {MaterialLibrary} from "./features/MaterialLibrary";
import {EnvironmentSettings} from "./features/EnvironmentSettings";
import {ProjectSidebar} from "./features/ProjectSidebar";
import {taskOwnsError} from "./lib/presentation";
import { WorkspaceHome } from "./features/WorkspaceHome";
import { Results } from "./features/Results";
import { filename, sourceData, taskEntries, currentPlan } from "./lib/data";
import {Media} from './components/Media';
import {conversationEvent} from './lib/conversation';
import type {
  MangaMaterial, EngineEvent, Book, WorkflowTask, CanvasReference, MessageOptions,
  Project,
  RunData,
  RunPreview,
  PanelEdit,
  CanvasState, CanvasView, AgentContext, AgentSession, CanvasCommand,
} from "./lib/types";

const tabs = [
  { id: "source", label: "素材", icon: PanelTop },
  { id: "planning", label: "规划", icon: Layers },
  { id: "generation", label: "生成", icon: Activity },
  { id: "results", label: "结果", icon: Film },
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
  const [sidebarWidth, setSidebarWidth] = usePanelWidth("mangaweaver.sidebar-width", 192, 176, 420);
  const [chatWidth, setChatWidth] = usePanelWidth("mangaweaver.chat-width", 360, 280, 640);
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
  const [inputMaterial,setInputMaterial]=useState<MangaMaterial|null>(null);
  const [selectingMaterial,setSelectingMaterial]=useState(false);
  const [liveCommand, setLiveCommand] = useState<CanvasCommand | null>(null);
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null);
  const [agentContext, setAgentContext] = useState<AgentContext>({selected:[], nodes:[]});
  const [permission, setPermission] = useState("none");
  const [bookView,setBookView]=useState<CanvasView>(emptyView);
  const [otherRuns,setOtherRuns]=useState<RunData[]>([]);
  const viewWrites=useRef(Promise.resolve());
  const stopped=useRef(false);
  const [stopping,setStopping]=useState(false);
  const [referencePreview,setReferencePreview]=useState<{reference:CanvasReference;path:string}|null>(null);
  const sessionRevision=useRef(0);
  useEffect(()=>{setOtherRuns([]);},[agentSession?.book?.id]);
  useEffect(()=>{if(run)setOtherRuns(previous=>[...previous.filter(r=>r.directory!==run.directory),run]);},[run]);
  useEffect(()=>{
    let cancelled=false;
    const book=agentSession?.book;
    if(!book)return;
    const paths=[...new Set(Object.entries(agentSession.page_runs||{}).filter(([key])=>key.startsWith(book.id+':')).map(([,path])=>path))]
      .filter(path=>path!==runPath&&!bookView.collapsed_pages.includes(path));
    void Promise.all(paths.map(path=>window.manga.run('read_run',{run_dir:path}))).then(data=>{
      if(!cancelled)setOtherRuns(previous=>[...previous.filter(r=>!paths.includes(r.directory)),...data]);
    }).catch(e=>{if(!cancelled)setError((e as Error).message);});
    return()=>{cancelled=true;};
  },[agentSession?.page_runs,agentSession?.book?.id,runPath,bookView.collapsed_pages]);
  async function persistView(value:CanvasView) {
    try {
    const book=agentSession?.book;
    if(book) {
      viewWrites.current=viewWrites.current.catch(()=>{}).then(async()=>{await window.manga.run('save_book_view',{book_id:book.id,view:value});});
      await viewWrites.current;
      setBookView(value);
    }else if(runPath){
      const state={...canvas,view:value};
      setCanvas(state);
      viewWrites.current=viewWrites.current.catch(()=>{}).then(async()=>{await window.manga.run('save_canvas',{run_dir:runPath,canvas:state});});
      await viewWrites.current;
    }
    }catch(e){setError((e as Error).message);throw e;}
  }
  async function openPages(pages:number[]) {
    if(busy)return;
    setBusy(true);
    await attempt(async()=>{
      const data:AgentSession=await window.manga.run('agent_open_pages',{pages});
      await applyAgentResult(data);
      const selected=new Set(pages.map(n=>data.page_runs?.[`${data.book!.id}:${data.book!.pages[n-1].id}`]));
      const value={...emptyView(),...data.book_view,collapsed_pages:(data.book_view?.collapsed_pages||[]).filter(path=>!selected.has(path))};
      await window.manga.run('save_book_view',{book_id:data.book!.id,view:value});
      setBookView(value);
    });
    setBusy(false);
  }
  async function loadBookPages(pages:number[]) {
    const book=agentSession?.book;
    if(!book)return;
    setBusy(true);
    try{
      const loaded:Book=await window.manga.run('load_book_pages',{book_id:book.id,pages});
      setAgentSession(previous=>previous?.book?.id===loaded.id?{...previous,book:loaded}:previous);
    }finally{setBusy(false);}
  }
  async function activateRun(path:string) {
    if(busy||path===runPath)return;
    const book=agentSession?.book;
    const page=book?.pages.find(p=>agentSession?.page_runs?.[`${book.id}:${p.id}`]===path);
    if(page)await selectBookPage(page.number);
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
    tasks = taskEntries(run),
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
      const opened=await window.manga.openRunProject(path);
      const saved:AgentSession=await window.manga.run('read_session');
      setProject(opened);sessionRevision.current=0;setEvents([]);setLiveCommand(null);
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
      if(batch.length)setAgentSession(previous=>batch.reduce(conversationEvent,previous||{revision:0,messages:[],active_run:'',active_page_id:''}));
    }
    let reading = false, queued = false, disposed = false;
    async function refreshLive() {
      if (reading) { queued = true; return; }
      const path = active.current.runPath;
      if (!path) return;
      reading = true;
      try {
        const data = await window.manga.run("read_run", {run_dir:path});
        if (!disposed && active.current.runPath === path) {
          setRun(data);
          // 保留正在输入的草稿与拖动位置；实时刷新只更新真实产物。
          setCanvas(previous => ({...canvasState(data), draft:previous.draft, positions:previous.positions}));
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
      if (e.run_dir && projectPath && e.run_dir.startsWith(projectPath + "/runs/") && e.run_dir !== active.current.runPath) {
        setRunPath(e.run_dir);
        setRun(null);
        setCanvas(canvasState(null));
        setLocalRuns(paths => [...new Set([...paths, e.run_dir!])]);
        setView("canvas");
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
      const p = await window.manga.project(action);
      if (p) {
        sessionRevision.current=0;
        setEvents([]);
        setProject(p);
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
      }else await window.manga.run(command, { run_dir: path, ...params });
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
    setManifest(path);
    const data = await window.manga.run("read_source", { source: path });
    setImported(data);
    if (data.editor) setPage(data.editor.page);
    else setPage("");
    setTab("source");
    setView("workbench");
    setNotice("已选择来源清单，可用于新运行。");
  }
  async function saveSource(panels: PanelEdit[]) {
    setBusy(true);
    await attempt(async () => {
      const result = await window.manga.run("save_source", { page, panels });
      setManifest(result.manifest);
      setImported(null);
      setProject((p) =>
        p ? { ...p, sources: [...p.sources, result.manifest] } : p,
      );
      if (runPath) await acceptSource(result.manifest);
      else
        setNotice(`已保存 ${result.panels} 格新来源版本。创建新运行后可导入。`);
    });
    setBusy(false);
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
      await applyAgentResult(await window.manga.run('agent_select_page',{page_number:previousPage.number}));
    }
    return directory;
  }
  function permissions() {
    return permission === "video" ? ["planning","images","video"] : permission === "images" ? ["planning","images"] : permission === "planning" ? ["planning"] : [];
  }
  async function applyAgentResult(data: AgentSession, live = false) {
    sessionRevision.current=data.revision;
    setAgentSession(data);
    setBookView({...emptyView(),...data.book_view});
    setLiveCommand(live && data.pending?.kind === "canvas" ? data.pending as CanvasCommand : null);
    if (data.active_run) {
      setRunPath(data.active_run);
      setLocalRuns(paths => [...new Set([...paths, data.active_run])]);
      await refresh(data.active_run);
    } else { setRunPath(""); setRun(null); setCanvas(canvasState(null)); }
    setView("canvas");
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
      await attempt(async()=>{
        const data=await window.manga.run('submit_message',{message_id:crypto.randomUUID().replaceAll('-',''),run_dir:runPath||undefined,text,context:agentContext,
          delivery:options?.delivery||'steer',references:options?.references||[],task_id:agentSession?.active_task_id,permissions:permissions()});
        setAgentSession(previous=>previous?{...previous,pending_requests:data.pending_requests}:previous);
      });
      return;
    }
    stopped.current=false;
    setBusy(true);
    let completed = false;
    await attempt(async () => {
      await ensureProject();
      if(stopped.current)return;
      if(fromHome){
        setView('canvas');setEvents([]);setNotice('');
        if(attachment){sessionRevision.current=0;setAgentSession(null);setRunPath('');setRun(null);setCanvas(canvasState(null));setLiveCommand(null);}
      }
      const pending=agentSession?.pending;
      const questionId=!readOnly&&pending&&'question_id' in pending?pending.question_id:undefined;
      let data = await window.manga.run(questionId&&!attachment?"agent_answer":"agent_message", {text,question_id:questionId, attachment:attachment || undefined,
        run_dir: !attachment && !fromHome ? runPath || undefined : undefined,
        context:agentContext, permissions:readOnly?[]:permissions(),references:options?.references||[]});
      data=await continueAgent(data);
      await applyAgentResult(data, !stopped.current);
      completed = true;
    });
    // 即便模型请求失败，本地导入与已有工具结果仍可查看。
    try {
      if (!completed) {
        const saved = await window.manga.run("read_session");
        if (saved.book || saved.active_run) await applyAgentResult(saved);
      }
    } catch { /* 原请求错误保持在界面 */ }
    setBusy(false);
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
      const current:RunData=await window.manga.run('read_run',{run_dir:reference.run});
      const state=canvasState(current),node=graph(current,state).nodes.find(n=>n.id===reference.node_id);
      if(!node)throw new Error('原产物仍保留，但该版本没有可定位的画布节点');
      if(busy)throw new Error('当前制作中，完成后可定位此引用');
      setRunPath(reference.run);setRun(current);setCanvas(state);setView('canvas');
      setLiveCommand({kind:'canvas',call_id:'local:'+crypto.randomUUID(),revision:0,run:reference.run,
        operation:'open_details',node_ids:[node.id],dx:0,dy:0});
    });
  }
  async function locateTask(task:WorkflowTask,target?:string){
    if(busy)return;
    await attempt(async()=>{
      const current:RunData=await window.manga.run('read_run',{run_dir:task.run});
      const state=canvasState(current);
      const nodes=graph(current,state).nodes;
      const wanted=target||task.target;
      const node=nodes.find(n=>n.id===wanted||n.data.location===wanted||n.id===`frame:${wanted}`)||
        nodes.find(n=>task.stage==='video'?n.id==='final':n.data.stage===task.stage)||nodes[0];
      if(!node)throw new Error('该版本尚无对应画布产物');
      setRunPath(task.run);setRun(current);setCanvas(state);setView('canvas');
      setLiveCommand({kind:'canvas',call_id:'local:'+crypto.randomUUID(),revision:0,run:task.run,
        operation:'open_details',node_ids:[node.id],dx:0,dy:0});
    });
  }
  async function selectBookPage(number: number) {
    if (busy) return;
    setBusy(true);
    await attempt(async () => {await applyAgentResult(await window.manga.run("agent_select_page", {page_number:number}));});
    setBusy(false);
  }
  async function runProject(stage:RunStage,targets?:string[],operation:'stage'|'until'='stage') {
    if(busy||run?.experimental)return;
    if(run?.simulation){await execute("simulate");return;}
    if(!project){setNotice("请先打开项目，再运行制作；当前为本地记录预览。");return;}
    if(!runPath&&agentSession?.book){setNotice('请先在书籍节点展开并选择需要制作的页面。');return;}
    const paths=targets?.length?[...new Set(targets)]:runPath?[runPath]:[];
    if(!paths.length)return;
    if(paths.some(path=>!(path.startsWith(project.path+'/runs/')||(path===project.path&&project.runs.includes('.'))))){setNotice('当前记录不属于已打开项目，请打开所属项目后制作。');return;}
    stopped.current=false;
    setBusy(true);setError("");setNotice("");
    try{
      for(const path of paths){
        if(stopped.current)break;
        setRunPath(path);
        const current:RunData=await window.manga.run("read_run",{run_dir:path});
        if(stopped.current)break;
        setRun(current);setCanvas(canvasState(current));
        let data:AgentSession=await window.manga.run('agent_run_stage',{run_dir:path,stage,operation});
        data=await continueAgent(data);
        await applyAgentResult(data);
        if(stopped.current)break;
        if(data.pending){setNotice(`${runStageNames[stage]}需要处理，后续页面未启动。`);break;}
      }
    }catch(e){
      if(stopped.current){
        setNotice('已停止本地执行，后续页面未启动。');
        const saved:AgentSession=await window.manga.run('read_session');
        await applyAgentResult(saved);
      }else setError((e as Error).message);
      await refresh(active.current.runPath).catch(()=>{});
    }
    finally{setBusy(false);}
  }
  async function startCanvas() {
    await messageAgent(inputPrompt || "打开这个漫画，选择需要改编的页面。", inputPage, true);
    setInputPage("");setInputMaterial(null);
  }
  async function createSimulation() {
    if (busy) return;
    setBusy(true);
    await attempt(async () => {
      const path = await window.manga.createSimulation();
      setAgentSession(null);
      setLiveCommand(null);
      setEvents([]);
      setNotice("");
      await openRun(path);
    });
    setBusy(false);
  }
  async function persistCanvas(state: CanvasState) {
    setCanvas(state);
    if (!runPath || busy) return;
    await attempt(() =>
      window.manga.run("save_canvas", { run_dir: runPath, canvas: state }),
    );
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
      if (taskEntries(run).length) {
        await ensureProject();
        directory = await window.manga.newRun();
        state = await window.manga.run("fork_canvas", {
          run_dir: directory,
          from_run: runPath,
        });
        setRunPath(directory);
        setLocalRuns((paths) => [...paths, directory]);
      }
      state = { ...state, draft: "", messages: [...state.messages, message] };
      setCanvas(state);
      await window.manga.run("save_canvas", {
        run_dir: directory,
        canvas: state,
      });
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
      await window.manga.run("save_canvas", {
        run_dir: directory,
        canvas: state,
      });
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
      await window.manga
        .run("save_canvas", { run_dir: directory, canvas: state })
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
  const hasPlan = !!run?.records.find((r) => r.file === "production.json"),
    canModify = !!runPath && !run?.experimental;
  const ownedTaskError=view==='canvas'&&taskOwnsError(error,(agentSession?.workflow?.tasks||[]).filter(t=>
    t.run===runPath||t.id===agentSession?.active_task_id||t.parent_id===agentSession?.active_task_id));
  const taskNotice=view==='canvas'&&notice.includes('需要处理，后续页面未启动')&&!!agentSession?.pending;
  const bannerError=ownedTaskError?'':error;
  const bannerNotice=taskNotice?'':notice;
  return (
    <div className={`app ${["home","library","materials"].includes(view)&&!configOpen?"global-mode":""} ${collapsed ? "sidebar-collapsed" : ""} ${view === "canvas" ? "canvas-mode" : ""}`}>
      <header className="titlebar">
        <div className="traffic-space" />
        <button
          className="sidebar-toggle"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
        <div className="brand">
          <Clapperboard size={19} />
          <b>MangaWeaver</b>
          <span>STUDIO</span>
        </div>
        <div className="titlebar-center">
          {project?.name || "本地创作工作台"}
        </div>

      </header>
      <div className="app-body">
        <aside className="sidebar" style={!collapsed ? { width: sidebarWidth } : undefined}>
          <ProjectSidebar project={project} session={agentSession} runPath={runPath} runs={localRuns} previews={previews} view={configOpen?"settings":view} busy={busy}
            onMaterials={()=>{setConfigOpen(false);setSelectingMaterial(false);setView("materials");}}
            settingsOpen={configOpen} onSettings={()=>setConfigOpen(true)}
            onHome={()=>{setConfigOpen(false);setView('home');}} onLibrary={()=>{setConfigOpen(false);setView('library');}}
            onCreate={()=>selectProject('create')} onOpen={()=>selectProject('open')} onAttach={attach} onNewRun={newRun}
            onOpenRun={openRun} onPage={n=>openPages([n])}
            onPageFile={path=>{setPage(resolveRef(path));setTab('source');setView('workbench');}}
            onSourceFile={path=>void attempt(()=>chooseSource(resolveRef(path)))}/>

        </aside>
        {!collapsed && (
          <PanelResizeHandle label="调整目录宽度" width={sidebarWidth} min={176} initial={192}
            max={() => Math.min(420, window.innerWidth - (view === "canvas" ? chatWidth : 0) - 340)} onChange={setSidebarWidth} />
        )}
        <main className={`main ${configOpen?"settings-open":""}`}>
          <div className="toolbar">
            <div className="breadcrumb">
              {view === "workbench" && runPath && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setView("canvas")}
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
                {view !== "workbench"
                  ? project?.name || "本地创作空间"
                  : runPath
                    ? filename(runPath)
                    : "尚未选择运行"}
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
            <nav className="stage-navigation" aria-label="创作阶段">
              {tabs.map((t, i) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "active" : ""}
                  onClick={() => {
                    setTab(t.id);
                    setView("workbench");
                  }}
                >
                  <t.icon size={17} />
                  <span>{t.label}</span>
                  <small>0{i + 1}</small>
                </button>
              ))}
            </nav>
          )}
          {(bannerError || bannerNotice) && (
            <div
              className={`banner ${bannerError ? "error" : "info"}`}
              role={bannerError ? "alert" : "status"}
            >
              <span>{bannerError || bannerNotice}</span>
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                ×
              </button>
            </div>
          )}
          {configOpen && <EnvironmentSettings environment={environment} busy={busy} onBack={()=>setConfigOpen(false)} onUpdate={setEnvironment}/>}
          <div
            hidden={configOpen}
            className={`content ${view === "canvas" ? "canvas-content" : view !== "workbench" ? "workspace-content" : ""}`}
          >
            {view === "materials" && <MaterialLibrary busy={busy} selecting={selectingMaterial} onBack={()=>setView('home')} onSelect={async item=>{const path=await window.manga.selectMaterial(item.id);setInputPage(path);setInputMaterial(item);setView('home');}}/>}
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
                onMaterials={()=>{setSelectingMaterial(true);setView("materials");}}
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
                projectReady={!!project&&(!runPath||(runPath.startsWith(project.path+'/runs/')||(runPath===project.path&&project.runs.includes('.'))))}
                onOpenProject={()=>selectProject("open")}
                key={agentSession?.book?.id || runPath}
                run={run}
                otherRuns={otherRuns}
                view={agentSession?.book ? bookView : canvas.view}
                onView={persistView}
                onOpenPages={openPages}
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
                onHome={() => setView("home")}
                busy={busy}
                events={events}
                stopping={stopping}
                videoBlocker={environment?.video_blocker}
                onState={persistCanvas}
                onPreprocess={() => execute("preprocess", { page: wholePage(run, canvas) })}
                onContinue={continueCanvas}
                onFeedback={reviseCanvas}
                onSource={() => {
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
                }}
                onRun={runProject}
                onStop={() => attempt(stopRun)}
                onGenerate={(dry) => execute("generate", { dry_run: dry })}
                onDetails={(tab) => {
                  setTab(tab);
                  setView("workbench");
                }}
                onExport={(path) =>
                  attempt(() => window.manga.exportFile(path))
                }
              />
            )}
            {view === "workbench" && (
              <>
                {tab === "source" &&
                  (page ? (
                    <SourceEditor
                      key={page}
                      page={page}
                      initial={imported?.editor?.panels || []}
                      busy={busy}
                      onSave={saveSource}
                      onAuto={() => execute("preprocess", { page })}
                    />
                  ) : imported?.source || source ? (
                    <SourceView
                      key={manifest || runPath}
                      source={imported?.source || source}
                      onRevise={
                        project && !busy
                          ? (panels) => {
                              setBusy(true);
                              void attempt(async () => {
                                const origin = imported?.source
                                  ? manifest
                                  : `${runPath}/source/manifest.json`;
                                const r = await window.manga.run(
                                  "save_source",
                                  {
                                    source: origin,
                                    panels,
                                  },
                                );
                                await acceptSource(r.manifest);
                              }).finally(() => setBusy(false));
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <div className="empty-work">
                      <span className="eyebrow">01 / SOURCE MATERIAL</span>
                      <h1>
                        每个故事，
                        <br />
                        从一页漫画开始。
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
                      <span className="eyebrow">MANGA → ANIMATION</span>
                      <h1>
                        把离散分镜，
                        <br />
                        编织成连贯动画。
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
                              <small>0{i + 1}</small>
                              <span>{label}</span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                {tab === "generation" && (
                  <div className="padded generation">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">PRODUCTION</span>
                        <h2>生成与任务</h2>
                        <p>明确启动，保留过程。恢复查询不会重新提交任务。</p>
                      </div>
                      <span className="tag">
                        {run?.experimental
                          ? "只读实验"
                          : "正式首帧 / 首尾帧路线"}
                      </span>
                    </div>
                    <div className="production-actions">
                      <div>
                        <h3>准备来源</h3>
                        <p>
                          {manifest
                            ? filename(manifest)
                            : "选择来源清单，或在素材页保存分格。"}
                        </p>
                        <Button
                          size="sm"
                          onClick={() =>
                            attempt(async () => {
                              const path = await window.manga.importSource();
                              if (path) await chooseSource(path);
                            })
                          }
                          disabled={busy}
                        >
                          <FileJson size={14} />
                          选择清单
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy || !manifest || !canModify}
                          onClick={() => execute("preprocess", { manifest })}
                        >
                          导入预处理
                        </Button>
                      </div>
                      <div>
                        <h3>规划与审查</h3>
                        <p>沿用脚本 → 编排 → 演出 → 关键画面的反馈循环。</p>
                        <Button
                          size="sm"
                          disabled={busy || !canModify || run?.experimental}
                          onClick={() => execute("plan")}
                        >
                          <Play size={14} />
                          运行 / 继续规划
                        </Button>
                      </div>
                      <div>
                        <h3>视频生成</h3>
                        <p>
                          {hasPlan
                            ? "已有 production.json，提交前仍由引擎校验。"
                            : "等待规划通过，生成入口暂不可用。"}
                        </p>
                        <Button
                          size="sm"
                          disabled={busy || !hasPlan || !canModify}
                          onClick={() => execute("generate", { dry_run: true })}
                        >
                          预览任务 · 免费
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={
                            busy ||
                            !hasPlan ||
                            !canModify ||
                            !!environment?.video_blocker
                          }
                          onClick={() => execute("generate")}
                        >
                          <Play size={14} />
                          生成视频 · 付费
                        </Button>
                      </div>
                    </div>
                    {environment?.video_blocker && (
                      <div className="banner warning">
                        {environment.video_blocker}
                      </div>
                    )}
                    <div className="section-heading">
                      <div>
                        <h3>远端任务记录</h3>
                        <p>{tasks.length} 个候选 · 任务状态从本地记录读取</p>
                      </div>
                      <Button
                        disabled={busy || !tasks.length || !canModify}
                        onClick={() => execute("resume")}
                      >
                        <RefreshCw size={14} />
                        恢复查询 / 下载
                      </Button>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>片段</th>
                          <th>候选</th>
                          <th>状态</th>
                          <th>远端任务 ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((t: any) => (
                          <tr key={`${t.file}/${t.id}`}>
                            <td>{t.file.replace("/tasks.json", "")}</td>
                            <td>{t.id}</td>
                            <td>
                              <span className="tag">{t.status}</span>
                            </td>
                            <td className="mono">
                              {t.task_id || "提交结果不明，需平台核查"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!tasks.length && (
                      <div className="table-empty">
                        暂无正式视频任务；查看历史实验请前往结果页。
                      </div>
                    )}
                    {run?.records.find(
                      (r) => r.file === "generation_tasks.json",
                    ) && (
                      <details className="details">
                        <summary>生成任务与提示词</summary>
                        <pre>
                          {JSON.stringify(
                            run.records.find(
                              (r) => r.file === "generation_tasks.json",
                            )?.data,
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
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
              </>
            )}
          </div>
          <footer className="statusbar">
            <button onClick={() => setLogs(!logs)}>
              <Command size={12} />
              {busy
                ? phase[last?.stage] || last?.stage || "执行中"
                : "本地引擎"}
              <ChevronDown size={12} />
            </button>
            <span>
              {run?.experimental
                ? "实验预览 · 尚未批准"
                : currentPlan(run)?.reviews?.some((r: any) => !r.accepted)
                  ? "规划存在待修订项"
                  : run
                    ? "查看已有记录，不会自动生成"
                    : "Electron / Python"}
            </span>
            <span>MangaWeaver 0.1</span>
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
                  <div key={i}>
                    <span>{e.type}</span> {phase[e.stage] || e.stage}{" "}
                    <small>{JSON.stringify(e.data)}</small>
                  </div>
                ))
              ) : (
                <p>没有活动操作。打开结果不会触发模型调用。</p>
              )}
            </div>
          )}
        </main>
        {referencePreview&&<div className="reference-preview" role="dialog" aria-label="引用预览">
          <button className="reference-preview-close" aria-label="关闭引用预览" onClick={()=>setReferencePreview(null)}>关闭</button>
          <strong>{referencePreview.reference.label} · 原版本</strong>
          <Media path={referencePreview.path} video={referencePreview.reference.kind==='video'} alt={referencePreview.reference.label}/>
        </div>}
      </div>
    </div>
  );
}
