import {
  EVENT_TYPES,
  DomainError,
  projectSummarySchema,
  type Branch,
  type CodeReview,
  type Commit,
  type Forge,
  type ProjectSummary,
  type SyncResult,
} from '@quorumloop/contracts';
import {
  EVENT_PUBLISHER,
  SERVICE_LOGGER,
  ServiceClient,
  uuidv7,
  type CallerIdentity,
  type TransactionalPublisher,
} from '@quorumloop/platform';
import type { ServiceLogger } from '@quorumloop/observability';
import { Inject, Injectable } from '@nestjs/common';
import type { ConnectionRow, MirrorRow } from '../database/schema';
import { ForgeFactory } from '../forge/forge.factory';
import type { ForgePort } from '../forge/forge.port';
import { ConnectionService } from '../connections/connection.service';
import { MirrorRepository } from './mirror.repository';

const COMMIT_LIMIT = 30;
const REVIEW_LIMIT = 30;
const BRANCH_LIMIT = 50;

/** A project whose repository facts are needed before a sync can run. */
interface BoundProject {
  project: ProjectSummary;
  connectionId: string;
  remoteRepositoryId: string;
}

/**
 * Reconciliation with the Git host. The forge is authoritative: this service caches what it read,
 * stamps it with a time, and projects the head commit back to project-service. Nothing here
 * invents a commit or a review to fill a gap.
 */
@Injectable()
export class SyncService {
  private readonly projects = new ServiceClient({ caller: 'source-control-service' });

