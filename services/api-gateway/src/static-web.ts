import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Serves the built dashboard (`apps/web/dist`) from `WEB_DIST_DIR` in the Compose deployment, so the
 * browser talks to one origin and the session cookie and CSRF check need no CORS. Unknown paths
 * without a file extension fall back to `index.html` for client-side routes. Anything under `/api`
 * or `/health` is never answered here: it goes to Nest's not-found handler, so an unknown API route
 * still returns the usual error envelope instead of the dashboard.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// The dashboard loads nothing from another origin, so the policy can be strict.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const RESERVED = /^\/(api|health)(\/|$)/;

/*
 * Structural slice of Fastify's API. Nest's adapter and the gateway can resolve different patch
 * versions of fastify, whose nominal types do not unify; this keeps the module version-agnostic.
 */
interface WebReply {
  header(name: string, value: string): WebReply;
  send(payload: unknown): unknown;
  callNotFound(): void;
}
interface WebRequest {
  url: string;
}
export interface WebRouteHost {
  get(path: string, handler: (request: WebRequest, reply: WebReply) => Promise<unknown>): unknown;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function registerWebRoutes(fastify: WebRouteHost, directory: string): void {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');

  const send = (reply: WebReply, file: string) => {
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const hashedAsset = file.startsWith(path.join(root, 'assets') + path.sep);
    return reply
      .header('content-type', type)
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'same-origin')
      .header('content-security-policy', CONTENT_SECURITY_POLICY)
      .header('cache-control', hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(createReadStream(file));
  };

  const handler = async (request: WebRequest, reply: WebReply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return reply.callNotFound();
    }
    if (RESERVED.test(decoded) || decoded.includes('\0')) return reply.callNotFound();

    const candidate = path.resolve(root, `.${decoded}`);
    // Path traversal guard: the resolved file must stay inside the build directory.
    if (candidate !== root && !candidate.startsWith(root + path.sep)) return reply.callNotFound();

    if (candidate !== root && (await isFile(candidate))) return send(reply, candidate);
    // A missing asset is a real 404; only extensionless paths are client-side routes.
    if (path.extname(decoded) !== '') return reply.callNotFound();
    if (!(await isFile(index))) return reply.callNotFound();
    return send(reply, index);
  };

  fastify.get('/', handler);
  fastify.get('/*', handler);
}
