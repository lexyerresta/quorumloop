import { sql } from 'drizzle-orm';
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

/** A connected forge account. `sealedToken` holds AES-256-GCM output, never a plaintext token. */
export const forgeConnections = pgTable(
  'forge_connections',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    forge: text('forge').notNull(),
    label: text('label').notNull(),
    accountLogin: text('account_login'),
    baseUrl: text('base_url').notNull(),
    status: text('status').notNull().default('connected'),
    statusReason: text('status_reason'),
    authMode: text('auth_mode').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    sealedToken: text('sealed_token').notNull().default(''),
    installationId: text('installation_id'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('forge_connections_label_key').on(
      table.orgId,
      table.forge,
      sql`lower(${table.label})`,
    ),
    index('forge_connections_org_idx').on(table.orgId),
  ],
);

/** A cached remote repository. `stale` is a promise to the UI, not a retry counter. */
export const repositoryMirrors = pgTable(
  'repository_mirrors',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => forgeConnections.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    forge: text('forge').notNull(),
    remoteRepositoryId: text('remote_repository_id').notNull(),
    fullName: text('full_name').notNull(),
    description: text('description'),
    isPrivate: boolean('private').notNull().default(false),
    defaultBranch: text('default_branch').notNull(),
    language: text('language'),
    webUrl: text('web_url').notNull(),
    headSha: text('head_sha'),
    headMessage: text('head_message'),
    headCommittedAt: timestamp('head_committed_at', { withTimezone: true }),
    openReviews: integer('open_reviews'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    stale: boolean('stale').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_mirrors_remote_key').on(table.connectionId, table.remoteRepositoryId),
    uniqueIndex('repository_mirrors_project_key')
      .on(table.projectId)
      .where(sql`${table.projectId} is not null`),
    index('repository_mirrors_org_idx').on(table.orgId, table.forge),
  ],
);

export const commitsCache = pgTable(
  'commits_cache',
  {
    id: uuid('id').primaryKey(),
    mirrorId: uuid('mirror_id')
      .notNull()
      .references(() => repositoryMirrors.id, { onDelete: 'cascade' }),
    branch: text('branch').notNull(),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    authorName: text('author_name').notNull(),
    authoredAt: timestamp('authored_at', { withTimezone: true }).notNull(),
    url: text('url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('commits_cache_sha_key').on(table.mirrorId, table.sha),
    index('commits_cache_branch_idx').on(table.mirrorId, table.branch, table.authoredAt),
  ],
);

export const reviewRequestsCache = pgTable(
  'review_requests_cache',
  {
    id: uuid('id').primaryKey(),
    mirrorId: uuid('mirror_id')
      .notNull()
      .references(() => repositoryMirrors.id, { onDelete: 'cascade' }),
    forgeReviewId: text('forge_review_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    author: text('author').notNull(),
    url: text('url').notNull(),
    sourceBranch: text('source_branch').notNull(),
    targetBranch: text('target_branch').notNull(),
    checksStatus: text('checks_status').notNull().default('unknown'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    updatedAtRemote: timestamp('updated_at_remote', { withTimezone: true }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('review_requests_cache_remote_key').on(table.mirrorId, table.forgeReviewId),
    index('review_requests_cache_state_idx').on(table.mirrorId, table.state),
  ],
);

export const schema = {
  forgeConnections,
  repositoryMirrors,
  commitsCache,
  reviewRequestsCache,
};

export type ConnectionRow = typeof forgeConnections.$inferSelect;
export type MirrorRow = typeof repositoryMirrors.$inferSelect;
export type CommitRow = typeof commitsCache.$inferSelect;
export type ReviewRow = typeof reviewRequestsCache.$inferSelect;
