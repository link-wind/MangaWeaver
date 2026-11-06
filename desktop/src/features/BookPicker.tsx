import { useEffect,useRef,useState } from 'react';
import { Media } from '../components/Media';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Pagination,PaginationContent,PaginationItem } from '../components/ui/pagination';
import type { Book } from '../lib/types';

export function pageRange(value:string,max:number):number[] {
  const result=new Set<number>();
  for (const part of value.replaceAll('，',',').split(',')) {
    const match=part.trim().match(/^(\d+)(?:\s*[-～至]\s*(\d+))?$/);
    if (!match) throw new Error('请输入页码或范围，如 2-4,8');
    const start=Number(match[1]),end=Number(match[2]||match[1]);
    if (start<1||end>max||start>end) throw new Error(`文件页序应在 1～${max}`);
    for(let n=start;n<=end;n++) result.add(n);
  }
  return [...result].sort((a,b)=>a-b);
}
export function BookPicker({book,busy,selectedPage,onOpen,onLoad,pageRuns}:{book:Book;busy:boolean;selectedPage?:string;onOpen:(pages:number[])=>void;onLoad:(pages:number[])=>Promise<void>;pageRuns?:Record<string,string>}) {
  const [offset,setOffset]=useState(0),[range,setRange]=useState('1'),[selected,setSelected]=useState<number[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const disabled=busy||loading;
  const loadingWindow=useRef('');
  useEffect(()=>{const number=Number(selectedPage?.replace('page',''))||1;setOffset(Math.floor((number-1)/10)*10);},[book.id,selectedPage]);
  useEffect(()=>{
    const pages=book.pages.slice(offset,offset+10).filter(p=>p.loaded===false).map(p=>p.number);
    const key=`${book.id}:${offset}`;
    if(!pages.length||busy||loadingWindow.current===key)return;
    loadingWindow.current=key;setLoading(true);setError('');
    void onLoad(pages).catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));
  },[book.id,offset,busy]);
  const open=()=>{try{setError('');onOpen(selected.length?selected:pageRange(range,book.page_count));}catch(e){setError((e as Error).message);}};
  return <section className="book-picker nodrag nopan">
    <div className="book-range row"><Input aria-label="展开文件页序范围" value={range} onChange={e=>{setRange(e.target.value);setSelected([]);}} placeholder="2-4,8"/>
      <Button size="sm" disabled={disabled} onClick={open}>{selected.length?`展开所选 ${selected.length} 页`:'展开范围'}</Button>
      <Button size="sm" disabled={disabled} variant="ghost" onClick={()=>{try{const first=pageRange(range,book.page_count)[0];setOffset(Math.floor((first-1)/10)*10);setError('');}catch(e){setError((e as Error).message);}}}>跳转</Button></div>
    {error&&<small className="warning">{error}</small>}
    <div className="book-pages">{book.pages.slice(offset,offset+10).map(p=><Button variant="ghost" size="sm" className="h-auto flex-col" key={p.id} aria-label={`选择文件第 ${p.number} 页`} aria-pressed={selected.includes(p.number)} disabled={disabled}
      onClick={()=>{setSelected(old=>old.includes(p.number)?old.filter(n=>n!==p.number):[...old,p.number]);}}>
      {p.loaded===false?<div className="book-page-placeholder">待加载</div>:<Media path={p.thumbnail} alt={`文件第 ${p.number} 页`}/>}<span>{p.number}{pageRuns?.[`${book.id}:${p.id}`]?' · 已展开':''}</span></Button>)}</div>
    <div className="book-selection-status" role="status">{selected.length?`已选择 ${selected.length} 页`:'单击选择页面，或输入页码范围'}{selected.length>0&&<Button variant="ghost" size="sm" disabled={disabled} onClick={()=>setSelected([])}>清除选择</Button>}</div>
    <Pagination className="book-pagination" aria-label="漫画页面分组"><PaginationContent className="w-full justify-between"><PaginationItem><Button size="sm" variant="ghost" disabled={disabled||offset===0} onClick={()=>setOffset(Math.max(0,offset-10))}>上一组</Button></PaginationItem>
      <PaginationItem><small>{loading?'加载中 · ':''}{offset+1}–{Math.min(offset+10,book.page_count)} / {book.page_count}</small></PaginationItem>
      <PaginationItem><Button size="sm" variant="ghost" disabled={disabled||offset+10>=book.page_count} onClick={()=>setOffset(offset+10)}>下一组</Button></PaginationItem></PaginationContent></Pagination>
  </section>;
}
