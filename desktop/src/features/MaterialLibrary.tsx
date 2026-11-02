import {useEffect,useState} from 'react';
import {ArrowLeft,BookOpen,Plus,Search} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Media} from '../components/Media';
import type {MangaMaterial} from '../lib/types';

type Props={busy:boolean;selecting:boolean;onBack:()=>void;onSelect:(material:MangaMaterial)=>Promise<void>;};
export function MaterialLibrary({busy,selecting,onBack,onSelect}:Props){
  const [items,setItems]=useState<MangaMaterial[]>([]),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;window.manga.materials().then(value=>{if(active)setItems(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function importFile(){setWorking(true);setError('');try{const item=await window.manga.importMaterial();if(item)setItems(old=>[item,...old.filter(i=>i.id!==item.id)]);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}}
  async function select(item:MangaMaterial){setWorking(true);setError('');try{await onSelect(item);}catch(e){setError(e instanceof Error?e.message:String(e));setWorking(false);}}
  const visible=items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="material-library">
    <header className="material-heading"><div>{selecting&&<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14}/>返回创作</Button>}<h1>{selecting?'选择漫画':'素材库'}</h1></div><Button disabled={busy||working||loading} onClick={()=>void importFile()}><Plus size={15}/>{working?'处理中…':'导入漫画'}</Button></header>
    <div className="material-filter"><span>{items.length} 部漫画</span><label className="project-search"><Search size={14}/><input aria-label="搜索漫画素材" placeholder="搜索漫画" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    {error&&<p className="material-error" role="alert">{error}</p>}
    {working&&<p className="material-progress" role="status">正在处理本地素材，请稍候…</p>}
    {loading?<p className="material-empty" role="status">正在读取素材库…</p>:visible.length?<div className="material-shelf">{visible.map(item=><article className="material-book" key={item.id}>
      <button className="material-cover" aria-label={`添加到创作：${item.name}`} disabled={busy||working} onClick={()=>void select(item)}><Media path={item.cover} alt={item.name}/><span>添加到创作</span></button>
      <h2 title={item.name}>{item.name.replace(/\.(mobi|pdf|cbz|png|jpe?g|webp)$/i,'')}</h2><p>{item.pages} 页 · {item.format==='image'?'单页':item.format.toUpperCase()}</p>
    </article>)}</div>:<div className="material-empty"><BookOpen size={30} strokeWidth={1.3}/><p>{query?'没有找到匹配的漫画':'导入漫画，放上你的书架。'}</p>{!query&&<small>支持 MOBI、PDF、CBZ 和单页图片。仅收录你主动导入的素材。</small>}</div>}
  </div>;
}
