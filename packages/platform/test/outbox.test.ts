import type { EventEnvelope } from '@quorumloop/contracts';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { appendOutbox } from '../src/messaging/outbox';

interface RecordedCall {
  strings: readonly string[];
  values: readonly unknown[];
}

/**
 * `createPostgres` hands the same client to Drizzle, and Drizzle replaces the json/jsonb
 * serialisers with an identity function. A `sql.json(envelope)` write then reaches the wire
 * encoder as a raw object and every event publish fails with ERR_INVALID_ARG_TYPE, which is
 * what took the running services down. The fake below has no `json` helper at all, so a
 * regression cannot pass quietly.
 */
const recordingSql = () => {
  const calls: RecordedCall[] = [];
  const sql = (strings: readonly string[], ...values: unknown[]): Promise<unknown[]> => {
    calls.push({ strings, values });
    return Promise.resolve([]);
  };
  return { sql: sql as unknown as Sql, calls };
};

const envelope: EventEnvelope = {
  event_id: '0193f2f0-0000-7000-8000-000000000000',
  event_type: 'project.created',
  version: 1,
  occurred_at: '2026-01-01T00:00:00.000Z',
  published_at: '2026-01-01T00:00:00.000Z',
  producer: 'project-service',
  org_id: 'org-1',
  project_id: 'project-1',
  aggregate_id: 'project-1',
  correlation_id: '0193f2f0-0000-7000-8000-000000000001',
  causation_id: null,
  traceparent: null,
  data_classification: 'internal',
  payload: { id: 'project-1', nested: { list: [1, 2] } },
};

describe('appendOutbox', () => {
  it('writes the envelope as serialised json, not as a raw object', async () => {
    const { sql, calls } = recordingSql();

    await appendOutbox(sql, 'project.created', envelope);

    const [call] = calls;
    expect(call).toBeDefined();
    expect(call?.values[3]).toBe(JSON.stringify(envelope));
    expect(typeof call?.values[3]).toBe('string');
  });

  it('casts the serialised envelope to jsonb in the statement', async () => {
    const { sql, calls } = recordingSql();

    await appendOutbox(sql, 'project.created', envelope);

    const statement = calls[0]?.strings.join('$') ?? '';
    expect(statement).toContain('insert into outbox_events');
    expect(statement).toContain('$::jsonb');
  });

  it('keeps the id, type, subject and timestamp as separate parameters', async () => {
    const { sql, calls } = recordingSql();

    await appendOutbox(sql, 'project.created', envelope);

    const values = calls[0]?.values ?? [];
    expect(values).toHaveLength(5);
    expect(values[0]).toBe(envelope.event_id);
    expect(values[1]).toBe('project.created');
    expect(values[2]).toBe('project.created');
    expect(values[4]).toBe(envelope.occurred_at);
  });
});
