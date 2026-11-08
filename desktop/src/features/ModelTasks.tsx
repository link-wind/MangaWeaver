import {ArrowUpRight,Info,Lock} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Select} from '../components/controls';
import {SelectItem} from '../components/ui/select';
import {Disclosure} from '../components/Disclosure';
import {type ModelKind,type ModelSettings,taskServices} from '../lib/modelSettings';

type Props={data:ModelSettings;update:(change:(draft:ModelSettings)=>void)=>void;disabled:boolean;onServices:()=>void;onPreferences:()=>void;};
export function ModelTasks({data,update,disabled,onServices,onPreferences}:Props){
  const text=data.services.find(s=>s.id===data.tasks.text.service);
  function choose(kind:ModelKind,id:string){
    const channel=data.services.find(s=>s.id===id)?.channels[kind];
    update(draft=>{
      draft.tasks[kind]={service:id,model:channel?.models[0]?.id||''};
      if(kind==='text')draft.tasks.review=channel?.models[0]?.id||'';
    });
  }
  const rows=[
    ['text','创作与规划','Agent · 脚本 · 编排 · 演出'],
    ['image','关键画面生成','参考图生图与关键帧'],
    ['review','视频审查','多模态内容与连续性检查'],
    ['video','视频生成','镜头生成与原生声音'],
  ] as const;
  return <>
    <div className="model-panel-title"><div><h2>任务模型</h2><p>为制作流程选择服务与模型</p></div></div>
    <div className="model-task-table">
      <div className="model-task-head"><span/><span>服务</span><span>模型</span></div>
      {rows.map(([key,title,hint])=>{
        const review=key==='review',kind=review?'text':key;
        const choice=data.tasks[kind];
        const service=data.services.find(s=>s.id===choice.service);
        const options=taskServices(data,kind);
        if(service&&!options.some(s=>s.id===service.id))options.unshift(service);
        const models=service?.channels[kind]?.models||[];
        return <div className="model-task-row" key={key}>
          <div><h3>{title}</h3><p>{hint}</p>{key==='video'&&<Button size="sm" variant="link" onClick={onPreferences}>查看输出参数<ArrowUpRight size={13}/></Button>}</div>
          {review?<div className="model-inherited"><span>{text?'沿用创作服务':'先配置创作服务'}</span><Lock size={13}/></div>:<Select value={choice.service||'__empty'} label={`${title}服务`} disabled={disabled} onValueChange={id=>choose(kind,id)}>
            {!choice.service&&<SelectItem value="__empty" disabled>选择已配置的服务</SelectItem>}
            {options.map(s=><SelectItem key={s.id} value={s.id}>{s.name} · {kind==='text'?'文本':kind==='image'?'图像':'视频'}</SelectItem>)}
            {!options.length&&<SelectItem value="__unconfigured" disabled>请先配置服务凭据</SelectItem>}
          </Select>}
          <Select value={(review?data.tasks.review:choice.model)||'__empty'} label={`${title}模型`} disabled={disabled||!service||!models.length} onValueChange={value=>update(draft=>{if(review)draft.tasks.review=value;else draft.tasks[kind].model=value;})}>
            {!models.some(m=>m.id===(review?data.tasks.review:choice.model))&&<SelectItem value="__empty" disabled>选择模型</SelectItem>}
            {models.map(m=><SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </Select>
        </div>;
      })}
    </div>
    <div className="model-task-note"><span><Info size={15}/>未配置的服务不会出现在候选中</span><Button variant="link" size="sm" onClick={onServices}>管理模型服务 →</Button></div>
  </>;
}

type PreferenceProps=Pick<Props,'data'|'update'|'disabled'>;
export function GenerationPreferences({data,update,disabled}:PreferenceProps){
  const p=data.preferences;
  const change=(key:string,value:string|number)=>update(draft=>{draft.preferences[key]=value;});
  const number=(key:string,label:string,min:number,step=1)=><label key={key}><span>{label}</span><Input aria-label={label} type="number" value={p[key]} min={min} step={step} disabled={disabled} onChange={e=>change(key,e.target.value)}/></label>;
  const select=(key:string,label:string,values:string[])=><label key={key}><span>{label}</span><Select value={String(p[key])} label={label} disabled={disabled} onValueChange={v=>change(key,v)}>{values.map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</Select></label>;
  return <>
    <div className="model-panel-title"><div><h2>生成偏好</h2><p>沿用现有制作参数，显式控制输出与迭代。</p></div></div>
    <section className="model-preferences-section"><h3>输出</h3><div className="model-preferences-grid">
      {number('target_duration','目标时长（秒，0为按内容规划）',0,.5)}
      <label><span>图像尺寸</span><Input value={p.image_size} aria-label="图像尺寸" placeholder="1536x864" disabled={disabled} onChange={e=>change('image_size',e.target.value)}/></label>
      {select('image_quality','图像质量',['low','medium','high','auto'])}
      {select('resolution','视频分辨率',['480P','768P','2K'])}
    </div><p className="model-field-hint">分辨率须与当前视频渠道和型号匹配；保存不会自动换用模型。</p></section>
    <section className="model-preferences-section"><h3>候选与审查</h3><div className="model-preferences-grid">
      {number('num_scripts','脚本候选',1)}{number('num_shot_plans','镜头编排候选',1)}
      {number('num_directions','演出候选',1)}{number('num_storyboards','关键画面候选',1)}
      {number('num_video_candidates','视频候选',1)}{number('iterations','审查迭代轮次',1)}
    </div></section>
    <Disclosure title="高级参数" className="model-preferences-advanced"><div className="model-preferences-grid">
      {number('poll_interval','查询间隔（秒）',.1,.1)}{number('poll_timeout','查询超时（秒）',1)}
      {select('video_upload_provider','幻灵素材上传方式',['kie','uguu'])}
      {select('huanling_text_api','幻灵文本接口',['native','compatible'])}
      {select('huanling_text_transport','幻灵文本传输',['requests','curl'])}
      {select('huanling_image_transport','幻灵图像传输',['requests','curl'])}
      {select('huanling_video_transport','幻灵视频传输',['requests','curl'])}
    </div><p className="model-field-hint">Kie上传需对应凭据；uguu为临时匿名托管。仅在正式任务启动后上传素材。</p></Disclosure>
  </>;
}
