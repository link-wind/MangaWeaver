import {useRef,useState} from 'react';
import {Box,Check,ChevronRight,CircleCheck,CircleX,Eye,EyeOff,Hexagon,Layers3,LoaderCircle,Play,Plus,Search,Server,Sparkles,Trash2,Waves} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Dialog,Select,ToggleGroup} from '../components/controls';
import {SelectItem} from '../components/ui/select';
import {ToggleGroupItem} from '../components/ui/toggle-group';
import {Disclosure} from '../components/Disclosure';
import type {ModelEntry,ModelKind,ModelProvider,ModelService,ModelSettings,ModelTestResult} from '../lib/modelSettings';
import {hasCredential,kindLabels,readableSettingsError} from '../lib/modelSettings';

type Props={data:ModelSettings;providers:ModelProvider[];update:(change:(draft:ModelSettings)=>void)=>void;disabled:boolean;};
type TestState={scope:string;model:string;status:'running'|'success'|'error';message:string;elapsed?:number;billable?:boolean;};
const providerIcons:Record<string,typeof Box>={huanling:Box,gemini:Sparkles,kie:Layers3,ciyuan:Hexagon,minimax:Waves};
function scopeHash(value:string){
  let hash=2166136261;
  for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);
  return (hash>>>0).toString(36);
}
export function ModelServices({data,providers,update,disabled}:Props){
  const [selected,setSelected]=useState(data.tasks.text.service||data.services[0]?.id||'');
  const [kind,setKind]=useState<ModelKind>('text'),[search,setSearch]=useState(''),[showKey,setShowKey]=useState(false);
  const [adding,setAdding]=useState(false),[providerId,setProviderId]=useState('huanling'),[connectionName,setConnectionName]=useState('');
  const [editing,setEditing]=useState<number|null>(null),[model,setModel]=useState<ModelEntry>({name:'',id:''});
  const [test,setTest]=useState<TestState|null>(null);
  const testRun=useRef(0);
  const service=data.services.find(s=>s.id===selected)||data.services[0];
  const provider=providers.find(p=>p.id===service?.provider);
  const activeKind=service?.channels[kind]?kind:provider?.kinds[0]||'text';
  const channel=service?.channels[activeKind];
  const testScope=scopeHash([service?.id,activeKind,channel?.base_url,channel?.credential_set,channel?.api_key,channel?.models.map(m=>`${m.id}:${m.name}`).join('|')].join('\u0000'));
  const currentTest=test?.scope===testScope?test:null;
  const testing=currentTest?.status==='running';
  const testedModel=currentTest?channel?.models.find(m=>m.id===currentTest.model):undefined;
  function invalidateTest(){testRun.current++;setTest(null);}
  function change(action:(entry:ModelService)=>void){if(service){invalidateTest();update(draft=>{action(draft.services.find(s=>s.id===service.id)!);});}}
  function select(id:string){invalidateTest();setSelected(id);setShowKey(false);setEditing(null);}
  function add(){
    const entry=providers.find(p=>p.id===providerId)!;
    const id=`${entry.id}-${crypto.randomUUID().slice(0,8)}`;
    update(draft=>draft.services.push({id,provider:entry.id,name:connectionName.trim()||entry.name,channels:Object.fromEntries(entry.kinds.map(type=>[type,{base_url:entry.base_url,models:[],credential_set:false}]))}));
    select(id);setKind(entry.kinds[0]);setAdding(false);setConnectionName('');
  }
  const inUse=(id:string)=>Object.values(data.tasks).some(v=>typeof v==='object'&&v.service===id);
  function saveModel(){
    if(!model.id.trim()||!model.name.trim()||!channel)return;
    invalidateTest();
    update(draft=>{const entry=draft.services.find(s=>s.id===service!.id)!;const list=entry.channels[activeKind]!.models;
      const previous=editing!==null&&editing>=0?list[editing]:null;
      const value={id:model.id.trim(),name:model.name.trim()};
      if(editing===-1)list.push(value);else if(editing!==null)list[editing]=value;
      // 当前被任务引用的模型ID编辑后同步引用，不留下悬空选择。
      if(previous)for(const key of ['text','image','video'] as const){
        if(draft.tasks[key].service===entry.id&&draft.tasks[key].model===previous.id)
          draft.tasks[key].model=value.id;
      }
      if(previous&&draft.tasks.text.service===entry.id&&draft.tasks.review===previous.id)
        draft.tasks.review=value.id;
    });
    setEditing(null);
  }
  async function testModel(entry:ModelEntry){
    if(!service||!channel||disabled||testing||!hasCredential(channel))return;
    const scope=testScope,run=++testRun.current;
    setTest({scope,model:entry.id,status:'running',message:`正在请求 ${entry.name}`});
    try{
      const result:ModelTestResult=await window.manga.run('test_model_settings',{settings:data,service:service.id,kind:activeKind,model:entry.id});
      if(run===testRun.current)setTest({scope,model:entry.id,status:'success',message:result.message,elapsed:result.elapsed_ms,billable:result.billable_submission});
    }catch(error){
      if(run===testRun.current)setTest({scope,model:entry.id,status:'error',message:readableSettingsError(error)});
    }
  }
  return <>
    <div className="model-panel-title"><div><h2>模型服务</h2><p>配置接入服务与可用模型</p></div><Button variant="outline" onClick={()=>setAdding(true)} disabled={disabled}><Plus/>添加服务</Button></div>
    <div className="model-service-panel">
      <aside className="model-service-list" aria-label="模型服务列表">
        <div className="model-service-search"><Search size={15}/><Input aria-label="搜索服务" value={search} placeholder="搜索服务" onChange={e=>setSearch(e.target.value)}/></div>
        <div className="model-service-entries">{data.services.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())).map(s=>{const Icon=providerIcons[s.provider]||Box;return <Button key={s.id} variant="ghost" className={`model-service-item ${s.id===service?.id?'active':''}`} onClick={()=>select(s.id)}><Icon size={19}/><span><strong>{s.name}</strong><small>{Object.keys(s.channels).map(k=>kindLabels[k as ModelKind]).join(' · ')}</small></span></Button>;})}
        {!data.services.some(s=>s.name.toLowerCase().includes(search.toLowerCase()))&&<p className="model-empty">没有匹配的服务</p>}</div>
      </aside>
      {service&&channel?<section className="model-service-detail" aria-label="连接详情">
        <div className="model-detail-title"><h3>{service.name}</h3><span className={`model-config-state ${currentTest?.status||''}`}>{testing?'测试中':currentTest?.status==='success'?'接口可用':currentTest?.status==='error'?'测试失败':hasCredential(channel)?'已配置 · 未验证':'未配置'}</span></div>
        <ToggleGroup value={activeKind} onValueChange={value=>{invalidateTest();setKind(value as ModelKind);setEditing(null);setShowKey(false);}} label="接口类型" className="model-kind-tabs">{provider?.kinds.map(type=><ToggleGroupItem key={type} value={type}>{kindLabels[type]}</ToggleGroupItem>)}</ToggleGroup>
        <div className="model-connection-fields">
          <label><span>连接名称</span><Input value={service.name} aria-label="连接名称" maxLength={80} disabled={disabled} onChange={e=>change(s=>{s.name=e.target.value;})}/></label>
          <label><span>接口地址</span><Input type="url" value={channel.base_url} aria-label="接口地址" disabled={disabled||!provider?.editable_base} onChange={e=>change(s=>{
            s.channels[activeKind]!.base_url=e.target.value;
            if(activeKind!=='video')for(const type of ['text','image'] as const)if(s.channels[type])s.channels[type]!.base_url=e.target.value;
          })}/></label>
          <label><span>API Key</span><div className="model-secret-field"><Input type={showKey?'text':'password'} value={channel.api_key||''} autoComplete="new-password" spellCheck={false} aria-label={`${kindLabels[activeKind]} API Key`} placeholder={channel.credential_set?'已设置，留空保留':'输入 API Key'} disabled={disabled} onChange={e=>change(s=>{s.channels[activeKind]!.api_key=e.target.value;
            if(s.provider==='kie'||s.provider==='gemini')for(const type of ['text','image'] as const)if(s.channels[type])s.channels[type]!.api_key=e.target.value;
          })}/><Button variant="ghost" size="icon-sm" disabled={!channel.api_key} aria-label={showKey?'隐藏新输入的密钥':'显示新输入的密钥'} onClick={()=>setShowKey(v=>!v)}>{showKey?<EyeOff/>:<Eye/>}</Button></div></label>
          <p className="model-field-hint">{service.provider==='kie'||service.provider==='gemini'?'仅保存在本机，文本与图像共用凭据':'仅保存在本机，按能力分别配置'}</p>
        </div>
        <div className="model-catalog-title"><h4>可用模型</h4><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>{setEditing(-1);setModel({id:'',name:''});}}><Plus/>添加模型</Button></div>
        <p className="model-test-notice">{activeKind==='text'?'会发送一次最小文本请求；使用当前未保存的地址、Key 和模型。':'真实测试会发送一次请求并可能产生费用；视频只确认任务受理，不等待成片。'}</p>
        <div className="model-catalog">{channel.models.map((m,index)=>{const rowTest=currentTest?.model===m.id?currentTest:null;return <div className="model-catalog-row" key={`${index}:${m.id}`}><div><strong>{m.name}</strong><code>{m.id}</code></div><div className="model-catalog-actions"><Button size="sm" variant="ghost" className={`model-test-button ${rowTest?.status||''}`} disabled={disabled||testing||!hasCredential(channel)} onClick={()=>void testModel(m)} aria-label={`测试 ${m.name}`}>{rowTest?.status==='running'?<LoaderCircle className="model-test-spinner"/>:rowTest?.status==='success'?<CircleCheck/>:rowTest?.status==='error'?<CircleX/>:<Play/>}{rowTest?.status==='running'?'测试中':activeKind==='text'?'测试':'真实测试'}</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={()=>{setEditing(index);setModel({...m});}}>编辑</Button></div></div>;})}
          {!channel.models.length&&editing===null&&<p className="model-empty">添加模型后，可在任务模型中选择。</p>}
        </div>
        {currentTest&&currentTest.status!=='running'&&<div role={currentTest.status==='error'?'alert':'status'} className={`model-test-feedback ${currentTest.status}`}><span><strong>{testedModel?.name||currentTest.model}</strong>{currentTest.message}</span>{currentTest.status==='success'&&<small>{currentTest.elapsed}ms{currentTest.billable?' · 可能已产生费用':''}</small>}</div>}
        {editing!==null&&<form className="model-inline-editor" aria-label="编辑模型" onSubmit={e=>{e.preventDefault();saveModel();}}>
          <label>显示名称<Input value={model.name} maxLength={100} onChange={e=>setModel(v=>({...v,name:e.target.value}))} aria-label="模型显示名称" autoFocus required/></label>
          <label>模型 ID<Input value={model.id} maxLength={160} onChange={e=>setModel(v=>({...v,id:e.target.value}))} aria-label="模型 ID" required/></label>
          <div className="model-inline-actions"><Button type="button" size="sm" variant="ghost" onClick={()=>setEditing(null)}>取消</Button><Button size="sm" type="submit" disabled={disabled||!model.name.trim()||!model.id.trim()||channel.models.some((m,i)=>i!==editing&&m.id===model.id.trim())}><Check/>确认模型</Button></div>
        </form>}
        <Disclosure title={<span className="model-disclosure-label"><ChevronRight size={14}/>高级选项</span>} className="model-service-advanced">
          <p className="model-field-hint">模型ID须由当前渠道实际支持；测试接口会验证当前草稿，但不会保存设置。</p>
          <Button variant="ghost" size="sm" disabled={disabled||inUse(service.id)} onClick={()=>{update(draft=>{draft.services=draft.services.filter(s=>s.id!==service.id);});setSelected(data.services.find(s=>s.id!==service.id)?.id||'');}}><Trash2/>移除未使用的连接</Button>
          {inUse(service.id)&&<p className="model-field-hint">此服务正在被任务引用，请先在任务模型中更换。</p>}
        </Disclosure>
      </section>:<p className="model-empty">添加服务以配置模型。</p>}
    </div>
    {adding&&<Dialog title="添加模型服务" className="model-add-dialog" onClose={()=>setAdding(false)}><h2>添加服务</h2>
      <label>厂商适配器<Select value={providerId} onValueChange={setProviderId} label="厂商适配器">{providers.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</Select></label>
      <label>连接名称<Input value={connectionName} onChange={e=>setConnectionName(e.target.value)} maxLength={80} placeholder={providers.find(p=>p.id===providerId)?.name} aria-label="新连接名称"/></label>
      <p className="model-field-hint">使用现有适配器接入，不会自动调用模型。</p><Button onClick={add}><Server size={15}/>添加连接</Button>
    </Dialog>}
  </>;
}
