import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role } from '@quorumloop/contracts';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'quorumloop_session';
export const CSRF_COOKIE = 'quorumloop_csrf';

/** Role ranking used by the gateway and by members management. Higher wins. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  developer: 2,
  admin: 3,
  owner: 4,
};

export const isRole = (value: string): value is Role =>
  value === 'owner' || value === 'admin' || value === 'developer' || value === 'viewer';

export const canManageMembers = (role: Role): boolean => ROLE_RANK[role] >= ROLE_RANK.admin;
export const canWriteProjects = (role: Role): boolean => ROLE_RANK[role] >= ROLE_RANK.developer;
export const canRead = (_role: Role): boolean => true;

/** 32 random bytes, base64url. The plaintext never leaves the login response. */
export const issueToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const slugifyOrg = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';

/**
 * Session expiry is absolute: a stolen cookie does not extend its own life by being used.
 * Rotation happens at login, so an old token is revoked before a new one is minted.
 */
export const sessionExpiry = (now = Date.now()): Date => new Date(now + SESSION_TTL_MS);
