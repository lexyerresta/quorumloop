import {
  EVENT_TYPES,
  REDACTED_KEYS,
  type ActivityKind,
  type EventEnvelope,
} from '@quorumloop/contracts';

export type Severity = 'info' | 'warning' | 'error';

/** A timeline entry, before it is given an id and a sequence. */
export interface ActivityRecord {
  kind: ActivityKind;
  summary: string;
  actor: string;
  severity: Severity;
  /** Taken from the envelope, then from the payload — the envelope scope wins. */
  projectId: string | null;
  metadata: Record<string, unknown>;
}

const TEXT_LIMIT = 240;
const METADATA_TEXT_LIMIT = 300;
const METADATA_KEY_LIMIT = 48;

const text = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const count = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Keeps a one-line summary readable: collapse whitespace, then cut on a word boundary. */
export const clip = (value: string, limit = TEXT_LIMIT): string => {
  const flat = value.replace(/\s+/gu, ' ').trim();
  if (flat.length <= limit) {
    return flat;
  }
  const cut = flat.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
};

const shortSha = (payload: Record<string, unknown>): string => {
  const sha = text(payload, 'head_sha');
  return sha ? sha.slice(0, 7) : 'an unknown revision';
};

/**
 * The actor is whoever the event can prove acted: an author, a requester, a webhook sender, or —
 * when the event carries no human attribution — the service that produced it.
 */
export const actorOf = (envelope: EventEnvelope): string => {
  const payload = envelope.payload;
  return (
    text(payload, 'author_id') ??
    text(payload, 'requested_by') ??
    text(payload, 'actor') ??
    envelope.producer
  );
};

/**
 * Metadata is a whitelist, not a dump: scalars only, redacted keys dropped, long strings cut.
 * A prompt or a token must never reach the timeline even if a producer sent it by mistake.
 */
export const metadataOf = (payload: Record<string, unknown>): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      key.length > METADATA_KEY_LIMIT ||
      (REDACTED_KEYS as readonly string[]).includes(key.toLowerCase())
    ) {
      continue;
    }
    if (typeof value === 'string') {
      safe[key] = clip(value, METADATA_TEXT_LIMIT);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    }
  }
  return safe;
};

/**
 * Maps an event to a timeline entry. Two event types deliberately produce nothing:
 * `workflow.requested` is always followed by `execution.leased`, and `repo.webhook` is transport
 * noise whose user-visible consequence is `repo.synced`. Emitting both would double every row.
 */
