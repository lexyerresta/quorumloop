import {
  EVENT_TYPES,
  DomainError,
  type AutonomyLevel,
  type CreateProjectRequest,
  type FromIdeaRequest,
  type ImportProjectRequest,
  type ProjectStatus,
  type ProjectSummary,
  type Role,
  type UpdateProjectRequest,
} from '@quorumloop/contracts';
import { uuidv7 } from '@quorumloop/platform';
import { Inject, Injectable } from '@nestjs/common';
import type { ServiceLogger } from '@quorumloop/observability';
import { EVENT_PUBLISHER, SERVICE_LOGGER, type TransactionalPublisher } from '@quorumloop/platform';
import {
  projects,
  type OnboardingRunRow,
  type ProjectRow,
  type RepoBindingRow,
} from '../database/schema';
import { ProjectRepository, type ProjectWithBinding } from './project.repository';
import {
  canSetAutonomyLevel,
  canTransitionProjectStatus,
  isValidRemoteRepositoryId,
  slugCandidate,
  slugifyProjectName,
} from './project.rules';

export type ProjectSource = 'import' | 'idea' | 'manual';

/**
 * Project lifecycle. The one rule worth restating: archiving a project never touches the remote
 * repository, and importing an already-bound repository opens the existing project instead of
 * creating a duplicate.
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: TransactionalPublisher,
    @Inject(SERVICE_LOGGER) private readonly logger: ServiceLogger,
  ) {}

  async list(orgId: string, includeArchived: boolean): Promise<ProjectSummary[]> {
    const rows = await this.repository.list(orgId, includeArchived);
    return rows.map(toSummary);
  }

  async get(orgId: string, projectId: string): Promise<ProjectSummary> {
    const found = await this.repository.findById(orgId, projectId);
    if (!found) {
      throw new DomainError('NOT_FOUND', 'project not found');
    }
    return toSummary(found);
  }

  async createManual(
    orgId: string,
    actor: string,
    input: CreateProjectRequest,
  ): Promise<ProjectSummary> {
    const slug = await this.reserveSlug(orgId, input.slug);
    const project = await this.repository.insertProject({
      id: uuidv7(),
      orgId,
      name: input.name,
      slug,
      description: input.description ?? null,
      forge: input.forge,
      status: input.forge && input.remote_repository_id ? 'connected' : 'idea',
      runtimePreference: input.runtime_preference,
    });

    if (input.forge && input.connection_id && input.remote_repository_id) {
      await this.bindRepository(orgId, project.id, {
        forge: input.forge,
        connectionId: input.connection_id,
        remoteRepositoryId: input.remote_repository_id,
        fullName: null,
        defaultBranch: input.default_branch,
      });
    }

    await this.publishCreated(project, 'manual', actor);
    this.logger.info({ projectId: project.id, slug }, 'project created');
    return this.get(orgId, project.id);
  }

  async importRepository(
    orgId: string,
    actor: string,
    input: ImportProjectRequest,
  ): Promise<ProjectSummary> {
    if (!isValidRemoteRepositoryId(input.remote_repository_id)) {
      throw new DomainError('VALIDATION_FAILED', 'remote repository id must be numeric');
    }

    // A second import of the same repository opens the existing project; it never clones twice.
    const existing = await this.repository.findBindingByRemote(
      orgId,
      input.forge,
      input.remote_repository_id,
    );
    if (existing) {
      this.logger.info(
        { projectId: existing.projectId, remote: input.remote_repository_id },
        'duplicate repository import resolved to existing project',
      );
      return this.get(orgId, existing.projectId);
    }

    const slug = await this.reserveSlug(orgId, input.slug);
    const project = await this.repository.insertProject({
      id: uuidv7(),
      orgId,
      name: input.name,
      slug,
      description: input.description ?? null,
      forge: input.forge,
      status: input.analyze_only ? 'read_only' : 'connected',
      runtimePreference: input.runtime_preference,
    });

    const binding = await this.bindRepository(orgId, project.id, {
      forge: input.forge,
      connectionId: input.connection_id,
      remoteRepositoryId: input.remote_repository_id,
      fullName: input.full_name ?? null,
      defaultBranch: input.default_branch,
    });

    await this.repository.insertOnboardingRun({
      id: uuidv7(),
      projectId: project.id,
      orgId,
      kind: 'repository_import',
      status: 'succeeded',
      detail: `bound ${binding.fullName}`,
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    await this.publishCreated(project, 'import', actor);
    await this.events.publish(
      EVENT_TYPES.repoConnected,
      {
        connection_id: binding.connectionId ?? uuidv7(),
        project_id: project.id,
        forge: binding.forge,
        repository_id: binding.repositoryId,
        full_name: binding.fullName,
        default_branch: binding.defaultBranch,
      },
      { orgId, projectId: project.id, aggregateId: project.id, actor },
    );

    this.logger.info({ projectId: project.id, slug }, 'repository imported');
    return this.get(orgId, project.id);
  }

  /**
   * Idea intake persists the project immediately so the user owns something durable. Planning is a
   * later, separate step: nothing here pretends a PRD already exists.
   */
  async fromIdea(orgId: string, actor: string, input: FromIdeaRequest): Promise<ProjectSummary> {
    const name = input.name ?? deriveProjectName(input.idea);
    const slug = await this.reserveSlug(orgId, slugifyProjectName(name));
    const project = await this.repository.insertProject({
      id: uuidv7(),
      orgId,
      name,
      slug,
      description: input.idea.slice(0, 2000),
      forge: null,
      status: 'idea',
      runtimePreference: input.runtime_preference,
    });

    await this.repository.insertOnboardingRun({
      id: uuidv7(),
      projectId: project.id,
      orgId,
      kind: 'idea_intake',
      status: 'succeeded',
      detail: 'idea captured; planning has not started',
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    await this.publishCreated(project, 'idea', actor);
    this.logger.info({ projectId: project.id, slug }, 'idea captured');
    return this.get(orgId, project.id);
  }

  async update(
    orgId: string,
    actor: string,
    role: Role,
    projectId: string,
    input: UpdateProjectRequest,
  ): Promise<ProjectSummary> {
    const found = await this.repository.findById(orgId, projectId);
    if (!found) {
      throw new DomainError('NOT_FOUND', 'project not found');
    }

    if (
      input.autonomy_level &&
      !canSetAutonomyLevel(role, found.project.autonomyLevel as AutonomyLevel, input.autonomy_level)
    ) {
      throw new DomainError(
        'FORBIDDEN',
        'only an owner or admin may raise a project autonomy level',
      );
    }

    const patch: Partial<typeof projects.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.runtime_preference !== undefined) patch.runtimePreference = input.runtime_preference;
    if (input.autonomy_level !== undefined) patch.autonomyLevel = input.autonomy_level;

    if (input.default_branch && found.binding) {
      await this.repository.upsertBinding({
        ...found.binding,
        defaultBranch: input.default_branch,
        updatedAt: new Date(),
      });
    }

    if (Object.keys(patch).length > 0) {
      const updated = await this.repository.updateProject(orgId, projectId, patch);
      if (!updated) {
        throw new DomainError('NOT_FOUND', 'project not found');
      }
    }

    this.logger.info({ projectId, actor, fields: Object.keys(patch) }, 'project updated');
    return this.get(orgId, projectId);
  }

  /**
   * Archive, not delete. The remote repository is never touched, and the local history stays so a
   * restore is possible.
   */
  async archive(orgId: string, actor: string, projectId: string): Promise<void> {
    const found = await this.repository.findById(orgId, projectId);
    if (!found) {
      throw new DomainError('NOT_FOUND', 'project not found');
    }
    if (!canTransitionProjectStatus(found.project.status as ProjectStatus, 'archived')) {
      throw new DomainError(
        'CONFLICT',
        `cannot archive a project while it is ${found.project.status}`,
      );
    }
    await this.repository.updateProject(orgId, projectId, {
      status: 'archived',
      archivedAt: new Date(),
    });
    this.logger.info({ projectId, actor }, 'project archived');
  }

  /**
   * Applies a sync result coming from source-control-service. Fields the caller did not observe
   * are left untouched, and mapping a missing project is a no-op rather than an error: a webhook
   * can legitimately arrive after a project was archived.
   */
  async applySyncProjection(
    orgId: string,
    projectId: string,
    patch: {
      headSha?: string | null;
      headMessage?: string | null;
      headCommittedAt?: string | null;
      openReviews?: number | null;
      defaultBranch?: string;
      stale: boolean;
    },
  ): Promise<void> {
    const found = await this.repository.findById(orgId, projectId);
    if (!found) {
      this.logger.warn({ projectId }, 'sync projection for unknown project ignored');
      return;
    }
    if (!found.binding) {
      return;
    }
    await this.repository.applySyncProjection(projectId, {
      headSha: patch.headSha,
      headMessage: patch.headMessage,
      headCommittedAt: patch.headCommittedAt ? new Date(patch.headCommittedAt) : undefined,
      openReviews: patch.openReviews,
      defaultBranch: patch.defaultBranch,
      stale: patch.stale,
    });
    await this.repository.updateProject(orgId, projectId, { lastActivityAt: new Date() });
  }

  async listOnboarding(orgId: string, projectId: string): Promise<OnboardingRunRow[]> {
    const found = await this.repository.findById(orgId, projectId);
    if (!found) {
      throw new DomainError('NOT_FOUND', 'project not found');
    }
    return this.repository.listOnboardingRuns(projectId);
  }

  private async bindRepository(
    orgId: string,
    projectId: string,
    input: {
      forge: 'github' | 'gitlab';
      connectionId: string | null;
      remoteRepositoryId: string;
      fullName: string | null;
      defaultBranch: string;
    },
  ): Promise<RepoBindingRow> {
    return this.repository.upsertBinding({
      projectId,
      orgId,
      repositoryId: uuidv7(),
      forge: input.forge,
      connectionId: input.connectionId,
      remoteRepositoryId: input.remoteRepositoryId,
      // A sync from source-control replaces this with the authoritative name.
      fullName: input.fullName ?? `${input.forge}#${input.remoteRepositoryId}`,
      defaultBranch: input.defaultBranch,
    });
  }

  /**
   * Slugs are unique per organization. Instead of failing the request on a collision, the next
   * free numeric suffix is claimed; the loop is bounded because a caller cannot craft an
   * unbounded slug space.
   */
  private async reserveSlug(orgId: string, desired: string): Promise<string> {
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const candidate = slugCandidate(desired, attempt);
      if (!(await this.repository.slugExists(orgId, candidate))) {
        return candidate;
      }
    }
    throw new DomainError('CONFLICT', `no free slug available for "${desired}"`);
  }

  private async publishCreated(
    project: ProjectRow,
    source: ProjectSource,
    actor: string,
  ): Promise<void> {
    await this.events.publish(
      EVENT_TYPES.projectCreated,
      {
        project_id: project.id,
        name: project.name,
        slug: project.slug,
        source,
        forge: project.forge,
      },
      {
        orgId: project.orgId,
        projectId: project.id,
        aggregateId: project.id,
        actor,
      },
    );
  }
}

