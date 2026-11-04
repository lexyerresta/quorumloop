import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

/**
 * Starter event catalog from PRD section 28.2. Subject names are Quorumloop contracts, not
 * vendor APIs. Adding a field is backward compatible; removing or retyping one requires a
 * new subject version.
 */
export const EVENT_TYPES = {
  projectCreated: 'quorumloop.project.created.v1',
  repoConnected: 'quorumloop.repo.connected.v1',
  repoSynced: 'quorumloop.repo.synced.v1',
  repoWebhookReceived: 'quorumloop.repo.webhook.v1',
  taskCreated: 'quorumloop.task.created.v1',
  taskReady: 'quorumloop.task.ready.v1',
  taskCompleted: 'quorumloop.task.completed.v1',
  workflowRequested: 'quorumloop.workflow.requested.v1',
  executionLeased: 'quorumloop.execution.leased.v1',
  executionStarted: 'quorumloop.execution.started.v1',
  executionCheckpointed: 'quorumloop.execution.checkpointed.v1',
  executionFailed: 'quorumloop.execution.failed.v1',
  executionCompleted: 'quorumloop.execution.completed.v1',
  providerLimited: 'quorumloop.provider.limited.v1',
  qualityCompleted: 'quorumloop.quality.completed.v1',
  reviewCreated: 'quorumloop.review.created.v1',
  approvalRequired: 'quorumloop.approval.required.v1',
  agentSessionChanged: 'quorumloop.agent.session.changed.v1',
  instructionReceived: 'quorumloop.instruction.received.v1',
  planningProposed: 'quorumloop.planning.proposed.v1',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const FORGE = ['github', 'gitlab'] as const;
export type Forge = (typeof FORGE)[number];

const idList = z.array(idSchema);

export const eventPayloadSchemas = {
  [EVENT_TYPES.projectCreated]: z.object({
    project_id: idSchema,
    name: z.string(),
    slug: z.string(),
    source: z.enum(['import', 'idea', 'manual']),
    forge: z.enum(FORGE).nullable(),
  }),
  [EVENT_TYPES.repoConnected]: z.object({
    connection_id: idSchema,
    project_id: idSchema,
    forge: z.enum(FORGE),
    repository_id: idSchema,
    full_name: z.string(),
    default_branch: z.string(),
  }),
  [EVENT_TYPES.repoSynced]: z.object({
    project_id: idSchema,
    repository_id: idSchema,
    branch: z.string(),
    head_sha: z.string().nullable(),
    head_message: z.string().nullable(),
    head_committed_at: isoDateTimeSchema.nullable(),
    open_reviews: z.number().int().nonnegative().nullable(),
    synced_at: isoDateTimeSchema,
    stale: z.boolean(),
  }),
  [EVENT_TYPES.repoWebhookReceived]: z.object({
    forge: z.enum(FORGE),
    delivery_id: z.string(),
    event: z.string(),
    kind: z.enum(['push', 'merge_request', 'review', 'other']),
    remote_repository_id: z.string().nullable(),
    full_name: z.string().nullable(),
    actor: z.string().nullable(),
    received_at: isoDateTimeSchema,
  }),
  [EVENT_TYPES.taskCreated]: z.object({
    task_id: idSchema,
    project_id: idSchema,
    title: z.string(),
    status: z.string(),
    priority: z.string(),
    source: z.enum(['user', 'product_lead', 'scheduler', 'import']),
  }),
  [EVENT_TYPES.taskReady]: z.object({
    task_id: idSchema,
    project_id: idSchema,
    title: z.string(),
    priority: z.string(),
    required_capabilities: z.array(z.string()),
    dependency_ids: idList,
  }),
  [EVENT_TYPES.taskCompleted]: z.object({
    task_id: idSchema,
    project_id: idSchema,
    completed_at: isoDateTimeSchema,
    evidence_refs: idList,
  }),
  [EVENT_TYPES.workflowRequested]: z.object({
    workflow_run_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    requested_by: z.string(),
    engine_hint: z.string().nullable(),
  }),
  [EVENT_TYPES.executionLeased]: z.object({
    lease_id: idSchema,
    workflow_run_id: idSchema,
    attempt_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    engine_id: z.string(),
    runtime_id: z.string(),
    fencing_token: z.number().int().positive(),
    expires_at: isoDateTimeSchema,
  }),
  [EVENT_TYPES.executionStarted]: z.object({
    attempt_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    agent_session_id: idSchema,
    engine_id: z.string(),
    runtime_id: z.string(),
    started_at: isoDateTimeSchema,
  }),
  [EVENT_TYPES.executionCheckpointed]: z.object({
    checkpoint_id: idSchema,
    attempt_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    safe: z.boolean(),
    head_sha: z.string().nullable(),
    created_at: isoDateTimeSchema,
  }),
  [EVENT_TYPES.executionFailed]: z.object({
    attempt_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    failure_class: z.enum([
      'AUTH_REQUIRED',
      'RATE_LIMITED',
      'RESOURCE_LIMIT',
      'PERMISSION_DENIED',
      'NETWORK_TRANSIENT',
      'INCOMPATIBLE',
      'UNSAFE_ACTION',
      'UNKNOWN',
    ]),
    message: z.string(),
    retryable: z.boolean(),
    checkpoint_id: idSchema.nullable(),
  }),
  [EVENT_TYPES.executionCompleted]: z.object({
    attempt_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    head_sha: z.string().nullable(),
    files_changed: z.number().int().nonnegative(),
    summary: z.string(),
  }),
  [EVENT_TYPES.providerLimited]: z.object({
    engine_id: z.string(),
    status: z.enum(['rate_limited', 'quota_exhausted', 'temporarily_unhealthy']),
    observed_at: isoDateTimeSchema,
    retry_after_seconds: z.number().int().nonnegative().nullable(),
    reason: z.string(),
  }),
  [EVENT_TYPES.qualityCompleted]: z.object({
    report_id: idSchema,
    task_id: idSchema,
    project_id: idSchema,
    attempt_id: idSchema.nullable(),
    status: z.enum(['passed', 'failed', 'inconclusive']),
    checks: z.array(z.object({ name: z.string(), status: z.string(), summary: z.string() })),
    evidence_refs: idList,
  }),
  [EVENT_TYPES.reviewCreated]: z.object({
    review_id: idSchema,
    project_id: idSchema,
    task_id: idSchema.nullable(),
    forge: z.enum(FORGE),
    number: z.number().int().positive(),
    url: z.string(),
    title: z.string(),
    state: z.string(),
  }),
  [EVENT_TYPES.approvalRequired]: z.object({
    approval_id: idSchema,
    org_id: idSchema,
    project_id: idSchema.nullable(),
    action: z.string(),
    summary: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
  }),
  [EVENT_TYPES.agentSessionChanged]: z.object({
    agent_session_id: idSchema,
    task_id: idSchema.nullable(),
    project_id: idSchema,
    status: z.string(),
    last_heartbeat_at: isoDateTimeSchema.nullable(),
  }),
  [EVENT_TYPES.instructionReceived]: z.object({
    instruction_id: idSchema,
    project_id: idSchema,
    task_id: idSchema,
    author_id: idSchema,
    summary: z.string(),
  }),
  [EVENT_TYPES.planningProposed]: z.object({
    idea_id: idSchema,
    project_id: idSchema.nullable(),
    proposal_id: idSchema,
    source: z.enum(['engine', 'template']),
    epics: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
  }),
} as const;

export type EventPayload<T extends keyof typeof eventPayloadSchemas> = z.infer<
  (typeof eventPayloadSchemas)[T]
>;

export const eventTypeList = Object.values(EVENT_TYPES);

export const isKnownEventType = (value: string): value is EventType =>
  (eventTypeList as readonly string[]).includes(value);

export const validatePayload = (
  eventType: EventType,
  payload: unknown,
): Record<string, unknown> => {
  const schema = eventPayloadSchemas[eventType];
  return schema.parse(payload) as Record<string, unknown>;
};
