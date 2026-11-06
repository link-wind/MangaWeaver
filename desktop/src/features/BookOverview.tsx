import {ArrowRight,BookOpen,Check,ChevronLeft,ChevronRight,LoaderCircle,Play} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {Media} from '../components/Media';
import {Button} from '../components/ui/button';
import {Checkbox} from '../components/ui/checkbox';
import {Input} from '../components/ui/input';
import {Select} from '../components/controls';
import {SelectItem} from '../components/ui/select';
import {pageStatus,type PageStatus} from '../lib/bookWorkspace';
import type {AgentSession} from '../lib/types';
import {pageRange} from './BookPicker';

type Props={session:AgentSession;visible:boolean;selected:number[];onSelected:(pages:number[])=>void;onOpen:(page:number)=>void;
  onLoad:(pages:number[])=>Promise<void>;onProduce:(pages:number[])=>void;busy:boolean;ready:boolean};
export function BookOverview(p:Props){
  const book=p.session.book!;
  const [offset,setOffset]=useState(0),[range,setRange]=useState(''),[filter,setFilter]=useState('all');
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const anchor=useRef<number|null>(null);
  const loadRef=useRef(p.onLoad);loadRef.current=p.onLoad;
  const pages=book.pages.filter(page=>filter==='all'||pageStatus(p.session,page.id)===filter);
  const maxOffset=Math.max(0,Math.floor((pages.length-1)/10)*10),start=Math.min(offset,maxOffset);
  const visible=pages.slice(start,start+10);
  const loadKey=visible.filter(page=>page.loaded===false).map(page=>page.number).join(',');
  useEffect(()=>{
    if(!p.visible||!loadKey){setLoading(false);return;}
    let live=true;setLoading(true);setError('');
    void loadRef.current(loadKey.split(',').map(Number)).catch(e=>{if(live)setError((e as Error).message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[book.id,loadKey,p.visible]);
  function select(number:number,shift=false){
    if(shift&&anchor.current!==null){
      const lower=Math.min(anchor.current,number),upper=Math.max(anchor.current,number);
      p.onSelected([...new Set([...p.selected,...book.pages.filter(page=>page.number>=lower&&page.number<=upper).map(page=>page.number)])].sort((a,b)=>a-b));
    }else{p.onSelected(p.selected.includes(number)?p.selected.filter(n=>n!==number):[...p.selected,number].sort((a,b)=>a-b));anchor.current=number;}
  }
  function useRange(selectRange:boolean){
    try{
      const numbers=pageRange(range,book.page_count);setError('');
      if(selectRange)p.onSelected(numbers);
      setFilter('all');setOffset(Math.floor((numbers[0]-1)/10)*10);
    }catch(e){setError((e as Error).message);}
  }
  return <section className="book-overview" hidden={!p.visible} aria-label="全书总览">
    <header className="book-overview-heading"><div><h1>{book.name.replace(/\.(mobi|cbz|zip|pdf)$/i,'')}</h1><span>{book.page_count} 页 · 文件页序</span></div><BookOpen size={21}/></header>
    <div className="book-overview-tools">
      <Select label="页面状态筛选" value={filter} onValueChange={value=>{setFilter(value);setOffset(0);}}>
        <SelectItem value="all">全部页面</SelectItem>{(['未开始','制作中','需处理','已有成片','已有进度'] as PageStatus[]).map(status=><SelectItem key={status} value={status}>{status}</SelectItem>)}
      </Select>
      <form onSubmit={event=>{event.preventDefault();useRange(false);}}><Input aria-label="文件页序或范围" placeholder="页码或范围，如 94-96" value={range} onChange={event=>setRange(event.target.value)}/>
        <Button type="submit" variant="ghost" size="sm">跳转</Button><Button variant="ghost" size="sm" type="button" disabled={!range.trim()} onClick={()=>useRange(true)}>选择范围</Button></form>
    </div>
    {error&&<p className="book-overview-error" role="alert">{error}<Button variant="ghost" size="sm" onClick={()=>void p.onLoad(visible.filter(page=>page.loaded===false).map(page=>page.number)).then(()=>setError('')).catch(e=>setError((e as Error).message))}>重试加载</Button></p>}
    <div className="book-overview-scroll">
      {!visible.length&&<p className="book-overview-empty">没有符合状态的页面。</p>}
      <div className="book-overview-grid">{visible.map(page=>{
        const selected=p.selected.includes(page.number),status=pageStatus(p.session,page.id);
        return <article className={`book-overview-page ${selected?'is-selected':''}`} key={page.id}>
          <div className="book-page-cover">
            <button className="book-page-preview" aria-label={`选择文件第 ${page.number} 页`} aria-pressed={selected}
              onClick={event=>select(page.number,event.shiftKey)} onDoubleClick={()=>p.onOpen(page.number)}>
              {page.loaded===false?<span className="book-page-loading">{loading?<LoaderCircle size={18} className="runtime-spin"/>: <BookOpen size={20}/>}</span>:<Media path={page.thumbnail} alt={`文件第 ${page.number} 页`}/>}
            </button>
            <Checkbox checked={selected} aria-label={`勾选文件第 ${page.number} 页`} onCheckedChange={()=>select(page.number)}/>
            <Button size="sm" variant="secondary" className="book-open-page" onClick={()=>p.onOpen(page.number)}>打开页面<ArrowRight size={12}/></Button>
          </div>
          <div className="book-page-caption"><span>第 {String(page.number).padStart(3,'0')} 页</span><small data-status={status}>{status==='已有成片'&&<Check size={11}/ >}{status}</small></div>
        </article>;
      })}</div>
    </div>
    <footer className="book-overview-pagination"><span>{pages.length?`${start+1}–${Math.min(start+10,pages.length)}`:'0'} / {pages.length} 页{loading?' · 加载中':''}</span>
      <div><Button variant="ghost" size="icon-sm" aria-label="上一组页面" disabled={start===0} onClick={()=>setOffset(start-10)}><ChevronLeft size={16}/></Button>
        <Button variant="ghost" size="icon-sm" aria-label="下一组页面" disabled={start>=maxOffset} onClick={()=>setOffset(start+10)}><ChevronRight size={16}/></Button></div>
    </footer>
    {!!p.selected.length&&<div className="book-selection-bar" role="region" aria-label="所选制作范围"><span>已选 {p.selected.length} 页</span>
      <Button variant="ghost" size="sm" onClick={()=>p.onSelected([])}>取消选择</Button><span className="book-selection-spacer"/>
      <Button variant="outline" size="sm" onClick={()=>p.onOpen(p.selected[0])}>打开第 {p.selected[0]} 页</Button>
      <Button size="sm" disabled={p.busy||!p.ready} onClick={()=>p.onProduce(p.selected)}><Play size={12}/>制作所选 {p.selected.length} 页</Button>
    </div>}
  </section>;
}
