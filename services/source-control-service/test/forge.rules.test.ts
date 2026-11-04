import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DomainError } from '@quorumloop/contracts';
import { createAppJwt, normalizePem } from '../src/forge/github-app';
import { pageFromCursor } from '../src/forge/github.adapter';
import { resolveBaseUrl } from '../src/connections/connection.service';

const decodeSegment = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('forge base url guard', () => {
  it('falls back to the documented host per forge', () => {
    expect(resolveBaseUrl('github', undefined)).toBe('https://api.github.com');
    expect(resolveBaseUrl('gitlab', undefined)).toBe('https://gitlab.com');
  });

  it('strips a trailing slash so paths never double up', () => {
    expect(resolveBaseUrl('gitlab', 'https://gitlab.com/')).toBe('https://gitlab.com');
  });

  it('refuses a url that embeds credentials', () => {
    expect(() => resolveBaseUrl('github', 'https://user:secret@api.github.com')).toThrow(
      DomainError,
    );
  });

  it('refuses a url with a query string', () => {
    expect(() => resolveBaseUrl('github', 'https://api.github.com?x=1')).toThrow(DomainError);
  });

  it('refuses a self-managed GitLab host that is not allow-listed', () => {
    expect(() => resolveBaseUrl('gitlab', 'https://gitlab.internal.example')).toThrow(DomainError);
  });

  it('refuses a non-url value', () => {
    expect(() => resolveBaseUrl('github', 'api.github.com')).toThrow(DomainError);
  });
});

describe('pagination cursors', () => {
  it('starts at the first page', () => {
    expect(pageFromCursor(null)).toBe(1);
    expect(pageFromCursor('')).toBe(1);
  });

  it('advances past the page the caller already saw', () => {
    expect(pageFromCursor('1')).toBe(2);
    expect(pageFromCursor('7')).toBe(8);
  });

  it('ignores a cursor that is not a page number', () => {
    expect(pageFromCursor('abc')).toBe(1);
    expect(pageFromCursor('0')).toBe(1);
    expect(pageFromCursor('-3')).toBe(1);
  });
});

describe('github app jwt', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('signs a three part RS256 token with the app id as issuer', () => {
    const jwt = createAppJwt('12345', pem, 1_700_000_000_000);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const header = decodeSegment(parts[0] ?? '');
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');

    const payload = decodeSegment(parts[1] ?? '');
    expect(payload.iss).toBe('12345');
    // Backdated to tolerate clock drift, and under GitHub's 10 minute ceiling.
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(600);
    expect(Number(payload.iat)).toBe(1_700_000_000 - 60);
  });

  it('accepts a pem that arrived with escaped newlines', () => {
    const escaped = pem.replace(/\n/g, '\\n');
    expect(normalizePem(escaped)).toBe(pem.trim());
    expect(() => createAppJwt('1', normalizePem(escaped))).not.toThrow();
  });
});
