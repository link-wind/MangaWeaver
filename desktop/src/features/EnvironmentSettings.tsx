import {useEffect,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {Button} from '../components/ui/button';
import type {Settings} from '../lib/types';

type Props={environment:any;busy:boolean;onBack:()=>void;onUpdate:(value:any)=>void;};
export function EnvironmentSettings({environment,busy,onBack,onUpdate}:Props){
  const [paths,setPaths]=useState<Settings|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;window.manga.settings().then(value=>{if(active)setPaths(value);}).catch(()=>{if(active)setError('无法读取本地路径，请关闭设置后重试。');});return()=>{active=false;};},[]);
  async function update(choose=false){
    setWorking(true);setError('');
    try{
      if(choose){const value=await window.manga.configure();if(!value)return;setPaths(value);}
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
  return <section className="environment-settings" aria-label="本地环境设置">
    <div className="environment-settings-heading"><Button variant="ghost" size="sm" onClick={onBack} disabled={working}><ArrowLeft size={15}/>返回</Button><h1>设置</h1></div>
    <div className="environment-settings-body">
      <section><div className="environment-section-heading"><h2>本地环境</h2><Button size="sm" disabled={busy||working} onClick={()=>void update(true)}>{working?'处理中…':'更改路径'}</Button></div>
        <p className="environment-hint">依次选择项目目录、Python、FFmpeg 和 .env。密钥仅保存在本机。</p>
        <dl className="environment-paths">{([['项目目录','root'],['Python','python'],['FFmpeg 目录','ffmpeg'],['凭据文件','env_file']] as const).map(([label,key])=><div key={key}><dt>{label}</dt><dd>{paths?.[key]||'读取中…'}</dd></div>)}</dl>
      </section>
      <section><div className="environment-section-heading"><h2>环境检查</h2><Button variant="ghost" size="sm" disabled={busy||working} onClick={()=>void update()}><RefreshCw size={14}/>重新检测</Button></div>
        {environment?<dl className="environment-checks">{checks.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:<p className="environment-hint">尚未读取环境，请点击重新检测。</p>}
      </section>
      {busy&&<p className="environment-hint" role="status">任务正在运行，结束或停止后可更改环境。</p>}
      {error&&<p className="environment-error" role="alert">{error}</p>}
    </div>
  </section>;
}
