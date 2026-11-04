import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AutonomyLevel, RoutingPolicy } from '@quorumloop/contracts';

/**
 * One policy row per organization. `revision` is a monotonic counter, not a version of the schema:
 * every accepted write increments it and appends the resulting snapshot to `policyRevisions`, so an
 * operator can answer "what changed, when, and by whom" without a second write path.
 */
export const policies = pgTable('settings_policies', {
  orgId: uuid('org_id').primaryKey(),
  autonomyLevel: text('autonomy_level').notNull().default('assist'),
  wipLimit: integer('wip_limit').notNull().default(3),
  qualityGateRequired: boolean('quality_gate_required').notNull().default(true),
  antiSlopRequired: boolean('anti_slop_required').notNull().default(true),
  demoMode: boolean('demo_mode').notNull().default(false),
  auditRetentionDays: integer('audit_retention_days').notNull().default(365),
  providerRouting: jsonb('provider_routing').$type<RoutingPolicy>().notNull(),
  revision: integer('revision').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PolicyRow = typeof policies.$inferSelect;

/** Append-only history. The snapshot is the whole policy after the write, not a diff. */
export const policyRevisions = pgTable(
  'settings_policy_revisions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').$type<PolicySnapshot>().notNull(),
    actor: text('actor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('settings_policy_revisions_org_revision_key').on(table.orgId, table.revision),
    index('settings_policy_revisions_org_idx').on(table.orgId),
  ],
);

export type PolicyRevisionRow = typeof policyRevisions.$inferSelect;

/** The mutable part of a policy, without the org id or the revision bookkeeping. */
export interface PolicyValues {
  autonomyLevel: AutonomyLevel;
  wipLimit: number;
  qualityGateRequired: boolean;
  antiSlopRequired: boolean;
  demoMode: boolean;
  auditRetentionDays: number;
  providerRouting: RoutingPolicy;
}

export type PolicySnapshot = PolicyValues;

export const schema = { policies, policyRevisions };
