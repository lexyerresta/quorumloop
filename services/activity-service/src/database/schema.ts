import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The sanitized activity log. `seq` is the cursor; `sourceEventId` is the deduplication key, so a
 * redelivered envelope updates nothing instead of adding a second timeline entry.
 */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id'),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    actor: text('actor').notNull(),
    severity: text('severity').notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('activity_events_source_key').on(table.sourceEventId),
    index('activity_events_org_seq_idx').on(table.orgId, table.seq),
    index('activity_events_project_seq_idx').on(table.projectId, table.seq),
    index('activity_events_org_severity_seq_idx').on(table.orgId, table.severity, table.seq),
  ],
);

/** Per-project rollup of the log, written by the same statement that appends an event. */
export const feedProjections = pgTable(
  'feed_projections',
  {
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
    totalEvents: bigint('total_events', { mode: 'number' }).notNull().default(0),
    alertCount: bigint('alert_count', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.projectId] })],
);

/** Where each client's stream stopped, so a reconnect without Last-Event-ID can still resume. */
export const sseOffsets = pgTable(
  'sse_offsets',
  {
    orgId: uuid('org_id').notNull(),
    clientKey: text('client_key').notNull(),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.clientKey] })],
);

export const schema = {
  activityEvents,
  feedProjections,
  sseOffsets,
};

export type ActivityRow = typeof activityEvents.$inferSelect;
export type ProjectionRow = typeof feedProjections.$inferSelect;
export type SseOffsetRow = typeof sseOffsets.$inferSelect;
