import { ArrowLeft,BookOpen,Plus } from 'lucide-react';
import { useEffect,useState } from 'react';
import { Media } from '../components/Media';
import { SearchInput } from '../components/SearchInput';
import { Dialog,ToggleGroup } from '../components/controls';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { ToggleGroupItem } from '../components/ui/toggle-group';
import type { MangaMaterial } from '../lib/types';

type Props={busy:boolean;selecting:boolean;onBack:()=>void;onSelect:(material:MangaMaterial)=>Promise<void>;};
export function MaterialLibrary({busy,selecting,onBack,onSelect}:Props){
  const [items,setItems]=useState<MangaMaterial[]>([]),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState('');
  const [kind,setKind]=useState('all');
  const [preview,setPreview]=useState<MangaMaterial|null>(null);
  useEffect(()=>{let active=true;window.manga.materials().then(value=>{if(active)setItems(value);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function importFile(){setWorking(true);setError('');try{const item=await window.manga.importMaterial();if(item)setItems(old=>[item,...old.filter(i=>i.id!==item.id)]);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}}
  async function select(item:MangaMaterial){setWorking(true);setError('');try{await onSelect(item);}catch(e){setError(e instanceof Error?e.message:String(e));setWorking(false);}}
  const visible=items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())&&(kind==='all'||(kind==='page'?item.format==='image':item.format!=='image')));
  return <div className="material-library">
    <header className="material-heading"><div>{selecting&&<Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14}/>返回创作</Button>}<h1>{selecting?'选择漫画':'素材库'}</h1></div><Button disabled={busy||working||loading} onClick={()=>void importFile()}><Plus size={15}/>{working?'处理中…':'导入漫画'}</Button></header>
    <div className="material-filter"><span>{items.length} 部漫画</span><SearchInput label="搜索漫画素材" value={query} onChange={setQuery}/></div>
    <ToggleGroup className="material-kinds" label="漫画类型" value={kind} onValueChange={setKind}>{[["all","全部"],["book","整本漫画"],["page","单页"]].map(([id,label])=><ToggleGroupItem key={id} value={id}>{label}</ToggleGroupItem>)}</ToggleGroup>
    {error&&<p className="material-error" role="alert">{error}</p>}
    {working&&<p className="material-progress" role="status">正在处理本地素材，请稍候…</p>}
    {loading?<div className="material-shelf" role="status" aria-label="正在读取素材库">{[0,1,2].map(i=><Skeleton key={i} className="aspect-[3/4] w-full"/>)}</div>:visible.length?<div className="material-shelf">{visible.map(item=><article className="material-book" key={item.id}>
      <Button variant="ghost" size="sm" className="material-cover h-auto" aria-label={`${selecting?'选择':'预览'}：${item.name}`} disabled={busy||working} onClick={()=>selecting?void select(item):setPreview(item)}><Media path={item.cover} alt={item.name}/><span>{selecting?'选择漫画':'预览漫画'}</span></Button>
      <h2 title={item.name}>{item.name.replace(/\.(mobi|pdf|cbz|png|jpe?g|webp)$/i,'')}</h2><p>{item.pages} 页 · {item.format==='image'?'单页':item.format.toUpperCase()}</p>
    </article>)}</div>:<div className="material-empty"><BookOpen size={30} strokeWidth={1.3}/><p>{query?'没有找到匹配的漫画':'导入漫画，放上你的书架。'}</p>{!query&&<small>支持 MOBI、PDF、CBZ 和单页图片。仅收录你主动导入的素材。</small>}</div>}
    {preview&&!selecting&&<Dialog title={preview.name} className="material-preview" onClose={()=>setPreview(null)}><Media path={preview.cover} alt={preview.name}/><h2>{preview.name}</h2><p>{preview.pages} 页 · {preview.format.toUpperCase()}</p><Button variant="default" disabled={busy||working} onClick={()=>void select(preview)}>用于创作</Button></Dialog>}
  </div>;
}


export function MaterialPicker(props:Omit<Props,'selecting'>){
  return <Dialog className="material-picker w-[min(880px,calc(100vw-80px))] sm:max-w-none p-0" title="选择漫画素材" onClose={props.onBack}>
    <MaterialLibrary {...props} selecting/>
  </Dialog>;
}
