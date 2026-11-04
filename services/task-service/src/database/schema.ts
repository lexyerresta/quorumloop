import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    // Human-facing board key, for example `QL-14`. Unique per project.
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('backlog'),
    priority: text('priority').notNull().default('medium'),
    role: text('role').notNull().default('implementation'),
    agentSessionId: uuid('agent_session_id'),
    qualityState: text('quality_state').notNull().default('not_run'),
    position: doublePrecision('position').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tasks_project_reference_key').on(table.projectId, table.reference),
    index('tasks_project_status_idx').on(table.projectId, table.status),
    index('tasks_org_idx').on(table.orgId),
  ],
);

/** Directed edge: `task_id` cannot start before `depends_on_task_id` is done. */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    index('task_dependencies_depends_on_idx').on(table.dependsOnTaskId),
  ],
);

export const acceptanceCriteria = pgTable(
  'acceptance_criteria',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    verified: boolean('verified').notNull().default(false),
    evidenceRef: text('evidence_ref'),
    position: integer('position').notNull().default(0),
  },
  (table) => [index('acceptance_criteria_task_idx').on(table.taskId)],
);

export const taskHistory = pgTable(
  'task_history',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_history_task_idx').on(table.taskId, table.occurredAt)],
);

/** Per-project counters and board policy. One row per project, created on first task. */
export const projectBoards = pgTable('project_boards', {
  projectId: uuid('project_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  lastReference: integer('last_reference').notNull().default(0),
  wipLimit: integer('wip_limit').notNull().default(3),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  tasks,
  taskDependencies,
  acceptanceCriteria,
  taskHistory,
  projectBoards,
};
export type TaskRow = typeof tasks.$inferSelect;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type AcceptanceCriterionRow = typeof acceptanceCriteria.$inferSelect;
export type TaskHistoryRow = typeof taskHistory.$inferSelect;
export type ProjectBoardRow = typeof projectBoards.$inferSelect;
