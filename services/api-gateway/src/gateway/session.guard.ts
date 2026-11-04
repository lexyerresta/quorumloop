import {
  DomainError,
  sessionVerificationSchema,
  type SessionVerification,
} from '@quorumloop/contracts';
import { ServiceClient } from '@quorumloop/platform';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { GATEWAY_SESSION, sessionOf, type RequestWithSession } from './gateway-proxy';
import { readCookie, SESSION_COOKIE } from './cookies';

export const PUBLIC_ROUTE = 'quorumloop:public-route';
export const Public = (): CustomDecorator<string> => SetMetadata(PUBLIC_ROUTE, true);

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_HEADER = 'x-csrf-token';

/**
 * The gateway is the only place a browser session becomes an internal identity. A missing or
 * expired cookie is a clean 401, never an anonymous request that reaches a service.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly client = new ServiceClient({ caller: 'api-gateway' });

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = request.url.split('?')[0] ?? request.url;
    if (path.startsWith('/health')) {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      if (isPublic) {
        return true;
      }
      throw new DomainError('UNAUTHENTICATED', 'sign in to continue');
    }

    const verification = await this.client.request<
      SessionVerification,
      { token: string; touch: boolean }
    >(
      {
        target: 'identity-service',
        method: 'POST',
        path: '/v1/session/verify',
        body: { token, touch: !isPublic },
      },
      sessionVerificationSchema,
    );
    if (!verification.valid || !verification.session) {
      if (isPublic) {
        return true;
      }
      throw new DomainError('UNAUTHENTICATED', verification.reason ?? 'session is not valid');
    }
    (request as RequestWithSession)[GATEWAY_SESSION] = verification.session;
    return true;
  }
}

/**
 * Double-submit CSRF: the session record holds the token, the browser sends it back in a header
 * for every unsafe method. A cross-site form cannot read the header value.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!UNSAFE_METHODS.has(request.method)) {
      return true;
    }
    const session = sessionOf(request);
    if (!session) {
      // Public unsafe routes (login, setup, webhooks) authenticate by other means.
      return true;
    }
    const header = request.headers[CSRF_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || provided !== session.csrf_token) {
      throw new DomainError('FORBIDDEN', 'csrf token is missing or does not match the session');
    }
    return true;
  }
}
