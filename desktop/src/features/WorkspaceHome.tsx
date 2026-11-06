import { ArrowRight,BookOpen,Clapperboard,FileJson,FolderOpen,ImagePlus,MoreHorizontal,Play,Plus,RefreshCw,X } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { ActionMenu } from '../components/controls';
import { Media } from '../components/Media';
import { SearchInput } from '../components/SearchInput';
import { Attachment,AttachmentAction,AttachmentContent,AttachmentMedia,AttachmentTitle } from '../components/ui/attachment';
import { Button } from '../components/ui/button';
import { DropdownMenuItem as Item } from '../components/ui/dropdown-menu';
import { InputGroup,InputGroupAddon,InputGroupTextarea } from '../components/ui/input-group';
import { filename } from '../lib/data';
import type { RunData,RunPreview } from '../lib/types';

type Props={library:boolean;projectName?:string;runs:string[];previews:RunPreview[];scanning:boolean;
  onScan:(chooseDirectory?:boolean)=>void;current:RunData|null;busy:boolean;inputPage:string;inputLabel?:string;inputCover?:string;onMaterials:()=>void;prompt:string;
  onLibrary:()=>void;onPrompt:(text:string)=>void;onStart:()=>void;onSimulate:()=>void;onRemovePage:()=>void;onImport:()=>void;
  onSource:()=>void;onAttach:()=>void;onCreate:()=>void;onOpenProject:()=>void;onContinue:()=>void;onOpenRun:(path:string)=>void;};
export function WorkspaceHome(p:Props){
  const [query,setQuery]=useState('');
  const prompt=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(prompt.current){prompt.current.style.height='0px';prompt.current.style.height=Math.max(94,Math.min(220,prompt.current.scrollHeight))+'px';}},[p.prompt,p.library]);
  const films=p.previews.filter(item=>item.video&&p.runs.includes(item.directory));
  const visible=films.filter(item=>`${item.name} ${filename(item.directory)}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={`workspace-home ${p.library?'project-library':'creation-home'}`}>
    {p.library?<header className="library-heading"><div><h1>成片库</h1><p>查看与继续已有动画。</p></div><div className="library-actions row"><Button variant="default" disabled={p.busy} onClick={p.projectName?p.onContinue:p.onOpenProject}><FolderOpen size={15}/>{p.projectName?'继续当前项目':'打开项目'}</Button><ActionMenu label="项目操作" trigger={<MoreHorizontal size={17}/>}><Item disabled={p.busy} onSelect={p.onCreate}>新建项目</Item><Item disabled={p.busy} onSelect={p.onOpenProject}>打开其他项目</Item><Item disabled={p.busy} onSelect={p.onAttach}>导入已有运行</Item></ActionMenu></div></header>:
      <header className="creation-heading"><h1>让漫画，成为动画。</h1>
        <InputGroup className="creation-composer">

          {p.inputPage&&<InputGroupAddon align="block-start"><Attachment size="sm"><AttachmentMedia variant="image">{p.inputCover||/\.(png|jpe?g|webp)$/i.test(p.inputPage)?<Media path={p.inputCover||p.inputPage} alt="待改编漫画页"/>:<FileJson size={25}/>}</AttachmentMedia><AttachmentContent><AttachmentTitle title={p.inputPage}>{p.inputLabel||filename(p.inputPage)}</AttachmentTitle></AttachmentContent><AttachmentAction aria-label="移除漫画页" onClick={p.onRemovePage}><X size={14}/></AttachmentAction></Attachment></InputGroupAddon>}
          <InputGroupTextarea ref={prompt} className="home-prompt" rows={3} aria-label="创作提示词" placeholder="添加一本漫画或单页，告诉我你想怎么改编。" value={p.prompt} onChange={e=>p.onPrompt(e.target.value)} maxLength={20000} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing&&(p.inputPage||p.prompt.trim())&&!p.busy){e.preventDefault();p.onStart();}}}/>
          <InputGroupAddon align="block-end" className="composer-bottom justify-between"><div className="row"><ActionMenu label="添加漫画或素材" size="sm" disabled={p.busy} trigger={<><Plus size={16}/><span>{p.inputPage?'更换漫画':'添加漫画'}</span></>}>
            <Item onSelect={p.onImport}><ImagePlus size={14}/>本地漫画</Item><Item onSelect={p.onMaterials}><BookOpen size={14}/>素材库</Item>
            <Item onSelect={p.onSource}>来源清单</Item><Item onSelect={p.onAttach}>已有运行</Item>
          </ActionMenu>
          </div><Button variant="default" disabled={p.busy||(!p.inputPage&&!p.prompt.trim())} onClick={p.onStart}>开始创作<ArrowRight size={15}/></Button></InputGroupAddon>
        </InputGroup>
        <div className="home-entry-actions">
          <Button variant="ghost" size="sm" className="home-open-project" disabled={p.busy} onClick={p.projectName?p.onContinue:p.onOpenProject}><FolderOpen size={13}/>{p.projectName?`继续项目 · ${p.projectName}`:'打开已有项目'}<ArrowRight size={12}/></Button>
          <Button variant="ghost" size="sm" className="home-demo-entry" disabled={p.busy} onClick={p.onSimulate} title="本地素材回放，体验多 Agent 创作全流程，不调用模型"><Play size={13}/>体验演示</Button>
        </div>
      </header>}
    <section className="workspace-projects"><div className="library-filter"><div className="library-tabs"><span className="selected">{p.library?'本地成片':'最近成片'}</span><span>{films.length}</span></div><div className="row library-scan-actions">
      {p.library?<SearchInput label="搜索成片" value={query} onChange={setQuery}/>:<Button variant="ghost" size="sm" onClick={p.onLibrary}>查看全部<ArrowRight size={13}/></Button>}
      <ActionMenu label="成片列表操作" trigger={<MoreHorizontal size={17}/>}><Item disabled={p.scanning} onSelect={()=>p.onScan(true)}>扫描目录</Item><Item disabled={p.scanning} onSelect={()=>p.onScan()}><RefreshCw size={13}/>刷新列表</Item></ActionMenu>
    </div></div>
    {visible.length?<div className="project-card-grid">{(p.library?visible:visible.slice(0,3)).map(f=><article className="project-card" key={f.directory}><div className="project-cover" title={f.directory}><Media path={f.video!} video compact compactLabel={`打开项目：${f.name||filename(f.directory)}`} onCompactOpen={p.busy?undefined:()=>p.onOpenRun(f.directory)}/></div><div className="project-card-body"><Button variant="ghost" size="sm" className="project-open h-auto w-full justify-between whitespace-normal text-left" disabled={p.busy} onClick={()=>p.onOpenRun(f.directory)} title={f.directory} aria-label={`打开项目：${f.name||filename(f.directory)}`}><h3>{f.name||filename(f.directory)}</h3><ArrowRight size={14}/></Button><div className="project-card-meta"><span>{f.experimental?'实验成片':'成片'}</span><time dateTime={new Date(f.updated).toISOString()}>{new Date(f.updated).toLocaleDateString('zh-CN')}</time></div></div></article>)}</div>:
      (query||p.library)&&<div className="library-empty"><FilmPlaceholder/><p>{query?'没有找到匹配的成片。':'完成的动画会出现在这里。'}</p>{!query&&<Button variant="ghost" disabled={p.busy} onClick={p.onAttach}>导入已有运行</Button>}</div>}
    </section>
  </div>;
}
function FilmPlaceholder(){return <Clapperboard size={27} strokeWidth={1.25}/>;}
