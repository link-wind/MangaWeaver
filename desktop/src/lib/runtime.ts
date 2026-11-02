import type { EngineEvent } from './types';
import type { CanvasNode } from './canvas';

export const runtimeNames: Record<string, string> = {
  simulate:'模拟任务', create_simulation:'准备模拟任务',
  agent_message:'创作 Agent', agent_continue:'继续执行', agent_select_page:'选择页面',
  agent_run_stage:'运行制作阶段', load_book_pages:'加载漫画页', 'book.ready':'漫画已就绪', 'book.load':'加载漫画页',
  'agent.thinking':'理解需求', 'agent.tool':'调用工具', 'book.import':'提取漫画页面', 'page.selected':'选定漫画页',
  preprocess:'漫画预处理', 'magi.load':'加载本地模型', 'magi.detect':'漫画分格', 'magi.ocr':'识别文字',
  plan:'镜头规划', characters:'整理角色', script:'来源脚本', arrangement:'镜头编排', direction:'镜头演出', storyboard:'关键画面',
  generate:'动画生成', tasks:'构建视频任务', dialogue:'准备日语对白', 'video.submitted':'提交视频',
  'video.query':'等待视频生成', 'video.review':'视频审查', assembly:'剪辑导出', resume:'恢复原有任务',
  select_page:'选择页面', create_run:'新建运行', preprocess_page:'自动分格', delegate:'专业任务',
  control_canvas:'调整画布', read_project:'读取项目', read_pages:'查看漫画页', revise_source:'校正来源',
};
export function mergeEvents(...groups: (EngineEvent[] | undefined)[]) {
  const unique = new Map<string, EngineEvent>();
  for (const event of groups.flatMap(g => g || [])) {
    const key = event.id || `${event.request_id}:${event.type}:${event.stage}:${JSON.stringify(event.data)}`;
    unique.set(key,event);
  }
  return [...unique.values()].sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}
export function executionRecords(events: EngineEvent[], busy = false) {
  const ignored = new Set(events.filter(e => e.type === 'started' && !runtimeNames[e.stage]).map(e => e.request_id));
  const records = new Map<string,{id:string;request:string;stage:string;label:string;status:string;message?:string;timestamp?:string}>();
  for (const event of events) {
    if (event.type === 'artifact' || ignored.has(event.request_id)) continue;
    const data = event.data || {};
    const terminal = event.type === 'failed' || event.type === 'completed';
    for (const record of records.values()) {
      if (record.request !== event.request_id || record.status !== 'running' || record.stage === 'request') continue;
      if (terminal || (event.type === 'stage' && record.stage !== event.stage && record.stage !== 'agent.tool')) {
        record.status = terminal && event.type === 'failed' ? data.status==='interrupted'?'interrupted':'failed' : 'completed';
      }
    }
    const key = [event.request_id, event.type === 'stage' ? event.stage : 'request', data.call_id || '', data.keyframe_id || data.shot_id || data.segment_id || data.panel_id || ''].join(':');
    const target = data.keyframe_id || data.segment_id || data.shot_id || data.panel_id;
    const label = event.type === 'stage' ? (runtimeNames[data.tool] || runtimeNames[event.stage] || event.stage) + (target ? ` · ${target}` : '') : '项目运行';
    const issue = [...records.values()].find(r => r.request === event.request_id && ['failed','blocked','needs_user'].includes(r.status));
    const status = event.type === 'failed' ? data.status==='interrupted'?'interrupted':'failed' : event.type === 'completed' ? issue?.status || 'completed' : data.status || 'running';
    records.set(key,{id:key,request:event.request_id,stage:event.type === 'stage' ? event.stage : 'request',label,status,message:data.message?.slice(0,180),timestamp:event.timestamp});
  }
  const activeRequest = events.at(-1)?.request_id;
  for (const record of records.values()) {
    if (record.status === 'running' && (!busy || record.request !== activeRequest)) record.status = 'interrupted';
  }
  return [...records.values()];
}
export function nodeProgress(node: CanvasNode, events: EngineEvent[], busy: boolean) {
  const latest = events.at(-1);
  const current = latest ? events.filter(e => e.request_id === latest.request_id) : [];
  const phases = current.filter(e => e.type === 'stage' && !e.stage.startsWith('agent.') && !['plan','generate','preprocess','page.selected','workflow.task'].includes(e.stage));
  const phase = phases.at(-1);
  let matches = false;
  if (phase) {
    const data = phase.data || {};
    const stage = phase.stage === 'professional' ? data.professional_stage === 'video' ? 'video.review' : data.professional_stage : phase.stage;
    const target = data.shot_id || (phase.stage === 'professional' && data.target !== 'all' ? data.target.match(/^(s\d+)(?:_|:|$)/)?.[1] : undefined);
    const keyframe = data.keyframe_id || (phase.stage === 'professional' && stage === 'storyboard' && data.target !== 'all' ? data.target : undefined);
    matches = node.data.kind === 'source' ? stage.startsWith('magi.') :
      node.data.kind === 'arrangement' ? ['characters','script','arrangement'].includes(stage) :
      node.data.kind === 'shot' ? stage === 'direction' && (!target || node.data.location === target) :
      node.data.kind === 'frame' ? stage === 'storyboard' && (keyframe ? node.id === `frame:${keyframe}` : !target || node.data.location.startsWith(target)) :
      node.data.kind === 'video' ? ['tasks','dialogue','video.query','video.submitted','video.review','assembly'].includes(stage) && (!target || node.data.location === target || node.id === 'final') : false;
  }
  const issue = current.some(e => (e.type === 'failed'&&e.data?.status!=='interrupted') || (e.stage === 'agent.tool' && ['failed','blocked'].includes(e.data?.status)));
  if (matches && issue && !['completed','paused'].includes(phase?.data?.status)) return 'failed';
  if (node.data.status === 'rejected') return 'failed';
  const task = node.data.detail as {task_id?:string;status?:string} | undefined;
  if (busy && node.data.kind === 'video' && task?.task_id &&
      ['submitted','succeeded'].includes(task.status || '')) return 'running';
  if (matches && busy && !['completed','paused'].includes(phase?.data?.status)) return 'running';
  return node.data.status === 'ready' ? 'completed' : 'waiting';
}
