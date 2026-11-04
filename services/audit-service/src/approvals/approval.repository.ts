import { and, desc, eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '@quorumloop/platform';
import { approvals, schema, type ApprovalRow } from '../database/schema';
import type { ApprovalStatus } from './approval.rules';

/**
 * The gateway serves approvals as a single array, so the read has to be bounded: an organization
 * with years of history would otherwise stream its whole archive into one response.
 */
export const MAX_QUEUE_SIZE = 200;

/** Everything an event can say about a request. The decision is the only field that changes later. */
export interface NewApproval {
  id: string;
  orgId: string;
  projectId: string | null;
  action: string;
  summary: string;
  requestedBy: string;
  risk: string;
  createdAt: Date;
}

export interface DecideInput {
  orgId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
  actor: string;
  note: string | null;
  decidedAt: Date;
}

@Injectable()
export class ApprovalRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async list(orgId: string, status: ApprovalStatus | null): Promise<ApprovalRow[]> {
    const scoped = status
      ? and(eq(approvals.orgId, orgId), eq(approvals.status, status))
      : eq(approvals.orgId, orgId);

    return this.db
      .select()
      .from(approvals)
      .where(scoped)
      .orderBy(desc(approvals.createdAt))
      .limit(MAX_QUEUE_SIZE);
  }

  async findById(orgId: string, approvalId: string): Promise<ApprovalRow | null> {
    const rows = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.id, approvalId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Returns null when the approval already exists. The id comes from the producer, so a redelivered
   * event is a no-op instead of a second request for the same action.
   */
  async insertFromEvent(approval: NewApproval): Promise<ApprovalRow | null> {
    const rows = await this.db
      .insert(approvals)
      .values(approval)
      .onConflictDoNothing({ target: approvals.id })
      .returning();
    return rows[0] ?? null;
  }

  /**
   * The `pending` predicate is in the WHERE clause, not only in the caller's check: two admins
   * deciding at the same moment both pass a read, and only one of them may win the update.
   */
  async decide(input: DecideInput): Promise<ApprovalRow | null> {
    const rows = await this.db
      .update(approvals)
      .set({
        status: input.decision,
        decidedBy: input.actor,
        decidedAt: input.decidedAt,
        note: input.note,
      })
      .where(
        and(
          eq(approvals.orgId, input.orgId),
          eq(approvals.id, input.approvalId),
          eq(approvals.status, 'pending'),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
