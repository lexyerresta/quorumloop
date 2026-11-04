import { DomainError } from '@quorumloop/contracts';
import { readEnv } from '@quorumloop/config';
import { CanActivate, ExecutionContext, Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { INTERNAL_HEADERS, verifyInternalRequest } from '../crypto/internal-signature';
import { newCorrelationId, runWithContext } from '@quorumloop/observability';

export interface InternalIdentity {
  service: string;
  orgId: string | null;
  userId: string | null;
  roles: string[];
  actor: string;
  correlationId: string;
}

export const INTERNAL_IDENTITY = Symbol('quorumloop:internal-identity');

type RequestWithIdentity = FastifyRequest & {
  [INTERNAL_IDENTITY]?: InternalIdentity;
  body?: unknown;
};

export const headerValue = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

export const getIdentity = (request: FastifyRequest): InternalIdentity => {
  const identity = (request as RequestWithIdentity)[INTERNAL_IDENTITY];
  if (!identity) {
    throw new DomainError('UNAUTHENTICATED', 'internal caller identity is missing');
  }
  return identity;
};

export const getOptionalIdentity = (request: FastifyRequest): InternalIdentity | null =>
  (request as RequestWithIdentity)[INTERNAL_IDENTITY] ?? null;

const bodyForSignature = (body: unknown): string => {
  if (body === undefined || body === null) {
    return '';
  }
  return JSON.stringify(body);
};

/**
 * Service-to-service authentication. Health endpoints stay public so an orchestrator can probe
 * a container that is still starting; every other route requires a valid signature from a
 * known internal caller, within a two minute skew window.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? readEnv().INTERNAL_SHARED_SECRET;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithIdentity>();
    const path = request.url.split('?')[0] ?? request.url;
    if (path.startsWith('/health') || path === '/') {
      return true;
    }

    const caller = headerValue(request, INTERNAL_HEADERS.caller);
    const timestamp = headerValue(request, INTERNAL_HEADERS.timestamp);
    const signature = headerValue(request, INTERNAL_HEADERS.signature);
    if (!caller || !timestamp || !signature) {
      throw new DomainError('UNAUTHENTICATED', 'internal request is not signed');
    }

    const verification = verifyInternalRequest({
      secret: this.secret,
      caller,
      method: request.method,
      path: request.url,
      timestamp,
      body: bodyForSignature(request.body),
      signature,
    });
    if (!verification.ok) {
      throw new DomainError('UNAUTHENTICATED', verification.reason ?? 'invalid signature');
    }

    const rolesHeader = headerValue(request, INTERNAL_HEADERS.roles);
    const orgId = headerValue(request, INTERNAL_HEADERS.orgId) ?? null;
    const userId = headerValue(request, INTERNAL_HEADERS.userId) ?? null;
    (request as RequestWithIdentity)[INTERNAL_IDENTITY] = {
      service: caller,
      orgId,
      userId,
      roles: rolesHeader ? rolesHeader.split(',').filter(Boolean) : [],
      actor: userId ? `user:${userId}` : `service:${caller}`,
      correlationId: headerValue(request, INTERNAL_HEADERS.correlationId) ?? newCorrelationId(),
    };
    return true;
  }
}

/** Binds a correlation id and actor context around the downstream handler. */
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly service: string) {}

  /**
   * Registered through `app.use`, so Fastify hands this the raw `ServerResponse` (via middie)
   * rather than a `FastifyReply`. The Node `setHeader` API is the one that exists on both.
   */
  use(
    request: FastifyRequest,
    response: { setHeader(name: string, value: string): void },
    next: (error?: unknown) => void,
  ): void {
    const correlationId =
      headerValue(request, INTERNAL_HEADERS.correlationId) ?? newCorrelationId();
    const userId = headerValue(request, INTERNAL_HEADERS.userId) ?? null;
    const orgId = headerValue(request, INTERNAL_HEADERS.orgId) ?? null;
    response.setHeader('x-correlation-id', correlationId);
    runWithContext(
      {
        correlationId,
        userId,
        orgId,
        service: this.service,
        actor: userId ? `user:${userId}` : 'internal',
      },
      () => next(),
    );
  }
}

export const requireOrgId = (request: FastifyRequest): string => {
  const identity = getIdentity(request);
  if (!identity.orgId) {
    throw new DomainError('FORBIDDEN', 'request is not scoped to an organization');
  }
  return identity.orgId;
};

export const hasAnyRole = (identity: InternalIdentity, roles: readonly string[]): boolean =>
  identity.roles.some((role) => roles.includes(role));

/**
 * Authorization stays with the owning service. The gateway forwards the caller's roles and each
 * service decides for itself what a role may do, so a compromised route cannot borrow a role it
 * was never granted.
 */
export const requireAnyRole = (
  request: FastifyRequest,
  roles: readonly string[],
): InternalIdentity => {
  const identity = getIdentity(request);
  if (!hasAnyRole(identity, roles)) {
    throw new DomainError('FORBIDDEN', `requires one of: ${roles.join(', ')}`);
  }
  return identity;
};
