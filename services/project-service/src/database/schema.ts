import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * projects holds identity and policy for a unit of work. Counters are a read projection fed by
 * domain events, so they may lag; the UI shows the lag instead of recomputing on every request.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    forge: text('forge'),
    status: text('status').notNull().default('connected'),
    autonomyLevel: text('autonomy_level').notNull().default('assist'),
    runtimePreference: text('runtime_preference').notNull().default('paseo'),
    tasksTotal: integer('tasks_total').notNull().default(0),
    tasksInProgress: integer('tasks_in_progress').notNull().default(0),
    tasksBlocked: integer('tasks_blocked').notNull().default(0),
    activeAgents: integer('active_agents').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('projects_org_slug_key').on(table.orgId, table.slug),
    index('projects_org_idx').on(table.orgId),
  ],
);

/**
 * The binding is deliberately separate from the project row: relinking a repository is a normal
 * operation and it must not rewrite project identity or its audit trail.
 */
export const projectRepoBindings = pgTable(
  'project_repo_bindings',
  {
    projectId: uuid('project_id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    // Quorumloop-side identifier for the repository, referenced by other services as a logical id.
    repositoryId: uuid('repository_id').notNull(),
    forge: text('forge').notNull(),
    connectionId: uuid('connection_id'),
    remoteRepositoryId: text('remote_repository_id').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    headSha: text('head_sha'),
    headMessage: text('head_message'),
    headCommittedAt: timestamp('head_committed_at', { withTimezone: true }),
    openReviews: integer('open_reviews'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    // null means the freshness has never been established, which is different from "not stale".
    stale: boolean('stale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The remote repository may be bound to only one project per organization.
    uniqueIndex('project_repo_bindings_org_remote_key').on(
      table.orgId,
      table.forge,
      table.remoteRepositoryId,
    ),
  ],
);

/** Onboarding is a real job with an outcome; it is not a spinner that pretends to be one. */
export const onboardingRuns = pgTable(
  'onboarding_runs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    orgId: uuid('org_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    detail: text('detail'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('onboarding_runs_project_idx').on(table.projectId)],
);

export const schema = { projects, projectRepoBindings, onboardingRuns };
export type ProjectRow = typeof projects.$inferSelect;
export type RepoBindingRow = typeof projectRepoBindings.$inferSelect;
export type OnboardingRunRow = typeof onboardingRuns.$inferSelect;
