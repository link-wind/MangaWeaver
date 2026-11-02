import {useEffect,useState} from 'react';
import {BookOpen,ChevronDown,ChevronLeft,ChevronRight,FileImage,FileText,Film,FolderOpen,LayoutGrid,PenLine,Plus,Settings2} from 'lucide-react';
import type {AgentSession,Project,RunPreview} from '../lib/types';
import {filename} from '../lib/data';
import {useDetailsMenus} from '../lib/useDetailsMenus';

type Props={project:Project|null;session:AgentSession|null;runPath:string;runs:string[];previews:RunPreview[];view:string;busy:boolean;
  settingsOpen:boolean;onSettings:()=>void;onHome:()=>void;onLibrary:()=>void;onMaterials:()=>void;onCreate:()=>void;onOpen:()=>void;onAttach:()=>void;onNewRun:()=>void;
  onOpenRun:(path:string)=>void;onPage:(number:number)=>void;onPageFile:(path:string)=>void;onSourceFile:(path:string)=>void;};
export function ProjectSidebar(p:Props){
  const menu=useDetailsMenus<HTMLDetailsElement>();
  const [offset,setOffset]=useState(0),[jump,setJump]=useState('');
  const book=p.session?.book;
  useEffect(()=>{setOffset(Math.floor(((Number(p.session?.active_page_id?.replace('page',''))||1)-1)/10)*10);},[book?.id,p.session?.active_page_id]);
  const choose=(action:()=>void)=>{menu.current?.removeAttribute('open');action();};
  const projectRuns=p.project?[...new Set([...p.runs,p.runPath].filter(Boolean))].filter(path=>path===p.project!.path||path.startsWith(p.project!.path+'/runs/')):[];
  const films=p.previews.filter(r=>r.video&&(!p.project||projectRuns.includes(r.directory)));
  const standaloneRuns=projectRuns.filter(path=>!book||!Object.entries(p.session?.page_runs||{}).some(([key,value])=>key.startsWith(book.id+':')&&value===path));
  return <>
    <details data-menu className="workspace-switcher" ref={menu}><summary className="workspace-name"><div className="project-icon"><FolderOpen size={17}/></div><strong title={p.project?.name}>{p.project?.name||'工作空间'}</strong><ChevronDown size={13}/></summary>
      <div className="workbench-menu"><button disabled={p.busy} onClick={()=>choose(p.onCreate)}><Plus size={14}/>新建项目</button><button disabled={p.busy} onClick={()=>choose(p.onOpen)}><FolderOpen size={14}/>打开项目</button><button disabled={p.busy} onClick={()=>choose(p.onAttach)}>导入已有运行</button>{p.project&&<button disabled={p.busy} onClick={()=>choose(p.onNewRun)}>新建运行</button>}</div>
    </details>
    <nav className="global-navigation" aria-label="工作空间"><button className={p.view==='home'?'active':''} onClick={p.onHome} title="开始创作"><PenLine size={17}/><span>开始创作</span></button><button className={p.view==='library'?'active':''} onClick={p.onLibrary} title="成片库"><LayoutGrid size={17}/><span>成片库</span></button><button className={p.view==='materials'?'active':''} onClick={p.onMaterials} title="素材库"><BookOpen size={17}/><span>素材库</span></button></nav>
    <div className="project-directory" hidden={["home","library","materials"].includes(p.view)}>
      {book&&<section className="sidebar-section book-directory"><div className="directory-label"><span>漫画</span><small>{book.page_count} 页</small></div><div className="directory-book"><BookOpen size={15}/><strong title={book.name}>{book.name.replace(/\.(mobi|cbz|zip|pdf)$/i,'')}</strong></div>
        <form className="directory-jump" onSubmit={e=>{e.preventDefault();const n=Number(jump);if(Number.isInteger(n)&&n>=1&&n<=book.page_count){setOffset(Math.floor((n-1)/10)*10);p.onPage(n);setJump('');}}}><input aria-label="跳转文件页" type="number" min={1} max={book.page_count} placeholder="文件页码" value={jump} onChange={e=>setJump(e.target.value)} disabled={p.busy}/><button disabled={p.busy||!jump} aria-label="打开指定页"><ChevronRight size={13}/></button></form>
        <div className="directory-pages">{book.pages.slice(offset,offset+10).map(page=>{
          const opened=p.session?.page_runs?.[`${book.id}:${page.id}`];
          return <button key={page.id} className={p.session?.active_page_id===page.id?'active':''} aria-current={p.session?.active_page_id===page.id?'page':undefined} disabled={p.busy} onClick={()=>p.onPage(page.number)}><FileImage size={13}/><span>文件第 {page.number} 页</span>{opened&&<i title="已在画布中展开"/>}</button>;
        })}</div>
        <div className="directory-pagination"><button aria-label="上一组页面" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-10))}><ChevronLeft size={13}/></button><small>{offset+1}–{Math.min(offset+10,book.page_count)}</small><button aria-label="下一组页面" disabled={offset+10>=book.page_count} onClick={()=>setOffset(offset+10)}><ChevronRight size={13}/></button></div>
      </section>}
      {p.project&&standaloneRuns.length>0&&<section className="sidebar-section"><div className="directory-label"><span>独立运行</span></div><div className="directory-pages">{standaloneRuns.map((path,i)=><button key={path} disabled={p.busy} className={path===p.runPath?'active':''} onClick={()=>p.onOpenRun(path)} title={path}><FileImage size={13}/><span>{path===p.runPath?'当前画布':`创作记录 ${i+1}`}</span></button>)}</div></section>}
      {!!p.project?.pages.length&&<section className="sidebar-section"><div className="directory-label"><span>页面文件</span></div>{p.project.pages.map(path=><button disabled={p.busy} className="page-link" key={path} onClick={()=>p.onPageFile(path)}><FileImage size={13}/>{filename(path)}</button>)}</section>}
      {!!p.project?.sources.length&&<details className="sidebar-section source-directory"><summary>来源文件</summary>{p.project.sources.map(path=><button disabled={p.busy} className="page-link" key={path} onClick={()=>p.onSourceFile(path)}><FileText size={13}/>{filename(path)}</button>)}</details>}
      {!!films.length&&<section className="sidebar-section"><div className="directory-label"><span>{p.project?'项目成果':'最近成片'}</span></div><div className="directory-pages">{films.slice(0,p.project?films.length:5).map(f=><button key={f.directory} disabled={p.busy} className={f.directory===p.runPath?'active':''} onClick={()=>p.onOpenRun(f.directory)} title={f.name}><Film size={13}/><span>{f.name}</span></button>)}</div></section>}
      {!book&&p.project&&!projectRuns.length&&!p.project.pages.length&&!p.project.sources.length&&<p className="directory-empty">添加漫画后，页面会出现在这里。</p>}
    </div>
    <div className="sidebar-bottom"><button className={`sidebar-settings ${p.settingsOpen?'active':''}`} onClick={p.onSettings} aria-label="设置" aria-pressed={p.settingsOpen} title="设置"><Settings2 size={17}/><span>设置</span></button><span className="local-badge"><span className="connection-dot online"/>文件保存在本机</span></div>
  </>;
}
