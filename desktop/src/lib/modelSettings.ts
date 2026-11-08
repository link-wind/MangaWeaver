export type ModelKind = 'text'|'image'|'video';
export const kindLabels:Record<ModelKind,string>={text:'文本',image:'图像',video:'视频'};
export interface ModelEntry {id:string;name:string;}
export interface ModelChannel {base_url:string;models:ModelEntry[];credential_set:boolean;api_key?:string;}
export interface ModelService {id:string;provider:string;name:string;channels:Partial<Record<ModelKind,ModelChannel>>;}
export interface ModelProvider {id:string;name:string;kinds:ModelKind[];base_url:string;editable_base:boolean;}
export interface ModelChoice {service:string;model:string;}
export interface ModelSettings {
  revision:string;services:ModelService[];
  tasks:{text:ModelChoice;image:ModelChoice;video:ModelChoice;review:string};
  preferences:Record<string,string|number>;
}
export interface ModelSettingsResponse extends ModelSettings {providers:ModelProvider[];warnings:string[];}
export interface ModelTestResult {
  ok:true;provider:string;kind:ModelKind;model:string;elapsed_ms:number;message:string;billable_submission:boolean;
}
export function settingsDocument(value:ModelSettingsResponse):ModelSettings {
  return {revision:value.revision,services:value.services,tasks:value.tasks,preferences:value.preferences};
}
export function hasCredential(channel:ModelChannel|undefined) {
  return !!channel&&(channel.credential_set||!!channel.api_key?.trim());
}
export function taskServices(data:ModelSettings,kind:ModelKind) {
  const text=data.services.find(s=>s.id===data.tasks.text.service)?.provider;
  const allowed:Record<string,string[]>={huanling:['huanling'],gemini:['gemini'],kie:['kie','ciyuan'],ciyuan:['ciyuan']};
  return data.services.filter(s=>hasCredential(s.channels[kind])&&(kind!=='image'||!text||allowed[text]?.includes(s.provider)));
}
export function readableSettingsError(value:unknown) {
  return (value instanceof Error?value.message:String(value)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}
