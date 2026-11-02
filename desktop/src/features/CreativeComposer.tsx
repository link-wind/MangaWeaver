import {useEffect,useRef} from 'react';
import {Send,MousePointer2,Plus,X,Image} from 'lucide-react';
import {Button} from '../components/ui/button';
import type {CanvasReference} from '../lib/types';
import {useDetailsMenus} from '../lib/useDetailsMenus';

export function CreativeComposer(props:{target:string;permission:string;onPermission:(value:string)=>void;
  draft:string;onDraft:(value:string)=>void;onSend:()=>void;busy:boolean;disabled:boolean;simulation:boolean;
  delivery:'steer'|'follow_up';onDelivery:(value:'steer'|'follow_up')=>void;
  references:CanvasReference[];onRemoveReference:(id:string)=>void;onAddReference:(purpose:'target'|'reference')=>void;
  referenceError?:string;}){
  const input=useRef<HTMLTextAreaElement>(null),menu=useRef<HTMLDetailsElement>(null);
  const root=useDetailsMenus<HTMLDivElement>();
  useEffect(()=>{if(input.current){input.current.style.height='0px';input.current.style.height=Math.max(72,Math.min(180,input.current.scrollHeight))+'px';}},[props.draft]);
  function add(purpose:'target'|'reference'){menu.current?.removeAttribute('open');props.onAddReference(purpose);input.current?.focus();}
  return <div ref={root} className="canvas-reply text-composer">
    <div className="reply-target"><MousePointer2 size={13}/><span title={props.target}>{props.target}</span>
      <select aria-label="对话权限" title="允许创作对话调用哪些制作能力" disabled={props.busy||props.disabled} value={props.permission} onChange={e=>props.onPermission(e.target.value)}>
        <option value="none">仅对话</option><option value="planning">可规划</option><option value="images">可规划与生图</option><option value="video">可完整制作</option>
      </select></div>
    {!!props.references.length&&<div className="composer-references">{props.references.map(ref=><span className="reference-chip" key={ref.id} title={ref.run}>
      <small>{ref.purpose==='target'?'目标':'参考'}</small>{ref.label}<button aria-label={`移除引用 ${ref.label}`} onClick={()=>props.onRemoveReference(ref.id)}><X size={11}/></button></span>)}</div>}
    {props.referenceError&&<small className="reference-error" role="alert">{props.referenceError}</small>}
    <textarea ref={input} rows={3} maxLength={20000} aria-label="画布修改要求" disabled={props.disabled} placeholder={props.simulation?'本地示例，不调用模型':props.busy?'补充要求，或询问当前进度…':'想怎样改编或修改？'} value={props.draft} onChange={e=>props.onDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();if(!props.disabled&&props.draft.trim())props.onSend();}}}/>
    <div className="reply-actions"><div className="composer-tools">
      <details data-menu className="composer-add" ref={menu}><summary aria-label="添加画布引用" title="添加画布引用" aria-disabled={props.disabled} onClick={e=>{if(props.disabled)e.preventDefault();}}><Plus size={17}/></summary><div className="composer-menu">
        <button disabled={props.disabled} onClick={()=>add('target')}><MousePointer2 size={14}/>加入选中项为目标</button>
        <button disabled={props.disabled} onClick={()=>add('reference')}><Image size={14}/>加入选中项为参考</button>
      </div></details>
      {props.busy?<select aria-label="消息送达方式" value={props.delivery} onChange={e=>props.onDelivery(e.target.value as 'steer'|'follow_up')}><option value="steer">调整当前任务</option><option value="follow_up">完成后处理</option></select>:<small>{props.simulation?'本地示例':'⌘ / Ctrl + Enter'}</small>}
    </div>
      <Button variant="default" size="icon" title={props.busy?'发送要求':'发送给创作 Agent'} disabled={props.disabled||!props.draft.trim()} onClick={props.onSend}><Send size={15}/></Button>
    </div>
  </div>;
}
