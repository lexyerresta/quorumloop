import { approvalSchema } from '@quorumloop/contracts';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATUSES,
  canDecideApproval,
  isKnownApprovalAction,
  sortForQueue,
  type QueueEntry,
} from '../src/approvals/approval.rules';

const entry = (id: string, overrides: Partial<QueueEntry> = {}): QueueEntry & { id: string } => ({
  id,
  status: 'pending',
  risk: 'low',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('APPROVAL_STATUSES', () => {
  it('mirrors the contract instead of keeping a second copy of the set', () => {
    expect([...APPROVAL_STATUSES]).toEqual([...approvalSchema.shape.status.options]);
  });
});

describe('canDecideApproval', () => {
  it('accepts an open request', () => {
    expect(canDecideApproval('pending')).toBe(true);
  });

  it('refuses every status a decision already produced', () => {
    for (const status of ['approved', 'rejected', 'expired'] as const) {
      expect(canDecideApproval(status)).toBe(false);
    }
  });
});

describe('isKnownApprovalAction', () => {
  it('accepts the actions the contract lists', () => {
    expect(isKnownApprovalAction('deploy_production')).toBe(true);
    expect(isKnownApprovalAction('disable_audit_logging')).toBe(true);
  });

  it('rejects an action the contract does not list', () => {
    expect(isKnownApprovalAction('deploy_staging')).toBe(false);
    expect(isKnownApprovalAction('')).toBe(false);
  });
});

describe('sortForQueue', () => {
  it('puts requests that still need a decision above the ones already decided', () => {
    const decided = entry('decided', {
      status: 'approved',
      risk: 'high',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const open = entry('open', { risk: 'low' });

    expect(sortForQueue([decided, open]).map((row) => row.id)).toEqual(['open', 'decided']);
  });

  it('orders open requests from the riskiest down', () => {
    const sorted = sortForQueue([
      entry('low', { risk: 'low' }),
      entry('high', { risk: 'high' }),
      entry('medium', { risk: 'medium' }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(['high', 'medium', 'low']);
  });

  it('falls back to the newest request when status and risk tie', () => {
    const sorted = sortForQueue([
      entry('old', { createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      entry('new', { createdAt: new Date('2026-03-01T00:00:00.000Z') }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('ranks a risk value it does not recognise below every known one instead of throwing', () => {
    const sorted = sortForQueue([entry('unknown', { risk: 'critical' }), entry('low')]);

    expect(sorted.map((row) => row.id)).toEqual(['low', 'unknown']);
  });

  it('returns a new array so the caller keeps the order its query returned', () => {
    const rows = [entry('first', { risk: 'low' }), entry('second', { risk: 'high' })];
    const sorted = sortForQueue(rows);

    expect(sorted).not.toBe(rows);
    expect(rows.map((row) => row.id)).toEqual(['first', 'second']);
  });
});
