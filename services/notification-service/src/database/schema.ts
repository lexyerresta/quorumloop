import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * One row per durable event that a member should hear about. `source_event_id` is unique, so a
 * redelivered envelope cannot produce a second notification.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity').notNull().default('info'),
    sourceEventId: uuid('source_event_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_org_created_idx').on(table.orgId, table.createdAt),
    uniqueIndex('notifications_source_event_key').on(table.sourceEventId),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * Read state belongs to a member, not to the notification: two admins share the inbox but not their
 * reading. A missing row means "not read yet", which keeps the common case a left join.
 */
export const notificationReads = pgTable(
  'notification_reads',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.notificationId, table.userId] })],
);

export type NotificationReadRow = typeof notificationReads.$inferSelect;

export const schema = { notifications, notificationReads };
