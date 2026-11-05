import { internalServiceUrl, readEnv, type BaseEnv } from '@quorumloop/config';
import { DomainError, errorEnvelopeSchema, type ErrorCode } from '@quorumloop/contracts';
import { currentContext } from '@quorumloop/observability';
import type { z } from 'zod';
import { INTERNAL_HEADERS, signInternalRequest } from '../crypto/internal-signature';
import { parseWith } from '../validation';

export interface CallerIdentity {
  orgId?: string | null;
  userId?: string | null;
  roles?: string[];
}

export interface ServiceClientOptions {
  /** Catalog name of the calling service, written into the signature. */
  caller: string;
  /** Overrides the shared secret; tests use their own. */
  secret?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  env?: BaseEnv;
}

export interface RequestOptions<TBody> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Catalog name of the target service, for example `task-service`. */
  target: string;
  /** Path without the `/internal` prefix, for example `/v1/projects`. */
  path: string;
  body?: TBody;
  /**
   * Sends this exact text as the body instead of JSON-encoding `body`. Webhook relays must
   * preserve the provider's bytes because the signature covers them.
   */
  rawBody?: string;
  /** Extra headers forwarded verbatim, for example a forge signature header. */
  headers?: Record<string, string>;
  identity?: CallerIdentity;
  /** Base URL override, for a gateway route or an external endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Correlation id propagation; defaults to the current request context. */
  correlationId?: string;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: string;
}

/**
 * The path an internal call actually hits. Both the signature and the URL use it, because a
 * receiver verifies the URL it was given (`/internal/v1/...`), not the logical route.
 */
export const internalTargetPath = (path: string): string =>
  path.startsWith('/') ? `/internal${path}` : `/internal/${path}`;

const CONTEXT_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  422: 'UNSUPPORTED_CAPABILITY',
  429: 'RATE_LIMITED',
  503: 'UPSTREAM_UNAVAILABLE',
};

/**
 * Internal service calls always carry a signature, the caller's org and user scope, and the
 * correlation id of the request that caused them. A failure surfaces as a DomainError with
 * the upstream code so a caller never has to re-derive it from a status number.
 */
/**
 * `fetch` reports every transport failure as "fetch failed" and keeps the reason in `cause`
 * (undici's socket error code). The reason is what tells a refused port from a reset keep-alive
 * socket, so it goes into the message.
 */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return `${error.message} (${typeof code === 'string' ? `${code}: ` : ''}${cause.message})`;
  }
  return error.message;
}

export class ServiceClient {
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly env: BaseEnv;

