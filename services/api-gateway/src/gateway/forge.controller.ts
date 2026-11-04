import {
  FORGE,
  DomainError,
  connectForgeRequestSchema,
  connectionSchema,
  remoteRepoPageSchema,
  syncResultSchema,
  type Connection,
  type RemoteRepoPage,
  type SyncResult,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GatewayProxy } from './gateway-proxy';

const FORGE_CONNECTION_TARGET = 'source-control-service';

/**
 * Forge connection and repository discovery routes. The access token never leaves the owning
 * service: the gateway only accepts it, forwards it once, and returns the connection record.
 */
@Controller('api/v1/forge')
export class ForgeController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get('connections')
  connections(@Req() request: FastifyRequest): Promise<Connection[]> {
    return this.proxy.call(
      FORGE_CONNECTION_TARGET,
      'GET',
      '/v1/connections',
      z.array(connectionSchema),
      { request },
    );
  }

  @Post('github/connect')
  connectGithub(@Req() request: FastifyRequest, @Body() body: unknown): Promise<Connection> {
    return this.connect(request, 'github', body);
  }

  @Post('gitlab/connect')
  connectGitlab(@Req() request: FastifyRequest, @Body() body: unknown): Promise<Connection> {
    return this.connect(request, 'gitlab', body);
  }

  @Delete('connections/:connectionId')
  async disconnect(
    @Req() request: FastifyRequest,
    @Param('connectionId') connectionId: string,
  ): Promise<{ ok: true }> {
    await this.proxy.command(
      FORGE_CONNECTION_TARGET,
      'DELETE',
      `/v1/connections/${encodeURIComponent(connectionId)}`,
      { request },
    );
    return { ok: true };
  }

  @Get('connections/:connectionId/repositories')
  repositories(
    @Req() request: FastifyRequest,
    @Param('connectionId') connectionId: string,
    @Query('cursor') cursor?: string,
  ): Promise<RemoteRepoPage> {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.proxy.call(
      FORGE_CONNECTION_TARGET,
      'GET',
      `/v1/connections/${encodeURIComponent(connectionId)}/repositories${suffix}`,
      remoteRepoPageSchema,
      { request },
    );
  }

  private connect(
    request: FastifyRequest,
    forge: (typeof FORGE)[number],
    body: unknown,
  ): Promise<Connection> {
    const input = parseWith(connectForgeRequestSchema, body);
    return this.proxy.call(
      FORGE_CONNECTION_TARGET,
      'POST',
      `/v1/connections/${forge}`,
      connectionSchema,
      { request, body: input },
    );
  }
}

/** Repository refresh. Splitting it out keeps the project route table about projects. */
@Controller('api/v1/projects')
export class ProjectSyncController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Post(':projectId/sync')
  sync(@Req() request: FastifyRequest, @Param('projectId') projectId: string): Promise<SyncResult> {
    if (!projectId) {
      throw new DomainError('VALIDATION_FAILED', 'project id is required');
    }
    return this.proxy.call(
      'source-control-service',
      'POST',
      `/v1/projects/${encodeURIComponent(projectId)}/sync`,
      syncResultSchema,
      { request },
    );
  }
}
