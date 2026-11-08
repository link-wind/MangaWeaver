import {Folder,GitBranch,Info,RefreshCw,Server,SlidersHorizontal} from 'lucide-react';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Dialog} from '../components/controls';
import {Button} from '../components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '../components/ui/alert-dialog';
import {ModelServices} from './ModelServices';
import {GenerationPreferences,ModelTasks} from './ModelTasks';
import {readableSettingsError,settingsDocument,type ModelSettings,type ModelSettingsResponse} from '../lib/modelSettings';
import type {Settings} from '../lib/types';
import '../settings.css';

type Props={environment:any;busy:boolean;onBack:()=>void;onUpdate:(value:any)=>void;registerCloseGuard:(handler:()=>boolean)=>()=>void;};
type Section='services'|'tasks'|'preferences'|'environment'|'about';
const sections=[['services','模型服务',Server],['tasks','任务模型',GitBranch],['preferences','生成偏好',SlidersHorizontal],['environment','本机环境',Folder],['about','关于',Info]] as const;

export function EnvironmentSettings({environment,busy,onBack,onUpdate,registerCloseGuard}:Props){
  const [section,setSection]=useState<Section>('services');
  const [version,setVersion]=useState(''),[paths,setPaths]=useState<Settings|null>(null);
  const [source,setSource]=useState<ModelSettingsResponse|null>(null),[draft,setDraft]=useState<ModelSettings|null>(null);
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[confirmClose,setConfirmClose]=useState(false),[reloadAfterDiscard,setReloadAfterDiscard]=useState(false);
  const content=useRef<HTMLDivElement>(null);
  const dirty=!!source&&!!draft&&JSON.stringify(settingsDocument(source))!==JSON.stringify(draft);
  useEffect(()=>registerCloseGuard(()=>{
    if(dirty){setReloadAfterDiscard(false);setConfirmClose(true);return false;}
    return !working;
  }),[dirty,working,registerCloseGuard]);
  const alive=useRef(true);
  const load=useCallback(async()=>{
    setWorking(true);setError('');setMessage('');
    try{
      const [settings,data,v]=await Promise.all([window.manga.settings(),window.manga.run('read_model_settings'),window.manga.appVersion()]);
      if(alive.current){setPaths(settings);setSource(data);setDraft(settingsDocument(data));setVersion(v);}
    }catch(e){if(alive.current)setError(readableSettingsError(e));}
    finally{if(alive.current)setWorking(false);}
  },[]);
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[load]);
  useEffect(()=>{content.current?.scrollTo({top:0});},[section]);
  function update(change:(value:ModelSettings)=>void){
    setDraft(previous=>{if(!previous)return previous;const value=structuredClone(previous);change(value);return value;});
    setMessage('');setError('');
  }
  function close(){if(working)return;if(dirty){setReloadAfterDiscard(false);setConfirmClose(true);}else onBack();}
  async function save(exit=false){
    if(!draft||busy||working)return;
    setWorking(true);setError('');setMessage('');
    try{
      const value:ModelSettingsResponse=await window.manga.run('save_model_settings',{settings:draft});
      if(!alive.current)return;
      setSource(value);setDraft(settingsDocument(value));setMessage('设置已保存');
      try{const env=await window.manga.run('environment');if(alive.current)onUpdate(env);}catch{if(alive.current)setMessage('设置已保存，本机环境状态待重新检测');}
      if(exit)onBack();
    }catch(e){if(alive.current){setConfirmClose(false);setError(readableSettingsError(e));}}
    finally{if(alive.current)setWorking(false);}
  }
  async function check(){
    if(!draft)return;
    setWorking(true);setError('');setMessage('');
    try{const result=await window.manga.run('check_model_settings',{settings:draft});if(alive.current)setMessage(result.message);}
    catch(e){if(alive.current)setError(readableSettingsError(e));}
    finally{if(alive.current)setWorking(false);}
  }
  async function configure(field?:keyof Settings){
    if(dirty){setError('请先保存或放弃模型设置，再更改本机路径。');return;}
    setWorking(true);setError('');setMessage('');
    try{
      if(field){const value=await window.manga.configure(field);if(!value)return;setPaths(value);}
      onUpdate(await window.manga.run('environment'));
      if(field==='env_file'||field==='root'||field==='python')await load();
    }catch(e){setError(readableSettingsError(e));}
    finally{setWorking(false);}
  }
  const checks=[
    ['Python',environment?.python?'已连接':'未连接'],['FFmpeg',environment?.ffmpeg?'已就绪':'未检测到'],
    ['漫画分格 · MAGI',environment?.magi?(environment.magi_weights?'依赖与权重已就绪':'权重待下载'):'依赖待安装'],
    ['本地 OCR',environment?.local_ocr_ready?'已就绪':'依赖或权重待安装'],
  ];
  return <Dialog title="设置" className="settings-dialog model-settings-dialog flex w-[min(1120px,calc(100vw-64px))] flex-col sm:max-w-none gap-0 p-0" onClose={close}>
    <header className="model-settings-header"><h1>设置</h1></header>
    <div className="model-settings-layout">
      <nav className="model-settings-nav" aria-label="设置分类">{sections.map(([key,label,Icon])=><Button key={key} variant="ghost" aria-pressed={section===key} className={section===key?'active':''} onClick={()=>setSection(key)}><Icon size={18}/><span>{label}</span></Button>)}<span className="model-settings-brand">MangaWeaver</span></nav>
      <div ref={content} className="model-settings-content">
        {source?.warnings.map(warning=><p role="status" className="model-settings-warning" key={warning}>{warning}</p>)}
        {!draft&&section!=='environment'&&section!=='about'&&<div className="model-settings-empty"><p>{working?'正在读取本地配置…':'无法读取模型设置'}</p>{!working&&<Button onClick={()=>void load()}>重新读取</Button>}</div>}
        {draft&&section==='services'&&<ModelServices data={draft} providers={source?.providers||[]} update={update} disabled={working}/>}
        {draft&&section==='tasks'&&<ModelTasks data={draft} update={update} disabled={working} onServices={()=>setSection('services')} onPreferences={()=>setSection('preferences')}/>}
        {draft&&section==='preferences'&&<GenerationPreferences data={draft} update={update} disabled={working}/>}
        {section==='environment'&&<div className="environment-settings-body">
          <div className="model-panel-title"><div><h2>本机环境</h2><p>文件路径与本地制作依赖</p></div></div>
          <section><div className="environment-section-heading"><h3>文件与路径</h3></div><p className="environment-hint">路径更改后立即保存。</p>
            <dl className="environment-paths">{([['项目目录','root'],['Python','python'],['FFmpeg 目录','ffmpeg'],['凭据文件','env_file']] as const).map(([label,key])=><div key={key}><dt>{label}</dt><dd title={paths?.[key]}>{paths?.[key]||'读取中…'}</dd><Button size="sm" variant="ghost" disabled={busy||working||!paths} onClick={()=>void configure(key)} aria-label={`更改${label}`}>更改</Button></div>)}</dl>
          </section>
          <section><div className="environment-section-heading"><h3>环境检查</h3><Button variant="ghost" size="sm" disabled={working} onClick={()=>void configure()}><RefreshCw size={14}/>重新检测</Button></div>
            {environment?<dl className="environment-checks">{checks.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:<p className="environment-hint">尚未读取环境，请点击重新检测。</p>}
          </section>
        </div>}
        {section==='about'&&<div className="model-about"><h2>MangaWeaver</h2><p>从漫画分镜到连贯动画。</p><p>版本 {version||'读取中…'}</p></div>}
      </div>
    </div>
    <footer className="model-settings-footer">
      <div className="model-settings-feedback" aria-live="polite">{error?<span role="alert" className="model-settings-error">{error}</span>:<span>{busy?'任务正在运行，结束或停止后可保存':message||'更改仅用于新启动的任务'}</span>}</div>
      <div className="model-settings-actions">
        {error?.includes('其他入口')&&<Button variant="ghost" disabled={working} onClick={()=>{setReloadAfterDiscard(true);setConfirmClose(true);}}>重新读取</Button>}
        {draft&&<><Button variant="outline" disabled={working} onClick={()=>void check()}>{working?'处理中…':'检查格式'}</Button><Button variant="default" disabled={busy||working||!dirty} onClick={()=>void save()}>保存更改</Button></>}
      </div>
    </footer>
    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>有尚未保存的设置</AlertDialogTitle><AlertDialogDescription>保存后用于新启动的任务。放弃更改会丢弃本次设置草稿，已有配置保持不变。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter>
      <AlertDialogCancel>继续编辑</AlertDialogCancel><Button variant="outline" onClick={()=>{setConfirmClose(false);if(reloadAfterDiscard)void load();else onBack();}}>放弃更改</Button><Button variant="default" disabled={busy||working} onClick={()=>void save(true)}>保存并关闭</Button>
    </AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Dialog>;
}
