import type { TaskStatus } from '@quorumloop/contracts';

/**
 * Kanban moves the product allows. Anything not listed here is rejected instead of silently
 * accepted, which is what keeps `done` meaningful.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['ready', 'canceled'],
  ready: ['in_progress', 'backlog', 'blocked', 'canceled'],
  in_progress: ['in_review', 'blocked', 'paused', 'failed', 'canceled'],
  in_review: ['in_progress', 'done', 'blocked', 'canceled'],
  blocked: ['ready', 'in_progress', 'canceled'],
  paused: ['in_progress', 'canceled'],
  failed: ['ready', 'canceled'],
  needs_human_approval: ['in_progress', 'blocked', 'canceled'],
  done: ['in_progress'],
  canceled: ['backlog'],
};

export const canTransitionTaskStatus = (from: TaskStatus, to: TaskStatus): boolean =>
  from === to || TRANSITIONS[from].includes(to);

/** The columns the board renders, in reading order. */
export const BOARD_COLUMNS: readonly TaskStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'blocked',
  'done',
];

export interface TransitionCheck {
  task: {
    status: TaskStatus;
    quality_state: string;
    acceptance_criteria: readonly { verified: boolean }[];
  };
  target: TaskStatus;
  blockingDependencies: readonly string[];
  inProgressCount: number;
  wipLimit: number;
  qualityGateRequired: boolean;
}

export type TransitionVerdict =
  { allowed: true } | { allowed: false; reason: string; evidenceRefs: string[] };

/**
 * A single function decides whether a move is legal, so the API and the UI can never disagree
 * about why a card refused to move. The reason text is written for a human reading the board.
 */
export const evaluateTransition = (check: TransitionCheck): TransitionVerdict => {
  const { task, target, blockingDependencies, inProgressCount, wipLimit } = check;

  if (task.status === target) {
    return { allowed: false, reason: `task is already ${label(target)}`, evidenceRefs: [] };
  }

  if (!canTransitionTaskStatus(task.status, target)) {
    return {
      allowed: false,
      reason: `cannot move a task from ${label(task.status)} to ${label(target)}`,
      evidenceRefs: [],
    };
  }

  if (target === 'in_progress') {
    if (blockingDependencies.length > 0) {
      return {
        allowed: false,
        reason: `waiting on ${blockingDependencies.length} unfinished dependenc${
          blockingDependencies.length === 1 ? 'y' : 'ies'
        }`,
        evidenceRefs: [...blockingDependencies],
      };
    }
    if (inProgressCount >= wipLimit) {
      return {
        allowed: false,
        reason: `work-in-progress limit reached (${inProgressCount}/${wipLimit})`,
        evidenceRefs: [],
      };
    }
  }

  if (target === 'done') {
    const unverified = task.acceptance_criteria.filter((criterion) => !criterion.verified).length;
    if (check.qualityGateRequired && task.quality_state !== 'passed') {
      return {
        allowed: false,
        reason:
          task.quality_state === 'not_run'
            ? 'quality gate has not run for this task'
            : `quality gate is ${task.quality_state.replace(/_/g, ' ')}`,
        evidenceRefs: [],
      };
    }
    if (unverified > 0) {
      return {
        allowed: false,
        reason: `${unverified} acceptance criteri${unverified === 1 ? 'on is' : 'a are'} not verified`,
        evidenceRefs: [],
      };
    }
  }

  return { allowed: true };
};

const label = (status: TaskStatus): string => status.replace(/_/g, ' ');

export interface DependencyEdge {
  taskId: string;
  dependsOnTaskId: string;
}

/**
 * Adding `task → dependsOn` must not create a cycle. Walk forward from the new prerequisite: if
 * we can reach the task itself, the edge would close a loop.
 */
export const wouldCreateCycle = (
  edges: readonly DependencyEdge[],
  taskId: string,
  dependsOnTaskId: string,
): boolean => {
  if (taskId === dependsOnTaskId) {
    return true;
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = adjacency.get(edge.taskId);
    if (bucket) {
      bucket.push(edge.dependsOnTaskId);
    } else {
      adjacency.set(edge.taskId, [edge.dependsOnTaskId]);
    }
  }
  // From the new prerequisite, can we already reach the task? Then the new edge closes a loop.
  const seen = new Set<string>([dependsOnTaskId]);
  const queue = [dependsOnTaskId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === taskId) {
      return true;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

/**
 * Reason a task is not startable, derived from its prerequisites. Empty means it is startable.
 */
export const blockingDependencies = (
  dependencies: readonly { id: string; status: TaskStatus }[],
): string[] =>
  dependencies
    .filter((dependency) => dependency.status !== 'done' && dependency.status !== 'canceled')
    .map((dependency) => dependency.id);

/** Board ordering: blockers first, then urgency, then creation order. */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const compareForBoard = (
  a: { priority: string; position: number; createdAt: Date },
  b: { priority: string; position: number; createdAt: Date },
): number => {
  const priority = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (priority !== 0) {
    return priority;
  }
  if (a.position !== b.position) {
    return a.position - b.position;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
};

/** Position for a new card: after the last one in its column. */
export const nextPosition = (positions: readonly number[]): number =>
  positions.length === 0 ? 1024 : Math.max(...positions) + 1024;

/** Reference keys are human-facing board ids, for example `QL-7`. */
export const formatReference = (projectSlug: string, sequence: number): string => {
  const prefix = projectSlug
    .split('-')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 3);
  return `${prefix || 'QL'}-${sequence}`;
};

const TITLE_LIMIT = 120;

/**
 * A direct instruction becomes a task, so its title is the first meaningful line of the prompt.
 * A bullet marker or a heading is stripped; a line too short to be a title falls back instead of
 * producing a card called "Do".
 */
export const deriveInstructionTitle = (prompt: string): string => {
  const firstLine = prompt
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:[-*•>]+|#{1,6})\s*/u, '').trim())
    .find((line) => line.length >= 3);

  if (!firstLine) {
    return 'Instruction from the composer';
  }
  if (firstLine.length <= TITLE_LIMIT) {
    return firstLine;
  }
  const cut = firstLine.slice(0, TITLE_LIMIT);
  const boundary = cut.lastIndexOf(' ');
  return boundary > TITLE_LIMIT / 2 ? cut.slice(0, boundary) : cut;
};

const SUMMARY_LIMIT = 160;

/** One-line gist of a prompt, used where a log entry or an event cannot carry the whole text. */
export const summariseInstruction = (prompt: string): string => {
  const flat = prompt.replace(/\s+/gu, ' ').trim();
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
};
