import {BookOpen,ArrowRight,Clapperboard,FileJson,FolderOpen,ImagePlus,Plus,Search,RefreshCw,MoreHorizontal,X} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../components/ui/button';
import {Media} from '../components/Media';
import {filename} from '../lib/data';
import type {RunData,RunPreview} from '../lib/types';
import {useDetailsMenus} from '../lib/useDetailsMenus';

type Props={library:boolean;projectName?:string;runs:string[];previews:RunPreview[];scanning:boolean;
  onScan:(chooseDirectory?:boolean)=>void;current:RunData|null;busy:boolean;inputPage:string;inputLabel?:string;inputCover?:string;onMaterials:()=>void;prompt:string;
  onLibrary:()=>void;onPrompt:(text:string)=>void;onStart:()=>void;onSimulate:()=>void;onRemovePage:()=>void;onImport:()=>void;
  onSource:()=>void;onAttach:()=>void;onCreate:()=>void;onOpenProject:()=>void;onContinue:()=>void;onOpenRun:(path:string)=>void;};
function closeMenu(e:React.MouseEvent,action:()=>void){e.currentTarget.closest('details')?.removeAttribute('open');action();}
export function WorkspaceHome(p:Props){
  const [query,setQuery]=useState('');
  const root=useDetailsMenus<HTMLDivElement>();
  const prompt=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(prompt.current){prompt.current.style.height='0px';prompt.current.style.height=Math.max(94,Math.min(220,prompt.current.scrollHeight))+'px';}},[p.prompt,p.library]);
  const films=p.previews.filter(item=>item.video&&p.runs.includes(item.directory));
  const visible=films.filter(item=>`${item.name} ${filename(item.directory)}`.toLowerCase().includes(query.toLowerCase()));
  return <div ref={root} className={`workspace-home ${p.library?'project-library':'creation-home'}`}>
    {p.library?<header className="library-heading"><div><h1>成片库</h1><p>查看与继续已有动画。</p></div><div className="library-actions row"><Button variant="default" disabled={p.busy} onClick={p.projectName?p.onContinue:p.onOpenProject}><FolderOpen size={15}/>{p.projectName?'继续当前项目':'打开项目'}</Button><details data-menu className="home-more"><summary aria-label="项目操作"><MoreHorizontal size={17}/></summary><div className="workbench-menu"><button disabled={p.busy} onClick={e=>closeMenu(e,p.onCreate)}>新建项目</button><button disabled={p.busy} onClick={e=>closeMenu(e,p.onOpenProject)}>打开其他项目</button><button disabled={p.busy} onClick={e=>closeMenu(e,p.onAttach)}>导入已有运行</button></div></details></div></header>:
      <header className="creation-heading"><h1>让漫画，成为动画。</h1>
        <div className="creation-composer text-composer">

          {p.inputPage&&<div className="home-attachment">{p.inputCover||/\.(png|jpe?g|webp)$/i.test(p.inputPage)?<Media path={p.inputCover||p.inputPage} alt="待改编漫画页"/>:<FileJson size={25}/>}<strong title={p.inputPage}>{p.inputLabel||filename(p.inputPage)}</strong><button aria-label="移除漫画页" onClick={p.onRemovePage}><X size={14}/></button></div>}
          <textarea ref={prompt} className="home-prompt" rows={3} aria-label="创作提示词" placeholder="添加一本漫画或单页，告诉我你想怎么改编。" value={p.prompt} onChange={e=>p.onPrompt(e.target.value)} maxLength={20000} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing&&(p.inputPage||p.prompt.trim())&&!p.busy){e.preventDefault();p.onStart();}}}/>
          <div className="composer-bottom"><div className="row"><div className="home-source-row"><Button variant="ghost" disabled={p.busy} onClick={p.onImport}><ImagePlus size={16}/>{p.inputPage?'更换漫画':'添加漫画'}</Button><Button variant="ghost" disabled={p.busy} onClick={p.onMaterials}><BookOpen size={16}/>从素材库选择</Button></div><details data-menu className="home-more"><summary aria-label="更多导入方式"><Plus size={16}/></summary><div className="workbench-menu"><button disabled={p.busy} onClick={e=>closeMenu(e,p.onSource)}>导入来源清单</button><button disabled={p.busy} onClick={e=>closeMenu(e,p.onAttach)}>导入已有运行</button><button disabled={p.busy} onClick={e=>closeMenu(e,p.onSimulate)}>体验本地示例</button></div></details>
          </div><Button variant="default" disabled={p.busy||(!p.inputPage&&!p.prompt.trim())} onClick={p.onStart}>开始创作<ArrowRight size={15}/></Button></div>
        </div>
        <button className="home-open-project" disabled={p.busy} onClick={p.projectName?p.onContinue:p.onOpenProject}><FolderOpen size={13}/>{p.projectName?'继续当前项目':'打开项目'}<ArrowRight size={12}/></button>
      </header>}
    <section className="workspace-projects"><div className="library-filter"><div className="library-tabs"><span className="selected">{p.library?'本地成片':'最近成片'}</span><span>{films.length}</span></div><div className="row library-scan-actions">
      {p.library?<label className="project-search"><Search size={14}/><input aria-label="搜索成片" placeholder="搜索成片" value={query} onChange={e=>setQuery(e.target.value)}/></label>:<Button variant="ghost" size="sm" onClick={p.onLibrary}>查看全部<ArrowRight size={13}/></Button>}
      <details data-menu className="home-more"><summary aria-label="成片列表操作"><MoreHorizontal size={17}/></summary><div className="workbench-menu"><button disabled={p.scanning} onClick={e=>closeMenu(e,()=>p.onScan(true))}>扫描目录</button><button disabled={p.scanning} onClick={e=>closeMenu(e,()=>p.onScan())}><RefreshCw size={13}/>刷新列表</button></div></details>
    </div></div>
    {visible.length?<div className="project-card-grid">{(p.library?visible:visible.slice(0,3)).map(f=><article className="project-card" key={f.directory}><div className="project-cover"><Media path={f.video!} video compact/></div><div className="project-card-body"><button className="project-open" disabled={p.busy} onClick={()=>p.onOpenRun(f.directory)} title={f.directory}><h3>{f.name||filename(f.directory)}</h3><ArrowRight size={14}/></button><div className="project-card-meta"><span>{f.experimental?'实验成片':'成片'}</span><time dateTime={new Date(f.updated).toISOString()}>{new Date(f.updated).toLocaleDateString('zh-CN')}</time></div></div></article>)}</div>:
      (query||p.library)&&<div className="library-empty"><FilmPlaceholder/><p>{query?'没有找到匹配的成片。':'完成的动画会出现在这里。'}</p>{!query&&<Button variant="ghost" disabled={p.busy} onClick={p.onAttach}>导入已有运行</Button>}</div>}
    </section>
  </div>;
}
function FilmPlaceholder(){return <Clapperboard size={27} strokeWidth={1.25}/>;}
