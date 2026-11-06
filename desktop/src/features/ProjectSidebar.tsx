import { BookOpen,ChevronDown,FileImage,FileText,Film,FolderOpen,LayoutGrid,PenLine,Plus,Settings2 } from 'lucide-react';
import { ActionMenu } from '../components/controls';
import { Disclosure } from '../components/Disclosure';
import { Button } from '../components/ui/button';
import { DropdownMenuItem as MenuItem } from '../components/ui/dropdown-menu';
import { SidebarContent,SidebarFooter,SidebarGroup,SidebarGroupLabel,SidebarHeader,SidebarMenu,SidebarMenuButton,SidebarMenuItem,SidebarSeparator } from '../components/ui/sidebar';
import { filename } from '../lib/data';
import type { AgentSession,CanvasView,Project,RunPreview } from '../lib/types';

type Props={project:Project|null;session:AgentSession|null;runPath:string;runs:string[];previews:RunPreview[];view:string;busy:boolean;
  bookView?:CanvasView;onBookOverview:()=>void;
  settingsOpen:boolean;onSettings:()=>void;onHome:()=>void;onLibrary:()=>void;onMaterials:()=>void;onCreate:()=>void;onOpen:()=>void;onAttach:()=>void;onNewRun:()=>void;
  onOpenRun:(path:string)=>void;onPage:(number:number)=>void;onPageFile:(path:string)=>void;onSourceFile:(path:string)=>void;};
export function ProjectSidebar(p:Props){
  const book=p.session?.book,currentPage=book?.pages.find(page=>page.id===p.bookView?.workspace?.page_id)?.number;
  const projectRuns=p.project?[...new Set([...p.runs,p.runPath].filter(Boolean))].filter(path=>path===p.project!.path||path.startsWith(p.project!.path+'/runs/')):[];
  const films=p.previews.filter(r=>r.video&&(!p.project||projectRuns.includes(r.directory)));
  const standalone=projectRuns.filter(path=>!films.some(f=>f.directory===path)&&(!book||!Object.entries(p.session?.page_runs||{}).some(([key,value])=>key.startsWith(book.id+':')&&value===path)));
  const hideDirectory=p.settingsOpen||['home','library','materials'].includes(p.view);
  return <>
    <SidebarHeader className="workspace-switcher min-w-0 p-0"><ActionMenu label="项目菜单" size="default" className="h-10 w-full min-w-0 justify-start gap-2 px-2" trigger={<><div className="project-icon"><FolderOpen size={17}/></div><strong className="min-w-0 flex-1 truncate text-left" title={p.project?.name}>{p.project?.name||'工作空间'}</strong><ChevronDown size={13}/></>}>
      <MenuItem disabled={p.busy} onSelect={p.onCreate}><Plus/>新建项目</MenuItem><MenuItem disabled={p.busy} onSelect={p.onOpen}><FolderOpen/>打开项目</MenuItem><MenuItem disabled={p.busy} onSelect={p.onAttach}>导入已有运行</MenuItem>{p.project&&<MenuItem disabled={p.busy} onSelect={p.onNewRun}>新建运行</MenuItem>}
    </ActionMenu></SidebarHeader>
    <nav className="global-navigation" aria-label="工作空间"><SidebarMenu>{[
      {view:'home',label:'开始创作',icon:PenLine,action:p.onHome},{view:'library',label:'成片库',icon:LayoutGrid,action:p.onLibrary},{view:'materials',label:'素材库',icon:BookOpen,action:p.onMaterials}
    ].map(n=><SidebarMenuItem key={n.view}><SidebarMenuButton isActive={p.view===n.view} tooltip={n.label} onClick={n.action}><n.icon/><span>{n.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></nav>
    <SidebarContent className={`project-directory gap-4 overflow-x-hidden overflow-y-auto [.sidebar-collapsed_&]:hidden ${hideDirectory?'hidden':''}`} hidden={hideDirectory}>
      {book&&<SidebarGroup className="book-directory p-0"><SidebarGroupLabel className="justify-between"><span>漫画</span><small>{book.page_count} 页</small></SidebarGroupLabel><Button variant="ghost" className="directory-book h-auto w-full justify-start text-left" onClick={p.onBookOverview}><BookOpen size={15}/><strong title={book.name}>{book.name.replace(/\.(mobi|cbz|zip|pdf)$/i,'')}</strong></Button>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={p.bookView?.workspace?.mode!=='page'} onClick={p.onBookOverview}><LayoutGrid/><span>全书总览</span></SidebarMenuButton></SidebarMenuItem>
          {currentPage&&<SidebarMenuItem><SidebarMenuButton isActive={p.bookView?.workspace?.mode==='page'} onClick={()=>p.onPage(currentPage)}><FileImage/><span>第 {currentPage} 页画布</span></SidebarMenuButton></SidebarMenuItem>}</SidebarMenu>
      </SidebarGroup>}
      {p.project&&standalone.length>0&&<SidebarGroup className="p-0"><SidebarGroupLabel>独立运行</SidebarGroupLabel><SidebarMenu>{standalone.map((path,i)=><SidebarMenuItem key={path}><SidebarMenuButton disabled={p.busy} isActive={path===p.runPath} onClick={()=>p.onOpenRun(path)} title={path}><FileImage/><span>{path===p.runPath?'当前画布':`创作记录 ${i+1}`}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>}
      {!!p.project?.pages.length&&<SidebarGroup className="p-0"><SidebarGroupLabel>页面文件</SidebarGroupLabel><SidebarMenu>{p.project.pages.map(path=><SidebarMenuItem key={path}><SidebarMenuButton disabled={p.busy} onClick={()=>p.onPageFile(path)}><FileImage/><span>{filename(path)}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>}
      {!!p.project?.sources.length&&<Disclosure title="来源文件"><SidebarMenu>{p.project.sources.map(path=><SidebarMenuItem key={path}><SidebarMenuButton disabled={p.busy} onClick={()=>p.onSourceFile(path)}><FileText/><span>{filename(path)}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></Disclosure>}
      {!!films.length&&<SidebarGroup className="p-0"><SidebarGroupLabel>{p.project?'项目成果':'最近成片'}</SidebarGroupLabel><SidebarMenu>{films.slice(0,p.project?films.length:5).map(f=><SidebarMenuItem key={f.directory}><SidebarMenuButton disabled={p.busy} isActive={f.directory===p.runPath} onClick={()=>p.onOpenRun(f.directory)} title={f.name}><Film/><span>{f.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>}
      {!book&&p.project&&!projectRuns.length&&!p.project.pages.length&&!p.project.sources.length&&<p className="directory-empty">添加漫画后，页面会出现在这里。</p>}
    </SidebarContent>
    <SidebarFooter className="sidebar-bottom shrink-0 p-0 pt-3"><SidebarSeparator className="mx-0"/><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={p.settingsOpen} onClick={p.onSettings} aria-label="设置" tooltip="设置"><Settings2/><span>设置</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </>;
}
