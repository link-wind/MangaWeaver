import { RefreshCw } from 'lucide-react';
import { useEffect,useState } from 'react';
import { Dialog } from '../components/controls';
import { Button } from '../components/ui/button';
import { Tabs,TabsContent,TabsList,TabsTrigger } from '../components/ui/tabs';
import type { Settings } from '../lib/types';

type Props={environment:any;busy:boolean;onBack:()=>void;onUpdate:(value:any)=>void;};
export function EnvironmentSettings({environment,busy,onBack,onUpdate}:Props){
  const [section,setSection]=useState<'environment'|'about'>('environment');
  const [version,setVersion]=useState('');
  useEffect(()=>{let active=true;window.manga.appVersion().then(value=>{if(active)setVersion(value);}).catch(()=>{if(active)setVersion('读取失败');});return()=>{active=false;};},[]);
  const [paths,setPaths]=useState<Settings|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;window.manga.settings().then(value=>{if(active)setPaths(value);}).catch(()=>{if(active)setError('无法读取本地路径，请重新进入设置后重试。');});return()=>{active=false;};},[]);
  async function update(field?:keyof Settings){
    setWorking(true);setError('');
    try{
      if(field){const value=await window.manga.configure(field);if(!value)return;setPaths(value);}
      onUpdate(await window.manga.run('environment'));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setWorking(false);}
  }
  const checks=[
    ['Python',environment?.python?'已连接':'未连接'],
    ['FFmpeg',environment?.ffmpeg?'已就绪':'未检测到'],
    ['漫画分格 · MAGI',environment?.magi?(environment.magi_weights?'依赖与权重已就绪':'权重待下载'):'依赖待安装'],
    ['本地 OCR',environment?.local_ocr_ready?'已就绪':'依赖或权重待安装'],
    ['文本凭据',environment?.text_credential?'已配置':'未配置'],
  ];
  return <Dialog title="设置" className="settings-dialog flex w-[min(880px,calc(100vw-64px))] flex-col sm:max-w-none gap-0 p-0" onClose={onBack}>
      <header className="environment-settings-heading"><h1>设置</h1></header>
      <Tabs value={section} onValueChange={value=>setSection(value as 'environment'|'about')} className="min-h-0 flex-1">
      <TabsList variant="line" className="settings-categories" aria-label="设置分类">
        <TabsTrigger value="environment">本机环境</TabsTrigger>
        <TabsTrigger value="about">关于</TabsTrigger>
      </TabsList>
      <div className="settings-content">
        <TabsContent value="about" className="environment-settings-body"><h2>MangaWeaver</h2><p>版本 {version||'读取中…'}</p><p className="environment-hint">从漫画分镜到连贯动画。</p></TabsContent>
        <TabsContent value="environment" className="environment-settings-body">
          <section aria-labelledby="settings-paths-title"><div className="environment-section-heading"><h2 id="settings-paths-title">文件与路径</h2></div>
            <p className="environment-hint">更改后自动保存。密钥仅保存在本机。</p>
            <dl className="environment-paths">{([['项目目录','root'],['Python','python'],['FFmpeg 目录','ffmpeg'],['凭据文件','env_file']] as const).map(([label,key])=><div key={key}><dt>{label}</dt><dd title={paths?.[key]}>{paths?.[key]||'读取中…'}</dd><Button size="sm" variant="ghost" disabled={busy||working||!paths} onClick={()=>void update(key)} aria-label={`更改${label}`}>更改</Button></div>)}</dl>
          </section>
          <section aria-labelledby="settings-checks-title"><div className="environment-section-heading"><h2 id="settings-checks-title">环境检查</h2><Button variant="ghost" size="sm" disabled={busy||working} onClick={()=>void update()}><RefreshCw size={14}/>重新检测</Button></div>
            {environment?<dl className="environment-checks">{checks.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:<p className="environment-hint">尚未读取环境，请点击重新检测。</p>}
          </section>
          {busy&&<p className="environment-hint" role="status">任务正在运行，结束或停止后可更改环境。</p>}
          {error&&<p className="environment-error" role="alert">{error}</p>}
        </TabsContent>
    </div>
    </Tabs>
  </Dialog>;
}
