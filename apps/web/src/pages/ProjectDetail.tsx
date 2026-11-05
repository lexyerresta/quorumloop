import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { API_BASE } from '../api/client';
import {
  fetchActivity,
  keys,
  useArchiveProject,
  useBoard,
  useBranches,
  useCommits,
  useCreateTask,
  useProject,
  useReviews,
  useSendInstruction,
  useSession,
  useSyncProject,
  useTransitionTask,
  useUpdateProject,
} from '../api/queries';
import type {
  ActivityEvent,
  AgentRole,
  AutonomyLevel,
  InstructionResponse,
  ProjectSummary,
  RuntimePreference,
  Task,
  TaskPriority,
  TaskStatus,
} from '../api/types';
import {
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingRows,
  PageHead,
  Status,
} from '../components/ui';
import {
  BOARD_LANES,
  NOT_IMPLEMENTED,
  PROJECT_STATUS_LABEL,
  TRANSITIONS,
  projectTone,
  qualityTone,
  taskTone,
} from '../lib/domain';
import { describeError } from '../api/client';
import { label, shortSha, stamp, timeAgo } from '../lib/format';
import { useMediaQuery } from '../lib/media';

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const ROLES: AgentRole[] = [
  'implementation',
  'product_lead',
  'researcher',
  'architect',
  'design_lead',
  'qa',
  'security',
  'release',
];

export function useProjectId(): string {
  const params = useParams({ strict: false }) as { projectId?: string };
  return params.projectId ?? '';
}

/* ------------------------------------------------------------------ layout */

export function ProjectLayout() {
  const projectId = useProjectId();
  const project = useProject(projectId);

  if (project.isPending) {
    return (
      <div className="page">
        <LoadingRows rows={5} label="Loading project" />
      </div>
    );
  }
  if (project.isError) {
    return (
      <div className="page">
        <ErrorState error={project.error} what="this project" onRetry={() => project.refetch()} />
      </div>
    );
  }
  return <ProjectFrame project={project.data} />;
}

