import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '@quorumloop/platform';
import {
  onboardingRuns,
  projectRepoBindings,
  projects,
  schema,
  type OnboardingRunRow,
  type ProjectRow,
  type RepoBindingRow,
} from '../database/schema';

export interface ProjectWithBinding {
  project: ProjectRow;
  binding: RepoBindingRow | null;
}

@Injectable()
export class ProjectRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async list(orgId: string, includeArchived = false): Promise<ProjectWithBinding[]> {
    const where = includeArchived
      ? eq(projects.orgId, orgId)
      : and(eq(projects.orgId, orgId), isNull(projects.archivedAt));

    const rows = await this.db
      .select({ project: projects, binding: projectRepoBindings })
      .from(projects)
      .leftJoin(projectRepoBindings, eq(projectRepoBindings.projectId, projects.id))
      .where(where)
      .orderBy(desc(sql`coalesce(${projects.lastActivityAt}, ${projects.createdAt})`));

    return rows.map((row) => ({ project: row.project, binding: row.binding ?? null }));
  }

  async findById(orgId: string, projectId: string): Promise<ProjectWithBinding | null> {
    const rows = await this.db
      .select({ project: projects, binding: projectRepoBindings })
      .from(projects)
      .leftJoin(projectRepoBindings, eq(projectRepoBindings.projectId, projects.id))
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
      .limit(1);
    const row = rows[0];
    return row ? { project: row.project, binding: row.binding ?? null } : null;
  }

  async findBindingByRemote(
    orgId: string,
    forge: string,
    remoteRepositoryId: string,
  ): Promise<RepoBindingRow | null> {
    const rows = await this.db
      .select()
      .from(projectRepoBindings)
      .where(
        and(
          eq(projectRepoBindings.orgId, orgId),
          eq(projectRepoBindings.forge, forge),
          eq(projectRepoBindings.remoteRepositoryId, remoteRepositoryId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async slugExists(orgId: string, slug: string): Promise<boolean> {
    const rows = await this.db
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)));
    return Number(rows[0]?.value ?? 0) > 0;
  }

  async insertProject(row: typeof projects.$inferInsert): Promise<ProjectRow> {
    const rows = await this.db.insert(projects).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('project insert returned no row');
    }
    return created;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    patch: Partial<typeof projects.$inferInsert>,
  ): Promise<ProjectRow | null> {
    const rows = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
      .returning();
    return rows[0] ?? null;
  }

  async deleteProject(orgId: string, projectId: string): Promise<void> {
    await this.db
      .delete(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)));
  }

  async upsertBinding(row: typeof projectRepoBindings.$inferInsert): Promise<RepoBindingRow> {
    const rows = await this.db
      .insert(projectRepoBindings)
      .values(row)
      .onConflictDoUpdate({
        target: projectRepoBindings.projectId,
        set: {
          orgId: row.orgId,
          forge: row.forge,
          connectionId: row.connectionId ?? null,
          remoteRepositoryId: row.remoteRepositoryId,
          fullName: row.fullName,
          defaultBranch: row.defaultBranch,
          updatedAt: new Date(),
        },
      })
      .returning();
    const saved = rows[0];
    if (!saved) {
      throw new Error('repository binding upsert returned no row');
    }
    return saved;
  }

  /**
   * Applies a sync projection. Only fields the caller actually observed are written, so a partial
   * refresh never blanks out the previous head commit.
   */
  async applySyncProjection(
    projectId: string,
    patch: {
      headSha?: string | null;
      headMessage?: string | null;
      headCommittedAt?: Date | null;
      openReviews?: number | null;
      defaultBranch?: string;
      stale: boolean;
    },
  ): Promise<void> {
    const set: Partial<typeof projectRepoBindings.$inferInsert> = {
      syncedAt: new Date(),
      stale: patch.stale,
      updatedAt: new Date(),
    };
    if (patch.headSha !== undefined) set.headSha = patch.headSha;
    if (patch.headMessage !== undefined) set.headMessage = patch.headMessage;
    if (patch.headCommittedAt !== undefined) set.headCommittedAt = patch.headCommittedAt;
    if (patch.openReviews !== undefined) set.openReviews = patch.openReviews;
    if (patch.defaultBranch !== undefined) set.defaultBranch = patch.defaultBranch;

    await this.db
      .update(projectRepoBindings)
      .set(set)
      .where(eq(projectRepoBindings.projectId, projectId));
  }

  async insertOnboardingRun(row: typeof onboardingRuns.$inferInsert): Promise<OnboardingRunRow> {
    const rows = await this.db.insert(onboardingRuns).values(row).returning();
    const created = rows[0];
    if (!created) {
      throw new Error('onboarding insert returned no row');
    }
    return created;
  }

  async finishOnboardingRun(
    runId: string,
    status: 'succeeded' | 'failed',
    detail: string | null,
  ): Promise<void> {
    await this.db
      .update(onboardingRuns)
      .set({ status, detail, finishedAt: new Date() })
      .where(eq(onboardingRuns.id, runId));
  }

  async listOnboardingRuns(projectId: string, limit = 10): Promise<OnboardingRunRow[]> {
    return this.db
      .select()
      .from(onboardingRuns)
      .where(eq(onboardingRuns.projectId, projectId))
      .orderBy(desc(onboardingRuns.createdAt))
      .limit(limit);
  }
}
