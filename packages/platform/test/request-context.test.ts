import { currentContext } from '@quorumloop/observability';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { headerValue, RequestContextMiddleware } from '../src/nest/internal-auth';

/**
 * The middleware runs through `app.use`, which means middie hands it the raw Node response.
 * A `FastifyReply`-only method here breaks every route in every service, so the contract is
 * pinned by a test rather than by a comment.
 */
const request = (headers: Record<string, string | string[]>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest;

const collect = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    response: {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    },
  };
};

describe('RequestContextMiddleware', () => {
  it('writes the correlation id with the Node response API', () => {
    const { headers, response } = collect();
    const seen: unknown[] = [];

    new RequestContextMiddleware('task-service').use(
      request({
        'x-correlation-id': 'corr-42',
        'x-quorumloop-user-id': 'user-7',
        'x-quorumloop-org-id': 'org-1',
      }),
      response,
      () => {
        seen.push(currentContext());
      },
    );

    expect(headers['x-correlation-id']).toBe('corr-42');
    expect(seen).toHaveLength(1);
    const context = seen[0] as {
      correlationId: string;
      userId: string | null;
      orgId: string | null;
      service: string;
    };
    expect(context.correlationId).toBe('corr-42');
    expect(context.userId).toBe('user-7');
    expect(context.orgId).toBe('org-1');
    expect(context.service).toBe('task-service');
  });

  it('mints a correlation id when the caller did not send one', () => {
    const { headers, response } = collect();
    let reached = false;

    new RequestContextMiddleware('api-gateway').use(request({}), response, () => {
      reached = true;
    });

    expect(reached).toBe(true);
    expect(headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads repeated headers as a single value', () => {
    expect(headerValue(request({ 'x-org-id': ['one', 'two'] }), 'x-org-id')).toBe('one');
    expect(headerValue(request({}), 'x-org-id')).toBeUndefined();
  });
});
