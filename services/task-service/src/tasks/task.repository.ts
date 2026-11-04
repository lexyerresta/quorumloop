import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '@quorumloop/platform';
import {
  acceptanceCriteria,
  projectBoards,
  schema,
  taskDependencies,
  taskHistory,
  tasks,
  type AcceptanceCriterionRow,
  type ProjectBoardRow,
  type TaskDependencyRow,
  type TaskHistoryRow,
  type TaskRow,
} from '../database/schema';

export interface BoardData {
  board: ProjectBoardRow;
  tasks: TaskRow[];
  dependencies: TaskDependencyRow[];
  criteria: AcceptanceCriterionRow[];
}

@Injectable()
export class TaskRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * The board row is created on first use. `onConflictDoNothing` keeps this safe when two cards
   * are created at the same moment on an empty board.
   */
  async ensureBoard(orgId: string, projectId: string): Promise<ProjectBoardRow> {
    await this.db
      .insert(projectBoards)
      .values({ projectId, orgId })
      .onConflictDoNothing({ target: projectBoards.projectId });
    const rows = await this.db
      .select()
      .from(projectBoards)
      .where(eq(projectBoards.projectId, projectId))
      .limit(1);
    const board = rows[0];
    if (!board) {
      throw new Error('project board row missing after insert');
    }
    return board;
  }

  async setWipLimit(projectId: string, wipLimit: number): Promise<ProjectBoardRow> {
    const rows = await this.db
      .update(projectBoards)
      .set({ wipLimit, updatedAt: new Date() })
      .where(eq(projectBoards.projectId, projectId))
      .returning();
    const board = rows[0];
    if (!board) {
      throw new Error('project board row missing during wip update');
    }
    return board;
  }

  /** Allocates the next human-facing reference inside the board row's own lock. */
  async nextReference(orgId: string, projectId: string): Promise<number> {
    await this.ensureBoard(orgId, projectId);
    const rows = await this.db
      .update(projectBoards)
      .set({
        lastReference: sql`${projectBoards.lastReference} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(projectBoards.projectId, projectId))
      .returning({ value: projectBoards.lastReference });
    const value = rows[0]?.value;
    if (typeof value !== 'number') {
      throw new Error('reference allocation failed');
    }
    return value;
  }

  async board(orgId: string, projectId: string): Promise<BoardData> {
    const board = await this.ensureBoard(orgId, projectId);
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.position), desc(tasks.createdAt));

    const taskIds = taskRows.map((task) => task.id);
    const dependencyRows =
      taskIds.length === 0
        ? []
        : await this.db
            .select()
            .from(taskDependencies)
            .where(inArray(taskDependencies.taskId, taskIds));
    const criteriaRows =
      taskIds.length === 0
        ? []
        : await this.db
            .select()
            .from(acceptanceCriteria)
            .where(inArray(acceptanceCriteria.taskId, taskIds))
            .orderBy(asc(acceptanceCriteria.position));

    return { board, tasks: taskRows, dependencies: dependencyRows, criteria: criteriaRows };
  }

  async findTask(orgId: string, taskId: string): Promise<TaskRow | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertTask(row: typeof tasks.$inferInsert): Promise<TaskRow> {
    const rows = await this.db.insert(tasks).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('task insert returned no row');
    }
    return created;
  }

  async updateTask(
    orgId: string,
    taskId: string,
    patch: Partial<typeof tasks.$inferInsert>,
  ): Promise<TaskRow | null> {
    const rows = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)))
      .returning();
    return rows[0] ?? null;
  }

  async deleteTask(orgId: string, taskId: string): Promise<void> {
    await this.db.delete(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)));
  }

  async dependenciesOf(taskId: string): Promise<TaskDependencyRow[]> {
    return this.db.select().from(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  }

  async allDependenciesInProject(projectId: string): Promise<TaskDependencyRow[]> {
    const rows = await this.db
      .select({
        taskId: taskDependencies.taskId,
        dependsOnTaskId: taskDependencies.dependsOnTaskId,
        createdAt: taskDependencies.createdAt,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(tasks.projectId, projectId));
    return rows;
  }

  async dependenciesWithStatus(
    taskId: string,
  ): Promise<{ id: string; status: string; reference: string; title: string }[]> {
    return this.db
      .select({
        id: tasks.id,
        status: tasks.status,
        reference: tasks.reference,
        title: tasks.title,
      })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(eq(taskDependencies.taskId, taskId));
  }

  async insertDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    await this.db
      .insert(taskDependencies)
      .values({ taskId, dependsOnTaskId })
      .onConflictDoNothing();
  }

  async dependencyExists(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    const rows = await this.db
      .select({ value: count() })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnTaskId, dependsOnTaskId),
        ),
      );
    return Number(rows[0]?.value ?? 0) > 0;
  }

  async criteriaFor(taskId: string): Promise<AcceptanceCriterionRow[]> {
    return this.db
      .select()
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.taskId, taskId))
      .orderBy(asc(acceptanceCriteria.position));
  }

  async insertCriteria(rows: (typeof acceptanceCriteria.$inferInsert)[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db.insert(acceptanceCriteria).values(rows);
  }

  async setCriterionVerified(
    taskId: string,
    criterionId: string,
    verified: boolean,
    evidenceRef: string | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(acceptanceCriteria)
      .set({ verified, evidenceRef })
      .where(and(eq(acceptanceCriteria.taskId, taskId), eq(acceptanceCriteria.id, criterionId)))
      .returning({ id: acceptanceCriteria.id });
    return rows.length > 0;
  }

  async countByStatus(projectId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: tasks.status, value: count() })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .groupBy(tasks.status);
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.value)]));
  }

  async countInProgress(projectId: string, excludeTaskId?: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'in_progress')));
    const total = Number(rows[0]?.value ?? 0);
    return excludeTaskId ? Math.max(0, total - 1) : total;
  }

  async appendHistory(row: typeof taskHistory.$inferInsert): Promise<void> {
    await this.db.insert(taskHistory).values(row);
  }

  async history(taskId: string): Promise<TaskHistoryRow[]> {
    return this.db
      .select()
      .from(taskHistory)
      .where(eq(taskHistory.taskId, taskId))
      .orderBy(asc(taskHistory.occurredAt));
  }

  async positionsInColumn(projectId: string, status: string): Promise<number[]> {
    const rows = await this.db
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
    return rows.map((row) => row.position);
  }

  async countOrgTasks(orgId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ status: tasks.status, value: count() })
      .from(tasks)
      .where(eq(tasks.orgId, orgId))
      .groupBy(tasks.status);
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.value)]));
  }

  /** Detects a duplicate title inside a project so planning cannot create the same task twice. */
  async findSimilar(projectId: string, title: string): Promise<TaskRow | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.projectId, projectId), sql`lower(${tasks.title}) = ${title.toLowerCase()}`),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
