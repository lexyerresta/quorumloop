import {
  ENGINE_IDS,
  RUNTIME_IDS,
  DomainError,
  engineSchema,
  routeDecisionSchema,
  runEventSchema,
  runSchema,
  runtimeSchema,
  type Engine,
  type RouteDecision,
  type Run,
  type RunEvent,
  type Runtime,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GatewayProxy } from './gateway-proxy';
import { relayEventStream } from './sse';

const runControlSchema = z.object({
  reason: z.string().max(1000).optional(),
});

/**
 * Runtime surface: what is installed, what is running, and what the router decided.
 * Every value here is produced by a real probe or a recorded decision — nothing is synthesised.
 */
@Controller('api/v1')
export class RuntimeController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get('engines')
  engines(@Req() request: FastifyRequest): Promise<Engine[]> {
    return this.proxy.call('provider-router-service', 'GET', '/v1/engines', z.array(engineSchema), {
      request,
    });
  }

  @Post('engines/:engineId/test')
  probeEngine(
    @Req() request: FastifyRequest,
    @Param('engineId') engineId: string,
  ): Promise<Engine> {
    if (!(ENGINE_IDS as readonly string[]).includes(engineId)) {
      throw new DomainError('NOT_FOUND', `unknown engine ${engineId}`);
    }
    return this.proxy.call(
      'provider-router-service',
      'POST',
      `/v1/engines/${encodeURIComponent(engineId)}/probe`,
      engineSchema,
      { request },
    );
  }

  @Get('runtimes')
  runtimes(@Req() request: FastifyRequest): Promise<Runtime[]> {
    return this.proxy.call('runtime-service', 'GET', '/v1/runtimes', z.array(runtimeSchema), {
      request,
    });
  }

  @Post('runtimes/:runtimeId/test')
  probeRuntime(
    @Req() request: FastifyRequest,
    @Param('runtimeId') runtimeId: string,
  ): Promise<Runtime> {
    if (!(RUNTIME_IDS as readonly string[]).includes(runtimeId)) {
      throw new DomainError('NOT_FOUND', `unknown runtime ${runtimeId}`);
    }
    return this.proxy.call(
      'runtime-service',
      'POST',
      `/v1/runtimes/${encodeURIComponent(runtimeId)}/probe`,
      runtimeSchema,
      { request },
    );
  }

  @Get('runs')
  runs(
    @Req() request: FastifyRequest,
    @Query('project_id') projectId?: string,
    @Query('task_id') taskId?: string,
  ): Promise<Run[]> {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (taskId) params.set('task_id', taskId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.proxy.call(
      'orchestration-service',
      'GET',
      `/v1/runs${suffix}`,
      z.array(runSchema),
      {
        request,
      },
    );
  }

  @Get('runs/:runId')
  run(@Req() request: FastifyRequest, @Param('runId') runId: string): Promise<Run> {
    return this.proxy.call(
      'orchestration-service',
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}`,
      runSchema,
      { request },
    );
  }

  @Get('runs/:runId/events')
  events(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Query('after') after?: string,
  ): Promise<RunEvent[]> {
    const suffix = after ? `?after=${encodeURIComponent(after)}` : '';
    return this.proxy.call(
      'orchestration-service',
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}/events${suffix}`,
      z.array(runEventSchema),
      { request },
    );
  }

  @Get('runs/:runId/decision')
  decision(@Req() request: FastifyRequest, @Param('runId') runId: string): Promise<RouteDecision> {
    return this.proxy.call(
      'provider-router-service',
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}/decision`,
      routeDecisionSchema,
      { request },
    );
  }

  @Post('runs/:runId/pause')
  pause(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(runControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/runs/${encodeURIComponent(runId)}/pause`,
      runSchema,
      { request, body: input },
    );
  }

  @Post('runs/:runId/resume')
  resume(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(runControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/runs/${encodeURIComponent(runId)}/resume`,
      runSchema,
      { request, body: input },
    );
  }

  @Post('runs/:runId/cancel')
  cancel(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<Run> {
    const input = parseWith(runControlSchema, body ?? {});
    return this.proxy.call(
      'orchestration-service',
      'POST',
      `/v1/runs/${encodeURIComponent(runId)}/cancel`,
      runSchema,
      { request, body: input },
    );
  }

  /**
   * Server-sent events straight from the owning service. The gateway relays bytes so the
   * dashboard reconnects with native EventSource semantics instead of a polling loop.
   */
  @Get('runs/:runId/stream')
  async stream(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await relayEventStream(
      this.proxy,
      'orchestration-service',
      `/v1/runs/${encodeURIComponent(runId)}/stream`,
      request,
      reply,
    );
  }
}
