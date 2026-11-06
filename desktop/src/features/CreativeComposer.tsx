import {ArrowUp,AtSign,ChevronDown,Image,ImagePlus,Plus,X} from 'lucide-react';
import {useEffect,useRef} from 'react';
import {Media} from '../components/Media';
import {ActionMenu,Select,Tooltip} from '../components/controls';
import {Button} from '../components/ui/button';
import {DropdownMenuItem} from '../components/ui/dropdown-menu';
import {InputGroup,InputGroupAddon,InputGroupTextarea} from '../components/ui/input-group';
import {Popover,PopoverContent,PopoverTrigger} from '../components/ui/popover';
import {SelectItem} from '../components/ui/select';
import {referenceLabel} from '../lib/presentation';
import type {CanvasReference} from '../lib/types';

type Props={saveStatus:string;canSave:boolean;onSave:()=>void;target:string;permission:string;onPermission:(value:string)=>void;
  draft:string;onDraft:(value:string)=>void;onSend:()=>void;busy:boolean;disabled:boolean;simulation:boolean;
  delivery:'steer'|'follow_up';onDelivery:(value:'steer'|'follow_up')=>void;
  references:CanvasReference[];onRemoveReference:(id:string)=>void;onAddReference:(purpose:'target'|'reference')=>void;
  referenceError?:string;model?:string;referenceImages?:Record<string,string>;projectPath?:string};

export function CreativeComposer(props:Props) {
  const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(input.current){input.current.style.height='0px';input.current.style.height=Math.max(66,Math.min(160,input.current.scrollHeight))+'px';}},[props.draft]);
  function addReference(purpose:'target'|'reference'){props.onAddReference(purpose);}
  function referenceImage(reference:CanvasReference){
    const image=props.referenceImages?.[reference.id]||(reference.kind==='image'?reference.path:'');
    return image&&!image.startsWith('/')&&props.projectPath?`${props.projectPath}/${image}`:image;
  }
  const modelLabel=props.model?.replace(/^gemini-/i,'Gemini ').replace(/-/g,' ').replace(/\bflash\b/i,'Flash').replace(/\bpro\b/i,'Pro')||'当前模型';
  return <div className="composer-wrap">
    <InputGroup className="canvas-reply w-full flex-col items-stretch rounded-[13px] p-2.5 shadow-none" title={props.saveStatus||undefined}>
      {!!props.references.length&&<div className="composer-references" aria-label="对话引用">{props.references.map(reference=><span className="reference-chip" key={reference.id} title={referenceLabel(reference)}>
        {referenceImage(reference)?<Media path={referenceImage(reference)} alt="" className="reference-thumbnail"/>:reference.kind==='video'?<Image size={13}/>:<ImagePlus size={13}/>}
        <span>{referenceLabel(reference)}</span><button aria-label={`移除引用 ${reference.label}`} disabled={props.disabled} onClick={()=>props.onRemoveReference(reference.id)}><X size={10}/></button>
      </span>)}</div>}
      {props.referenceError&&<small className="reference-error" role="alert">{props.referenceError}</small>}
      <InputGroupTextarea className="min-h-0 flex-none px-0.5 py-2.5 text-[14px] font-normal leading-[1.8]" ref={input} rows={3} maxLength={20000} aria-label="画布修改要求" disabled={props.disabled}
        placeholder={props.simulation?'本地示例，不调用模型':props.busy?'补充要求，或询问当前进度…':'描述你想调整的画面或节奏…'} value={props.draft}
        onChange={event=>props.onDraft(event.target.value)}
        onKeyDown={event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.nativeEvent.isComposing){event.preventDefault();if(!props.disabled&&props.draft.trim())props.onSend();}}}/>
      {props.saveStatus.includes('失败')&&<div className="draft-status" role="alert"><span>{props.saveStatus}</span><Button variant="ghost" size="sm" disabled={!props.canSave||props.disabled} onClick={props.onSave}>重试保存</Button></div>}
      <InputGroupAddon align="block-end" className="reply-actions justify-between px-0 py-0 font-normal">
        <div className="composer-tools">
          <ActionMenu label="添加画布引用" trigger={<Plus size={17}/>} size="icon" disabled={props.disabled}>
            <DropdownMenuItem onSelect={()=>addReference('target')}><ImagePlus size={14}/>加入选中项为目标</DropdownMenuItem>
            <DropdownMenuItem onSelect={()=>addReference('reference')}><ImagePlus size={14}/>加入选中项为参考</DropdownMenuItem>
          </ActionMenu>
          <Tooltip label="引用画布节点"><Button variant="ghost" size="icon" aria-label="引用画布节点" disabled={props.disabled} onClick={()=>addReference('target')}><AtSign size={16}/></Button></Tooltip>
          <Popover><PopoverTrigger asChild><Button variant="ghost" className="composer-model" aria-label="模型与创作权限" title={props.model?`当前规划与评审模型：${props.model}`:undefined}>{modelLabel}<ChevronDown size={10}/></Button></PopoverTrigger>
            <PopoverContent align="start" className="composer-options w-64"><p>当前模型</p><span>{props.model||'尚未读取模型配置'}</span>
              <label>创作权限<Select label="对话权限" disabled={props.busy||props.disabled} value={props.permission} onValueChange={props.onPermission}>
              <SelectItem value="none">仅对话</SelectItem><SelectItem value="planning">可规划</SelectItem><SelectItem value="images">可规划与生图</SelectItem><SelectItem value="video">可完整制作</SelectItem>
              </Select></label>
              {props.busy&&<label>运行中消息<Select label="消息送达方式" value={props.delivery} onValueChange={value=>props.onDelivery(value as 'steer'|'follow_up')}>
              <SelectItem value="steer">调整当前任务</SelectItem><SelectItem value="follow_up">完成后处理</SelectItem>
              </Select></label>}
            </PopoverContent>
          </Popover>
        </div>
        <div className="composer-right">
          <Tooltip label={props.busy?(props.delivery==='steer'?'发送：引导当前任务':'排队：本轮结束后处理'):'发送给创作 Agent'}>
            <Button variant="default" size="icon" className="composer-send" aria-label="发送给创作 Agent" disabled={props.disabled||!props.draft.trim()} onClick={props.onSend}><ArrowUp size={16}/></Button>
          </Tooltip>
        </div>
      </InputGroupAddon>
    </InputGroup>
    <div className="composer-bottom-note"><span>{props.references.some(reference=>reference.purpose==='target')?'仅修改引用的目标':props.simulation?'本地示例':props.target!=='当前漫画页'?`当前引用：${props.target}`:'选择画布节点可定点修改'}</span><span>⌘ / Ctrl ↵ 发送</span></div>
  </div>;
}
