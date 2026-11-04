import { describe, expect, it } from 'vitest';
import {
  canManageMembers,
  constantTimeEquals,
  hashToken,
  isRole,
  issueToken,
  normalizeEmail,
  sessionExpiry,
  slugifyOrg,
} from '../src/identity/identity.rules';

describe('identity rules', () => {
  it('normalizes email for lookup and storage', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('derives a stable hyphenated workspace slug', () => {
    expect(slugifyOrg('Acme Rocket  Labs!')).toBe('acme-rocket-labs');
    expect(slugifyOrg('!!!')).toBe('workspace');
  });

  it('accepts only known roles', () => {
    expect(isRole('developer')).toBe(true);
    expect(isRole('superuser')).toBe(false);
  });

  it('lets admins and owners manage members', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('admin')).toBe(true);
    expect(canManageMembers('developer')).toBe(false);
    expect(canManageMembers('viewer')).toBe(false);
  });

  it('issues opaque tokens and stores only their hash', () => {
    const token = issueToken();
    const other = issueToken();
    expect(token).not.toBe(other);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(other));
  });

  it('compares secrets without throwing on a length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('sets an absolute expiry in the future', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(sessionExpiry(now).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});
