import { ArrowUpRight, GitBranch } from 'lucide-react';
import { Fragment } from 'react';
import { conversationStatus } from '../lib/conversation';
import { roleLabel, workSummary } from '../lib/presentation';
import { actorName, statusNames } from '../lib/timeline';
import { noteRoleChain, traceArtifacts, traceReviews, type TraceNote, type TraceRoleStep, type TraceTask } from '../lib/trace';
import type { WorkflowTask } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { Button } from './ui/button';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from './ui/trace';

type Props = {
  root: TraceTask;
  busy: boolean;
  highlight?: string;
  context?: string;
  notes?: TraceNote[];
  origin?: (task: WorkflowTask) => string;
  onLocate: (task: WorkflowTask, target?: string) => void;
  onAction?: (task: WorkflowTask, action: WorkflowTask['actions'][number]) => void;
  depth?: number;
};

function statusLabel(status: string) {
  return conversationStatus[status] || statusNames[status] || status;
}

function isReviewer(step: TraceRoleStep) {
  return /reviewer|审查/.test(`${step.actor} ${step.role}`);
}

function RoleChain({ roles }: { roles: TraceRoleStep[] }) {
  if (!roles.length) return null;
  return (
    <div className="trace-role-chain" aria-label="协作角色链">
      {roles.map((step, index) => (
        <Fragment key={step.id}>
          {index > 0 && <span className="trace-role-arrow" aria-hidden="true">→</span>}
          <span className={`trace-role-chip ${step.role}${step.accepted === false ? ' rejected' : ''}`}>
            {roleLabel(step.actor) || actorName(step.actor)}
            {isReviewer(step) && step.accepted === false && <small>退回</small>}
            {isReviewer(step) && step.accepted === true && <small>通过</small>}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function RoleStep({ step, task, busy, onLocate }: { step: TraceRoleStep; task: WorkflowTask; busy: boolean; onLocate: Props['onLocate'] }) {
  const reviewer = isReviewer(step);
  const failed = step.status === 'failed' || step.accepted === false;
  const label = roleLabel(step.actor) || actorName(step.actor);
  const detail = [
    step.rounds > 1 ? `共 ${step.rounds} 轮` : '',
    reviewer && step.accepted === false ? '退回修订' : reviewer && step.accepted === true ? '审查通过' : statusLabel(step.status),
  ].filter(Boolean).join(' · ');
  const target = step.targets.at(-1) || step.artifact;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={step.status === 'running' ? 'running' : failed ? 'error' : undefined}>
          <TraceTitle>{label}</TraceTitle>
          {detail && <TraceDescription>{detail}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {step.messages.map((message, index) => <p key={index} className="trace-role-message">{message}</p>)}
        {target && <Button variant="ghost" size="sm" className="task-link" disabled={busy} onClick={() => onLocate(task, layerTarget(step))}>产物 · {label} <ArrowUpRight size={11} /></Button>}
        {step.issues.length > 0 && <ul className="review-issues">{step.issues.map((issue, index) => <li key={index}>{issue.evidence}<small>{issue.suggestion}</small></li>)}</ul>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function layerTarget(step: TraceRoleStep) {
  return step.targets.at(-1) || step.artifact;
}

export function AgentTraceTree({ root, busy, highlight, context, notes = [], origin, onLocate, onAction, depth = 0 }: Props) {
  const { task, roles, children } = root;
  const status = !busy && task.status === 'running' ? 'interrupted' : task.status;
  const summary = task.summary ? workSummary(task.status, task.activities, task.summary, task.origin === 'simulation') : '';
  const reviews = traceReviews(task);
  const artifacts = traceArtifacts(task);
  const chain = roles.length ? roles : noteRoleChain(notes);
  return (
    <article
      id={`trace-${task.id}`}
      className={`agent-trace ${status}${highlight === task.id ? ' highlighted' : ''}`}
      data-depth={depth}
    >
      <header className="agent-trace-head">
        <div className="agent-trace-title">
          <strong>{task.title}</strong>
          <small>{origin?.(task) || task.stage}</small>
        </div>
        <StatusBadge status={status}>{statusLabel(status)}</StatusBadge>
      </header>
      {context && <p className="agent-trace-context">{context}</p>}
      <RoleChain roles={chain} />
      {summary && <p className="agent-trace-summary">{summary}</p>}
      {!!task.handoffs?.length && (
        <div className="agent-trace-handoffs">
          {task.handoffs.map(handoff => (
            <p key={handoff.id}>
              <span>{roleLabel(handoff.sender) || actorName(handoff.sender)} → {roleLabel(handoff.receiver) || actorName(handoff.receiver)}</span>
              {handoff.summary && <small>{handoff.summary}</small>}
            </p>
          ))}
        </div>
      )}
      {roles.length > 0 && (
        <Trace className="agent-trace-steps">
          {roles.map(step => <RoleStep key={step.id} step={step} task={task} busy={busy} onLocate={onLocate} />)}
        </Trace>
      )}
      {reviews.length > 0 && (
        <div className="agent-trace-reviews">
          {reviews.map((review, index) => (
            <p key={index} className={review.accepted === false ? 'rejected' : review.accepted ? 'accepted' : undefined}>
              <GitBranch size={11} />
              {review.accepted === false ? '审查退回' : review.accepted ? '审查通过' : '审查结论'}
              {review.reason && <small>{review.reason}</small>}
            </p>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div className="agent-trace-notes">
          {notes.map((note, index) => (
            <p key={index}>
              <small>{roleLabel(note.role) || actorName(note.role)} · 公开说明</small>
              {note.text}
            </p>
          ))}
        </div>
      )}
      {artifacts.length > 0 && (
        <div className="agent-trace-artifacts">
          {artifacts.map(artifact => (
            <Button key={artifact} variant="ghost" size="sm" className="task-link" disabled={busy} onClick={() => onLocate(task, artifact)}>
              {artifact.split('/').at(-1)}
              <ArrowUpRight size={11} />
            </Button>
          ))}
        </div>
      )}
      {children.length > 0 && (
        <div className="agent-trace-children">
          {children.map(child => <AgentTraceTree key={child.task.id} root={child} busy={busy} highlight={highlight} notes={[]} origin={origin} onLocate={onLocate} onAction={onAction} depth={depth + 1} />)}
        </div>
      )}
      {(task.actions.length > 0 || !!task.run) && (
        <footer className="agent-trace-footer">
          {task.actions.map(action => (
            <Button key={action.kind} variant="ghost" size="sm" className="work-action" disabled={busy} onClick={() => onAction?.(task, action)}>{action.label}</Button>
          ))}
          {task.run && (
            <Button variant="ghost" size="sm" className="task-link" disabled={busy} onClick={() => onLocate(children.at(-1)?.task || task)}>
              查看画布
              <ArrowUpRight size={12} />
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}
