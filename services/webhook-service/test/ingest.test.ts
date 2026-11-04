import { describe, expect, it } from 'vitest';
import {
  digestOf,
  githubSignature,
  verifyGithubSignature,
  verifyGitlabToken,
} from '../src/ingest/signature';
import { normalize } from '../src/ingest/normalize';

const SECRET = 'whsec_test_1234567890';
const BODY = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

describe('github signature', () => {
  it('accepts the signature the host would send', () => {
    const header = githubSignature(SECRET, BODY);
    expect(header.startsWith('sha256=')).toBe(true);
    expect(verifyGithubSignature(SECRET, BODY, header)).toBe(true);
  });

  it('rejects a body that changed after signing', () => {
    const header = githubSignature(SECRET, BODY);
    expect(verifyGithubSignature(SECRET, Buffer.from('{"hello":"mars"}'), header)).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const header = githubSignature('whsec_other_secret', BODY);
    expect(verifyGithubSignature(SECRET, BODY, header)).toBe(false);
  });

  it('fails closed when the secret or the header is missing', () => {
    expect(verifyGithubSignature('', BODY, githubSignature(SECRET, BODY))).toBe(false);
    expect(verifyGithubSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyGithubSignature(SECRET, BODY, '')).toBe(false);
  });

  it('tolerates surrounding whitespace on the header', () => {
    expect(verifyGithubSignature(SECRET, BODY, ` ${githubSignature(SECRET, BODY)} `)).toBe(true);
  });
});

describe('gitlab token', () => {
  it('compares the shared secret and fails closed', () => {
    expect(verifyGitlabToken(SECRET, SECRET)).toBe(true);
    expect(verifyGitlabToken(SECRET, 'whsec_wrong')).toBe(false);
    expect(verifyGitlabToken('', SECRET)).toBe(false);
    expect(verifyGitlabToken(SECRET, undefined)).toBe(false);
  });
});

describe('payload digest', () => {
  it('is stable for identical bytes and differs when they change', () => {
    expect(digestOf(BODY)).toBe(digestOf(Buffer.from(BODY)));
    expect(digestOf(BODY)).not.toBe(digestOf(Buffer.from('{"hello":"mars"}')));
  });
});

describe('normalization', () => {
  it('maps a github push to a repository identity', () => {
    const normalized = normalize(
      'github',
      'push',
      { repository: { id: 42, full_name: 'acme/site' }, sender: { login: 'ada' } },
      'delivery-1',
    );
    expect(normalized).toEqual({
      kind: 'push',
      event: 'push',
      deliveryId: 'delivery-1',
      remoteRepositoryId: '42',
      fullName: 'acme/site',
      actor: 'ada',
    });
  });

  it('maps a github pull request to a merge request', () => {
    const normalized = normalize('github', 'pull_request', { repository: { id: 7 } }, 'd-2');
    expect(normalized.kind).toBe('merge_request');
    expect(normalized.remoteRepositoryId).toBe('7');
  });

  it('marks an unrelated github event as other', () => {
    expect(normalize('github', 'ping', {}, 'd-3').kind).toBe('other');
  });

  it('maps gitlab hooks by their event name', () => {
    const payload = {
      project: { id: 99, path_with_namespace: 'acme/api' },
      user_username: 'grace',
    };
    expect(normalize('gitlab', 'Push Hook', payload, 'uuid-1').kind).toBe('push');
    expect(normalize('gitlab', 'Merge Request Hook', payload, 'uuid-2').kind).toBe('merge_request');
    expect(normalize('gitlab', 'Note Hook', payload, 'uuid-3').kind).toBe('review');
    const push = normalize('gitlab', 'Push Hook', payload, 'uuid-1');
    expect(push.remoteRepositoryId).toBe('99');
    expect(push.fullName).toBe('acme/api');
    expect(push.actor).toBe('grace');
  });

  it('reports a missing identity as null instead of inventing one', () => {
    const normalized = normalize('github', 'push', {}, undefined);
    expect(normalized.remoteRepositoryId).toBeNull();
    expect(normalized.deliveryId).toBeNull();
    expect(normalized.fullName).toBeNull();
  });
});
