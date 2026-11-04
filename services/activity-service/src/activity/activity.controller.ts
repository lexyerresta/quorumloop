import { DomainError, type ActivityEvent, type ActivityFeed } from '@quorumloop/contracts';
import { requireOrgId } from '@quorumloop/platform';
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ActivityService } from './activity.service';

const feedQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * Read side of the timeline. Every route is scoped to the caller's organization — the gateway
 * forwards the scope, this service never trusts a project id from another organization.
 */
@Controller('v1')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('activity')
  feed(
    @Req() request: FastifyRequest,
    @Query('project_id') projectId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ActivityFeed> {
    const orgId = requireOrgId(request);
    const parsed = feedQuerySchema.safeParse({ project_id: projectId, cursor, limit });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError(
        'VALIDATION_FAILED',
        `${issue?.path.join('.') ?? 'query'} ${issue?.message ?? 'is invalid'}`,
      );
    }

    return this.activity.feed(orgId, {
      projectId: parsed.data.project_id ?? null,
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit ?? null,
    });
  }

  /** Warning and error entries only: the dashboard's alert list. */
  @Get('alerts')
  alerts(@Req() request: FastifyRequest): Promise<ActivityEvent[]> {
    return this.activity.alerts(requireOrgId(request));
  }
}
