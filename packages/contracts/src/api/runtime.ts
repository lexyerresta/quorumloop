import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from '../ids';

export const ENGINE_IDS = ['claude_code', 'codex', 'opencode', 'qoder_cli'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_LABELS: Record<EngineId, string> = {
  claude_code: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  qoder_cli: 'Qoder CLI',
};

export const RUNTIME_IDS = ['paseo', 'orca', 'direct_cli'] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

/**
 * Connection status is derived from real probes. `unknown` is used when the probe cannot
 * prove a positive or negative state, never as a stand-in for "probably fine".
 */
export const ENGINE_STATUSES = [
  'not_installed',
  'installed_unauthenticated',
  'ready',
  'rate_limited',
  'quota_exhausted',
  'temporarily_unhealthy',
  'disabled',
  'unsupported',
  'unknown',
] as const;
export type EngineStatus = (typeof ENGINE_STATUSES)[number];

export const engineCapabilitySchema = z.object({
  headless_prompt: z.boolean(),
  stream_json: z.boolean(),
  permission_modes: z.array(z.string()),
  max_turns: z.boolean(),
  workspace_cwd: z.boolean(),
  native_paseo_provider: z.boolean(),
  orca_compatible: z.boolean(),
});
export type EngineCapability = z.infer<typeof engineCapabilitySchema>;

export const engineSchema = z.object({
  id: z.enum(ENGINE_IDS),
  label: z.string(),
  status: z.enum(ENGINE_STATUSES),
  status_reason: z.string(),
  version: z.string().nullable(),
  capabilities: engineCapabilitySchema,
  runtimes: z.array(z.enum(RUNTIME_IDS)),
  auth_hint: z.string(),
  checked_at: isoDateTimeSchema,
  notes: z.array(z.string()),
});
export type Engine = z.infer<typeof engineSchema>;

export const runtimeSchema = z.object({
  id: z.enum(RUNTIME_IDS),
  label: z.string(),
  status: z.enum(['ready', 'not_configured', 'unreachable', 'experimental', 'disabled']),
  status_reason: z.string(),
  version: z.string().nullable(),
  detail: z.string().nullable(),
  checked_at: isoDateTimeSchema,
});
export type Runtime = z.infer<typeof runtimeSchema>;

export const routingPolicySchema = z.object({
  mode: z.literal('priority_then_fallback'),
  priority: z.array(z.enum(ENGINE_IDS)),
  allow_per_project_override: z.boolean(),
  allow_per_role_override: z.boolean(),
  max_active_agents_global: z.number().int().min(1).max(32),
  max_active_agents_per_project: z.number().int().min(1).max(16),
  max_retries_per_engine: z.number().int().min(0).max(10),
  fallback_on: z.array(
    z.enum(['rate_limited', 'quota_exhausted', 'provider_unavailable', 'recoverable_cli_error']),
  ),
  never_fallback_on: z.array(
    z.enum([
      'policy_denied',
      'missing_repo_permission',
      'untrusted_workspace',
      'security_gate_failed',
      'unsupported_capability',
      'ambiguous_state_without_checkpoint',
    ]),
  ),
  cooldown_seconds_initial: z.number().int().min(30).max(3600),
  require_checkpoint_before_cross_engine_handoff: z.boolean(),
});
export type RoutingPolicy = z.infer<typeof routingPolicySchema>;

export const routeDecisionSchema = z.object({
  decision_id: idSchema,
  task_id: idSchema,
  project_id: idSchema,
  selected: z
    .object({
      engine_id: z.enum(ENGINE_IDS),
      runtime_id: z.enum(RUNTIME_IDS),
    })
    .nullable(),
  outcome: z.enum(['selected', 'no_candidate']),
  trace: z.array(
    z.object({
      engine_id: z.enum(ENGINE_IDS),
      accepted: z.boolean(),
      reason: z.string(),
    }),
  ),
  created_at: isoDateTimeSchema,
});
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export const WORKFLOW_STATUSES = [
  'queued',
  'leased',
  'running',
  'checkpointed',
  'handoff_pending',
  'completed',
  'failed',
  'canceled',
  'blocked',
  'paused',
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const AGENT_SESSION_STATUSES = [
  'created',
  'starting',
  'running',
  'awaiting_permission',
  'rate_limited',
  'checkpointing',
  'handoff_pending',
  'stopped',
  'failed',
  'finished',
  'unknown',
] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const runSchema = z.object({
  run_id: idSchema,
  task_id: idSchema,
  project_id: idSchema,
  status: z.enum(WORKFLOW_STATUSES),
  engine_id: z.enum(ENGINE_IDS).nullable(),
  runtime_id: z.enum(RUNTIME_IDS).nullable(),
  attempt_number: z.number().int().nonnegative(),
  fencing_token: z.number().int().nonnegative(),
  lease_expires_at: isoDateTimeSchema.nullable(),
  agent_session_id: idSchema.nullable(),
  agent_status: z.enum(AGENT_SESSION_STATUSES).nullable(),
  last_heartbeat_at: isoDateTimeSchema.nullable(),
  checkpoint_id: idSchema.nullable(),
  failure_class: z.string().nullable(),
  blocked_reason: z.string().nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type Run = z.infer<typeof runSchema>;

export const runEventSchema = z.object({
  id: idSchema,
  run_id: idSchema,
  sequence: z.number().int().nonnegative(),
  kind: z.string(),
  summary: z.string(),
  occurred_at: isoDateTimeSchema,
});
export type RunEvent = z.infer<typeof runEventSchema>;

export const executeTaskRequestSchema = z.object({
  engine_hint: z.enum(ENGINE_IDS).nullable().default(null),
  runtime_hint: z.enum(RUNTIME_IDS).nullable().default(null),
});
export type ExecuteTaskRequest = z.infer<typeof executeTaskRequestSchema>;

export const executeTaskResponseSchema = z.object({
  accepted: z.boolean(),
  run: runSchema.nullable(),
  decision: routeDecisionSchema.nullable(),
  reason: z.string(),
});
export type ExecuteTaskResponse = z.infer<typeof executeTaskResponseSchema>;
