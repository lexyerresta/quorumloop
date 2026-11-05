import type { ProjectStatus, QualityState, TaskStatus } from '../api/types';

/**
 * Board lanes and legal moves. The server is the authority: it re-checks every transition and
 * answers `changed: false` with a reason. This copy only decides which moves to offer, and mirrors
 * services/task-service/src/tasks/task.rules.ts. Keep the two in step.
 */
export const BOARD_LANES: TaskStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'blocked',
  'done',
];

export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
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

export type Tone = 'pass' | 'run' | 'wait' | 'fail' | 'idle';

export function taskTone(status: TaskStatus): Tone {
  switch (status) {
    case 'done':
      return 'pass';
    case 'in_progress':
    case 'in_review':
      return 'run';
    case 'needs_human_approval':
    case 'paused':
      return 'wait';
    case 'blocked':
    case 'failed':
      return 'fail';
    default:
      return 'idle';
  }
}

export function qualityTone(state: QualityState): Tone {
  switch (state) {
    case 'passed':
      return 'pass';
    case 'running':
      return 'run';
    case 'failed':
      return 'fail';
    case 'inconclusive':
      return 'wait';
    default:
      return 'idle';
  }
}

export function projectTone(status: ProjectStatus): Tone {
  switch (status) {
    case 'connected':
      return 'pass';
    case 'syncing':
      return 'run';
    case 'read_only':
      return 'wait';
    case 'error':
      return 'fail';
    default:
      return 'idle';
  }
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  connected: 'Connected',
  syncing: 'Syncing',
  read_only: 'Read only',
  error: 'Error',
  idea: 'Idea, no repository',
  archived: 'Archived',
};

/**
 * Backend services that build and boot but expose no domain endpoints in this snapshot
 * (README "Status", KNOWN_LIMITATIONS.md). The overview endpoint reports their figures as 0
 * when the call fails, so the dashboard shows those figures as Unavailable instead.
 */
export const NOT_IMPLEMENTED = {
  quality: 'quality-service has no summary endpoint in this build, so no quality gate has run.',
  agents: 'agent-control-service is a scaffold in this build, so no agent sessions exist.',
  execution:
    'No execution runtime is connected in this build. Instructions are recorded as tasks and wait for one.',
} as const;
