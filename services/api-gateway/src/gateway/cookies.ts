import { readEnv } from '@quorumloop/config';

export const SESSION_COOKIE = 'quorumloop_session';
export const CSRF_COOKIE = 'quorumloop_csrf';

export const readCookie = (
  request: { headers: Record<string, unknown> },
  name: string,
): string | undefined => {
  const header = request.headers.cookie;
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
};

export const readSessionToken = (request: {
  headers: Record<string, unknown>;
}): string | undefined => readCookie(request, SESSION_COOKIE);

export interface CookieOptions {
  name: string;
  value: string;
  httpOnly: boolean;
  maxAgeSeconds: number;
  secure: boolean;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export const serializeCookie = (options: CookieOptions): string => {
  const parts = [
    `${options.name}=${encodeURIComponent(options.value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
};

/**
 * The session cookie is httpOnly; the CSRF cookie is deliberately readable so the browser app
 * can echo it back in a header. Neither is ever exposed through an API response body.
 */
export const sessionCookies = (token: string, csrfToken: string, expiresAt: string): string[] => {
  const env = readEnv();
  const secure = env.NODE_ENV === 'production';
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return [
    serializeCookie({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure,
      maxAgeSeconds: maxAge,
    }),
    serializeCookie({
      name: CSRF_COOKIE,
      value: csrfToken,
      httpOnly: false,
      secure,
      maxAgeSeconds: maxAge,
    }),
  ];
};

export const clearSessionCookies = (): string[] => {
  const secure = readEnv().NODE_ENV === 'production';
  return [
    serializeCookie({ name: SESSION_COOKIE, value: '', httpOnly: true, secure, maxAgeSeconds: 0 }),
    serializeCookie({ name: CSRF_COOKIE, value: '', httpOnly: false, secure, maxAgeSeconds: 0 }),
  ];
};