const toSummary = (row: ProjectWithBinding): ProjectSummary => {
  const { project, binding } = row;
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    forge: project.forge as ProjectSummary['forge'],
    status: project.status as ProjectStatus,
    autonomy_level: project.autonomyLevel as ProjectSummary['autonomy_level'],
    runtime_preference: project.runtimePreference as ProjectSummary['runtime_preference'],
    repository: binding
      ? {
          repository_id: binding.repositoryId,
          connection_id: binding.connectionId,
          remote_repository_id: binding.remoteRepositoryId,
          full_name: binding.fullName,
          default_branch: binding.defaultBranch,
          head_sha: binding.headSha,
          head_message: binding.headMessage,
          head_committed_at: binding.headCommittedAt?.toISOString() ?? null,
          open_reviews: binding.openReviews,
          synced_at: binding.syncedAt?.toISOString() ?? null,
          stale: binding.stale ?? true,
        }
      : null,
    tasks_total: project.tasksTotal,
    tasks_in_progress: project.tasksInProgress,
    tasks_blocked: project.tasksBlocked,
    active_agents: project.activeAgents,
    last_activity_at: project.lastActivityAt?.toISOString() ?? null,
    created_at: project.createdAt.toISOString(),
  };
};

/** Fallback name for an idea that arrived without one: the first meaningful words of the brief. */
const deriveProjectName = (idea: string): string => {
  const firstClause = idea.split(/[.\n!?]/)[0] ?? idea;
  const words = firstClause.trim().split(/\s+/).slice(0, 6).join(' ');
  return words.length >= 2 ? words.slice(0, 120) : 'Untitled idea';
};
