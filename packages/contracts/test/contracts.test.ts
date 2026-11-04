import { describe, expect, it } from 'vitest';
import {
  EVENT_TYPES,
  buildEnvelope,
  eventEnvelopeSchema,
  eventPayloadSchemas,
  validatePayload,
  routingPolicySchema,
  taskSchema,
  TASK_STATUSES,
  ENGINE_IDS,
} from '../src';

const validEnvelopeInput = {
  eventId: '018f2b6c-1111-7000-8000-000000000001',
  eventType: EVENT_TYPES.taskCreated,
  version: 1,
  occurredAt: '2026-11-04T09:15:00.000Z',
  producer: 'task-service',
  orgId: '018f2b6c-1111-7000-8000-000000000002',
  projectId: '018f2b6c-1111-7000-8000-000000000003',
  aggregateId: '018f2b6c-1111-7000-8000-000000000004',
  correlationId: 'corr-1',
  payload: {
    task_id: '018f2b6c-1111-7000-8000-000000000004',
    project_id: '018f2b6c-1111-7000-8000-000000000003',
    title: 'Fix responsive navbar',
    status: 'backlog',
    priority: 'medium',
    source: 'user',
  },
};

describe('event envelope', () => {
  it('accepts a well formed envelope', () => {
    const envelope = buildEnvelope(validEnvelopeInput);
    expect(eventEnvelopeSchema.parse(envelope).event_type).toBe(EVENT_TYPES.taskCreated);
  });

  it('rejects a payload that does not match the catalog schema', () => {
    expect(() =>
      validatePayload(EVENT_TYPES.taskCreated, {
        task_id: 'not-a-uuid',
        project_id: validEnvelopeInput.projectId,
        title: 'x',
        status: 'backlog',
        priority: 'medium',
        source: 'user',
      }),
    ).toThrow();
  });

  it('covers every catalog entry with a schema', () => {
    for (const type of Object.values(EVENT_TYPES)) {
      expect(eventPayloadSchemas[type as keyof typeof eventPayloadSchemas]).toBeDefined();
    }
  });
});

describe('routing policy defaults', () => {
  it('parses the documented default policy', () => {
    const policy = routingPolicySchema.parse({
      mode: 'priority_then_fallback',
      priority: [...ENGINE_IDS],
      allow_per_project_override: true,
      allow_per_role_override: true,
      max_active_agents_global: 4,
      max_active_agents_per_project: 2,
      max_retries_per_engine: 2,
      fallback_on: [
        'rate_limited',
        'quota_exhausted',
        'provider_unavailable',
        'recoverable_cli_error',
      ],
      never_fallback_on: [
        'policy_denied',
        'missing_repo_permission',
        'untrusted_workspace',
        'security_gate_failed',
        'unsupported_capability',
        'ambiguous_state_without_checkpoint',
      ],
      cooldown_seconds_initial: 120,
      require_checkpoint_before_cross_engine_handoff: true,
    });
    expect(policy.priority[0]).toBe('claude_code');
  });
});

describe('task contract', () => {
  it('rejects an unknown task status', () => {
    expect(TASK_STATUSES).not.toContain('shipping');
    const result = taskSchema.safeParse({
      id: '018f2b6c-1111-7000-8000-000000000001',
      project_id: '018f2b6c-1111-7000-8000-000000000003',
      reference: 'T-1',
      title: 'Task',
      description: null,
      status: 'shipping',
      priority: 'medium',
      role: 'implementation',
      agent_session_id: null,
      quality_state: 'not_run',
      dependencies: [],
      blocked_by: [],
      acceptance_criteria: [],
      created_at: '2026-11-04T09:15:00.000Z',
      updated_at: '2026-11-04T09:15:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
