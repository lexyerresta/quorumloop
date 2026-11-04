import { EVENT_TYPES, type EventEnvelope } from '@quorumloop/contracts';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../src/activity/activity.cursor';
import { actorOf, clip, metadataOf, toActivity } from '../src/activity/activity.map';
import { SentWindow } from '../src/activity/sse.window';

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
  producer: 'project-service',
  org_id: '0192f0a0-0000-7000-8000-0000000000aa',
  project_id: null,
  aggregate_id: 'aggregate',
  correlation_id: 'correlation',
  causation_id: null,
  traceparent: null,
  data_classification: 'internal',
  payload,
  ...overrides,
});

describe('event to timeline mapping', () => {
  it('describes a created project with its source', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.projectCreated, {
        name: 'Quorumloop',
        slug: 'quorumloop',
        source: 'idea',
      }),
    );
    expect(record?.kind).toBe('project.created');
    expect(record?.severity).toBe('info');
    expect(record?.summary).toBe('Project "Quorumloop" created from idea');
  });

  it('takes the project scope from the envelope', () => {
    const record = toActivity(
      envelope(
        EVENT_TYPES.taskCreated,
        { title: 'Wire the board', status: 'backlog' },
        { project_id: 'p-1' },
      ),
    );
    expect(record?.projectId).toBe('p-1');
    expect(record?.summary).toBe('Task "Wire the board" created in backlog');
  });

  it('uses the payload project id when the envelope has no scope', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.taskCreated, { title: 'T', status: 'ready', project_id: 'p-2' }),
    );
    expect(record?.projectId).toBe('p-2');
  });

  it('shortens a synced head commit instead of dumping the payload', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.repoSynced, {
        branch: 'main',
        head_sha: 'abcdef1234567890',
        head_message: 'feat: add the composer',
      }),
    );
    expect(record?.summary).toBe('main at abcdef1: feat: add the composer');
  });

  it('reports a missing head as an unknown revision rather than inventing one', () => {
    const record = toActivity(envelope(EVENT_TYPES.repoSynced, { branch: 'main', head_sha: null }));
    expect(record?.summary).toBe('main refreshed at an unknown revision');
  });

  it('treats a failed execution as an error alert', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.executionFailed, {
        failure_class: 'RATE_LIMITED',
        message: 'all engines busy',
      }),
    );
    expect(record?.kind).toBe('execution.failed');
    expect(record?.severity).toBe('error');
    expect(record?.summary).toBe('RATE_LIMITED failed: all engines busy');
  });

  it('warns when a provider is limited', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.providerLimited, {
        engine_id: 'qoder',
        status: 'rate_limited',
        reason: 'limit reached',
      }),
    );
    expect(record?.kind).toBe('provider.limited');
    expect(record?.severity).toBe('warning');
  });

  it('keeps a passing quality gate informational and counts failing checks', () => {
    const passed = toActivity(
      envelope(EVENT_TYPES.qualityCompleted, { status: 'passed', checks: [{ status: 'passed' }] }),
    );
    expect(passed?.severity).toBe('info');
    expect(passed?.summary).toBe('Quality gate passed (1 checks)');

    const failed = toActivity(
      envelope(EVENT_TYPES.qualityCompleted, {
        status: 'failed',
        checks: [{ status: 'failed' }, { status: 'passed' }, { status: 'failed' }],
      }),
    );
    expect(failed?.severity).toBe('warning');
    expect(failed?.summary).toBe('Quality gate failed: 2 of 3 checks failed');
  });

  it('escalates a high-risk approval to an error', () => {
    const record = toActivity(
      envelope(EVENT_TYPES.approvalRequired, {
        action: 'deploy_production',
        summary: 'ship it',
        risk: 'high',
      }),
    );
    expect(record?.severity).toBe('error');
    expect(record?.kind).toBe('approval.required');
  });

  it('stays silent for events that would double a row or add no user value', () => {
    expect(toActivity(envelope(EVENT_TYPES.workflowRequested, {}))).toBeNull();
    expect(toActivity(envelope(EVENT_TYPES.repoWebhookReceived, {}))).toBeNull();
    expect(toActivity(envelope('quorumloop.something.else.v1', {}))).toBeNull();
  });
});

describe('actor attribution', () => {
  it('prefers the author recorded on the event', () => {
    expect(actorOf(envelope(EVENT_TYPES.instructionReceived, { author_id: 'user-7' }))).toBe(
      'user-7',
    );
  });

  it('falls back to the requester, then to the producing service', () => {
    expect(actorOf(envelope(EVENT_TYPES.workflowRequested, { requested_by: 'a@b.test' }))).toBe(
      'a@b.test',
    );
    expect(actorOf(envelope(EVENT_TYPES.projectCreated, {}))).toBe('project-service');
  });
});

describe('metadata sanitisation', () => {
  it('drops secrets and non-scalars', () => {
    const metadata = metadataOf({
      head_sha: 'abc',
      token: 'ghs_secret',
      prompt: 'internal reasoning',
      nested: { anything: true },
      nested_list: ['a'],
      count: 3,
      ok: false,
      missing: null,
    });
    expect(metadata).toEqual({ head_sha: 'abc', count: 3, ok: false, missing: null });
  });

  it('caps a long string', () => {
    const metadata = metadataOf({ head_message: 'x'.repeat(1000) });
    const value = metadata.head_message;
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeLessThanOrEqual(300);
  });
});

describe('summary clipping', () => {
  it('leaves a short line untouched and cuts a long one on a word boundary', () => {
    expect(clip('short line')).toBe('short line');
    const clipped = clip('alpha beta gamma delta', 12);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(12);
  });

  it('collapses whitespace so a summary stays on one line', () => {
    expect(clip('two\n\nlines   here')).toBe('two lines here');
  });
});

describe('feed cursor', () => {
  it('round-trips a sequence', () => {
    expect(decodeCursor(encodeCursor(42))).toBe(42);
    expect(decodeCursor(encodeCursor(0))).toBe(0);
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('refuses a cursor it did not issue', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(/valid activity cursor/u);
    expect(() => decodeCursor(Buffer.from('v1:-4').toString('base64url'))).toThrow(
      /valid activity cursor/u,
    );
    expect(() => decodeCursor(Buffer.from('v1:1.5').toString('base64url'))).toThrow(
      /valid activity cursor/u,
    );
  });
});

describe('sent window', () => {
  it('refuses to write the same sequence twice', () => {
    const window = new SentWindow();
    expect(window.has(5)).toBe(false);
    window.add(5);
    expect(window.has(5)).toBe(true);
    expect(window.reached).toBe(5);
  });

  it('tracks the highest sequence it has delivered', () => {
    const window = new SentWindow();
    window.add(3);
    window.add(9);
    window.add(7);
    expect(window.reached).toBe(9);
  });

  it('forgets the oldest entries once full, so memory stays bounded', () => {
    const window = new SentWindow(2);
    window.add(1);
    window.add(2);
    window.add(3);
    expect(window.has(1)).toBe(false);
    expect(window.has(2)).toBe(true);
    expect(window.has(3)).toBe(true);
    expect(window.reached).toBe(3);
  });

  it('reports no resume point before anything was written', () => {
    expect(new SentWindow().reached).toBeNull();
  });
});
