import {
  FORGE,
  DomainError,
  connectForgeRequestSchema,
  type Branch,
  type CodeReview,
  type Commit,
  type Connection,
  type Forge,
  type RemoteRepoPage,
  type SyncResult,
} from '@quorumloop/contracts';
import { getIdentity, parseWith, requireAnyRole, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ConnectionService } from './connections/connection.service';
import { SyncService } from './repositories/sync.service';

const ADMIN_ROLES = ['owner', 'admin'] as const;
const WRITE_ROLES = ['owner', 'admin', 'developer'] as const;

/**
 * Internal source-control API. Credential management is admin-only; refreshing a repository is a
 * developer action because it spends forge rate limit.
 */
@Controller('v1')
export class SourceControlController {
  constructor(
    private readonly connections: ConnectionService,
    private readonly sync: SyncService,
  ) {}

  @Get('connections')
  list(@Req() request: FastifyRequest): Promise<Connection[]> {
    return this.connections.list(requireOrgId(request));
  }

  @Post('connections/:forge')
  async connect(
    @Req() request: FastifyRequest,
    @Param('forge') forge: string,
    @Body() body: unknown,
  ): Promise<Connection> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    if (!isForge(forge)) {
      throw new DomainError('NOT_FOUND', `unknown forge "${forge}"`);
    }
    const input = parseWith(connectForgeRequestSchema, body);
    return this.connections.connect(
      { orgId: identity.orgId ?? '', actor: identity.actor },
      forge,
      input,
    );
  }

  @Delete('connections/:connectionId')
  async disconnect(
    @Req() request: FastifyRequest,
    @Param('connectionId') connectionId: string,
  ): Promise<{ ok: true }> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    await this.connections.disconnect(identity.orgId ?? '', connectionId);
    return { ok: true };
  }

  /** Re-runs the credential check and reports what the host said, without guessing. */
  @Post('connections/:connectionId/test')
  test(
    @Req() request: FastifyRequest,
    @Param('connectionId') connectionId: string,
  ): Promise<Connection> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    return this.connections.test(identity.orgId ?? '', connectionId);
  }

  @Get('connections/:connectionId/repositories')
  repositories(
    @Req() request: FastifyRequest,
    @Param('connectionId') connectionId: string,
    @Query('cursor') cursor?: string,
  ): Promise<RemoteRepoPage> {
    return this.connections.repositories(
      requireOrgId(request),
      connectionId,
      cursor && cursor.length > 0 ? cursor : null,
    );
  }

  @Post('projects/:projectId/sync')
  resync(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<SyncResult> {
    requireAnyRole(request, WRITE_ROLES);
    return this.sync.sync(getIdentity(request), projectId);
  }

  @Get('projects/:projectId/commits')
  commits(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<Commit[]> {
    return this.sync.commits(getIdentity(request), projectId);
  }

  @Get('projects/:projectId/branches')
  branches(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<Branch[]> {
    return this.sync.branches(getIdentity(request), projectId);
  }

  @Get('projects/:projectId/reviews')
  reviews(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<CodeReview[]> {
    return this.sync.reviews(getIdentity(request), projectId);
  }

  /** Count-only projection consumed by the gateway overview. */
  @Get('reviews/summary')
  reviewSummary(
    @Req() request: FastifyRequest,
  ): Promise<{ awaiting: number; failing_checks: number }> {
    return this.sync.reviewSummary(requireOrgId(request));
  }
}

const isForge = (value: string): value is Forge => (FORGE as readonly string[]).includes(value);
