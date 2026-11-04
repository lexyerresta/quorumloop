import {
  approvalSchema,
  decideApprovalRequestSchema,
  policySchema,
  updatePolicyRequestSchema,
  usageSummarySchema,
  type Approval,
  type Policy,
  type UsageSummary,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { GatewayProxy } from './gateway-proxy';
import { relayEventStream } from './sse';

/**
 * Policy, approval and usage routes. Each one is forwarded to the service that owns the data —
 * settings-service owns policy revisions, audit-service owns approval decisions, usage-service
 * owns metered telemetry. The gateway never derives these numbers itself.
 */
@Controller('api/v1')
export class GovernanceController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Get('settings/policies')
  policy(@Req() request: FastifyRequest): Promise<Policy> {
    return this.proxy.call('settings-service', 'GET', '/v1/policies', policySchema, { request });
  }

  @Put('settings/policies')
  updatePolicy(@Req() request: FastifyRequest, @Body() body: unknown): Promise<Policy> {
    const input = parseWith(updatePolicyRequestSchema, body);
    return this.proxy.call('settings-service', 'PUT', '/v1/policies', policySchema, {
      request,
      body: input,
    });
  }

  @Get('approvals')
  approvals(@Req() request: FastifyRequest, @Query('status') status?: string): Promise<Approval[]> {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.proxy.call(
      'audit-service',
      'GET',
      `/v1/approvals${suffix}`,
      z.array(approvalSchema),
      { request },
    );
  }

  @Post('approvals/:approvalId/decision')
  decide(
    @Req() request: FastifyRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
  ): Promise<Approval> {
    const input = parseWith(decideApprovalRequestSchema, body);
    return this.proxy.call(
      'audit-service',
      'POST',
      `/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
      approvalSchema,
      { request, body: input },
    );
  }

  @Get('usage')
  usage(
    @Req() request: FastifyRequest,
    @Query('window_days') windowDays?: string,
  ): Promise<UsageSummary> {
    const days = windowDays ? `?window_days=${encodeURIComponent(windowDays)}` : '';
    return this.proxy.call('usage-service', 'GET', `/v1/usage${days}`, usageSummarySchema, {
      request,
    });
  }

  /**
   * Per-user authorized SSE feed. The dashboard subscribes once and filters client-side; the
   * gateway only relays the activity service's stream.
   */
  @Get('events/stream')
  async events(
    @Req() request: FastifyRequest,
    @Query('project_id') projectId: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    await relayEventStream(
      this.proxy,
      'activity-service',
      `/v1/events/stream${suffix}`,
      request,
      reply,
    );
  }
}
