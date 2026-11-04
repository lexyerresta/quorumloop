import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** One row per accepted delivery; duplicates bump a counter instead of adding a row. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id'),
    forge: text('forge').notNull(),
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    kind: text('kind').notNull(),
    remoteRepositoryId: text('remote_repository_id'),
    fullName: text('full_name'),
    status: text('status').notNull(),
    reason: text('reason'),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    payloadDigest: text('payload_digest').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_deliveries_key').on(table.forge, table.deliveryId),
    index('webhook_deliveries_received_idx').on(table.receivedAt),
  ],
);

/** Atomic replay protection. An expired key may be reclaimed. */
export const webhookReplayKeys = pgTable(
  'webhook_replay_keys',
  {
    forge: text('forge').notNull(),
    deliveryId: text('delivery_id').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.forge, table.deliveryId] }),
    index('webhook_replay_keys_expiry_idx').on(table.expiresAt),
  ],
);

export const ingestFailures = pgTable(
  'ingest_failures',
  {
    id: uuid('id').primaryKey(),
    forge: text('forge').notNull(),
    deliveryId: text('delivery_id'),
    reason: text('reason').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ingest_failures_received_idx').on(table.receivedAt)],
);

export const schema = {
  webhookDeliveries,
  webhookReplayKeys,
  ingestFailures,
};

export type DeliveryRow = typeof webhookDeliveries.$inferSelect;
