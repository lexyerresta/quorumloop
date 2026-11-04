import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Approvals materialize from `quorumloop.approval.required.v1`. The row is keyed by the approval id
 * the producer generated, so a redelivered event cannot create a second request for the same action,
 * and the decision is the only field that ever changes afterwards.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    requestedBy: text('requested_by').notNull(),
    risk: text('risk').notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('approvals_org_status_idx').on(table.orgId, table.status),
    index('approvals_org_created_idx').on(table.orgId, table.createdAt),
  ],
);

export type ApprovalRow = typeof approvals.$inferSelect;

export const schema = { approvals };
