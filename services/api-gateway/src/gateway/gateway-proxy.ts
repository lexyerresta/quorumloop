import { DomainError, type Session } from '@quorumloop/contracts';
import {
  getOptionalIdentity,
  ServiceClient,
  type CallerIdentity,
  type RawResponse,
} from '@quorumloop/platform';
import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

export const GATEWAY_SESSION = Symbol('quorumloop:gateway-session');

/** Headers a forge uses to prove a webhook is genuine. They are relayed untouched. */
const WEBHOOK_HEADERS = [
  'content-type',
  'x-hub-signature-256',
  'x-github-event',
  'x-github-delivery',
  'x-gitlab-token',
  'x-gitlab-event',
  'x-gitlab-event-uuid',
] as const;

export type RequestWithSession = FastifyRequest & { [GATEWAY_SESSION]?: Session };

export const sessionOf = (request: FastifyRequest): Session | null =>
  (request as RequestWithSession)[GATEWAY_SESSION] ?? null;

export const requireSession = (request: FastifyRequest): Session => {
  const session = sessionOf(request);
  if (!session) {
    throw new DomainError('UNAUTHENTICATED', 'sign in to continue');
  }
  return session;
};

export const identityOf = (request: FastifyRequest): CallerIdentity => {
  const session = sessionOf(request);
  return {
    orgId: session?.organization.id ?? getOptionalIdentity(request)?.orgId ?? null,
    userId: session?.user.id ?? null,
    roles: session ? [session.user.role] : [],
  };
};

@Injectable()
export class GatewayProxy {
  private readonly client = new ServiceClient({ caller: 'api-gateway' });

  /** Forwards the caller's scope to the owning service under a signed internal request. */
  async call<TResponse>(
    target: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    schema: z.ZodType<TResponse>,
    options: { body?: unknown; request: FastifyRequest; baseUrl?: string },
  ): Promise<TResponse> {
    return this.client.request<TResponse, unknown>(
      {
        target,
        method,
        path,
        body: options.body,
        identity: identityOf(options.request),
        baseUrl: options.baseUrl,
      },
      schema,
    );
  }

  async command(
    target: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: { body?: unknown; request: FastifyRequest },
  ): Promise<void> {
    await this.client.command({
      target,
      method,
      path,
      body: options.body,
      identity: identityOf(options.request),
    });
  }

  async stream(target: string, path: string, request: FastifyRequest): Promise<Response> {
    return this.client.stream({
      target,
      method: 'GET',
      path,
      identity: identityOf(request),
      timeoutMs: 0,
    });
  }

  /**
   * Relays a provider webhook without touching its bytes or signature headers. The receiving
   * service still verifies the signature; the gateway is only a transport here.
   */
  async forward(target: string, path: string, request: FastifyRequest): Promise<RawResponse> {
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    const headers: Record<string, string> = {};
    for (const name of WEBHOOK_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string') {
        headers[name] = value;
      }
    }
    return this.client.raw({
      target,
      method: 'POST',
      path,
      rawBody: raw,
      headers,
      identity: identityOf(request),
    });
  }
}
