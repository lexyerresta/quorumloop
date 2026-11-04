import type { InstanceHealth, Overview } from '@quorumloop/contracts';
import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { InstanceAggregator } from './instance-aggregator.service';
import { Public } from './session.guard';

/**
 * `/api/v1/health` is intentionally public: the setup screen and container healthchecks call it
 * before any user exists. `/api/v1/overview` is scoped and aggregated on the caller's behalf.
 */
@Controller('api/v1')
export class OverviewController {
  constructor(private readonly aggregator: InstanceAggregator) {}

  @Public()
  @Get('health')
  health(): Promise<InstanceHealth> {
    return this.aggregator.health();
  }

  @Get('overview')
  overview(@Req() request: FastifyRequest): Promise<Overview> {
    return this.aggregator.overview(request);
  }
}
