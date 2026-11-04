import { EVENT_TYPES, type EventEnvelope } from '@quorumloop/contracts';
import { describe, expect, it } from 'vitest';
import { toNotification } from '../src/notifications/notification.rules';

const ORG = '0192f0a0-0000-7000-8000-0000000000aa';
const PROJECT = '0192f0a0-0000-7000-8000-0000000000bb';

const envelope = (
  eventType: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope => ({
  event_id: '0192f0a0-0000-7000-8000-000000000001',
  event_type: eventType,
  version: 1,
  occurred_at: '2026-01-01T10:00:00.000Z',
  published_at: '2026-01-01T10:00:00.000Z',
  producer: 'verification-publisher',
  org_id: ORG,
  project_id: null,
  aggregate_id: 'aggregate',
  correlation_id: 'correlation',
  causation_id: null,
  traceparent: null,
  data_classification: 'internal',
  payload,
  ...overrides,
});

const approval = (risk: 'low' | 'medium' | 'high'): EventEnvelope =>
  envelope(EVENT_TYPES.approvalRequired, {
    approval_id: '0192f0a0-0000-7000-8000-0000000000cc',
    org_id: ORG,
    project_id: PROJECT,
    action: 'deploy_production',
    summary: 'Deploy quorumloop 0.1.0',
    risk,
  });

describe('approval requests', () => {
  it('reads the action as words instead of leaving the identifier in the title', () => {
    expect(toNotification(approval('medium'))?.title).toBe('Approval needed: deploy production');
  });

  it('keeps the request summary as the body and carries the project through', () => {
    const content = toNotification(approval('low'));
    expect(content?.body).toBe('Deploy quorumloop 0.1.0');
    expect(content?.projectId).toBe(PROJECT);
    expect(content?.kind).toBe('approval.required');
  });

  it('warns only for the risk that warrants a second look', () => {
    expect(toNotification(approval('high'))?.severity).toBe('warning');
    expect(toNotification(approval('medium'))?.severity).toBe('info');
    expect(toNotification(approval('low'))?.severity).toBe('info');
  });

  it('produces nothing for an action the audit service would refuse to record', () => {
    const content = toNotification(
      envelope(EVENT_TYPES.approvalRequired, {
        approval_id: '0192f0a0-0000-7000-8000-0000000000cc',
        org_id: ORG,
        project_id: null,
        action: 'destroy_everything',
        summary: 'An action the contract does not list',
        risk: 'high',
      }),
    );
    expect(content).toBeNull();
  });

  it('produces nothing when the payload names another organization than its envelope', () => {
    const content = toNotification(
      envelope(EVENT_TYPES.approvalRequired, {
        approval_id: '0192f0a0-0000-7000-8000-0000000000cc',
        org_id: '0192f0a0-0000-7000-8000-0000000000ff',
        project_id: null,
        action: 'deploy_production',
        summary: 'Deploy quorumloop 0.1.0',
        risk: 'high',
      }),
    );
    expect(content).toBeNull();
  });
});

describe('review events', () => {
  it('titles the review by its number and keeps the forge in the body', () => {
    const content = toNotification(
      envelope(EVENT_TYPES.reviewCreated, {
        review_id: '0192f0a0-0000-7000-8000-0000000000dd',
        project_id: PROJECT,
        task_id: null,
        forge: 'github',
        number: 42,
        url: 'https://example.invalid/pull/42',
        title: 'Add the notification inbox',
        state: 'open',
      }),
    );

    expect(content?.title).toBe('Review #42 opened');
    expect(content?.body).toBe('Add the notification inbox (github)');
    expect(content?.severity).toBe('info');
  });
});

describe('events outside the inbox', () => {
  it('ignores an event type the notification service does not project', () => {
    expect(toNotification(envelope(EVENT_TYPES.taskCreated, {}))).toBeNull();
  });

  it('produces nothing from a payload that does not match its contract', () => {
    expect(
      toNotification(envelope(EVENT_TYPES.approvalRequired, { approval_id: 'nope' })),
    ).toBeNull();
  });
});