function ProjectFrame({ project }: { project: ProjectSummary }) {
  const sync = useSyncProject(project.id);
  const repo = project.repository;
  const tabs = [
    { to: '/projects/$projectId', label: 'Tasks', exact: true },
    { to: '/projects/$projectId/activity', label: 'Activity', exact: false },
    { to: '/projects/$projectId/code', label: 'Code', exact: false },
    { to: '/projects/$projectId/settings', label: 'Settings', exact: false },
  ] as const;

  return (
    <div className="page">
      <PageHead
        title={project.name}
        sub={
          <span className="row" style={{ gap: 12 }}>
            <Status tone={projectTone(project.status)}>
              {PROJECT_STATUS_LABEL[project.status]}
            </Status>
            {repo ? (
              <span className="mono">
                {project.forge ? `${project.forge}:` : ''}
                {repo.full_name} @ {repo.default_branch}
                {repo.head_sha ? ` · ${shortSha(repo.head_sha)}` : ''}
              </span>
            ) : (
              <span className="muted">No repository bound</span>
            )}
            {repo ? (
              <span className="small muted">
                {repo.synced_at
                  ? `${repo.stale ? 'Stale, last synced' : 'Synced'} ${timeAgo(repo.synced_at)}`
                  : 'Never synced'}
              </span>
            ) : null}
          </span>
        }
        actions={
          repo ? (
            <button
              type="button"
              className="btn"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? 'Syncing repository' : 'Sync repository'}
            </button>
          ) : (
            <Link to="/connections" className="btn">
              Import repository
            </Link>
          )
        }
      />
      {sync.isError ? (
        <div className="banner banner-fail" role="alert">
          Sync failed. {describeError(sync.error)}
        </div>
      ) : null}
      {sync.data ? (
        <div className="banner" role="status">
          Synced {sync.data.commits_synced} commits and {sync.data.reviews_synced} reviews
          {sync.data.reason ? `. ${sync.data.reason}` : '.'}
        </div>
      ) : null}

      <nav className="tabs" aria-label="Project sections">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ projectId: project.id }}
            className="tab"
            activeOptions={{ exact: tab.exact }}
            activeProps={{ 'aria-current': 'page' }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Outlet />

      <Composer projectId={project.id} />
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

/**
 * Docked at the bottom of the project view on wider screens. On a phone it would take a third of
 * the screen, so it becomes a 44px dock button that opens the same form as a bottom sheet.
 */
function Composer({ projectId }: { projectId: string }) {
  const phone = useMediaQuery();
  const [open, setOpen] = useState(false);

  if (!phone) {
    return (
      <section className="composer" aria-labelledby="composer-heading">
        <h2 id="composer-heading" className="sr-only">
          Instruction composer
        </h2>
        <ComposerForm projectId={projectId} />
      </section>
    );
  }
  return (
    <>
      <div className="composer-dock">
        <button
          type="button"
          className="btn btn-primary"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          Write instruction
        </button>
      </div>
      {open ? (
        <Dialog title="Send instruction" onClose={() => setOpen(false)}>
          <ComposerForm projectId={projectId} />
        </Dialog>
      ) : null}
    </>
  );
}

function ComposerForm({ projectId }: { projectId: string }) {
  const send = useSendInstruction(projectId);
  const board = useBoard(projectId);
  const [prompt, setPrompt] = useState('');
  const [target, setTarget] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [result, setResult] = useState<InstructionResponse | null>(null);
  const tooShort = prompt.trim().length < 10;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (tooShort || send.isPending) return;
    send.mutate(
      {
        prompt: prompt.trim(),
        target_task_id: target || null,
        base_ref: null,
        role: 'implementation',
        priority,
        autonomy_policy_override: null,
      },
      {
        onSuccess: (response) => {
          setResult(response);
          setPrompt('');
        },
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      <form onSubmit={submit} className="composer-form">
        <div className="stack" style={{ gap: 8 }}>
          <Field
            label="Instruction"
            htmlFor="composer-prompt"
            hint="Enter sends, Shift+Enter adds a line. At least 10 characters."
          >
            <textarea
              id="composer-prompt"
              rows={2}
              maxLength={8000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </Field>
          <div className="row">
            <label className="small muted" htmlFor="composer-target">
              Task
            </label>
            <select
              id="composer-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              style={{ width: 'auto', maxWidth: 260 }}
            >
              <option value="">New task from this instruction</option>
              {(board.data?.tasks ?? []).map((task) => (
                <option key={task.id} value={task.id}>
                  {task.reference} {task.title}
                </option>
              ))}
            </select>
            <label className="small muted" htmlFor="composer-priority">
              Priority
            </label>
            <select
              id="composer-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
              style={{ width: 'auto' }}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={tooShort || send.isPending}
          title={tooShort ? 'Write at least 10 characters' : undefined}
        >
          {send.isPending ? 'Sending' : 'Send instruction'}
        </button>
      </form>
      <div aria-live="polite" style={{ marginTop: 8 }}>
        {send.isError ? <FormError error={send.error} /> : null}
        {result ? (
          <p className="small">
            Recorded at {stamp(result.queued_at)}.{' '}
            {result.dispatch.decision === 'queued' ? (
              <Status tone="run">Queued</Status>
            ) : result.dispatch.decision === 'blocked' ? (
              <Status tone="fail">Blocked</Status>
            ) : (
              <Status tone="wait">Not dispatched</Status>
            )}{' '}
            <span className="muted">{result.dispatch.reason}</span>{' '}
            <Link to="/tasks/$taskId" params={{ taskId: result.task_id }}>
              Open task
            </Link>
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ board */

export function BoardTab() {
  const projectId = useProjectId();
  const board = useBoard(projectId);
  const [creating, setCreating] = useState(false);

  if (board.isPending) return <LoadingRows rows={6} label="Loading the task board" />;
  if (board.isError) {
    return <ErrorState error={board.error} what="the task board" onRetry={() => board.refetch()} />;
  }

  const byStatus = new Map<TaskStatus, Task[]>();
  for (const task of board.data.tasks) {
    byStatus.set(task.status, [...(byStatus.get(task.status) ?? []), task]);
  }
  const offBoard = board.data.tasks.filter((task) => !BOARD_LANES.includes(task.status));
  const inProgress = byStatus.get('in_progress')?.length ?? 0;

  return (
    <section aria-labelledby="board-heading">
      <div className="section-head">
        <h2 id="board-heading">Task board</h2>
        <div className="row">
          <span className="meta mono">
            WIP {inProgress}/{board.data.wip_limit}
          </span>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            Create task
          </button>
        </div>
      </div>

      {board.data.tasks.length === 0 ? (
        <EmptyState
          action={
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              Create task
            </button>
          }
        >
          This board has no tasks. Create one, or send an instruction below and it becomes a backlog
          task.
        </EmptyState>
      ) : (
        <>
          <div className="board-scroll" tabIndex={0} aria-label="Task lanes, scroll sideways">
            <div className="board">
              {BOARD_LANES.map((lane) => (
                <Lane
                  key={lane}
                  status={lane}
                  tasks={byStatus.get(lane) ?? []}
                  projectId={projectId}
                />
              ))}
            </div>
          </div>
          <p className="scroll-hint">
            Six lanes. On a narrow screen the board scrolls sideways; Tab moves through the tasks.
          </p>
          {offBoard.length > 0 ? (
            <div className="section" style={{ marginTop: 24 }}>
              <h3>Paused, failed, canceled or waiting on approval</h3>
              <ul className="lane-list panel" style={{ marginTop: 8 }}>
                {offBoard.map((task) => (
                  <TaskRow key={task.id} task={task} projectId={projectId} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {creating ? (
        <CreateTaskDialog projectId={projectId} onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}

function Lane({
  status,
  tasks,
  projectId,
}: {
  status: TaskStatus;
  tasks: Task[];
  projectId: string;
}) {
  const headingId = `lane-${status}`;
  return (
    <section className="lane" aria-labelledby={headingId}>
      <div className="lane-head">
        <h3 id={headingId}>{label(status)}</h3>
        <span className="mono small muted">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="lane-empty">Nothing here.</div>
      ) : (
        <ul className="lane-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} projectId={projectId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskRow({ task, projectId }: { task: Task; projectId: string }) {
  const transition = useTransitionTask(projectId);
  const targets = TRANSITIONS[task.status];
  const [to, setTo] = useState<TaskStatus | ''>('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const selectId = `move-${task.id}`;

  const move = () => {
    if (!to) return;
    setRefusal(null);
    transition.mutate(
      { taskId: task.id, to_status: to },
      {
        onSuccess: (result) => {
          if (!result.changed) setRefusal(result.blocked_reason ?? 'The server refused this move.');
          setTo('');
        },
      },
    );
  };

  return (
    <li className="task-row">
      <div>
        <span className="mono small muted">{task.reference}</span>{' '}
        <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="task-title">
          {task.title}
        </Link>
      </div>
      <div className="task-meta">
        {!BOARD_LANES.includes(task.status) ? (
          <Status tone={taskTone(task.status)}>{label(task.status)}</Status>
        ) : null}
        <span>{label(task.priority)}</span>
        <span>{label(task.role)}</span>
        {task.dependencies.length > 0 ? (
          <span className="mono">deps {task.dependencies.length}</span>
        ) : null}
        <Status tone={qualityTone(task.quality_state)}>
          Quality {label(task.quality_state).toLowerCase()}
        </Status>
        <span>{task.agent_session_id ? 'Agent assigned' : 'No agent'}</span>
      </div>
      {targets.length > 0 ? (
        <div className="row" style={{ gap: 4 }}>
          <label htmlFor={selectId} className="sr-only">
            Move {task.reference} to
          </label>
          <select
            id={selectId}
            value={to}
            onChange={(event) => setTo(event.target.value as TaskStatus)}
            style={{ width: 'auto', flex: 1, minWidth: 0 }}
          >
            <option value="">Move to</option>
            {targets.map((target) => (
              <option key={target} value={target}>
                {label(target)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={move}
            disabled={!to || transition.isPending}
            title={!to ? 'Pick a lane first' : undefined}
          >
            {transition.isPending ? 'Moving' : 'Move'}
          </button>
        </div>
      ) : null}
      <div aria-live="polite">
        {refusal ? (
          <p className="small">
            <Status tone="fail">Refused</Status> {refusal}
          </p>
        ) : null}
        {transition.isError ? <FormError error={transition.error} /> : null}
      </div>
    </li>
  );
}

function CreateTaskDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateTask(projectId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [role, setRole] = useState<AgentRole>('implementation');
  const [criteria, setCriteria] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        role,
        priority_dependency_ids: [],
        acceptance_criteria: criteria
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        auto_assign: false,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title="Create task"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="create-task"
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating' : 'Create task'}
          </button>
        </>
      }
    >
      <form id="create-task" className="stack" onSubmit={submit}>
        <Field label="Title" htmlFor="task-title" hint="3 to 200 characters.">
          <input
            id="task-title"
            type="text"
            required
            minLength={3}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="Description" htmlFor="task-description" hint="Optional.">
          <textarea
            id="task-description"
            maxLength={8000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="row" style={{ alignItems: 'start' }}>
          <Field label="Priority" htmlFor="task-priority">
            <select
              id="task-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role" htmlFor="task-role">
            <select
              id="task-role"
              value={role}
              onChange={(event) => setRole(event.target.value as AgentRole)}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Acceptance criteria"
          htmlFor="task-criteria"
          hint="One per line, optional. Done stays blocked until every criterion is verified."
        >
          <textarea
            id="task-criteria"
            rows={3}
            value={criteria}
            onChange={(event) => setCriteria(event.target.value)}
          />
        </Field>
        <FormError error={create.error} />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ activity */

type StreamState = 'connecting' | 'live' | 'reconnecting' | 'closed';

/** Subscribes to the activity SSE relay and refetches the feed when an event arrives. */
function useActivityStream(projectId: string): { state: StreamState; fresh: number } {
  const client = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const [fresh, setFresh] = useState(0);

  useEffect(() => {
    const source = new EventSource(
      `${API_BASE}/events/stream?project_id=${encodeURIComponent(projectId)}`,
      { withCredentials: true },
    );
    source.addEventListener('ready', () => setState('live'));
    source.addEventListener('activity', () => {
      setFresh((count) => count + 1);
      void client.invalidateQueries({ queryKey: keys.activity(projectId) });
    });
    source.onerror = () => {
      setState(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
    };
    return () => source.close();
  }, [client, projectId]);

  return { state, fresh };
}

/** Rate-capped polite announcement: at most one message every 10 seconds. */
function useThrottledAnnouncement(count: number): string {
  const [message, setMessage] = useState('');
  const last = useRef({ at: 0, count: 0 });
  useEffect(() => {
    const now = Date.now();
    if (count > last.current.count && now - last.current.at > 10_000) {
      const added = count - last.current.count;
      setMessage(`${added} new event${added === 1 ? '' : 's'} in the activity feed`);
      last.current = { at: now, count };
    }
  }, [count]);
  return message;
}

export function ActivityTab() {
  const projectId = useProjectId();
  const stream = useActivityStream(projectId);
  const announcement = useThrottledAnnouncement(stream.fresh);
  const feed = useInfiniteQuery({
    queryKey: keys.activity(projectId),
    queryFn: ({ pageParam }) => fetchActivity(projectId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor,
  });

  const streamLabel: Record<
    StreamState,
    { tone: 'pass' | 'wait' | 'fail' | 'idle'; text: string }
  > = {
    connecting: { tone: 'idle', text: 'Connecting to live stream' },
    live: { tone: 'pass', text: 'Live' },
    reconnecting: { tone: 'wait', text: 'Stream interrupted, reconnecting' },
    closed: { tone: 'fail', text: 'Live stream closed, reload to reconnect' },
  };
  const items: ActivityEvent[] = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const projection = feed.data?.pages[0]?.projection ?? null;

  return (
    <section aria-labelledby="activity-heading">
      <div className="section-head">
        <h2 id="activity-heading">Activity</h2>
        <span className="row">
          <Status tone={streamLabel[stream.state].tone}>{streamLabel[stream.state].text}</Status>
          {projection ? (
            <span className="meta mono">{projection.total_events} events recorded</span>
          ) : null}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {feed.isPending ? (
        <LoadingRows rows={6} label="Loading activity" />
      ) : feed.isError ? (
        <ErrorState error={feed.error} what="activity" onRetry={() => feed.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState>
          No activity yet. Creating a task, moving it or sending an instruction records an event
          here, and new events arrive without a reload.
        </EmptyState>
      ) : (
        <>
          <ul className="feed">
            {items.map((event) => (
              <li key={event.id}>
                <time dateTime={event.occurred_at} title={stamp(event.occurred_at)}>
                  {timeAgo(event.occurred_at)}
                </time>
                <span>
                  <span className="evt">{event.kind}</span>{' '}
                  {event.severity !== 'info' ? (
                    <Status tone={event.severity === 'error' ? 'fail' : 'wait'}>
                      {label(event.severity)}
                    </Status>
                  ) : null}{' '}
                  {event.summary} <span className="muted small">by {event.actor}</span>
                </span>
              </li>
            ))}
          </ul>
          {feed.hasNextPage ? (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                onClick={() => feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                {feed.isFetchingNextPage ? 'Loading older events' : 'Load older events'}
              </button>
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 12 }}>
              Start of the timeline.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ code */

export function CodeTab() {
  const projectId = useProjectId();
  const project = useProject(projectId);
  const bound = Boolean(project.data?.repository);
  const commits = useCommits(projectId, bound);
  const branches = useBranches(projectId, bound);
  const reviews = useReviews(projectId, bound);

  if (!bound) {
    return (
      <EmptyState
        action={
          <Link to="/connections" className="btn">
            Import repository
          </Link>
        }
      >
        This project has no repository bound, so there are no commits, branches or reviews to show.
        Connect GitHub or GitLab, then import a repository into a project.
      </EmptyState>
    );
  }

  return (
    <div className="split">
      <section aria-labelledby="commits-heading">
        <div className="section-head">
          <h2 id="commits-heading">Recent commits</h2>
          <span className="meta">From the forge cache. Sync the repository to refresh.</span>
        </div>
        {commits.isPending ? (
          <LoadingRows label="Loading commits" />
        ) : commits.isError ? (
          <ErrorState error={commits.error} what="commits" onRetry={() => commits.refetch()} />
        ) : commits.data.length === 0 ? (
          <EmptyState>No commits cached yet. Use Sync repository above.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="ledger stack-mobile">
              <thead>
                <tr>
                  <th scope="col">Commit</th>
                  <th scope="col">Message</th>
                  <th scope="col">Author</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {commits.data.map((commit) => (
                  <tr key={commit.sha}>
                    <td data-label="Commit" className="mono">
                      <a href={commit.url} target="_blank" rel="noreferrer">
                        {shortSha(commit.sha)}
                      </a>
                    </td>
                    <td data-label="Message">{commit.message.split('\n')[0]}</td>
                    <td data-label="Author">{commit.author_name}</td>
                    <td data-label="When" title={stamp(commit.authored_at)}>
                      {timeAgo(commit.authored_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="section-head" style={{ marginTop: 32 }}>
          <h2 id="reviews-heading">Pull and merge requests</h2>
        </div>
        {reviews.isPending ? (
          <LoadingRows label="Loading reviews" />
        ) : reviews.isError ? (
          <ErrorState error={reviews.error} what="reviews" onRetry={() => reviews.refetch()} />
        ) : reviews.data.length === 0 ? (
          <EmptyState>No open or recent pull requests in the cache.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="ledger stack-mobile" aria-labelledby="reviews-heading">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">Title</th>
                  <th scope="col">Branches</th>
                  <th scope="col">State</th>
                  <th scope="col">Checks</th>
                </tr>
              </thead>
              <tbody>
                {reviews.data.map((review) => (
                  <tr key={review.id}>
                    <td data-label="Number" className="num">
                      <a href={review.url} target="_blank" rel="noreferrer">
                        {review.number}
                      </a>
                    </td>
                    <td data-label="Title">{review.title}</td>
                    <td data-label="Branches" className="mono small">
                      {review.source_branch} → {review.target_branch}
                    </td>
                    <td data-label="State">{label(review.state)}</td>
                    <td data-label="Checks">
                      <Status
                        tone={
                          review.checks_status === 'success'
                            ? 'pass'
                            : review.checks_status === 'failure'
                              ? 'fail'
                              : review.checks_status === 'pending'
                                ? 'run'
                                : 'idle'
                        }
                      >
                        {label(review.checks_status)}
                      </Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="branches-heading">
        <div className="section-head">
          <h2 id="branches-heading">Branches</h2>
        </div>
        {branches.isPending ? (
          <LoadingRows label="Loading branches" />
        ) : branches.isError ? (
          <ErrorState error={branches.error} what="branches" onRetry={() => branches.refetch()} />
        ) : branches.data.length === 0 ? (
          <EmptyState>No branches cached yet.</EmptyState>
        ) : (
          <ul className="feed">
            {branches.data.map((branch) => (
              <li key={branch.name} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span className="mono">{branch.name}</span>
                <span className="mono small muted">
                  {shortSha(branch.sha)}
                  {branch.protected ? ' · protected' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

const AUTONOMY: AutonomyLevel[] = ['observe', 'assist', 'autonomous_dev', 'restricted_release'];
const RUNTIMES: RuntimePreference[] = ['paseo', 'orca', 'direct_cli'];

export function ProjectSettingsTab() {
  const projectId = useProjectId();
  const project = useProject(projectId);
  if (!project.data) return null;
  return <ProjectSettingsForm project={project.data} />;
}

function ProjectSettingsForm({ project }: { project: ProjectSummary }) {
  const update = useUpdateProject(project.id);
  const archive = useArchiveProject(project.id);
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [branch, setBranch] = useState(project.repository?.default_branch ?? 'main');
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(project.autonomy_level);
  const [runtime, setRuntime] = useState<RuntimePreference>(project.runtime_preference);
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const role = session.data?.user.role;
  const canRaise = role === 'owner' || role === 'admin';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        default_branch: branch.trim(),
        autonomy_level: autonomy,
        runtime_preference: runtime,
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <div className="split">
      <section aria-labelledby="project-settings-heading">
        <div className="section-head">
          <h2 id="project-settings-heading">Project settings</h2>
        </div>
        <form className="stack panel panel-body" onSubmit={submit}>
          <Field label="Name" htmlFor="ps-name">
            <input
              id="ps-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="ps-description">
            <textarea
              id="ps-description"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Default branch" htmlFor="ps-branch">
            <input
              id="ps-branch"
              type="text"
              className="mono"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </Field>
          <Field
            label="Autonomy"
            htmlFor="ps-autonomy"
            hint={
              canRaise
                ? 'How far agents may act without asking. Release actions always need an approval.'
                : 'Only an owner or admin can raise autonomy.'
            }
          >
            <select
              id="ps-autonomy"
              value={autonomy}
              onChange={(e) => setAutonomy(e.target.value as AutonomyLevel)}
            >
              {AUTONOMY.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Runtime preference" htmlFor="ps-runtime" hint={NOT_IMPLEMENTED.execution}>
            <select
              id="ps-runtime"
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as RuntimePreference)}
            >
              {RUNTIMES.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </Field>
          <FormError error={update.error} />
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={update.isPending}>
              {update.isPending ? 'Saving' : 'Save project settings'}
            </button>
            <span aria-live="polite" className="small muted">
              {saved ? 'Saved.' : ''}
            </span>
          </div>
        </form>
      </section>

      <section aria-labelledby="archive-heading">
        <div className="section-head">
          <h2 id="archive-heading">Archive</h2>
        </div>
        <div className="panel panel-body stack">
          <p>
            Archiving removes the project from the dashboard. The remote repository is not touched,
            and the activity timeline is kept.
          </p>
          <label className="row small" htmlFor="archive-confirm">
            <input
              id="archive-confirm"
              type="checkbox"
              checked={confirm}
              onChange={(event) => setConfirm(event.target.checked)}
            />
            I understand {project.name} leaves the dashboard.
          </label>
          <FormError error={archive.error} />
          <div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!confirm || archive.isPending}
              title={!confirm ? 'Tick the confirmation first' : undefined}
              onClick={() =>
                archive.mutate(undefined, { onSuccess: () => navigate({ to: '/projects' }) })
              }
            >
              {archive.isPending ? 'Archiving' : `Archive ${project.name}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