  constructor(private readonly options: ServiceClientOptions) {
    this.env = options.env ?? readEnv();
    this.secret = options.secret ?? this.env.INTERNAL_SHARED_SECRET;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private headers(options: RequestOptions<unknown>, bodyText: string): Record<string, string> {
    const context = currentContext();
    const timestamp = Date.now().toString();
    // The signature covers the target exactly as the receiver sees it, `/internal` included.
    // Signing the unprefixed path would let a signature for one mount point be replayed on another.
    const path = internalTargetPath(options.path);
    const correlationId =
      options.correlationId ?? context?.correlationId ?? `${this.options.caller}-${timestamp}`;
    const orgId = options.identity?.orgId ?? context?.orgId ?? null;
    const userId = options.identity?.userId ?? context?.userId ?? null;
    const roles = options.identity?.roles ?? [];

    const signature = signInternalRequest({
      secret: this.secret,
      caller: this.options.caller,
      method: options.method,
      path,
      timestamp,
      body: bodyText,
    });

    const headers: Record<string, string> = {
      accept: 'application/json',
      [INTERNAL_HEADERS.caller]: this.options.caller,
      [INTERNAL_HEADERS.timestamp]: timestamp,
      [INTERNAL_HEADERS.signature]: signature,
      [INTERNAL_HEADERS.correlationId]: correlationId,
    };
    // A bodyless call must not declare a body. Fastify rejects an empty payload that claims to be
    // json, so a DELETE forwarded with `content-type: application/json` fails with a 400.
    if (bodyText.length > 0) {
      headers['content-type'] = 'application/json';
    }
    if (orgId) {
      headers[INTERNAL_HEADERS.orgId] = orgId;
    }
    if (userId) {
      headers[INTERNAL_HEADERS.userId] = userId;
    }
    if (roles.length > 0) {
      headers[INTERNAL_HEADERS.roles] = roles.join(',');
    }
    return { ...headers, ...options.headers };
  }

  private bodyText<TBody>(options: RequestOptions<TBody>): string {
    if (options.rawBody !== undefined) {
      return options.rawBody;
    }
    return options.body === undefined ? '' : JSON.stringify(options.body);
  }

  /**
   * Performs the request and returns the parsed payload, or throws a DomainError carrying the
   * upstream code. `schema` is required because an unvalidated response is a contract bug.
   */
  async request<TResponse, TBody = unknown>(
    options: RequestOptions<TBody>,
    schema: z.ZodType<TResponse>,
  ): Promise<TResponse> {
    const raw = await this.raw(options);
    if (raw.status >= 200 && raw.status < 300) {
      let parsed: unknown;
      try {
        parsed = raw.body.length > 0 ? JSON.parse(raw.body) : undefined;
      } catch {
        throw new DomainError('UPSTREAM_UNAVAILABLE', 'upstream returned malformed json');
      }
      return parseWith(schema, parsed);
    }
    throw this.toDomainError(raw);
  }

  /** Same as `request` but accepts a 204 style response and returns undefined. */
  async command<TBody = unknown>(options: RequestOptions<TBody>): Promise<void> {
    const raw = await this.raw(options);
    if (raw.status >= 200 && raw.status < 300) {
      return;
    }
    throw this.toDomainError(raw);
  }

  /**
   * Raw transport for server-sent events and stream relays. A timeout of 0 means "no deadline",
   * which is correct for an event stream and wrong for every other call.
   */
  async stream<TBody = unknown>(options: RequestOptions<TBody>): Promise<Response> {
    const bodyText = this.bodyText(options);
    const url = this.url(options);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const response = await fetch(url, {
      method: options.method,
      headers: this.headers(options, bodyText),
      body: bodyText.length > 0 ? bodyText : undefined,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    }).catch((error: unknown) => {
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `cannot reach ${options.target}: ${describeFetchError(error)}`,
        true,
      );
    });
    return response;
  }

  async raw<TBody = unknown>(options: RequestOptions<TBody>): Promise<RawResponse> {
    const bodyText = this.bodyText(options);
    const response = await fetch(this.url(options), {
      method: options.method,
      headers: this.headers(options, bodyText),
      body: bodyText.length > 0 ? bodyText : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
    }).catch((error: unknown) => {
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `cannot reach ${options.target}: ${describeFetchError(error)}`,
        true,
      );
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
    };
  }

  private url(options: RequestOptions<unknown>): string {
    const base = options.baseUrl ?? internalServiceUrl(options.target, this.env);
    return `${base}${internalTargetPath(options.path)}`;
  }

  /**
   * Reads another service's readiness report. This is the one call that is not signed and not
   * prefixed, because probes must work before a service finished wiring its own auth.
   */
  async health(
    target: string,
    timeoutMs = 2000,
  ): Promise<{ status: 'ok' | 'degraded' | 'down' | 'unknown'; detail: string | null }> {
    try {
      const response = await fetch(`${internalServiceUrl(target, this.env)}/health/ready`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return { status: 'down', detail: `readiness responded with ${response.status}` };
      }
      const body = (await response.json()) as {
        status?: string;
        checks?: { name: string; status: string }[];
      };
      if (body.status === 'ok') {
        return { status: 'ok', detail: null };
      }
      const failing = (body.checks ?? [])
        .filter((check) => check.status !== 'ok')
        .map((check) => `${check.name}: ${check.status}`);
      return {
        status: body.status === 'down' ? 'down' : 'degraded',
        detail: failing.length > 0 ? failing.join(', ') : null,
      };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : 'unreachable',
      };
    }
  }

  private toDomainError(raw: RawResponse): DomainError {
    let code: ErrorCode = CONTEXT_STATUS[raw.status] ?? 'INTERNAL';
    let message = `upstream responded with ${raw.status}`;
    let retryable = raw.status === 429 || raw.status >= 500;
    try {
      const parsed = errorEnvelopeSchema.safeParse(JSON.parse(raw.body));
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        retryable = parsed.data.error.retryable;
      }
    } catch {
      // Keep the status-derived error; the body was not an error envelope.
    }
    return new DomainError(code, message, retryable);
  }
}
