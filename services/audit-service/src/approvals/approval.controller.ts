import { decideApprovalRequestSchema, type Approval } from '@quorumloop/contracts';
import { parseWith, requireAnyRole, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApprovalService } from './approval.service';
import { APPROVAL_STATUSES, type ApprovalStatus } from './approval.rules';

/** Reading the queue is open to the whole organization; deciding is an administrative act. */
const ADMIN_ROLES = ['owner', 'admin'] as const;

const statusQuerySchema = z.enum(APPROVAL_STATUSES);

@Controller('v1/approvals')
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get()
  list(@Req() request: FastifyRequest, @Query('status') status?: string): Promise<Approval[]> {
    const orgId = requireOrgId(request);
    const filter: ApprovalStatus | null = status ? parseWith(statusQuerySchema, status) : null;
    return this.approvals.list(orgId, filter);
  }

  @Post(':approvalId/decision')
  decide(
    @Req() request: FastifyRequest,
    @Param('approvalId') approvalId: string,
    @Body() body: unknown,
  ): Promise<Approval> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    const input = parseWith(decideApprovalRequestSchema, body);
    return this.approvals.decide(identity.orgId ?? '', approvalId, identity.actor, input);
  }
}
