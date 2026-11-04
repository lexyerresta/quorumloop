import {
  loginRequestSchema,
  sessionIssueSchema,
  sessionSchema,
  setupAdminRequestSchema,
  setupStatusSchema,
  type Session,
  type SessionIssue,
  type SetupStatus,
} from '@quorumloop/contracts';
import { parseWith } from '@quorumloop/platform';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearSessionCookies, readSessionToken, sessionCookies } from './cookies';
import { GatewayProxy, requireSession } from './gateway-proxy';
import { Public } from './session.guard';

/**
 * The public auth surface. The token round-trip lives entirely in Set-Cookie headers; the
 * response body carries the session shape the dashboard renders.
 */
@Controller('api/v1')
export class AuthController {
  constructor(private readonly proxy: GatewayProxy) {}

  @Public()
  @Get('setup/status')
  setupStatus(@Req() request: FastifyRequest): Promise<SetupStatus> {
    return this.proxy.call('identity-service', 'GET', '/v1/setup/status', setupStatusSchema, {
      request,
    });
  }

  @Public()
  @Post('setup/admin')
  async setupAdmin(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Session> {
    const input = parseWith(setupAdminRequestSchema, body);
    const issued = await this.proxy.call<SessionIssue>(
      'identity-service',
      'POST',
      '/v1/setup/admin',
      sessionIssueSchema,
      { request, body: input },
    );
    reply.header(
      'set-cookie',
      sessionCookies(issued.token, issued.session.csrf_token, issued.session.expires_at),
    );
    return issued.session;
  }

  @Public()
  @Post('auth/login')
  async login(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Session> {
    const input = parseWith(loginRequestSchema, body);
    const issued = await this.proxy.call<SessionIssue>(
      'identity-service',
      'POST',
      '/v1/auth/login',
      sessionIssueSchema,
      { request, body: input },
    );
    reply.header(
      'set-cookie',
      sessionCookies(issued.token, issued.session.csrf_token, issued.session.expires_at),
    );
    return issued.session;
  }

  @Post('auth/logout')
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const token = readSessionToken(request);
    if (token) {
      await this.proxy.command('identity-service', 'POST', '/v1/auth/logout', {
        request,
        body: { token, touch: false },
      });
    }
    reply.header('set-cookie', clearSessionCookies());
    return { ok: true };
  }

  @Get('session')
  session(@Req() request: FastifyRequest): Session {
    return sessionSchema.parse(requireSession(request));
  }
}
