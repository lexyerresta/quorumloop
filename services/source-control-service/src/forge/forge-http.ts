import { DomainError } from '@quorumloop/contracts';
import type { z } from 'zod';

export interface ForgeHttpOptions {
  /** Host API root including its version path, for example `https://api.github.com`. */
  apiBase: string;
  token: string;
  /** `authorization` for a bearer token, `private-token` for GitLab PATs. */
  authHeader: 'authorization' | 'private-token';
  accept: string;
  userAgent: string;
}

export interface ForgeHttpResponse<T> {
  data: T;
  headers: Headers;
}

const TIMEOUT_MS = 15_000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Thin transport shared by the adapters. Vendor payloads are validated with a schema on the way
 * in, and every failure is translated into the same error vocabulary the rest of the platform
 * speaks, so a UI never has to interpret a vendor status code.
 */
export class ForgeHttp {
  constructor(private readonly options: ForgeHttpOptions) {}

  async get<T>(path: string, schema: z.ZodType<T>): Promise<ForgeHttpResponse<T>> {
    const url = `${this.options.apiBase.replace(/\/+$/, '')}${path}`;
    const headers: Record<string, string> = {
      accept: this.options.accept,
      'user-agent': this.options.userAgent,
    };
    if (this.options.authHeader === 'authorization') {
      headers.authorization = `Bearer ${this.options.token}`;
    } else {
      headers['private-token'] = this.options.token;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `cannot reach the Git host: ${error instanceof Error ? error.message : 'unknown error'}`,
        true,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw this.failure(response, body);
    }
    let parsed: unknown;
    try {
      parsed = body.length > 0 ? JSON.parse(body) : undefined;
    } catch {
      throw new DomainError('UPSTREAM_UNAVAILABLE', 'the Git host returned malformed json', true);
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new DomainError(
        'UPSTREAM_UNAVAILABLE',
        `the Git host returned an unexpected payload for ${path}: ${validated.error.issues
          .slice(0, 3)
          .map((issue) => issue.path.join('.') || 'root')
          .join(', ')}`,
      );
    }
    return { data: validated.data, headers: response.headers };
  }

  private failure(response: Response, body: string): DomainError {
    const detail = providerMessage(body) ?? `status ${response.status}`;
    switch (response.status) {
      case 401:
        return new DomainError(
          'UNAUTHENTICATED',
          `the Git host rejected the credential: ${detail}`,
        );
      case 403: {
        // GitHub reports exhausted rate limits as 403 with a zero remaining header.
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          return new DomainError('RATE_LIMITED', 'the Git host rate limit is exhausted', true);
        }
        return new DomainError('FORBIDDEN', `the Git host denied access: ${detail}`);
      }
      case 404:
        return new DomainError('NOT_FOUND', `the Git host has no such resource: ${detail}`);
      case 422:
        return new DomainError('VALIDATION_FAILED', `the Git host rejected the request: ${detail}`);
      default:
        return new DomainError(
          'UPSTREAM_UNAVAILABLE',
          `the Git host failed with status ${response.status}: ${detail}`,
          RETRYABLE_STATUS.has(response.status),
        );
    }
  }
}

/** Pulls the human message out of either vendor's error body without trusting its shape. */
const providerMessage = (body: string): string | null => {
  if (body.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of ['message', 'error_description', 'error']) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) {
          return value.slice(0, 300);
        }
      }
    }
  } catch {
    // Not JSON; fall back to the truncated raw text.
    return body.slice(0, 300);
  }
  return null;
};
