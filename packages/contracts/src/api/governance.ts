import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';
import { routingPolicySchema } from './runtime';

export const AUTONOMY_LEVELS = [
  'observe',
  'assist',
  'autonomous_dev',
  'restricted_release',
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const policySchema = z.object({
  org_id: idSchema,
  autonomy_level: z.enum(AUTONOMY_LEVELS),
  wip_limit: z.number().int().min(1).max(50),
  quality_gate_required: z.boolean(),
  anti_slop_required: z.boolean(),
  demo_mode: z.boolean(),
  audit_retention_days: z.number().int().min(1).max(3650),
  provider_routing: routingPolicySchema,
  revision: z.number().int().nonnegative(),
  updated_at: isoDateTimeSchema,
});
export type Policy = z.infer<typeof policySchema>;

export const updatePolicyRequestSchema = policySchema
  .partial()
  .omit({ org_id: true, revision: true, updated_at: true });
export type UpdatePolicyRequest = z.infer<typeof updatePolicyRequestSchema>;

export const ACTIVITY_KINDS = [
  'project.created',
  'repo.connected',
  'repo.synced',
  'task.created',
  'task.transitioned',
  'instruction.received',
  'execution.leased',
  'execution.started',
  'execution.checkpointed',
  'execution.failed',
  'execution.completed',
  'quality.completed',
  'review.created',
  'approval.required',
  'agent.session.changed',
  'provider.limited',
  'planning.proposed',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const activityEventSchema = z.object({
  id: idSchema,
  org_id: idSchema,
  project_id: idSchema.nullable(),
  kind: z.enum(ACTIVITY_KINDS),
  summary: z.string(),
  actor: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  occurred_at: isoDateTimeSchema,
  metadata: z.record(z.string(), z.unknown()),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

/**
 * One page of the timeline. `next_cursor` is opaque to the client and is passed back unchanged;
 * a null cursor means the end of what the service is willing to serve in one page.
 */
export const activityFeedSchema = z.object({
  items: z.array(activityEventSchema),
  next_cursor: z.string().nullable(),
  /** Per-project rollup, present only when the feed was filtered to one project. */
  projection: z
    .object({
      last_event_at: isoDateTimeSchema,
      total_events: z.number().int().nonnegative(),
      alert_count: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ActivityFeed = z.infer<typeof activityFeedSchema>;

export const QUALITY_CHECK_STATUSES = ['passed', 'failed', 'skipped', 'inconclusive'] as const;
export const qualityCheckSchema = z.object({
  name: z.string(),
  status: z.enum(QUALITY_CHECK_STATUSES),
  tool: z.string().nullable(),
  summary: z.string(),
  evidence_ref: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
});
export type QualityCheck = z.infer<typeof qualityCheckSchema>;

export const qualityReportSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  task_id: idSchema.nullable(),
  attempt_id: idSchema.nullable(),
  status: z.enum(['passed', 'failed', 'inconclusive', 'running']),
  checks: z.array(qualityCheckSchema),
  design_version: z.string().nullable(),
  anti_slop_gate: z.enum(['pass', 'fail', 'not_run']),
  created_at: isoDateTimeSchema,
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

export const APPROVAL_ACTIONS = [
  'deploy_production',
  'publish_repository',
  'delete_remote_repository',
  'change_billing',
  'change_credentials',
  'disable_audit_logging',
  'run_outside_sandbox',
] as const;

export const approvalSchema = z.object({
  id: idSchema,
  org_id: idSchema,
  project_id: idSchema.nullable(),
  action: z.enum(APPROVAL_ACTIONS),
  summary: z.string(),
  requested_by: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  decided_by: z.string().nullable(),
  decided_at: isoDateTimeSchema.nullable(),
  /** The approver's reasoning, when they gave one. Null while the request is open. */
  note: z.string().nullable(),
  created_at: isoDateTimeSchema,
});
export type Approval = z.infer<typeof approvalSchema>;

export const decideApprovalRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
});
export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;

export const usageSummarySchema = z.object({
  org_id: idSchema,
  window_start: isoDateTimeSchema,
  window_end: isoDateTimeSchema,
  active_runs: z.number().int().nonnegative(),
  completed_runs: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  tokens: z
    .object({
      value: z.number().nonnegative(),
      source: z.enum(['provider', 'estimated']),
    })
    .nullable(),
  cost_usd: z
    .object({
      value: z.number().nonnegative(),
      source: z.enum(['provider', 'estimated']),
    })
    .nullable(),
  budget_usd: z.number().nonnegative().nullable(),
  notes: z.array(z.string()),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const instanceHealthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']),
  version: z.string(),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'degraded', 'down', 'unknown']),
      detail: z.string().nullable(),
    }),
  ),
  checked_at: isoDateTimeSchema,
});
export type InstanceHealth = z.infer<typeof instanceHealthSchema>;

/**
 * Count-only projections the gateway fans out to build the overview. They live in contracts so
 * the producing service and the aggregator cannot drift apart.
 */
export const taskSummarySchema = z.object({
  in_progress: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  by_status: z.record(z.string(), z.number().int().nonnegative()),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const reviewSummarySchema = z.object({
  awaiting: z.number().int().nonnegative(),
  failing_checks: z.number().int().nonnegative(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const qualitySummarySchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  anti_slop_failures: z.number().int().nonnegative(),
});
export type QualitySummary = z.infer<typeof qualitySummarySchema>;

export const agentSummarySchema = z.object({
  active: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  by_project: z.record(z.string(), z.number().int().nonnegative()),
});
export type AgentSummary = z.infer<typeof agentSummarySchema>;

export const overviewSchema = z.object({
  kpis: z.object({
    projects: z.number().int().nonnegative(),
    active_agents: z.number().int().nonnegative(),
    tasks_in_progress: z.number().int().nonnegative(),
    tasks_blocked: z.number().int().nonnegative(),
    reviews_awaiting: z.number().int().nonnegative(),
    quality_passed: z.number().int().nonnegative(),
  }),
  projects: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      forge: z.string().nullable(),
      repository_full_name: z.string().nullable(),
      branch: z.string().nullable(),
      head_sha: z.string().nullable(),
      head_message: z.string().nullable(),
      head_committed_at: isoDateTimeSchema.nullable(),
      active_agents: z.number().int().nonnegative(),
      tasks_blocked: z.number().int().nonnegative(),
      last_synced_at: isoDateTimeSchema.nullable(),
      stale: z.boolean(),
      status: z.string(),
    }),
  ),
  alerts: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(['warning', 'error']),
      summary: z.string(),
      project_id: idSchema.nullable(),
      occurred_at: isoDateTimeSchema,
    }),
  ),
  demo_mode: z.boolean(),
  generated_at: isoDateTimeSchema,
});
export type Overview = z.infer<typeof overviewSchema>;