export const toActivity = (envelope: EventEnvelope): ActivityRecord | null => {
  const payload = envelope.payload;
  const projectId =
    envelope.project_id ?? (typeof payload.project_id === 'string' ? payload.project_id : null);
  const base = { actor: actorOf(envelope), projectId, metadata: metadataOf(payload) };

  switch (envelope.event_type) {
    case EVENT_TYPES.projectCreated:
      return {
        ...base,
        kind: 'project.created',
        severity: 'info',
        summary: `Project "${text(payload, 'name') ?? 'untitled'}" created from ${text(payload, 'source') ?? 'an unknown source'}`,
      };

    case EVENT_TYPES.repoConnected:
      return {
        ...base,
        kind: 'repo.connected',
        severity: 'info',
        summary: `Repository ${text(payload, 'full_name') ?? 'unnamed'} connected through ${text(payload, 'forge') ?? 'a forge'}`,
      };

    case EVENT_TYPES.repoSynced: {
      const branch = text(payload, 'branch') ?? 'the default branch';
      const message = text(payload, 'head_message');
      return {
        ...base,
        kind: 'repo.synced',
        severity: 'info',
        summary: message
          ? `${branch} at ${shortSha(payload)}: ${clip(message, 120)}`
          : `${branch} refreshed at ${shortSha(payload)}`,
      };
    }

    case EVENT_TYPES.taskCreated:
      return {
        ...base,
        kind: 'task.created',
        severity: 'info',
        summary: `Task "${text(payload, 'title') ?? 'untitled'}" created in ${text(payload, 'status') ?? 'the backlog'}`,
      };

    case EVENT_TYPES.taskReady:
      return {
        ...base,
        kind: 'task.transitioned',
        severity: 'info',
        summary: `Task "${text(payload, 'title') ?? 'untitled'}" is ready to start`,
      };

    case EVENT_TYPES.taskCompleted: {
      const refs = payload.evidence_refs;
      const evidence = Array.isArray(refs) ? refs.length : 0;
      return {
        ...base,
        kind: 'task.transitioned',
        severity: 'info',
        summary: `Task completed with ${evidence} evidence reference${evidence === 1 ? '' : 's'}`,
      };
    }

    case EVENT_TYPES.executionLeased:
      return {
        ...base,
        kind: 'execution.leased',
        severity: 'info',
        summary: `${text(payload, 'engine_id') ?? 'An engine'} on ${text(payload, 'runtime_id') ?? 'a runtime'} took the task`,
      };

    case EVENT_TYPES.executionStarted:
      return {
        ...base,
        kind: 'execution.started',
        severity: 'info',
        summary: `Agent session started on ${text(payload, 'engine_id') ?? 'an engine'}`,
      };

    case EVENT_TYPES.executionCheckpointed:
      return {
        ...base,
        kind: 'execution.checkpointed',
        severity: 'info',
        summary: `Checkpoint saved at ${shortSha(payload)}${payload.safe === false ? ' (not verified safe)' : ''}`,
      };

    case EVENT_TYPES.executionFailed:
      return {
        ...base,
        kind: 'execution.failed',
        severity: 'error',
        summary: `${text(payload, 'failure_class') ?? 'Execution'} failed: ${clip(text(payload, 'message') ?? 'no reason given')}`,
      };

    case EVENT_TYPES.executionCompleted: {
      const files = count(payload, 'files_changed');
      return {
        ...base,
        kind: 'execution.completed',
        severity: 'info',
        summary: `${clip(text(payload, 'summary') ?? 'Execution completed')}${files === null ? '' : ` (${files} file${files === 1 ? '' : 's'} changed)`}`,
      };
    }

    case EVENT_TYPES.providerLimited:
      return {
        ...base,
        kind: 'provider.limited',
        severity: 'warning',
        summary: `${text(payload, 'engine_id') ?? 'A provider'} is ${text(payload, 'status') ?? 'limited'}: ${clip(text(payload, 'reason') ?? 'no reason given')}`,
      };

    case EVENT_TYPES.qualityCompleted: {
      const status = text(payload, 'status') ?? 'inconclusive';
      const checks = Array.isArray(payload.checks) ? payload.checks : [];
      const failed = checks.filter(
        (check) =>
          typeof check === 'object' &&
          check !== null &&
          (check as { status?: unknown }).status === 'failed',
      ).length;
      return {
        ...base,
        kind: 'quality.completed',
        severity: status === 'passed' ? 'info' : 'warning',
        summary:
          status === 'passed'
            ? `Quality gate passed (${checks.length} checks)`
            : `Quality gate ${status}${failed > 0 ? `: ${failed} of ${checks.length} checks failed` : ''}`,
      };
    }

    case EVENT_TYPES.reviewCreated: {
      const number = count(payload, 'number');
      return {
        ...base,
        kind: 'review.created',
        severity: 'info',
        summary:
          `Review ${number ? `#${number}` : ''} ${text(payload, 'state') ?? 'opened'}: ${clip(text(payload, 'title') ?? 'untitled')}`.trim(),
      };
    }

    case EVENT_TYPES.approvalRequired:
      return {
        ...base,
        kind: 'approval.required',
        severity: text(payload, 'risk') === 'high' ? 'error' : 'warning',
        summary: `Approval required for ${text(payload, 'action') ?? 'an action'}: ${clip(text(payload, 'summary') ?? 'no summary given')}`,
      };

    case EVENT_TYPES.agentSessionChanged:
      return {
        ...base,
        kind: 'agent.session.changed',
        severity: 'info',
        summary: `Agent session is now ${text(payload, 'status') ?? 'in an unknown state'}`,
      };

    case EVENT_TYPES.instructionReceived:
      return {
        ...base,
        kind: 'instruction.received',
        severity: 'info',
        summary: `Instruction received: ${clip(text(payload, 'summary') ?? 'no summary given')}`,
      };

    case EVENT_TYPES.planningProposed:
      return {
        ...base,
        kind: 'planning.proposed',
        severity: 'info',
        summary: `Plan proposed with ${count(payload, 'epics') ?? 0} epics and ${count(payload, 'tasks') ?? 0} tasks`,
      };

    default:
      // Unknown or deliberately silent (see the comment above). The consumer still acknowledges.
      return null;
  }
};
