import { type Policy, updatePolicyRequestSchema } from '@quorumloop/contracts';
import { parseWith, requireAnyRole, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SettingsService } from './settings.service';

/** Policy is an administrative surface: reading is open to every member, writing is not. */
const ADMIN_ROLES = ['owner', 'admin'] as const;

@Controller('v1/policies')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  policy(@Req() request: FastifyRequest): Promise<Policy> {
    return this.settings.getPolicy(requireOrgId(request));
  }

  @Put()
  update(@Req() request: FastifyRequest, @Body() body: unknown): Promise<Policy> {
    const identity = requireAnyRole(request, ADMIN_ROLES);
    const input = parseWith(updatePolicyRequestSchema, body);
    return this.settings.updatePolicy(identity.orgId ?? '', identity.actor, input);
  }
}
