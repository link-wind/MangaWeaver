export interface EngineEvent {
  id?: string;
  timestamp?: string;
  version: number;
  request_id: string;
  run_dir?: string;
  type: "started" | "stage" | "artifact" | "completed" | "failed";
  stage: string;
  data: any;
}
export interface RecordFile {
  file: string;
  data?: any;
  error?: string;
}
export interface RunData {
  workflow?:AgentSession["workflow"];
  book_page?: {book_id:string;page_id:string;number:number} | null;
  simulation?: {step: number; completed: boolean; label: string; api_calls: number} | null;
  events?: EngineEvent[];
  original_page?: string;
  directory: string;
  experimental: boolean;
  records: RecordFile[];
  media: string[];
}
export interface RunPreview {
  directory: string;
  name: string;
  cover?: string;
  video?: string;
  updated: number;
  experimental: boolean;
  status: string;
}
export interface Project {
  path: string;
  name: string;
  version: 1;
  sources: string[];
  runs: string[];
  pages: string[];
}
export interface MangaMaterial {
  id:string; name:string; source:string; cover:string; format:string; pages:number; imported:string;
}
export interface Settings {
  root: string;
  python: string;
  ffmpeg: string;
  env_file: string;
}
export interface PanelEdit {
  bbox: number[];
  text: string;
  speaker: string;
}
export interface DesktopAPI {
  createSimulation(): Promise<string>;
  materials(): Promise<MangaMaterial[]>;
  importMaterial(): Promise<MangaMaterial | null>;
  selectMaterial(id:string): Promise<string>;
  settings(): Promise<Settings>;
  configure(): Promise<Settings | null>;
  project(action: "create" | "open"): Promise<Project | null>;
  openRunProject(path:string):Promise<Project>;
  attach(): Promise<string | null>;
  scanRuns(chooseDirectory?: boolean): Promise<RunPreview[]>;
  importPage(): Promise<string | null>;
  choosePage(): Promise<string | null>;
  importSource(): Promise<string | null>;
  newRun(): Promise<string>;
  run(command: string, params?: Record<string, unknown>): Promise<any>;
  stop(): Promise<void>;
  media(path: string): Promise<string>;
  exportFile(path: string): Promise<boolean>;
  onEvent(callback: (event: EngineEvent) => void): () => void;
}
declare global {
  interface Window {
    manga: DesktopAPI;
  }
}

export interface CanvasMessage {
  turn_id?:string;
  id: string;
  role: "user" | "assistant";
  text: string;
  target: string;
  stage: string;
  created_at?: string;
  references?: CanvasReference[];
  delivery?: 'steer'|'follow_up';
  status: "draft" | "submitted" | "completed" | "failed";
}
export interface CanvasReference {
  id:string; node_id:string; label:string; purpose:'target'|'reference'; run:string;
  page?:{book_id?:string;page_id?:string;number?:number}; kind:'object'|'image'|'video';
  path:string; signature:string; location:string; stage:string;
}
export interface MessageOptions {delivery:'steer'|'follow_up';references:CanvasReference[];}
export interface CanvasState {
  view?: CanvasView;
  version: 1;
  page: string;
  prompt: string;
  draft: string;
  positions: Record<string, { x: number; y: number }>;
  messages: CanvasMessage[];
}
export interface CanvasView {
  collapsed_groups: string[];
  collapsed_pages: string[];
  book_collapsed: boolean;
  positions: Record<string, {x:number; y:number}>;
}

export interface AgentContext {
  run?: string;
  selected: string[];
  nodes: { id: string; title: string; kind: string; location: string; stage: string }[];
}
export interface Book {
  id: string; name: string; page_count: number;
  pages: { id: string; number: number; image: string; thumbnail: string; loaded?: boolean }[];
}
export interface CanvasCommand {
  kind: "canvas"; call_id: string; revision: number; run: string;
  operation: "select" | "focus" | "layout" | "open_details";
  node_ids: string[]; dx: number; dy: number;
}
export interface AgentSession {
  conversation_sequence?:number;
  conversation?:ConversationTurn[];
  conversation_meta?:{version:number;session_id:string;branch_id:string;branches:{id:string;name:string;parent_id?:string;fork_message?:string;created_at:string}[]};
  active_task_id?:string;
  workflow?:{version:number;revision:number;tasks:WorkflowTask[]};
  pending_requests?:PendingRevision[];
  page_runs?: Record<string,string>;
  page_status?: Record<string,string>;
  book_view?: CanvasView;
  events?: EngineEvent[];
  revision: number; messages: CanvasMessage[];
  active_run: string; active_page_id: string; book?: Book;
  context_stats?:{estimated_input:number;budget:number;capacity:number|null;basis:string;provider_usage?:unknown}|null;
  pending?: CanvasCommand | {kind: string; question?: string;task_id?:string;revision?:number;question_id?:string;child_session_id?:string} | null;
}

export interface ConversationBlock {
  message?:string;
  id:string;type:string;text:string;status?:string;tool?:string;arguments?:Record<string,unknown>;
  call_id?:string;parent_call_id?:string;result?:any;progress?:any;role?:string;child_id?:string;
}
export interface ConversationTurn {id:string;created_at:string;status:string;blocks:ConversationBlock[];message?:string;}

export interface TaskActivity {
  id: string; actor: string; role: string; target: string; professional_stage: string;
  iteration: number; status: string; artifact?: string; accepted?: boolean; message?: string;
  reused?: boolean; created_at: string; issues?: {target:string;location:string;evidence:string;suggestion:string}[];
}
export interface WorkflowTask {
  call_id?:string;
  brief?:{goal:string;target:string;input_version:string;permissions:string[];constraints:string[];expected_output:string;references:CanvasReference[]};
  report?:{summary:string;status:string;artifacts:string[];reason:string;next_receiver:string;reused:boolean;reviews:{accepted?:boolean;reason?:string;message?:string}[]};
  handoffs?:{id:string;sender:string;receiver:string;summary:string;iteration:number}[];
  id: string; parent_id?: string; origin:string; title: string; stage: string; run: string; page_id?: string;
  target: string; actor?: string; status: string; reason: string; summary: string; created_at: string;
  updated_at: string; revision:number; activities:TaskActivity[]; reused?:boolean;
  actions:{kind:string;label:string;scope?:string;stage?:string}[];
}
export interface PendingRevision {
  delivery?:'steer'|'follow_up';intent?:string;references?:CanvasReference[];task_id?:string;
  id:string;created_at:string;text:string;status:string;run:string;stage:string;summary?:string;
}
