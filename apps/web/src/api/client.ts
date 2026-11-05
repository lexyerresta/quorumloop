/**
 * Thin fetch wrapper for the gateway's public REST surface (`/api/v1`).
 *
 * The gateway uses a double-submit CSRF check: every unsafe request with a session must echo the
 * `quorumloop_csrf` cookie in `x-csrf-token`. Errors arrive as `{ error: { code, message,
 * correlation_id, retryable } }` and are rethrown as `ApiError` so screens can show the reason and
 * the correlation id instead of a generic failure.
 */

export const API_BASE = '/api/v1';
const CSRF_COOKIE = 'quorumloop_csrf';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string | null,
    readonly retryable: boolean,
    readonly issues: ReadonlyArray<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    correlation_id?: string;
    retryable?: boolean;
    details?: { issues?: Array<{ path: string; message: string }> };
  };
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  // Fastify rejects `content-type: application/json` with an empty body, so only send it with one.
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers['x-csrf-token'] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      0,
      'NETWORK',
      'The gateway did not answer. Check that `pnpm dev:core` is running.',
      null,
      true,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    const envelope = (data ?? {}) as ErrorEnvelope;
    const err = envelope.error;
    throw new ApiError(
      response.status,
      err?.code ?? `HTTP_${response.status}`,
      err?.message ?? (response.statusText || 'Request failed'),
      err?.correlation_id ?? null,
      err?.retryable ?? false,
      err?.details?.issues ?? [],
    );
  }

  return data as T;
}

/** Human sentence for an error, used by every error state. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === 'UPSTREAM_UNAVAILABLE') {
      return `A backend service is not reachable: ${error.message}`;
    }
    if (error.issues.length > 0) {
      return error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('. ');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
