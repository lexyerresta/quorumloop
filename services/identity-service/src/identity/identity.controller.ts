import {
  changePasswordRequestSchema,
  loginRequestSchema,
  ROLES,
  sessionTokenRequestSchema,
  setupAdminRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type Member,
  type Role,
  type SessionIssue,
  type SessionVerification,
  type SetupStatus,
} from '@quorumloop/contracts';
import { getIdentity, parseWith, requireOrgId } from '@quorumloop/platform';
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IdentityService } from './identity.service';

const addMemberRequestSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(120),
  password: z.string().min(12).max(200),
  role: z.enum(ROLES).default('developer'),
});

const updateRoleRequestSchema = z.object({ role: z.enum(ROLES) });

/**
 * Internal identity API. The gateway is the only caller: it owns the cookie, this service owns
 * the credential and the session record.
 */
@Controller('v1')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get('setup/status')
  setupStatus(): Promise<SetupStatus> {
    return this.identity.setupStatus();
  }

  @Post('setup/admin')
  setupAdmin(@Body() body: unknown): Promise<SessionIssue> {
    const input = parseWith(setupAdminRequestSchema, body);
    return this.identity.setupAdmin(input);
  }

  @Post('auth/login')
  login(@Body() body: unknown, @Req() request: FastifyRequest): Promise<SessionIssue> {
    const input: LoginRequest = parseWith(loginRequestSchema, body);
    return this.identity.login(input, {
      userAgent: request.headers['user-agent'] ?? null,
      ip: request.ip ?? null,
    });
  }

  @Post('auth/logout')
  async logout(@Body() body: unknown): Promise<{ ok: true }> {
    const input = parseWith(sessionTokenRequestSchema, body);
    await this.identity.logout(input.token);
    return { ok: true };
  }

  @Post('session/verify')
  verify(@Body() body: unknown): Promise<SessionVerification> {
    const input = parseWith(sessionTokenRequestSchema, body);
    return this.identity.verify(input.token, input.touch);
  }

  @Get('members')
  listMembers(@Req() request: FastifyRequest): Promise<Member[]> {
    return this.identity.listMembers(requireOrgId(request));
  }

  @Get('me')
  me(@Req() request: FastifyRequest): Promise<Member> {
    const identity = getIdentity(request);
    return this.identity.me(requireOrgId(request), identity.userId ?? '');
  }

  @Post('members')
  addMember(@Req() request: FastifyRequest, @Body() body: unknown): Promise<Member> {
    const input = parseWith(addMemberRequestSchema, body);
    const identity = getIdentity(request);
    return this.identity.addMember(requireOrgId(request), identity.userId ?? '', input);
  }

  @Patch('members/:membershipId')
  async updateMember(
    @Req() request: FastifyRequest,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const input = parseWith(updateRoleRequestSchema, body);
    await this.identity.updateMemberRole(requireOrgId(request), membershipId, input.role as Role);
    return { ok: true };
  }

  @Delete('members/:membershipId')
  async removeMember(
    @Req() request: FastifyRequest,
    @Param('membershipId') membershipId: string,
  ): Promise<{ ok: true }> {
    await this.identity.removeMember(requireOrgId(request), membershipId);
    return { ok: true };
  }

  @Post('me/password')
  async changePassword(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Headers('x-quorumloop-session-id') sessionId?: string,
  ): Promise<{ ok: true }> {
    const input: ChangePasswordRequest = parseWith(changePasswordRequestSchema, body);
    const identity = getIdentity(request);
    await this.identity.changePassword(identity.userId ?? '', input, sessionId);
    return { ok: true };
  }
}
