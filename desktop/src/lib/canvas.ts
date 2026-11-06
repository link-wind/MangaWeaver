import type { Edge, Node } from "@xyflow/react";
import { currentPlan, sourceData, taskEntries } from "./data";
import { nodeProgress } from "./runtime";
import type { Book, EngineEvent, CanvasState, RunData } from "./types";

export type Stage = "script" | "arrangement" | "direction" | "storyboard";
export type Card = {
  title: string;
  kind: "book" | "page" | "group" | "source" | "panel" | "script" | "arrangement" | "shot" | "frame" | "video";
  run?: string;
  baseId?: string;
  groupKey?: string;
  collapsed?: boolean;
  previews?: string[];
  pageNumber?: number;
  pageRuns?: Record<string,string>;
  members?: string[];
  book?: Book;
  busy?: boolean;
  activePage?: string;
  picked?: boolean;
  onToggle?: () => void;
  onPick?: () => void;
  onOpenPages?: (pages:number[]) => void;
  onLoadPages?: (pages:number[]) => Promise<void>;
  onRunStage?: () => void;
  runLabel?: string;
  subtitle: string;
  text: string;
  stage: Stage;
  location: string;
  mediaRevision?:string;
  image?: string;
  video?: string;
  status: "waiting" | "ready" | "rejected";
  progress?: "waiting" | "running" | "completed" | "failed";
  detail?: unknown;
};
export type CanvasNode = Node<Card, "artifact">;
export const stages: Stage[] = [
  "script",
  "arrangement",
  "direction",
  "storyboard",
];
export const stageNames: Record<Stage, string> = {
  script: "来源脚本",
  arrangement: "镜头编排",
  direction: "演出方案",
  storyboard: "关键画面",
};
export function canvasState(run: RunData | null, page = ""): CanvasState {
  return (
    run?.records.find((r) => r.file === "canvas.json")?.data || {
      version: 1,
      page: page || run?.original_page || "",
      prompt: sourceData(run)?.creative_brief || "",
      draft: "",
      positions: {},
      messages: [],
    }
  );
}
export function wholePage(run: RunData | null, state: CanvasState): string {
  const panels = sourceData(run)?.panels || [];
  return run?.original_page || (panels.some((p: any) => p.image === state.page) ? "" : state.page);
}
export function nextStage(run: RunData | null): Stage {
  const pause = run?.records.find((r) => r.file === "planning_pause.json")?.data
    ?.after_stage;
  if (pause) return stages[Math.min(stages.indexOf(pause) + 1, 3)];
  const plan = currentPlan(run);
  if (!plan?.script) return "script";
  if (!plan.shot_list) return "arrangement";
  if (
    !plan.directions?.length &&
    plan.shot_list.shots.some((s: any) => s.type === "action")
  )
    return "direction";
  return "storyboard";
}
export function graph(
  run: RunData | null,
  state: CanvasState,
  events: EngineEvent[] = [],
  busy = false,
): { nodes: CanvasNode[]; edges: Edge[] } {
  // 历史执行记录仍在对话中；删除前的进度不能再次投影成已清除的产物节点。
  const deleted = [...events].reverse().find(e => e.stage === 'canvas.delete' && e.data?.status === 'completed');
  if (deleted) events = events.slice(events.indexOf(deleted) + 1);
  const plan = currentPlan(run),
    source = sourceData(run),
    nodes: CanvasNode[] = [],
    edges: Edge[] = [];
  function add(id: string, x: number, y: number, data: Card) {
    nodes.push({
      id,
      type: "artifact",
      position: state.positions[id] || { x, y },
      data,
    });
  }
  function link(from: string, to: string) {
    edges.push({
      id: `${from}:${to}`,
      source: from,
      target: to,
      type: "smoothstep",
      animated: false,
    });
  }
  const accepted = (scope: string, value: unknown) =>
    (plan?.reviews || []).some((r: any) => r.scope === scope && !r.accepted)
      ? ("rejected" as const)
      : value
        ? ("ready" as const)
        : ("waiting" as const);
  const ready = (value: unknown) =>
    value ? ("ready" as const) : ("waiting" as const);
  const panels = source?.panels || [];
  const center = Math.max(0, (panels.length - 1) * 260 / 2);
  const page = wholePage(run, state);
  if (page) add("source", 0, Math.max(0, center - 160), {
    kind: "source",
    title: "整页漫画",
    subtitle: page ? "原始输入" : "未关联整页",
    text: state.prompt,
    image: page,
    stage: "script",
    location: "all",
    status: ready(page),
    detail: source,
  });
  panels.forEach((panel: any, index: number) => {
    const id = `panel:${panel.panel_id}`;
    const script = plan?.script?.panels?.find((p: any) => p.panel_id === panel.panel_id);
    add(id, 370, index * 260, {
      kind: "panel",
      title: `分镜 ${String(index + 1).padStart(2, "0")}`,
      subtitle: panel.panel_id,
      text: panel.text || script?.description || "",
      image: panel.image,
      stage: "script",
      location: panel.panel_id,
      status: accepted("script", panels.length),
      detail: { panel, script, reviews: plan?.reviews?.filter((r: any) => r.scope === "script") },
    });
    if (index === 0) link("source", id);
    else {
      link(`panel:${panels[index - 1].panel_id}`, id);
      Object.assign(edges[edges.length - 1], { sourceHandle: "reading-out", targetHandle: "reading-in" });
    }
  });
  const shots = plan?.shot_list?.shots || [];
  const planningStarted = shots.length > 0 || !!plan?.script || events.some(e => e.type === "stage" && ["characters","script","arrangement"].includes(e.stage));
  if (planningStarted) add("arrangement", 740, center, {
    kind: "arrangement",
    title: "镜头规划",
    subtitle: shots.length
      ? `${shots.length} 镜头 · ${shots.reduce((n: number, s: any) => n + s.duration, 0)} 秒`
      : "组织静态与动作镜头",
    text:
      shots
        .map(
          (s: any) =>
            `${s.shot_id} · ${s.type === "action" ? "动作" : "静态"} ${s.duration}s\n${s.intent}`,
        )
        .join("\n\n") ||
      "多个漫画格可以组成同一镜头，原作瞬间不必是动作起始帧。",
    stage: "arrangement",
    location: "all",
    status: accepted("arrangement", shots.length),
    detail: {
      script: plan?.script,
      shot_list: plan?.shot_list,
      reviews: plan?.reviews?.filter((r: any) => r.scope === "arrangement"),
    },
  });
  if (planningStarted) for (const panel of panels) link(`panel:${panel.panel_id}`, "arrangement");
  let row = 0;
  for (const shot of shots) {
    const id = `shot:${shot.shot_id}`,
      direction = plan?.directions?.find(
        (d: any) => d.shot_id === shot.shot_id,
      ),
      assets = (plan?.assets || []).filter(
        (a: any) => a.shot_id === shot.shot_id,
      );
    add(id, 1110, row, {
      kind: "shot",
      title: shot.shot_id,
      subtitle: `${shot.type === "action" ? "动作镜头" : "静态镜头"} · ${shot.duration}s · ${shot.source_panel_ids.join(" → ")}`,
      text: `${shot.intent}\n\n${direction?.rhythm || shot.description}`,
      stage: shot.type === "action" ? "direction" : "arrangement",
      location: shot.shot_id,
      status: "ready",
      detail: { shot, direction },
    });
    link("arrangement", id);
    const activeFrame = [...events].reverse().find(e => e.request_id === events.at(-1)?.request_id && e.type === "stage" && e.stage === "storyboard" && e.data?.shot_id === shot.shot_id);
    if (activeFrame && !assets.some((asset: any) => asset.keyframe_id === activeFrame.data.keyframe_id)) {
      add(`frame:${activeFrame.data.keyframe_id || shot.shot_id}`, 1480, row, {
        kind: "frame",
        title: "关键画面",
        subtitle: shot.shot_id,
        text: "关键画面制作", // 此节点仅在该帧真实开始后出现。
        stage: "storyboard",
        location: shot.shot_id,
        status: accepted(`storyboard:${shot.shot_id}`, false),
        detail: direction,
      });
      link(id, `frame:${activeFrame.data.keyframe_id || shot.shot_id}`);
    }
    assets.forEach((asset: any, i: number) => {
      const fid = `frame:${asset.keyframe_id}`;
      const reviews = (plan.reviews || []).filter(
        (r: any) => r.scope === `storyboard:${shot.shot_id}`,
      );
      add(fid, 1480, row + i * 310, {
        kind: "frame",
        title: `镜头 ${shot.shot_id.replace(/^s0*/, "")} · ${asset.time===0?"起始画面":`${asset.time}s 关键画面`}`,
        subtitle: `${shot.shot_id} · ${asset.time}s`,
        text: asset.description,
        image: asset.image,
        mediaRevision: asset.image_signature,
        stage: "storyboard",
        location: `${shot.shot_id}:${asset.keyframe_id}`,
        status: reviews.some((r: any) => !r.accepted) ? "rejected" : "ready",
        detail: { asset, reviews },
      });
      link(id, fid);
    });
    const tasks = taskEntries(run).filter((t: any) =>
      t.file.includes(`/${shot.shot_id}/`),
    );
    tasks.forEach((task: any, i: number) => {
      const vid = `video:${shot.shot_id}:${i}`;
      const exportReview=run?.records.find(r=>r.file==='preview_export.json')?.data?.review_sources?.[shot.shot_id]?.report;
      add(vid, 1850, row + i * 310, {
        kind: "video",
        title: `镜头 ${shot.shot_id.replace(/^s0*/, "")} · 视频片段`,
        subtitle: task.simulated ? task.status === "downloaded" ? "本地预览就绪" : "模拟中" :
          ({submitting:"提交中",submitted:"已提交 · 等待结果",succeeded:"已生成 · 下载中",downloaded:"视频已下载"} as Record<string,string>)[task.status] || task.status,
        text: task.simulated ? "模拟视频任务 · 不提交远端" : task.task_id
          ? `远端任务 ${task.task_id}`
          : "提交结果不明，请在平台核查",
        video: task.status === "downloaded" ? task.path : undefined,
        stage: "storyboard",
        location: shot.shot_id,
        status: exportReview?.accepted===false ? "rejected" : task.status === "downloaded" ? "ready" : "waiting",
        detail: task,
      });
      link(
        assets.length
          ? `frame:${assets[Math.min(i, assets.length - 1)].keyframe_id}`
          : id,
        vid,
      );
    });
    row += Math.max(360, Math.max(assets.length, tasks.length) * 310 + 40);
  }
  const final = run?.media.find((p) => /\/(final|preview)\.mp4$/.test(p) || (!!run.simulation && p === `${run.directory}/simulation.mp4`));
  if (final) {
    add("final", 2220, 0, {
      kind: "video",
      title: run?.simulation?.preset==='creative' ? "演示视频预览" : run?.simulation ? "模拟预览" : run?.experimental ? "实验预览" : "动画预览",
      subtitle: run?.simulation?.preset==='creative' ? "历史素材回放 · 含待修订镜头" : run?.simulation ? "本地静帧示例 · 非 AI 成片" : "已有视频 · 保留原生音轨",
      text: "在这里检查画面、声音与字幕。审查结论仍以原始记录为准。",
      video: final,
      stage: "storyboard",
      location: "all",
      status: "ready",
    });
    const videos = nodes.filter(
      (n) => n.data.kind === "video" && n.id !== "final",
    );
    if (videos.length) videos.forEach((n) => link(n.id, "final"));
    else link("arrangement", "final");
  }
  for (const node of nodes) node.data.progress = nodeProgress(node, events, busy);
  return { nodes, edges: edges.filter(e => nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)) };
}

/** 初始工作区只取同一镜头的相邻产物；全流程仍由全览提供。 */
export function workingSet(nodes:CanvasNode[],run:string,selected?:string|null):CanvasNode[]{
  const local=nodes.filter(n=>n.data.run===run&&!['book','page','group'].includes(n.data.kind));
  const focus=local.find(n=>n.id===selected)||local.find(n=>n.data.kind==='video'&&n.data.status==='rejected'&&n.data.location!=='all')||local.find(n=>n.data.kind==='frame'&&n.data.image);
  if(!focus||focus.data.location==='all')return [];
  const shot=focus.data.location.split(':')[0];
  return local.filter(n=>['shot','frame','video'].includes(n.data.kind)&&n.data.location.split(':')[0]===shot);
}
