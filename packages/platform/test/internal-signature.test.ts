import { describe, expect, it } from 'vitest';
import { signInternalRequest, verifyInternalRequest } from '../src/crypto/internal-signature';
import { internalTargetPath } from '../src/http/service-client';

/**
 * The gateway signs a logical route (`/v1/projects`) but the owning service verifies the URL it
 * received (`/internal/v1/projects`). When those two strings diverged every internal call was
 * rejected with "signature mismatch", so the shared convention is pinned here.
 */
describe('internal request signing', () => {
  const secret = 'test-shared-secret-value';

  const sign = (path: string, method = 'GET', body = '') =>
    signInternalRequest({
      secret,
      caller: 'api-gateway',
      method,
      path,
      timestamp: '1700000000000',
      body,
    });

  it('signs the prefixed path the receiver verifies', () => {
    const target = internalTargetPath('/v1/projects?limit=5');
    const signature = sign(target);

    expect(target).toBe('/internal/v1/projects?limit=5');
    expect(
      verifyInternalRequest({
        secret,
        caller: 'api-gateway',
        method: 'GET',
        path: '/internal/v1/projects?limit=5',
        timestamp: '1700000000000',
        body: '',
        signature,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a signature made for the unprefixed path', () => {
    const verification = verifyInternalRequest({
      secret,
      caller: 'api-gateway',
      method: 'GET',
      path: '/internal/v1/projects',
      timestamp: '1700000000000',
      body: '',
      signature: sign('/v1/projects'),
      now: 1_700_000_000_000,
    });

    expect(verification).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('covers the body and the method, not only the path', () => {
    const target = internalTargetPath('/v1/auth/login');
    const signature = sign(target, 'POST', '{"email":"a@b.c"}');

    expect(
      verifyInternalRequest({
        secret,
        caller: 'api-gateway',
        method: 'POST',
        path: target,
        timestamp: '1700000000000',
        body: '{"email":"a@b.c"}',
        signature,
        now: 1_700_000_000_000,
      }).ok,
    ).toBe(true);

    expect(
      verifyInternalRequest({
        secret,
        caller: 'api-gateway',
        method: 'POST',
        path: target,
        timestamp: '1700000000000',
        body: '{"email":"attacker@b.c"}',
        signature,
        now: 1_700_000_000_000,
      }),
    ).toEqual({ ok: false, reason: 'signature mismatch' });
  });

  it('expires a signature outside the skew window', () => {
    const target = internalTargetPath('/v1/projects');

    expect(
      verifyInternalRequest({
        secret,
        caller: 'api-gateway',
        method: 'GET',
        path: target,
        timestamp: '1700000000000',
        body: '',
        signature: sign(target),
        now: 1_700_000_000_000 + 600_000,
      }),
    ).toEqual({ ok: false, reason: 'timestamp outside the allowed window' });
  });
});
