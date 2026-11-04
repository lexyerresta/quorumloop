import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE, uuidv7 } from '@quorumloop/platform';
import {
  commitsCache,
  repositoryMirrors,
  reviewRequestsCache,
  schema,
  type CommitRow,
  type MirrorRow,
  type ReviewRow,
} from '../database/schema';
import type { ForgeCommit, ForgeRepository, ForgeReview } from '../forge/forge.port';

export interface SyncPatch {
  headSha: string | null;
  headMessage: string | null;
  headCommittedAt: Date | null;
  openReviews: number;
  defaultBranch: string;
  stale: boolean;
  syncedAt: Date;
}

@Injectable()
export class MirrorRepository {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findForProject(orgId: string, projectId: string): Promise<MirrorRow | null> {
    const rows = await this.db
      .select()
      .from(repositoryMirrors)
      .where(and(eq(repositoryMirrors.orgId, orgId), eq(repositoryMirrors.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(orgId: string, mirrorId: string): Promise<MirrorRow | null> {
    const rows = await this.db
      .select()
      .from(repositoryMirrors)
      .where(and(eq(repositoryMirrors.orgId, orgId), eq(repositoryMirrors.id, mirrorId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Mirrors bound to a remote repository, across organizations. A webhook carries no org scope,
   * so every organization that imported the repository must be reconciled.
   */
  async listByRemoteRepository(forge: string, remoteRepositoryId: string): Promise<MirrorRow[]> {
    return this.db
      .select()
      .from(repositoryMirrors)
      .where(
        and(
          eq(repositoryMirrors.forge, forge),
          eq(repositoryMirrors.remoteRepositoryId, remoteRepositoryId),
          sql`${repositoryMirrors.projectId} is not null`,
        ),
      );
  }

  /**
   * Creates or refreshes the mirror for a remote repository. Re-importing the same repository
   * reuses the row, so the commit cache is never orphaned.
   */
  async upsert(input: {
    id: string;
    orgId: string;
    connectionId: string;
    projectId: string | null;
    forge: string;
    repository: ForgeRepository;
    defaultBranch: string;
  }): Promise<MirrorRow> {
    const rows = await this.db
      .insert(repositoryMirrors)
      .values({
        id: input.id,
        orgId: input.orgId,
        connectionId: input.connectionId,
        projectId: input.projectId,
        forge: input.forge,
        remoteRepositoryId: input.repository.remoteId,
        fullName: input.repository.fullName,
        description: input.repository.description,
        isPrivate: input.repository.isPrivate,
        defaultBranch: input.repository.defaultBranch || input.defaultBranch,
        language: input.repository.language,
        webUrl: input.repository.webUrl,
      })
      .onConflictDoUpdate({
        target: [repositoryMirrors.connectionId, repositoryMirrors.remoteRepositoryId],
        set: {
          fullName: input.repository.fullName,
          description: input.repository.description,
          isPrivate: input.repository.isPrivate,
          defaultBranch: input.repository.defaultBranch || input.defaultBranch,
          language: input.repository.language,
          webUrl: input.repository.webUrl,
          projectId: input.projectId,
          updatedAt: new Date(),
        },
      })
      .returning();
    const saved = rows[0];
    if (!saved) {
      throw new Error('repository mirror upsert returned no row');
    }
    return saved;
  }

  async bindProject(mirrorId: string, projectId: string): Promise<void> {
    await this.db
      .update(repositoryMirrors)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(repositoryMirrors.id, mirrorId));
  }

  async updateSync(mirrorId: string, patch: SyncPatch): Promise<void> {
    await this.db
      .update(repositoryMirrors)
      .set({
        headSha: patch.headSha,
        headMessage: patch.headMessage,
        headCommittedAt: patch.headCommittedAt,
        openReviews: patch.openReviews,
        defaultBranch: patch.defaultBranch,
        stale: patch.stale,
        syncedAt: patch.syncedAt,
        updatedAt: new Date(),
      })
      .where(eq(repositoryMirrors.id, mirrorId));
  }

  /** Marks the mirror stale without touching the last known head, so the UI can say so. */
  async markStale(mirrorId: string): Promise<void> {
    await this.db
      .update(repositoryMirrors)
      .set({ stale: true, updatedAt: new Date() })
      .where(eq(repositoryMirrors.id, mirrorId));
  }

  async upsertCommits(
    mirrorId: string,
    branch: string,
    commits: readonly ForgeCommit[],
  ): Promise<number> {
    if (commits.length === 0) {
      return 0;
    }
    const rows = await this.db
      .insert(commitsCache)
      .values(
        commits.map((commit) => ({
          id: uuidv7(),
          mirrorId,
          branch,
          sha: commit.sha,
          message: commit.message,
          authorName: commit.authorName,
          authoredAt: commit.authoredAt,
          url: commit.url,
        })),
      )
      .onConflictDoUpdate({
        target: [commitsCache.mirrorId, commitsCache.sha],
        set: { branch, fetchedAt: new Date() },
      })
      .returning({ sha: commitsCache.sha });
    return rows.length;
  }

  async listCommits(mirrorId: string, branch: string, limit: number): Promise<CommitRow[]> {
    return this.db
      .select()
      .from(commitsCache)
      .where(and(eq(commitsCache.mirrorId, mirrorId), eq(commitsCache.branch, branch)))
      .orderBy(desc(commitsCache.authoredAt))
      .limit(limit);
  }

  async upsertReviews(
    mirrorId: string,
    reviews: readonly ForgeReview[],
  ): Promise<{ upserted: number; closed: number }> {
    const startedAt = new Date();
    for (const review of reviews) {
      await this.db
        .insert(reviewRequestsCache)
        .values({
          id: uuidv7(),
          mirrorId,
          forgeReviewId: review.remoteId,
          number: review.number,
          title: review.title,
          state: review.state,
          author: review.author,
          url: review.url,
          sourceBranch: review.sourceBranch,
          targetBranch: review.targetBranch,
          checksStatus: review.checksStatus,
          openedAt: review.openedAt,
          updatedAtRemote: review.updatedAt,
          fetchedAt: startedAt,
        })
        .onConflictDoUpdate({
          target: [reviewRequestsCache.mirrorId, reviewRequestsCache.forgeReviewId],
          set: {
            title: review.title,
            state: review.state,
            author: review.author,
            url: review.url,
            sourceBranch: review.sourceBranch,
            targetBranch: review.targetBranch,
            checksStatus: review.checksStatus,
            updatedAtRemote: review.updatedAt,
            fetchedAt: startedAt,
          },
        });
    }

    // Anything still open from an earlier fetch is no longer in the open list, so it closed.
    const closed = await this.db
      .update(reviewRequestsCache)
      .set({ state: 'closed' })
      .where(
        and(
          eq(reviewRequestsCache.mirrorId, mirrorId),
          lt(reviewRequestsCache.fetchedAt, startedAt),
          sql`${reviewRequestsCache.state} in ('open', 'draft')`,
        ),
      )
      .returning({ id: reviewRequestsCache.id });

    return { upserted: reviews.length, closed: closed.length };
  }

  async listReviews(mirrorId: string, limit: number): Promise<ReviewRow[]> {
    return this.db
      .select()
      .from(reviewRequestsCache)
      .where(eq(reviewRequestsCache.mirrorId, mirrorId))
      .orderBy(desc(reviewRequestsCache.updatedAtRemote))
      .limit(limit);
  }

  async reviewSummary(orgId: string): Promise<{ awaiting: number; failingChecks: number }> {
    const rows = await this.db
      .select({
        awaiting: sql<string>`count(*) filter (where ${reviewRequestsCache.state} in ('open', 'draft'))`,
        failing: sql<string>`count(*) filter (where ${reviewRequestsCache.checksStatus} = 'failure')`,
      })
      .from(reviewRequestsCache)
      .innerJoin(repositoryMirrors, eq(repositoryMirrors.id, reviewRequestsCache.mirrorId))
      .where(eq(repositoryMirrors.orgId, orgId));
    const row = rows[0];
    return {
      awaiting: Number(row?.awaiting ?? 0),
      failingChecks: Number(row?.failing ?? 0),
    };
  }
}