  constructor(
    private readonly connections: ConnectionService,
    private readonly mirrors: MirrorRepository,
    private readonly forges: ForgeFactory,
    @Inject(EVENT_PUBLISHER) private readonly events: TransactionalPublisher,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async sync(identity: CallerIdentity, projectId: string): Promise<SyncResult> {
    const orgId = requireOrg(identity);
    const bound = await this.boundProject(identity, projectId);
    const connection = await this.connections.load(orgId, bound.connectionId);

    if (connection.status !== 'connected') {
      throw new DomainError(
        'PRECONDITION_FAILED',
        `the ${connection.forge} connection is ${connection.status}; test or reconnect it before syncing`,
      );
    }

    const port = await this.forges.forConnection(connection);
    const mirror = await this.ensureMirror(orgId, bound, connection, port);

    try {
      return await this.refresh(identity, orgId, bound, mirror, port);
    } catch (error) {
      await this.mirrors.markStale(mirror.id);
      this.logger.warn(
        {
          projectId,
          mirrorId: mirror.id,
          error: error instanceof Error ? error.message : 'unknown',
        },
        'repository sync failed; cache marked stale',
      );
      throw error;
    }
  }

  async commits(identity: CallerIdentity, projectId: string): Promise<Commit[]> {
    const orgId = requireOrg(identity);
    const mirror = await this.ensureSynced(identity, orgId, projectId);
    const rows = await this.mirrors.listCommits(mirror.id, mirror.defaultBranch, COMMIT_LIMIT);
    return rows.map((row) => ({
      sha: row.sha,
      message: row.message,
      author_name: row.authorName,
      authored_at: row.authoredAt.toISOString(),
      url: row.url,
    }));
  }

  async reviews(identity: CallerIdentity, projectId: string): Promise<CodeReview[]> {
    const orgId = requireOrg(identity);
    const mirror = await this.ensureSynced(identity, orgId, projectId);
    const rows = await this.mirrors.listReviews(mirror.id, REVIEW_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      state: row.state as CodeReview['state'],
      author: row.author,
      url: row.url,
      source_branch: row.sourceBranch,
      target_branch: row.targetBranch,
      checks_status: row.checksStatus as CodeReview['checks_status'],
      created_at: row.openedAt.toISOString(),
      updated_at: row.updatedAtRemote.toISOString(),
    }));
  }

  async branches(identity: CallerIdentity, projectId: string): Promise<Branch[]> {
    const orgId = requireOrg(identity);
    const bound = await this.boundProject(identity, projectId);
    const connection = await this.connections.load(orgId, bound.connectionId);
    const port = await this.forges.forConnection(connection);
    const branches = await port.listBranches(bound.remoteRepositoryId, BRANCH_LIMIT);
    return branches.map((branch) => ({
      name: branch.name,
      sha: branch.sha,
      protected: branch.isProtected,
    }));
  }

  async reviewSummary(orgId: string): Promise<{ awaiting: number; failing_checks: number }> {
    const summary = await this.mirrors.reviewSummary(orgId);
    return { awaiting: summary.awaiting, failing_checks: summary.failingChecks };
  }

  /**
   * A webhook names a repository, not a project. Every organization that imported it is
   * reconciled, and one organization's failure does not stop the others.
   */
  async syncByWebhook(forge: Forge, remoteRepositoryId: string): Promise<void> {
    const mirrors = await this.mirrors.listByRemoteRepository(forge, remoteRepositoryId);
    if (mirrors.length === 0) {
      this.logger.info(
        { forge, remoteRepositoryId },
        'webhook received for a repository no project has imported',
      );
      return;
    }

    const failures: string[] = [];
    for (const mirror of mirrors) {
      if (!mirror.projectId) {
        continue;
      }
      try {
        await this.sync({ orgId: mirror.orgId }, mirror.projectId);
      } catch (error) {
        failures.push(
          `${mirror.projectId}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    if (failures.length > 0) {
      // Throwing lets the consumer release its inbox claim and retry the whole delivery.
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `webhook reconciliation failed for ${failures.join('; ')}`,
        true,
      );
    }
  }

  /** Cached reads must not serve a mirror that was never filled or has gone stale. */
  private async ensureSynced(
    identity: CallerIdentity,
    orgId: string,
    projectId: string,
  ): Promise<MirrorRow> {
    const existing = await this.mirrors.findForProject(orgId, projectId);
    if (existing && !existing.stale) {
      return existing;
    }
    await this.sync(identity, projectId);
    const refreshed = await this.mirrors.findForProject(orgId, projectId);
    if (!refreshed) {
      throw new DomainError('NOT_FOUND', 'repository mirror not found after sync');
    }
    return refreshed;
  }

  private async boundProject(identity: CallerIdentity, projectId: string): Promise<BoundProject> {
    const project = await this.projects.request<ProjectSummary>(
      {
        target: 'project-service',
        method: 'GET',
        path: `/v1/projects/${encodeURIComponent(projectId)}`,
        identity,
      },
      projectSummarySchema,
    );
    if (!project.repository) {
      throw new DomainError('PRECONDITION_FAILED', 'this project has no repository yet');
    }
    const connectionId = project.repository.connection_id;
    const remoteRepositoryId = project.repository.remote_repository_id;
    if (!connectionId || !remoteRepositoryId) {
      throw new DomainError(
        'PRECONDITION_FAILED',
        'this repository was bound without a forge connection, so it cannot be synced',
      );
    }
    return { project, connectionId, remoteRepositoryId };
  }

  private async ensureMirror(
    orgId: string,
    bound: BoundProject,
    connection: ConnectionRow,
    port: ForgePort,
  ): Promise<MirrorRow> {
    const repository = await port.getRepository(bound.remoteRepositoryId);
    // The mirror adopts the project's repository id so the API exposes exactly one identifier.
    return this.mirrors.upsert({
      id: bound.project.repository?.repository_id ?? uuidv7(),
      orgId,
      connectionId: connection.id,
      projectId: bound.project.id,
      forge: connection.forge,
      repository,
      defaultBranch: bound.project.repository?.default_branch ?? repository.defaultBranch,
    });
  }

  private async refresh(
    identity: CallerIdentity,
    orgId: string,
    bound: BoundProject,
    mirror: MirrorRow,
    port: ForgePort,
  ): Promise<SyncResult> {
    const branch = mirror.defaultBranch;
    const commits = await port.listCommits(bound.remoteRepositoryId, branch, COMMIT_LIMIT);
    const reviews = await port.listReviews(bound.remoteRepositoryId, REVIEW_LIMIT);
    const head = commits[0];

    const commitsSynced = await this.mirrors.upsertCommits(mirror.id, branch, commits);
    const { upserted: reviewsSynced } = await this.mirrors.upsertReviews(mirror.id, reviews);
    const syncedAt = new Date();

    await this.mirrors.updateSync(mirror.id, {
      headSha: head?.sha ?? null,
      headMessage: head?.message ?? null,
      headCommittedAt: head?.authoredAt ?? null,
      openReviews: reviews.filter((review) => review.state === 'open' || review.state === 'draft')
        .length,
      defaultBranch: branch,
      stale: false,
      syncedAt,
    });

    await this.events.publish(
      EVENT_TYPES.repoSynced,
      {
        project_id: bound.project.id,
        repository_id: mirror.id,
        branch,
        head_sha: head?.sha ?? null,
        head_message: head?.message ?? null,
        head_committed_at: head?.authoredAt.toISOString() ?? null,
        open_reviews: reviews.length,
        synced_at: syncedAt.toISOString(),
        stale: false,
      },
      {
        orgId,
        projectId: bound.project.id,
        aggregateId: mirror.id,
        actor: identity.userId ?? 'source-control-service',
      },
    );

    const projectionFailure = await this.projectHead(identity, bound.project.id, {
      headSha: head?.sha ?? null,
      headMessage: head?.message ?? null,
      headCommittedAt: head?.authoredAt.toISOString() ?? null,
      openReviews: reviews.length,
      defaultBranch: branch,
    });

    this.logger.info(
      { projectId: bound.project.id, commits: commitsSynced, reviews: reviewsSynced },
      'repository synced',
    );

    return {
      project_id: bound.project.id,
      repository_id: mirror.id,
      synced_at: syncedAt.toISOString(),
      stale: false,
      commits_synced: commitsSynced,
      reviews_synced: reviewsSynced,
      reason: projectionFailure,
    };
  }

  /**
   * Pushes the observed head into project-service so the project list shows the real last commit.
   * A failed projection is reported in the sync result instead of silently disappearing.
   */
  private async projectHead(
    identity: CallerIdentity,
    projectId: string,
    head: {
      headSha: string | null;
      headMessage: string | null;
      headCommittedAt: string | null;
      openReviews: number;
      defaultBranch: string;
    },
  ): Promise<string | null> {
    try {
      await this.projects.command({
        target: 'project-service',
        method: 'POST',
        path: `/v1/projects/${encodeURIComponent(projectId)}/sync-projection`,
        body: {
          head_sha: head.headSha,
          head_message: head.headMessage,
          head_committed_at: head.headCommittedAt,
          open_reviews: head.openReviews,
          default_branch: head.defaultBranch,
          stale: false,
        },
        identity,
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn({ projectId, message }, 'head projection to project-service failed');
      return `the repository was refreshed, but project-service did not accept the head projection: ${message}`;
    }
  }
}

const requireOrg = (identity: CallerIdentity): string => {
  if (!identity.orgId) {
    throw new DomainError('UNAUTHENTICATED', 'an organization scope is required');
  }
  return identity.orgId;
};
