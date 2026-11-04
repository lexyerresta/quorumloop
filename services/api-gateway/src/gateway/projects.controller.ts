import {
  activityFeedSchema,
  branchSchema,
  codeReviewSchema,
  commitSchema,
  createProjectRequestSchema,
  fromIdeaRequestSchema,
  importProjectRequestSchema,
  instructionRequestSchema,
  instructionResponseSchema,
  projectSummarySchema,
  updateProjectRequestSchema,
  type ActivityFeed,
  type Branch,
  type CodeReview,
  type Commit,
  type InstructionResponse,
  type ProjectSummary,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GatewayProxy } from './gateway-proxy';

const projectListSchema = z.array(projectSummarySchema);

/** Project, repository and instruction routes. Ownership stays in project-service. */
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get()
  list(@Req() request: FastifyRequest): Promise<ProjectSummary[]> {
    return this.proxy.call('project-service', 'GET', '/v1/projects', projectListSchema, {
      request,
    });
  }

  @Post()
  create(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const input = parseWith(createProjectRequestSchema, body);
    return this.proxy.call('project-service', 'POST', '/v1/projects', projectSummarySchema, {
      request,
      body: input,
    });
  }

  @Post('import')
  importProject(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const input = parseWith(importProjectRequestSchema, body);
    return this.proxy.call('project-service', 'POST', '/v1/projects/import', projectSummarySchema, {
      request,
      body: input,
    });
  }

  @Post('from-idea')
  fromIdea(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ProjectSummary> {
    const input = parseWith(fromIdeaRequestSchema, body);
    return this.proxy.call(
      'project-service',
      'POST',
      '/v1/projects/from-idea',
      projectSummarySchema,
      {
        request,
        body: input,
      },
    );
  }

  @Get(':projectId')
  detail(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<ProjectSummary> {
    return this.proxy.call(
      'project-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}`,
      projectSummarySchema,
      { request },
    );
  }

  @Patch(':projectId')
  update(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<ProjectSummary> {
    const input = parseWith(updateProjectRequestSchema, body);
    return this.proxy.call(
      'project-service',
      'PATCH',
      `/v1/projects/${encodeURIComponent(projectId)}`,
      projectSummarySchema,
      { request, body: input },
    );
  }

  @Delete(':projectId')
  async remove(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ ok: true }> {
    await this.proxy.command(
      'project-service',
      'DELETE',
      `/v1/projects/${encodeURIComponent(projectId)}`,
      { request },
    );
    return { ok: true };
  }

  @Get(':projectId/commits')
  commits(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<Commit[]> {
    return this.proxy.call(
      'source-control-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}/commits`,
      z.array(commitSchema),
      { request },
    );
  }

  @Get(':projectId/branches')
  branches(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<Branch[]> {
    return this.proxy.call(
      'source-control-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}/branches`,
      z.array(branchSchema),
      { request },
    );
  }

  @Get(':projectId/reviews')
  reviews(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<CodeReview[]> {
    return this.proxy.call(
      'source-control-service',
      'GET',
      `/v1/projects/${encodeURIComponent(projectId)}/reviews`,
      z.array(codeReviewSchema),
      { request },
    );
  }

  @Post(':projectId/instructions')
  instruct(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<InstructionResponse> {
    const input = parseWith(instructionRequestSchema, body);
    return this.proxy.call(
      'task-service',
      'POST',
      `/v1/projects/${encodeURIComponent(projectId)}/instructions`,
      instructionResponseSchema,
      { request, body: input },
    );
  }

  @Get(':projectId/activity')
  activity(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ActivityFeed> {
    const query = new URLSearchParams({ project_id: projectId });
    if (cursor) {
      query.set('cursor', cursor);
    }
    if (limit) {
      query.set('limit', limit);
    }
    return this.proxy.call(
      'activity-service',
      'GET',
      `/v1/activity?${query.toString()}`,
      activityFeedSchema,
      { request },
    );
  }
}
