import {
  DomainError,
  createProjectRequestSchema,
  fromIdeaRequestSchema,
  importProjectRequestSchema,
  updateProjectRequestSchema,
  type ProjectSummary,
  type Role,
} from '@quorumloop/contracts';
import { getIdentity, parseWith, requireAnyRole, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ProjectService } from './project.service';

const WRITE_ROLES = ['owner', 'admin', 'developer'] as const;
const ADMIN_ROLES = ['owner', 'admin'] as const;

const syncProjectionSchema = z.object({
  head_sha: z.string().max(120).nullable().optional(),
  head_message: z.string().max(2000).nullable().optional(),
  head_committed_at: z.string().datetime().nullable().optional(),
  open_reviews: z.number().int().nonnegative().nullable().optional(),
  default_branch: z.string().min(1).max(200).optional(),
  stale: z.boolean(),
});

/**
 * Internal project API. The gateway forwards the caller's org, user and roles; every rule that
 * decides what those roles may do lives here, next to the data they protect.
 */
@Controller('v1/projects')
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(
    @Req() request: FastifyRequest,
    @Query('include_archived') includeArchived?: string,
  ): Promise<ProjectSummary[]> {
    return this.projects.list(requireOrgId(request), includeArchived === 'true');
  }

  @Post()
  create(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const identity = requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(createProjectRequestSchema, body);
    return this.projects.createManual(identity.orgId ?? '', identity.actor, input);
  }

  @Post('import')
  importRepository(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const identity = requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(importProjectRequestSchema, body);
    return this.projects.importRepository(identity.orgId ?? '', identity.actor, input);
  }

  @Post('from-idea')
  fromIdea(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const identity = requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(fromIdeaRequestSchema, body);
    return this.projects.fromIdea(identity.orgId ?? '', identity.actor, input);
  }

  @Get(':projectId')
  detail(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<ProjectSummary> {
    return this.projects.get(requireOrgId(request), projectId);
  }

  @Patch(':projectId')
  async update(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<ProjectSummary> {
    const identity = requireAnyRole(request, WRITE_ROLES);
    const input = parseWith(updateProjectRequestSchema, body);
    const role = (identity.roles[0] ?? 'viewer') as Role;
    return this.projects.update(identity.orgId ?? '', identity.actor, role, projectId, input);
  }

  @Delete(':projectId')
  async archive(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ ok: true }> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    await this.projects.archive(identity.orgId ?? '', identity.actor, projectId);
    return { ok: true };
  }

  @Get(':projectId/onboarding')
  async onboarding(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<unknown[]> {
    const runs = await this.projects.listOnboarding(requireOrgId(request), projectId);
    return runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      detail: run.detail,
      started_at: run.startedAt?.toISOString() ?? null,
      finished_at: run.finishedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
    }));
  }

  /**
   * Called by source-control-service after a refresh. A service caller has no roles, so the guard
   * is the signature plus the organization scope — not a role list that would be meaningless here.
   */
  @Post(':projectId/sync-projection')
  async applySync(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const identity = getIdentity(request);
    if (identity.userId) {
      throw new DomainError('FORBIDDEN', 'sync projections are accepted from services only');
    }
    const input = parseWith(syncProjectionSchema, body);
    await this.projects.applySyncProjection(identity.orgId ?? '', projectId, {
      headSha: input.head_sha,
      headMessage: input.head_message,
      headCommittedAt: input.head_committed_at,
      openReviews: input.open_reviews,
      defaultBranch: input.default_branch,
      stale: input.stale,
    });
    return { ok: true };
  }
}
