import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTask, useTaskHistory, useTransitionTask, useUpdateTask } from '../api/queries';
import type { Task, TaskStatus, TransitionTaskResponse } from '../api/types';
import {
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingRows,
  PageHead,
  Status,
} from '../components/ui';
import { NOT_IMPLEMENTED, TRANSITIONS, qualityTone, taskTone } from '../lib/domain';
import { label, stamp, timeAgo } from '../lib/format';

export function TaskPage() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const task = useTask(taskId ?? '');

  if (task.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={5} label="Loading task" />
      </div>
    );
  }
  if (task.isError) {
    return (
      <div className="page">
        <ErrorState error={task.error} what="this task" onRetry={() => task.refetch()} />
      </div>
    );
  }
  return <TaskView task={task.data} />;
}

function TaskView({ task }: { task: Task }) {
  const history = useTaskHistory(task.id);
  const transition = useTransitionTask(task.project_id);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<TransitionTaskResponse | null>(null);

  const move = (to: TaskStatus) => {
    setResult(null);
    transition.mutate(
      { taskId: task.id, to_status: to, reason: reason.trim() || undefined },
      {
        onSuccess: (response) => {
          setResult(response);
          if (response.changed) setReason('');
        },
      },
    );
  };

  return (
    <div className="page">
      <p className="small" style={{ marginBottom: 8 }}>
        <Link to="/projects/$projectId" params={{ projectId: task.project_id }}>
          Back to the board
        </Link>
      </p>
      <PageHead
        title={
          <>
            <span className="mono muted" style={{ fontSize: 20 }}>
              {task.reference}
            </span>{' '}
            {task.title}
          </>
        }
        sub={
          <span className="row" style={{ gap: 12 }}>
            <Status tone={taskTone(task.status)}>{label(task.status)}</Status>
            <span>{label(task.priority)} priority</span>
            <span>{label(task.role)}</span>
            <Status tone={qualityTone(task.quality_state)}>
              Quality {label(task.quality_state).toLowerCase()}
            </Status>
            <span className="muted small">Updated {timeAgo(task.updated_at)}</span>
          </span>
        }
      />

      <div className="split">
        <div className="stack" style={{ gap: 32 }}>
          <section aria-labelledby="move-heading">
            <div className="section-head">
              <h2 id="move-heading">Move this task</h2>
              <span className="meta">
                The task service checks dependencies, WIP limit and the quality gate.
              </span>
            </div>
            <div className="panel panel-body stack">
              <Field
                label="Reason"
                htmlFor="move-reason"
                hint="Optional. Stored in the task history."
              >
                <input
                  id="move-reason"
                  type="text"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <div className="row">
                {TRANSITIONS[task.status].map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={to === 'done' ? 'btn btn-primary' : 'btn'}
                    onClick={() => move(to)}
                    disabled={transition.isPending}
                  >
                    Move to {label(to).toLowerCase()}
                  </button>
                ))}
              </div>
              <div aria-live="polite">
                {result ? (
                  result.changed ? (
                    <p>
                      <Status tone="pass">Moved</Status> Now{' '}
                      {label(result.task.status).toLowerCase()}.
                    </p>
                  ) : (
                    <p>
                      <Status tone="fail">Refused</Status> {result.blocked_reason}
                      {result.evidence_refs.length > 0 ? (
                        <span className="mono small muted">
                          {' '}
                          ({result.evidence_refs.join(', ')})
                        </span>
                      ) : null}
                    </p>
                  )
                ) : null}
                <FormError error={transition.error} />
              </div>
              {task.status === 'in_review' && task.quality_state !== 'passed' ? (
                <p className="small muted">
                  Done needs a passed quality gate. {NOT_IMPLEMENTED.quality}
                </p>
              ) : null}
            </div>
          </section>

          <EditTask task={task} />

          <section aria-labelledby="history-heading">
            <div className="section-head">
              <h2 id="history-heading">History</h2>
            </div>
            {history.isPending ? (
              <LoadingRows label="Loading history" />
            ) : history.isError ? (
              <ErrorState
                error={history.error}
                what="task history"
                onRetry={() => history.refetch()}
              />
            ) : history.data.length === 0 ? (
              <EmptyState>No status changes yet.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="ledger stack-mobile">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col">Actor</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.map((entry) => (
                      <tr key={entry.id}>
                        <td
                          data-label="When"
                          className="mono small"
                          title={stamp(entry.occurred_at)}
                        >
                          {stamp(entry.occurred_at)}
                        </td>
                        <td data-label="From">
                          {entry.from_status ? label(entry.from_status) : 'Created'}
                        </td>
                        <td data-label="To">{label(entry.to_status)}</td>
                        <td data-label="Actor" className="mono small">
                          {entry.actor}
                        </td>
                        <td data-label="Reason">
                          {entry.reason ?? <span className="muted">None given</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="stack" style={{ gap: 32 }} aria-label="Task details">
          <section aria-labelledby="criteria-heading">
            <div className="section-head">
              <h2 id="criteria-heading">Acceptance criteria</h2>
            </div>
            {task.acceptance_criteria.length === 0 ? (
              <EmptyState>No acceptance criteria were set for this task.</EmptyState>
            ) : (
              <ul className="feed">
                {task.acceptance_criteria.map((criterion) => (
                  <li key={criterion.id} style={{ gridTemplateColumns: 'auto minmax(0,1fr)' }}>
                    <Status tone={criterion.verified ? 'pass' : 'idle'}>
                      {criterion.verified ? 'Verified' : 'Not verified'}
                    </Status>
                    <span>{criterion.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              Criteria are verified with evidence from a quality run. The gateway does not expose
              manual verification in this build.
            </p>
          </section>

          <section aria-labelledby="deps-heading">
            <div className="section-head">
              <h2 id="deps-heading">Dependencies</h2>
            </div>
            <dl className="deflist">
              <dt>Depends on</dt>
              <dd className="mono small">
                {task.dependencies.length ? task.dependencies.join(', ') : 'None'}
              </dd>
              <dt>Blocking</dt>
              <dd className="mono small">
                {task.blocked_by.length ? task.blocked_by.join(', ') : 'None'}
              </dd>
              <dt>Agent</dt>
              <dd>
                {task.agent_session_id ? (
                  <span className="mono">{task.agent_session_id}</span>
                ) : (
                  'No agent session. ' + NOT_IMPLEMENTED.agents
                )}
              </dd>
              <dt>Created</dt>
              <dd className="mono small">{stamp(task.created_at)}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function EditTask({ task }: { task: Task }) {
  const update = useUpdateTask(task.id, task.project_id);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(
      { title: title.trim(), description: description.trim() || null },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <section aria-labelledby="edit-heading">
      <div className="section-head">
        <h2 id="edit-heading">Description</h2>
      </div>
      <form className="panel panel-body stack" onSubmit={submit}>
        <Field label="Title" htmlFor="edit-title">
          <input
            id="edit-title"
            type="text"
            required
            minLength={3}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="edit-description">
          <textarea
            id="edit-description"
            rows={5}
            maxLength={8000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FormError error={update.error} />
        <div className="row">
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending ? 'Saving' : 'Save task'}
          </button>
          <span className="small muted" aria-live="polite">
            {saved ? 'Saved.' : ''}
          </span>
        </div>
      </form>
    </section>
  );
}
