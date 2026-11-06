import type {TaskActivity, WorkflowTask} from './types';

export type TraceIssue = NonNullable<TaskActivity['issues']>[number];

export type TraceRoleStep = {
  id: string;
  actor: string;
  role: string;
  status: string;
  rounds: number;
  iterations: number[];
  accepted?: boolean;
  artifact?: string;
  messages: string[];
  issues: TraceIssue[];
  targets: string[];
};

export type TraceTask = {
  task: WorkflowTask;
  roles: TraceRoleStep[];
  children: TraceTask[];
};

/** 连续同一角色的活动归并为一轮，角色切换时另起一段，保留 Creator／Reviewer 回路。 */
export function roleChain(activities: TaskActivity[]): TraceRoleStep[] {
  const steps: TraceRoleStep[] = [];
  const ordered = [...activities].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const activity of ordered) {
    const last = steps.at(-1);
    if (last && last.actor === activity.actor && last.role === activity.role) {
      last.rounds += 1;
      if (Number.isInteger(activity.iteration)) last.iterations.push(activity.iteration);
      last.status = activity.status;
      if (activity.accepted !== undefined) last.accepted = activity.accepted;
      if (activity.artifact) last.artifact = activity.artifact;
      if (activity.message) last.messages.push(activity.message);
      if (activity.issues?.length) last.issues.push(...activity.issues);
      if (activity.target) last.targets.push(activity.target);
      continue;
    }
    steps.push({
      id: activity.id,
      actor: activity.actor,
      role: activity.role,
      status: activity.status,
      rounds: 1,
      iterations: Number.isInteger(activity.iteration) ? [activity.iteration] : [],
      accepted: activity.accepted,
      artifact: activity.artifact,
      messages: activity.message ? [activity.message] : [],
      issues: activity.issues ? [...activity.issues] : [],
      targets: activity.target ? [activity.target] : [],
    });
  }
  return steps;
}

export function traceTask(task: WorkflowTask, allTasks: WorkflowTask[]): TraceTask {
  const children = allTasks
    .filter(candidate => candidate.parent_id === task.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(candidate => traceTask(candidate, allTasks));
  return {task, roles: roleChain(task.activities), children};
}

export function traceRoots(tasks: WorkflowTask[]): TraceTask[] {
  return tasks
    .filter(task => !task.parent_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(task => traceTask(task, tasks));
}

export function collaborationStages(roots: WorkflowTask[], tasks: WorkflowTask[]) {
  const included = new Map<string, WorkflowTask>();
  function collect(task: WorkflowTask) {
    if (included.has(task.id)) return;
    included.set(task.id, task);
    tasks.filter(child => child.parent_id === task.id).forEach(collect);
  }
  roots.forEach(collect);
  const stages = new Map<string, {stage:string; task:WorkflowTask; activities:TaskActivity[]}>();
  for (const task of included.values()) {
    for (const activity of task.activities) {
      const stage = activity.professional_stage || activity.actor.split('.')[0] || task.stage;
      const key = `${task.run}:${stage}`;
      let row = stages.get(key);
      if (!row) {
        row = {stage, task, activities:[]};
        stages.set(key, row);
      }
      if (!row.activities.some(existing => existing.id === activity.id)) row.activities.push(activity);
      if (task.updated_at > row.task.updated_at) row.task = task;
    }
  }
  return [...stages.values()].map(row => {
    const activities = [...row.activities].sort((first, second) => first.created_at.localeCompare(second.created_at));
    const reviews = new Map<string, TaskActivity>();
    for (const activity of activities) {
      if (activity.role.toLowerCase() === 'reviewer' || activity.actor.endsWith('.reviewer')) reviews.set(activity.target || '', activity);
    }
    const rejected = [...reviews.values()].filter(review => review.accepted === false);
    const roles = [...new Set(activities.map(activity => activity.actor))];
    return {...row, activities, roles, reviews:[...reviews.values()], rejected};
  });
}

export function traceArtifacts(task: WorkflowTask): string[] {
  const artifacts = new Set<string>(task.report?.artifacts || []);
  for (const activity of task.activities) if (activity.artifact) artifacts.add(activity.artifact);
  return [...artifacts];
}

export function traceReviews(task: WorkflowTask) {
  return task.report?.reviews || [];
}

export type TraceNote = {role?: string; text: string; status?: string};

/** 没有任务活动时，用公开说明的角色补出可读角色链，不伪造轮次与审查结论。 */
export function noteRoleChain(notes: TraceNote[]): TraceRoleStep[] {
  const steps: TraceRoleStep[] = [];
  for (const note of notes) {
    const actor = note.role || '';
    if (!actor) continue;
    const kind = actor.split('.')[1];
    const role = kind === 'reviewer' ? 'reviewer' : kind === 'creator' ? 'creator' : '';
    const last = steps.at(-1);
    if (last && last.actor === actor && last.role === role) {
      last.rounds += 1;
      continue;
    }
    steps.push({id: `note-${steps.length}`, actor, role, status: note.status || 'completed', rounds: 1, iterations: [], messages: [], issues: [], targets: []});
  }
  return steps;
}
